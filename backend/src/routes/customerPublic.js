// src/routes/customerPublic.js — Endpoints PÚBLICOS para clientes (app móvil)
import { Router } from "express";
import { pool } from "../db.js";

export const customerPublic = Router();

/** Normaliza teléfono a solo dígitos */
function normPhone(p) {
  return String(p || "").replace(/\D/g, "");
}

/**
 * GET /api/public/customer/tenant/:code
 * Verifica que un tenant existe y está activo (por código)
 */
customerPublic.get("/tenant/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    
    if (!code) {
      return res.status(400).json({ ok: false, error: "Código de negocio requerido" });
    }

    // Buscar tenant por código (puede ser ID numérico, subdomain o business_code)
    let tenant;
    
    // Intentar como ID numérico
    if (/^\d+$/.test(code)) {
      const [rowsById] = await pool.query(
        `SELECT id, name, subdomain, status, business_code
         FROM tenant 
         WHERE id = ? AND status = 'active' 
         LIMIT 1`,
        [parseInt(code, 10)]
      );
      tenant = rowsById[0];
    }
    
    // Si no se encontró, intentar como business_code (código para app móvil)
    if (!tenant) {
      try {
        const [rowsByBusinessCode] = await pool.query(
          `SELECT id, name, subdomain, status, business_code
           FROM tenant 
           WHERE business_code = ? AND status = 'active' 
           LIMIT 1`,
          [code.toLowerCase()]
        );
        tenant = rowsByBusinessCode[0];
      } catch (error) {
        // Si el campo business_code no existe, ignorar el error
        if (error.code !== 'ER_BAD_FIELD_ERROR') {
          throw error;
        }
      }
    }
    
    // Si no se encontró, intentar como subdomain/slug
    if (!tenant) {
      const [rowsBySlug] = await pool.query(
        `SELECT id, name, subdomain, status, business_code
         FROM tenant 
         WHERE subdomain = ? AND status = 'active' 
         LIMIT 1`,
        [code]
      );
      tenant = rowsBySlug[0];
    }

    if (!tenant) {
      return res.status(404).json({ 
        ok: false, 
        error: "Negocio no encontrado o inactivo" 
      });
    }

    res.json({
      ok: true,
      data: {
        id: tenant.id,
        name: tenant.name,
        code: tenant.subdomain || String(tenant.id),
      },
    });
  } catch (error) {
    console.error("[GET /api/public/customer/tenant/:code] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/public/customer/tenant/:tenantId/features
 * Obtiene las features habilitadas para un tenant (para la app móvil)
 */
customerPublic.get("/tenant/:tenantId/features", async (req, res) => {
  console.log(`[GET /api/public/customer/tenant/:tenantId/features] ═══════════════════════════════════════`);
  console.log(`[GET /api/public/customer/tenant/:tenantId/features] REQUEST RECIBIDO`);
  console.log(`[GET /api/public/customer/tenant/:tenantId/features] Params:`, req.params);
  console.log(`[GET /api/public/customer/tenant/:tenantId/features] Query:`, req.query);
  console.log(`[GET /api/public/customer/tenant/:tenantId/features] Headers:`, req.headers);
  try {
    const tenantId = parseInt(req.params.tenantId, 10);
    
    console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Iniciando búsqueda de tenant`);
    console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Base de datos: ${process.env.DB_NAME || 'NO CONFIGURADO'}`);
    console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Host: ${process.env.DB_HOST || 'NO CONFIGURADO'}`);
    
    if (!tenantId || isNaN(tenantId)) {
      return res.status(400).json({ ok: false, error: "tenant_id inválido" });
    }

    // Verificar que el tenant existe (sin restricción de status para permitir más flexibilidad)
    let tenantRows;
    try {
      [tenantRows] = await pool.query(
        `SELECT id, name, status FROM tenant WHERE id = ? LIMIT 1`,
        [tenantId]
      );
    } catch (dbError) {
      console.error(`[GET /api/public/customer/tenant/${tenantId}/features] Error de conexión a BD:`, {
        code: dbError.code,
        errno: dbError.errno,
        message: dbError.message,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
      });
      return res.status(503).json({ 
        ok: false, 
        error: "Servicio temporalmente no disponible. Por favor, intenta más tarde." 
      });
    }
    const tenant = tenantRows[0];

    console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Resultado de búsqueda:`, {
      rowsFound: tenantRows.length,
      tenant: tenant ? { id: tenant.id, name: tenant.name, status: tenant.status } : null,
      query: `SELECT id, name, status FROM tenant WHERE id = ${tenantId} LIMIT 1`,
    });
    
    // También verificar si hay algún tenant en la base de datos
    const [allTenants] = await pool.query(`SELECT id, name, status FROM tenant LIMIT 5`);
    console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Tenants disponibles (primeros 5):`, allTenants.map(t => ({ id: t.id, name: t.name, status: t.status })));

    if (!tenant) {
      console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Tenant ${tenantId} no encontrado en la BD`);
      return res.status(404).json({ ok: false, error: "Negocio no encontrado" });
    }

    // Log para debugging
    console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Tenant encontrado:`, {
      id: tenant.id,
      name: tenant.name,
      status: tenant.status,
    });

    // Verificar si tiene membresías habilitadas (si tiene al menos un plan activo)
    const [membershipRows] = await pool.query(
      `SELECT COUNT(*) as count FROM membership_plan WHERE tenant_id = ? AND is_active = 1 LIMIT 1`,
      [tenantId]
    );
    const has_memberships = (membershipRows[0]?.count || 0) > 0;

    // Verificar si tiene clases habilitadas
    // Primero verificar features_config del tenant
    let has_classes = false;
    try {
      console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Verificando clases...`);
      // Verificar en features_config del tenant
      const [tenantConfig] = await pool.query(
        `SELECT features_config FROM tenant WHERE id = ? LIMIT 1`,
        [tenantId]
      );
      
      console.log(`[GET /api/public/customer/tenant/${tenantId}/features] features_config raw:`, tenantConfig[0]?.features_config);
      
      if (tenantConfig[0]?.features_config) {
        try {
          const featuresConfig = typeof tenantConfig[0].features_config === 'string' 
            ? JSON.parse(tenantConfig[0].features_config) 
            : tenantConfig[0].features_config;
          
          console.log(`[GET /api/public/customer/tenant/${tenantId}/features] features_config parsed:`, featuresConfig);
          console.log(`[GET /api/public/customer/tenant/${tenantId}/features] features_config.classes:`, featuresConfig?.classes);
          
          if (featuresConfig && featuresConfig.classes === true) {
            has_classes = true;
            console.log(`[GET /api/public/customer/tenant/${tenantId}/features] ✅ Clases habilitadas por features_config`);
          }
        } catch (parseError) {
          console.warn(`[GET /api/public/customer/tenant/${tenantId}/features] Error parseando features_config:`, parseError.message);
        }
      }
      
      // Si no está en features_config, verificar si tiene sesiones de clases activas
      if (!has_classes) {
        console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Verificando sesiones de clases...`);
        try {
          const [classesRows] = await pool.query(
            `SELECT COUNT(*) as count FROM class_session WHERE tenant_id = ? AND status = 'scheduled' AND starts_at >= NOW() LIMIT 1`,
            [tenantId]
          );
          const count = classesRows[0]?.count || 0;
          console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Sesiones futuras encontradas: ${count}`);
          has_classes = count > 0;
          if (has_classes) {
            console.log(`[GET /api/public/customer/tenant/${tenantId}/features] ✅ Clases habilitadas por sesiones activas`);
          }
        } catch (classesError) {
          // Si la tabla no existe, asumir que no hay clases habilitadas
          const isTableNotExists = classesError.message?.includes("doesn't exist") || 
                                    classesError.message?.includes("Unknown table");
          if (!isTableNotExists) {
            console.warn(`[GET /api/public/customer/tenant/${tenantId}/features] Error al consultar class_session:`, classesError.message);
          }
        }
      }
      
      // También verificar si existe la tabla class_series (para compatibilidad)
      if (!has_classes) {
        console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Verificando class_series...`);
        try {
          const [seriesRows] = await pool.query(
            `SELECT COUNT(*) as count FROM class_series WHERE tenant_id = ? AND is_active = 1 LIMIT 1`,
            [tenantId]
          );
          const count = seriesRows[0]?.count || 0;
          console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Series activas encontradas: ${count}`);
          has_classes = count > 0;
          if (has_classes) {
            console.log(`[GET /api/public/customer/tenant/${tenantId}/features] ✅ Clases habilitadas por class_series`);
          }
        } catch (seriesError) {
          // Si la tabla no existe, no es un problema
          const isTableNotExists = seriesError.message?.includes("doesn't exist") || 
                                    seriesError.message?.includes("Unknown table");
          if (!isTableNotExists) {
            console.warn(`[GET /api/public/customer/tenant/${tenantId}/features] Error al consultar class_series:`, seriesError.message);
          }
        }
      }
      
      console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Resultado final has_classes: ${has_classes}`);
    } catch (error) {
      console.warn(`[GET /api/public/customer/tenant/${tenantId}/features] Error verificando clases:`, error.message);
      has_classes = false;
    }

    // Verificar si tiene QR scanner habilitado
    // Primero verificar en customer_app_settings (configuración de la app móvil)
    // Buscar TODOS los registros del tenant y encontrar el que tenga qr: true
    let has_qr_scanner = false;
    let qrFoundInAppSettings = false;
    try {
      const [appSettingsRows] = await pool.query(
        `SELECT notifications_json FROM customer_app_settings 
         WHERE tenant_id = ? 
         ORDER BY updated_at DESC`,
        [tenantId]
      );
      // Buscar en todos los registros del tenant hasta encontrar uno con qr: true
      for (const row of appSettingsRows) {
        if (row.notifications_json) {
          try {
            const notifications = typeof row.notifications_json === 'string' 
              ? JSON.parse(row.notifications_json) 
              : row.notifications_json;
            // Si encontramos un registro con qr: true, usarlo y salir del loop
            if (notifications?.features?.qr === true) {
              qrFoundInAppSettings = true;
              has_qr_scanner = true;
              console.log(`[GET /api/public/customer/tenant/${tenantId}/features] QR habilitado desde customer_app_settings (encontrado en registro con qr: true)`);
              break;
            } else if (notifications?.features?.qr !== undefined && !qrFoundInAppSettings) {
              // Si encontramos un registro con qr explícitamente definido (aunque sea false), marcarlo
              qrFoundInAppSettings = true;
              has_qr_scanner = notifications?.features?.qr === true;
              console.log(`[GET /api/public/customer/tenant/${tenantId}/features] QR desde customer_app_settings: ${has_qr_scanner}`);
            }
          } catch (parseError) {
            console.warn(`[GET /api/public/customer/tenant/${tenantId}/features] Error parseando notifications_json:`, parseError.message);
          }
        }
      }
    } catch (error) {
      console.warn(`[GET /api/public/customer/tenant/${tenantId}/features] Error consultando customer_app_settings para QR:`, error.message);
    }
    
    // Si no se encontró en customer_app_settings o está en false, verificar en system_config
    if (!qrFoundInAppSettings || !has_qr_scanner) {
      try {
        const [qrRows] = await pool.query(
          `SELECT config_value FROM system_config WHERE tenant_id = ? AND config_key = 'features.has_qr_scanner' LIMIT 1`,
          [tenantId]
        );
        if (qrRows.length > 0) {
          has_qr_scanner = qrRows[0]?.config_value === 'true' || qrRows[0]?.config_value === true || qrRows[0]?.config_value === '1';
          console.log(`[GET /api/public/customer/tenant/${tenantId}/features] QR desde system_config: ${has_qr_scanner}`);
          console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Valor raw de system_config:`, qrRows[0]?.config_value);
          console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Tipo de config_value:`, typeof qrRows[0]?.config_value);
          // Si se encontró en system_config y es true, priorizar ese valor sobre customer_app_settings
          if (has_qr_scanner) {
            console.log(`[GET /api/public/customer/tenant/${tenantId}/features] QR habilitado desde system_config, sobrescribiendo customer_app_settings`);
          }
        } else {
          console.log(`[GET /api/public/customer/tenant/${tenantId}/features] No se encontró configuración de QR en system_config`);
        }
      } catch (error) {
        console.warn(`[GET /api/public/customer/tenant/${tenantId}/features] Error consultando system_config para QR:`, error.message);
      }
    }
    console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Resultado final has_qr_scanner: ${has_qr_scanner}`);

    // Verificar si tiene rutinas habilitadas
    // Primero verificar en customer_app_settings (configuración de la app móvil)
    let has_routines = false;
    try {
      const [appSettingsRows] = await pool.query(
        `SELECT notifications_json FROM customer_app_settings 
         WHERE tenant_id = ? 
         ORDER BY updated_at DESC 
         LIMIT 1`,
        [tenantId]
      );
      if (appSettingsRows.length > 0 && appSettingsRows[0].notifications_json) {
        try {
          const notifications = typeof appSettingsRows[0].notifications_json === 'string' 
            ? JSON.parse(appSettingsRows[0].notifications_json) 
            : appSettingsRows[0].notifications_json;
          has_routines = notifications?.features?.routines === true;
          console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Rutinas desde customer_app_settings: ${has_routines}`);
        } catch (parseError) {
          console.warn(`[GET /api/public/customer/tenant/${tenantId}/features] Error parseando notifications_json:`, parseError.message);
        }
      }
    } catch (error) {
      console.warn(`[GET /api/public/customer/tenant/${tenantId}/features] Error consultando customer_app_settings para rutinas:`, error.message);
    }
    
    // Si no está en customer_app_settings, verificar en system_config o por servicios
    if (!has_routines) {
      try {
        const [routinesRows] = await pool.query(
          `SELECT config_value FROM system_config WHERE tenant_id = ? AND config_key = 'features.has_routines' LIMIT 1`,
          [tenantId]
        );
        const [servicesRows] = await pool.query(
          `SELECT COUNT(*) as count FROM service WHERE tenant_id = ? LIMIT 1`,
          [tenantId]
        );
        has_routines = routinesRows[0]?.config_value === 'true' || routinesRows[0]?.config_value === true || routinesRows[0]?.config_value === '1' || (servicesRows[0]?.count || 0) > 0;
        console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Rutinas desde system_config/servicios: ${has_routines}`);
      } catch (error) {
        console.warn(`[GET /api/public/customer/tenant/${tenantId}/features] Error consultando system_config/servicios para rutinas:`, error.message);
      }
    }
    console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Resultado final has_routines: ${has_routines}`);

    const responseData = {
      tenant_id: tenantId,
      tenant_name: tenant.name,
      has_memberships,
      has_classes,
      has_qr_scanner,
      has_routines,
    };
    console.log(`[GET /api/public/customer/tenant/${tenantId}/features] Respuesta completa:`, JSON.stringify(responseData, null, 2));

    res.json({
      ok: true,
      data: responseData,
    });
  } catch (error) {
    console.error("[GET /api/public/customer/tenant/:tenantId/features] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/public/customer/identify
 * Identifica a un cliente por teléfono o DNI dentro de un tenant
 * Body: { tenant_id, phone?, dni?, name? }
 */
customerPublic.post("/identify", async (req, res) => {
  try {
    const { tenant_id, phone, dni, name } = req.body || {};

    if (!tenant_id) {
      return res.status(400).json({ ok: false, error: "tenant_id requerido" });
    }

    // Verificar que el tenant existe y está activo
    const [[tenant]] = await pool.query(
      `SELECT id, name, status FROM tenant WHERE id = ? AND status = 'active' LIMIT 1`,
      [tenant_id]
    );

    if (!tenant) {
      return res.status(404).json({ ok: false, error: "Negocio no encontrado o inactivo" });
    }

    let customer = null;

    // Buscar por teléfono
    if (phone) {
      const normalizedPhone = normPhone(phone);
      const [rowsByPhone] = await pool.query(
        `SELECT id, name, phone_e164, email, documento, tenant_id
         FROM customer 
         WHERE tenant_id = ? AND phone_e164 = ? 
         LIMIT 1`,
        [tenant_id, normalizedPhone]
      );
      customer = rowsByPhone[0];
    }

    // Si no se encontró por teléfono, buscar por DNI
    if (!customer && dni) {
      const normalizedDni = String(dni || "").trim();
      if (normalizedDni) {
        const [rowsByDni] = await pool.query(
          `SELECT id, name, phone_e164, email, documento, tenant_id
           FROM customer 
           WHERE tenant_id = ? AND documento = ? 
           LIMIT 1`,
          [tenant_id, normalizedDni]
        );
        customer = rowsByDni[0];
      }
    }

    // Si no existe, crear uno nuevo (si se proporcionó teléfono o DNI)
    if (!customer) {
      const normalizedPhone = phone ? normPhone(phone) : null;
      const normalizedDni = dni ? String(dni).trim() : null;
      const cleanName = name ? String(name).trim().slice(0, 80) : null;

      if (!normalizedPhone && !normalizedDni) {
        return res.status(400).json({
          ok: false,
          error: "Se requiere teléfono o DNI para identificar al cliente",
        });
      }

      // Crear nuevo cliente
      const insertFields = ["tenant_id"];
      const insertValues = [tenant_id];
      const updateFields = [];

      if (normalizedPhone) {
        insertFields.push("phone_e164");
        insertValues.push(normalizedPhone);
        updateFields.push("phone_e164 = VALUES(phone_e164)");
      }

      if (normalizedDni) {
        insertFields.push("documento");
        insertValues.push(normalizedDni);
        updateFields.push("documento = VALUES(documento)");
      }

      if (cleanName) {
        insertFields.push("name");
        insertValues.push(cleanName);
        updateFields.push("name = COALESCE(VALUES(name), name)");
      }

      await pool.query(
        `INSERT INTO customer (${insertFields.join(", ")})
         VALUES (${insertFields.map(() => "?").join(", ")})
         ON DUPLICATE KEY UPDATE ${updateFields.join(", ")}`,
        insertValues
      );

      // Obtener el cliente creado/actualizado
      if (normalizedPhone) {
        const [rows] = await pool.query(
          `SELECT id, name, phone_e164, email, documento, tenant_id
           FROM customer 
           WHERE tenant_id = ? AND phone_e164 = ? 
           LIMIT 1`,
          [tenant_id, normalizedPhone]
        );
        customer = rows[0];
      } else if (normalizedDni) {
        const [rows] = await pool.query(
          `SELECT id, name, phone_e164, email, documento, tenant_id
           FROM customer 
           WHERE tenant_id = ? AND documento = ? 
           LIMIT 1`,
          [tenant_id, normalizedDni]
        );
        customer = rows[0];
      }
    }

    if (!customer) {
      return res.status(500).json({
        ok: false,
        error: "Error al crear o recuperar el cliente",
      });
    }

    res.json({
      ok: true,
      data: {
        customer_id: customer.id,
        tenant_id: customer.tenant_id,
        name: customer.name,
        phone: customer.phone_e164,
        email: customer.email,
        dni: customer.documento,
        tenant_name: tenant.name,
      },
    });
  } catch (error) {
    console.error("[POST /api/public/customer/identify] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/public/customer/classes
 * Obtener clases disponibles (series) para un tenant
 * Query params: tenant_id
 */
customerPublic.get("/classes", async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    
    if (!tenantId || isNaN(tenantId)) {
      return res.status(400).json({ ok: false, error: "tenant_id requerido" });
    }

    console.log(`[GET /api/public/customer/classes] Buscando clases para tenant_id: ${tenantId}`);

    // Primero, verificar cuántas sesiones hay en total para este tenant
    const [totalSessions] = await pool.query(
      `SELECT COUNT(*) as total FROM class_session WHERE tenant_id = ?`,
      [tenantId]
    );
    console.log(`[GET /api/public/customer/classes] Total de sesiones en BD: ${totalSessions[0]?.total || 0}`);

    // Verificar sesiones con diferentes condiciones
    const [scheduledSessions] = await pool.query(
      `SELECT COUNT(*) as total FROM class_session WHERE tenant_id = ? AND status = 'scheduled'`,
      [tenantId]
    );
    console.log(`[GET /api/public/customer/classes] Sesiones con status 'scheduled': ${scheduledSessions[0]?.total || 0}`);

    const [futureSessions] = await pool.query(
      `SELECT COUNT(*) as total FROM class_session WHERE tenant_id = ? AND starts_at >= NOW()`,
      [tenantId]
    );
    console.log(`[GET /api/public/customer/classes] Sesiones futuras: ${futureSessions[0]?.total || 0}`);

    const [withSeriesId] = await pool.query(
      `SELECT COUNT(*) as total FROM class_session WHERE tenant_id = ? AND series_id IS NOT NULL AND series_id != ''`,
      [tenantId]
    );
    console.log(`[GET /api/public/customer/classes] Sesiones con series_id: ${withSeriesId[0]?.total || 0}`);

    // Obtener series de clases activas agrupadas (usa series_id si existe, si no, usa el id de la sesión como identificador único)
    // Usar LEFT JOIN para que no falle si no hay instructor
    const [series] = await pool.query(
      `SELECT 
         CASE 
           WHEN cs.series_id IS NULL OR cs.series_id = '' THEN cs.id
           ELSE cs.series_id
         END AS id,
         cs.activity_type AS name,
         cs.activity_type AS description,
         cs.instructor_id,
         i.name AS instructor_name,
         MIN(cs.starts_at) AS first_session_date
       FROM class_session cs
       LEFT JOIN instructor i ON i.id = cs.instructor_id AND i.tenant_id = cs.tenant_id
       WHERE cs.tenant_id = ?
         AND cs.status = 'scheduled'
         AND cs.starts_at >= NOW()
       GROUP BY id, cs.activity_type, cs.instructor_id, i.name
       ORDER BY first_session_date ASC`,
      [tenantId]
    );

    console.log(`[GET /api/public/customer/classes] Series encontradas: ${series.length}`);
    if (series.length > 0) {
      console.log(`[GET /api/public/customer/classes] Primera serie:`, JSON.stringify(series[0], null, 2));
    }

    res.json(series);
  } catch (error) {
    console.error("[GET /api/public/customer/classes] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/public/customer/classes/:seriesId/sessions
 * Obtener sesiones disponibles de una serie de clases
 * Query params: tenant_id
 */
customerPublic.get("/classes/:seriesId/sessions", async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    const seriesId = req.params.seriesId;
    
    if (!tenantId || isNaN(tenantId)) {
      return res.status(400).json({ ok: false, error: "tenant_id requerido" });
    }

    if (!seriesId) {
      return res.status(400).json({ ok: false, error: "seriesId requerido" });
    }

    // Obtener sesiones futuras de la serie
    const [sessions] = await pool.query(
      `SELECT 
         cs.id,
         cs.series_id AS class_series_id,
         cs.starts_at,
         cs.ends_at,
         cs.instructor_id,
         i.name AS instructor_name,
         cs.activity_type AS series_name,
         cs.capacity_max AS max_capacity,
         (
           SELECT COUNT(*)
           FROM class_enrollment ce
           WHERE ce.session_id = cs.id
             AND ce.tenant_id = cs.tenant_id
             AND ce.status IN ('reserved', 'attended')
         ) AS current_enrollments
       FROM class_session cs
       JOIN instructor i ON i.id = cs.instructor_id AND i.tenant_id = cs.tenant_id
       WHERE cs.tenant_id = ?
        AND (
             cs.series_id = ?
             OR (
               (cs.series_id IS NULL OR cs.series_id = '')
               AND cs.id = ?
             )
           )
         AND cs.status = 'scheduled'
         AND cs.starts_at >= NOW()
       ORDER BY cs.starts_at ASC`,
      [tenantId, seriesId, seriesId]
    );

    res.json(sessions);
  } catch (error) {
    console.error("[GET /api/public/customer/classes/:seriesId/sessions] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/public/customer/classes/sessions/:sessionId/enroll
 * Inscribirse a una clase (sesión)
 * Body: { customer_id, tenant_id }
 */
customerPublic.post("/classes/sessions/:sessionId/enroll", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    const sessionId = parseInt(req.params.sessionId, 10);
    const { customer_id, tenant_id } = req.body;

    if (!sessionId || isNaN(sessionId)) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "sessionId inválido" });
    }

    if (!customer_id || !tenant_id) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "customer_id y tenant_id requeridos" });
    }

    // Verificar que la sesión existe y está disponible
    const [[session]] = await conn.query(
      `SELECT * FROM class_session 
       WHERE id = ? AND tenant_id = ? AND status = 'scheduled' 
       FOR UPDATE`,
      [sessionId, tenant_id]
    );

    if (!session) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Clase no encontrada o no disponible" });
    }

    // Verificar que la sesión no haya pasado
    if (new Date(session.starts_at) < new Date()) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "No se puede inscribir a una clase que ya pasó" });
    }

    // Verificar capacidad
    const [enrollments] = await conn.query(
      `SELECT COUNT(*) AS count 
       FROM class_enrollment 
       WHERE session_id = ? AND tenant_id = ? AND status IN ('reserved', 'attended')`,
      [sessionId, tenant_id]
    );

    const currentEnrollments = enrollments[0]?.count || 0;
    if (currentEnrollments >= session.capacity_max) {
      await conn.rollback();
      return res.status(409).json({ ok: false, error: "La clase ya alcanzó el cupo máximo" });
    }

    // Verificar que el customer no esté ya inscrito
    const [existing] = await conn.query(
      `SELECT id FROM class_enrollment 
       WHERE session_id = ? AND customer_id = ? AND tenant_id = ? 
       AND status IN ('reserved', 'attended')`,
      [sessionId, customer_id, tenant_id]
    );

    if (existing.length > 0) {
      await conn.rollback();
      return res.status(409).json({ ok: false, error: "Ya estás inscrito a esta clase" });
    }

    // Crear la inscripción
    const [insert] = await conn.query(
      `INSERT INTO class_enrollment (tenant_id, session_id, customer_id, status)
       VALUES (?, ?, ?, 'reserved')`,
      [tenant_id, sessionId, customer_id]
    );

    await conn.commit();

    // Obtener la inscripción creada con información de la sesión
    const [enrollmentData] = await pool.query(
      `SELECT 
         ce.id,
         ce.session_id AS class_session_id,
         ce.customer_id,
         ce.created_at AS enrolled_at,
         cs.starts_at,
         cs.ends_at,
         cs.activity_type AS series_name,
         i.name AS instructor_name
       FROM class_enrollment ce
       JOIN class_session cs ON cs.id = ce.session_id
       JOIN instructor i ON i.id = cs.instructor_id
       WHERE ce.id = ?`,
      [insert.insertId]
    );

    res.status(201).json(enrollmentData[0] || { id: insert.insertId });
  } catch (error) {
    await conn.rollback();
    console.error("[POST /api/public/customer/classes/sessions/:sessionId/enroll] Error:", error);
    
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ ok: false, error: "Ya estás inscrito a esta clase" });
    }
    
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    conn.release();
  }
});

/**
 * GET /api/public/customer/classes/enrollments
 * Obtener inscripciones del customer
 * Query params: phone?, customer_id?, tenant_id
 * Si no hay phone, usa customer_id o req.user (token de cliente)
 */
customerPublic.get("/classes/enrollments", async (req, res) => {
  try {
    const phone = normPhone(req.query.phone || "");
    const tenantId = parseInt(req.query.tenant_id, 10);
    const customerIdFromQuery = req.query.customer_id ? parseInt(req.query.customer_id, 10) : null;
    const customerIdFromToken = req.user?.type === 'customer' ? Number(req.user.id) : null;
    const customerId = customerIdFromQuery || customerIdFromToken || null;

    if ((!phone && !customerId) || !tenantId || isNaN(tenantId)) {
      return res.status(400).json({ ok: false, error: "phone o customer_id y tenant_id requeridos" });
    }

    // Resolver customer_id por teléfono si no se envió explícito
    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId && phone) {
      const [customers] = await pool.query(
        `SELECT id FROM customer WHERE tenant_id = ? AND phone_e164 = ? LIMIT 1`,
        [tenantId, phone]
      );
      if (customers.length === 0) {
        return res.json([]);
      }
      resolvedCustomerId = customers[0].id;
    }

    // Obtener inscripciones con información de la sesión
    const [enrollments] = await pool.query(
      `SELECT 
         ce.id,
         ce.session_id AS class_session_id,
         ce.customer_id,
         ce.created_at AS enrolled_at,
         cs.id AS session_id,
         cs.series_id,
         cs.starts_at,
         cs.ends_at,
         cs.activity_type AS series_name,
         i.name AS instructor_name,
         cs.capacity_max AS max_capacity,
         (
           SELECT COUNT(*)
           FROM class_enrollment ce2
           WHERE ce2.session_id = cs.id
             AND ce2.tenant_id = cs.tenant_id
             AND ce2.status IN ('reserved', 'attended')
         ) AS current_enrollments
       FROM class_enrollment ce
       JOIN class_session cs ON cs.id = ce.session_id AND cs.tenant_id = ce.tenant_id
       JOIN instructor i ON i.id = cs.instructor_id AND i.tenant_id = cs.tenant_id
      WHERE ce.customer_id = ?
         AND ce.tenant_id = ?
         AND ce.status IN ('reserved', 'attended')
       ORDER BY cs.starts_at ASC`,
      [resolvedCustomerId, tenantId]
    );

    // Formatear respuesta para que coincida con la interfaz esperada
    const formatted = enrollments.map(e => ({
      id: e.id,
      class_session_id: e.class_session_id,
      customer_id: e.customer_id,
      enrolled_at: e.enrolled_at,
      session: {
        id: e.session_id,
        class_series_id: e.series_id,
        starts_at: e.starts_at,
        ends_at: e.ends_at,
        instructor_name: e.instructor_name,
        series_name: e.series_name,
        max_capacity: e.max_capacity,
        current_enrollments: e.current_enrollments,
      },
    }));

    res.json(formatted);
  } catch (error) {
    console.error("[GET /api/public/customer/classes/enrollments] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * DELETE /api/public/customer/classes/enrollments/:enrollmentId
 * Cancelar inscripción a una clase
 * Query params: tenant_id
 */
customerPublic.delete("/classes/enrollments/:enrollmentId", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    const enrollmentId = parseInt(req.params.enrollmentId, 10);
    const tenantId = parseInt(req.query.tenant_id, 10);

    if (!enrollmentId || isNaN(enrollmentId)) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "enrollmentId inválido" });
    }

    if (!tenantId || isNaN(tenantId)) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "tenant_id requerido" });
    }

    // Verificar que la inscripción existe y pertenece al tenant
    const [[enrollment]] = await conn.query(
      `SELECT ce.*, cs.starts_at 
       FROM class_enrollment ce
       JOIN class_session cs ON cs.id = ce.session_id
       WHERE ce.id = ? AND ce.tenant_id = ? 
       FOR UPDATE`,
      [enrollmentId, tenantId]
    );

    if (!enrollment) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });
    }

    // Verificar que la clase no haya pasado (opcional, puedes permitir cancelar clases pasadas)
    // if (new Date(enrollment.starts_at) < new Date()) {
    //   await conn.rollback();
    //   return res.status(400).json({ ok: false, error: "No se puede cancelar una clase que ya pasó" });
    // }

    // Actualizar el status a 'cancelled' en lugar de eliminar
    await conn.query(
      `UPDATE class_enrollment 
       SET status = 'cancelled', cancelled_at = NOW() 
       WHERE id = ? AND tenant_id = ?`,
      [enrollmentId, tenantId]
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    console.error("[DELETE /api/public/customer/classes/enrollments/:enrollmentId] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    conn.release();
  }
});

/**
 * GET /api/public/customer/appointments
 * Obtener turnos del cliente
 * Query params: tenant_id, customer_id? (opcional si viene del token)
 */
customerPublic.get("/appointments", async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    const customerIdFromQuery = req.query.customer_id ? parseInt(req.query.customer_id, 10) : null;
    const customerIdFromToken = req.user?.type === 'customer' ? Number(req.user.id) : null;
    const customerId = customerIdFromQuery || customerIdFromToken;
    const onlyActive = String(req.query.only_active || req.query.active_only || "false") === "true";

    if (!tenantId || isNaN(tenantId)) {
      return res.status(400).json({ ok: false, error: "tenant_id requerido" });
    }

    if (!customerId) {
      return res.status(400).json({ ok: false, error: "customer_id requerido o token de cliente" });
    }

    let sql = `
      SELECT 
         a.id,
         a.customer_id,
         a.service_id,
         a.instructor_id,
         a.starts_at,
         a.ends_at,
         a.status,
         a.deposit_decimal,
         a.deposit_paid_at,
         a.hold_until,
         a.created_at,
         s.name AS service_name,
         s.price_decimal AS service_price,
         i.name AS instructor_name,
         i.color_hex AS instructor_color
       FROM appointment a
       INNER JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
       INNER JOIN instructor i ON i.id = a.instructor_id AND i.tenant_id = a.tenant_id
       WHERE a.tenant_id = ? AND a.customer_id = ?`;
    const params = [tenantId, customerId];

    if (onlyActive) {
      sql += `
        AND (
          a.status IN ('scheduled','confirmed','deposit_paid')
          OR (a.status = 'pending_deposit' AND a.deposit_paid_at IS NULL AND (a.hold_until IS NULL OR a.hold_until >= NOW()))
        )`;
    }

    sql += ` ORDER BY a.starts_at DESC LIMIT 100`;

    const [appointments] = await pool.query(sql, params);

    res.json(appointments);
  } catch (error) {
    console.error("[GET /api/public/customer/appointments] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/public/customer/appointments
 * Crear nuevo turno
 * Body: { service_id, instructor_id, starts_at, tenant_id, customer_id? }
 */
customerPublic.post("/appointments", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { service_id, instructor_id, starts_at, tenant_id, customer_id: customerIdFromBody } = req.body;
    const customerIdFromToken = req.user?.type === 'customer' ? Number(req.user.id) : null;
    const customerId = customerIdFromBody || customerIdFromToken;
    const tenantId = parseInt(tenant_id, 10);

    if (!service_id || !instructor_id || !starts_at || !tenantId) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "service_id, instructor_id, starts_at y tenant_id requeridos" });
    }

    if (!customerId) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "customer_id requerido o token de cliente" });
    }

    // Verificar que el servicio existe y está activo
    const [serviceRows] = await conn.query(
      `SELECT id, duration_min, price_decimal FROM service WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1`,
      [service_id, tenantId]
    );
    const service = serviceRows[0];
    if (!service) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Servicio no encontrado o inactivo" });
    }

    // Verificar que el instructor existe y está activo
    const [instructorRows] = await conn.query(
      `SELECT id, branch_id FROM instructor WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1`,
      [instructor_id, tenantId]
    );
    const instructor = instructorRows[0];
    if (!instructor) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Instructor no encontrado o inactivo" });
    }

    // Calcular fecha de fin
    const startDate = new Date(starts_at);
    if (Number.isNaN(startDate.getTime())) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Fecha/hora inválida" });
    }
    const durationMin = Number(service.duration_min || 30);
    const endDate = new Date(startDate.getTime() + durationMin * 60000);

    // Verificar que no haya solapamiento
    const [overlaps] = await conn.query(
      `SELECT 1 FROM appointment
       WHERE tenant_id = ? AND instructor_id = ?
       AND status IN ('scheduled', 'confirmed', 'deposit_paid', 'pending_deposit')
       AND (starts_at < ? AND ends_at > ?)
       LIMIT 1`,
      [tenantId, instructor_id, endDate, startDate]
    );

    if (overlaps.length > 0) {
      await conn.rollback();
      return res.status(409).json({ ok: false, error: "El horario seleccionado no está disponible" });
    }

    // Verificar si el cliente está exento de seña
    const [customerRows] = await conn.query(
      `SELECT exempt_deposit FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [customerId, tenantId]
    );
    const customer = customerRows[0] || {};
    const isExemptDeposit = customer?.exempt_deposit === 1 || customer?.exempt_deposit === true;

    // Determinar status inicial
    let status = 'scheduled';
    let depositDecimal = 0;

    // Si no está exento, verificar si requiere seña
    if (!isExemptDeposit) {
      const [requireDepositRows] = await conn.query(
        `SELECT config_value FROM system_config WHERE tenant_id = ? AND config_key = 'payments.require_deposit' LIMIT 1`,
        [tenantId]
      );
      const requireDepositRow = requireDepositRows[0] || {};
      const requireDeposit = requireDepositRow?.config_value === "1" || requireDepositRow?.config_value === "true";

      if (requireDeposit) {
        const [modeRows] = await conn.query(
          `SELECT config_value FROM system_config WHERE tenant_id = ? AND config_key = 'payments.deposit_mode' LIMIT 1`,
          [tenantId]
        );
        const modeRow = modeRows[0] || {};
        const depositMode = String(modeRow?.config_value || "percent").toLowerCase();

        if (depositMode === "fixed") {
          const [fixedRows] = await conn.query(
            `SELECT config_value FROM system_config WHERE tenant_id = ? AND config_key = 'payments.deposit_fixed' LIMIT 1`,
            [tenantId]
          );
          const fixedRow = fixedRows[0] || {};
          depositDecimal = Number(fixedRow?.config_value || 0);
        } else {
          const [pctRows] = await conn.query(
            `SELECT config_value FROM system_config WHERE tenant_id = ? AND config_key = 'payments.deposit_percent' LIMIT 1`,
            [tenantId]
          );
          const pctRow = pctRows[0] || {};
          const pct = Number(pctRow?.config_value || 20);
          depositDecimal = Math.round(Number(service.price_decimal || 0) * pct) / 100;
        }

        if (depositDecimal > 0) {
          status = 'pending_deposit';
        }
      }
    }

    // Obtener branch_id del instructor o usar la sucursal principal
    let branchId = instructor.branch_id;
    if (!branchId) {
      const [primaryBranchRows] = await conn.query(
        `SELECT id FROM tenant_branch WHERE tenant_id = ? ORDER BY id ASC LIMIT 1`,
        [tenantId]
      );
      const primaryBranch = primaryBranchRows[0] || {};
      branchId = primaryBranch?.id || null;
    }

    // Insertar turno
    const [insert] = await conn.query(
      `INSERT INTO appointment 
       (tenant_id, branch_id, customer_id, instructor_id, service_id, starts_at, ends_at, status, deposit_decimal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, branchId, customerId, instructor_id, service_id, startDate, endDate, status, depositDecimal]
    );

    // Si requiere seña, fijar vencimiento (hold_until) en 30 minutos desde ahora
    if (status === 'pending_deposit' && Number(depositDecimal) > 0) {
      await conn.query(
        `UPDATE appointment 
            SET hold_until = DATE_ADD(NOW(), INTERVAL 30 MINUTE)
          WHERE id = ?`,
        [insert.insertId]
      );
    }

    await conn.commit();

    // Obtener el turno creado con información completa
    const [appointmentRows] = await pool.query(
      `SELECT 
         a.id,
         a.customer_id,
         a.service_id,
         a.created_at,
         a.instructor_id,
         a.starts_at,
         a.ends_at,
         a.status,
         a.deposit_decimal,
         a.deposit_paid_at,
         a.hold_until,
         s.name AS service_name,
         i.name AS instructor_name
       FROM appointment a
       INNER JOIN service s ON s.id = a.service_id
       INNER JOIN instructor i ON i.id = a.instructor_id
       WHERE a.id = ?`,
      [insert.insertId]
    );
    const appointment = appointmentRows[0] || {};
    
    // Asegurar que deposit_decimal esté en la respuesta
    appointment.deposit_decimal = depositDecimal;

    res.status(201).json({ ok: true, data: appointment, requiresDeposit: depositDecimal > 0 });
  } catch (error) {
    await conn.rollback();
    console.error("[POST /api/public/customer/appointments] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    conn.release();
  }
});

/**
 * DELETE /api/public/customer/appointments/:id
 * Cancelar turno
 */
customerPublic.delete("/appointments/:id", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const appointmentId = parseInt(req.params.id, 10);
    const tenantId = parseInt(req.query.tenant_id, 10);
    const customerIdFromToken = req.user?.type === 'customer' ? Number(req.user.id) : null;
    const customerIdFromQuery = req.query.customer_id ? parseInt(req.query.customer_id, 10) : null;
    const customerId = customerIdFromQuery || customerIdFromToken;

    if (!appointmentId || isNaN(appointmentId)) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "ID de turno inválido" });
    }

    if (!tenantId || isNaN(tenantId)) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "tenant_id requerido" });
    }

    if (!customerId) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "customer_id requerido o token de cliente" });
    }

    // Verificar que el turno pertenece al cliente
    const [appointmentRows] = await conn.query(
      `SELECT id, status FROM appointment 
       WHERE id = ? AND tenant_id = ? AND customer_id = ? LIMIT 1`,
      [appointmentId, tenantId, customerId]
    );
    const appointment = appointmentRows[0];

    if (!appointment) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Turno no encontrado" });
    }

    if (appointment.status === 'cancelled') {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "El turno ya está cancelado" });
    }

    // Cancelar el turno
    await conn.query(
      `UPDATE appointment SET status = 'cancelled' WHERE id = ? AND tenant_id = ?`,
      [appointmentId, tenantId]
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    console.error("[DELETE /api/public/customer/appointments/:id] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/public/customer/appointments/cleanup
 * Elimina de la lista del cliente los turnos cancelados y los vencidos sin seña pagada
 * Body: { tenant_id, customer_id? } o token de cliente
 */
customerPublic.post("/appointments/cleanup", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = parseInt(req.body.tenant_id, 10);
    const customerIdFromToken = req.user?.type === 'customer' ? Number(req.user.id) : null;
    const customerIdFromBody = req.body.customer_id ? parseInt(req.body.customer_id, 10) : null;
    const customerId = customerIdFromBody || customerIdFromToken;

    if (!tenantId || isNaN(tenantId)) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "tenant_id requerido" });
    }
    if (!customerId) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "customer_id requerido o token de cliente" });
    }

    const [delCancelled] = await conn.query(
      `DELETE FROM appointment 
         WHERE tenant_id = ? AND customer_id = ? AND status = 'cancelled'`,
      [tenantId, customerId]
    );

    const [delExpired] = await conn.query(
      `DELETE FROM appointment 
         WHERE tenant_id = ? AND customer_id = ?
           AND status = 'pending_deposit'
           AND deposit_paid_at IS NULL
           AND hold_until IS NOT NULL
           AND hold_until < NOW()`,
      [tenantId, customerId]
    );

    await conn.commit();
    res.json({
      ok: true,
      deleted_cancelled: delCancelled.affectedRows,
      deleted_expired_pending: delExpired.affectedRows
    });
  } catch (error) {
    await conn.rollback();
    console.error("[POST /api/public/customer/appointments/cleanup] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    conn.release();
  }
});
/**
 * GET /api/public/customer/appointments/availability
 * Obtener disponibilidad de horarios
 * Query params: tenant_id, service_id, instructor_id, date
 */
customerPublic.get("/appointments/availability", async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    const serviceId = parseInt(req.query.service_id, 10);
    const instructorId = parseInt(req.query.instructor_id, 10);
    const date = String(req.query.date || "");

    if (!tenantId || !serviceId || !instructorId || !date) {
      return res.status(400).json({ ok: false, error: "tenant_id, service_id, instructor_id y date requeridos" });
    }

    // Importar función de availability
    const { getFreeSlots } = await import("../routes/availability.js");
    const result = await getFreeSlots({ tenantId, instructorId, serviceId, date });

    res.json({ ok: true, data: { slots: result.slots, busySlots: result.busySlots } });
  } catch (error) {
    console.error("[GET /api/public/customer/appointments/availability] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/public/customer/qr/validate
 * Validar un código QR escaneado
 * Body: { qr_data: string } (JSON string del QR)
 */
customerPublic.post("/qr/validate", async (req, res) => {
  try {
    const { qr_data } = req.body;

    if (!qr_data) {
      return res.status(400).json({ 
        ok: false, 
        error: "qr_data requerido" 
      });
    }

    let qrPayload;
    try {
      qrPayload = typeof qr_data === 'string' ? JSON.parse(qr_data) : qr_data;
    } catch (parseError) {
      return res.status(400).json({ 
        ok: false, 
        error: "QR data inválido. Debe ser un JSON válido." 
      });
    }

    const { customer_id, tenant_id, phone, identifier, timestamp } = qrPayload;

    if (!customer_id || !tenant_id) {
      return res.status(400).json({ 
        ok: false, 
        error: "QR inválido: faltan customer_id o tenant_id" 
      });
    }

    // Verificar que el cliente existe y pertenece al tenant
    const [customerRows] = await pool.query(
      `SELECT id, name, phone_e164, email, tenant_id, status 
       FROM customer 
       WHERE id = ? AND tenant_id = ? 
       LIMIT 1`,
      [customer_id, tenant_id]
    );

    if (customerRows.length === 0) {
      return res.status(404).json({ 
        ok: false, 
        error: "Cliente no encontrado o no pertenece a este negocio" 
      });
    }

    const customer = customerRows[0];

    // Verificar que el teléfono coincide si está presente en el QR
    if (phone && customer.phone_e164) {
      const normalizedPhone = normPhone(customer.phone_e164);
      const qrPhone = normPhone(phone);
      if (normalizedPhone !== qrPhone) {
        console.warn(`[QR Validate] Teléfono no coincide: QR=${qrPhone}, DB=${normalizedPhone}`);
      }
    }

    // Verificar que el timestamp no sea muy antiguo (opcional: QR válido por 24 horas)
    const qrAge = Date.now() - (timestamp || 0);
    const maxAge = 24 * 60 * 60 * 1000; // 24 horas en ms
    const isExpired = qrAge > maxAge;

    return res.json({
      ok: true,
      data: {
        valid: true,
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone_e164,
        },
        tenant_id: tenant_id,
        qr_age_ms: qrAge,
        is_expired: isExpired,
        message: isExpired 
          ? "QR válido pero expirado (más de 24 horas)" 
          : "QR válido",
      },
    });
  } catch (error) {
    console.error("[POST /api/public/customer/qr/validate] Error:", error);
    return res.status(500).json({ 
      ok: false, 
      error: "Error al validar el QR" 
    });
  }
});

/**
 * POST /api/public/customer/appointments/:id/deposit-payment-link
 * Generar link de pago de seña para un turno
 * Body: { tenant_id, customer_id? }
 */
customerPublic.post("/appointments/:id/deposit-payment-link", async (req, res) => {
  try {
    const appointmentId = parseInt(req.params.id, 10);
    const tenantId = parseInt(req.body.tenant_id, 10);
    const customerIdFromToken = req.user?.type === 'customer' ? Number(req.user.id) : null;
    const customerIdFromBody = req.body.customer_id ? parseInt(req.body.customer_id, 10) : null;
    const customerId = customerIdFromBody || customerIdFromToken;

    if (!appointmentId || isNaN(appointmentId)) {
      return res.status(400).json({ ok: false, error: "ID de turno inválido" });
    }

    if (!tenantId || isNaN(tenantId)) {
      return res.status(400).json({ ok: false, error: "tenant_id requerido" });
    }

    if (!customerId) {
      return res.status(400).json({ ok: false, error: "customer_id requerido o token de cliente" });
    }

    // Verificar que el turno pertenece al cliente y tiene seña pendiente
    const [appointmentRows] = await pool.query(
      `SELECT 
         a.id,
         a.status,
         a.deposit_decimal,
         a.deposit_paid_at,
         s.name AS service_name
       FROM appointment a
       INNER JOIN service s ON s.id = a.service_id
       WHERE a.id = ? AND a.tenant_id = ? AND a.customer_id = ? LIMIT 1`,
      [appointmentId, tenantId, customerId]
    );
    const appointment = appointmentRows[0];

    if (!appointment) {
      return res.status(404).json({ ok: false, error: "Turno no encontrado" });
    }

    if (appointment.deposit_paid_at) {
      return res.status(400).json({ ok: false, error: "La seña ya fue pagada" });
    }

    if (!appointment.deposit_decimal || Number(appointment.deposit_decimal) <= 0) {
      return res.status(400).json({ ok: false, error: "Este turno no requiere seña" });
    }

    if (appointment.status !== 'pending_deposit' && appointment.status !== 'scheduled') {
      return res.status(400).json({ ok: false, error: "El turno no está en estado válido para pagar seña" });
    }

    // Importar función de creación de link de pago
    const { createDepositPaymentLink } = await import("../payments.js");
    
    const paymentLink = await createDepositPaymentLink({
      tenantId,
      appointmentId,
      amount: Number(appointment.deposit_decimal),
      title: `Seña - ${appointment.service_name}`,
      holdMinutes: 30,
    });

    // Actualizar hold_until para reflejar vencimiento real en clientes móviles
    await pool.query(
      `UPDATE appointment a
         JOIN (
           SELECT created_at 
           FROM payment 
           WHERE tenant_id = ? AND appointment_id = ? AND method = 'mercadopago'
           ORDER BY created_at DESC 
           LIMIT 1
         ) p
         SET 
           a.status = CASE WHEN a.status = 'scheduled' THEN 'pending_deposit' ELSE a.status END,
           a.hold_until = DATE_ADD(p.created_at, INTERVAL 30 MINUTE)
       WHERE a.id = ? AND a.tenant_id = ?`,
      [tenantId, appointmentId, appointmentId, tenantId]
    );

    res.json({ ok: true, paymentLink });
  } catch (error) {
    console.error("[POST /api/public/customer/appointments/:id/deposit-payment-link] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

