import { pool } from "../db.js";

function sanitizeString(value) {
  if (typeof value !== "string") return value ?? null;
  return value.trim() || null;
}

export async function upsertEcommerceSale({
  tenantId,
  channel,
  sourceOrderId,
  orderNumber,
  customer = {},
  currency = "ARS",
  totalAmount = 0,
  status = "pending",
  notes = null,
  items = [],
  rawPayload = null,
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [saleResult] = await conn.query(
      `INSERT INTO ecommerce_sale (
        tenant_id,
        channel,
        source_order_id,
        order_number,
        customer_name,
        customer_email,
        customer_phone,
        customer_document,
        currency,
        total_amount,
        status,
        notes,
        raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
      ON DUPLICATE KEY UPDATE
        customer_name = VALUES(customer_name),
        customer_email = VALUES(customer_email),
        customer_phone = VALUES(customer_phone),
        customer_document = VALUES(customer_document),
        total_amount = VALUES(total_amount),
        status = VALUES(status),
        notes = VALUES(notes),
        raw_payload = VALUES(raw_payload),
        updated_at = NOW(),
        id = LAST_INSERT_ID(id)`,
      [
        tenantId,
        channel,
        sourceOrderId,
        orderNumber,
        sanitizeString(customer.name) || "Consumidor Final",
        sanitizeString(customer.email),
        sanitizeString(customer.phone),
        sanitizeString(customer.document),
        currency || "ARS",
        Number(totalAmount) || 0,
        status,
        notes || null,
        rawPayload ? JSON.stringify(rawPayload) : null,
      ]
    );

    const saleId = saleResult.insertId;

    await conn.query(`DELETE FROM ecommerce_sale_item WHERE sale_id = ?`, [saleId]);

    if (items?.length) {
      const payload = items.map((item) => [
        saleId,
        sanitizeString(item.product_name) || "Producto",
        sanitizeString(item.sku),
        Number(item.quantity) || 1,
        Number(item.unit_price) || 0,
        item.metadata ? JSON.stringify(item.metadata) : null,
      ]);

      await conn.query(
        `INSERT INTO ecommerce_sale_item (
          sale_id,
          product_name,
          sku,
          quantity,
          unit_price,
          metadata
        ) VALUES ?`,
        [payload]
      );
    }

    await conn.commit();
    return saleId;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

