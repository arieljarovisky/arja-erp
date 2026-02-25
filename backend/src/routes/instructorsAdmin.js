import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import { resolveBranchFilter, resolveBranchForWrite, isAdminUser } from "../helpers/branchAccess.js";

const instructorsAdmin = Router();
instructorsAdmin.use(requireAuth, requireRole("admin"));

async function ensureInstructorPhotoColumn() {
  try {
    await pool.query(`ALTER TABLE instructor ADD COLUMN photo_url MEDIUMTEXT NULL`);
  } catch (e) {
    // Ignorar si ya existe
  }
  try {
    await pool.query(`ALTER TABLE instructor MODIFY COLUMN photo_url MEDIUMTEXT NULL`);
  } catch (e) {
    // Ignorar si no se puede modificar (ya correcto)
  }
}

async function ensureInstructorPhoneColumn() {
  try {
    await pool.query(`ALTER TABLE instructor ADD COLUMN phone_e164 VARCHAR(32) NULL`);
  } catch (e) {
    // Ignorar si ya existe
  }
}

function sanitizeColorHex(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  if (/^[0-9A-Fa-f]{6}$/.test(trimmed)) return `#${trimmed.toUpperCase()}`;
  return null;
}

function normalizeIdArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function buildBranchClause(alias, filter) {
  if (!filter || filter.mode === "all") {
    return { clause: "", params: [] };
  }
  return {
    clause: `AND ${alias}.branch_id = ?`,
    params: [filter.branchId],
  };
}

function sendError(res, err, fallbackMessage) {
  const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  res.status(status).json({ ok: false, error: err?.message || fallbackMessage });
}

async function validateServiceOwnership(conn, tenantId, serviceIds, branchId) {
  if (!serviceIds.length) return;
  const placeholders = serviceIds.map(() => "?").join(",");
  const params = [tenantId, ...serviceIds];
  const [rows] = await conn.query(
    `SELECT id, branch_id FROM service WHERE tenant_id = ? AND id IN (${placeholders})`,
    params
  );
  if (rows.length !== serviceIds.length) {
    throw new Error("Algunos servicios no pertenecen al tenant.");
  }
  if (branchId) {
    const mismatch = rows.find((row) => Number(row.branch_id) !== Number(branchId));
    if (mismatch) {
      throw new Error("Los servicios seleccionados pertenecen a otra sucursal.");
    }
  }
}

async function validateInstructorOwnership(conn, tenantId, instructorIds, branchId) {
  if (!instructorIds.length) return;
  const placeholders = instructorIds.map(() => "?").join(",");
  const params = [tenantId, ...instructorIds];
  const [rows] = await conn.query(
    `SELECT id, branch_id FROM instructor WHERE tenant_id = ? AND id IN (${placeholders})`,
    params
  );
  if (rows.length !== instructorIds.length) {
    throw new Error("Algunos instructores no pertenecen al tenant.");
  }
  if (branchId) {
    const mismatch = rows.find((row) => Number(row.branch_id) !== Number(branchId));
    if (mismatch) {
      throw new Error("Los instructores seleccionados pertenecen a otra sucursal.");
    }
  }
}

instructorsAdmin.get("/instructors", async (req, res) => {
  try {
    await ensureInstructorPhotoColumn();
    await ensureInstructorPhoneColumn();
    const tenantId = req.tenant.id;
    const filter = resolveBranchFilter(req, { allowAll: true });
    const baseParams = [tenantId];
    const branchClause = buildBranchClause("ins", filter);
    const [instructors] = await pool.query(
      `
      SELECT ins.id,
             ins.name,
             ins.color_hex,
             ins.is_active,
             ins.branch_id,
             ins.photo_url,
             ins.phone_e164,
             tb.name AS branch_name
        FROM instructor ins
        LEFT JOIN tenant_branch tb
          ON tb.id = ins.branch_id
       WHERE ins.tenant_id = ?
       ${branchClause.clause}
       ORDER BY ins.name ASC, ins.id ASC
      `,
      [...baseParams, ...branchClause.params]
    );

    const linkClause = buildBranchClause("isvc", filter);
    const [serviceLinks] = await pool.query(
      `
      SELECT isvc.instructor_id, isvc.service_id, svc.name
        FROM instructor_service isvc
        JOIN service svc
          ON svc.id = isvc.service_id
         AND svc.tenant_id = isvc.tenant_id
       WHERE isvc.tenant_id = ?
       ${linkClause.clause}
      `,
      [...baseParams, ...linkClause.params]
    );

    const servicesByInstructor = new Map();
    serviceLinks.forEach((row) => {
      if (!servicesByInstructor.has(row.instructor_id)) {
        servicesByInstructor.set(row.instructor_id, []);
      }
      servicesByInstructor.get(row.instructor_id).push({
        id: Number(row.service_id),
        name: row.name,
      });
    });

    const data = instructors.map((row) => {
      const services = servicesByInstructor.get(row.id) || [];
      return {
        id: Number(row.id),
        name: row.name,
        colorHex: row.color_hex,
        isActive: row.is_active === 1,
        branchId: row.branch_id ? Number(row.branch_id) : null,
        branchName: row.branch_name || null,
        photoUrl: row.photo_url || null,
        phoneE164: row.phone_e164 || null,
        services,
        serviceIds: services.map((svc) => svc.id),
      };
    });

    res.json({ ok: true, data });
  } catch (err) {
    console.error("❌ [GET /api/admin/instructors] ERROR:", err);
    sendError(res, err, "No se pudieron obtener los instructores");
  }
});

