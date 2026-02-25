// src/routes/meta.js — MULTI-TENANT (listas para combos/selector)
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../auth/middlewares.js";
import { resolveBranchFilter } from "../helpers/branchAccess.js";

export const meta = Router();
meta.use(requireAuth);

// Middleware para verificar permisos o roles
function requireAccess(req, res, next) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ ok: false, error: "Usuario no autenticado" });
  }
  
  // Permitir tokens de cliente (customer) para leer servicios e instructores
  if (user.type === 'customer') {
    return next();
  }
  
  // Admin y user tienen acceso completo
  if (user.role === "admin" || user.role === "user") {
    return next();
  }
  
  // Para otros roles, verificar permisos de appointments
  const permissions = user.permissions || {};
  const hasAppointmentAccess = 
    permissions.appointments?.includes("appointments.read") ||
    permissions.appointments?.includes("appointments.admin") ||
    permissions.appointments?.includes("appointments.write");
  
  if (hasAppointmentAccess) {
    return next();
  }
  
  return res.status(403).json({ ok: false, error: "Acceso denegado: permisos insuficientes" });
}

meta.use(requireAccess);

/**
 * GET /api/meta/instructors?active=1
 * Lista estilistas del tenant (para selects)
 */
meta.get("/instructors", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const onlyActive = String(req.query.active || "1") === "1";
    
    // Para customer tokens, no filtrar por sucursal
    let filter = { mode: "all", branchId: null };
    if (req.user?.type !== 'customer') {
      try {
        filter = resolveBranchFilter(req, { allowAll: true });
      } catch (e) {
        // Si falla resolveBranchFilter (por ejemplo, no hay sucursal), usar "all" para customers
        if (req.user?.type === 'customer') {
          filter = { mode: "all", branchId: null };
        } else {
          throw e;
        }
      }
    }
    
    const params = [tenantId];
    let branchClause = "";
    if (filter.mode === "single") {
      branchClause = "AND branch_id = ?";
      params.push(filter.branchId);
    }
    const [rows] = await pool.query(
      `
      SELECT id, name, color_hex, is_active, branch_id, photo_url
      FROM instructor
      WHERE tenant_id = ?
        ${onlyActive ? "AND is_active = 1" : ""}
        ${branchClause}
      ORDER BY name ASC
      `,
      params
    );

    res.json({ ok:true, data: rows });
  } catch (e) {
    console.error("[GET /meta/instructors] error:", e);
    const status = Number.isInteger(e?.statusCode) ? e.statusCode : 500;
    res.status(status).json({ ok:false, error: e.message });
  }
});

/**
 * ✅ EXPORT: Helper para usar en WhatsApp bot
 * Solo devuelve instructors del tenant especificado
 * ✅ CORREGIDO: Removida columna user_id que no existe en la tabla
 */
export async function listInstructors(tenantId) {
  if (!tenantId) {
    throw new Error("tenantId requerido en listInstructors");
  }
  
  const [rows] = await pool.query(
    `SELECT id, name, is_active
     FROM instructor
     WHERE tenant_id = ? AND is_active = 1
     ORDER BY name ASC`,
    [tenantId]
  );
  
  return rows;
}

/**
 * GET /api/meta/services?active=1
 * Lista servicios del tenant (para selects)
 */
meta.get("/services", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const onlyActive = String(req.query.active || "1") === "1";
    
    // Para customer tokens, no filtrar por sucursal
    let filter = { mode: "all", branchId: null };
    if (req.user?.type !== 'customer') {
      try {
        filter = resolveBranchFilter(req, { allowAll: true });
      } catch (e) {
        // Si falla resolveBranchFilter (por ejemplo, no hay sucursal), usar "all" para customers
        if (req.user?.type === 'customer') {
          filter = { mode: "all", branchId: null };
        } else {
          throw e;
        }
      }
    }
    
    const params = [tenantId];
    let branchClause = "";
    if (filter.mode === "single") {
      branchClause = "AND branch_id = ?";
      params.push(filter.branchId);
    }
    const [rows] = await pool.query(
      `
      SELECT id, name, price_decimal, duration_min, is_active, branch_id
      FROM service
      WHERE tenant_id = ?
        ${onlyActive ? "AND is_active = 1" : ""}
        ${branchClause}
      ORDER BY name ASC
      `,
      params
    );

    res.json({ ok:true, data: rows });
  } catch (e) {
    console.error("[GET /meta/services] error:", e);
    const status = Number.isInteger(e?.statusCode) ? e.statusCode : 500;
    res.status(status).json({ ok:false, error: e.message });
  }
});

/**
 * ✅ EXPORT: Helper para usar en WhatsApp bot
 */
export async function listServices(tenantId) {
  if (!tenantId) {
    throw new Error("tenantId requerido en listServices");
  }
  
  const [rows] = await pool.query(
    `SELECT id, name, price_decimal, duration_min, is_active
     FROM service
     WHERE tenant_id = ? AND is_active = 1
     ORDER BY name ASC`,
    [tenantId]
  );
  
  return rows;
}

/**
 * GET /api/meta/customers?q=texto
 * Búsqueda rápida de clientes por nombre/teléfono
 */
meta.get("/meta/customers", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const q = (req.query.q || "").trim();
    const like = `%${q}%`;

    const [rows] = await pool.query(
      `
      SELECT id, name, phone_e164 AS phone
      FROM customer
      WHERE tenant_id = ?
        AND (name LIKE ? OR phone_e164 LIKE ?)
      ORDER BY name ASC
      LIMIT 50
      `,
      [tenantId, like, like]
    );

    res.json({ ok:true, data: rows });
  } catch (e) {
    console.error("[GET /meta/customers] error:", e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

/**
 * GET /api/meta/appointment-status
 * Lista fija de estados (por si querés poblar un select)
 */
meta.get("/meta/appointment-status", async (_req, res) => {
  res.json({
    ok: true,
    data: [
      "scheduled",
      "pending_deposit",
      "deposit_paid",
      "confirmed",
      "completed",
      "cancelled",
      "no_show"
    ]
  });
});
