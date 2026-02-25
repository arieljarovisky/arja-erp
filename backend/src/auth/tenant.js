// src/middleware/tenant.js
/**
 * ═══════════════════════════════════════════════════════════
 * TENANT MIDDLEWARE - Multi-Tenancy Security
 * ═══════════════════════════════════════════════════════════
 * 
 * Asegura que cada peluquería solo vea sus propios datos.
 * CRÍTICO: Sin esto, las peluquerías podrían ver datos de otras.
 */

import { pool } from "../db.js";
import jwt from "jsonwebtoken";

/**
 * Extrae el tenant_id del request
 * Prioridad:
 * 1. JWT (más seguro)
 * 2. Subdomain (www.peluqueria1.tusistema.com)
 * 3. Header X-Tenant-ID (para APIs externas)
 */
export async function identifyTenant(req, res, next) {
  try {
    let tenantId = null;
    let tenant = null;

    // Desde JWT
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const decoded = jwt.decode(token);
        if (decoded?.tenant_id) {
          tenantId = Number(decoded.tenant_id);
        }
      } catch {
        // Token inválido
      }
    }

    // Desde header
    if (!tenantId && req.headers['x-tenant-id']) {
      tenantId = Number(req.headers['x-tenant-id']);
    }

    if (tenantId) {
      const [[t]] = await pool.query(
        'SELECT id, subdomain, status FROM tenant WHERE id = ? LIMIT 1',
        [tenantId]
      );
      tenant = t;
    }

    // ✅ IMPORTANTE: Agregar tanto tenant_id como tenant al request
    req.tenant_id = tenantId;
    req.tenantId = tenantId; // Alias
    req.tenant = tenant;

    next();
  } catch (err) {
    console.error('[TENANT] Error:', err);
    res.status(500).json({
      ok: false,
      error: 'Error al identificar tenant'
    });
  }
}

/**
 * Middleware que requiere tenant (usar después de identifyTenant)
 */
export function requireTenant(req, res, next) {
  // Si no fue seteado por identifyTenant, intentar completarlo desde el token o header
  if (!req.tenant_id) {
    const tokenTenantId = req.user?.tenant_id ? Number(req.user.tenant_id) : null;
    const headerTenantId = req.headers['x-tenant-id'] ? Number(req.headers['x-tenant-id']) : null;
    req.tenant_id = tokenTenantId || headerTenantId || null;
  }

  if (!req.tenant_id) {
    return res.status(403).json({
      ok: false,
      error: 'Tenant requerido'
    });
  }
  next();
}

/**
 * Middleware para super admin (gestiona todos los tenants)
 */
export function requireSuperAdmin(req, res, next) {
  if (!req.user?.is_super_admin) {
    return res.status(403).json({
      ok: false,
      error: 'Solo super admin'
    });
  }
  next();
}

/**
 * Helper: Extraer subdomain del hostname
 */
function extractSubdomain(req) {
  const hostname = req.hostname || req.headers.host?.split(':')[0] || '';
  
  // localhost → null
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return null;
  }

  // peluqueria1.tusistema.com → peluqueria1
  const parts = hostname.split('.');
  if (parts.length >= 3) {
    return parts[0];
  }

  return null;
}

/**
 * Helper: Verificar límites del plan
 */
