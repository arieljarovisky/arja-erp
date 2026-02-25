/**
 * Script para enviar recordatorios de renovación de suscripciones
 * 
 * Este script busca suscripciones que están próximas a vencer
 * y envía recordatorios a los clientes.
 * 
 * Uso:
 *   node scripts/send-renewal-reminders.js [días]
 * 
 * Ejemplo:
 *   node scripts/send-renewal-reminders.js 3  # Recordatorios 3 días antes
 * 
 * Se puede ejecutar como cron job:
 *   0 9 * * * node /path/to/scripts/send-renewal-reminders.js 3
 */

import { pool } from "../src/db.js";
import { sendWhatsAppText } from "../src/whatsapp.js";
import { getTenantMpToken } from "../src/services/mercadoPago.js";

const API_URL = process.env.API_URL || process.env.RAILWAY_PUBLIC_DOMAIN || 'https://backend-production-1042.up.railway.app';
const FRONTEND_URL = process.env.FRONTEND_BASE_URL || `https://${process.env.DOMAIN || 'app.arjaerp.com'}`;

// Días antes de la renovación para enviar el recordatorio (por defecto 3)
const daysBefore = parseInt(process.argv[2] || "3", 10);

async function sendReminders() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("[RENEWAL REMINDERS] Iniciando envío de recordatorios");
  console.log(`[RENEWAL REMINDERS] Días antes: ${daysBefore}`);
  console.log("[RENEWAL REMINDERS] Timestamp:", new Date().toISOString());
  console.log("═══════════════════════════════════════════════════════════");

  try {
    // Buscar suscripciones que vencen en los próximos X días
    // No enviar recordatorios duplicados (verificar que no se haya enviado recientemente)
    const [subscriptions] = await pool.query(
      `SELECT cs.*, mp.name as plan_name, mp.description as plan_description,
              mp.price_decimal, mp.duration_months
       FROM customer_subscription cs
       INNER JOIN membership_plan mp ON cs.membership_plan_id = mp.id
       WHERE cs.status = 'authorized'
         AND cs.next_charge_at IS NOT NULL
         AND cs.next_charge_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? DAY)
         AND (cs.last_payment_at IS NULL OR cs.last_payment_at < DATE_SUB(cs.next_charge_at, INTERVAL ? DAY))
       ORDER BY cs.next_charge_at ASC
       LIMIT 100`,
      [daysBefore, daysBefore]
    );

    if (subscriptions.length === 0) {
      console.log(`[RENEWAL REMINDERS] No hay suscripciones que necesiten recordatorio (${daysBefore} días antes)`);
      return;
    }

    console.log(`[RENEWAL REMINDERS] Encontradas ${subscriptions.length} suscripción(es) para recordatorio`);

    let successCount = 0;
    let errorCount = 0;

    for (const subscription of subscriptions) {
      try {
        console.log(`\n[RENEWAL REMINDERS] Procesando suscripción ID: ${subscription.id}`);

        // Obtener información del cliente
        const [customerRows] = await pool.query(
          `SELECT name, phone_e164, email FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
          [subscription.customer_id, subscription.tenant_id]
        );

        if (customerRows.length === 0 || !customerRows[0].phone_e164) {
          console.warn(`[RENEWAL REMINDERS] Cliente ${subscription.customer_id} sin teléfono`);
          continue;
        }

        const customer = customerRows[0];
        
        // Obtener nombre del tenant
        const [[tenant]] = await pool.query("SELECT name FROM tenant WHERE id = ? LIMIT 1", [subscription.tenant_id]);
        const tenantName = tenant?.name || "ARJA ERP";
        
        const amountFormatted = Number(subscription.price_decimal).toLocaleString("es-AR", {
          style: "currency",
          currency: subscription.currency || "ARS",
        });

        // Calcular días restantes
        const daysRemaining = Math.ceil((new Date(subscription.next_charge_at) - new Date()) / (1000 * 60 * 60 * 24));
        const renewalDate = new Date(subscription.next_charge_at).toLocaleDateString("es-AR", {
          day: "numeric",
          month: "long",
          year: "numeric"
        });

        // Obtener link de pago si existe
        let paymentLink = subscription.mp_init_point || subscription.mp_sandbox_init_point;
        
        // Si no hay link y la renovación es muy próxima, crear uno
        if (!paymentLink && daysRemaining <= 1) {
          const mpToken = await getTenantMpToken(subscription.tenant_id);
          
          if (mpToken) {
            const preferencePayload = {
              items: [{
                title: subscription.plan_name,
                description: subscription.plan_description || `Renovación ${subscription.plan_name}`,
                quantity: 1,
                unit_price: Number(subscription.price_decimal),
                currency_id: "ARS",
              }],
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

            const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${mpToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(preferencePayload),
            });

            const mpData = await mpResponse.json();
            if (mpResponse.ok) {
              paymentLink = mpData.init_point || mpData.sandbox_init_point;
              
              // Actualizar la suscripción con el nuevo link
              await pool.query(
                `UPDATE customer_subscription
                 SET mp_init_point = ?,
                     mp_sandbox_init_point = ?,
                     updated_at = NOW()
                 WHERE id = ?`,
                [mpData.init_point, mpData.sandbox_init_point || null, subscription.id]
              );
            }
          }
        }

        const message = 
          `⏰ *Recordatorio de Renovación*\n\n` +
          `Hola ${customer.name || 'Cliente'}!\n\n` +
          `Te recordamos que tu suscripción *${subscription.plan_name}* vence en ${daysRemaining} día(s).\n\n` +
          `• Plan: ${subscription.plan_name}\n` +
          `• Monto: ${amountFormatted}\n` +
          `• Fecha de renovación: ${renewalDate}\n\n` +
          (paymentLink ? `Para renovar ahora, hacé clic aquí:\n${paymentLink}\n\n` : '') +
          `Si tenés alguna consulta, no dudes en contactarnos.`;

        const sendResult = await sendWhatsAppText(customer.phone_e164, message, subscription.tenant_id);
        
        if (sendResult?.skipped) {
          console.warn(`[RENEWAL REMINDERS] WhatsApp saltado para ${customer.phone_e164}`);
        } else if (sendResult?.error) {
          console.error(`[RENEWAL REMINDERS] Error enviando WhatsApp:`, sendResult.error);
          errorCount++;
        } else {
          console.log(`[RENEWAL REMINDERS] ✅ Recordatorio enviado a ${customer.phone_e164}`);
          successCount++;
        }

      } catch (error) {
        console.error(`[RENEWAL REMINDERS] ❌ Error procesando suscripción ${subscription.id}:`, error.message);
        errorCount++;
      }
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("[RENEWAL REMINDERS] Proceso completado");
    console.log(`[RENEWAL REMINDERS] Enviados: ${successCount}`);
    console.log(`[RENEWAL REMINDERS] Errores: ${errorCount}`);
    console.log("═══════════════════════════════════════════════════════════");

  } catch (error) {
    console.error("[RENEWAL REMINDERS] ❌ Error fatal:", error.message);
    console.error("[RENEWAL REMINDERS] Stack:", error.stack);
    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// Ejecutar el script
sendReminders();

