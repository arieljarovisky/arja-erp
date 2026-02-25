import { Router } from "express";
import { pool } from "../db.js";
import { parseIntegrationState } from "../utils/integrationState.js";
import { logIntegrationEvent } from "../services/integrationLogs.js";
import { upsertEcommerceSale } from "../services/ecommerceSales.js";

const router = Router();

const APP_BASE_URL = process.env.APP_URL || "https://app.local";
const TIENDANUBE_USER_AGENT =
  process.env.TIENDANUBE_USER_AGENT ||
  "Arja ERP (support@arjaerp.com)";

function mapSaleItems(rows = []) {
  return rows.reduce((acc, item) => {
    if (!acc[item.sale_id]) acc[item.sale_id] = [];
    acc[item.sale_id].push(item);
    return acc;
  }, {});
}

function renderMessage(res, { success, provider, message }) {
  res.status(success ? 200 : 400).send(`
    <style>
      body { font-family: sans-serif; background: #0f172a; color: #f8fafc; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
      .card { background:#1e293b; padding:32px; border-radius:16px; max-width:480px; text-align:center; box-shadow:0 20px 60px rgba(15,23,42,0.5); }
      h1 { margin-bottom:16px; font-size:24px; }
      p { margin-bottom:24px; color:#cbd5f5; }
      a { color:#38bdf8; text-decoration:none; font-weight:600; }
    </style>
    <div class="card">
      <h1>${success ? "Integración completada" : "Error en la integración"}</h1>
      <p>${message}</p>
      <a href="${APP_BASE_URL}" target="_self">Volver al sistema</a>
    </div>
  `);
}

async function upsertIntegration({
  tenantId,
  provider,
  data,
  status = "connected",
  lastError = null,
}) {
  const expiresAt = data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000)
    : data.expires_at
    ? new Date(data.expires_at * 1000 || data.expires_at)
    : null;

  await pool.query(
    `INSERT INTO tenant_integrations (
      tenant_id, provider, status, access_token, refresh_token, expires_at,
      scope, external_user_id, external_store_id, data, last_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)
    ON DUPLICATE KEY UPDATE
      status = VALUES(status),
      access_token = VALUES(access_token),
      refresh_token = VALUES(refresh_token),
      expires_at = VALUES(expires_at),
      scope = VALUES(scope),
      external_user_id = VALUES(external_user_id),
      external_store_id = VALUES(external_store_id),
      data = VALUES(data),
      last_error = VALUES(last_error),
      updated_at = NOW()`,
    [
      tenantId,
      provider,
      status,
      data.access_token || null,
      data.refresh_token || null,
      expiresAt,
      data.scope || null,
      data.user_id || data.external_user_id || null,
      data.store_id || data.external_store_id || null,
      JSON.stringify(data),
      lastError,
    ]
  );
}

router.get("/tiendanube/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return renderMessage(res, {
      success: false,
      provider: "tienda_nube",
      message: "Falta el código o el estado de autorización.",
    });
  }

  const parsed = parseIntegrationState(state);
  if (!parsed) {
    return renderMessage(res, {
      success: false,
      provider: "tienda_nube",
      message: "El estado de seguridad no es válido o expiró.",
    });
  }

  const { tenantId } = parsed;

  try {
    const clientId = process.env.TIENDANUBE_CLIENT_ID;
    const clientSecret = process.env.TIENDANUBE_CLIENT_SECRET;
    const redirectUri =
      process.env.TIENDANUBE_REDIRECT_URI ||
      `${APP_BASE_URL}/api/public/ecommerce/tiendanube/callback`;

    const tokenResponse = await fetch("https://www.tiendanube.com/apps/authorize/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const data = await tokenResponse.json();

    if (!tokenResponse.ok) {
      await logIntegrationEvent({
        tenantId,
        provider: "tienda_nube",
        level: "error",
        message: "Error al intercambiar el código",
        payload: data,
      });
      return renderMessage(res, {
        success: false,
        provider: "tienda_nube",
        message: data.error || "No pudimos obtener el token de Tienda Nube.",
      });
    }

    await upsertIntegration({
      tenantId,
      provider: "tienda_nube",
      data,
    });

    await logIntegrationEvent({
      tenantId,
      provider: "tienda_nube",
      level: "info",
      message: "Tienda Nube conectada correctamente",
      payload: { scope: data.scope, user_id: data.user_id },
    });

    renderMessage(res, {
      success: true,
      provider: "tienda_nube",
      message: "Listo, ya podés volver a Arja ERP y cerrar esta ventana.",
    });
  } catch (error) {
    console.error("[Integrations] Error Tienda Nube callback:", error);
    renderMessage(res, {
      success: false,
      provider: "tienda_nube",
      message: "Ocurrió un error inesperado. Revisá la consola del servidor.",
    });
  }
});

