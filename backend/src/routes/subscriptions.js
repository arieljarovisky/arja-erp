import { Router } from "express";
import fetch from "node-fetch";
import { pool } from "../db.js";
import { requireRole } from "../auth/middlewares.js";
import { getTenantMpToken } from "../services/mercadoPago.js";
import {
  createSubscriptionPreapproval,
  fetchPreapproval,
  mapMpStatus,
} from "../services/subscriptions.js";

export const subscriptions = Router();

// Todas las rutas requieren rol admin/user
subscriptions.use(requireRole("admin", "user"));

/* =========================
   POST /api/subscriptions
========================= */
subscriptions.post("/", async (req, res) => {
  const tenantId = req.tenant?.id;
  const {
    customerId,
    amount,
    currency = "ARS",
    description,
    startDate,
    frequency = 1,
    frequencyType = "months",
    payerEmail,
    membershipPlanId,
  } = req.body || {};

  if (!tenantId) {
    return res.status(403).json({ ok: false, error: "Tenant no identificado" });
  }

  try {
    const result = await createSubscriptionPreapproval({
      tenantId,
      customerId,
      amount,
      currency,
      description,
      startDate,
      frequency,
      frequencyType,
      payerEmail,
      membershipPlanId,
    });

    res.status(201).json({
      ok: true,
      data: {
        id: result.subscriptionId,
        mp_preapproval_id: result.mp_preapproval_id,
        status: result.status,
        init_point: result.init_point,
        sandbox_init_point: result.sandbox_init_point,
      },
    });
  } catch (error) {
    console.error("❌ [Subscriptions] Error creando suscripción:", error);

    const statusMap = {
      INVALID_INPUT: 400,
      INVALID_AMOUNT: 400,
      EMAIL_REQUIRED: 400,
      INVALID_PLAN: 400,
      TENANT_REQUIRED: 403,
      CUSTOMER_NOT_FOUND: 404,
      PLAN_NOT_FOUND: 404,
      MP_NOT_CONNECTED: 409,
      MP_PREAPPROVAL_FAILED: 502,
    };
    const status = statusMap[error.code] || 500;

    res.status(status).json({
      ok: false,
      error: error.message || "Error creando suscripción",
      details: error.details || null,
    });
  }
});

/* =========================
   GET /api/subscriptions
========================= */
subscriptions.get("/", async (req, res) => {
  try {
    const tenantId = req.tenant?.id;
    const { status, customerId } = req.query;

    const conditions = ["cs.tenant_id = ?"];
    const params = [tenantId];

    if (status) {
      conditions.push("cs.status = ?");
      params.push(status);
    }
    if (customerId) {
      conditions.push("cs.customer_id = ?");
      params.push(customerId);
    }

    const [rows] = await pool.query(
      `
      SELECT cs.*, c.name AS customer_name, c.email AS customer_email, c.phone_e164 AS customer_phone
      FROM customer_subscription cs
      JOIN customer c ON c.id = cs.customer_id AND c.tenant_id = cs.tenant_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY cs.created_at DESC
    `,
      params
    );

    res.json({
      ok: true,
      data: rows,
    });
  } catch (error) {
    console.error("❌ [Subscriptions] Error listando suscripciones:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* =========================
   PATCH /api/subscriptions/:id
   Cambiar estado (pause/resume/cancel)
========================= */
subscriptions.patch("/:id", async (req, res) => {
  const tenantId = req.tenant?.id;
  const { id } = req.params;
  const { status } = req.body || {};

  if (!["paused", "authorized", "cancelled"].includes(status)) {
    return res.status(400).json({
      ok: false,
      error: "Estado inválido. Usa 'paused', 'authorized' o 'cancelled'.",
    });
  }

  try {
    const [[sub]] = await pool.query(
      `SELECT * FROM customer_subscription WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, tenantId]
    );

    if (!sub) {
      return res.status(404).json({ ok: false, error: "Suscripción no encontrada" });
    }
    if (!sub.mp_preapproval_id) {
      return res.status(400).json({
        ok: false,
        error: "La suscripción no tiene un preapproval asociado",
      });
    }

    const accessToken = await getTenantMpToken(tenantId);
    if (!accessToken) {
      return res.status(409).json({
        ok: false,
        error: "Mercado Pago no está conectado para este negocio",
      });
    }

    const mpRes = await fetch(
      `https://api.mercadopago.com/preapproval/${sub.mp_preapproval_id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      }
    );
    const mpData = await mpRes.json().catch(() => ({}));

    if (!mpRes.ok) {
      console.error("[Subscriptions] Error actualizando preapproval:", mpData);
      return res.status(502).json({
        ok: false,
        error: "No se pudo actualizar la suscripción en Mercado Pago",
        details: mpData.message || mpData.error || null,
      });
    }

    const mapped = mapMpStatus(mpData.status || status);
    const nextCharge =
      mpData.auto_recurring?.next_payment_date
        ? new Date(mpData.auto_recurring.next_payment_date)
        : null;
    const lastPayment =
      mpData.auto_recurring?.last_payment_date
        ? new Date(mpData.auto_recurring.last_payment_date)
        : null;

    await pool.query(
      `UPDATE customer_subscription
          SET status = ?,
              next_charge_at = ?,
              last_payment_at = ?,
              canceled_at = CASE WHEN ? = 'cancelled' THEN NOW() ELSE canceled_at END,
              updated_at = NOW()
        WHERE id = ? AND tenant_id = ?`,
      [mapped, nextCharge, lastPayment, mapped, id, tenantId]
    );

    res.json({
      ok: true,
      data: { status: mapped, next_charge_at: nextCharge, last_payment_at: lastPayment },
    });
  } catch (error) {
    console.error("❌ [Subscriptions] Error actualizando suscripción:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* =========================
   GET /api/subscriptions/:id
========================= */
subscriptions.get("/:id", async (req, res) => {
  const tenantId = req.tenant?.id;
  const { id } = req.params;

  try {
    const [[row]] = await pool.query(
      `
      SELECT cs.*, c.name AS customer_name, c.email AS customer_email, c.phone_e164 AS customer_phone
      FROM customer_subscription cs
      JOIN customer c ON c.id = cs.customer_id AND c.tenant_id = cs.tenant_id
      WHERE cs.id = ? AND cs.tenant_id = ?
      LIMIT 1
    `,
      [id, tenantId]
    );

    if (!row) {
      return res.status(404).json({ ok: false, error: "Suscripción no encontrada" });
    }

    res.json({ ok: true, data: row });
  } catch (error) {
    console.error("❌ [Subscriptions] Error obteniendo suscripción:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default subscriptions;

