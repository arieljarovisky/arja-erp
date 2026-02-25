// Script para listar suscripciones de un tenant
// Uso: node scripts/list-subscriptions.js [tenant_id]

import { pool } from "../src/db.js";

async function main() {
  const tenantId = process.argv[2] ? parseInt(process.argv[2], 10) : null;

  let query = `SELECT id, tenant_id, plan_code, plan_label, status, mp_status, mp_preapproval_id, created_at, updated_at FROM platform_subscription`;
  let params = [];

  if (tenantId) {
    query += ` WHERE tenant_id = ?`;
    params.push(tenantId);
  }

  query += ` ORDER BY created_at DESC LIMIT 50`;

  console.log(`🔍 Buscando suscripciones${tenantId ? ` para tenant ${tenantId}` : ''}...\n`);

  const [subscriptions] = await pool.query(query, params);

  if (subscriptions.length === 0) {
    console.log("❌ No se encontraron suscripciones");
    await pool.end();
    return;
  }

  console.log(`📊 Encontradas ${subscriptions.length} suscripción(es):\n`);
  console.log("ID\tTenant\tPlan\t\t\tEstado\t\tMP Status\t\tMP ID\t\t\t\t\tCreada");
  console.log("-".repeat(120));

  for (const sub of subscriptions) {
    const mpId = sub.mp_preapproval_id ? sub.mp_preapproval_id.substring(0, 20) + "..." : "N/A";
    const created = new Date(sub.created_at).toLocaleString('es-AR');
    console.log(
      `${sub.id}\t${sub.tenant_id}\t${sub.plan_label.padEnd(20)}\t${sub.status.padEnd(10)}\t${(sub.mp_status || 'N/A').padEnd(10)}\t${mpId.padEnd(30)}\t${created}`
    );
  }

  await pool.end();
}

main().catch((error) => {
  console.error("❌ Error fatal:", error);
  process.exit(1);
});