router.get("/mercadolibre/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return renderMessage(res, {
      success: false,
      provider: "mercado_libre",
      message: "Falta el código o el estado de autorización.",
    });
  }

  const parsed = parseIntegrationState(state);
  if (!parsed) {
    return renderMessage(res, {
      success: false,
      provider: "mercado_libre",
      message: "El estado de seguridad no es válido o expiró.",
    });
  }

  const { tenantId } = parsed;

  try {
    const clientId = process.env.MERCADOLIBRE_CLIENT_ID;
    const clientSecret = process.env.MERCADOLIBRE_CLIENT_SECRET;
    const redirectUri =
      process.env.MERCADOLIBRE_REDIRECT_URI ||
      `${APP_BASE_URL}/api/public/ecommerce/mercadolibre/callback`;

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("client_id", clientId);
    params.append("client_secret", clientSecret);
    params.append("code", code);
    params.append("redirect_uri", redirectUri);

    const tokenResponse = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const data = await tokenResponse.json();

    if (!tokenResponse.ok) {
      await logIntegrationEvent({
        tenantId,
        provider: "mercado_libre",
        level: "error",
        message: "Error al intercambiar el código",
        payload: data,
      });
      return renderMessage(res, {
        success: false,
        provider: "mercado_libre",
        message: data.error || "No pudimos obtener el token de Mercado Libre.",
      });
    }

    await upsertIntegration({
      tenantId,
      provider: "mercado_libre",
      data: {
        ...data,
        external_user_id: data.user_id,
      },
    });

    await logIntegrationEvent({
      tenantId,
      provider: "mercado_libre",
      level: "info",
      message: "Mercado Libre conectada correctamente",
      payload: { user_id: data.user_id, scope: data.scope },
    });

    renderMessage(res, {
      success: true,
      provider: "mercado_libre",
      message: "Perfecto. Ya podés cerrar esta ventana y volver a Arja ERP.",
    });
  } catch (error) {
    console.error("[Integrations] Error Mercado Libre callback:", error);
    renderMessage(res, {
      success: false,
      provider: "mercado_libre",
      message: "Ocurrió un error inesperado al procesar la respuesta.",
    });
  }
});

function extractMLOrderId(resource = "") {
  const match = resource.match(/\/orders\/(\d+)/);
  return match ? match[1] : null;
}

async function updateLastSync(integrationId) {
  if (!integrationId) return;
  try {
    await pool.query(
      `UPDATE tenant_integrations SET last_sync_at = NOW() WHERE id = ?`,
      [integrationId]
    );
  } catch (error) {
    console.error("[Integrations] No se pudo actualizar last_sync_at:", error);
  }
}

