/**
 * Script para renovar suscripciones automáticamente
 * 
 * Este script busca suscripciones activas que necesitan renovación
 * y crea nuevas preferencias de pago en Mercado Pago.
 * 
 * Uso:
 *   node scripts/renew-subscriptions.js
 * 
 * Se puede ejecutar como cron job:
 *   0 0 * * * node /path/to/scripts/renew-subscriptions.js
 */

import { pool } from "../src/db.js";
import { getTenantMpToken } from "../src/services/mercadoPago.js";
import { sendWhatsAppText } from "../src/whatsapp.js";

const API_URL = process.env.API_URL || process.env.RAILWAY_PUBLIC_DOMAIN || 'https://backend-production-1042.up.railway.app';
const FRONTEND_URL = process.env.FRONTEND_BASE_URL || `https://${process.env.DOMAIN || 'app.arjaerp.com'}`;

/**
 * Enviar notificación de renovación al cliente
 */
async function sendRenewalNotification(subscription, paymentLink) {
  try {
    // Obtener información del cliente
    const [customerRows] = await pool.query(
      `SELECT name, phone_e164, email FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [subscription.customer_id, subscription.tenant_id]
    );

    if (customerRows.length === 0) {
      console.warn(`[RENEW SUBSCRIPTIONS] No se encontró cliente ${subscription.customer_id}`);
      return;
    }

    const customer = customerRows[0];
    const tenantName = await getTenantName(subscription.tenant_id);
    const amountFormatted = Number(subscription.price_decimal).toLocaleString("es-AR", {
      style: "currency",
      currency: subscription.currency || "ARS",
    });

    // Enviar WhatsApp si tiene teléfono
    if (customer.phone_e164) {
      const message = 
        `🔄 *Renovación de Suscripción*\n\n` +
        `Hola ${customer.name || 'Cliente'}!\n\n` +
        `Tu suscripción *${subscription.plan_name}* necesita renovarse.\n\n` +
        `• Plan: ${subscription.plan_name}\n` +
        `• Monto: ${amountFormatted}\n` +
        `• Duración: ${subscription.frequency} ${subscription.frequency_type === 'months' ? 'mes(es)' : 'día(s)'}\n\n` +
        `Para renovar, hacé clic en el siguiente link:\n${paymentLink}\n\n` +
        `Si tenés alguna consulta, no dudes en contactarnos.`;

      const sendResult = await sendWhatsAppText(customer.phone_e164, message, subscription.tenant_id);
      
      if (sendResult?.skipped) {
        console.warn(`[RENEW SUBSCRIPTIONS] WhatsApp saltado (sin credenciales) para ${customer.phone_e164}`);
      } else if (sendResult?.error) {
        console.error(`[RENEW SUBSCRIPTIONS] Error enviando WhatsApp:`, sendResult.error);
      } else {
        console.log(`[RENEW SUBSCRIPTIONS] ✅ Notificación enviada por WhatsApp a ${customer.phone_e164}`);
      }
    } else {
      console.warn(`[RENEW SUBSCRIPTIONS] Cliente ${subscription.customer_id} no tiene teléfono configurado`);
    }

    // TODO: Enviar email si está implementado
    if (customer.email) {
      console.log(`[RENEW SUBSCRIPTIONS] Email no implementado aún para ${customer.email}`);
    }

  } catch (error) {
    console.error(`[RENEW SUBSCRIPTIONS] Error enviando notificación:`, error.message);
    throw error;
  }
}

/**
 * Obtener nombre del tenant
 */
async function getTenantName(tenantId) {
  if (!tenantId) return "ARJA ERP";
  try {
    const [[tenant]] = await pool.query("SELECT name FROM tenant WHERE id = ? LIMIT 1", [tenantId]);
    return tenant?.name || "ARJA ERP";
  } catch (error) {
    console.error(`[RENEW SUBSCRIPTIONS] Error obteniendo nombre del tenant:`, error.message);
    return "ARJA ERP";
  }
}

async function renewSubscriptions() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("[RENEW SUBSCRIPTIONS] Iniciando proceso de renovación");
  console.log("[RENEW SUBSCRIPTIONS] Timestamp:", new Date().toISOString());
  console.log("═══════════════════════════════════════════════════════════");

  try {
    // Buscar suscripciones activas que necesitan renovación
    // next_charge_at <= ahora y status = 'authorized'
    const [subscriptions] = await pool.query(
      `SELECT cs.*, mp.name as plan_name, mp.description as plan_description,
              mp.price_decimal, mp.duration_months
       FROM customer_subscription cs
       INNER JOIN membership_plan mp ON cs.membership_plan_id = mp.id
       WHERE cs.status = 'authorized'
         AND cs.next_charge_at IS NOT NULL
         AND cs.next_charge_at <= NOW()
         AND cs.next_charge_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       ORDER BY cs.next_charge_at ASC
       LIMIT 100`
    );

    if (subscriptions.length === 0) {
      console.log("[RENEW SUBSCRIPTIONS] No hay suscripciones que necesiten renovación");
      return;
    }

    console.log(`[RENEW SUBSCRIPTIONS] Encontradas ${subscriptions.length} suscripción(es) para renovar`);

    let successCount = 0;
    let errorCount = 0;

    for (const subscription of subscriptions) {
      try {
        console.log(`\n[RENEW SUBSCRIPTIONS] Procesando suscripción ID: ${subscription.id}`);
        console.log(`[RENEW SUBSCRIPTIONS] Tenant: ${subscription.tenant_id}, Customer: ${subscription.customer_id}`);
        console.log(`[RENEW SUBSCRIPTIONS] Plan: ${subscription.plan_name}`);
        console.log(`[RENEW SUBSCRIPTIONS] Próxima renovación: ${subscription.next_charge_at}`);

        // Obtener token de Mercado Pago del tenant
        const mpToken = await getTenantMpToken(subscription.tenant_id);
        
        if (!mpToken) {
          console.error(`[RENEW SUBSCRIPTIONS] ❌ No se encontró token de MP para tenant ${subscription.tenant_id}`);
          errorCount++;
          continue;
        }

        // Crear nueva preferencia de pago para la renovación
        const preferencePayload = {
          items: [
            {
              title: subscription.plan_name,
              description: subscription.plan_description || `Renovación ${subscription.plan_name}`,
              quantity: 1,
              unit_price: Number(subscription.price_decimal),
              currency_id: "ARS",
            }
          ],
          external_reference: `tenant:${subscription.tenant_id}:customer:${subscription.customer_id}:plan:${subscription.membership_plan_id}:subscription:renewal:${Date.now()}`,
          back_urls: {
            success: `${FRONTEND_URL}/memberships/success`,
            failure: `${FRONTEND_URL}/memberships/failure`,
            pending: `${FRONTEND_URL}/memberships/pending`
          },
          auto_return: "approved",
          notification_url: `${API_URL}/api/mp-webhook`,
          statement_descriptor: subscription.plan_name.substring(0, 22),
          metadata: {
            tenant_id: subscription.tenant_id,
            customer_id: subscription.customer_id,
            membership_plan_id: subscription.membership_plan_id,
            subscription_id: subscription.id,
            subscription_type: "membership_renewal"
          }
        };

        console.log(`[RENEW SUBSCRIPTIONS] Creando preferencia de pago en Mercado Pago...`);

        const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${mpToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(preferencePayload),
        });

        const mpData = await mpResponse.json();

        if (!mpResponse.ok) {
          console.error(`[RENEW SUBSCRIPTIONS] ❌ Error creando preferencia:`, mpData);
          errorCount++;
          continue;
        }

        // Actualizar la suscripción con el nuevo link de pago y marcar como pendiente de renovación
        const nextRenewalDate = new Date();
        nextRenewalDate.setMonth(nextRenewalDate.getMonth() + (subscription.frequency || 1));

        await pool.query(
          `UPDATE customer_subscription
           SET mp_init_point = ?,
               mp_sandbox_init_point = ?,
               status = 'pending',
               updated_at = NOW()
           WHERE id = ?`,
          [
            mpData.init_point,
            mpData.sandbox_init_point || null,
            subscription.id
          ]
        );

        console.log(`[RENEW SUBSCRIPTIONS] ✅ Suscripción ${subscription.id} actualizada con nuevo link de pago`);
        console.log(`[RENEW SUBSCRIPTIONS] Link de pago: ${mpData.init_point || mpData.sandbox_init_point}`);
        
        successCount++;

        // Enviar notificación al cliente
        try {
          await sendRenewalNotification(subscription, mpData.init_point || mpData.sandbox_init_point);
        } catch (notifError) {
          console.warn(`[RENEW SUBSCRIPTIONS] ⚠️ Error enviando notificación:`, notifError.message);
          // No fallar el proceso si la notificación falla
        }

      } catch (error) {
        console.error(`[RENEW SUBSCRIPTIONS] ❌ Error procesando suscripción ${subscription.id}:`, error.message);
        console.error(`[RENEW SUBSCRIPTIONS] Stack:`, error.stack);
        errorCount++;
      }
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("[RENEW SUBSCRIPTIONS] Proceso completado");
    console.log(`[RENEW SUBSCRIPTIONS] Exitosas: ${successCount}`);
    console.log(`[RENEW SUBSCRIPTIONS] Errores: ${errorCount}`);
    console.log("═══════════════════════════════════════════════════════════");

  } catch (error) {
    console.error("[RENEW SUBSCRIPTIONS] ❌ Error fatal:", error.message);
    console.error("[RENEW SUBSCRIPTIONS] Stack:", error.stack);
    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// Ejecutar el script
renewSubscriptions();

