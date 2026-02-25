// src/routes/config.js — MULTI-TENANT + Integración MP
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireAdmin } from "../auth/middlewares.js";
import { identifyTenant } from "../auth/tenant.js";
import { getConfigSnapshot } from "../services/config.js";
import { getPlanDefinition } from "../services/subscriptionPlans.js";
import { sendWhatsAppText, normalizeTo } from "../whatsapp.js";
import fetch from "node-fetch";
import {
  getTenantWhatsAppHub,
  updateTenantWhatsAppContact,
  setTenantWhatsAppActive,
  upsertTenantWhatsAppCredentials,
  updateTenantSupportAgentConfig,
} from "../services/whatsappHub.js";

const WA_API_VERSION = process.env.WHATSAPP_API_VERSION || "v24.0";

export const config = Router();

// Aplicar middleware de autenticación a todas las rutas
config.use(requireAuth, identifyTenant, requireAdmin);

function parseVal(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

async function getSection(tenantId, section) {
  const [rows] = await pool.query(
    "SELECT config_key, config_value FROM system_config WHERE tenant_id = ? AND config_key LIKE ?",
    [tenantId, `${section}.%`]
  );
  const out = {};
  for (const r of rows) {
    const key = r.config_key.replace(`${section}.`, "");
    const value = r.config_value;
    // Intentar parsear como JSON si parece ser un objeto
    try {
      if (value && (value.startsWith("{") || value.startsWith("["))) {
        out[key] = JSON.parse(value);
      } else {
        out[key] = parseVal(value);
      }
    } catch {
      // Si falla el parse, usar parseVal normal
      out[key] = parseVal(value);
    }
  }
  return out;
}

async function saveSection(tenantId, section, body) {
  const entries = Object.entries(body || {});
  for (const [key, val] of entries) {
    // Campos que siempre deben guardarse aunque estén vacíos
    const alwaysSaveFields = ['arca_cuit', 'whatsapp', 'arca', 'arca_api_key', 'arca_punto_venta', 'arca_api_url'];
    
    // No guardar valores null o undefined (pero sí strings vacíos para campos específicos)
    if (val === null || val === undefined) {
      continue;
    }
    
    // Si es string vacío y no está en la lista de campos que siempre se guardan, saltarlo
    if (val === '' && !alwaysSaveFields.includes(key)) {
      continue;
    }
    
    const configKey = `${section}.${key}`;
    const configValue = String(val);
    
    try {
      // Primero verificar si existe
      const [[existing]] = await pool.query(
        `SELECT config_value FROM system_config 
         WHERE tenant_id = ? AND config_key = ?`,
        [tenantId, configKey]
      );
      
      if (key === 'arca_cuit') {
        console.log(`[saveSection] Antes de guardar - Existe: ${!!existing}, Valor actual: "${existing?.config_value || 'NO EXISTE'}"`);
      }
      
      // Como la PK es solo config_key, necesitamos hacer UPDATE si existe para este tenant
      // o DELETE + INSERT si existe para otro tenant
      if (existing) {
        // Ya existe para este tenant, actualizar
        const [result] = await pool.query(
          `UPDATE system_config 
           SET config_value = ?
           WHERE tenant_id = ? AND config_key = ?`,
          [configValue, tenantId, configKey]
        );
        
        if (key === 'arca_cuit') {
          console.log(`[saveSection] UPDATE ejecutado: affectedRows=${result.affectedRows}`);
        }
      } else {
        // No existe para este tenant, pero puede existir para otro
        // Primero eliminar si existe para otro tenant (por la PK única en config_key)
        await pool.query(
          `DELETE FROM system_config WHERE config_key = ? AND tenant_id != ?`,
          [configKey, tenantId]
        );
        
        // Luego insertar para este tenant
        const [result] = await pool.query(
          `INSERT INTO system_config (tenant_id, config_key, config_value)
           VALUES (?, ?, ?)`,
          [tenantId, configKey, configValue]
        );
        
        if (key === 'arca_cuit') {
          console.log(`[saveSection] INSERT ejecutado: affectedRows=${result.affectedRows}, insertId=${result.insertId}`);
        }
      }
      
      // Log específico para arca_cuit
      if (key === 'arca_cuit') {
        // Esperar un momento para que se complete la transacción
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Verificar inmediatamente después de guardar
        const [[check]] = await pool.query(
          `SELECT config_value FROM system_config 
           WHERE tenant_id = ? AND config_key = ?`,
          [tenantId, configKey]
        );
        console.log(`[saveSection] Guardado ${configKey} = "${configValue}" para tenant ${tenantId}`);
        console.log(`[saveSection] Verificación inmediata: ${configKey} = "${check?.config_value || 'NO ENCONTRADO'}"`);
        
        // También verificar con LIKE por si hay algún problema con espacios
        const [checkLike] = await pool.query(
          `SELECT config_key, config_value FROM system_config 
           WHERE tenant_id = ? AND config_key LIKE ?`,
          [tenantId, `%${key}%`]
        );
        console.log(`[saveSection] Verificación con LIKE:`, checkLike);
      }
    } catch (err) {
      console.error(`[saveSection] Error guardando ${configKey}:`, err);
      throw err;
    }
  }
}

function normalizePayments(body) {
  const mode = body?.deposit_mode === "fixed" ? "fixed" : "percent";
  const require_deposit = body?.require_deposit ? 1 : 0;
  const deposit_percent =
    mode === "percent" ? Math.max(0, Math.min(100, Number(body?.deposit_percent ?? 20))) : null;
  const deposit_fixed =
    mode === "fixed" ? Math.max(0, Number(body?.deposit_fixed ?? 0)) : null;
  const deposit_min = body?.deposit_min != null ? Math.max(0, Number(body?.deposit_min)) : null;
  const deposit_max = body?.deposit_max != null ? Math.max(0, Number(body?.deposit_max)) : null;
  return {
    require_deposit,
    deposit_mode: mode,
    ...(deposit_percent != null ? { deposit_percent } : {}),
    ...(deposit_fixed != null ? { deposit_fixed } : {}),
    ...(deposit_min != null ? { deposit_min } : {}),
    ...(deposit_max != null ? { deposit_max } : {}),
  };
}

// 🔹 GET /api/config/payments
config.get("/payments", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
  const data = await getSection(tenantId, "payments");

  // Verifica si hay cuenta de MP conectada
  const [[mpCfg]] = await pool.query(
    `SELECT mp_user_id, mp_access_token FROM tenant_payment_config WHERE tenant_id = ? AND is_active = 1`,
    [tenantId]
  );

  const mpConnected = !!mpCfg?.mp_user_id && !!mpCfg?.mp_access_token;

  res.json({
    ok: true,
    data: {
      require_deposit: data.require_deposit ?? 0,
      deposit_mode: data.deposit_mode ?? "percent",
      deposit_percent: data.deposit_percent ?? 20,
      deposit_fixed: data.deposit_fixed ?? null,
      deposit_min: data.deposit_min ?? null,
      deposit_max: data.deposit_max ?? null,
      mp_connected: mpConnected,
    },
  });
  } catch (e) {
    console.error("[GET /api/config/payments] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 🔹 PUT /api/config/payments
config.put("/payments", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
  // Chequear conexión MP antes de permitir activar seña
  const [[mpCfg]] = await pool.query(
    `SELECT mp_user_id, mp_access_token
     FROM tenant_payment_config
    WHERE tenant_id = ? AND is_active = 1
    LIMIT 1`,
    [tenantId]
  );
  const mpConnected = !!mpCfg?.mp_user_id && !!mpCfg?.mp_access_token;
  const payload = normalizePayments(req.body || {});
  // Si intentan habilitar la seña sin MP conectado, rechazar
    // PERO permitir desactivar (require_deposit = 0) incluso sin MP
  if ((payload.require_deposit ?? 0) == 1 && !mpConnected) {
    return res.status(409).json({
      ok: false,
      error: "No podés activar la seña: Mercado Pago no está conectado"
    });
  }
    // Si está desactivando, permitir siempre

  await saveSection(tenantId, "payments", payload);
  await getConfigSnapshot(true, tenantId);
  res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /api/config/payments] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 🔹 GET /api/config/appointments
config.get("/appointments", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    // Leer de classes en lugar de appointments (la membresía ahora solo se requiere para clases)
    const data = await getSection(tenantId, "classes");
    res.json({
      ok: true,
      data: {
        require_membership: Boolean(data.require_membership),
      },
    });
  } catch (e) {
    console.error("[GET /api/config/appointments] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 🔹 PUT /api/config/appointments
config.put("/appointments", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    // Guardar en classes en lugar de appointments (la membresía ahora solo se requiere para clases)
    await saveSection(tenantId, "classes", {
      require_membership: req.body?.require_membership ? 1 : 0,
    });

    await getConfigSnapshot(true, tenantId);

    res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /api/config/appointments] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Otras secciones igual que antes ↓
config.get("/", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    const data = await getSection(tenantId, "general");
    res.json({ ok: true, data });
  } catch (e) {
    console.error("[GET /api/config] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

config.put("/general", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    // Prevenir que se actualice el nombre del negocio
    const bodyWithoutBusinessName = { ...req.body };
    delete bodyWithoutBusinessName.businessName;
    await saveSection(tenantId, "general", bodyWithoutBusinessName);
  res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /api/config/general] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

config.put("/", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    const updates = req.body || {};
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        `INSERT INTO system_config (tenant_id, config_key, config_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
        [tenantId, key, String(value)]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /api/config] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Commissions + Notifications igual
config.get("/commissions", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    const data = await getSection(tenantId, "commissions");
    res.json({ ok: true, data });
  } catch (e) {
    console.error("[GET /api/config/commissions] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

config.put("/commissions", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    await saveSection(tenantId, "commissions", req.body);
  res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /api/config/commissions] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

config.get("/notifications", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    const data = await getSection(tenantId, "notifications");
    res.json({ ok: true, data });
  } catch (e) {
    console.error("[GET /api/config/notifications] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

config.put("/notifications", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    await saveSection(tenantId, "notifications", req.body);
    res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /api/config/notifications] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Bot section - Configuración del bot de WhatsApp
config.get("/bot", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    const data = await getSection(tenantId, "bot");
    res.json({ ok: true, data });
  } catch (e) {
    console.error("[GET /api/config/bot] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

config.put("/bot", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    await saveSection(tenantId, "bot", req.body);
    await getConfigSnapshot(true, tenantId); // Invalidar cache
    res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /api/config/bot] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 🔹 GET /api/config/calendar
config.get("/calendar", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    const data = await getSection(tenantId, "calendar");
    res.json({
      ok: true,
      data: {
        minTime: data.minTime || "06:00:00",
        maxTime: data.maxTime || "23:00:00",
      },
    });
  } catch (e) {
    console.error("[GET /api/config/calendar] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 🔹 PUT /api/config/calendar
config.put("/calendar", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    const payload = req.body || {};
    await saveSection(tenantId, "calendar", {
      minTime: payload.minTime || "06:00:00",
      maxTime: payload.maxTime || "23:00:00",
    });
    await getConfigSnapshot(true, tenantId);
    res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /api/config/calendar] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 🔹 GET /api/config/working-hours
config.get("/working-hours", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    const data = await getSection(tenantId, "working-hours");
    res.json({ ok: true, data });
  } catch (e) {
    console.error("[GET /api/config/working-hours] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 🔹 PUT /api/config/working-hours
config.put("/working-hours", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    
    const body = req.body || {};
    
    // Guardar cada día como un objeto JSON en system_config
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    
    for (const day of days) {
      if (body[day]) {
        const dayConfig = body[day];
        const configKey = `working-hours.${day}`;
        const configValue = JSON.stringify(dayConfig);
        
        // Verificar si existe
        const [[existing]] = await pool.query(
          `SELECT config_value FROM system_config 
           WHERE tenant_id = ? AND config_key = ?`,
          [tenantId, configKey]
        );
        
        if (existing) {
          // Actualizar
          await pool.query(
            `UPDATE system_config 
             SET config_value = ?
             WHERE tenant_id = ? AND config_key = ?`,
            [configValue, tenantId, configKey]
          );
        } else {
          // Eliminar si existe para otro tenant y luego insertar
          await pool.query(
            `DELETE FROM system_config WHERE config_key = ? AND tenant_id != ?`,
            [configKey, tenantId]
          );
          
          await pool.query(
            `INSERT INTO system_config (tenant_id, config_key, config_value)
             VALUES (?, ?, ?)`,
            [tenantId, configKey, configValue]
          );
        }
      }
    }
    
    res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /api/config/working-hours] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Contact section - ARCA y WhatsApp
config.get("/contact", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    const data = await getSection(tenantId, "contact");
    res.json({ ok: true, data });
  } catch (e) {
    console.error("[GET /api/config/contact] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

config.put("/contact", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    
    const body = { ...req.body };
    
    // Log para debug
    console.log("[PUT /api/config/contact] Tenant ID:", tenantId);
    console.log("[PUT /api/config/contact] Body recibido:", Object.keys(body));
    console.log("[PUT /api/config/contact] arca_cuit recibido:", body.arca_cuit);
    console.log("[PUT /api/config/contact] Tipo de arca_cuit:", typeof body.arca_cuit);
    console.log("[PUT /api/config/contact] Longitud de arca_cuit:", body.arca_cuit?.length);
    
    // Guardar una copia del CUIT antes de procesar certificados
    const arcaCuitToSave = body.arca_cuit;
    
    // Si se envían certificados como texto, guardarlos en archivos
    if (body.arca_cert_content || body.arca_key_content) {
      const fs = (await import("fs")).default;
      const path = (await import("path")).default;
      const { fileURLToPath } = await import("url");
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      
      // Crear directorio para certificados si no existe
      const certsDir = path.join(__dirname, "../../certs", String(tenantId));
      if (!fs.existsSync(certsDir)) {
        fs.mkdirSync(certsDir, { recursive: true });
      }
      
      // Guardar certificado
      if (body.arca_cert_content) {
        const certPath = path.join(certsDir, "certificado.crt");
        fs.writeFileSync(certPath, body.arca_cert_content, "utf8");
        body.arca_cert_path = certPath;
        delete body.arca_cert_content; // No guardar el contenido en BD
      }
      
      // Guardar clave privada
      if (body.arca_key_content) {
        const keyPath = path.join(certsDir, "clave_privada.key");
        fs.writeFileSync(keyPath, body.arca_key_content, "utf8");
        body.arca_key_path = keyPath;
        delete body.arca_key_content; // No guardar el contenido en BD
      }
    }
    
    // Asegurar que arca_cuit esté en el body antes de guardar
    if (arcaCuitToSave !== undefined) {
      body.arca_cuit = arcaCuitToSave;
    }
    
    console.log("[PUT /api/config/contact] Body antes de saveSection:", {
      arca_cuit: body.arca_cuit,
      keys: Object.keys(body)
    });
    
    await saveSection(tenantId, "contact", body);
    
    // Verificar que se guardó correctamente (especialmente para arca_cuit)
    if (arcaCuitToSave !== undefined) {
      // Esperar un poco para asegurar que la transacción se complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verificar con la clave exacta
      const [[verify]] = await pool.query(
        `SELECT config_value FROM system_config 
         WHERE tenant_id = ? AND config_key = ?`,
        [tenantId, 'contact.arca_cuit']
      );
      
      console.log(`[PUT /api/config/contact] Verificación post-guardado: arca_cuit = "${verify?.config_value || 'NO ENCONTRADO'}"`);
      
      // También verificar todas las configuraciones de contacto para debug
      const [allConfigs] = await pool.query(
        `SELECT config_key, config_value FROM system_config 
         WHERE tenant_id = ? AND config_key LIKE 'contact.%'`,
        [tenantId]
      );
      console.log(`[PUT /api/config/contact] Todas las configs de contacto:`, 
        allConfigs.map(c => `${c.config_key}=${c.config_value}`).join(', '));
    }
    
    res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /api/config/contact] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * =========================
 * 📱 WhatsApp Business
 * =========================
 */
config.get("/whatsapp", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const contactSection = await getSection(tenantId, "contact").catch(() => ({}));
    const hub = await getTenantWhatsAppHub(tenantId);

    const phoneDisplay = contactSection.whatsapp ?? hub?.phoneDisplay ?? "";
    const hasOAuthToken = !!(hub && hub.accessToken);
    const hubConfigured = !!(hub && hub.hasCredentials);
    // hubActive debe reflejar el valor real de isActive, incluso si hubConfigured es false (con OAuth token)
    // El bot se activa automáticamente con OAuth, incluso si falta phone_number_id
    const hubActive = !!(hub && hub.isActive);
    const status = hubConfigured ? (hubActive ? "ready" : "disabled") : (hasOAuthToken ? (hubActive ? "ready" : "oauth_pending") : "pending");

    // Enmascarar el token para mostrarlo parcialmente (primeros 10 y últimos 5 caracteres)
    let accessTokenMasked = null;
    if (hub?.accessToken) {
      const token = hub.accessToken;
      if (token.length > 20) {
        accessTokenMasked = `${token.substring(0, 10)}...${token.substring(token.length - 5)}`;
      } else {
        accessTokenMasked = "***configurado***";
      }
    }

    res.json({
      ok: true,
      data: {
        phoneDisplay,
        hubConfigured,
        hubActive,
        status,
        hasOAuthToken, // Indica si hay token OAuth pero falta phone_number_id
        phoneNumberId: hub?.phoneNumberId ?? null, // ✅ Agregar phoneNumberId a la respuesta
        accessTokenMasked, // ✅ Token enmascarado para mostrar al usuario
        needsPhoneNumberId: hasOAuthToken && (!hub?.phoneNumberId || hub.phoneNumberId.startsWith("pending:")), // ✅ Indica si necesita phone_number_id
        supportMessage: hubConfigured
          ? null
          : hasOAuthToken
          ? "OAuth conectado exitosamente. Ingresá tu número de WhatsApp y guardalo para activar automáticamente el asistente."
          : "Conectá tu cuenta de WhatsApp Business con un solo clic. Solo necesitás autorizar los permisos en Meta.",
        useOAuth: true, // Siempre usar flujo OAuth (configuración manual eliminada)
        allowManualConfig: true, // ✅ Permitir configuración manual de credenciales
        oauthAvailable: !!(process.env.META_APP_ID && process.env.META_APP_SECRET),
        createdAt: hub?.createdAt ?? null,
        updatedAt: hub?.updatedAt ?? null,
        managedBy: hub?.managedBy ?? null,
        managedNotes: hub?.managedNotes ?? null,
        supportAgentEnabled: hub?.supportAgentEnabled ?? false,
        supportAgentPhone: hub?.supportAgentPhone ?? null,
      },
    });
  } catch (e) {
    console.error("[GET /api/config/whatsapp] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

config.put("/whatsapp", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const body = req.body || {};
    const hasPhoneChange = Object.prototype.hasOwnProperty.call(body, "phoneDisplay");
    const hasActiveChange = Object.prototype.hasOwnProperty.call(body, "isActive");
    const hasPhoneNumberIdChange = Object.prototype.hasOwnProperty.call(body, "phoneNumberId");
    const hasAccessTokenChange = Object.prototype.hasOwnProperty.call(body, "accessToken");
    const hasSupportAgentEnabledChange = Object.prototype.hasOwnProperty.call(body, "supportAgentEnabled");
    // IMPORTANTE: Considerar que supportAgentPhone ha cambiado si está presente en el body,
    // incluso si es una cadena vacía (para permitir limpiar el valor)
    const hasSupportAgentPhoneChange = Object.prototype.hasOwnProperty.call(body, "supportAgentPhone");
    
    // Log para debugging
    console.log(`[PUT /api/config/whatsapp] Body recibido:`, {
      hasSupportAgentEnabledChange,
      hasSupportAgentPhoneChange,
      hasAccessTokenChange,
      hasPhoneNumberIdChange,
      supportAgentEnabled: body.supportAgentEnabled,
      supportAgentPhone: body.supportAgentPhone,
      supportAgentPhoneType: typeof body.supportAgentPhone,
      supportAgentPhoneLength: body.supportAgentPhone?.length,
      supportAgentPhoneIsEmpty: body.supportAgentPhone === "" || body.supportAgentPhone === null || body.supportAgentPhone === undefined,
      phoneDisplay: body.phoneDisplay,
      allBodyKeys: Object.keys(body),
      bodyStringified: JSON.stringify(body),
    });

    if (!hasPhoneChange && !hasActiveChange && !hasPhoneNumberIdChange && !hasAccessTokenChange && !hasSupportAgentEnabledChange && !hasSupportAgentPhoneChange) {
      return res.status(400).json({ ok: false, error: "No hay cambios para aplicar." });
    }

    const hubBefore = await getTenantWhatsAppHub(tenantId);
    
    // ✅ Procesar configuración manual de accessToken y phoneNumberId
    if (hasAccessTokenChange || hasPhoneNumberIdChange) {
      const accessToken = hasAccessTokenChange ? String(body.accessToken || "").trim() : (hubBefore?.accessToken || null);
      const phoneNumberId = hasPhoneNumberIdChange ? String(body.phoneNumberId || "").trim() : (hubBefore?.phoneNumberId || null);
      
      console.log(`[WA Config] Configuración manual para tenant ${tenantId}:`, {
        hasAccessTokenChange,
        hasPhoneNumberIdChange,
        accessTokenLength: accessToken?.length || 0,
        phoneNumberId,
      });
      
      // Validar accessToken si se está cambiando
      if (hasAccessTokenChange) {
        if (!accessToken) {
          return res.status(400).json({ ok: false, error: "El Access Token no puede estar vacío." });
        }
        if (accessToken.length < 50) {
          return res.status(400).json({ ok: false, error: "El Access Token parece ser inválido (muy corto)." });
        }
      }
      
      // Validar phoneNumberId si se está cambiando
      if (hasPhoneNumberIdChange && phoneNumberId) {
        if (phoneNumberId.length < 10) {
          return res.status(400).json({ ok: false, error: "El Phone Number ID debe tener al menos 10 caracteres." });
        }
      }
      
      // Obtener el phoneDisplay actual
      const contactSection = await getSection(tenantId, "contact").catch(() => ({}));
      const currentPhoneDisplay = hasPhoneChange && body.phoneDisplay ? 
        String(body.phoneDisplay || "").trim() : 
        (contactSection.whatsapp ?? hubBefore?.phoneDisplay ?? null);
      
      // Guardar las credenciales (nuevas o actualizadas)
      await upsertTenantWhatsAppCredentials(tenantId, {
        phoneNumberId: phoneNumberId || hubBefore?.phoneNumberId || `pending:${tenantId}`,
        accessToken: accessToken,
        refreshToken: hubBefore?.refreshToken || null,
        tokenExpiresAt: hubBefore?.tokenExpiresAt || null,
        verifyToken: hubBefore?.verifyToken || null,
        phoneDisplay: currentPhoneDisplay,
        isActive: true, // Activar automáticamente al configurar manualmente
        managedBy: "user_manual",
        managedNotes: "Credenciales configuradas manualmente por el usuario",
      });
      
      console.log(`[WA Config] ✅ Credenciales guardadas manualmente para tenant ${tenantId}`);
    }

    if (hasPhoneChange) {
      const phoneDisplay = String(body.phoneDisplay || "").trim();
      await saveSection(tenantId, "contact", { whatsapp: phoneDisplay });
      await updateTenantWhatsAppContact(tenantId, { phoneDisplay });
      
      // Si ya se procesó accessToken/phoneNumberId arriba, no duplicar
      if (!hasAccessTokenChange && !hasPhoneNumberIdChange) {
        // ✅ SIEMPRE intentar obtener phone_number_id automáticamente cuando se guarda el número
        // (Solo si hay OAuth token y no se ingresó manualmente)
        const hubAfterPhoneNumberUpdate = await getTenantWhatsAppHub(tenantId);
        const hasPlaceholderOrMissing = !hubAfterPhoneNumberUpdate?.phoneNumberId || (hubAfterPhoneNumberUpdate?.phoneNumberId && hubAfterPhoneNumberUpdate.phoneNumberId.startsWith("pending:"));
        
        // Intentar obtener phone_number_id automáticamente si:
        // 1. Se guardó el número (hasPhoneChange)
        // 2. Hay OAuth token
        // 3. No se ingresó phone_number_id manualmente
        // 4. Falta phone_number_id o tiene placeholder
        if (hubAfterPhoneNumberUpdate && hubAfterPhoneNumberUpdate.accessToken && hasPlaceholderOrMissing && hubAfterPhoneNumberUpdate.managedBy === "user_oauth") {
          try {
            console.log(`[WA Config] Intentando obtener phone_number_id automáticamente para tenant ${tenantId} usando la función refreshPhoneNumberIdForTenant`);
            
            // ✅ Usar la función helper que ya funciona correctamente (la misma que usaba el botón)
            const result = await refreshPhoneNumberIdForTenant(tenantId, { skipPhoneValidation: false });
            
            if (result.ok && result.phoneNumberId) {
              console.log(`[WA Config] ✅ Phone_number_id obtenido automáticamente: ${result.phoneNumberId}`);
            } else {
              console.warn(`[WA Config] ⚠️ No se pudo obtener phone_number_id automáticamente. Se intentará cuando llegue el primer mensaje de WhatsApp.`);
            }
          } catch (err) {
            console.error(`[WA Config] Error obteniendo phone_number_id automáticamente para tenant ${tenantId}:`, err.message);
          }
        }
        
        // El bot ya se activa automáticamente cuando se obtienen las credenciales OAuth
        // Solo actualizamos si aún no está activo por alguna razón
        const hubAfter = await getTenantWhatsAppHub(tenantId);
        if (hubAfter && hubAfter.accessToken && hubAfter.managedBy === "user_oauth" && !hubAfter.isActive) {
          await setTenantWhatsAppActive(tenantId, true);
          console.log(`[WA Config] ✅ Asistente activado automáticamente para tenant ${tenantId} después de guardar número post-OAuth`);
        }
      }
    }

    if (hasActiveChange) {
      // Permitir activar si hay credenciales completas O bien si hay OAuth token (incluso con placeholder)
      const canActivate = hubBefore && (hubBefore.hasCredentials || (hubBefore.accessToken && hubBefore.managedBy === "user_oauth"));
      if (!canActivate) {
        return res.status(409).json({
          ok: false,
          error: "La integración todavía no fue configurada. Conectá tu cuenta de WhatsApp Business primero.",
        });
      }
      await setTenantWhatsAppActive(tenantId, !!body.isActive);
    }

    // Actualizar configuración del agente de soporte
    if (hasSupportAgentEnabledChange || hasSupportAgentPhoneChange) {
      console.log(`[PUT /api/config/whatsapp] Llamando a updateTenantSupportAgentConfig con:`, {
        supportAgentEnabled: hasSupportAgentEnabledChange ? body.supportAgentEnabled : undefined,
        supportAgentPhone: hasSupportAgentPhoneChange ? body.supportAgentPhone : undefined,
        supportAgentPhoneType: hasSupportAgentPhoneChange ? typeof body.supportAgentPhone : 'N/A',
        supportAgentPhoneLength: hasSupportAgentPhoneChange ? body.supportAgentPhone?.length : 'N/A',
        supportAgentPhoneValue: hasSupportAgentPhoneChange ? body.supportAgentPhone : 'N/A',
      });
      await updateTenantSupportAgentConfig(tenantId, {
        supportAgentEnabled: hasSupportAgentEnabledChange ? body.supportAgentEnabled : undefined,
        supportAgentPhone: hasSupportAgentPhoneChange ? body.supportAgentPhone : undefined,
      });
      console.log(`[PUT /api/config/whatsapp] updateTenantSupportAgentConfig completado`);
    } else {
      console.log(`[PUT /api/config/whatsapp] No se actualizará la configuración del agente (hasSupportAgentEnabledChange: ${hasSupportAgentEnabledChange}, hasSupportAgentPhoneChange: ${hasSupportAgentPhoneChange})`);
    }

    const hub = await getTenantWhatsAppHub(tenantId);
    console.log(`[PUT /api/config/whatsapp] Hub leído después de actualizar:`, {
      supportAgentEnabled: hub?.supportAgentEnabled,
      supportAgentPhone: hub?.supportAgentPhone,
      phoneDisplay: hub?.phoneDisplay,
    });
    const contactSection = await getSection(tenantId, "contact").catch(() => ({}));
    const phoneDisplay = contactSection.whatsapp ?? hub?.phoneDisplay ?? "";
    const hasOAuthToken = !!(hub && hub.accessToken);
    const hubConfigured = !!(hub && hub.hasCredentials);
    // hubActive debe reflejar el valor real de isActive, incluso si hubConfigured es false (con OAuth token)
    const hubActive = !!(hub && hub.isActive);
    const status = hubConfigured ? (hubActive ? "ready" : "disabled") : (hasOAuthToken ? (hubActive ? "ready" : "oauth_pending") : "pending");

    // Enmascarar el token para mostrarlo parcialmente
    let accessTokenMasked = null;
    if (hub?.accessToken) {
      const token = hub.accessToken;
      if (token.length > 20) {
        accessTokenMasked = `${token.substring(0, 10)}...${token.substring(token.length - 5)}`;
      } else {
        accessTokenMasked = "***configurado***";
      }
    }

    const responseData = {
      ok: true,
      data: {
        phoneDisplay,
        hubConfigured,
        hubActive,
        status,
        hasOAuthToken,
        phoneNumberId: hub?.phoneNumberId ?? null,
        accessTokenMasked, // ✅ Token enmascarado para mostrar al usuario
        needsPhoneNumberId: hasOAuthToken && (!hub?.phoneNumberId || hub.phoneNumberId.startsWith("pending:")),
        supportMessage: hubConfigured
          ? null
          : hasOAuthToken
          ? "OAuth conectado exitosamente. Ingresá tu número de WhatsApp y guardalo para activar automáticamente el asistente."
          : "Conectá tu cuenta de WhatsApp Business con un solo clic. Solo necesitás autorizar los permisos en Meta.",
        useOAuth: true, // Siempre usar flujo OAuth (configuración manual eliminada)
        allowManualConfig: true, // ✅ Permitir configuración manual de credenciales
        oauthAvailable: !!(process.env.META_APP_ID && process.env.META_APP_SECRET),
        createdAt: hub?.createdAt ?? null,
        updatedAt: hub?.updatedAt ?? null,
        managedBy: hub?.managedBy ?? null,
        managedNotes: hub?.managedNotes ?? null,
        supportAgentEnabled: hub?.supportAgentEnabled ?? false,
        supportAgentPhone: hub?.supportAgentPhone ?? null,
      },
    };
    
    console.log(`[PUT /api/config/whatsapp] Respuesta enviada al frontend:`, {
      supportAgentEnabled: responseData.data.supportAgentEnabled,
      supportAgentPhone: responseData.data.supportAgentPhone,
    });
    
    res.json(responseData);
  } catch (e) {
    console.error("[PUT /api/config/whatsapp] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ✅ Función helper para obtener phone_number_id automáticamente
async function refreshPhoneNumberIdForTenant(tenantId, options = {}) {
  try {
    const { skipPhoneValidation = false } = options;
    
    const hub = await getTenantWhatsAppHub(tenantId);
    
    if (!hub || !hub.accessToken) {
      throw new Error("No hay token OAuth guardado. Primero conectá tu cuenta de WhatsApp Business.");
    }

    // ✅ Validar que haya un número guardado antes de obtener el ID (a menos que se salte la validación)
    const savedPhoneDisplay = hub.phoneDisplay || null;
    if (!skipPhoneValidation && (!savedPhoneDisplay || !String(savedPhoneDisplay).trim())) {
      throw new Error("Primero debés guardar tu número de WhatsApp. Ingresá el número en el campo 'Número de WhatsApp' y hacé clic en 'Guardar número'.");
    }

    console.log(`[WA Config] Buscando phone_number_id para el número guardado: ${savedPhoneDisplay}`);

    // Función helper para normalizar números y compararlos
    const normalizePhoneForComparison = (phone) => {
      if (!phone) return "";
      // Remover espacios, guiones, paréntesis, y el signo +
      let normalized = String(phone).replace(/[\s\-\(\)\+]/g, "");
      // Si empieza con 0, removerlo
      if (normalized.startsWith("0")) {
        normalized = normalized.substring(1);
      }
      // Para números de prueba de Meta que empiezan con 1 (USA), mantenerlos como están
      // pero también crear una versión sin el 1 inicial para comparación
      return normalized;
    };
    
    // Función helper para crear variantes de un número para comparación
    const getPhoneVariants = (phone) => {
      const normalized = normalizePhoneForComparison(phone);
      const variants = [normalized];
      
      // Si empieza con 1 (código de país USA), también considerar sin el 1
      if (normalized.startsWith("1") && normalized.length > 10) {
        variants.push(normalized.substring(1));
      }
      
      // Si empieza con 54 (Argentina), también considerar sin el 54
      if (normalized.startsWith("54") && normalized.length > 10) {
        variants.push(normalized.substring(2));
        // Si tiene el 9 móvil después del 54, también considerar sin el 9
        if (normalized.startsWith("549") && normalized.length > 11) {
          variants.push("54" + normalized.substring(3));
        }
      }
      
      // Últimos 10 dígitos
      if (normalized.length >= 10) {
        variants.push(normalized.slice(-10));
      }
      
      return [...new Set(variants)]; // Eliminar duplicados
    };

    // Función helper para extraer solo los últimos dígitos (útil para comparar números con/sin código de país)
    const getLastDigits = (phone, count = 10) => {
      const normalized = normalizePhoneForComparison(phone);
      return normalized.slice(-count);
    };

    const savedPhoneNormalized = normalizePhoneForComparison(savedPhoneDisplay);
    const savedPhoneVariants = getPhoneVariants(savedPhoneDisplay);
    const savedPhoneLastDigits = getLastDigits(savedPhoneDisplay, 10); // Últimos 10 dígitos
    console.log(`[WA Config] Número guardado normalizado: ${savedPhoneNormalized}, variantes: [${savedPhoneVariants.join(", ")}], últimos 10 dígitos: ${savedPhoneLastDigits}`);

    // Si hay un phone_number_id guardado pero es placeholder, limpiarlo primero para forzar búsqueda
    if (hub.phoneNumberId && hub.phoneNumberId.startsWith("pending:")) {
      console.log(`[WA Config] Limpiando placeholder phone_number_id antes de obtener el real: ${hub.phoneNumberId}`);
      // Limpiar el placeholder para forzar que se obtenga el valor real
      await upsertTenantWhatsAppCredentials(tenantId, {
        phoneNumberId: null, // Limpiar el placeholder
        accessToken: hub.accessToken,
        refreshToken: hub.refreshToken,
        tokenExpiresAt: hub.tokenExpiresAt,
        verifyToken: hub.verifyToken,
        phoneDisplay: hub.phoneDisplay,
        isActive: hub.isActive !== false,
        managedBy: hub.managedBy || "user_oauth",
        managedNotes: "Placeholder limpiado para obtener phone_number_id real desde Meta API",
      });
      // Recargar hub después de limpiar
      const hubAfterClean = await getTenantWhatsAppHub(tenantId);
      if (hubAfterClean) {
        hub.phoneNumberId = hubAfterClean.phoneNumberId;
      }
    }
    
    // Si hay un phone_number_id guardado pero es inválido (no es placeholder), limpiarlo primero
    if (hub.phoneNumberId && !hub.phoneNumberId.startsWith("pending:") && skipPhoneValidation) {
      console.log(`[WA Config] Limpiando phone_number_id anterior antes de obtener uno nuevo: ${hub.phoneNumberId}`);
      // Limpiar el phone_number_id para forzar que se obtenga uno nuevo
      await upsertTenantWhatsAppCredentials(tenantId, {
        phoneNumberId: null, // Limpiar el phone_number_id inválido
        accessToken: hub.accessToken,
        refreshToken: hub.refreshToken,
        tokenExpiresAt: hub.tokenExpiresAt,
        verifyToken: hub.verifyToken,
        phoneDisplay: hub.phoneDisplay,
        isActive: hub.isActive !== false,
        managedBy: hub.managedBy || "user_oauth",
        managedNotes: "Phone_number_id limpiado para refrescar desde Meta API",
      });
    }

    const WA_API_VERSION = process.env.WHATSAPP_API_VERSION || "v24.0";
    let phoneNumberId = null;
    let phoneDisplay = null;
    let availableNumbers = []; // Lista de números disponibles para el mensaje de error

    // Método 1: Obtener businesses y luego sus WABAs por separado
    if (!phoneNumberId) {
      try {
        console.log(`[WA Config] Intentando obtener phone_number_id desde /me/businesses para tenant ${tenantId}`);
        const businessResponse = await fetch(
          `https://graph.facebook.com/${WA_API_VERSION}/me/businesses?fields=id,name`,
          {
            headers: {
              Authorization: `Bearer ${hub.accessToken}`,
            },
          }
        );

        const businessResponseText = await businessResponse.text();
        console.log(`[WA Config] Respuesta de /me/businesses: status=${businessResponse.status}, body=${businessResponseText.substring(0, 500)}`);

        if (businessResponse.ok) {
          const businessData = JSON.parse(businessResponseText);
          const businesses = businessData.data || [];
          console.log(`[WA Config] Encontradas ${businesses.length} businesses`);

          for (const business of businesses) {
            console.log(`[WA Config] Procesando business ${business.id}`);
            
            // Intentar obtener WABAs directamente desde el business
            try {
              const wabaDirectResponse = await fetch(
                `https://graph.facebook.com/${WA_API_VERSION}/${business.id}/owned_whatsapp_business_accounts?fields=id,display_phone_number,phone_number_id,verified_name`,
                {
                  headers: {
                    Authorization: `Bearer ${hub.accessToken}`,
                  },
                }
              );

              const wabaDirectText = await wabaDirectResponse.text();
              console.log(`[WA Config] Respuesta de /${business.id}/owned_whatsapp_business_accounts: status=${wabaDirectResponse.status}, body=${wabaDirectText.substring(0, 500)}`);

              if (wabaDirectResponse.ok) {
                const wabaDirectData = JSON.parse(wabaDirectText);
                const wabaDirectAccounts = wabaDirectData.data || [];
                console.log(`[WA Config] Business ${business.id} tiene ${wabaDirectAccounts.length} WABA accounts`);
                
                // ✅ Iterar por TODOS los WABAs, no solo el primero
                for (const waba of wabaDirectAccounts) {
                  const wabaId = waba.id;
                  console.log(`[WA Config] Procesando WABA ID: ${wabaId}`);
                  
                  // Si ya encontramos el número, no necesitamos seguir buscando
                  if (phoneNumberId) {
                    break;
                  }
                  
                  // Hacer una segunda llamada para obtener los phone numbers del WABA
                  // Incluir más campos para identificar números de prueba
                  try {
                    const phoneNumbersResponse = await fetch(
                      `https://graph.facebook.com/${WA_API_VERSION}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating`,
                      {
                        headers: {
                          Authorization: `Bearer ${hub.accessToken}`,
                        },
                      }
                    );

                    const phoneNumbersText = await phoneNumbersResponse.text();
                    console.log(`[WA Config] Respuesta de /${wabaId}/phone_numbers: status=${phoneNumbersResponse.status}, body=${phoneNumbersText.substring(0, 500)}`);

                    if (phoneNumbersResponse.ok) {
                      const phoneNumbersData = JSON.parse(phoneNumbersText);
                      const phoneNumbers = phoneNumbersData.data || [];
                      console.log(`[WA Config] WABA ${wabaId} tiene ${phoneNumbers.length} phone numbers`);
                      
                      if (phoneNumbers.length > 0) {
                        // ✅ Agregar estos números a la lista de disponibles (para el mensaje de error)
                        phoneNumbers.forEach(p => {
                          if (!availableNumbers.find(ap => ap.id === p.id)) {
                            availableNumbers.push({
                              id: p.id,
                              display_phone_number: p.display_phone_number,
                              code_verification_status: p.code_verification_status,
                            });
                          }
                        });
                        
                        // ✅ Buscar el número que coincide con el número guardado
                        let matchingPhoneNumber = null;
                        
                        for (const phone of phoneNumbers) {
                          const phoneDisplayNormalized = normalizePhoneForComparison(phone.display_phone_number);
                          const phoneVariants = getPhoneVariants(phone.display_phone_number);
                          const phoneLastDigits = getLastDigits(phone.display_phone_number, 10);
                          console.log(`[WA Config] Comparando: guardado="${savedPhoneNormalized}" (variantes: [${savedPhoneVariants.join(", ")}]) vs encontrado="${phoneDisplayNormalized}" (variantes: [${phoneVariants.join(", ")}]) (${phone.display_phone_number})`);
                          
                          // Comparar usando todas las variantes posibles
                          let foundMatch = false;
                          for (const savedVariant of savedPhoneVariants) {
                            for (const phoneVariant of phoneVariants) {
                              if (savedVariant === phoneVariant) {
                                matchingPhoneNumber = phone;
                                console.log(`[WA Config] ✅ Número encontrado que coincide (variante: ${savedVariant} === ${phoneVariant}): ${phone.display_phone_number}`);
                                foundMatch = true;
                                break;
                              }
                            }
                            if (foundMatch) break;
                          }
                          
                          if (foundMatch) break;
                          
                          // También comparar últimos 10 dígitos como fallback
                          if (savedPhoneLastDigits && phoneLastDigits && savedPhoneLastDigits === phoneLastDigits) {
                            matchingPhoneNumber = phone;
                            console.log(`[WA Config] ✅ Número encontrado que coincide (últimos 10 dígitos): ${phone.display_phone_number}`);
                            break;
                          }
                        }
                        
                        if (matchingPhoneNumber) {
                          // El ID del phone number ES el phone_number_id
                          phoneNumberId = matchingPhoneNumber.id;
                          phoneDisplay = matchingPhoneNumber.display_phone_number || matchingPhoneNumber.verified_name || null;
                          console.log(`[WA Config] ✅ Phone_number_id obtenido para el número guardado: ${phoneNumberId}, display: ${phoneDisplay}`);
                          break; // Salir del bucle de WABAs
                        } else {
                          console.warn(`[WA Config] ⚠️ WABA ${wabaId} no tiene números que coincidan con el guardado (${savedPhoneDisplay})`);
                        }
                      } else {
                        console.log(`[WA Config] ⚠️ WABA ${wabaId} no tiene phone numbers configurados`);
                      }
                    } else {
                      console.error(`[WA Config] ❌ Error obteniendo phone numbers de WABA ${wabaId}: ${phoneNumbersResponse.status} - ${phoneNumbersText.substring(0, 500)}`);
                    }
                  } catch (err) {
                    console.error(`[WA Config] ⚠️ Error obteniendo phone numbers de WABA ${wabaId}:`, err.message);
                  }
                }
                
                // Si ya encontramos el número, salir del bucle de businesses
                if (phoneNumberId) {
                  break;
                }
              } else {
                console.error(`[WA Config] ❌ Error obteniendo WABA de business ${business.id}: ${wabaDirectResponse.status} - ${wabaDirectText.substring(0, 500)}`);
              }
            } catch (err) {
              console.error(`[WA Config] ⚠️ Error obteniendo WABA de business ${business.id}:`, err.message);
            }
          }
        } else {
          console.error(`[WA Config] ❌ Error de API de Meta /me/businesses: ${businessResponse.status} - ${businessResponseText.substring(0, 500)}`);
        }
      } catch (err) {
        console.error(`[WA Config] ⚠️ Error obteniendo businesses:`, err.message, err.stack);
      }
    }

    if (!phoneNumberId) {
      // Obtener lista de números disponibles para el mensaje de error
      let availableNumbers = [];
      try {
        const businessResponse = await fetch(
          `https://graph.facebook.com/${WA_API_VERSION}/me/businesses?fields=id,name`,
          {
            headers: {
              Authorization: `Bearer ${hub.accessToken}`,
            },
          }
        );
        if (businessResponse.ok) {
          const businessData = await businessResponse.json();
          const businesses = businessData.data || [];
          for (const business of businesses) {
            try {
              const wabaResponse = await fetch(
                `https://graph.facebook.com/${WA_API_VERSION}/${business.id}/owned_whatsapp_business_accounts?fields=id`,
                {
                  headers: {
                    Authorization: `Bearer ${hub.accessToken}`,
                  },
                }
              );
              if (wabaResponse.ok) {
                const wabaData = await wabaResponse.json();
                const wabas = wabaData.data || [];
                for (const waba of wabas) {
                  const phoneResponse = await fetch(
                    `https://graph.facebook.com/${WA_API_VERSION}/${waba.id}/phone_numbers?fields=display_phone_number,code_verification_status`,
                    {
                      headers: {
                        Authorization: `Bearer ${hub.accessToken}`,
                      },
                    }
                  );
                  if (phoneResponse.ok) {
                    const phoneData = await phoneResponse.json();
                    availableNumbers.push(...(phoneData.data || []));
                  }
                }
              }
            } catch {}
          }
        }
      } catch {}
      
      const numbersList = availableNumbers.length > 0 
        ? `\n\nNúmeros disponibles en tu cuenta:\n${availableNumbers.map(p => `  - ${p.display_phone_number}${p.code_verification_status === "VERIFIED" ? " (Verificado)" : ""}`).join("\n")}\n\nActualizá el número guardado a uno de estos números y volvé a intentar.`
        : "";
      
      throw new Error(`No se encontró un Phone Number ID para el número guardado (${savedPhoneDisplay}).${numbersList}\n\nVerificá que el número esté correctamente configurado y verificado en Meta Business Manager con la misma cuenta que autorizaste en OAuth.`);
    }

    // Guardar el phone_number_id obtenido
    await upsertTenantWhatsAppCredentials(tenantId, {
      phoneNumberId: phoneNumberId,
      accessToken: hub.accessToken,
      refreshToken: hub.refreshToken,
      tokenExpiresAt: hub.tokenExpiresAt,
      verifyToken: hub.verifyToken,
      phoneDisplay: phoneDisplay || hub.phoneDisplay || null,
      isActive: hub.isActive !== false,
      managedBy: hub.managedBy || "user_oauth",
      managedNotes: "Phone_number_id obtenido automáticamente desde la API de Meta",
    });

    console.log(`[WA Config] ✅ Phone_number_id actualizado automáticamente para tenant ${tenantId}: ${phoneNumberId}`);

    return {
      ok: true,
      phoneNumberId,
      phoneDisplay: phoneDisplay || hub.phoneDisplay || null,
    };
  } catch (e) {
    console.error(`[WA Config] Error obteniendo phone_number_id para tenant ${tenantId}:`, e.message);
    throw e;
  }
}

// Endpoint para obtener phone_number_id manualmente
config.post("/whatsapp/refresh-phone-id", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const result = await refreshPhoneNumberIdForTenant(tenantId);
    res.json(result);
  } catch (e) {
    console.error("[POST /api/config/whatsapp/refresh-phone-id] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

config.post("/whatsapp/test", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const { to, message } = req.body || {};
    if (!to || !message) {
      return res.status(400).json({ ok: false, error: "to y message son requeridos" });
    }

    const hub = await getTenantWhatsAppHub(tenantId);
    // Permitir enviar si hay credenciales completas O bien si hay OAuth token
    // El bot se activa automáticamente cuando hay credenciales OAuth válidas
    const hasOAuthCredentials = hub && hub.accessToken && hub.managedBy === "user_oauth";
    const isActiveOrAutoActivated = hub?.isActive || hasOAuthCredentials;
    const canSend = hub && (hub.hasCredentials || hasOAuthCredentials) && isActiveOrAutoActivated;
    
    if (!canSend) {
      return res.status(409).json({
        ok: false,
        error: "La integración de WhatsApp no está configurada. Conectá tu cuenta de WhatsApp Business primero.",
      });
    }

    const sanitizedTo = normalizeTo(to);
    if (!sanitizedTo) {
      return res.status(400).json({ ok: false, error: "Número de destino inválido" });
    }

    await sendWhatsAppText(sanitizedTo, message, tenantId);

    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/config/whatsapp/test] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * DELETE /api/config/whatsapp/disconnect
 * Desconecta la cuenta de WhatsApp Business eliminando todas las credenciales
 */
config.delete("/whatsapp/disconnect", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const { clearTenantWhatsAppCredentials } = await import("../services/whatsappHub.js");
    await clearTenantWhatsAppCredentials(tenantId);

    console.log(`[WA Config] ✅ Credenciales de WhatsApp eliminadas para tenant ${tenantId}`);

    res.json({ ok: true, message: "WhatsApp desconectado correctamente" });
  } catch (e) {
    console.error("[DELETE /api/config/whatsapp/disconnect] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/config/whatsapp/connect
 * Inicia el flujo OAuth de Meta/Facebook para conectar WhatsApp Business
 * El usuario solo necesita autorizar, el sistema obtiene automáticamente:
 * - access_token
 * - phone_number_id
 */
config.get("/whatsapp/connect", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    // Verificar que estén configuradas las credenciales de la app de Meta
    if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
      return res.status(500).json({
        ok: false,
        error: "Configuración de Meta App incompleta. Contactá a soporte.",
      });
    }

    const [[tenant]] = await pool.query("SELECT id, subdomain FROM tenant WHERE id = ?", [tenantId]);
    if (!tenant) {
      return res.status(404).json({ ok: false, error: "Tenant no encontrado" });
    }

    // Generar state para seguridad (similar a MP OAuth)
    const state = Buffer.from(
      JSON.stringify({
        tenantId: tenant.id,
        tenantSlug: tenant.subdomain,
        ts: Date.now(),
      })
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // Construir URL de autorización de Meta
    const redirectUri = `${process.env.API_URL || process.env.BACKEND_URL || baseUrlFromReq(req)}/api/config/whatsapp/callback`;
    
    const authUrl = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    authUrl.searchParams.set("client_id", process.env.META_APP_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("scope", "whatsapp_business_messaging");
    authUrl.searchParams.set("response_type", "code");

    // Guardar state temporalmente (en producción usar Redis o similar)
    // Por ahora usamos un Map en memoria
    if (!global.waOAuthStates) global.waOAuthStates = new Map();
    global.waOAuthStates.set(state, {
      tenantId,
      expAt: Date.now() + 10 * 60 * 1000, // 10 minutos
    });

    console.log(`[WA OAuth] Iniciando flujo OAuth para tenant ${tenantId}`);
    console.log(`[WA OAuth] Redirect URI: ${redirectUri}`);

    res.json({
      ok: true,
      authUrl: authUrl.toString(),
      redirect_uri: redirectUri,
    });
  } catch (e) {
    console.error("[GET /api/config/whatsapp/connect] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

function baseUrlFromReq(req) {
  const envBase =
    process.env.API_URL ||
    process.env.BACKEND_URL ||
    process.env.SERVER_URL ||
    process.env.BASE_URL;
  if (envBase) return String(envBase).replace(/\/+$/, "");
  const proto =
    (req.headers["x-forwarded-proto"] &&
      String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
    req.protocol ||
    "https";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

// Endpoints de configuración manual eliminados - Solo se usa OAuth

// POST /api/config/platform-subscription/create
config.post("/platform-subscription/create", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const { plan, payerEmail: requestPayerEmail } = req.body || {};
    if (!plan) {
      return res.status(400).json({ ok: false, error: "Plan requerido" });
    }

    const planDef = getPlanDefinition(plan);
    if (!planDef) {
      return res.status(400).json({ ok: false, error: "Plan inválido" });
    }

    // Verificar si ya existe una suscripción activa
    const [[activeSubscription]] = await pool.query(
      `SELECT id, plan_code, plan_label, status, mp_status, activated_at
       FROM platform_subscription
       WHERE tenant_id = ? AND status = 'authorized'
       ORDER BY activated_at DESC
       LIMIT 1`,
      [tenantId]
    );

    if (activeSubscription) {
      return res.status(409).json({
        ok: false,
        error: "Ya tenés una suscripción activa",
        message: `Ya tenés una suscripción activa al plan "${activeSubscription.plan_label}". Para cambiar de plan, contactá a nuestro equipo de ventas.`,
        existingSubscription: {
          id: activeSubscription.id,
          plan: activeSubscription.plan_label,
          status: activeSubscription.status,
          activatedAt: activeSubscription.activated_at,
        },
        requiresContact: true,
      });
    }

    // Verificar token de Mercado Pago de la plataforma
    const PLATFORM_MP_TOKEN =
      process.env.MP_ACCESS_TOKEN ||
      process.env.PLATFORM_MP_TOKEN ||
      "";
    
    if (!PLATFORM_MP_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "Plataforma sin token de Mercado Pago configurado",
      });
    }

    // Obtener información del tenant
    const [[tenantRow]] = await pool.query(
      `SELECT id, subdomain, name FROM tenant WHERE id = ? LIMIT 1`,
      [tenantId]
    );

    if (!tenantRow) {
      return res.status(404).json({ ok: false, error: "Tenant no encontrado" });
    }

    const tenantSlug = tenantRow.subdomain;
    const userEmail = req.user?.email;

    // Usar el email del pagador proporcionado en el request, o el email del usuario como fallback
    // Mercado Pago requiere que el email del pagador coincida con payer_email
    const payerEmail = requestPayerEmail || userEmail;
    
    if (!payerEmail) {
      return res.status(400).json({ ok: false, error: "Email del pagador requerido" });
    }

    // Cancelar suscripciones pendientes existentes antes de crear una nueva
    // Esto asegura que no haya conflictos con suscripciones que tienen payer_email configurado
    try {
      const [pendingSubs] = await pool.query(
        `SELECT id, mp_preapproval_id, status 
         FROM platform_subscription 
         WHERE tenant_id = ? AND status IN ('pending', 'paused') AND mp_preapproval_id IS NOT NULL
         ORDER BY created_at DESC`,
        [tenantId]
      );

      if (pendingSubs.length > 0) {
        console.log(`[PLATFORM_SUBSCRIPTION] Cancelando ${pendingSubs.length} suscripción(es) pendiente(s) antes de crear nueva`);
        
        for (const sub of pendingSubs) {
          try {
            const cancelResp = await fetch(
              `https://api.mercadopago.com/preapproval/${sub.mp_preapproval_id}`,
              {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${PLATFORM_MP_TOKEN}`,
                },
                body: JSON.stringify({ status: "cancelled" }),
              }
            );

            if (cancelResp.ok) {
              await pool.query(
                `UPDATE platform_subscription 
                 SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
                 WHERE id = ?`,
                [sub.id]
              );
              console.log(`[PLATFORM_SUBSCRIPTION] Suscripción ${sub.id} cancelada exitosamente`);
            } else {
              const cancelData = await cancelResp.json().catch(() => ({}));
              console.warn(`[PLATFORM_SUBSCRIPTION] No se pudo cancelar suscripción ${sub.id}:`, cancelData);
            }
          } catch (cancelError) {
            console.error(`[PLATFORM_SUBSCRIPTION] Error cancelando suscripción ${sub.id}:`, cancelError.message);
            // Continuar con el proceso aunque falle la cancelación
          }
        }
      }
    } catch (cleanupError) {
      console.error("[PLATFORM_SUBSCRIPTION] Error limpiando suscripciones pendientes:", cleanupError.message);
      // Continuar con la creación de la nueva suscripción aunque falle la limpieza
    }

    // Construir URLs de retorno (éxito y fallo)
    const FRONTEND_BASE =
      process.env.FRONTEND_URL_HTTPS ||
      process.env.FRONTEND_URL ||
      "";
    
    const backUrl = FRONTEND_BASE
      ? `${FRONTEND_BASE}/${tenantSlug}/subscription/success`
      : undefined;
    
    const failureUrl = FRONTEND_BASE
      ? `${FRONTEND_BASE}/${tenantSlug}/subscription/failure`
      : undefined;

    // Crear preapproval en Mercado Pago
    // Usamos el email del pagador proporcionado - Mercado Pago requiere que coincida con el email del pagador
    const body = {
      payer_email: payerEmail, // Email del pagador - debe coincidir con el email usado para pagar
      reason: planDef.label,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: Number(planDef.amount),
        currency_id: planDef.currency || "ARS",
      },
      back_url: backUrl,
      status: "pending",
      external_reference: `tenant:${tenantId}:plan:${planDef.code}`,
    };
    
    // Agregar URL de fallo si está disponible
    if (failureUrl) {
      body.failure_url = failureUrl;
    }

    const fetch = (await import("node-fetch")).default;
    const mpResp = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PLATFORM_MP_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    const rawText = await mpResp.text();
    let mpData;
    try {
      mpData = rawText ? JSON.parse(rawText) : {};
    } catch {
      mpData = rawText;
    }

    if (!mpResp.ok || !mpData?.init_point) {
      console.error("[PLATFORM_SUBSCRIPTION] Mercado Pago error:", mpResp.status, mpData);
      return res.status(502).json({
        ok: false,
        error: mpData?.message || mpData?.error || "No se pudo crear la suscripción en Mercado Pago",
        details: mpData,
      });
    }

    // Normalizar status
    function normalizeMpStatus(status) {
      const normalized = String(status || "").toLowerCase();
      if (["authorized", "approved", "active"].includes(normalized)) return "authorized";
      if (["paused", "suspended"].includes(normalized)) return "paused";
      if (["cancelled", "canceled", "cancelled_by_user"].includes(normalized)) return "cancelled";
      return "pending";
    }

    const normalizedStatus = normalizeMpStatus(mpData.status || "pending");
    const nextCharge =
      mpData.auto_recurring?.next_payment_date
        ? new Date(mpData.auto_recurring.next_payment_date)
        : null;
    const lastPayment =
      mpData.auto_recurring?.last_payment_date
        ? new Date(mpData.auto_recurring.last_payment_date)
        : null;
    const activatedAt = normalizedStatus === "authorized" ? new Date() : null;

    // Guardar en la base de datos
    await pool.query(
      `INSERT INTO platform_subscription
        (tenant_id, plan_code, plan_label, currency, amount,
         mp_preapproval_id, mp_init_point, mp_status, status, payer_email, created_at, updated_at, activated_at, last_payment_at, next_charge_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?)`,
      [
        tenantId,
        planDef.code,
        planDef.label,
        planDef.currency || "ARS",
        planDef.amount,
        mpData.id || null,
        mpData.init_point || mpData.sandbox_init_point || null,
        mpData.status || "pending",
        normalizedStatus,
        payerEmail, // Guardamos el email genérico usado
        activatedAt,
        lastPayment,
        nextCharge,
      ]
    );

    res.json({
      ok: true,
      init_point: mpData.init_point || mpData.sandbox_init_point,
      plan: planDef,
    });
  } catch (error) {
    console.error("[POST /api/config/platform-subscription/create] error:", error);
    res.status(500).json({ ok: false, error: error.message || "Error creando suscripción" });
  }
});

config.post("/subscription/manual-charge", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const { plan_code } = req.body || {};

    const [[currentSubscription]] = await pool.query(
      `SELECT plan_code, plan_label, currency, amount, payer_email
       FROM platform_subscription
       WHERE tenant_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId]
    );

    const planDef = getPlanDefinition(plan_code || currentSubscription?.plan_code);
    const resolvedPlan = {
      code: planDef.code,
      label: currentSubscription?.plan_label || planDef.label,
      currency: currentSubscription?.currency || planDef.currency || "ARS",
      amount:
        currentSubscription?.amount != null
          ? Number(currentSubscription.amount)
          : planDef.amount,
    };

    const now = new Date();
    const nextCharge = new Date(now);
    nextCharge.setMonth(nextCharge.getMonth() + 1);

    const payerEmail = req.user?.email || currentSubscription?.payer_email || null;
    const notes = "Pago manual registrado desde configuración";

    await pool.query(
      `INSERT INTO platform_subscription
        (tenant_id, plan_code, plan_label, currency, amount, status, mp_status, payer_email, activated_at, last_payment_at, next_charge_at, notes)
       VALUES (?, ?, ?, ?, ?, 'authorized', 'manual', ?, ?, ?, ?, ?)`,
      [
        tenantId,
        resolvedPlan.code,
        resolvedPlan.label,
        resolvedPlan.currency,
        resolvedPlan.amount,
        payerEmail,
        now,
        now,
        nextCharge,
        notes,
      ]
    );

    await pool.query(
      `UPDATE tenant
       SET subscription_status = 'active'
       WHERE id = ?`,
      [tenantId]
    );

    res.json({
      ok: true,
      data: {
        plan: {
          ...resolvedPlan,
          status: "authorized",
          mp_status: "manual",
          payer_email: payerEmail,
          activated_at: now,
          last_payment_at: now,
          next_charge_at: nextCharge,
        },
      },
    });
  } catch (error) {
    console.error("[POST /api/config/subscription/manual-charge] error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 🔹 POST /api/config/feature-request
config.post("/feature-request", async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const { name, email, phone, company, requestedFeatures, message, planCode, currentPlan, currentPlanLabel } = req.body;

    if (!name || !email) {
      return res.status(400).json({ ok: false, error: "Nombre y email son requeridos" });
    }

    // Validar que al menos una funcionalidad esté seleccionada
    const hasSelectedFeature = requestedFeatures && Object.values(requestedFeatures).some((val) => val === true);
    if (!hasSelectedFeature) {
      return res.status(400).json({ ok: false, error: "Seleccioná al menos una funcionalidad" });
    }

    // Obtener información del tenant
    const [tenantRows] = await pool.query("SELECT name FROM tenant WHERE id = ?", [tenantId]);
    const tenantName = tenantRows[0]?.name || "Sin nombre";

    // Construir lista de funcionalidades solicitadas
    const featureLabels = {
      appointments: "Turnos individuales",
      classes: "Turnos de clases",
      stock: "Gestión de stock",
      invoicing: "Facturación",
    };
    const requestedFeaturesList = Object.entries(requestedFeatures)
      .filter(([_, selected]) => selected === true)
      .map(([key, _]) => featureLabels[key] || key)
      .join(", ");

    // Guardar la solicitud en la base de datos (puedes crear una tabla para esto o usar system_config)
    const requestData = {
      tenant_id: tenantId,
      tenant_name: tenantName,
      name,
      email,
      phone: phone || null,
      company: company || null,
      requested_features: JSON.stringify(requestedFeatures),
      requested_features_list: requestedFeaturesList,
      plan_code: planCode || null,
      current_plan: currentPlan || null,
      current_plan_label: currentPlanLabel || null,
      message: message || null,
      created_at: new Date(),
    };

    // Guardar en system_config como un log de solicitudes
    const configKey = `feature_request.${Date.now()}`;
    await pool.query(
      `INSERT INTO system_config (tenant_id, config_key, config_value) VALUES (?, ?, ?)`,
      [tenantId, configKey, JSON.stringify(requestData)]
    );

    // Opcional: Enviar notificación por email o WhatsApp al equipo de ventas
    // Aquí podrías integrar con un servicio de email o WhatsApp

    console.log(`[FEATURE REQUEST] Nueva solicitud de ${name} (${email}) para tenant ${tenantId}: ${requestedFeaturesList}`);

    res.json({
      ok: true,
      message: "Solicitud enviada correctamente. Nuestro equipo de ventas te contactará pronto.",
    });
  } catch (error) {
    console.error("[POST /api/config/feature-request] error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * PUT /api/config/tenant/business-code
 * Actualizar el código del negocio para la app móvil (diferente del subdomain)
 */
config.put("/tenant/business-code", async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { business_code } = req.body;

    if (!business_code || typeof business_code !== 'string' || !business_code.trim()) {
      return res.status(400).json({
        ok: false,
        error: "El código del negocio es requerido",
      });
    }

    // Validar formato: solo letras, números y guiones, mínimo 3 caracteres
    const codeRegex = /^[a-z0-9-]{3,}$/;
    const normalizedCode = business_code.trim().toLowerCase();
    
    if (!codeRegex.test(normalizedCode)) {
      return res.status(400).json({
        ok: false,
        error: "El código del negocio solo puede contener letras, números y guiones, y debe tener al menos 3 caracteres",
      });
    }

    // Verificar que el código no esté en uso por otro tenant
    const [existing] = await pool.query(
      `SELECT id FROM tenant WHERE business_code = ? AND id != ? AND status = 'active'`,
      [normalizedCode, tenantId]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Este código ya está en uso por otro negocio",
      });
    }

    // Intentar actualizar el campo business_code
    // Si el campo no existe, se creará automáticamente con ALTER TABLE
    try {
      await pool.query(
        `UPDATE tenant SET business_code = ? WHERE id = ?`,
        [normalizedCode, tenantId]
      );
    } catch (error) {
      // Si el campo no existe, crearlo
      if (error.code === 'ER_BAD_FIELD_ERROR' && error.sqlMessage?.includes("Unknown column 'business_code'")) {
        console.log("[PUT /api/config/tenant/business-code] Campo business_code no existe, creándolo...");
        try {
          await pool.query(
            `ALTER TABLE tenant ADD COLUMN business_code VARCHAR(100) NULL AFTER subdomain`
          );
          console.log("[PUT /api/config/tenant/business-code] Campo business_code creado exitosamente");
          
          // Reintentar la actualización
          await pool.query(
            `UPDATE tenant SET business_code = ? WHERE id = ?`,
            [normalizedCode, tenantId]
          );
        } catch (alterError) {
          console.error("[PUT /api/config/tenant/business-code] Error creando columna business_code:", alterError);
          return res.status(500).json({ 
            ok: false, 
            error: "Error al crear columna business_code. Por favor, ejecuta la migración manualmente.",
            migrationSql: "ALTER TABLE tenant ADD COLUMN business_code VARCHAR(100) NULL AFTER subdomain;"
          });
        }
      } else {
        throw error;
      }
    }

    console.log(`[PUT /api/config/tenant/business-code] Business code actualizado para tenant ${tenantId}: ${normalizedCode}`);

    return res.json({
      ok: true,
      data: {
        business_code: normalizedCode,
        message: "Código del negocio actualizado correctamente",
      },
    });
  } catch (error) {
    console.error("[PUT /api/config/tenant/business-code] Error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Error al actualizar el código del negocio",
    });
  }
});

/**
 * GET /api/config/tenant/business-code
 * Obtener el código del negocio para la app móvil
 */
config.get("/tenant/business-code", async (req, res) => {
  try {
    const tenantId = req.tenant_id;

    // Intentar obtener el business_code
    try {
      const [rows] = await pool.query(
        `SELECT business_code FROM tenant WHERE id = ? LIMIT 1`,
        [tenantId]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          ok: false,
          error: "Tenant no encontrado",
        });
      }

      return res.json({
        ok: true,
        data: {
          business_code: rows[0].business_code || null,
        },
      });
    } catch (error) {
      // Si el campo no existe, retornar null
      if (error.code === 'ER_BAD_FIELD_ERROR' && error.sqlMessage?.includes("Unknown column 'business_code'")) {
        return res.json({
          ok: true,
          data: {
            business_code: null,
          },
        });
      }
      throw error;
    }
  } catch (error) {
    console.error("[GET /api/config/tenant/business-code] Error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Error al obtener el código del negocio",
    });
  }
});

/**
 * PUT /api/config/tenant/subdomain
 * Actualizar el subdomain (código) del tenant
 */
config.put("/tenant/subdomain", async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { subdomain } = req.body;

    if (!subdomain || typeof subdomain !== 'string' || !subdomain.trim()) {
      return res.status(400).json({
        ok: false,
        error: "El código del negocio es requerido",
      });
    }

    // Validar formato: solo letras, números y guiones, mínimo 3 caracteres
    const subdomainRegex = /^[a-z0-9-]{3,}$/;
    const normalizedSubdomain = subdomain.trim().toLowerCase();
    
    if (!subdomainRegex.test(normalizedSubdomain)) {
      return res.status(400).json({
        ok: false,
        error: "El código del negocio solo puede contener letras, números y guiones, y debe tener al menos 3 caracteres",
      });
    }

    // Verificar que el subdomain no esté en uso por otro tenant
    const [existing] = await pool.query(
      `SELECT id FROM tenant WHERE subdomain = ? AND id != ? AND status = 'active'`,
      [normalizedSubdomain, tenantId]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Este código ya está en uso por otro negocio",
      });
    }

    // Actualizar el subdomain
    await pool.query(
      `UPDATE tenant SET subdomain = ? WHERE id = ?`,
      [normalizedSubdomain, tenantId]
    );

    console.log(`[PUT /api/config/tenant/subdomain] Subdomain actualizado para tenant ${tenantId}: ${normalizedSubdomain}`);

    return res.json({
      ok: true,
      data: {
        subdomain: normalizedSubdomain,
        message: "Código del negocio actualizado correctamente",
      },
    });
  } catch (error) {
    console.error("[PUT /api/config/tenant/subdomain] Error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Error al actualizar el código del negocio",
    });
  }
});
