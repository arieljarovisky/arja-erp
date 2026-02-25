// src/routes/customerAppSettings.js
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import { identifyTenant } from "../auth/tenant.js";
import { getTenantFeatureFlags } from "../services/tenantFeatures.js";
import { getPlanFeatureFlags } from "../services/subscriptionPlans.js";

export const customerAppSettings = Router();

// Aplicar auth + tenant en todas las rutas
customerAppSettings.use(requireAuth);
customerAppSettings.use(identifyTenant);

async function ensureMobileAppEnabled(tenantId) {
  // 1) Chequear features del plan
  let planAllowsMobile = false;
  try {
    const [[row]] = await pool.query(
      `SELECT plan_code 
       FROM platform_subscription 
       WHERE tenant_id = ? 
       ORDER BY activated_at DESC 
       LIMIT 1`,
      [tenantId]
    );
    const planCode = row?.plan_code || "starter";
    const planFeatures = getPlanFeatureFlags(planCode);
    planAllowsMobile = !!planFeatures?.mobile_app;
  } catch {
    planAllowsMobile = false;
  }

  // 2) Chequear override en features_config
  const features = await getTenantFeatureFlags(tenantId);
  const tenantOverride = features?.mobile_app;

  const enabled = tenantOverride === true || planAllowsMobile === true;
  if (!enabled) {
    const err = new Error("Funcionalidad de app móvil no habilitada para este negocio");
    err.statusCode = 403;
    throw err;
  }
}

async function ensureCustomerBelongsToTenant(tenantId, customerId) {
  const [[customer]] = await pool.query(
    `SELECT id FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [customerId, tenantId]
  );
  if (!customer) {
    const err = new Error("Cliente no pertenece a este negocio");
    err.statusCode = 404;
    throw err;
  }
}

function safeParseJSON(value) {
  try {
    if (value === null || value === undefined) return null;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch (error) {
    console.warn("[customerAppSettings] Error parseando JSON:", error.message);
    return null;
  }
}

function formatSettings(row = {}) {
  const defaultNotifications = {
    push: true,
    inApp: true,
    features: {
      routines: false,
      classes: false,
      qr: false,
      notifications: false,
    },
  };

  const parsedNotifications = safeParseJSON(row.notifications_json) || null;

  return {
    theme: safeParseJSON(row.theme_json) || null,
    pricing: safeParseJSON(row.pricing_json) || null,
    schedule: safeParseJSON(row.schedule_json) || null,
    notifications: parsedNotifications || defaultNotifications,
    logoUrl: row.logo_url || null,
    pushToken: row.push_token || null,
    updatedAt: row.updated_at || null,
  };
}

/**
 * GET /api/customers/app-settings/me
 * Cliente obtiene su configuración (tema, precios, horarios, notificaciones)
 */
customerAppSettings.get("/customers/app-settings/me", async (req, res) => {
  try {
    const tenantId = req.tenant_id || req.tenant?.id;
    const customerId = req.user?.id;

    if (!tenantId || !customerId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    await ensureMobileAppEnabled(tenantId);

    const [rows] = await pool.query(
      `SELECT theme_json, pricing_json, schedule_json, notifications_json, logo_url, push_token, updated_at
       FROM customer_app_settings
       WHERE tenant_id = ? AND customer_id = ?
       LIMIT 1`,
      [tenantId, customerId]
    );

    let settings;

    if (rows.length) {
      settings = formatSettings(rows[0]);
    } else {
      // Si el cliente no tiene registro propio, intentar usar el último registro del mismo tenant como fallback
      const [fallbackRows] = await pool.query(
        `SELECT theme_json, pricing_json, schedule_json, notifications_json, logo_url, push_token, updated_at
         FROM customer_app_settings
         WHERE tenant_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
        [tenantId]
      );
      settings = fallbackRows.length ? formatSettings(fallbackRows[0]) : formatSettings();
    }

    return res.json({ ok: true, data: settings });
  } catch (error) {
    console.error("[customerAppSettings] Error en GET /me:", error);
    return res.status(500).json({ ok: false, error: "Error al obtener configuración" });
  }
});

/**
 * GET /api/customers/:customerId/app-settings
 * Entrenadores/Admin pueden ver configuración de un cliente
 */
customerAppSettings.get(
  "/customers/:customerId/app-settings",
  requireRole("admin", "staff", "user"),
  async (req, res) => {
    try {
      const tenantId = req.tenant_id || req.tenant?.id;
      const { customerId } = req.params;

      if (!tenantId || !customerId) {
        return res.status(400).json({ ok: false, error: "Faltan parámetros" });
      }

      await ensureMobileAppEnabled(tenantId);
      await ensureCustomerBelongsToTenant(tenantId, customerId);

      const [rows] = await pool.query(
        `SELECT theme_json, pricing_json, schedule_json, notifications_json, logo_url, push_token, updated_at
         FROM customer_app_settings
         WHERE tenant_id = ? AND customer_id = ?
         LIMIT 1`,
        [tenantId, customerId]
      );

      const settings = rows.length ? formatSettings(rows[0]) : formatSettings();
      return res.json({ ok: true, data: settings });
    } catch (error) {
      console.error("[customerAppSettings] Error en GET /:customerId:", error);
      return res.status(500).json({ ok: false, error: "Error al obtener configuración" });
    }
  }
);