instructorsAdmin.post("/instructors", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureInstructorPhotoColumn();
    await ensureInstructorPhoneColumn();
    const tenantId = req.tenant.id;
    const { name, colorHex, isActive = true, serviceIds = [], branchId, photoUrl, phoneE164 } = req.body || {};

    if (!name || !String(name).trim()) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "El nombre es obligatorio." });
    }

    const branch = await resolveBranchForWrite(req, { branchId, conn });
    const normalizedServiceIds = normalizeIdArray(serviceIds);
    await validateServiceOwnership(conn, tenantId, normalizedServiceIds, branch.id);

    const color = sanitizeColorHex(colorHex);
    const [insert] = await conn.query(
      `INSERT INTO instructor (tenant_id, branch_id, name, color_hex, is_active, photo_url, phone_e164)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, branch.id, String(name).trim(), color, isActive ? 1 : 0, photoUrl || null, (phoneE164 || null)]
    );

    const instructorId = insert.insertId;

    if (normalizedServiceIds.length) {
      const values = normalizedServiceIds.flatMap((serviceId) => [tenantId, branch.id, instructorId, serviceId]);
      const placeholders = normalizedServiceIds.map(() => "(?, ?, ?, ?)").join(",");
      await conn.query(
        `INSERT INTO instructor_service (tenant_id, branch_id, instructor_id, service_id)
         VALUES ${placeholders}`,
        values
      );
    }

    await conn.commit();
    res.json({ ok: true, id: instructorId, branchId: branch.id });
  } catch (err) {
    await conn.rollback();
    console.error("❌ [POST /api/admin/instructors] ERROR:", err);
    sendError(res, err, "No se pudo crear el instructor");
  } finally {
    conn.release();
  }
});

instructorsAdmin.put("/instructors/:id", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureInstructorPhotoColumn();
    await ensureInstructorPhoneColumn();
    const tenantId = req.tenant.id;
    const instructorId = Number(req.params.id);
    if (!Number.isInteger(instructorId) || instructorId <= 0) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Instructor inválido." });
    }

    const [[existing]] = await conn.query(
      `SELECT id, branch_id FROM instructor WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [instructorId, tenantId]
    );

    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "El instructor no existe." });
    }

    const { name, colorHex, isActive, serviceIds, branchId, photoUrl, phoneE164 } = req.body || {};

    const updates = [];
    const params = [];
    let branch = { id: existing.branch_id };

    if (branchId !== undefined) {
      branch = await resolveBranchForWrite(req, { branchId, conn });
      updates.push("branch_id = ?");
      params.push(branch.id);
    }

    if (!branch.id) {
      branch = await resolveBranchForWrite(req, { conn });
      if (!updates.includes("branch_id = ?")) {
        updates.push("branch_id = ?");
        params.push(branch.id);
      }
    }

    if (name !== undefined) {
      if (!String(name).trim()) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "El nombre no puede estar vacío." });
      }
      updates.push("name = ?");
      params.push(String(name).trim());
    }

    if (colorHex !== undefined) {
      updates.push("color_hex = ?");
      params.push(sanitizeColorHex(colorHex));
    }

    if (photoUrl !== undefined) {
      updates.push("photo_url = ?");
      params.push(photoUrl || null);
    }

    if (phoneE164 !== undefined) {
      updates.push("phone_e164 = ?");
      params.push(phoneE164 || null);
    }

    if (isActive !== undefined) {
      updates.push("is_active = ?");
      params.push(isActive ? 1 : 0);
    }

    if (updates.length) {
      params.push(instructorId, tenantId);
      await conn.query(
        `UPDATE instructor SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`,
        params
      );
    }

    if (serviceIds !== undefined) {
      const normalizedServiceIds = normalizeIdArray(serviceIds);
      await validateServiceOwnership(conn, tenantId, normalizedServiceIds, branch.id);

      await conn.query(
        `DELETE FROM instructor_service WHERE tenant_id = ? AND instructor_id = ?`,
        [tenantId, instructorId]
      );

      if (normalizedServiceIds.length) {
        const values = normalizedServiceIds.flatMap((serviceId) => [tenantId, branch.id, instructorId, serviceId]);
        const placeholders = normalizedServiceIds.map(() => "(?, ?, ?, ?)").join(",");
        await conn.query(
          `INSERT INTO instructor_service (tenant_id, branch_id, instructor_id, service_id)
           VALUES ${placeholders}`,
          values
        );
      }
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("❌ [PUT /api/admin/instructors/:id] ERROR:", err);
    sendError(res, err, "No se pudo actualizar el instructor");
  } finally {
    conn.release();
  }
});

