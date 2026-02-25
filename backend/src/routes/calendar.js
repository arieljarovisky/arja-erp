// src/routes/calendar.js — MULTI-TENANT
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import { resolveBranchFilter } from "../helpers/branchAccess.js";

export const calendar = Router();
calendar.use(requireAuth, requireRole("admin","staff","user"));

function buildBranchClause(alias, filter) {
  if (!filter || filter.mode === "all") {
    return { clause: "", params: [] };
  }
  return { clause: ` AND ${alias}.branch_id = ?`, params: [filter.branchId] };
}

/**
 * GET /api/calendar/day?date=YYYY-MM-DD&instructorId=#
 * Devuelve turnos y bloqueos del día.
 */
calendar.get("/calendar/day", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const filter = resolveBranchFilter(req, { allowAll: true });
    const date = String(req.query.date || "").slice(0, 10);
    const instructorId = req.query.instructorId ? Number(req.query.instructorId) : null;

    if (!date) {
      return res.status(400).json({ ok:false, error:"Falta date (YYYY-MM-DD)" });
    }

    const paramsBase = [tenantId, `${date} 00:00:00`, `${date} 23:59:59`];

    // --- Turnos ---
    const apptBranch = buildBranchClause("a", filter);
    let apptSQL = `
      SELECT 
        a.id, a.starts_at, a.ends_at, a.status,
        s.name  AS service_name, s.price_decimal,
        st.id   AS instructor_id, st.name AS instructor_name,
        c.id    AS customer_id, c.name AS customer_name, c.phone_e164 AS customer_phone
      FROM appointment a
      INNER JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
      INNER JOIN instructor st ON st.id = a.instructor_id AND st.tenant_id = a.tenant_id
      LEFT JOIN customer c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
      WHERE a.tenant_id = ?
        AND a.starts_at BETWEEN ? AND ?
        ${apptBranch.clause}
    `;
    const apptParams = [...paramsBase, ...apptBranch.params];

    if (instructorId) {
      apptSQL += " AND a.instructor_id = ?";
      apptParams.push(instructorId);
    }

    apptSQL += " ORDER BY a.starts_at ASC";

    const [appointments] = await pool.query(apptSQL, apptParams);

    // --- Bloqueos ---
    const offBranch = buildBranchClause("inst", filter);
    let offSQL = `
      SELECT toff.id, toff.instructor_id, toff.starts_at, toff.ends_at, toff.reason
      FROM time_off toff
      LEFT JOIN instructor inst
        ON inst.id = toff.instructor_id
       AND inst.tenant_id = toff.tenant_id
      WHERE toff.tenant_id = ?
        AND toff.starts_at < DATE_ADD(?, INTERVAL 1 DAY)
        AND toff.ends_at   > ?
        ${offBranch.clause}
    `;
    const offParams = [tenantId, `${date} 00:00:00`, `${date} 23:59:59`, ...offBranch.params];
    if (instructorId) {
      offSQL += " AND instructor_id = ?";
      offParams.push(instructorId);
    }
    offSQL += " ORDER BY starts_at ASC";

    const [blocks] = await pool.query(offSQL, offParams);

    return res.json({ ok:true, date, data: { appointments, blocks } });
  } catch (e) {
    console.error("[GET /calendar/day] error:", e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});

/**
 * GET /api/calendar/range?from=YYYY-MM-DD&to=YYYY-MM-DD&instructorId=#
 * Devuelve turnos y bloqueos en un rango (incluye to completo).
 */
calendar.get("/calendar/range", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const filter = resolveBranchFilter(req, { allowAll: true });
    const from = String(req.query.from || "").slice(0, 10);
    const to   = String(req.query.to   || "").slice(0, 10);
    const instructorId = req.query.instructorId ? Number(req.query.instructorId) : null;

    if (!from || !to) {
      return res.status(400).json({ ok:false, error:"from y to (YYYY-MM-DD) son requeridos" });
    }

    const fromTs = `${from} 00:00:00`;
    const toTs   = `${to} 23:59:59`;

    // Turnos
    const apptBranch = buildBranchClause("a", filter);
    let apptSQL = `
      SELECT 
        a.id, a.starts_at, a.ends_at, a.status,
        s.name  AS service_name, s.price_decimal,
        st.id   AS instructor_id, st.name AS instructor_name,
        c.id    AS customer_id, c.name AS customer_name, c.phone_e164 AS customer_phone
      FROM appointment a
      INNER JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
      INNER JOIN instructor st ON st.id = a.instructor_id AND st.tenant_id = a.tenant_id
      LEFT JOIN customer c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
      WHERE a.tenant_id = ?
        AND a.starts_at BETWEEN ? AND ?
        ${apptBranch.clause}
    `;
    const apptParams = [tenantId, fromTs, toTs, ...apptBranch.params];

    if (instructorId) {
      apptSQL += " AND a.instructor_id = ?";
      apptParams.push(instructorId);
    }

    apptSQL += " ORDER BY a.starts_at ASC";
    const [appointments] = await pool.query(apptSQL, apptParams);

    // Bloqueos
    const offBranch = buildBranchClause("inst", filter);
    let offSQL = `
      SELECT toff.id, toff.instructor_id, toff.starts_at, toff.ends_at, toff.reason
      FROM time_off toff
      LEFT JOIN instructor inst
        ON inst.id = toff.instructor_id
       AND inst.tenant_id = toff.tenant_id
      WHERE toff.tenant_id = ?
        AND toff.starts_at < DATE_ADD(?, INTERVAL 1 DAY)
        AND toff.ends_at   > ?
        ${offBranch.clause}
    `;
    const offParams = [tenantId, toTs, fromTs, ...offBranch.params];

    if (instructorId) {
      offSQL += " AND instructor_id = ?";
      offParams.push(instructorId);
    }

    offSQL += " ORDER BY starts_at ASC";
    const [blocks] = await pool.query(offSQL, offParams);

    return res.json({ ok:true, range:{from, to}, data:{ appointments, blocks } });
  } catch (e) {
    console.error("[GET /calendar/range] error:", e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});