/**
 * PUT /api/customers/:customerId/app-settings
 * Entrenadores/Admin actualizan configuración de un cliente
 */
customerAppSettings.put(
  "/customers/:customerId/app-settings",
  requireRole("admin", "staff", "user"),
  async (req, res) => {
    try {
      const tenantId = req.tenant_id || req.tenant?.id;
      const { customerId } = req.params;
      const userId = req.user?.id || null;

      if (!tenantId || !customerId) {
        return res.status(400).json({ ok: false, error: "Faltan parámetros" });
      }

      await ensureMobileAppEnabled(tenantId);
      await ensureCustomerBelongsToTenant(tenantId, customerId);

      const { theme, pricing, schedule, notifications, logoUrl, pushToken } = req.body || {};

      // Obtener valores existentes para mantener los que no se envían
      const [existingRows] = await pool.query(
        `SELECT theme_json, pricing_json, schedule_json, notifications_json, logo_url, push_token
         FROM customer_app_settings
         WHERE tenant_id = ? AND customer_id = ?
         LIMIT 1`,
        [tenantId, customerId]
      );
      const existing = existingRows[0] || {};

      const mergedTheme = theme !== undefined ? theme : safeParseJSON(existing.theme_json);
      const mergedPricing = pricing !== undefined ? pricing : safeParseJSON(existing.pricing_json);
      const mergedSchedule = schedule !== undefined ? schedule : safeParseJSON(existing.schedule_json);
      const defaultNotifications = {
        push: true,
        inApp: true,
        features: {
          routines: false,
          classes: false,
          qr: false,
          notifications: false,
        },
      };
      const mergedNotifications =
        notifications !== undefined
          ? notifications
          : safeParseJSON(existing.notifications_json) || defaultNotifications;
      const mergedLogoUrl = logoUrl !== undefined ? logoUrl : existing.logo_url || null;
      const mergedPushToken = pushToken !== undefined ? pushToken : existing.push_token || null;

      await pool.query(
        `INSERT INTO customer_app_settings 
          (tenant_id, customer_id, theme_json, pricing_json, schedule_json, notifications_json, logo_url, push_token, updated_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           theme_json = VALUES(theme_json),
           pricing_json = VALUES(pricing_json),
           schedule_json = VALUES(schedule_json),
           notifications_json = VALUES(notifications_json),
           logo_url = VALUES(logo_url),
           push_token = VALUES(push_token),
           updated_by_user_id = VALUES(updated_by_user_id),
           updated_at = NOW()`,
        [
          tenantId,
          customerId,
          mergedTheme ? JSON.stringify(mergedTheme) : null,
          mergedPricing ? JSON.stringify(mergedPricing) : null,
          mergedSchedule ? JSON.stringify(mergedSchedule) : null,
          mergedNotifications ? JSON.stringify(mergedNotifications) : null,
          mergedLogoUrl,
          mergedPushToken,
          userId,
        ]
      );

      return res.json({
        ok: true,
        data: {
          theme: mergedTheme || null,
          pricing: mergedPricing || null,
          schedule: mergedSchedule || null,
          notifications: mergedNotifications || null,
          logoUrl: mergedLogoUrl,
          pushToken: mergedPushToken,
        },
      });
    } catch (error) {
      console.error("[customerAppSettings] Error en PUT /:customerId/app-settings:", error);
      return res.status(500).json({ ok: false, error: "Error al guardar configuración" });
    }
  }
);

/**
 * PUT /api/customers/app-settings/me/push-token
 * Cliente registra/actualiza su token push
 */