instructorsAdmin.delete("/instructors/:id", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant.id;
    const instructorId = Number(req.params.id);
    if (!Number.isInteger(instructorId) || instructorId <= 0) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Instructor inválido." });
    }

    const [update] = await conn.query(
      `UPDATE instructor
          SET is_active = 0
        WHERE id = ? AND tenant_id = ?`,
      [instructorId, tenantId]
    );

    if (update.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "El instructor no existe." });
    }

    await conn.query(
      `DELETE FROM instructor_service WHERE tenant_id = ? AND instructor_id = ?`,
      [tenantId, instructorId]
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("❌ [DELETE /api/admin/instructors/:id] ERROR:", err);
    sendError(res, err, "No se pudo eliminar el instructor");
  } finally {
    conn.release();
  }
});

instructorsAdmin.get("/services", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const filter = resolveBranchFilter(req, { allowAll: true });
    const branchClause = buildBranchClause("svc", filter);
    const [services] = await pool.query(
      `
      SELECT svc.id,
             svc.name,
             svc.price_decimal,
             svc.duration_min,
             svc.is_active,
             svc.branch_id,
             tb.name AS branch_name
        FROM service svc
        LEFT JOIN tenant_branch tb
          ON tb.id = svc.branch_id
       WHERE svc.tenant_id = ?
       ${branchClause.clause}
       ORDER BY svc.name ASC, svc.id ASC
      `,
      [tenantId, ...branchClause.params]
    );

    const linkClause = buildBranchClause("isvc", filter);
    const [links] = await pool.query(
      `
      SELECT isvc.service_id, isvc.instructor_id, inst.name
        FROM instructor_service isvc
        JOIN instructor inst
          ON inst.id = isvc.instructor_id
         AND inst.tenant_id = isvc.tenant_id
       WHERE isvc.tenant_id = ?
       ${linkClause.clause}
      `,
      [tenantId, ...linkClause.params]
    );

    const instructorsByService = new Map();
    links.forEach((row) => {
      if (!instructorsByService.has(row.service_id)) {
        instructorsByService.set(row.service_id, []);
      }
      instructorsByService.get(row.service_id).push({
        id: Number(row.instructor_id),
        name: row.name,
      });
    });

    const data = services.map((row) => {
      const instructors = instructorsByService.get(row.id) || [];
      return {
        id: Number(row.id),
        name: row.name,
        priceDecimal: row.price_decimal != null ? Number(row.price_decimal) : 0,
        durationMin: row.duration_min != null ? Number(row.duration_min) : 0,
        isActive: row.is_active === 1,
        branchId: row.branch_id ? Number(row.branch_id) : null,
        branchName: row.branch_name || null,
        instructors,
        instructorIds: instructors.map((inst) => inst.id),
      };
    });

    res.json({ ok: true, data });
  } catch (err) {
    console.error("❌ [GET /api/admin/services] ERROR:", err);
    sendError(res, err, "No se pudieron obtener los servicios");
  }
});

