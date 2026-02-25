// src/routes/depositsAdmin.js — MULTI-TENANT
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";

export const depositsAdmin = Router();
depositsAdmin.use(requireAuth, requireRole("admin", "user"));

/**
 * GET /api/deposits?status=pending|paid|all&from=YYYY-MM-DD&to=YYYY-MM-DD&instructorId=#
 * Lista señas (turnos con depósito configurado)
 */
depositsAdmin.get("/deposits", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const status = String(req.query.status || "pending");
    const from = (req.query.from || "").toString().slice(0, 10);
    const to = (req.query.to || "").toString().slice(0, 10);
    const instructorId = req.query.instructorId ? Number(req.query.instructorId) : null;

    const fromTs = from ? `${from} 00:00:00` : "1970-01-01 00:00:00";
    const toTs = to ? `${to} 23:59:59` : "2999-12-31 23:59:59";

    let sql = `
      SELECT 
        a.id, a.starts_at, a.ends_at, a.status,
        a.deposit_decimal, a.deposit_paid_at, a.hold_until,
        s.name AS service, st.name AS instructor,
        c.name AS customer, c.phone_e164 AS phone
      FROM appointment a
      JOIN service  s  ON s.id=a.service_id  AND s.tenant_id=a.tenant_id
      JOIN instructor  st ON st.id=a.instructor_id AND st.tenant_id=a.tenant_id
      LEFT JOIN customer c ON c.id=a.customer_id AND c.tenant_id=a.tenant_id
      WHERE a.tenant_id=?
        AND a.deposit_decimal IS NOT NULL
        AND a.starts_at BETWEEN ? AND ?
    `;
    const params = [tenantId, fromTs, toTs];

    if (status === "pending") {
      sql += " AND a.status IN ('pending_deposit')";
    } else if (status === "paid") {
      sql += " AND a.status IN ('deposit_paid','confirmed','completed') AND a.deposit_paid_at IS NOT NULL";
    }
    if (instructorId) {
      sql += " AND a.instructor_id = ?";
      params.push(instructorId);
    }

    sql += " ORDER BY a.starts_at ASC";

    const [rows] = await pool.query(sql, params);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error("[GET /deposits] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/deposits/:appointmentId/confirm
 * Body: { amount_decimal? } — marca la seña como pagada (manual/caja)
 */
depositsAdmin.post("/deposits/:appointmentId/confirm", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const tenantId = req.tenant.id;
    const apptId = Number(req.params.appointmentId);
    const amountDecimal = req.body?.amount_decimal != null ? Number(req.body.amount_decimal) : null;

    await conn.beginTransaction();

    const [[appt]] = await conn.query(
      `SELECT id, status, deposit_decimal FROM appointment WHERE id=? AND tenant_id=? FOR UPDATE`,
      [apptId, tenantId]
    );
    if (!appt) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Turno no encontrado en tu cuenta" });
    }
    if (appt.deposit_decimal == null && amountDecimal == null) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "El turno no tenía seña configurada. Enviá amount_decimal." });
    }

    const depositToSet = amountDecimal != null ? amountDecimal : Number(appt.deposit_decimal || 0);

    // Registrar pago (opcional) en tabla payment
    await conn.query(
      `INSERT INTO payment (tenant_id, appointment_id, method, amount_cents, currency, created_at)
       VALUES (?,?,?,?, 'ARS', NOW())`,
      [tenantId, apptId, 'manual', Math.round(depositToSet * 100)]
    );

    // Marcar turno como pagado
    await conn.query(
      `UPDATE appointment
          SET deposit_decimal = ?,
              deposit_paid_at = COALESCE(deposit_paid_at, NOW()),
              hold_until = NULL,
              status = CASE 
                         WHEN status='pending_deposit' THEN 'confirmed'
                         ELSE status
                       END
        WHERE id=? AND tenant_id=?`,
      [depositToSet, apptId, tenantId]
    );

    await conn.commit();
    res.json({ ok: true, message: "Seña confirmada" });
  } catch (e) {
    await conn.rollback();
    console.error("[POST /deposits/:id/confirm] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/deposits/:appointmentId/cancel
 * Cancela un turno "pendiente de seña" y libera el lugar.
 */
depositsAdmin.post("/deposits/:appointmentId/cancel", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const apptId = Number(req.params.appointmentId);

    // Solo permite cancelar si sigue pendiente
    const [r] = await pool.query(
      `UPDATE appointment
          SET status='cancelled', hold_until=NULL
        WHERE id=? AND tenant_id=? AND status='pending_deposit'`,
      [apptId, tenantId]
    );

    if (!r.affectedRows) {
      return res.status(400).json({ ok: false, error: "No se pudo cancelar (¿ya no está pendiente?)" });
    }

    res.json({ ok: true, message: "Turno cancelado y lugar liberado" });
  } catch (e) {
    console.error("[POST /deposits/:id/cancel] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/deposits/expire-holds
 * Cancela automáticamente turnos pendientes cuya reserva expiró (hold_until < NOW()).
 * También marca señas vencidas (sin cancelar, solo para mostrar como vencidas).
 */
depositsAdmin.post("/deposits/expire-holds", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    
    // Opción 1: Cancelar automáticamente los vencidos (comportamiento original)
    const [r] = await pool.query(
      `UPDATE appointment
          SET status='cancelled', hold_until=NULL
        WHERE tenant_id=?
          AND status='pending_deposit'
          AND hold_until IS NOT NULL
          AND hold_until < NOW()`,
      [tenantId]
    );
    
    res.json({ ok: true, affected: r.affectedRows });
  } catch (e) {
    console.error("[POST /deposits/expire-holds] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/admin/deposits/cleanup
 * Elimina definitivamente turnos cancelados o pendientes vencidos sin seña pagada.
 */
depositsAdmin.post("/deposits/cleanup", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const tenantId = req.tenant.id;
    await conn.beginTransaction();

    const [cancelled] = await conn.query(
      `DELETE FROM appointment
         WHERE tenant_id = ?
           AND status = 'cancelled'`,
      [tenantId]
    );

    const [expiredPending] = await conn.query(
      `DELETE FROM appointment
         WHERE tenant_id = ?
           AND status = 'pending_deposit'
           AND deposit_paid_at IS NULL
           AND hold_until IS NOT NULL
           AND hold_until < NOW()`,
      [tenantId]
    );

    await conn.commit();
    res.json({ ok: true, deleted_cancelled: cancelled.affectedRows, deleted_expired_pending: expiredPending.affectedRows });
  } catch (e) {
    await conn.rollback();
    console.error("[POST /deposits/cleanup] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
  }
});
/**
 * GET /api/deposits/check-expired
 * Verifica y retorna el conteo de señas vencidas sin cancelarlas.
 * Útil para mostrar alertas en el frontend.
 */
depositsAdmin.get("/deposits/check-expired", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    
    const [[result]] = await pool.query(
      `SELECT COUNT(*) as expired_count
       FROM appointment
       WHERE tenant_id=?
         AND status='pending_deposit'
         AND deposit_paid_at IS NULL
         AND hold_until IS NOT NULL
         AND hold_until < NOW()`,
      [tenantId]
    );
    
    res.json({ ok: true, expiredCount: result.expired_count || 0 });
  } catch (e) {
    console.error("[GET /deposits/check-expired] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

depositsAdmin.get("/deposits/pending", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const includeExpired = String(req.query.includeExpired || "false") === "true";
    const includePaid = String(req.query.includePaid || "false") === "true"; // Nuevo parámetro para incluir pagados
    const includeCancelled = String(req.query.includeCancelled || "false") === "true"; // Incluir cancelados en contable
    
    // Paginado
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const offset = (page - 1) * limit;
    
    // Filtros
    const statusFilter = req.query.status || "all"; // "all", "active", "expired", "paid", "cancelled"
    const searchQuery = (req.query.search || "").trim();
    const serviceId = req.query.serviceId ? parseInt(req.query.serviceId, 10) : null;
    const instructorId = req.query.instructorId ? parseInt(req.query.instructorId, 10) : null;
    // Soportar nombres de parámetros tanto from/to como fromDate/toDate
    const fromDate = req.query.fromDate || req.query.from || "";
    const toDate = req.query.toDate || req.query.to || "";

    // Ventana amplia (podés ajustar si tu UI filtra por fechas)
    let fromTs = "1970-01-01 00:00:00";
    let toTs = "2999-12-31 23:59:59";
    
    if (fromDate) {
      fromTs = `${fromDate} 00:00:00`;
    }
    if (toDate) {
      toTs = `${toDate} 23:59:59`;
    }

    // Query base - ahora incluye tanto pendientes como pagados según el filtro
    let sql = `
      SELECT 
        a.id, a.starts_at, a.ends_at, a.status,
        a.deposit_decimal, a.deposit_paid_at, a.hold_until,
        a.created_at AS created_at,
        s.id AS service_id, s.name AS service_name,
        st.id AS instructor_id, st.name AS instructor_name,
        c.id AS customer_id, c.name AS customer_name, c.phone_e164 AS phone_e164,
        CASE 
          WHEN a.status = 'deposit_paid' OR a.status = 'confirmed' THEN 'paid'
          WHEN a.hold_until IS NOT NULL AND a.hold_until < NOW() THEN 'expired'
          WHEN a.hold_until IS NOT NULL AND a.hold_until < DATE_ADD(NOW(), INTERVAL 30 MINUTE) THEN 'expiring'
          ELSE 'active'
        END AS urgency
      FROM appointment a
      JOIN service  s  ON s.id=a.service_id  AND s.tenant_id=a.tenant_id
      JOIN instructor  st ON st.id=a.instructor_id AND st.tenant_id=a.tenant_id
      LEFT JOIN customer c ON c.id=a.customer_id AND c.tenant_id=a.tenant_id
      WHERE a.tenant_id=?
        AND a.deposit_decimal IS NOT NULL
        AND a.deposit_decimal > 0
        AND a.starts_at BETWEEN ? AND ?
    `;

    const params = [tenantId, fromTs, toTs];

    // Filtro por estado del depósito
    if (statusFilter === "paid") {
      // Solo pagados
      sql += ` AND (a.status = 'deposit_paid' OR a.status = 'confirmed') AND a.deposit_paid_at IS NOT NULL`;
    } else if (statusFilter === "active") {
      // Solo activos (pendientes no vencidos)
      sql += ` AND a.status = 'pending_deposit' AND a.deposit_paid_at IS NULL AND (a.hold_until IS NULL OR a.hold_until >= NOW())`;
    } else if (statusFilter === "expired") {
      // Solo vencidos
      sql += ` AND a.status = 'pending_deposit' AND a.deposit_paid_at IS NULL AND a.hold_until IS NOT NULL AND a.hold_until < NOW()`;
    } else if (statusFilter === "cancelled") {
      // Solo cancelados
      sql += ` AND a.status = 'cancelled' AND a.deposit_decimal IS NOT NULL`;
    } else if (statusFilter === "all") {
      // Todos: construir condición según includePaid e includeExpired
      const conditions = [];
      
      // Condiciones para pendientes
      const pendingCondition = `a.status = 'pending_deposit' AND a.deposit_paid_at IS NULL`;
      
      if (includeExpired) {
        // Incluir todas las pendientes (activas y vencidas)
        conditions.push(`(${pendingCondition})`);
      } else {
        // Solo pendientes activas (no vencidas)
        conditions.push(`(${pendingCondition} AND (a.hold_until IS NULL OR a.hold_until >= NOW()))`);
      }
      
      // Condiciones para pagados
      if (includePaid) {
        conditions.push(`(a.status IN ('deposit_paid', 'confirmed') AND a.deposit_paid_at IS NOT NULL)`);
      }
      // Condiciones para cancelados
      if (includeCancelled) {
        conditions.push(`(a.status = 'cancelled')`);
      }
      
      if (conditions.length > 0) {
        sql += ` AND (${conditions.join(' OR ')})`;
      } else {
        // Por defecto si no hay condiciones, mostrar pendientes incluyendo vencidas
        sql += ` AND ${pendingCondition}`;
      }
    } else {
      // Por defecto, solo pendientes (incluyendo vencidas si includeExpired=true)
      sql += ` AND a.status = 'pending_deposit' AND a.deposit_paid_at IS NULL`;
      if (!includeExpired) {
        sql += ` AND (a.hold_until IS NULL OR a.hold_until >= NOW())`;
      }
    }

    // Filtro por servicio
    if (serviceId) {
      sql += ` AND a.service_id = ?`;
      params.push(serviceId);
    }

    // Filtro por estilista
    if (instructorId) {
      sql += ` AND a.instructor_id = ?`;
      params.push(instructorId);
    }

    // Búsqueda por texto (cliente, servicio, teléfono)
    if (searchQuery) {
      sql += ` AND (
        c.name LIKE ? OR 
        c.phone_e164 LIKE ? OR 
        s.name LIKE ? OR 
        st.name LIKE ?
      )`;
      const searchPattern = `%${searchQuery}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    // Contar total antes de paginar
    const countSql = `SELECT COUNT(*) as total FROM (${sql}) AS count_query`;
    const [[countResult]] = await pool.query(countSql, params);
    const total = countResult.total;

    // Agregar ordenamiento y paginado
    // Ordenar: primero los pagados (más recientes primero), luego los pendientes (más antiguos primero), al final cancelados
    sql += ` ORDER BY 
      CASE WHEN a.status IN ('deposit_paid', 'confirmed') AND a.deposit_paid_at IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN a.status IN ('deposit_paid', 'confirmed') THEN a.deposit_paid_at ELSE a.starts_at END DESC,
      CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END,
      a.starts_at ASC
      LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [rows] = await pool.query(sql, params);
    
    res.json({ 
      ok: true, 
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (e) {
    console.error("[GET /deposits/pending] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/admin/deposits/dashboard
// Resumen simple para tarjetas/estadísticas
depositsAdmin.get("/deposits/dashboard", async (req, res) => {
  try {
    const tenantId = req.tenant.id;

    const [[agg]] = await pool.query(
      `
      SELECT
        -- pendientes (no pagadas aún)
        SUM(CASE WHEN a.status='pending_deposit' THEN 1 ELSE 0 END)                           AS pending_count,
        -- pendientes vencidas
        SUM(CASE WHEN a.status='pending_deposit' AND a.hold_until IS NOT NULL AND a.hold_until < NOW()
                 THEN 1 ELSE 0 END)                                                            AS expired_holds,
        -- pagadas (deposit_paid/confirmed/completed con marca de pago)
        SUM(CASE WHEN a.status IN ('deposit_paid','confirmed','completed') 
                      AND a.deposit_paid_at IS NOT NULL THEN 1 ELSE 0 END)                     AS paid_count,
        -- monto total de señas cobradas
        COALESCE(SUM(CASE WHEN a.status IN ('deposit_paid','confirmed','completed')
                               AND a.deposit_paid_at IS NOT NULL 
                          THEN a.deposit_decimal ELSE 0 END), 0)                               AS paid_total,
        -- métricas de hoy (por fecha del turno)
        SUM(CASE WHEN a.status='pending_deposit' AND DATE(a.starts_at)=CURDATE() THEN 1 ELSE 0 END) AS today_pending,
        SUM(CASE WHEN a.status IN ('deposit_paid','confirmed','completed') 
                      AND a.deposit_paid_at IS NOT NULL 
                      AND DATE(a.starts_at)=CURDATE() THEN 1 ELSE 0 END)                        AS today_paid
      FROM appointment a
      WHERE a.tenant_id = ?
        AND a.deposit_decimal IS NOT NULL
      `,
      [tenantId]
    );

    res.json({ ok: true, data: agg });
  } catch (e) {
    console.error("[GET /deposits/dashboard] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