customerAppSettings.put("/customers/app-settings/me/push-token", async (req, res) => {
  try {
    const tenantId = req.tenant_id || req.tenant?.id;
    const customerId = req.user?.id;
    const { pushToken } = req.body || {};

    if (!tenantId || !customerId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    await ensureMobileAppEnabled(tenantId);

    if (!pushToken) {
      return res.status(400).json({ ok: false, error: "Falta pushToken" });
    }

    await pool.query(
      `INSERT INTO customer_app_settings (tenant_id, customer_id, push_token, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         push_token = VALUES(push_token),
         updated_at = NOW()`,
      [tenantId, customerId, pushToken]
    );

    return res.json({ ok: true, data: { pushToken } });
  } catch (error) {
    console.error("[customerAppSettings] Error en PUT /me/push-token:", error);
    return res.status(500).json({ ok: false, error: "Error al registrar token push" });
  }
});

/**
 * PUT /api/customers/app-settings/me/picture
 * Cliente actualiza su foto de perfil
 */
customerAppSettings.put("/customers/app-settings/me/picture", async (req, res) => {
  try {
    const tenantId = req.tenant_id || req.tenant?.id;
    const customerId = req.user?.id;
    const { picture } = req.body || {};

    if (!tenantId || !customerId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    await ensureMobileAppEnabled(tenantId);

    if (!picture) {
      return res.status(400).json({ ok: false, error: "Falta picture (URL de la imagen o base64)" });
    }

    // Validar que sea una URL válida o base64
    let isValid = false;
    if (picture.startsWith('http://') || picture.startsWith('https://')) {
      try {
        new URL(picture);
        isValid = true;
      } catch {
        isValid = false;
      }
    } else if (picture.startsWith('data:image/')) {
      // Es base64, validar formato
      isValid = picture.includes('base64,');
    } else {
      isValid = false;
    }

    if (!isValid) {
      return res.status(400).json({ ok: false, error: "picture debe ser una URL válida o datos base64" });
    }

    // Verificar si la columna picture existe, si no, crearla
    try {
      // Intentar actualizar la foto en la tabla customer
      await pool.query(
        `UPDATE customer SET picture = ? WHERE id = ? AND tenant_id = ?`,
        [picture, customerId, tenantId]
      );
    } catch (error) {
      // Si la columna no existe, intentar crearla
      if (error.code === 'ER_BAD_FIELD_ERROR' && error.sqlMessage?.includes("Unknown column 'picture'")) {
        console.log("[customerAppSettings] Columna picture no existe, intentando crearla...");
        try {
          await pool.query(
            `ALTER TABLE customer ADD COLUMN picture LONGTEXT NULL AFTER email`
          );
          console.log("[customerAppSettings] Columna picture creada exitosamente");
          
          // Reintentar la actualización
          await pool.query(
            `UPDATE customer SET picture = ? WHERE id = ? AND tenant_id = ?`,
            [picture, customerId, tenantId]
          );
        } catch (alterError) {
          console.error("[customerAppSettings] Error creando columna picture:", alterError);
          return res.status(500).json({ 
            ok: false, 
            error: "Error al crear columna picture. Por favor, ejecuta la migración manualmente.",
            migrationSql: "ALTER TABLE customer ADD COLUMN picture LONGTEXT NULL AFTER email;"
          });
        }
      } else if (error.code === 'ER_DATA_TOO_LONG') {
        // Si la columna existe pero es muy pequeña, intentar alterarla
        console.log("[customerAppSettings] Columna picture existe pero es muy pequeña, intentando alterarla...");
        try {
          await pool.query(
            `ALTER TABLE customer MODIFY COLUMN picture LONGTEXT NULL`
          );
          console.log("[customerAppSettings] Columna picture alterada exitosamente a LONGTEXT");
          
          // Reintentar la actualización
          await pool.query(
            `UPDATE customer SET picture = ? WHERE id = ? AND tenant_id = ?`,
            [picture, customerId, tenantId]
          );
        } catch (alterError) {
          console.error("[customerAppSettings] Error alterando columna picture:", alterError);
          return res.status(500).json({ 
            ok: false, 
            error: "Error al alterar columna picture. Por favor, ejecuta la migración manualmente.",
            migrationSql: "ALTER TABLE customer MODIFY COLUMN picture LONGTEXT NULL;"
          });
        }
      } else {
        throw error;
      }
    }

    return res.json({ ok: true, data: { picture } });
  } catch (error) {
    console.error("[customerAppSettings] Error en PUT /me/picture:", error);
    return res.status(500).json({ ok: false, error: "Error al actualizar foto de perfil" });
  }
});

/**
 * PUT /api/customers/app-settings/me/tenant-code
 * Cliente actualiza el código del negocio (subdomain)
 */
customerAppSettings.put("/customers/app-settings/me/tenant-code", async (req, res) => {
  try {
    const tenantId = req.tenant_id || req.tenant?.id;
    const customerId = req.user?.id;
    const { subdomain } = req.body || {};

    if (!tenantId || !customerId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    await ensureMobileAppEnabled(tenantId);

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

    console.log(`[customerAppSettings] Subdomain actualizado para tenant ${tenantId}: ${normalizedSubdomain}`);

    return res.json({
      ok: true,
      data: {
        subdomain: normalizedSubdomain,
        message: "Código del negocio actualizado correctamente",
      },
    });
  } catch (error) {
    console.error("[customerAppSettings] Error en PUT /me/tenant-code:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Error al actualizar el código del negocio",
    });
  }
});

export default customerAppSettings;

