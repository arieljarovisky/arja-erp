import fetch from "node-fetch";
import { pool } from "../db.js";
import { getTenantMpToken } from "./mercadoPago.js";

export function sanitizeCurrency(currency) {
  const cur = String(currency || "ARS").toUpperCase();
  return cur.length === 3 ? cur : "ARS";
}

export function mapMpStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (["authorized", "approved", "active"].includes(normalized)) return "authorized";
  if (["paused", "suspended"].includes(normalized)) return "paused";
  if (["cancelled", "canceled", "cancelled_by_user"].includes(normalized)) return "cancelled";
  return "pending";
}

async function getTenantSlug(tenantId) {
  const [[tenant]] = await pool.query(
    `SELECT subdomain FROM tenant WHERE id = ? LIMIT 1`,
    [tenantId]
  );
  return tenant?.subdomain || "default";
}

export async function fetchPreapproval(preapprovalId, token) {
  const res = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function buildError(message, code) {
  const err = new Error(message);
  if (code) err.code = code;
  return err;
}

export async function createSubscriptionPreapproval({
  tenantId,
  customerId,
  amount,
  currency = "ARS",
  description,
  startDate,
  frequency = 1,
  frequencyType = "months",
  payerEmail,
  membershipPlanId,
}) {
  if (!tenantId) {
    throw buildError("Tenant no identificado", "TENANT_REQUIRED");
  }
  if (!customerId || !amount) {
    throw buildError("customerId y amount son requeridos", "INVALID_INPUT");
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw buildError("Monto inválido", "INVALID_AMOUNT");
  }

  const normalizedFrequency = Math.max(1, parseInt(frequency, 10) || 1);
  const normalizedFrequencyType =
    String(frequencyType || "months").toLowerCase() === "days" ? "days" : "months";

  const [[customer]] = await pool.query(
    `SELECT id, name, email
       FROM customer
      WHERE id = ? AND tenant_id = ?
      LIMIT 1`,
    [customerId, tenantId]
  );

  if (!customer) {
    throw buildError("Cliente no encontrado", "CUSTOMER_NOT_FOUND");
  }

  const email = payerEmail || customer.email;
  if (!email) {
    throw buildError("El cliente no tiene email. Ingresá un email para crear la suscripción.", "EMAIL_REQUIRED");
  }

  const accessToken = await getTenantMpToken(tenantId);
  if (!accessToken) {
    throw buildError("Mercado Pago no está conectado para este negocio", "MP_NOT_CONNECTED");
  }

  // Cancelar suscripciones pendientes existentes para este cliente antes de crear una nueva
  // Esto asegura que no haya conflictos con suscripciones que tienen payer_email configurado
  try {
    const [pendingSubs] = await pool.query(
      `SELECT id, mp_preapproval_id, status 
       FROM customer_subscription 
       WHERE tenant_id = ? AND customer_id = ? AND status IN ('pending', 'paused') AND mp_preapproval_id IS NOT NULL
       ORDER BY created_at DESC`,
      [tenantId, customerId]
    );

    if (pendingSubs.length > 0) {
      console.log(`[CUSTOMER_SUBSCRIPTION] Cancelando ${pendingSubs.length} suscripción(es) pendiente(s) para cliente ${customerId} antes de crear nueva`);
      
      for (const sub of pendingSubs) {
        try {
          const cancelResp = await fetch(
            `https://api.mercadopago.com/preapproval/${sub.mp_preapproval_id}`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({ status: "cancelled" }),
            }
          );

          if (cancelResp.ok) {
            await pool.query(
              `UPDATE customer_subscription 
               SET status = 'cancelled', canceled_at = NOW(), updated_at = NOW()
               WHERE id = ?`,
              [sub.id]
            );
            console.log(`[CUSTOMER_SUBSCRIPTION] Suscripción ${sub.id} cancelada exitosamente`);
          } else {
            const cancelData = await cancelResp.json().catch(() => ({}));
            console.warn(`[CUSTOMER_SUBSCRIPTION] No se pudo cancelar suscripción ${sub.id}:`, cancelData);
          }
        } catch (cancelError) {
          console.error(`[CUSTOMER_SUBSCRIPTION] Error cancelando suscripción ${sub.id}:`, cancelError.message);
          // Continuar con el proceso aunque falle la cancelación
        }
      }
    }
  } catch (cleanupError) {
    console.error("[CUSTOMER_SUBSCRIPTION] Error limpiando suscripciones pendientes:", cleanupError.message);
    // Continuar con la creación de la nueva suscripción aunque falle la limpieza
  }

  const reason =
    description?.trim() ||
    `Mensualidad ${customer.name || ""}`.trim() ||
    "Mensualidad";

  const tenantSlug = await getTenantSlug(tenantId);
  const backUrlBase = process.env.FRONTEND_URL_HTTPS || process.env.FRONTEND_URL;
  const backUrl = backUrlBase
    ? `${backUrlBase}/${tenantSlug}/subscriptions/return`
    : undefined;

  let planId = null;
  if (membershipPlanId !== undefined && membershipPlanId !== null && membershipPlanId !== "") {
    const normalizedPlanId = Number(membershipPlanId);
    if (!Number.isFinite(normalizedPlanId)) {
      throw buildError("membershipPlanId inválido", "INVALID_PLAN");
    }
    const [[plan]] = await pool.query(
      `SELECT id FROM membership_plan WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1`,
      [normalizedPlanId, tenantId]
    );
    if (!plan) {
      throw buildError("Plan de membresía no encontrado", "PLAN_NOT_FOUND");
    }
    planId = normalizedPlanId;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [ins] = await conn.query(
      `INSERT INTO customer_subscription
        (tenant_id, customer_id, membership_plan_id, reason, amount_decimal, currency, frequency, frequency_type, status, payer_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        tenantId,
        customerId,
        planId,
        reason,
        numericAmount,
        sanitizeCurrency(currency),
        normalizedFrequency,
        normalizedFrequencyType,
        email,
      ]
    );

    const subscriptionId = ins.insertId;
    const externalReference = `${tenantId}:subscription:${subscriptionId}`;

    const preapprovalPayload = {
      reason,
      payer_email: email, // Requerido por MP, pero no debería restringir quién puede pagar
      external_reference: externalReference,
      auto_recurring: {
        frequency: normalizedFrequency,
        frequency_type: normalizedFrequencyType,
        transaction_amount: numericAmount,
        currency_id: sanitizeCurrency(currency),
        start_date: startDate 
          ? new Date(startDate).toISOString() 
          : (() => {
              // Usar mañana como fecha de inicio para evitar errores de fecha pasada
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              tomorrow.setHours(0, 0, 0, 0); // Inicio del día
              return tomorrow.toISOString();
            })(),
      },
    };

    if (backUrl) {
      preapprovalPayload.back_url = backUrl;
    }

    const mpResponse = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(preapprovalPayload),
    });

    const mpData = await mpResponse.json().catch(() => ({}));

    if (!mpResponse.ok || !mpData.id) {
      await conn.rollback();
      const message = mpData?.message || mpData?.error || "Mercado Pago rechazó la creación de la suscripción";
      const err = buildError(message, "MP_PREAPPROVAL_FAILED");
      err.details = mpData;
      throw err;
    }

    const status = mapMpStatus(mpData.status);
    const nextCharge =
      mpData.auto_recurring?.next_payment_date
        ? new Date(mpData.auto_recurring.next_payment_date)
        : null;
    const lastPayment =
      mpData.auto_recurring?.last_payment_date
        ? new Date(mpData.auto_recurring.last_payment_date)
        : null;

    await conn.query(
      `UPDATE customer_subscription
          SET mp_preapproval_id = ?,
              mp_init_point = ?,
              mp_sandbox_init_point = ?,
              status = ?,
              external_reference = ?,
              next_charge_at = ?,
              last_payment_at = ?
        WHERE id = ? AND tenant_id = ?`,
      [
        mpData.id,
        mpData.init_point || null,
        mpData.sandbox_init_point || null,
        status,
        externalReference,
        nextCharge,
        lastPayment,
        subscriptionId,
        tenantId,
      ]
    );

    await conn.commit();

    return {
      subscriptionId,
      status,
      mp_preapproval_id: mpData.id,
      init_point: mpData.init_point || null,
      sandbox_init_point: mpData.sandbox_init_point || null,
      next_charge_at: nextCharge,
      last_payment_at: lastPayment,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

