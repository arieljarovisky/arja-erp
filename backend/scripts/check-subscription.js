// Script para verificar y actualizar una suscripción específica
// Uso: node scripts/check-subscription.js <subscription_id>

import { pool } from "../src/db.js";
import { getTenantMpToken } from "../src/services/mercadoPago.js";

async function fetchPreapproval(preapprovalId, token) {
  const response = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const text = await response.text();
    console.error(`❌ Error de MP: ${response.status} - ${text}`);
    return null;
  }
  return await response.json();
}

function mapPreapprovalStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (["authorized", "approved", "active"].includes(normalized)) return "authorized";
  if (["paused", "suspended"].includes(normalized)) return "paused";
  if (["cancelled", "canceled", "cancelled_by_user"].includes(normalized)) return "cancelled";
  return "pending";
}

async function main() {
  const subscriptionId = process.argv[2] ? parseInt(process.argv[2], 10) : null;

  if (!subscriptionId) {
    console.error("❌ Debes proporcionar el ID de la suscripción");
    console.log("Uso: node scripts/check-subscription.js <subscription_id>");
    process.exit(1);
  }

  console.log(`🔍 Verificando suscripción ${subscriptionId}...\n`);

  const [[subscription]] = await pool.query(
    `SELECT * FROM platform_subscription WHERE id = ? LIMIT 1`,
    [subscriptionId]
  );

  if (!subscription) {
    console.error(`❌ No se encontró la suscripción ${subscriptionId}`);
    process.exit(1);
  }

  console.log(`📋 Información de la suscripción:`);
  console.log(`   ID: ${subscription.id}`);
  console.log(`   Tenant ID: ${subscription.tenant_id}`);
  console.log(`   Plan: ${subscription.plan_label} (${subscription.plan_code})`);
  console.log(`   Estado actual: ${subscription.status} / ${subscription.mp_status}`);
  console.log(`   MP Preapproval ID: ${subscription.mp_preapproval_id}`);
  console.log(`   Creada: ${subscription.created_at}`);
  console.log(`   Actualizada: ${subscription.updated_at || 'Nunca'}\n`);

  if (!subscription.mp_preapproval_id) {
    console.error("❌ Esta suscripción no tiene mp_preapproval_id");
    process.exit(1);
  }

  const token = await getTenantMpToken(subscription.tenant_id);
  if (!token) {
    console.error(`❌ No hay token de MP configurado para tenant ${subscription.tenant_id}`);
    process.exit(1);
  }

  console.log(`🔄 Consultando Mercado Pago...\n`);
  const mpData = await fetchPreapproval(subscription.mp_preapproval_id, token);

  if (!mpData) {
    console.error(`❌ No se pudo obtener información de Mercado Pago`);
    process.exit(1);
  }

  console.log(`📊 Estado en Mercado Pago:`);
  console.log(`   Status: ${mpData.status}`);
  console.log(`   ID: ${mpData.id}`);
  if (mpData.auto_recurring) {
    console.log(`   Próximo cobro: ${mpData.auto_recurring.next_payment_date || 'N/A'}`);
    console.log(`   Último pago: ${mpData.auto_recurring.last_payment_date || 'N/A'}`);
  }

  const normalizedStatus = mapPreapprovalStatus(mpData.status);
  console.log(`   Estado normalizado: ${normalizedStatus}\n`);

  if (normalizedStatus === subscription.status && mpData.status === subscription.mp_status) {
    console.log(`✅ La suscripción ya está sincronizada`);
    return;
  }

  console.log(`🔄 Actualizando suscripción...\n`);

  const nextCharge = mpData.auto_recurring?.next_payment_date
    ? new Date(mpData.auto_recurring.next_payment_date)
    : null;
  const lastPayment = mpData.auto_recurring?.last_payment_date
    ? new Date(mpData.auto_recurring.last_payment_date)
    : null;

  await pool.query(
    `UPDATE platform_subscription
     SET status = ?,
         mp_status = ?,
         last_payment_at = COALESCE(?, last_payment_at),
         next_charge_at = COALESCE(?, next_charge_at),
         activated_at = CASE WHEN ? = 'authorized' AND activated_at IS NULL THEN NOW() ELSE activated_at END,
         updated_at = NOW()
     WHERE id = ? AND tenant_id = ?`,
    [
      normalizedStatus,
      mpData.status || normalizedStatus,
      lastPayment,
      nextCharge,
      normalizedStatus,
      subscription.id,
      subscription.tenant_id,
    ]
  );

  console.log(`✅ Suscripción actualizada:`);
  console.log(`   Estado: ${subscription.status} → ${normalizedStatus}`);
  console.log(`   MP Status: ${subscription.mp_status} → ${mpData.status}`);

  // Si fue autorizada, actualizar tenant
  if (normalizedStatus === "authorized") {
    const [[tenant]] = await pool.query(
      `SELECT status FROM tenant WHERE id = ? LIMIT 1`,
      [subscription.tenant_id]
    );

    if (tenant && tenant.status === "trial") {
      const [updateResult] = await pool.query(
        `UPDATE tenant 
         SET status = 'active', 
             subscription_status = 'active',
             updated_at = NOW()
         WHERE id = ? AND status = 'trial'`,
        [subscription.tenant_id]
      );

      if (updateResult.affectedRows > 0) {
        console.log(`✅ Tenant ${subscription.tenant_id} actualizado de "trial" a "active"`);
      }
    } else {
      console.log(`ℹ️  Tenant ${subscription.tenant_id} ya está en estado "${tenant?.status || 'N/A'}"`);
    }
  }

  await pool.end();
}

main().catch((error) => {
  console.error("❌ Error fatal:", error);
  process.exit(1);
});

