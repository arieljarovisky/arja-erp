// src/routes/notifications.js
import { Router } from "express";
import { pool } from "../db.js";
import crypto from "crypto";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import { sendNotificationToCustomer } from "../services/pushNotifications.js";
export const notifications = Router();

function stableStringify(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}
notifications.use(requireAuth);
// Asegurar tenant para tokens de cliente (mobile-app) sin pasar por identifyTenant
notifications.use((req, res, next) => {
  if (!req.tenant_id) {
    const tokenTenantId = req.user?.tenant_id ? Number(req.user.tenant_id) : null;
    const headerTenantId = req.headers['x-tenant-id'] ? Number(req.headers['x-tenant-id']) : null;
    req.tenant_id = tokenTenantId || headerTenantId || null;
  }
  // Fallback: crear objeto tenant mínimo para compatibilidad con código existente
  if (!req.tenant && req.tenant_id) {
    req.tenant = { id: req.tenant_id };
  }
  if (!req.tenant_id) {
    return res.status(403).json({ ok: false, error: "Tenant requerido para notificaciones" });
  }
  next();
});
// Notificaciones solo requieren autenticación (cada usuario ve sus propias notificaciones)
function computeIdemKey(userId, type, title, message, data) {
  const apptId = data && data.appointmentId != null
    ? String(data.appointmentId)
    : null;

  if (apptId) {
    // 🔒 Dedup por usuario + turno (sin importar el type)
    return `u${userId}|appt|${apptId}`;
  }

  // Otros tipos: hash estable del contenido
  const payload = JSON.stringify({ type, title, message, data: data || {} });
  const digest = crypto.createHash("sha1")
    .update(String(userId) + "|" + payload)
    .digest("hex");
  return "h|" + digest;
}
/** LISTAR (usa auth del router montado en index.js) */
notifications.get("/notifications", async (req, res) => {
  try {
    const { unreadOnly } = req.query;
    const userId = req.user.id;
    const tenantId = req.tenant?.id || req.tenant_id;
    
    const sql = `
      SELECT id, user_id, type, title, message, data, is_read, created_at
      FROM notifications
       WHERE user_id = ? AND tenant_id = ?
      ${unreadOnly === "true" ? "AND is_read = 0" : ""}
      ORDER BY created_at DESC
      LIMIT 50
    `;
    const [rows] = await pool.query(sql, [userId, tenantId]);
    
    res.json({
      ok: true,
      data: rows.map(r => ({ ...r, data: r.data ? safeParseJSON(r.data) : null })),
    });
  } catch (error) {
    console.error("❌ [GET /notifications] Error:", error);
    res.status(500).json({ error: "Error al obtener notificaciones" });
  }
});

/** CONTAR */
notifications.get("/notifications/count", async (req, res) => {
  try {
    const userId = req.user?.id;
    const tenantId = req.tenant?.id;
    
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND tenant_id = ? AND is_read = 0",
      [userId, tenantId]
    );
    
    res.json({ ok: true, count: rows[0]?.count || 0 });
  } catch (error) {
    console.error("❌ [/notifications/count] Error:", error.code, error.sqlMessage || error.message);
    res.status(500).json({ error: "Error al contar notificaciones" });
  }
});

/** MARCAR LEÍDA */
notifications.put("/notifications/:id/read", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ? AND tenant_id = ?",
      [id, req.user.id, req.tenant.id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error("❌ [PUT /notifications/:id/read] Error:", error);
    res.status(500).json({ error: "Error al marcar notificación" });
  }
});

/** MARCAR TODAS LEÍDAS */
notifications.put("/notifications/read-all", async (req, res) => {
  try {
    await pool.query(
      "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND tenant_id = ? AND is_read = 0",
      [req.user.id, req.tenant.id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error("❌ [PUT /notifications/read-all] Error:", error);
    res.status(500).json({ error: "Error al marcar notificaciones" });
  }
});

/** BORRAR */
notifications.delete("/notifications/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      "DELETE FROM notifications WHERE id = ? AND user_id = ? AND tenant_id = ?",
      [id, req.user.id, req.tenant.id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error("❌ [DELETE /notifications/:id] Error:", error);
    res.status(500).json({ error: "Error al eliminar notificación" });
  }
});

notifications.post("/notifications/push-test", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const userId = req.user.id;
    const { title, message, data } = req.body || {};
    const sent = await sendNotificationToCustomer(tenantId, userId, {
      title: title || "Prueba de notificaciones",
      body: message || "Esto es una notificación de prueba",
      data: { ...(data || {}), type: (data && data.type) || "debug" },
    });
    res.json({ ok: !!sent });
  } catch (error) {
    console.error("❌ [POST /notifications/push-test] Error:", error);
    res.status(500).json({ ok: false, error: "Error al enviar notificación de prueba" });
  }
});
 
/** CREAR (endpoint real) */
notifications.post("/notifications", async (req, res) => {
  try {
    const { userId, type, title, message, data = null } = req.body;
    const targetUserId = userId || req.user.id;
    const tenantId = req.tenant.id;
    const id = await createNotification({
      tenantId,
      userId: targetUserId,
      type,
      title,
      message,
      data: data || {},
    });
    res.json({ ok: true, id: id ?? null });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error al crear notificación" });
  }
});

function safeParseJSON(s) { try { return JSON.parse(s); } catch { return null; } }






export async function createNotification({ tenantId, userId, type, title, message, data }) {
  const idemKey = (() => {
    const apptId = data?.appointmentId ?? null;
    if (apptId) {
      return `u${userId}|appt${apptId}|${type}`;
    }
    const payload = JSON.stringify({ type, title, message, data: data ?? {} });
    const digest = crypto.createHash("sha1").update(`${userId}|${payload}`).digest("hex");
    return `h|${digest}`;
  })();

  try {
    const [result] = await pool.query(
      `
      INSERT INTO notifications (tenant_id, user_id, type, title, message, data, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        message = VALUES(message),
        updated_at = CURRENT_TIMESTAMP
      `,
    [tenantId, userId, type, title, message, JSON.stringify(data || {}), idemKey]
    );

    const notificationId = result?.insertId || null;

    if (tenantId && userId && notificationId) {
      try {
        await sendNotificationToCustomer(tenantId, userId, {
          title,
          body: message,
          data: {
            ...data,
            type,
            notificationId,
          },
        });
      } catch (pushError) {
        console.error('[createNotification] Error enviando push notification:', pushError);
      }
    }
    return notificationId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      console.warn(`[NOTIF] Notificación duplicada ignorada: ${idemKey}`);
      return null;
    }
    throw err;
  }
}
