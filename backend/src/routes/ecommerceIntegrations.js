import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import { createIntegrationState } from "../utils/integrationState.js";
import { logIntegrationEvent } from "../services/integrationLogs.js";

const router = Router();

router.use(requireAuth, requireRole("admin", "staff"));

const PROVIDER_CONFIG = {
  tienda_nube: {
    authUrl: "https://www.tiendanube.com/apps/authorize/authorize",
    scopes:
      process.env.TIENDANUBE_SCOPES ||
      "read_products,read_customers,read_orders,write_orders,read_store",
    clientId: process.env.TIENDANUBE_CLIENT_ID,
    redirectUri:
      process.env.TIENDANUBE_REDIRECT_URI ||
      `${process.env.APP_URL || "https://app.local"}/api/public/ecommerce/tiendanube/callback`,
  },
  mercado_libre: {
    authUrl: "https://auth.mercadolibre.com.ar/authorization",
    scopes:
      process.env.MERCADOLIBRE_SCOPES ||
      "read offline_access",
    clientId: process.env.MERCADOLIBRE_CLIENT_ID,
    redirectUri:
      process.env.MERCADOLIBRE_REDIRECT_URI ||
      `${process.env.APP_URL || "https://app.local"}/api/public/ecommerce/mercadolibre/callback`,
  },
};

router.get("/integrations/status", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const [rows] = await pool.query(
      `SELECT provider, status, expires_at, last_sync_at, last_error, external_store_id, external_user_id
       FROM tenant_integrations
       WHERE tenant_id = ?`,
      [tenantId]
    );

    res.json({
      ok: true,
      data: rows,
    });
  } catch (error) {
    console.error("[Integrations] Error obteniendo estado:", error);
    res.status(500).json({ ok: false, error: "No se pudo obtener el estado de las integraciones" });
  }
});

router.get("/integrations/logs", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const { provider, limit = 50 } = req.query;

    let sql = `SELECT provider, level, message, payload, created_at
               FROM tenant_integration_logs
               WHERE tenant_id = ?`;
    const params = [tenantId];

    if (provider) {
      sql += " AND provider = ?";
      params.push(provider);
    }

    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(Number(limit) || 50);

    const [rows] = await pool.query(sql, params);

    res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("[Integrations] Error obteniendo logs:", error);
    res.status(500).json({ ok: false, error: "No se pudieron obtener los logs" });
  }
});

router.post("/integrations/:provider/start", async (req, res) => {
  const { provider } = req.params;
  const tenantId = req.tenant.id;
  const config = PROVIDER_CONFIG[provider];

  if (!config) {
    return res.status(400).json({ ok: false, error: "Proveedor no soportado" });
  }
  if (!config.clientId || !config.redirectUri) {
    return res.status(503).json({
      ok: false,
      error: "La integración no está configurada. Falta client ID o redirect URI.",
    });
  }

  const state = createIntegrationState(tenantId, provider);
  const authorizeUrl = new URL(config.authUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("state", state);
  if (config.scopes) {
    authorizeUrl.searchParams.set("scope", config.scopes);
  }

  res.json({
    ok: true,
    data: {
      authorizeUrl: authorizeUrl.toString(),
    },
  });
});

router.post("/integrations/:provider/disconnect", async (req, res) => {
  const { provider } = req.params;
  const tenantId = req.tenant.id;

  if (!PROVIDER_CONFIG[provider]) {
    return res.status(400).json({ ok: false, error: "Proveedor no soportado" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO tenant_integrations (tenant_id, provider, status)
       VALUES (?, ?, 'disconnected')
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         access_token = NULL,
         refresh_token = NULL,
         expires_at = NULL,
         external_store_id = NULL,
         external_user_id = NULL,
         last_error = NULL,
         scope = NULL,
         updated_at = NOW()`,
      [tenantId, provider]
    );

    await logIntegrationEvent({
      tenantId,
      provider,
      level: "info",
      message: "Integración desconectada manualmente",
      payload: { result },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("[Integrations] Error desconectando:", error);
    res.status(500).json({ ok: false, error: "No se pudo desconectar la integración" });
  }
});

export default router;

