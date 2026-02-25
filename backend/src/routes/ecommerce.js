import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";

export const ecommerce = Router();

ecommerce.use(requireAuth, requireRole("admin", "staff"));

const VALID_CHANNELS = new Set(["tienda_nube", "mercado_libre", "manual"]);

const mapSaleItems = (rows = []) => {
  return rows.reduce((acc, item) => {
    if (!acc[item.sale_id]) acc[item.sale_id] = [];
    acc[item.sale_id].push(item);
    return acc;
  }, {});
};

ecommerce.get("/sales", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const { status, channel, limit = 100 } = req.query;

    let sql = `SELECT * FROM ecommerce_sale WHERE tenant_id = ?`;
    const params = [tenantId];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }

    if (channel) {
      sql += " AND channel = ?";
      params.push(channel);
    }

    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(Number(limit) || 100);

    const [sales] = await pool.query(sql, params);
    const ids = sales.map(({ id }) => id);

    let itemsBySale = {};
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(", ");
      const [items] = await pool.query(
        `SELECT * FROM ecommerce_sale_item WHERE sale_id IN (${placeholders}) ORDER BY id ASC`,
        ids
      );
      itemsBySale = mapSaleItems(items);
    }

    res.json({
      ok: true,
      data: sales.map((sale) => ({
        ...sale,
        items: itemsBySale[sale.id] || [],
      })),
    });
  } catch (error) {
    console.error("[Ecommerce] Error listando ventas:", error);
    res.status(500).json({ ok: false, error: "No se pudieron cargar las ventas" });
  }
});

ecommerce.post("/sales", async (req, res) => {
  const tenantId = req.tenant.id;
  const {
    channel = "manual",
    source_order_id,
    order_number,
    customer_name,
    customer_email,
    customer_phone,
    customer_document,
    currency = "ARS",
    notes,
    items = [],
    raw_payload = null,
  } = req.body || {};

  if (!customer_name || !Array.isArray(items) || !items.length) {
    return res.status(400).json({
      ok: false,
      error: "Se requiere nombre del cliente y al menos un ítem",
    });
  }

  if (!VALID_CHANNELS.has(channel)) {
    return res.status(400).json({ ok: false, error: "Canal inválido" });
  }

  const normalizedItems = items.map((item, index) => ({
    product_name: item.product_name || item.descripcion || `Item ${index + 1}`,
    sku: item.sku || item.codigo || null,
    quantity: Number(item.quantity || item.cantidad || 1),
    unit_price: Number(item.unit_price || item.precio_unitario || 0),
  }));

  const total_amount = normalizedItems.reduce(
    (sum, item) => sum + (item.unit_price * item.quantity),
    0
  );

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [saleResult] = await conn.query(
      `INSERT INTO ecommerce_sale (
        tenant_id, channel, source_order_id, order_number,
        customer_name, customer_email, customer_phone, customer_document,
        currency, total_amount, notes, raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
      [
        tenantId,
        channel,
        source_order_id || null,
        order_number || null,
        customer_name,
        customer_email || null,
        customer_phone || null,
        customer_document || null,
        currency,
        total_amount,
        notes || null,
        raw_payload ? JSON.stringify(raw_payload) : null,
      ]
    );

    const saleId = saleResult.insertId;

    const itemValues = normalizedItems.map((item) => [
      saleId,
      item.product_name,
      item.sku || null,
      item.quantity,
      item.unit_price,
      null,
    ]);

    await conn.query(
      `INSERT INTO ecommerce_sale_item (
        sale_id, product_name, sku, quantity, unit_price, metadata
      ) VALUES ?`,
      [itemValues]
    );

    await conn.commit();

    res.status(201).json({
      ok: true,
      data: {
        id: saleId,
        total_amount,
      },
    });
  } catch (error) {
    await conn.rollback();
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        ok: false,
        error: "Esta venta ya fue registrada anteriormente",
      });
    }
    console.error("[Ecommerce] Error creando venta:", error);
    res.status(500).json({ ok: false, error: "No se pudo registrar la venta" });
  } finally {
    conn.release();
  }
});

ecommerce.post("/sales/:id/mark-invoiced", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const saleId = Number(req.params.id);
    const { invoice_id, invoice_number, cae } = req.body || {};

    const [result] = await pool.query(
      `UPDATE ecommerce_sale
       SET status = 'invoiced',
           invoice_id = ?,
           invoice_number = ?,
           updated_at = NOW(),
           notes = CASE WHEN ? IS NOT NULL THEN CONCAT(COALESCE(notes,''), '\\nCAE: ', ?) ELSE notes END
       WHERE id = ? AND tenant_id = ?`,
      [
        invoice_id || null,
        invoice_number || null,
        cae || null,
        cae || null,
        saleId,
        tenantId,
      ]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, error: "Venta no encontrada" });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("[Ecommerce] Error marcando venta como facturada:", error);
    res.status(500).json({ ok: false, error: "No se pudo actualizar la venta" });
  }
});