export async function checkPlanLimit(tenantId, limitType) {
  try {
    // Obtener límites del plan actual
    const [[subscription]] = await pool.query(
      `SELECT sp.* 
       FROM subscription s
       JOIN subscription_plan sp ON sp.id = s.plan_id
       WHERE s.tenant_id = ? 
       ORDER BY s.created_at DESC 
       LIMIT 1`,
      [tenantId]
    );

    if (!subscription) {
      return { allowed: false, reason: 'Sin suscripción activa' };
    }

    const features = JSON.parse(subscription.features || '[]');

    // Verificar feature
    if (limitType === 'facturacion' && !features.includes('facturacion')) {
      return {
        allowed: false,
        reason: 'Facturación no disponible en tu plan',
        upgrade: true
      };
    }

    // Verificar límites numéricos
    if (limitType === 'instructors') {
      const maxInstructors = subscription.max_instructors;
      if (maxInstructors !== null) {
        const [[{ count }]] = await pool.query(
          'SELECT COUNT(*) as count FROM instructor WHERE tenant_id = ? AND is_active = TRUE',
          [tenantId]
        );
        if (count >= maxInstructors) {
          return {
            allowed: false,
            reason: `Límite de ${maxInstructors} peluqueros alcanzado`,
            current: count,
            max: maxInstructors,
            upgrade: true
          };
        }
      }
    }

    if (limitType === 'appointments') {
      const maxAppointments = subscription.max_appointments_month;
      if (maxAppointments !== null) {
        const [[{ count }]] = await pool.query(
          `SELECT COUNT(*) as count 
           FROM appointment 
           WHERE tenant_id = ? 
           AND YEAR(starts_at) = YEAR(NOW()) 
           AND MONTH(starts_at) = MONTH(NOW())`,
          [tenantId]
        );
        if (count >= maxAppointments) {
          return {
            allowed: false,
            reason: `Límite de ${maxAppointments} turnos/mes alcanzado`,
            current: count,
            max: maxAppointments,
            upgrade: true
          };
        }
      }
    }

    return { allowed: true };
  } catch (err) {
    console.error('[CHECK_LIMIT] Error:', err);
    return { allowed: true }; // Fail open (permitir en caso de error)
  }
}

/**
 * Middleware para verificar feature
 */
export function requireFeature(featureName) {
  return async (req, res, next) => {
    const check = await checkPlanLimit(req.tenant_id, featureName);
    if (!check.allowed) {
      return res.status(403).json({
        ok: false,
        error: check.reason,
        upgrade_required: check.upgrade || false
      });
    }
    next();
  };
}

/**
 * Helper: Obtener configuración del tenant
 */
export async function getTenantSettings(tenantId) {
  const [[tenant]] = await pool.query(
    `SELECT * FROM tenant WHERE id = ?`,
    [tenantId]
  );

  const [[settings]] = await pool.query(
    `SELECT * FROM tenant_settings WHERE tenant_id = ?`,
    [tenantId]
  );

  return {
    ...tenant,
    ...settings
  };
}

/**
 * Middleware para agregar configuración del tenant al request
 */
export async function loadTenantSettings(req, res, next) {
  if (!req.tenant_id) {
    return next();
  }

  try {
    const settings = await getTenantSettings(req.tenant_id);
    req.tenant_settings = settings;
    next();
  } catch (err) {
    console.error('[TENANT_SETTINGS] Error:', err);
    next(); // Continue sin settings
  }
}

/**
 * Helper: Query seguro con tenant_id automático
 */
export function createTenantQuery(req) {
  const tenantId = req.tenant_id;
  
  return {
    // SELECT con tenant_id automático
    query: async (sql, params = []) => {
      // Agregar tenant_id a WHERE si no existe
      if (!sql.toLowerCase().includes('tenant_id')) {
        if (sql.toLowerCase().includes('where')) {
          sql = sql.replace(/WHERE/i, 'WHERE tenant_id = ? AND');
          params = [tenantId, ...params];
        } else if (sql.toLowerCase().includes('from')) {
          sql = sql.replace(/FROM\s+(\w+)/i, 'FROM $1 WHERE tenant_id = ?');
          params = [tenantId, ...params];
        }
      }
      return pool.query(sql, params);
    },
    
    // INSERT con tenant_id automático
    insert: async (table, data) => {
      data.tenant_id = tenantId;
      const keys = Object.keys(data);
      const values = Object.values(data);
      const placeholders = keys.map(() => '?').join(',');
      
      const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;
      return pool.query(sql, values);
    },
    
    // UPDATE con tenant_id automático
    update: async (table, data, whereClause, whereParams = []) => {
      const sets = Object.keys(data).map(k => `${k} = ?`).join(',');
      const values = Object.values(data);
      
      const sql = `UPDATE ${table} SET ${sets} WHERE tenant_id = ? AND ${whereClause}`;
      return pool.query(sql, [...values, tenantId, ...whereParams]);
    }
  };
}

/**
 * Helper: Verificar si el trial expiró basado en created_at del tenant
 */
