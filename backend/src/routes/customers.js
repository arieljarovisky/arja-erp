// src/routes/customers.js — MULTI-TENANT
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";

export const customers = Router();
customers.use(requireAuth, requireRole("admin", "user"));

/** Normaliza teléfono a solo dígitos */
function normPhone(p) {
  return String(p || "").replace(/\D/g, "");
}

/** Trae un cliente por teléfono dentro del tenant */
export async function getCustomerByPhone(phone_e164, tenantId) {
  const phone = normPhone(phone_e164);
  const [rows] = await pool.query(
    `SELECT 
        id,
        name,
        phone_e164,
        email,
        documento,
        tipo_documento,
        domicilio,
        cuit,
        razon_social,
        condicion_iva,
        notes,
        exempt_deposit
       FROM customer 
      WHERE tenant_id = ? AND phone_e164 = ? 
      LIMIT 1`,
    [tenantId, phone]
  );
  return rows[0] || null;
}

/** Crea si no existe y/o actualiza el nombre (scoped por tenant) */
export async function upsertCustomerNameByPhone(phone_e164, name, tenantId) {
  const phone = normPhone(phone_e164);
  const cleanName = (name || "").trim().slice(0, 80) || null;

  // Requiere UNIQUE (tenant_id, phone_e164)
  await pool.query(
    `INSERT INTO customer (tenant_id, name, phone_e164)
         VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE 
         name = COALESCE(VALUES(name), name)`,
    [tenantId, cleanName, phone]
  );

  return getCustomerByPhone(phone, tenantId);
}

/* ===== Endpoints ===== */

/** GET /api/customers/by-phone/:phone - Obtiene un cliente por teléfono (debe ir antes de /:id) */
customers.get("/by-phone/:phone", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const phone = req.params.phone;
    const c = await getCustomerByPhone(phone, tenantId);
    if (!c) return res.status(404).json({ ok:false, error:"Cliente no encontrado" });
    res.json({ ok:true, data:c });
  } catch (e) {
    console.error("[GET /customers/by-phone/:phone] error:", e);
    res.status(500).json({ ok:false, error:e.message });
  }
});

/** PUT /api/customers/:phone/name  Body: { name } - Actualiza nombre por teléfono (debe ir antes de /:id) */
customers.put("/:phone/name", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const phone = req.params.phone;
    const { name } = req.body || {};
    if (!phone) return res.status(400).json({ ok:false, error:"Falta phone" });

    const c = await upsertCustomerNameByPhone(phone, name, tenantId);
    res.json({ ok: true, data: c });
  } catch (e) {
    console.error("[PUT /customers/:phone/name] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** GET /api/customers - Lista todos los clientes del tenant */
customers.get("/", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const q = (req.query.q || "").trim();
    const search = `%${q}%`;

    let sql = `
      SELECT 
        id,
        name,
        phone_e164 AS phone,
        email,
        picture,
        documento,
        tipo_documento,
        cuit,
        razon_social,
        domicilio,
        condicion_iva,
        exempt_deposit,
        created_at
      FROM customer
      WHERE tenant_id = ?
    `;
    const params = [tenantId];

    if (q) {
      sql += ` AND (name LIKE ? OR phone_e164 LIKE ? OR email LIKE ? OR cuit LIKE ?)`;
      params.push(search, search, search, search);
    }

    // Paginación mejorada
    const limit = Math.min(Number(req.query.limit) || 200, 500); // Máximo 500
    const offset = Number(req.query.offset) || 0;
    
    sql += ` ORDER BY name ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [rows] = await pool.query(sql, params);
    
    // Obtener total para paginación
    let countSql = `SELECT COUNT(*) as total FROM customer WHERE tenant_id = ?`;
    const countParams = [tenantId];
    if (q) {
      countSql += ` AND (name LIKE ? OR phone_e164 LIKE ? OR email LIKE ? OR cuit LIKE ?)`;
      countParams.push(search, search, search, search);
    }
    const [[{ total }]] = await pool.query(countSql, countParams);
    
    res.setHeader("X-Total-Count", total);
    res.json({ ok: true, data: rows, pagination: { limit, offset, total } });
  } catch (e) {
    console.error("[GET /customers] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** PUT /api/customers/:id - Actualiza los datos del cliente */
customers.put("/:id(\\d+)", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    const allowed = {
      name: (value) => (value ?? "").trim() || null,
      phone: (value) => {
        if (value === null) return null;
        const normalized = normPhone(value);
        return normalized || null;
      },
      email: (value) => (value ?? "").trim() || null,
      documento: (value) => (value ?? "").trim() || null,
      tipo_documento: (value) => (value ?? "").trim() || null,
      cuit: (value) => (value ?? "").trim() || null,
      razon_social: (value) => (value ?? "").trim() || null,
      domicilio: (value) => (value ?? "").trim() || null,
      condicion_iva: (value) => (value ?? "").trim() || null,
      notes: (value) => (value ?? "").trim() || null,
      exempt_deposit: (value) => value === true || value === 1 || value === "1" ? 1 : 0,
    };

    const updates = [];
    const values = [];

    for (const [key, transformer] of Object.entries(allowed)) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        const column = key === "phone" ? "phone_e164" : key;
        updates.push(`${column} = ?`);
        values.push(transformer(req.body[key]));
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: "Sin campos para actualizar" });
    }

    values.push(id, tenantId);

    const [result] = await pool.query(
      `UPDATE customer SET ${updates.join(", " )} WHERE id = ? AND tenant_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
    }

    const [rows] = await pool.query(
      `SELECT 
        id,
        name,
        phone_e164 AS phone,
        email,
        picture,
        documento,
        tipo_documento,
        cuit,
        razon_social,
        domicilio,
        condicion_iva,
        notes,
        exempt_deposit,
        created_at
      FROM customer
      WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    console.error("[PUT /customers/:id] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** GET /api/customers/:id - Obtiene un cliente por ID (debe ir al final para no capturar otras rutas) */
customers.get("/:id(\\d+)", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    const [rows] = await pool.query(
      `SELECT 
        id,
        name,
        phone_e164 AS phone,
        email,
        picture,
        documento,
        tipo_documento,
        cuit,
        razon_social,
        domicilio,
        condicion_iva,
        notes,
        exempt_deposit,
        created_at
      FROM customer
      WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
    }

    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    console.error("[GET /customers/:id] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