instructorsAdmin.post("/services", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant.id;
    const {
      name,
      priceDecimal = 0,
      durationMin = 0,
      isActive = true,
      instructorIds = [],
      branchId,
    } = req.body || {};

    if (!name || !String(name).trim()) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "El nombre es obligatorio." });
    }

    const normalizedDuration = Number(durationMin);
    if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "La duración debe ser un número mayor a cero." });
    }

    const normalizedPrice = Number(priceDecimal);
    if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "El precio debe ser un número válido." });
    }

    const branch = await resolveBranchForWrite(req, { branchId, conn });
    const normalizedInstructorIds = normalizeIdArray(instructorIds);
    await validateInstructorOwnership(conn, tenantId, normalizedInstructorIds, branch.id);

    const [insert] = await conn.query(
      `INSERT INTO service (tenant_id, branch_id, name, price_decimal, duration_min, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tenantId, branch.id, String(name).trim(), normalizedPrice, normalizedDuration, isActive ? 1 : 0]
    );

    const serviceId = insert.insertId;

    if (normalizedInstructorIds.length) {
      const values = normalizedInstructorIds.flatMap((instructorId) => [
        tenantId,
        branch.id,
        instructorId,
        serviceId,
      ]);
      const placeholders = normalizedInstructorIds.map(() => "(?, ?, ?, ?)").join(",");
      await conn.query(
        `INSERT INTO instructor_service (tenant_id, branch_id, instructor_id, service_id)
         VALUES ${placeholders}`,
        values
      );
    }

    await conn.commit();
    res.json({ ok: true, id: serviceId, branchId: branch.id });
  } catch (err) {
    await conn.rollback();
    console.error("❌ [POST /api/admin/services] ERROR:", err);
    sendError(res, err, "No se pudo crear el servicio");
  } finally {
    conn.release();
  }
});

instructorsAdmin.put("/services/:id", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant.id;
    const serviceId = Number(req.params.id);
    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Servicio inválido." });
    }

    const [[existing]] = await conn.query(
      `SELECT id, branch_id FROM service WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [serviceId, tenantId]
    );

    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "El servicio no existe." });
    }

    const { name, priceDecimal, durationMin, isActive, instructorIds, branchId } = req.body || {};

    const updates = [];
    const params = [];
    let branch = { id: existing.branch_id };

    if (branchId !== undefined) {
      branch = await resolveBranchForWrite(req, { branchId, conn });
      updates.push("branch_id = ?");
      params.push(branch.id);
    }

    if (!branch.id) {
      branch = await resolveBranchForWrite(req, { conn });
      if (!updates.includes("branch_id = ?")) {
        updates.push("branch_id = ?");
        params.push(branch.id);
      }
    }

    if (name !== undefined) {
      if (!String(name).trim()) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "El nombre no puede estar vacío." });
      }
      updates.push("name = ?");
      params.push(String(name).trim());
    }

    if (priceDecimal !== undefined) {
      const price = Number(priceDecimal);
      if (!Number.isFinite(price) || price < 0) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "El precio debe ser un número válido." });
      }
      updates.push("price_decimal = ?");
      params.push(price);
    }

    if (durationMin !== undefined) {
      const duration = Number(durationMin);
      if (!Number.isFinite(duration) || duration <= 0) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "La duración debe ser un número mayor a cero." });
      }
      updates.push("duration_min = ?");
      params.push(duration);
    }

    if (isActive !== undefined) {
      updates.push("is_active = ?");
      params.push(isActive ? 1 : 0);
    }

    if (updates.length) {
      params.push(serviceId, tenantId);
      await conn.query(
        `UPDATE service SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`,
        params
      );
    }

    if (instructorIds !== undefined) {
      const normalizedInstructorIds = normalizeIdArray(instructorIds);
      await validateInstructorOwnership(conn, tenantId, normalizedInstructorIds, branch.id);

      await conn.query(
        `DELETE FROM instructor_service WHERE tenant_id = ? AND service_id = ?`,
        [tenantId, serviceId]
      );

      if (normalizedInstructorIds.length) {
        const values = normalizedInstructorIds.flatMap((instructorId) => [
          tenantId,
          branch.id,
          instructorId,
          serviceId,
        ]);
        const placeholders = normalizedInstructorIds.map(() => "(?, ?, ?, ?)").join(",");
        await conn.query(
          `INSERT INTO instructor_service (tenant_id, branch_id, instructor_id, service_id)
           VALUES ${placeholders}`,
          values
        );
      }
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("❌ [PUT /api/admin/services/:id] ERROR:", err);
    sendError(res, err, "No se pudo actualizar el servicio");
  } finally {
    conn.release();
  }
});

instructorsAdmin.delete("/services/:id", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant.id;
    const serviceId = Number(req.params.id);
    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Servicio inválido." });
    }

    const [update] = await conn.query(
      `UPDATE service
          SET is_active = 0
        WHERE id = ? AND tenant_id = ?`,
      [serviceId, tenantId]
    );

    if (update.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "El servicio no existe." });
    }

    await conn.query(
      `DELETE FROM instructor_service WHERE tenant_id = ? AND service_id = ?`,
      [tenantId, serviceId]
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("❌ [DELETE /api/admin/services/:id] ERROR:", err);
    sendError(res, err, "No se pudo eliminar el servicio");
  } finally {
    conn.release();
  }
});

export default instructorsAdmin;






