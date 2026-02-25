// customersAdmin.js
import { Router } from "express";
import { pool } from "../db.js";

export const customersAdmin = Router();

const hit = (name) => (req, _res, next) => { 
  console.log(`[CUSTOMERS_ADMIN] ${name} hit -> path="${req.path}"`); 
  next(); 
};

// 1) LISTA - Keep this first
customersAdmin.get("/", hit("LIST"), async (req, res) => {
  try {
    const tenantId = Number(req.tenant?.id);
    const q = (req.query.q || "").trim();
    const search = `%${q}%`;
    
    // Paginación
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    // Contar total de registros
    const [[countResult]] = await pool.query(`
      SELECT COUNT(*) as total
      FROM customer c
      WHERE c.tenant_id = ?
        AND (? = '' OR c.name LIKE ? OR c.phone_e164 LIKE ?)
    `, [tenantId, q, search, search]);
    
    const total = Number(countResult?.total || 0);
    const totalPages = Math.ceil(total / limit);

    const [rows] = await pool.query(`
      SELECT 
        c.id,
        c.name,
        c.phone_e164 AS phone,
        c.picture,
        (
          SELECT COUNT(*) 
          FROM appointment a 
          WHERE a.customer_id = c.id 
            AND a.tenant_id   = c.tenant_id
        ) AS total_appointments,
        (
          SELECT COUNT(*)
          FROM class_enrollment ce
          JOIN class_session cs ON cs.id = ce.session_id AND cs.tenant_id = ce.tenant_id
          WHERE ce.customer_id = c.id
            AND ce.tenant_id   = c.tenant_id
            AND ce.status      = 'reserved'
            AND cs.starts_at  >= NOW()
        ) AS upcoming_classes,
        (
          SELECT COUNT(*)
          FROM class_enrollment ce
          WHERE ce.customer_id = c.id
            AND ce.tenant_id   = c.tenant_id
            AND ce.status      = 'attended'
        ) AS completed_classes,
        EXISTS(
          SELECT 1
            FROM customer_subscription sub
           WHERE sub.customer_id = c.id
             AND sub.tenant_id   = c.tenant_id
        ) AS has_subscription,
        EXISTS(
          SELECT 1
            FROM customer_subscription sub
           WHERE sub.customer_id = c.id
             AND sub.tenant_id   = c.tenant_id
             AND sub.status      = 'authorized'
        ) AS has_active_subscription,
        (
          SELECT sub.status
            FROM customer_subscription sub
           WHERE sub.customer_id = c.id
             AND sub.tenant_id   = c.tenant_id
           ORDER BY 
             CASE sub.status 
               WHEN 'authorized' THEN 1
               WHEN 'pending' THEN 2
               WHEN 'paused' THEN 3
               WHEN 'cancelled' THEN 4
               ELSE 5
             END,
             sub.updated_at DESC
           LIMIT 1
        ) AS subscription_status,
        (
          SELECT mp.name
            FROM customer_subscription sub
            LEFT JOIN membership_plan mp
              ON mp.id = sub.membership_plan_id
             AND mp.tenant_id = sub.tenant_id
           WHERE sub.customer_id = c.id
             AND sub.tenant_id   = c.tenant_id
           ORDER BY 
             CASE sub.status 
               WHEN 'authorized' THEN 1
               WHEN 'pending' THEN 2
               WHEN 'paused' THEN 3
               WHEN 'cancelled' THEN 4
               ELSE 5
             END,
             sub.updated_at DESC
           LIMIT 1
        ) AS primary_plan_name,
        (
          SELECT sub.membership_plan_id
            FROM customer_subscription sub
           WHERE sub.customer_id = c.id
             AND sub.tenant_id   = c.tenant_id
           ORDER BY 
             CASE sub.status 
               WHEN 'authorized' THEN 1
               WHEN 'pending' THEN 2
               WHEN 'paused' THEN 3
               WHEN 'cancelled' THEN 4
               ELSE 5
             END,
             sub.updated_at DESC
           LIMIT 1
        ) AS primary_plan_id,
        (
          SELECT sub.amount_decimal
            FROM customer_subscription sub
           WHERE sub.customer_id = c.id
             AND sub.tenant_id   = c.tenant_id
           ORDER BY 
             CASE sub.status 
               WHEN 'authorized' THEN 1
               WHEN 'pending' THEN 2
               WHEN 'paused' THEN 3
               WHEN 'cancelled' THEN 4
               ELSE 5
             END,
             sub.updated_at DESC
           LIMIT 1
        ) AS primary_plan_amount_decimal,
        (
          SELECT sub.currency
            FROM customer_subscription sub
           WHERE sub.customer_id = c.id
             AND sub.tenant_id   = c.tenant_id
           ORDER BY 
             CASE sub.status 
               WHEN 'authorized' THEN 1
               WHEN 'pending' THEN 2
               WHEN 'paused' THEN 3
               WHEN 'cancelled' THEN 4
               ELSE 5
             END,
             sub.updated_at DESC
           LIMIT 1
        ) AS primary_plan_currency,
        (
          SELECT sub.last_payment_at
            FROM customer_subscription sub
           WHERE sub.customer_id = c.id
             AND sub.tenant_id   = c.tenant_id
           ORDER BY 
             CASE sub.status 
               WHEN 'authorized' THEN 1
               WHEN 'pending' THEN 2
               WHEN 'paused' THEN 3
               WHEN 'cancelled' THEN 4
               ELSE 5
             END,
             sub.updated_at DESC
           LIMIT 1
        ) AS primary_last_payment_at,
        (
          SELECT sub.next_charge_at
            FROM customer_subscription sub
           WHERE sub.customer_id = c.id
             AND sub.tenant_id   = c.tenant_id
           ORDER BY 
             CASE sub.status 
               WHEN 'authorized' THEN 1
               WHEN 'pending' THEN 2
               WHEN 'paused' THEN 3
               WHEN 'cancelled' THEN 4
               ELSE 5
             END,
             sub.updated_at DESC
           LIMIT 1
        ) AS primary_next_charge_at
      FROM customer c
      WHERE c.tenant_id = ?
        AND (? = '' OR c.name LIKE ? OR c.phone_e164 LIKE ?)
      ORDER BY c.name ASC
      LIMIT ? OFFSET ?
    `, [tenantId, q, search, search, limit, offset]);

    res.json({ 
      ok: true, 
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (e) {
    console.error("[CUSTOMERS] list error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 2) DETALLE (solo IDs numéricos)
customersAdmin.get("/:id(\\d+)", hit("DETAIL"), async (req, res) => {
  try {
    const tenantId = Number(req.tenant?.id);
    const id = parseInt(req.params.id, 10);

    const [cust] = await pool.query(`
      SELECT 
        id,
        name,
        phone_e164   AS phone,
        email,
        picture,
        notes,
        exempt_deposit,
        created_at,
        documento,
        tipo_documento,
        cuit,
        razon_social,
        domicilio,
        condicion_iva
      FROM customer
      WHERE id = ? AND tenant_id = ?
    `, [id, tenantId]);

    if (!cust.length) {
      return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
    }

    const [appts] = await pool.query(`
      SELECT 
        a.id,
        a.starts_at,
        a.ends_at,
        a.status,
        s.name  AS instructor,
        sv.name AS service
      FROM appointment a
      JOIN instructor s  ON s.id = a.instructor_id AND s.tenant_id  = a.tenant_id
      JOIN service sv ON sv.id = a.service_id AND sv.tenant_id = a.tenant_id
      WHERE a.customer_id = ?
        AND a.tenant_id   = ?
      ORDER BY a.starts_at DESC
    `, [id, tenantId]);

    const [classEnrollments] = await pool.query(`
      SELECT 
        ce.id,
        ce.status            AS enrollment_status,
        ce.notes             AS enrollment_notes,
        ce.created_at        AS enrollment_created_at,
        ce.updated_at        AS enrollment_updated_at,
        cs.id                AS session_id,
        cs.starts_at,
        cs.ends_at,
        cs.status            AS session_status,
        cs.activity_type,
        cs.series_id,
        cs.price_decimal,
        cs.capacity_max,
        cs.template_id,
        inst.id              AS instructor_id,
        inst.name            AS instructor_name,
        COALESCE(ct.name, cs.activity_type) AS template_name
      FROM class_enrollment ce
      JOIN class_session cs 
        ON cs.id = ce.session_id 
       AND cs.tenant_id = ce.tenant_id
      JOIN instructor inst 
        ON inst.id = cs.instructor_id 
       AND inst.tenant_id = cs.tenant_id
      LEFT JOIN class_template ct 
        ON ct.id = cs.template_id
      WHERE ce.customer_id = ?
        AND ce.tenant_id   = ?
      ORDER BY cs.starts_at DESC, ce.created_at DESC
    `, [id, tenantId]);

    const [subscriptions] = await pool.query(`
      SELECT 
        cs.id,
        cs.reason,
        cs.amount_decimal,
        cs.currency,
        cs.frequency,
        cs.frequency_type,
        cs.status,
        cs.payer_email,
        cs.mp_preapproval_id,
        cs.next_charge_at,
        cs.last_payment_at,
        cs.created_at,
        cs.updated_at,
        cs.membership_plan_id,
        mp.name AS plan_name,
        mp.price_decimal AS plan_price_decimal,
        mp.duration_months AS plan_duration_months,
        mp.billing_day AS plan_billing_day,
        mp.grace_days AS plan_grace_days,
        mp.interest_type AS plan_interest_type,
        mp.interest_value AS plan_interest_value,
        mp.auto_block AS plan_auto_block
      FROM customer_subscription cs
      LEFT JOIN membership_plan mp
        ON mp.id = cs.membership_plan_id
       AND mp.tenant_id = cs.tenant_id
      WHERE cs.customer_id = ?
        AND cs.tenant_id   = ?
      ORDER BY 
        FIELD(cs.status, 'authorized','pending','paused','cancelled') ASC,
        cs.updated_at DESC,
        cs.created_at DESC
    `, [id, tenantId]);

    const now = new Date();
    const classStats = classEnrollments.reduce(
      (acc, row) => {
        acc.total += 1;
        if (row.enrollment_status === "attended") {
          acc.attended += 1;
        }
        if (row.enrollment_status === "reserved") {
          try {
            const startsAt = row.starts_at ? new Date(row.starts_at) : null;
            if (startsAt && startsAt >= now) {
              acc.upcoming_reserved += 1;
            } else {
              acc.past_reserved += 1;
            }
          } catch {
            acc.upcoming_reserved += 1;
          }
        }
        return acc;
      },
      { total: 0, attended: 0, upcoming_reserved: 0, past_reserved: 0 }
    );

    // Buscar la suscripción activa primero, si no existe usar la primera
    const activeSubscription = subscriptions.find((s) => s.status === "authorized") || null;
    const primarySubscription = activeSubscription || subscriptions[0] || null;
    const hasSubscription = subscriptions.length > 0;
    const hasActiveSubscription = subscriptions.some((s) => s.status === "authorized");
    
    // Buscar last_payment_at y next_charge_at en la suscripción activa, o en cualquier suscripción que los tenga
    let lastPaymentAt = primarySubscription?.last_payment_at || null;
    let nextChargeAt = primarySubscription?.next_charge_at || null;
    
    // Si la suscripción primaria no tiene estos valores, buscar en otras suscripciones
    if (!lastPaymentAt || !nextChargeAt) {
      for (const sub of subscriptions) {
        if (!lastPaymentAt && sub.last_payment_at) {
          lastPaymentAt = sub.last_payment_at;
        }
        if (!nextChargeAt && sub.next_charge_at) {
          nextChargeAt = sub.next_charge_at;
        }
        // Si ya encontramos ambos, no necesitamos seguir buscando
        if (lastPaymentAt && nextChargeAt) break;
      }
    }
    
    const subscriptionSummary = {
      hasSubscription,
      hasActiveSubscription,
      status: primarySubscription?.status || null,
      next_charge_at: nextChargeAt,
      last_payment_at: lastPaymentAt,
      amount_decimal: primarySubscription?.amount_decimal || null,
      currency: primarySubscription?.currency || null,
      payer_email: primarySubscription?.payer_email || null,
      id: primarySubscription?.id || null,
      membership_plan_id: primarySubscription?.membership_plan_id || null,
      plan_name: primarySubscription?.plan_name || null,
      plan_price_decimal: primarySubscription?.plan_price_decimal || null,
      plan_duration_months: primarySubscription?.plan_duration_months || null,
      plan_billing_day: primarySubscription?.plan_billing_day || null,
      plan_grace_days: primarySubscription?.plan_grace_days || null,
      plan_interest_type: primarySubscription?.plan_interest_type || null,
      plan_interest_value: primarySubscription?.plan_interest_value || null,
      plan_auto_block: primarySubscription?.plan_auto_block ?? null,
    };

    res.json({ 
      ok: true, 
      data: { 
        ...cust[0], 
        appointments: appts,
        class_enrollments: classEnrollments,
        class_stats: classStats,
        subscriptions,
        subscription_summary: subscriptionSummary,
      } 
    });
  } catch (e) {
    console.error("[CUSTOMERS] detail error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 3) FALLBACK - Must be LAST and more specific
// Only catch invalid IDs (non-numeric), not the root path
customersAdmin.get("/:id", hit("FALLBACK"), (_req, res) => {
  res.status(400).json({ ok: false, error: "Parámetro :id inválido" });
});