async function isTrialExpired(tenantId) {
  try {
    const [[tenantRow]] = await pool.query(
      `SELECT status, created_at 
       FROM tenant 
       WHERE id = ? 
       LIMIT 1`,
      [tenantId]
    );

    if (!tenantRow || tenantRow.status !== 'trial') {
      return false;
    }

    if (!tenantRow.created_at) {
      return false;
    }

    const createdDate = new Date(tenantRow.created_at);
    const now = new Date();
    const trialEndDate = new Date(createdDate);
    trialEndDate.setDate(trialEndDate.getDate() + 14); // 14 días de trial

    return now > trialEndDate;
  } catch (err) {
    console.error('[IS_TRIAL_EXPIRED] Error:', err);
    return false;
  }
}

/**
 * Verificar suscripción activa
 * MODIFICADO: Permite acceso cuando trial expira pero marca el request para bloqueo en frontend
 */
export async function requireActiveSubscription(req, res, next) {
  try {
    if (req.user?.is_super_admin) {
      return next();
    }
    // Verificar si el trial expiró basado en created_at
    const trialExpired = await isTrialExpired(req.tenant_id);
    if (trialExpired) {
      // Marcar en el request para que el frontend pueda bloquear funcionalidades
      req.trial_expired = true;
      req.trial_expired_reason = 'Trial expirado. Suscribite para continuar usando el sistema.';
      // Permitir acceso pero el frontend bloqueará funcionalidades
      return next();
    }

    let legacySub = null;
    try {
      const [[legacyRow]] = await pool.query(
        `SELECT status, current_period_end 
         FROM subscription 
         WHERE tenant_id = ? 
         ORDER BY created_at DESC 
         LIMIT 1`,
        [req.tenant_id]
      );
      legacySub = legacyRow || null;
    } catch (err) {
      if (err?.code !== "ER_NO_SUCH_TABLE") {
        throw err;
      }
    }

    if (legacySub) {
      if (legacySub.status === 'cancelled') {
        return res.status(402).json({
          ok: false,
          error: 'Suscripción cancelada',
          action: 'resubscribe'
        });
      }

      if (legacySub.status === 'past_due') {
        return res.status(402).json({
          ok: false,
          error: 'Pago pendiente. Actualizá el método de pago.',
          action: 'update_payment'
        });
      }

      // Si el trial expiró en la suscripción legacy, permitir acceso pero marcar
      if (legacySub.status === 'trial' && new Date(legacySub.current_period_end) < new Date()) {
        req.trial_expired = true;
        req.trial_expired_reason = 'Trial expirado. Suscribite para continuar usando el sistema.';
        return next();
      }

      return next();
    }

    const [[platformSub]] = await pool.query(
      `SELECT status, mp_status 
       FROM platform_subscription 
       WHERE tenant_id = ? 
       ORDER BY id DESC 
       LIMIT 1`,
      [req.tenant_id]
    );

    if (platformSub) {
      const status = platformSub.status || 'pending';
      if (status === 'authorized' || status === 'pending') {
        return next();
      }

      if (status === 'paused') {
        return res.status(402).json({
          ok: false,
          error: 'Suscripción pausada. Reanudála desde Mercado Pago.',
          action: 'resume'
        });
      }

      if (status === 'cancelled') {
        return res.status(402).json({
          ok: false,
          error: 'Suscripción cancelada.',
          action: 'resubscribe'
        });
      }

      return res.status(402).json({
        ok: false,
        error: 'Suscripción con errores. Revisá la configuración de Mercado Pago.',
        action: 'contact_support'
      });
    }

    const [[tenantRow]] = await pool.query(
      `SELECT status, created_at 
       FROM tenant 
       WHERE id = ? 
       LIMIT 1`,
      [req.tenant_id]
    );

    // Si está en trial y no expiró, permitir acceso
    if (tenantRow?.status === 'trial') {
      return next();
    }

    // Si no tiene suscripción y no está en trial, requerir suscripción
    if (!tenantRow || tenantRow.status !== 'trial') {
      return res.status(402).json({
        ok: false,
        error: 'Sin suscripción activa',
        action: 'subscribe'
      });
    }

    return next();
  } catch (err) {
    console.error('[SUBSCRIPTION_CHECK] Error:', err);
    next(); // Fail open
  }
}

export default {
  identifyTenant,
  requireTenant,
  requireSuperAdmin,
  requireFeature,
  loadTenantSettings,
  checkPlanLimit,
  getTenantSettings,
  createTenantQuery,
  requireActiveSubscription
};
