// Script para sincronizar suscripciones pendientes con Mercado Pago
// Uso: node scripts/sync-subscriptions.js [tenant_id]

import { pool } from "../src/db.js";
import { getTenantMpToken } from "../src/services/mercadoPago.js";

async function fetchPreapproval(preapprovalId, token) {
  const response = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
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

async function syncSubscription(subscription) {
  try {
    const token = await getTenantMpToken(subscription.tenant_id);
    if (!token) {
      console.log(`⚠️  No hay token de MP para tenant ${subscription.tenant_id}`);
      return false;
    }

    const mpData = await fetchPreapproval(subscription.mp_preapproval_id, token);
    if (!mpData) {
      console.log(`⚠️  No se pudo obtener info de MP para preapproval ${subscription.mp_preapproval_id}`);
      return false;
    }

    const normalizedStatus = mapPreapprovalStatus(mpData.status);
    const nextCharge = mpData.auto_recurring?.next_payment_date
      ? new Date(mpData.auto_recurring.next_payment_date)
      : null;
    const lastPayment = mpData.auto_recurring?.last_payment_date
      ? new Date(mpData.auto_recurring.last_payment_date)
      : null;

    console.log(`📋 Suscripción ${subscription.id}:`);
    console.log(`   Estado actual: ${subscription.status} / ${subscription.mp_status}`);
    console.log(`   Estado en MP: ${mpData.status} -> ${normalizedStatus}`);

    if (normalizedStatus === subscription.status && mpData.status === subscription.mp_status) {
      console.log(`   ✅ Ya está sincronizada`);
      return false;
    }

    // Actualizar suscripción
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

    console.log(`   ✅ Actualizada a: ${normalizedStatus} / ${mpData.status}`);

    // Si fue autorizada, actualizar tenant
    if (normalizedStatus === "authorized") {
      const [updateResult] = await pool.query(
        `UPDATE tenant 
         SET status = 'active', 
             subscription_status = 'active',
             updated_at = NOW()
         WHERE id = ? AND status = 'trial'`,
        [subscription.tenant_id]
      );

      if (updateResult.affectedRows > 0) {
        console.log(`   ✅ Tenant ${subscription.tenant_id} actualizado de "trial" a "active"`);
      }
    }

    return true;
  } catch (error) {
    console.error(`❌ Error sincronizando suscripción ${subscription.id}:`, error.message);
    return false;
  }
}

async function main() {
  const tenantId = process.argv[2] ? parseInt(process.argv[2], 10) : null;

  console.log("🔄 Sincronizando suscripciones con Mercado Pago...\n");

  let query = `
    SELECT * FROM platform_subscription
    WHERE status = 'pending' OR mp_status = 'pending'
  `;
  let params = [];

  if (tenantId) {
    query += ` AND tenant_id = ?`;
    params.push(tenantId);
  }

  query += ` ORDER BY created_at DESC`;

  const [subscriptions] = await pool.query(query, params);

  if (subscriptions.length === 0) {
    console.log("✅ No hay suscripciones pendientes para sincronizar");
    return;
  }

  console.log(`📊 Encontradas ${subscriptions.length} suscripción(es) pendiente(s)\n`);

  let updated = 0;
  for (const sub of subscriptions) {
    if (await syncSubscription(sub)) {
      updated++;
    }
    console.log(""); // Línea en blanco
  }

  console.log(`\n✅ Proceso completado: ${updated} suscripción(es) actualizada(s)`);
  
  await pool.end();
}

main().catch((error) => {
  console.error("❌ Error fatal:", error);
  process.exit(1);
});

