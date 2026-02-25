import { pool } from "../db.js";

export async function logIntegrationEvent({
  tenantId,
  provider,
  level = "info",
  message,
  payload = null,
}) {
  if (!tenantId || !provider || !message) return;
  try {
    await pool.query(
      `INSERT INTO tenant_integration_logs (tenant_id, provider, level, message, payload)
       VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
      [tenantId, provider, level, message, payload ? JSON.stringify(payload) : null]
    );
  } catch (error) {
    console.error("[Integrations] Error guardando log:", error);
  }
}

