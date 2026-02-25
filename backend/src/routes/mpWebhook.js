// src/routes/mpWebhook.js
import { Router } from "express";
import fetch from "node-fetch";
import { pool } from "../db.js";
import { getTenantMpToken } from "../services/mercadoPago.js";
import { sendWhatsAppText } from "../whatsapp.js";
import { getTenantWhatsAppHub } from "../services/whatsappHub.js";
import { getSection } from "../services/config.js";

// Helper para obtener nombre del tenant
async function getTenantName(tenantId) {
  if (!tenantId) return "ARJA ERP";
  try {
    const [[tenant]] = await pool.query("SELECT name FROM tenant WHERE id = ? LIMIT 1", [tenantId]);
    return tenant?.name || "ARJA ERP";
  } catch (error) {
    console.error(`[MP Webhook] Error obteniendo nombre del tenant ${tenantId}:`, error.message);
    return "ARJA ERP";
  }
}

// Helper para obtener teléfono del negocio para notificaciones
async function getBusinessPhone(tenantId) {
  if (!tenantId) return null;
  try {
    // Intentar obtener desde la configuración de contacto
    const contactSection = await getSection("contact", tenantId).catch(() => ({}));
    if (contactSection?.whatsapp) {
      // Normalizar teléfono (remover espacios, guiones, etc.)
      const phone = String(contactSection.whatsapp).replace(/[\s\-\(\)]/g, "");
      if (phone.startsWith("+")) return phone;
      if (phone.startsWith("54")) return `+${phone}`;
      if (phone.length >= 10) return `+54${phone}`;
    }
    
    // Fallback: obtener desde WhatsApp hub
    const hub = await getTenantWhatsAppHub(tenantId);
    if (hub?.phoneDisplay) {
      const phone = String(hub.phoneDisplay).replace(/[\s\-\(\)]/g, "");
      if (phone.startsWith("+")) return phone;
      if (phone.startsWith("54")) return `+${phone}`;
      if (phone.length >= 10) return `+54${phone}`;
    }
    
    return null;
  } catch (error) {
    console.error(`[MP Webhook] Error obteniendo teléfono del negocio ${tenantId}:`, error.message);
    return null;
  }
}

export const mpWebhook = Router();

/* =========================
   Helpers HTTP / Tokens
========================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getAllActiveTokens() {
  const [rows] = await pool.query(`
    SELECT tenant_id, mp_access_token
    FROM tenant_payment_config
    WHERE is_active = 1 AND mp_access_token IS NOT NULL
  `);
  return rows || [];
}

async function fetchJSON(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function fetchPaymentWithToken(paymentId, token) {
  return fetchJSON(`https://api.mercadopago.com/v1/payments/${paymentId}`, token);
}

async function fetchMerchantOrderWithToken(orderId, token, resourceURL) {
  // 1) SIEMPRE usar el host de Mercado Pago (válido para APP_USR / TEST).
  const mpUrl = `https://api.mercadopago.com/merchant_orders/${orderId}`;
  let r = await fetchJSON(mpUrl, token);
  if (r.ok || r.status !== 401) return r; // OK o error distinto de 401 → devolvémoslo

  // 2) Fallback ultra defensivo: probá la URL cruda si vino en body.resource
  if (resourceURL) {
    const r2 = await fetchJSON(resourceURL, token);
    return r2;
  }
  return r;
}
async function searchPaymentsByExternalRef(externalRef, token) {
  const url = `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(
    externalRef
  )}&sort=date_created&criteria=desc`;
  return fetchJSON(url, token);
}

async function fetchPreapproval(preapprovalId, token) {
  return fetchJSON(`https://api.mercadopago.com/preapproval/${preapprovalId}`, token);
}

/* ============================================
   POST /api/mp-webhook  (Notificaciones MP)
============================================ */
mpWebhook.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const q = req.query || {};

    // MP puede mandar en body o en query
    const topic = body.topic || body.type || q.topic || null;
    const id =
      body?.data?.id ||
      q.id ||
      (body.resource ? body.resource.split("/").pop() : null);

    console.log("[MP Webhook] Recibido:", {
      type: topic,
      action: body.action || null,
      paymentId: id,
      raw: { body, query: q },
    });

    // Responder rápido a MP, y procesar en background
    res.sendStatus(200);

    if (!id || !topic) return;
    setImmediate(() =>
      processMpNotification({ topic, id, resource: body.resource || null }).catch((e) =>
        console.error("❌ [MP Webhook] Error en processMpNotification:", e)
      )
    );
  } catch (e) {
    console.error("❌ [MP Webhook] Error general:", e);
    res.sendStatus(200);
  }
});

/**
 * Fallback: cuando NO podemos leer merchant_order con ningún token,
 * buscamos pagos por external_reference construyendo candidatos desde
 * los turnos 'pending_deposit' recientes / con hold vigente.
 */
async function tryResolveByRecentPendingAppointments() {
  // 1) Buscar turnos "pendientes de seña" recientes (últimas 24h o con hold vigente)
  const [appts] = await pool.query(
    `
    SELECT a.tenant_id, a.id AS appointment_id
    FROM appointment a
    WHERE a.status = 'pending_deposit'
      AND (
        a.hold_until IS NULL
        OR a.hold_until > NOW()
        OR a.created_at >= NOW() - INTERVAL 1 DAY
      )
    ORDER BY a.created_at DESC
    LIMIT 80
  `
  );
  if (!appts.length) return null;

  // 2) Tokens activos por tenant (map rápido)
  const tokens = await getAllActiveTokens();
  const tokenByTenant = new Map(tokens.map((t) => [t.tenant_id, t.mp_access_token]));

  // 3) Probar cada (tenant, appointment) buscando por external_reference
  for (const a of appts) {
    const token = tokenByTenant.get(a.tenant_id);
    if (!token) continue;
    const extRef = `${a.tenant_id}:${a.appointment_id}`;
    const sr = await searchPaymentsByExternalRef(extRef, token);
    const results = Array.isArray(sr.data?.results) ? sr.data.results : [];
    console.log(`[FALLBACK SEARCH] tenant=${a.tenant_id} extref=${extRef} -> count=${results.length} status=${sr.status}`);
    if (!results.length) continue;

    // tomar approved si existe, sino el más reciente
    const hit = results.find((r) => r.status === "approved") || results[0];
    if (hit?.id) {
      return { paymentId: String(hit.id) };
    }
  }

  return null;
}

/**
 * Resuelve merchant_order → payment y llama a processPaymentNotification
 */
