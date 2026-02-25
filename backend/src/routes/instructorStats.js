// src/routes/instructorStats.js — CON VALIDACIÓN TENANT
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../auth/middlewares.js";

export const instructorStats = Router();
instructorStats.use(requireAuth);

// helper: incluye todo el día "to"
function dayRange(from, to) {
  const f = `${from} 00:00:00`;
  const t = `${to} 23:59:59`;
  return [f, t];
}

// GET /api/stats/:instructorId  ?from=YYYY-MM-DD&to=YYYY-MM-DD
instructorStats.get("/:instructorId", async (req, res) => {
  try {
    const instructorId = Number(req.params.instructorId);
    const from = String(req.query.from || "").slice(0, 10);
    const to = String(req.query.to || "").slice(0, 10);
    const tenantId = req.tenant.id;
    
    if (!instructorId || !from || !to) {
      return res.status(400).json({ 
        ok: false, 
        error: "Falta instructorId/from/to" 
      });
    }

    // ✅ CRÍTICO: Validar que el instructor pertenece al tenant
    const [[instructor]] = await pool.query(
      `SELECT id, name FROM instructor 
       WHERE id = ? AND tenant_id = ? 
       LIMIT 1`,
      [instructorId, tenantId]
    );

    if (!instructor) {
      return res.status(403).json({ 
        ok: false, 
        error: "Acceso denegado: instructor no encontrado en tu cuenta" 
      });
    }

    const [fromTs, toTs] = dayRange(from, to);

    // % de comisión (scoped por tenant)
    const [[rowPct]] = await pool.query(
      `SELECT percentage 
       FROM instructor_commission 
       WHERE tenant_id = ? AND instructor_id = ? 
       LIMIT 1`,
      [tenantId, instructorId]
    );
    const porcentaje = Number(rowPct?.percentage || 0);

    // Estados a contar (excluimos cancelados)
    const statuses = ["scheduled", "confirmed", "deposit_paid", "completed"];

    // KPIs (scoped por tenant)
    const [[kpi]] = await pool.query(
      `
      SELECT
        COUNT(*)                                    AS total_cortes,
        COALESCE(SUM(s.price_decimal), 0)           AS monto_total
      FROM appointment a
      JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
       WHERE a.instructor_id = ? 
         AND a.tenant_id = ?
        AND a.status IN (?,?,?,?)
        AND a.starts_at BETWEEN ? AND ?
      `,
       [instructorId, tenantId, ...statuses, fromTs, toTs]
    );

    const monto_total = Number(kpi?.monto_total || 0);
    const total_cortes = Number(kpi?.total_cortes || 0);
    const comision_ganada = +(monto_total * (porcentaje / 100)).toFixed(2);
    const neto_local = +(monto_total - comision_ganada).toFixed(2);

    // Serie diaria (scoped)
    const [daily] = await pool.query(
      `
      SELECT DATE(a.starts_at) AS date,
             COUNT(*)          AS cortes,
             COALESCE(SUM(s.price_decimal),0) AS amount
      FROM appointment a
      JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
       WHERE a.instructor_id = ? 
         AND a.tenant_id = ?
        AND a.status IN (?,?,?,?)
        AND a.starts_at BETWEEN ? AND ?
      GROUP BY DATE(a.starts_at)
      ORDER BY DATE(a.starts_at)
      `,
      [instructorId, tenantId, ...statuses, fromTs, toTs]
    );

    // Por servicio (scoped)
    const [services] = await pool.query(
      `
      SELECT s.name AS service,
             COUNT(*) AS count,
             COALESCE(SUM(s.price_decimal),0) AS amount
      FROM appointment a
      JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
       WHERE a.instructor_id = ? 
         AND a.tenant_id = ?
        AND a.status IN (?,?,?,?)
        AND a.starts_at BETWEEN ? AND ?
      GROUP BY s.id
      ORDER BY amount DESC
      `,
      [instructorId, tenantId, ...statuses, fromTs, toTs]
    );

    // Lista de turnos para exportar (scoped)
    const [turnos] = await pool.query(
      `
      SELECT a.id, a.starts_at, a.status,
             s.name AS service_name, s.price_decimal,
             c.name AS customer_name, i.name AS instructor_name
      FROM appointment a
      JOIN service s  ON s.id = a.service_id  AND s.tenant_id = a.tenant_id
      LEFT JOIN customer c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
      JOIN instructor  i ON i.id = a.instructor_id AND i.tenant_id = a.tenant_id
       WHERE a.instructor_id = ? 
         AND a.tenant_id = ?
        AND a.status IN (?,?,?,?)
        AND a.starts_at BETWEEN ? AND ?
      ORDER BY a.starts_at
      `,
       [instructorId, tenantId, ...statuses, fromTs, toTs]
    );

    return res.json({
      ok: true,
      instructor_id: instructorId,
      instructor_name: instructor.name,
      porcentaje,
      total_cortes,
      monto_total,
      comision_ganada,
      neto_local,
      daily,
      services,
      turnos
    });
    
  } catch (e) {
    console.error("[GET /api/stats/:instructorId] error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});