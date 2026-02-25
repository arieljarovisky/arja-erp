import fetch from "node-fetch";
import { pool } from "../db.js";

export async function getTenantMpToken(tenantId) {
  const [[row]] = await pool.query(
    `SELECT mp_access_token, mp_refresh_token, mp_token_expires_at
       FROM tenant_payment_config
      WHERE tenant_id=? AND is_active=1
      LIMIT 1`,
    [tenantId]
  );
  if (!row) return null;

  const exp = row.mp_token_expires_at && new Date(row.mp_token_expires_at);
  if (exp && exp.getTime() > Date.now() + 60_000) return row.mp_access_token;

  // refresh
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: row.mp_refresh_token,
    client_id: process.env.MP_CLIENT_ID,
    client_secret: process.env.MP_CLIENT_SECRET,
  });

  const r = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await r.json();
  if (!data.access_token) return null;

  const exp2 = new Date(Date.now() + (data.expires_in - 300) * 1000);
  await pool.query(
    `UPDATE tenant_payment_config
        SET mp_access_token=?, mp_refresh_token=?, mp_token_expires_at=?
      WHERE tenant_id=?`,
    [data.access_token, data.refresh_token || row.mp_refresh_token, exp2, tenantId]
  );
  return data.access_token;
}