async function processMpNotification({ topic, id, resource }) {
  // Manejar tanto "preapproval" como "subscription_preapproval"
  if (topic === "preapproval" || topic === "subscription_preapproval") {
    await processPreapprovalNotification(id);
    return;
  }

  const tokens = await getAllActiveTokens();
  if (!tokens.length) {
    console.error("❌ [MP Webhook] Sin tokens activos");
    return;
  }

  let paymentId = null;

  // Hasta 5 intentos (lag de consistencia puede ser >1s en sandbox)
  for (let attempt = 0; attempt < 5 && !paymentId; attempt++) {
    for (const t of tokens) {
      try {
        if (topic === "payment") {
          // Intentar leer el pago directo con este token
          const p = await fetchPaymentWithToken(id, t.mp_access_token);
          console.log(`[PAY] tenant=${t.tenant_id} GET /v1/payments/${id} -> ${p.status}`);
          if (p.ok && p.data?.id) {
            paymentId = String(p.data.id);
            break;
          }
        } else {
          // topic === 'merchant_order'
          const mo = await fetchMerchantOrderWithToken(id, t.mp_access_token, resource);
          const hasPayments = Array.isArray(mo.data?.payments) && mo.data.payments.length > 0;
          console.log(
            `[MO] tenant=${t.tenant_id} GET MO ${id} -> ${mo.status} hasPayments=${hasPayments}`
          );
          if (!mo.ok) continue;

          let pickId = null;

          if (hasPayments) {
            const payments = mo.data.payments;
            // Elegimos aprobado si hay, sino el último
            const pick =
              payments.find((p) => p.status === "approved") ||
              payments[payments.length - 1] ||
              payments[0];
            pickId = pick?.id ? String(pick.id) : null;
          } else if (mo.data?.external_reference) {
            // Fallback: buscar por external_reference
            const sr = await searchPaymentsByExternalRef(
              mo.data.external_reference,
              t.mp_access_token
            );
            const results = Array.isArray(sr.data?.results) ? sr.data.results : [];
            console.log(
              `[MO->SEARCH] extref=${mo.data.external_reference} -> count=${results.length} status=${sr.status}`
            );
            if (results.length) {
              const hit =
                results.find((r) => r.status === "approved") || results[0];
              pickId = hit?.id ? String(hit.id) : null;
            }
          }

          if (!pickId) continue;

          const p = await fetchPaymentWithToken(pickId, t.mp_access_token);
          console.log(`[MO->PAY] tenant=${t.tenant_id} GET /v1/payments/${pickId} -> ${p.status}`);
          if (p.ok && p.data?.id) {
            paymentId = String(p.data.id);
            break;
          }
        }
      } catch (e) {
        console.log(`[MO] token tenant=${t.tenant_id} error:`, e?.message || e);
        // probar siguiente token
      }
    }

    if (!paymentId) {
      const wait = 900 * (attempt + 1);
      console.log(`[MO] reintento ${attempt + 1} en ${wait}ms…`);
      await sleep(wait);
    }
  }

  // Si no se pudo resolver por MO ni por payment directo: fallback global
  if (!paymentId) {
    console.log(`[MO] No se pudo leer MO con ningún token. Intentando fallback por turnos pendientes…`);
    const fallback = await tryResolveByRecentPendingAppointments();
    if (fallback?.paymentId) {
      paymentId = fallback.paymentId;
    }
  }

  if (!paymentId) {
    console.error(`❌ [MP Webhook] No se pudo obtener info del pago: ${id}`);
    return;
  }

  console.log(`🔄 [MP Webhook] Procesando payment ${paymentId}`);
  await processPaymentNotification(paymentId);
  console.log(`✅ [MP Webhook] Procesado payment ${paymentId}`);
}

/* ============================================
   Procesar un payment_id concreto
============================================ */
function mapPreapprovalStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (["authorized", "approved", "active"].includes(normalized)) return "authorized";
  if (["paused", "suspended"].includes(normalized)) return "paused";
  if (["cancelled", "canceled", "cancelled_by_user"].includes(normalized)) return "cancelled";
  return "pending";
}