router.post("/mercadolibre/webhook", async (req, res) => {
  try {
    const payload = req.body || {};
    const topic = payload.topic || payload.type;
    const resource = payload.resource || payload.data?.resource;
    const userId = payload.user_id || payload.data?.seller?.id || payload.seller_id || req.query.user_id;

    if (!resource || !resource.includes("/orders/")) {
      return res.status(200).json({ ok: true, skipped: "resource_not_order" });
    }

    const orderId = extractMLOrderId(resource);
    if (!orderId || !userId) {
      return res.status(200).json({ ok: true, skipped: "missing_data" });
    }

    const [[integration]] = await pool.query(
      `SELECT id, tenant_id, access_token FROM tenant_integrations
       WHERE provider = 'mercado_libre' AND status = 'connected' AND external_user_id = ?
       LIMIT 1`,
      [String(userId)]
    );

    if (!integration) {
      await logIntegrationEvent({
        tenantId: null,
        provider: "mercado_libre",
        level: "warning",
        message: `Webhook recibido pero no se encontró tenant para user_id ${userId}`,
        payload,
      });
      return res.status(202).json({ ok: true, ignored: "tenant_not_found" });
    }

    const orderUrl = resource.startsWith("http")
      ? resource
      : `https://api.mercadolibre.com${resource}`;

    const orderResponse = await fetch(orderUrl, {
      headers: {
        Authorization: `Bearer ${integration.access_token}`,
      },
    });

    const orderData = await orderResponse.json();

    if (!orderResponse.ok) {
      await logIntegrationEvent({
        tenantId: integration.tenant_id,
        provider: "mercado_libre",
        level: "error",
        message: `No se pudo obtener la orden ${orderId}`,
        payload: orderData,
      });
      return res.status(500).json({ ok: false });
    }

    const buyer = orderData.buyer || {};
    const billing = orderData.billing_info || {};

    const items = (orderData.order_items || []).map((item) => ({
      product_name: item.item?.title || item.item?.id || "Producto",
      sku: item.item?.seller_sku || item.item?.id || null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      metadata: {
        ml_item_id: item.item?.id,
      },
    }));

    await upsertEcommerceSale({
      tenantId: integration.tenant_id,
      channel: "mercado_libre",
      sourceOrderId: String(orderData.id || orderId),
      orderNumber: String(orderData.id || orderId),
      customer: {
        name:
          `${buyer.first_name || ""} ${buyer.last_name || ""}`.trim() ||
          buyer.nickname ||
          "Mercado Libre",
        email: buyer.email,
        phone: buyer.phone?.number || buyer.phone?.area_code
          ? `${buyer.phone?.area_code || ""} ${buyer.phone?.number || ""}`.trim()
          : buyer.phone?.extension || null,
        document: billing.doc_number || billing.doc_type || null,
      },
      currency: orderData.currency_id || "ARS",
      totalAmount:
        Number(orderData.total_amount) ||
        Number(orderData.paid_amount) ||
        items.reduce(
          (sum, current) =>
            sum + Number(current.unit_price || 0) * Number(current.quantity || 1),
          0
        ),
      status: orderData.status === "cancelled" ? "cancelled" : "pending",
      items,
      rawPayload: orderData,
    });

    await updateLastSync(integration.id);

    await logIntegrationEvent({
      tenantId: integration.tenant_id,
      provider: "mercado_libre",
      level: "info",
      message: `Orden ${orderId} sincronizada`,
      payload: { topic, orderId },
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[Integrations] Error procesando webhook de Mercado Libre:", error);
    res.status(500).json({ ok: false });
  }
});

router.post("/tiendanube/webhook", async (req, res) => {
  try {
    const shopId = req.headers["x-shop-id"] || req.headers["X-Shop-Id"];
    const event = req.headers["x-event"] || req.headers["X-Event"];
    const orderId = req.body?.id || req.body?.data?.id;

    if (!shopId || !orderId) {
      return res.status(200).json({ ok: true, skipped: "missing_shop_or_order" });
    }

    const [[integration]] = await pool.query(
      `SELECT id, tenant_id, access_token FROM tenant_integrations
       WHERE provider = 'tienda_nube' AND status = 'connected' AND external_store_id = ?
       LIMIT 1`,
      [String(shopId)]
    );

    if (!integration) {
      await logIntegrationEvent({
        tenantId: null,
        provider: "tienda_nube",
        level: "warning",
        message: `Webhook recibido pero no se encontró tenant para store ${shopId}`,
        payload: { orderId, event },
      });
      return res.status(202).json({ ok: true, ignored: "tenant_not_found" });
    }

    const orderResponse = await fetch(
      `https://api.tiendanube.com/v1/${shopId}/orders/${orderId}`,
      {
        headers: {
          Authentication: `bearer ${integration.access_token}`,
          "User-Agent": TIENDANUBE_USER_AGENT,
        },
      }
    );

    const orderData = await orderResponse.json();

    if (!orderResponse.ok) {
      await logIntegrationEvent({
        tenantId: integration.tenant_id,
        provider: "tienda_nube",
        level: "error",
        message: `No se pudo obtener orden ${orderId}`,
        payload: orderData,
      });
      return res.status(500).json({ ok: false });
    }

    const customer = orderData.customer || {};
    const items = (orderData.products || []).map((product) => ({
      product_name: product.name,
      sku: product.sku || product.product_id,
      quantity: product.quantity,
      unit_price: product.price,
      metadata: {
        tiendanube_product_id: product.product_id,
        variant_id: product.variant_id,
      },
    }));

    await upsertEcommerceSale({
      tenantId: integration.tenant_id,
      channel: "tienda_nube",
      sourceOrderId: String(orderData.id || orderId),
      orderNumber: orderData.number || orderData.id,
      customer: {
        name: customer.name || `${customer.first_name || ""} ${customer.last_name || ""}`.trim(),
        email: customer.email,
        phone: customer.phone,
        document: customer.identification || customer.identification_number || null,
      },
      currency: orderData.currency || "ARS",
      totalAmount: Number(orderData.total) || Number(orderData.subtotal_with_discount),
      status: orderData.status === "cancelled" ? "cancelled" : "pending",
      notes: orderData.note || orderData.client_details,
      items,
      rawPayload: orderData,
    });

    await updateLastSync(integration.id);

    await logIntegrationEvent({
      tenantId: integration.tenant_id,
      provider: "tienda_nube",
      level: "info",
      message: `Orden ${orderId} sincronizada`,
      payload: { event, orderId },
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[Integrations] Error procesando webhook de Tienda Nube:", error);
    res.status(500).json({ ok: false });
  }
});

async function findTiendaNubeIntegration(shopId) {
  if (!shopId) return null;
  const [[integration]] = await pool.query(
    `SELECT id, tenant_id FROM tenant_integrations
     WHERE provider = 'tienda_nube' AND external_store_id = ?
     LIMIT 1`,
    [String(shopId)]
  );
  return integration || null;
}

router.post("/tiendanube/store-redact", async (req, res) => {
  try {
    const shopId = req.body?.store_id || req.body?.id || req.headers["x-shop-id"];
    const integration = await findTiendaNubeIntegration(shopId);

    if (integration) {
      await pool.query(
        `UPDATE tenant_integrations
         SET status = 'disconnected',
             access_token = NULL,
             refresh_token = NULL,
             expires_at = NULL,
             data = NULL,
             updated_at = NOW()
         WHERE id = ?`,
        [integration.id]
      );

      await pool.query(
        `DELETE FROM ecommerce_sale WHERE tenant_id = ? AND channel = 'tienda_nube'`,
        [integration.tenant_id]
      );

      await logIntegrationEvent({
        tenantId: integration.tenant_id,
        provider: "tienda_nube",
        level: "warning",
        message: "Solicitud de store redact procesada",
        payload: { shopId },
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("[Integrations] Error en store-redact TN:", error);
    res.status(500).json({ ok: false });
  }
});

router.post("/tiendanube/customers-redact", async (req, res) => {
  try {
    const shopId = req.body?.store_id || req.body?.id || req.headers["x-shop-id"];
    const customer = req.body?.customer || req.body;
    const email = customer?.email;
    const phone = customer?.phone;
    const document = customer?.identification || customer?.identification_number;

    if (!email && !phone && !document) {
      return res.json({ ok: true, skipped: "no_identifiers" });
    }

    const integration = await findTiendaNubeIntegration(shopId);

    if (integration) {
      const [result] = await pool.query(
        `DELETE FROM ecommerce_sale
         WHERE tenant_id = ?
           AND channel = 'tienda_nube'
           AND (
             (? IS NOT NULL AND customer_email = ?) OR
             (? IS NOT NULL AND customer_phone = ?) OR
             (? IS NOT NULL AND customer_document = ?)
           )`,
        [
          integration.tenant_id,
          email,
          email,
          phone,
          phone,
          document,
          document,
        ]
      );

      await logIntegrationEvent({
        tenantId: integration.tenant_id,
        provider: "tienda_nube",
        level: "info",
        message: "Solicitud de customers redact procesada",
        payload: { shopId, affected: result.affectedRows },
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("[Integrations] Error en customers-redact TN:", error);
    res.status(500).json({ ok: false });
  }
});

router.post("/tiendanube/customers-data-request", async (req, res) => {
  try {
    const shopId = req.body?.store_id || req.body?.id || req.headers["x-shop-id"];
    const customer = req.body?.customer || req.body;
    const email = customer?.email;
    const phone = customer?.phone;
    const document = customer?.identification || customer?.identification_number;

    if (!email && !phone && !document) {
      return res.json({ data: [] });
    }

    const integration = await findTiendaNubeIntegration(shopId);

    if (!integration) {
      return res.json({ data: [] });
    }

    const [sales] = await pool.query(
      `SELECT id, order_number, customer_name, customer_email, customer_phone,
              customer_document, total_amount, status, created_at, updated_at
       FROM ecommerce_sale
       WHERE tenant_id = ?
         AND channel = 'tienda_nube'
         AND (
           (? IS NOT NULL AND customer_email = ?) OR
           (? IS NOT NULL AND customer_phone = ?) OR
           (? IS NOT NULL AND customer_document = ?)
         )
       ORDER BY created_at DESC
       LIMIT 200`,
      [
        integration.tenant_id,
        email,
        email,
        phone,
        phone,
        document,
        document,
      ]
    );

    const ids = sales.map((sale) => sale.id);
    let itemsBySale = {};

    if (ids.length) {
      const placeholders = ids.map(() => "?").join(", ");
      const [items] = await pool.query(
        `SELECT sale_id, product_name, sku, quantity, unit_price
         FROM ecommerce_sale_item
         WHERE sale_id IN (${placeholders})`,
        ids
      );
      itemsBySale = mapSaleItems(items);
    }

    await logIntegrationEvent({
      tenantId: integration.tenant_id,
      provider: "tienda_nube",
      level: "info",
      message: "Solicitud de data request atendida",
      payload: { shopId, count: sales.length },
    });

    res.json({
      data: sales.map((sale) => ({
        ...sale,
        items: itemsBySale[sale.id] || [],
      })),
    });
  } catch (error) {
    console.error("[Integrations] Error en customers-data-request TN:", error);
    res.status(500).json({ ok: false });
  }
});

export default router;