async function processPreapprovalNotification(preapprovalId) {
  try {
    console.log(`[MP Webhook] Procesando preapproval ${preapprovalId}`);

    // Primero intentar con el token de la plataforma (para suscripciones de plataforma)
    const PLATFORM_MP_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.PLATFORM_MP_TOKEN || "";
    let preapproval = null;
    
    if (PLATFORM_MP_TOKEN) {
      try {
        const { ok, data } = await fetchPreapproval(preapprovalId, PLATFORM_MP_TOKEN);
        console.log(`[PREAPPROVAL] [PLATFORM] GET ${preapprovalId} -> ${ok}`);
        if (ok && data?.id) {
          preapproval = { data, tenantCandidate: null, isPlatform: true };
        }
      } catch (err) {
        console.warn("[MP Webhook] Error leyendo preapproval con token de plataforma:", err.message);
      }
    }

    // Si no se encontró con el token de plataforma, intentar con tokens de tenants
    if (!preapproval) {
      const tokens = await getAllActiveTokens();
      if (tokens.length > 0) {
        for (const t of tokens) {
          try {
            const { ok, data } = await fetchPreapproval(preapprovalId, t.mp_access_token);
            console.log(`[PREAPPROVAL] tenant=${t.tenant_id} GET ${preapprovalId} -> ${ok}`);
            if (ok && data?.id) {
              preapproval = { data, tenantCandidate: t.tenant_id, isPlatform: false };
              break;
            }
          } catch (err) {
            console.warn("[MP Webhook] Error leyendo preapproval:", err.message);
          }
        }
      }
    }

    if (!preapproval) {
      console.warn(`[MP Webhook] No se encontró info para preapproval ${preapprovalId}`);
      return;
    }

    const data = preapproval.data;
    let tenantId = null;
    let subscriptionId = null;

    if (data.external_reference) {
      const parts = String(data.external_reference).split(":");
      // Formato para customer_subscription: tenant:subscription:id
      if (parts.length === 3 && parts[1] === "subscription" && Number.isFinite(Number(parts[0])) && Number.isFinite(Number(parts[2]))) {
        tenantId = Number(parts[0]);
        subscriptionId = Number(parts[2]);
      }
      // Formato para platform_subscription: tenant:plan:code (o tenant:session:id:plan:code en onboarding)
      // En este caso, buscamos por mp_preapproval_id directamente
    }

    let subscriptionRow = null;
    let platformSubRow = null;

    // Primero buscar por mp_preapproval_id (más confiable)
    // Si es una suscripción de plataforma, buscar primero en platform_subscription
    if (!subscriptionRow && !platformSubRow) {
      if (preapproval.isPlatform) {
        // Buscar primero en platform_subscription para suscripciones de plataforma
        const [[platformSub]] = await pool.query(
          `SELECT * FROM platform_subscription WHERE mp_preapproval_id = ? LIMIT 1`,
          [preapprovalId]
        );
        if (platformSub) {
          platformSubRow = platformSub;
          tenantId = platformSub.tenant_id;
          subscriptionId = platformSub.id;
        } else {
          // Si no se encuentra, buscar en customer_subscription como fallback
          const [[customerSub]] = await pool.query(
            `SELECT * FROM customer_subscription WHERE mp_preapproval_id = ? LIMIT 1`,
            [preapprovalId]
          );
          if (customerSub) {
            subscriptionRow = customerSub;
            tenantId = customerSub.tenant_id;
            subscriptionId = customerSub.id;
          }
        }
      } else {
        // Buscar primero en customer_subscription para suscripciones de clientes
        const [[customerSub]] = await pool.query(
          `SELECT * FROM customer_subscription WHERE mp_preapproval_id = ? LIMIT 1`,
          [preapprovalId]
        );
        if (customerSub) {
          subscriptionRow = customerSub;
          tenantId = customerSub.tenant_id;
          subscriptionId = customerSub.id;
        } else {
          // Si no se encuentra, buscar en platform_subscription como fallback
          const [[platformSub]] = await pool.query(
            `SELECT * FROM platform_subscription WHERE mp_preapproval_id = ? LIMIT 1`,
            [preapprovalId]
          );
          if (platformSub) {
            platformSubRow = platformSub;
            tenantId = platformSub.tenant_id;
            subscriptionId = platformSub.id;
          }
        }
      }
    }

    // Si no se encontró por mp_preapproval_id y tenemos tenantId y subscriptionId del external_reference
    if (!subscriptionRow && !platformSubRow && tenantId && subscriptionId) {
      const [[row]] = await pool.query(
        `SELECT * FROM customer_subscription WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [subscriptionId, tenantId]
      );
      subscriptionRow = row || null;
    }

    if (!subscriptionRow && !platformSubRow) {
      console.warn(`[MP Webhook] No hay suscripción asociada al preapproval ${preapprovalId}`);
      return;
    }

    const status = mapPreapprovalStatus(data.status);
    const nextCharge = data.auto_recurring?.next_payment_date
      ? new Date(data.auto_recurring.next_payment_date)
      : null;
    const lastPayment = data.auto_recurring?.last_payment_date
      ? new Date(data.auto_recurring.last_payment_date)
      : null;

    if (subscriptionRow) {
      await pool.query(
        `UPDATE customer_subscription
            SET status = ?,
                next_charge_at = ?,
                last_payment_at = ?,
                mp_init_point = COALESCE(?, mp_init_point),
                mp_sandbox_init_point = COALESCE(?, mp_sandbox_init_point),
                external_reference = COALESCE(?, external_reference),
                canceled_at = CASE WHEN ? = 'cancelled' THEN NOW() ELSE canceled_at END,
                updated_at = NOW()
          WHERE id = ? AND tenant_id = ?`,
        [
          status,
          nextCharge,
          lastPayment,
          data.init_point || null,
          data.sandbox_init_point || null,
          data.external_reference || null,
          status,
          subscriptionId,
          tenantId,
        ]
      );

      console.log(
        `[MP Webhook] Suscripción ${subscriptionId} (customer) actualizada -> status=${status} next=${nextCharge}`
      );
    } else if (platformSubRow) {
      await pool.query(
        `UPDATE platform_subscription
            SET status = ?,
                mp_status = ?,
                last_payment_at = COALESCE(?, last_payment_at),
                next_charge_at = COALESCE(?, next_charge_at),
                activated_at = CASE WHEN ? = 'authorized' AND activated_at IS NULL THEN NOW() ELSE activated_at END,
                cancelled_at = CASE WHEN ? IN ('cancelled','error') AND cancelled_at IS NULL THEN NOW() ELSE cancelled_at END,
                updated_at = NOW()
          WHERE id = ? AND tenant_id = ?`,
        [
          status,
          data.status || status,
          lastPayment,
          nextCharge,
          status,
          status,
          subscriptionId,
          tenantId,
        ]
      );

      console.log(
        `[MP Webhook] Suscripción plataforma ${subscriptionId} actualizada -> status=${status}`
      );

      // Si la suscripción fue autorizada, actualizar el estado del tenant de "trial" a "active"
      if (status === "authorized" && tenantId) {
        try {
          const [updateResult] = await pool.query(
            `UPDATE tenant 
             SET status = 'active', 
                 subscription_status = 'active',
                 updated_at = NOW()
             WHERE id = ? AND status = 'trial'`,
            [tenantId]
          );
          
          if (updateResult.affectedRows > 0) {
            console.log(`✅ [MP Webhook] Tenant ${tenantId} actualizado de "trial" a "active"`);
          }
        } catch (tenantUpdateError) {
          console.error(`❌ [MP Webhook] Error actualizando estado del tenant ${tenantId}:`, tenantUpdateError.message);
          // No lanzar el error - la suscripción ya se actualizó correctamente
        }
      }
    }
  } catch (error) {
    console.error("❌ [MP Webhook] Error procesando preapproval:", error);
  }
}

// Lock para evitar procesamiento concurrente del mismo pago
const processingLocks = new Map();

async function processPaymentNotification(paymentId) {
  // Verificar si ya se está procesando este pago (evitar duplicados concurrentes)
  if (processingLocks.has(paymentId)) {
    console.log(`⚠️ [MP Webhook] Payment ${paymentId} ya está siendo procesado. Saltando duplicado.`);
    return;
  }

  // Agregar lock
  processingLocks.set(paymentId, true);
  
  try {
    console.log(`🔄 [MP Webhook] ════════════════════════════════════`);
    console.log(`🔄 [MP Webhook] Procesando payment ${paymentId}`);
    console.log(`🔄 [MP Webhook] Timestamp: ${new Date().toISOString()}`);

    // 1) Buscar si ya tenemos registro de este pago PROCESADO
    const [[existingPayment]] = await pool.query(
      `
      SELECT p.*, t.subdomain as tenant_slug, a.status as appointment_status, a.deposit_paid_at
      FROM payment p
      LEFT JOIN tenant t ON t.id = p.tenant_id
      LEFT JOIN appointment a ON a.id = p.appointment_id AND a.tenant_id = p.tenant_id
      WHERE p.mp_payment_id = ? AND p.mp_payment_status = 'approved'
      LIMIT 1
    `,
      [paymentId]
    );

    // Si el pago ya fue procesado y el turno ya tiene deposit_paid_at, saltar
    if (existingPayment && existingPayment.appointment_status && 
        (existingPayment.appointment_status === 'deposit_paid' || existingPayment.appointment_status === 'confirmed') &&
        existingPayment.deposit_paid_at) {
      console.log(`⚠️ [MP Webhook] ⚠️ Payment ${paymentId} ya fue procesado completamente. Turno ${existingPayment.appointment_id} ya está en estado ${existingPayment.appointment_status}. Saltando para evitar duplicados.`);
      return;
    }

    let tenantId, appointmentId, accessToken;

    if (existingPayment) {
      // Ya existe en nuestra DB
      tenantId = existingPayment.tenant_id;
      appointmentId = existingPayment.appointment_id;
      accessToken = await getTenantMpToken(tenantId);
    } else {
      // Primera vez: localizar el token correcto probando todos los tenants activos
      const [activeConfigs] = await pool.query(
        `
        SELECT tenant_id, mp_access_token
        FROM tenant_payment_config
        WHERE is_active = 1 AND mp_access_token IS NOT NULL
      `
      );

      let paymentInfo = null;

      for (const config of activeConfigs) {
        try {
          const response = await fetch(
            `https://api.mercadopago.com/v1/payments/${paymentId}`,
            { headers: { Authorization: `Bearer ${config.mp_access_token}` } }
          );

          if (response.ok) {
            paymentInfo = await response.json();
            tenantId = config.tenant_id;
            accessToken = config.mp_access_token;
            break;
          }
        } catch {
          // probar siguiente token
        }
      }

      if (!paymentInfo) {
        console.error("❌ [MP Webhook] No se pudo obtener info del pago:", paymentId);
        return;
      }

      // Verificar si es un pago de suscripción (tiene preapproval_id o subscription_id)
      const preapprovalId = paymentInfo.preapproval_id || paymentInfo.subscription_id || null;
      
      if (preapprovalId) {
        console.log(`💳 [MP Webhook] Pago ${paymentId} está asociado a preapproval ${preapprovalId} (suscripción)`);
        
        // Buscar la suscripción por mp_preapproval_id
        const [[platformSub]] = await pool.query(
          `SELECT * FROM platform_subscription WHERE mp_preapproval_id = ? LIMIT 1`,
          [preapprovalId]
        );
        
        if (platformSub) {
          console.log(`✅ [MP Webhook] Suscripción encontrada: ID ${platformSub.id}, tenant ${platformSub.tenant_id}`);
          
          // Si el pago fue aprobado, actualizar la suscripción
          if (paymentInfo.status === "approved") {
            const normalizedStatus = mapPreapprovalStatus("authorized");
            
            await pool.query(
              `UPDATE platform_subscription
               SET status = ?,
                   mp_status = ?,
                   last_payment_at = NOW(),
                   activated_at = CASE WHEN activated_at IS NULL THEN NOW() ELSE activated_at END,
                   updated_at = NOW()
               WHERE id = ? AND tenant_id = ?`,
              [
                normalizedStatus,
                "authorized",
                platformSub.id,
                platformSub.tenant_id,
              ]
            );
            
            console.log(`✅ [MP Webhook] Suscripción ${platformSub.id} actualizada a "authorized"`);
            
            // Actualizar el estado del tenant de "trial" a "active"
            const [updateResult] = await pool.query(
              `UPDATE tenant 
               SET status = 'active', 
                   subscription_status = 'active',
                   updated_at = NOW()
               WHERE id = ? AND status = 'trial'`,
              [platformSub.tenant_id]
            );
            
            if (updateResult.affectedRows > 0) {
              console.log(`✅ [MP Webhook] Tenant ${platformSub.tenant_id} actualizado de "trial" a "active"`);
            }
          }
          
          // También actualizar el preapproval directamente para asegurar sincronización
          await processPreapprovalNotification(preapprovalId);
          
          return; // Salir, ya procesamos la suscripción
        } else {
          console.warn(`⚠️ [MP Webhook] No se encontró suscripción con preapproval_id ${preapprovalId}`);
        }
      } else {
        // Si el pago no tiene preapproval_id, puede ser un pago de suscripción que aún no está vinculado
        // Buscar suscripciones pendientes del tenant y verificar su estado en MP
        console.log(`🔍 [MP Webhook] Pago ${paymentId} no tiene preapproval_id, verificando suscripciones pendientes del tenant ${tenantId}...`);
        
        const [pendingSubs] = await pool.query(
          `SELECT * FROM platform_subscription 
           WHERE tenant_id = ? 
           AND status = 'pending' 
           AND mp_preapproval_id IS NOT NULL
           AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
           ORDER BY created_at DESC
           LIMIT 10`,
          [tenantId]
        );
        
        if (pendingSubs.length > 0) {
          console.log(`💡 [MP Webhook] Encontradas ${pendingSubs.length} suscripción(es) pendiente(s), verificando estado en MP...`);
          
          // Verificar cada suscripción pendiente
          for (const sub of pendingSubs) {
            try {
              const preapprovalToken = await getTenantMpToken(tenantId);
              if (!preapprovalToken) continue;
              
              const { ok, data: preapprovalData } = await fetchPreapproval(sub.mp_preapproval_id, preapprovalToken);
              if (ok && preapprovalData) {
                const preapprovalStatus = mapPreapprovalStatus(preapprovalData.status);
                
                // Si el preapproval está autorizado, actualizar la suscripción
                if (preapprovalStatus === "authorized") {
                  console.log(`✅ [MP Webhook] Suscripción ${sub.id} está autorizada en MP (preapproval ${sub.mp_preapproval_id}), actualizando...`);
                  
                  const nextCharge = preapprovalData.auto_recurring?.next_payment_date
                    ? new Date(preapprovalData.auto_recurring.next_payment_date)
                    : null;
                  const lastPayment = preapprovalData.auto_recurring?.last_payment_date
                    ? new Date(preapprovalData.auto_recurring.last_payment_date)
                    : null;
                  
                  await pool.query(
                    `UPDATE platform_subscription
                     SET status = ?,
                         mp_status = ?,
                         last_payment_at = COALESCE(?, last_payment_at),
                         next_charge_at = COALESCE(?, next_charge_at),
                         activated_at = CASE WHEN activated_at IS NULL THEN NOW() ELSE activated_at END,
                         updated_at = NOW()
                     WHERE id = ? AND tenant_id = ?`,
                    [
                      preapprovalStatus,
                      preapprovalData.status || preapprovalStatus,
                      lastPayment,
                      nextCharge,
                      sub.id,
                      sub.tenant_id,
                    ]
                  );
                  
                  console.log(`✅ [MP Webhook] Suscripción ${sub.id} actualizada a "authorized"`);
                  
                  // Actualizar tenant
                  const [updateResult] = await pool.query(
                    `UPDATE tenant 
                     SET status = 'active', 
                         subscription_status = 'active',
                         updated_at = NOW()
                     WHERE id = ? AND status = 'trial'`,
                    [sub.tenant_id]
                  );
                  
                  if (updateResult.affectedRows > 0) {
                    console.log(`✅ [MP Webhook] Tenant ${sub.tenant_id} actualizado de "trial" a "active"`);
                  }
                  
                  return; // Salir después de actualizar la primera suscripción autorizada
                }
              }
            } catch (err) {
              console.warn(`⚠️ [MP Webhook] Error verificando preapproval ${sub.mp_preapproval_id}:`, err.message);
            }
          }
        }
      }

      // Verificar si es un pago de suscripción de cliente (membership)
      // El external_reference tiene formato: 
      //   - Nueva: tenant:tenantId:customer:customerId:plan:planId:subscription
      //   - Renovación: tenant:tenantId:customer:customerId:plan:planId:subscription:renewal:timestamp
      //   - Upgrade: tenant:tenantId:customer:customerId:plan:planId:subscription:upgrade:subscriptionId
      const externalRef = paymentInfo.external_reference || "";
      const metadata = paymentInfo.metadata || {};
      const isCustomerSubscription = externalRef.includes(":subscription") || 
                                      externalRef.includes(":renewal") ||
                                      externalRef.includes(":upgrade") ||
                                      metadata.subscription_type === "membership" ||
                                      metadata.subscription_type === "membership_renewal" ||
                                      metadata.subscription_type === "membership_upgrade" ||
                                      metadata.subscription_type === "membership_reminder";
      
      console.log(`🔍 [MP Webhook] Verificando pago ${paymentId}:`, {
        external_reference: externalRef,
        metadata: metadata,
        isCustomerSubscription: isCustomerSubscription,
        status: paymentInfo.status
      });
      
      if (isCustomerSubscription) {
        console.log(`💳 [MP Webhook] Pago ${paymentId} es de una suscripción de cliente`);
        
        // Extraer información del external_reference
        const refParts = externalRef.split(":");
        console.log(`🔍 [MP Webhook] Partes del external_reference:`, refParts);
        
        if (refParts.length >= 6 && refParts[0] === "tenant") {
          const refTenantId = parseInt(refParts[1], 10);
          const refCustomerId = parseInt(refParts[3], 10);
          const refPlanId = parseInt(refParts[5], 10);
          const isRenewal = externalRef.includes(":renewal") || 
                            (paymentInfo.metadata && paymentInfo.metadata.subscription_type === "membership_renewal");
          const isUpgrade = externalRef.includes(":upgrade") || 
                           (paymentInfo.metadata && paymentInfo.metadata.subscription_type === "membership_upgrade");
          const subscriptionId = paymentInfo.metadata?.subscription_id || 
                                 (isUpgrade && refParts.length > 8 ? parseInt(refParts[8], 10) : null);
          
          let subscription = null;
          
          // Si es una renovación o upgrade y tenemos el subscription_id, buscar por ID
          if ((isRenewal || isUpgrade) && subscriptionId) {
            const [renewalSubs] = await pool.query(
              `SELECT cs.*, mp.duration_months 
               FROM customer_subscription cs
               INNER JOIN membership_plan mp ON cs.membership_plan_id = mp.id
               WHERE cs.id = ? 
               AND cs.tenant_id = ?
               AND cs.customer_id = ?
               AND cs.membership_plan_id = ?
               AND cs.status IN ('authorized', 'pending')
               LIMIT 1`,
              [subscriptionId, refTenantId, refCustomerId, refPlanId]
            );
            
            if (renewalSubs.length > 0) {
              subscription = renewalSubs[0];
              console.log(`✅ [MP Webhook] Suscripción de ${isUpgrade ? 'upgrade' : 'renovación'} encontrada: ID ${subscription.id}`);
            }
          }
          
          // Si no es renovación/upgrade o no encontramos por ID, buscar suscripción pendiente
          // Primero intentar por external_reference (más preciso)
          if (!subscription && externalRef) {
            const [refSubs] = await pool.query(
              `SELECT cs.*, mp.duration_months 
               FROM customer_subscription cs
               INNER JOIN membership_plan mp ON cs.membership_plan_id = mp.id
               WHERE cs.external_reference = ?
               AND cs.status IN ('pending', 'authorized')
               ORDER BY cs.created_at DESC
               LIMIT 1`,
              [externalRef]
            );
            
            if (refSubs.length > 0) {
              subscription = refSubs[0];
              console.log(`✅ [MP Webhook] Suscripción encontrada por external_reference: ID ${subscription.id}`);
            }
          }
          
          // Si aún no encontramos, buscar por tenant/customer/plan
          if (!subscription) {
            const [customerSubs] = await pool.query(
              `SELECT cs.*, mp.duration_months 
               FROM customer_subscription cs
               INNER JOIN membership_plan mp ON cs.membership_plan_id = mp.id
               WHERE cs.tenant_id = ? 
               AND cs.customer_id = ?
               AND cs.membership_plan_id = ?
               AND cs.status = 'pending'
               ORDER BY cs.created_at DESC
               LIMIT 1`,
              [refTenantId, refCustomerId, refPlanId]
            );
            
            if (customerSubs.length > 0) {
              subscription = customerSubs[0];
              console.log(`✅ [MP Webhook] Suscripción de cliente encontrada: ID ${subscription.id}`);
            }
          }
          
          if (subscription) {
            // Si el pago fue aprobado, activar/renovar la suscripción
            if (paymentInfo.status === "approved") {
              // Calcular próxima fecha de renovación usando duration_months del plan
              const nextChargeDate = new Date();
              const durationMonths = subscription.duration_months || subscription.frequency || 1;
              nextChargeDate.setMonth(nextChargeDate.getMonth() + durationMonths);
              
              await pool.query(
                `UPDATE customer_subscription
                 SET status = 'authorized',
                     last_payment_at = NOW(),
                     next_charge_at = ?,
                     updated_at = NOW()
                 WHERE id = ?`,
                [nextChargeDate, subscription.id]
              );
              
              const actionText = isUpgrade ? 'actualizada (upgrade)' : (isRenewal ? 'renovada' : 'activada');
              console.log(`✅ [MP Webhook] Suscripción de cliente ${subscription.id} ${actionText}. Estado: authorized. Próxima renovación: ${nextChargeDate.toISOString()}`);
              
              // Guardar información del pago para referencia
              await pool.query(
                `INSERT INTO payment 
                 (tenant_id, mp_payment_id, mp_payment_status, amount_cents, currency, 
                  external_reference, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
                 ON DUPLICATE KEY UPDATE 
                 mp_payment_status = VALUES(mp_payment_status),
                 updated_at = NOW()`,
                [
                  refTenantId,
                  paymentId,
                  paymentInfo.status,
                  Math.round(Number(paymentInfo.transaction_amount || subscription.amount_decimal) * 100),
                  paymentInfo.currency_id || subscription.currency,
                  externalRef
                ]
              );
              
              return; // Salir, ya procesamos la suscripción
            } else if (paymentInfo.status === "rejected" || paymentInfo.status === "cancelled") {
              // Si el pago fue rechazado
              if (isRenewal) {
                // Para renovaciones rechazadas, mantener la suscripción activa pero marcar como pendiente
                // para que el script de renovación intente nuevamente
                await pool.query(
                  `UPDATE customer_subscription
                   SET status = 'pending',
                       updated_at = NOW()
                   WHERE id = ?`,
                  [subscription.id]
                );
                
                console.log(`⚠️ [MP Webhook] Renovación rechazada para suscripción ${subscription.id}. Se intentará nuevamente en la próxima ejecución del script.`);
              } else {
                // Para nuevas suscripciones rechazadas, cancelar
                await pool.query(
                  `UPDATE customer_subscription
                   SET status = 'cancelled',
                       canceled_at = NOW(),
                       updated_at = NOW()
                   WHERE id = ?`,
                  [subscription.id]
                );
                
                console.log(`❌ [MP Webhook] Suscripción de cliente ${subscription.id} cancelada por pago rechazado`);
              }
              return;
            }
          } else {
            console.warn(`⚠️ [MP Webhook] No se encontró suscripción ${isRenewal ? 'para renovar' : 'pendiente'} para tenant ${refTenantId}, customer ${refCustomerId}, plan ${refPlanId}`);
          }
        }
      }
      
      // Si no es una suscripción de cliente, continuar con el flujo normal de pagos de turnos
      // Extraer tenant y appointment del external_reference (formato tenantId:appointmentId)
      const [refTenantId, refAppointmentId] = String(
        paymentInfo.external_reference || ""
      ).split(":");

      if (!refTenantId || !refAppointmentId) {
        console.error(
          "❌ [MP Webhook] External reference inválido:",
          paymentInfo.external_reference
        );
        return;
      }

      tenantId = parseInt(refTenantId, 10);
      appointmentId = parseInt(refAppointmentId, 10);

      // Crear/Actualizar registro del pago (idempotente por unique mp_payment_id en tu tabla)
      await pool.query(
        `
        INSERT INTO payment 
          (tenant_id, appointment_id, method, mp_payment_id, mp_preference_id, 
           amount_cents, currency, mp_payment_status, created_at)
        VALUES (?, ?, 'mercadopago', ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          mp_payment_status = VALUES(mp_payment_status),
          amount_cents = VALUES(amount_cents)
      `,
        [
          tenantId,
          appointmentId,
          paymentInfo.id,
          paymentInfo.preference_id || null,
          Math.round(Number(paymentInfo.transaction_amount || 0) * 100),
          paymentInfo.currency_id || "ARS",
          paymentInfo.status,
        ]
      );
    }

    // 2) Obtener estado actual del pago desde MP con el token resuelto
    const mpResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!mpResponse.ok) {
      console.error("❌ [MP Webhook] Error obteniendo pago:", await mpResponse.text());
      return;
    }

    const paymentInfo = await mpResponse.json();

    // Verificar si es un pago de suscripción de cliente (membership)
    // El external_reference tiene formato: 
    //   - Nueva suscripción: tenant:tenantId:customer:customerId:plan:planId:subscription
    //   - Renovación: tenant:tenantId:customer:customerId:plan:planId:subscription:renewal:timestamp
    const externalRef = paymentInfo.external_reference || "";
    const isCustomerSubscription = externalRef.includes(":subscription") || 
                                    (paymentInfo.metadata && (
                                      paymentInfo.metadata.subscription_type === "membership" ||
                                      paymentInfo.metadata.subscription_type === "membership_renewal"
                                    ));
    
    if (isCustomerSubscription) {
      const isRenewal = externalRef.includes(":renewal") || 
                        (paymentInfo.metadata && paymentInfo.metadata.subscription_type === "membership_renewal");
      
      console.log(`💳 [MP Webhook] Pago ${paymentId} es de una suscripción de cliente${isRenewal ? ' (renovación)' : ''}`);
      
      // Extraer información del external_reference
      const refParts = externalRef.split(":");
      if (refParts.length >= 6 && refParts[0] === "tenant") {
        const refTenantId = parseInt(refParts[1], 10);
        const refCustomerId = parseInt(refParts[3], 10);
        const refPlanId = parseInt(refParts[5], 10);
        const subscriptionId = paymentInfo.metadata?.subscription_id;
        
        let subscription = null;
        
        if ((isRenewal || isUpgrade) && subscriptionId) {
          // Para renovaciones o upgrades, buscar la suscripción por ID
          const [renewalSubs] = await pool.query(
            `SELECT cs.*, mp.duration_months 
             FROM customer_subscription cs
             INNER JOIN membership_plan mp ON cs.membership_plan_id = mp.id
             WHERE cs.id = ? 
             AND cs.tenant_id = ?
             AND cs.customer_id = ?
             AND cs.membership_plan_id = ?
             LIMIT 1`,
            [subscriptionId, refTenantId, refCustomerId, refPlanId]
          );
          
          if (renewalSubs.length > 0) {
            subscription = renewalSubs[0];
            console.log(`✅ [MP Webhook] Suscripción de ${isUpgrade ? 'upgrade' : 'renovación'} encontrada: ID ${subscription.id}`);
          }
        } else {
          // Para nuevas suscripciones, buscar primero por external_reference
          if (externalRef) {
            const [refSubs] = await pool.query(
              `SELECT cs.*, mp.duration_months 
               FROM customer_subscription cs
               INNER JOIN membership_plan mp ON cs.membership_plan_id = mp.id
               WHERE cs.external_reference = ?
               AND cs.status IN ('pending', 'authorized')
               ORDER BY cs.created_at DESC
               LIMIT 1`,
              [externalRef]
            );
            
            if (refSubs.length > 0) {
              subscription = refSubs[0];
              console.log(`✅ [MP Webhook] Suscripción encontrada por external_reference: ID ${subscription.id}`);
            }
          }
          
          // Si no encontramos por external_reference, buscar por tenant/customer/plan
          if (!subscription) {
            const [customerSubs] = await pool.query(
              `SELECT cs.*, mp.duration_months 
               FROM customer_subscription cs
               INNER JOIN membership_plan mp ON cs.membership_plan_id = mp.id
               WHERE cs.tenant_id = ? 
               AND cs.customer_id = ?
               AND cs.membership_plan_id = ?
               AND cs.status = 'pending'
               ORDER BY cs.created_at DESC
               LIMIT 1`,
              [refTenantId, refCustomerId, refPlanId]
            );
            
            if (customerSubs.length > 0) {
              subscription = customerSubs[0];
              console.log(`✅ [MP Webhook] Suscripción de cliente encontrada: ID ${subscription.id}`);
            }
          }
        }
        
        if (subscription) {
          // Si el pago fue aprobado, activar/renovar la suscripción
          if (paymentInfo.status === "approved") {
            // Calcular próxima fecha de renovación usando duration_months del plan
            const nextChargeDate = new Date();
            const durationMonths = subscription.duration_months || subscription.frequency || 1;
            nextChargeDate.setMonth(nextChargeDate.getMonth() + durationMonths);
            
            await pool.query(
              `UPDATE customer_subscription
               SET status = 'authorized',
                   last_payment_at = NOW(),
                   next_charge_at = ?,
                   updated_at = NOW()
               WHERE id = ?`,
              [nextChargeDate, subscription.id]
            );
            
            const actionText = isUpgrade ? 'actualizada (upgrade)' : (isRenewal ? 'renovada' : 'activada');
            console.log(`✅ [MP Webhook] Suscripción de cliente ${subscription.id} ${actionText}. Próxima renovación: ${nextChargeDate.toISOString()}`);
            
            // Guardar información del pago para referencia
            await pool.query(
              `INSERT INTO payment 
               (tenant_id, mp_payment_id, mp_payment_status, amount_cents, currency, 
                external_reference, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
               ON DUPLICATE KEY UPDATE 
               mp_payment_status = VALUES(mp_payment_status),
               updated_at = NOW()`,
              [
                refTenantId,
                paymentId,
                paymentInfo.status,
                Math.round(Number(paymentInfo.transaction_amount || subscription.amount_decimal) * 100),
                paymentInfo.currency_id || subscription.currency,
                externalRef
              ]
            );
            
            return; // Salir, ya procesamos la suscripción
          } else if (paymentInfo.status === "rejected" || paymentInfo.status === "cancelled") {
            // Si el pago fue rechazado
            if (isRenewal) {
              // Para renovaciones rechazadas, mantener la suscripción activa pero marcar como pendiente
              // y crear un nuevo link de pago (el script de renovación lo hará)
              console.log(`⚠️ [MP Webhook] Renovación rechazada para suscripción ${subscription.id}. Se intentará nuevamente en la próxima ejecución del script.`);
            } else {
              // Para nuevas suscripciones rechazadas, cancelar
              await pool.query(
                `UPDATE customer_subscription
                 SET status = 'cancelled',
                     canceled_at = NOW(),
                     updated_at = NOW()
                 WHERE id = ?`,
                [subscription.id]
              );
              
              console.log(`❌ [MP Webhook] Suscripción de cliente ${subscription.id} cancelada por pago rechazado`);
            }
            return;
          }
        } else {
          console.warn(`⚠️ [MP Webhook] No se encontró suscripción ${isRenewal ? 'para renovar' : 'pendiente'} para tenant ${refTenantId}, customer ${refCustomerId}, plan ${refPlanId}`);
        }
      }
    }

    console.log(`📄 [MP Webhook] Estado del pago:`, {
      id: paymentInfo.id,
      status: paymentInfo.status,
      amount: paymentInfo.transaction_amount,
      external_ref: paymentInfo.external_reference,
    });

    // 3) Actualizar tabla payment
    await pool.query(
      `
      UPDATE payment 
      SET 
        mp_payment_status = ?
      WHERE mp_payment_id = ? OR (appointment_id = ? AND tenant_id = ? AND method = 'mercadopago')
    `,
      [paymentInfo.status, paymentId, appointmentId, tenantId]
    );

    // 4) Actualizar estado del turno
    if (paymentInfo.status === "approved") {
      console.log(`🔄 [MP Webhook] Procesando pago aprobado para turno ${appointmentId}, tenant ${tenantId}`);
      
      // Verificar si el pago ya fue procesado (evitar duplicados)
      const [[existingProcessedPayment]] = await pool.query(
        `
        SELECT mp_payment_status, created_at
        FROM payment
        WHERE mp_payment_id = ? AND mp_payment_status = 'approved'
        LIMIT 1
      `,
        [paymentId]
      );

      // Verificar si es un pago de seña (depósito)
      const [[apptCheck]] = await pool.query(
        `
        SELECT deposit_decimal, status, customer_id, service_id, instructor_id, starts_at, deposit_paid_at
        FROM appointment
        WHERE id = ? AND tenant_id = ?
        LIMIT 1
      `,
        [appointmentId, tenantId]
      );

      if (!apptCheck) {
        console.error(`❌ [MP Webhook] No se encontró turno ${appointmentId} para tenant ${tenantId}`);
        return;
      }

      console.log(`📋 [MP Webhook] Estado actual del turno: ${apptCheck.status}, seña configurada: ${apptCheck.deposit_decimal}, deposit_paid_at: ${apptCheck.deposit_paid_at}`);

      // Determinar el estado según si es un pago de seña o pago completo
      let newStatus = 'confirmed'; // Por defecto, confirmado (pago completo)
      
      if (apptCheck?.deposit_decimal != null && Number(apptCheck.deposit_decimal) > 0) {
        // Si el turno tiene seña configurada, comparar el monto pagado con la seña
        const depositAmount = Number(apptCheck.deposit_decimal);
        const paidAmount = Number(paymentInfo.transaction_amount || 0);
        
        console.log(`💰 [MP Webhook] Comparando montos: seña=${depositAmount}, pagado=${paidAmount}, diferencia=${Math.abs(paidAmount - depositAmount)}`);
        
        // Si el monto pagado coincide con la seña (o es aproximadamente igual, con tolerancia de 0.01)
        // entonces es un pago de seña, no el pago completo
        if (Math.abs(paidAmount - depositAmount) < 0.01) {
          newStatus = 'deposit_paid';
          console.log(`💰 [MP Webhook] ✅ Pago de seña recibido: $${paidAmount} para turno ${appointmentId}`);
        } else {
          // Si el monto pagado es mayor que la seña, es el pago completo
          newStatus = 'confirmed';
          console.log(`✅ [MP Webhook] ✅ Pago completo recibido para turno ${appointmentId}`);
        }
      } else {
        console.log(`ℹ️ [MP Webhook] Turno sin seña configurada, marcando como confirmado`);
      }

      // Verificar si ya fue procesado (evitar duplicados)
      const alreadyProcessed = 
        (apptCheck.status === 'deposit_paid' || apptCheck.status === 'confirmed') &&
        apptCheck.deposit_paid_at != null &&
        existingProcessedPayment != null;

      if (alreadyProcessed) {
        console.log(`⚠️ [MP Webhook] ⚠️ Este pago ya fue procesado anteriormente. Turno ${appointmentId} ya está en estado ${apptCheck.status}. Saltando actualización y notificación para evitar duplicados.`);
        return;
      }

      // Solo actualizar si el estado va a cambiar
      const needsUpdate = apptCheck.status !== newStatus;
      
      if (needsUpdate) {
        const [updateResult] = await pool.query(
          `
          UPDATE appointment 
          SET 
            status = ?,
            deposit_paid_at = COALESCE(deposit_paid_at, NOW()),
            hold_until = NULL
          WHERE id = ? AND tenant_id = ? AND status != ?
        `,
          [newStatus, appointmentId, tenantId, newStatus]
        );

        console.log(`✅ [MP Webhook] Turno ${appointmentId} actualizado a estado: ${newStatus} (filas afectadas: ${updateResult.affectedRows})`);
        
        // Solo enviar notificación si realmente se actualizó el estado
        if (updateResult.affectedRows === 0) {
          console.log(`⚠️ [MP Webhook] No se actualizó el turno (ya estaba en estado ${newStatus}). Saltando notificación para evitar duplicados.`);
          return;
        }
      } else {
        console.log(`ℹ️ [MP Webhook] Turno ya está en estado ${newStatus}. Saltando actualización.`);
        
        // Si ya está en el estado correcto pero no tiene deposit_paid_at, solo actualizar eso
        if (!apptCheck.deposit_paid_at) {
          await pool.query(
            `
            UPDATE appointment 
            SET deposit_paid_at = NOW()
            WHERE id = ? AND tenant_id = ?
          `,
            [appointmentId, tenantId]
          );
        } else {
          // Ya está completamente procesado, no enviar notificación
          console.log(`⚠️ [MP Webhook] ⚠️ Este turno ya fue completamente procesado. Saltando notificación para evitar duplicados.`);
          return;
        }
      }

      // Notificar al cliente por WhatsApp cuando se acredita el pago
      try {
        const [[appt]] = await pool.query(
          `
          SELECT 
            a.starts_at,
            c.phone_e164,
            c.name AS customer_name,
            s.name AS service_name,
            st.name AS instructor_name
          FROM appointment a
          JOIN customer c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
          JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
          JOIN instructor st ON st.id = a.instructor_id AND st.tenant_id = a.tenant_id
          WHERE a.id = ? AND a.tenant_id = ?
        `,
          [appointmentId, tenantId]
        );

        if (!appt) {
          console.warn(`⚠️ [MP Webhook] No se encontró información del turno ${appointmentId}`);
          return;
        }

        // Preparar información de fecha/hora para ambos mensajes
        const d = new Date(appt.starts_at);
        const fecha = d.toLocaleDateString("es-AR", {
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });
        const hora = d.toLocaleTimeString("es-AR", {
          hour: "2-digit",
          minute: "2-digit",
        });

        if (appt?.phone_e164) {
          const tenantName = await getTenantName(tenantId);
          const amountFormatted = paymentInfo.transaction_amount?.toLocaleString("es-AR", {
            style: "currency",
            currency: paymentInfo.currency_id || "ARS",
          });

          // Mensaje de confirmación del negocio al cliente
          const msg =
            `Hola ${appt.customer_name || "cliente"}! 👋\n\n` +
            `✅ *¡Tu turno está confirmado!*\n\n` +
            `Recibimos tu pago de seña de ${amountFormatted}.\n\n` +
            `📅 *Detalles de tu turno:*\n` +
            `• Servicio: ${appt.service_name}\n` +
            `• Con: ${appt.instructor_name}\n` +
            `• Fecha: ${fecha}\n` +
            `• Hora: ${hora}\n\n` +
            `¡Te esperamos en *${tenantName}*! 💈\n\n` +
            `Si necesitás cambiar o cancelar, avisanos con anticipación.`;

          const sendResult = await sendWhatsAppText(appt.phone_e164, msg, tenantId);
          
          if (sendResult?.skipped) {
            console.warn(`⚠️ [MP Webhook] WhatsApp saltado (sin credenciales) para ${appt.phone_e164}`);
          } else if (sendResult?.error) {
            console.error(`❌ [MP Webhook] Error enviando WhatsApp a ${appt.phone_e164}:`, sendResult.error);
          } else {
            console.log(`✅ [MP Webhook] ✅ Notificación de confirmación enviada al cliente ${appt.phone_e164} para turno ${appointmentId}`);
          }
        } else {
          console.warn(`⚠️ [MP Webhook] No se encontró teléfono para turno ${appointmentId} - cliente: ${appt.customer_name || "N/A"}`);
        }

        // Notificar al negocio que recibió el pago
        try {
          const businessPhone = await getBusinessPhone(tenantId);
          if (businessPhone) {
            const amountFormatted = paymentInfo.transaction_amount?.toLocaleString("es-AR", {
              style: "currency",
              currency: paymentInfo.currency_id || "ARS",
            });
            
            const businessMsg =
              `💰 *¡Pago recibido!*\n\n` +
              `Se recibió un pago de seña:\n` +
              `• Cliente: ${appt.customer_name || "Sin nombre"}\n` +
              `• Servicio: ${appt.service_name}\n` +
              `• Profesional: ${appt.instructor_name}\n` +
              `• Fecha: ${fecha} ${hora}\n` +
              `• Monto: ${amountFormatted}\n` +
              `• ID Pago: ${paymentId}\n\n` +
              `El turno quedó confirmado. ✅`;

            await sendWhatsAppText(businessPhone, businessMsg, tenantId);
            console.log(`✅ [MP Webhook] Notificación al negocio enviada a ${businessPhone} para pago ${paymentId}`);
          } else {
            console.warn(`⚠️ [MP Webhook] No se encontró teléfono del negocio para tenant ${tenantId}`);
          }
        } catch (businessErr) {
          console.error("⚠️ [MP Webhook] Error enviando notificación al negocio:", businessErr.message);
          // No lanzar el error para no interrumpir el proceso
        }
      } catch (waErr) {
        // Error al obtener datos del turno o enviar WhatsApp al cliente
        console.error("⚠️ [MP Webhook] Error en proceso de notificación:", waErr.message);
        console.error("⚠️ [MP Webhook] Stack:", waErr.stack);
        // No lanzar el error - el pago ya se procesó correctamente, la notificación es secundaria
      }
    } else if (paymentInfo.status === "rejected") {
      await pool.query(
        `
        UPDATE appointment 
        SET 
          status = 'cancelled',
          hold_until = NULL
        WHERE id = ? AND tenant_id = ?
      `,
        [appointmentId, tenantId]
      );

      console.log(`❌ [MP Webhook] Turno ${appointmentId} cancelado por pago rechazado`);
    } else if (
      paymentInfo.status === "in_process" ||
      paymentInfo.status === "pending"
    ) {
      await pool.query(
        `
        UPDATE appointment 
        SET status = 'pending_deposit'
        WHERE id = ? AND tenant_id = ?
      `,
        [appointmentId, tenantId]
      );

      console.log(`⏳ [MP Webhook] Turno ${appointmentId} en espera de pago`);
    } else {
      console.log(`ℹ️ [MP Webhook] Estado del pago ${paymentId}: ${paymentInfo.status} - no se actualiza el turno`);
    }
    
    console.log(`✅ [MP Webhook] Procesamiento completado para payment ${paymentId}`);
    console.log(`🔄 [MP Webhook] ════════════════════════════════════`);
  } catch (error) {
    console.error("❌ [MP Webhook] ════════════════════════════════════");
    console.error("❌ [MP Webhook] Error procesando payment:", paymentId);
    console.error("❌ [MP Webhook] Error:", error.message);
    console.error("❌ [MP Webhook] Stack:", error.stack);
    console.error("❌ [MP Webhook] ════════════════════════════════════");
    throw error; // Re-lanzar para que se loguee arriba también
  } finally {
    // Remover lock después de un delay para evitar race conditions
    setTimeout(() => {
      processingLocks.delete(paymentId);
    }, 5000); // Esperar 5 segundos antes de permitir procesamiento nuevamente
  }
}

/* ============================================
   Health check
============================================ */
mpWebhook.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "MP Webhook endpoint activo",
    timestamp: new Date().toISOString(),
  });
});

