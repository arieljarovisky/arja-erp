// src/routes/reminders.js — Sistema de recordatorios de turnos
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import { sendWhatsAppText } from "../whatsapp.js";
import { sendNotificationToCustomer } from "../services/pushNotifications.js";

// Helper para obtener nombre del tenant
async function getTenantName(tenantId) {
  if (!tenantId) return "ARJA ERP";
  try {
    const [[tenant]] = await pool.query(
      "SELECT name FROM tenant WHERE id = ? LIMIT 1",
      [tenantId]
    );
    return tenant?.name || "ARJA ERP";
  } catch (error) {
    console.error(`[Reminders] Error obteniendo nombre del tenant ${tenantId}:`, error.message);
    return "ARJA ERP";
  }
}

export const reminders = Router();
reminders.use(requireAuth, requireRole("admin", "user"));

async function ensurePushReminderColumn() {
  try {
    await pool.query(`ALTER TABLE appointment ADD COLUMN push_reminder_sent_at DATETIME NULL`);
  } catch (e) {
    // noop
  }
}

/**
 * GET /api/reminders/config
 * Obtiene la configuración de recordatorios del tenant
 */
reminders.get("/config", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const [rows] = await pool.query(
      `SELECT config_key, config_value 
       FROM system_config 
       WHERE tenant_id = ? AND config_key LIKE 'reminders.%'`,
      [tenantId]
    );

    const config = {
      enabled: false,
      advance_hours: 24,
    };

    for (const row of rows) {
      const key = row.config_key.replace("reminders.", "");
      if (key === "enabled") {
        config.enabled = row.config_value === "1" || row.config_value === "true";
      } else if (key === "advance_hours") {
        config.advance_hours = Number(row.config_value) || 24;
      }
    }

    res.json({ ok: true, data: config });
  } catch (e) {
    console.error("[GET /reminders/config] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * PUT /api/reminders/config
 * Actualiza la configuración de recordatorios
 */
reminders.put("/config", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const { enabled, advance_hours } = req.body || {};

    // Validar advance_hours
    const hours = Number(advance_hours);
    if (isNaN(hours) || hours < 0 || hours > 168) {
      return res.status(400).json({ 
        ok: false, 
        error: "Las horas de anticipación deben ser entre 0 y 168 (7 días)" 
      });
    }

    // Guardar configuración
    await pool.query(
      `INSERT INTO system_config (tenant_id, config_key, config_value, updated_at)
       VALUES (?, 'reminders.enabled', ?, NOW())
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()`,
      [tenantId, enabled ? "1" : "0"]
    );

    await pool.query(
      `INSERT INTO system_config (tenant_id, config_key, config_value, updated_at)
       VALUES (?, 'reminders.advance_hours', ?, NOW())
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()`,
      [tenantId, String(hours)]
    );

    res.json({ ok: true, message: "Configuración guardada" });
  } catch (e) {
    console.error("[PUT /reminders/config] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/reminders/push-config
 * Configuración específica para recordatorios push
 */
reminders.get("/push-config", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    const [rows] = await pool.query(
      `SELECT config_key, config_value 
       FROM system_config 
       WHERE tenant_id = ? AND config_key LIKE 'push_reminders.%'`,
      [tenantId]
    );
    const config = {
      enabled: true,
      advance_minutes: 30,
      window_minutes: 10,
    };
    for (const row of rows) {
      const key = row.config_key.replace("push_reminders.", "");
      if (key === "enabled") {
        config.enabled = row.config_value === "1" || row.config_value === "true";
      } else if (key === "advance_minutes") {
        config.advance_minutes = Number(row.config_value) || 30;
      } else if (key === "window_minutes") {
        config.window_minutes = Number(row.config_value) || 10;
      }
    }
    res.json({ ok: true, data: config });
  } catch (e) {
    console.error("[GET /reminders/push-config] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * PUT /api/reminders/push-config
 * Actualiza la configuración de recordatorios push
 */
reminders.put("/push-config", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    const { enabled, advance_minutes, window_minutes } = req.body || {};
    const adv = Number(advance_minutes);
    const win = Number(window_minutes);
    if (isNaN(adv) || adv < 0 || adv > 1440) {
      return res.status(400).json({ ok: false, error: "advance_minutes debe ser entre 0 y 1440" });
    }
    if (isNaN(win) || win < 1 || win > 120) {
      return res.status(400).json({ ok: false, error: "window_minutes debe ser entre 1 y 120" });
    }
    await pool.query(
      `INSERT INTO system_config (tenant_id, config_key, config_value, updated_at)
       VALUES (?, 'push_reminders.enabled', ?, NOW())
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()`,
      [tenantId, enabled ? "1" : "0"]
    );
    await pool.query(
      `INSERT INTO system_config (tenant_id, config_key, config_value, updated_at)
       VALUES (?, 'push_reminders.advance_minutes', ?, NOW())
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()`,
      [tenantId, String(adv)]
    );
    await pool.query(
      `INSERT INTO system_config (tenant_id, config_key, config_value, updated_at)
       VALUES (?, 'push_reminders.window_minutes', ?, NOW())
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()`,
      [tenantId, String(win)]
    );
    res.json({ ok: true, message: "Configuración push guardada" });
  } catch (e) {
    console.error("[PUT /reminders/push-config] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/reminders/send
 * Envía recordatorios para turnos próximos (puede llamarse manualmente o desde un cron)
 */
reminders.post("/send", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    // Obtener configuración
    const [[enabledRow]] = await pool.query(
      `SELECT config_value FROM system_config 
       WHERE tenant_id = ? AND config_key = 'reminders.enabled'`,
      [tenantId]
    );
    const enabled = enabledRow?.config_value === "1" || enabledRow?.config_value === "true";

    if (!enabled) {
      return res.json({ 
        ok: true, 
        message: "Recordatorios deshabilitados",
        sent: 0 
      });
    }

    const [[hoursRow]] = await pool.query(
      `SELECT config_value FROM system_config 
       WHERE tenant_id = ? AND config_key = 'reminders.advance_hours'`,
      [tenantId]
    );
    const advanceHours = Number(hoursRow?.config_value) || 24;

    // Calcular ventana de tiempo para recordatorios
    const now = new Date();
    const reminderWindowStart = new Date(now.getTime() + advanceHours * 60 * 60 * 1000);
    const reminderWindowEnd = new Date(reminderWindowStart.getTime() + 60 * 60 * 1000); // Ventana de 1 hora

    // Buscar turnos que necesitan recordatorio
    const [appointments] = await pool.query(
      `SELECT 
        a.id,
        a.starts_at,
        a.status,
        a.deposit_decimal,
        c.name AS customer_name,
        c.phone_e164,
        s.name AS service_name,
        s.price_decimal,
        i.name AS instructor_name
      FROM appointment a
      JOIN customer c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
      JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
      JOIN instructor i ON i.id = a.instructor_id AND i.tenant_id = a.tenant_id
      WHERE a.tenant_id = ?
        AND a.status IN ('scheduled', 'confirmed', 'deposit_paid', 'pending_deposit')
        AND a.starts_at >= ?
        AND a.starts_at <= ?
        AND (a.reminder_sent_at IS NULL OR a.reminder_sent_at < DATE_SUB(a.starts_at, INTERVAL ? HOUR))
        AND c.phone_e164 IS NOT NULL
        AND c.phone_e164 != ''
      ORDER BY a.starts_at ASC`,
      [tenantId, reminderWindowStart, reminderWindowEnd, advanceHours]
    );

    if (!appointments.length) {
      return res.json({ 
        ok: true, 
        message: "No hay turnos que requieran recordatorio en este momento",
        sent: 0 
      });
    }

    const tenantName = await getTenantName(tenantId);
    let sentCount = 0;
    const errors = [];

    for (const apt of appointments) {
      try {
        const startDate = new Date(apt.starts_at);
        const fecha = startDate.toLocaleDateString("es-AR", {
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });
        const hora = startDate.toLocaleTimeString("es-AR", {
          hour: "2-digit",
          minute: "2-digit",
        });

        let msg =
          `Hola ${apt.customer_name || "cliente"}! 👋\n\n` +
          `📅 *Recordatorio de tu turno*\n\n` +
          `Tenés un turno programado:\n` +
          `• Servicio: ${apt.service_name}\n` +
          `• Profesional: ${apt.instructor_name}\n` +
          `• Fecha: ${fecha}\n` +
          `• Hora: ${hora}\n`;

        // Si tiene seña pendiente, agregar información
        if (apt.status === "pending_deposit" && apt.deposit_decimal > 0) {
          msg += `\n⚠️ *Recordá que tenés una seña pendiente de $${Number(apt.deposit_decimal).toFixed(2)}*\n`;
        }

        msg += `\n¡Te esperamos en *${tenantName}*! 💈\n\n` +
          `Si necesitás cambiar o cancelar, avisanos con anticipación.`;

        await sendWhatsAppText(apt.phone_e164, msg, tenantId);

        // Marcar como enviado
        await pool.query(
          `UPDATE appointment 
           SET reminder_sent_at = NOW() 
           WHERE id = ? AND tenant_id = ?`,
          [apt.id, tenantId]
        );

        sentCount++;
        console.log(`✅ [Reminders] Recordatorio enviado a ${apt.phone_e164} para turno ${apt.id}`);
      } catch (error) {
        console.error(`❌ [Reminders] Error enviando recordatorio para turno ${apt.id}:`, error.message);
        errors.push({ appointmentId: apt.id, error: error.message });
      }
    }

    res.json({ 
      ok: true, 
      message: `Se enviaron ${sentCount} recordatorios`,
      sent: sentCount,
      total: appointments.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (e) {
    console.error("[POST /reminders/send] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/reminders/send-push
 * Envía recordatorios push para turnos próximos según configuración push_reminders.*
 */
reminders.post("/send-push", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    await ensurePushReminderColumn();
    const [[enabledRow]] = await pool.query(
      `SELECT config_value FROM system_config 
       WHERE tenant_id = ? AND config_key = 'push_reminders.enabled'`,
      [tenantId]
    );
    const enabled = enabledRow?.config_value === "1" || enabledRow?.config_value === "true" || enabledRow?.config_value == null;
    if (!enabled) {
      return res.json({ ok: true, message: "Recordatorios push deshabilitados", sent: 0 });
    }
    const [[advRow]] = await pool.query(
      `SELECT config_value FROM system_config 
       WHERE tenant_id = ? AND config_key = 'push_reminders.advance_minutes'`,
      [tenantId]
    );
    const [[winRow]] = await pool.query(
      `SELECT config_value FROM system_config 
       WHERE tenant_id = ? AND config_key = 'push_reminders.window_minutes'`,
      [tenantId]
    );
    const advanceMinutes = Number(advRow?.config_value) || 30;
    const windowMinutes = Number(winRow?.config_value) || 10;
    const now = new Date();
    const targetStart = new Date(now.getTime() + advanceMinutes * 60 * 1000);
    const targetEnd = new Date(targetStart.getTime() + windowMinutes * 60 * 1000);
    const [appointments] = await pool.query(
      `SELECT 
        a.id,
        a.starts_at,
        a.status,
        c.id AS customer_id,
        c.name AS customer_name,
        s.name AS service_name,
        i.name AS instructor_name
      FROM appointment a
      JOIN customer c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
      JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
      JOIN instructor i ON i.id = a.instructor_id AND i.tenant_id = a.tenant_id
      WHERE a.tenant_id = ?
        AND a.status IN ('scheduled', 'confirmed', 'deposit_paid', 'pending_deposit')
        AND a.starts_at >= ?
        AND a.starts_at <= ?
        AND (a.push_reminder_sent_at IS NULL OR a.push_reminder_sent_at < DATE_SUB(a.starts_at, INTERVAL ? MINUTE))`,
      [tenantId, targetStart, targetEnd, advanceMinutes]
    );
    if (!appointments.length) {
      return res.json({ ok: true, message: "No hay turnos para recordatorio push en esta ventana", sent: 0 });
    }
    let sent = 0;
    const errors = [];
    for (const apt of appointments) {
      try {
        const startDate = new Date(apt.starts_at);
        const fecha = startDate.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit" });
        const hora = startDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
        await sendNotificationToCustomer(tenantId, apt.customer_id, {
          title: "Recordatorio de tu turno",
          body: `${apt.service_name} con ${apt.instructor_name} — ${fecha} ${hora}`,
          data: {
            type: "appointment_reminder",
            appointmentId: apt.id,
            startsAt: apt.starts_at,
          },
        });
        await pool.query(
          `UPDATE appointment SET push_reminder_sent_at = NOW() WHERE id = ? AND tenant_id = ?`,
          [apt.id, tenantId]
        );
        sent++;
      } catch (e) {
        console.error(`[Reminders] Error push turno ${apt.id}:`, e.message);
        errors.push({ appointmentId: apt.id, error: e.message });
      }
    }
    res.json({ ok: true, sent, total: appointments.length, errors: errors.length ? errors : undefined });
  } catch (e) {
    console.error("[POST /reminders/send-push] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/reminders/subscription-config
 * Obtiene la configuración de recordatorios de suscripción
 */
reminders.get("/subscription-config", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const [rows] = await pool.query(
      `SELECT config_key, config_value 
       FROM system_config 
       WHERE tenant_id = ? AND config_key LIKE 'subscription_reminders.%'`,
      [tenantId]
    );

    const config = {
      enabled: false,
      days_before: 3, // Por defecto, 3 días antes
    };

    for (const row of rows) {
      const key = row.config_key.replace("subscription_reminders.", "");
      if (key === "enabled") {
        config.enabled = row.config_value === "1" || row.config_value === "true";
      } else if (key === "days_before") {
        config.days_before = Number(row.config_value) || 3;
      }
    }

    res.json({ ok: true, data: config });
  } catch (e) {
    console.error("[GET /reminders/subscription-config] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * PUT /api/reminders/subscription-config
 * Actualiza la configuración de recordatorios de suscripción
 */
reminders.put("/subscription-config", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const { enabled, days_before } = req.body || {};

    // Validar days_before
    const days = Number(days_before);
    if (isNaN(days) || days < 0 || days > 30) {
      return res.status(400).json({ 
        ok: false, 
        error: "Los días de anticipación deben ser entre 0 y 30" 
      });
    }

    // Guardar configuración
    await pool.query(
      `INSERT INTO system_config (tenant_id, config_key, config_value, updated_at)
       VALUES (?, 'subscription_reminders.enabled', ?, NOW())
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()`,
      [tenantId, enabled ? "1" : "0"]
    );

    await pool.query(
      `INSERT INTO system_config (tenant_id, config_key, config_value, updated_at)
       VALUES (?, 'subscription_reminders.days_before', ?, NOW())
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()`,
      [tenantId, String(days)]
    );

    res.json({ ok: true, message: "Configuración guardada" });
  } catch (e) {
    console.error("[PUT /reminders/subscription-config] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/reminders/send-subscription
 * Envía recordatorios de pago para suscripciones próximas a vencer
 */
reminders.post("/send-subscription", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    // Obtener configuración
    const [[enabledRow]] = await pool.query(
      `SELECT config_value FROM system_config 
       WHERE tenant_id = ? AND config_key = 'subscription_reminders.enabled'`,
      [tenantId]
    );
    const enabled = enabledRow?.config_value === "1" || enabledRow?.config_value === "true";

    if (!enabled) {
      return res.json({ 
        ok: true, 
        message: "Recordatorios de suscripción deshabilitados",
        sent: 0 
      });
    }

    const [[daysRow]] = await pool.query(
      `SELECT config_value FROM system_config 
       WHERE tenant_id = ? AND config_key = 'subscription_reminders.days_before'`,
      [tenantId]
    );
    const daysBefore = Number(daysRow?.config_value) || 3;

    // Calcular ventana de tiempo para recordatorios
    const now = new Date();
    const reminderDate = new Date(now);
    reminderDate.setDate(reminderDate.getDate() + daysBefore);
    reminderDate.setHours(0, 0, 0, 0);
    
    const reminderDateEnd = new Date(reminderDate);
    reminderDateEnd.setHours(23, 59, 59, 999);

    // Buscar suscripciones que necesitan recordatorio
    const [subscriptions] = await pool.query(
      `SELECT 
        ps.id,
        ps.tenant_id,
        ps.plan_code,
        ps.plan_label,
        ps.amount,
        ps.currency,
        ps.next_charge_at,
        ps.payer_email,
        ps.reminder_sent_at,
        t.name AS tenant_name
      FROM platform_subscription ps
      JOIN tenant t ON t.id = ps.tenant_id
      WHERE ps.status = 'authorized'
        AND ps.next_charge_at IS NOT NULL
        AND ps.next_charge_at >= ?
        AND ps.next_charge_at <= ?
        AND (ps.reminder_sent_at IS NULL OR ps.reminder_sent_at < DATE_SUB(ps.next_charge_at, INTERVAL ? DAY))
      ORDER BY ps.next_charge_at ASC`,
      [reminderDate, reminderDateEnd, daysBefore]
    );

    if (!subscriptions.length) {
      return res.json({ 
        ok: true, 
        message: "No hay suscripciones que requieran recordatorio en este momento",
        sent: 0 
      });
    }

    let sentCount = 0;
    const errors = [];

    for (const sub of subscriptions) {
      try {
        // Obtener el email del admin del tenant para enviar el recordatorio
        const [[adminUser]] = await pool.query(
          `SELECT email, name FROM user 
           WHERE tenant_id = ? AND role = 'admin' 
           ORDER BY created_at ASC 
           LIMIT 1`,
          [sub.tenant_id]
        );

        if (!adminUser?.email) {
          console.warn(`[Subscription Reminders] No se encontró admin para tenant ${sub.tenant_id}`);
          continue;
        }

        const nextChargeDate = new Date(sub.next_charge_at);
        const fecha = nextChargeDate.toLocaleDateString("es-AR", {
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });

        const amount = Number(sub.amount);
        const currency = sub.currency || "ARS";
        const amountFormatted = new Intl.NumberFormat("es-AR", {
          style: "currency",
          currency: currency,
          minimumFractionDigits: 0,
        }).format(amount);

        let msg =
          `Hola ${adminUser.name || "administrador"}! 👋\n\n` +
          `📅 *Recordatorio de pago de suscripción*\n\n` +
          `Tu suscripción al plan *${sub.plan_label}* se renovará el ${fecha}.\n\n` +
          `💵 Monto a pagar: *${amountFormatted}*\n\n` +
          `El pago se procesará automáticamente desde Mercado Pago. Asegurate de tener fondos suficientes en tu cuenta.\n\n` +
          `Si tenés alguna consulta, contactanos.`;

        // Enviar por WhatsApp si está configurado
        // Por ahora, solo enviamos un mensaje de log
        // En el futuro, podríamos enviar por email o WhatsApp si el admin tiene número configurado
        console.log(`[Subscription Reminders] Recordatorio para tenant ${sub.tenant_id}:`, {
          email: adminUser.email,
          plan: sub.plan_label,
          nextCharge: fecha,
          amount: amountFormatted,
        });

        // Marcar como enviado
        await pool.query(
          `UPDATE platform_subscription 
           SET reminder_sent_at = NOW() 
           WHERE id = ? AND tenant_id = ?`,
          [sub.id, sub.tenant_id]
        );

        sentCount++;
        console.log(`✅ [Subscription Reminders] Recordatorio registrado para suscripción ${sub.id} del tenant ${sub.tenant_id}`);
      } catch (error) {
        console.error(`❌ [Subscription Reminders] Error procesando suscripción ${sub.id}:`, error.message);
        errors.push({ subscriptionId: sub.id, error: error.message });
      }
    }

    res.json({ 
      ok: true, 
      message: `Se procesaron ${sentCount} recordatorios de suscripción`,
      sent: sentCount,
      total: subscriptions.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (e) {
    console.error("[POST /reminders/send-subscription] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/reminders/send/:appointmentId
 * Envía un recordatorio manual para un turno específico
 */
reminders.post("/send/:appointmentId", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const appointmentId = parseInt(req.params.appointmentId, 10);
    if (isNaN(appointmentId)) {
      return res.status(400).json({ ok: false, error: "ID de turno inválido" });
    }

    // Obtener información del turno
    const [[apt]] = await pool.query(
      `SELECT 
        a.id,
        a.starts_at,
        a.status,
        a.deposit_decimal,
        c.name AS customer_name,
        c.phone_e164,
        s.name AS service_name,
        s.price_decimal,
        i.name AS instructor_name
      FROM appointment a
      JOIN customer c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
      JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
      JOIN instructor i ON i.id = a.instructor_id AND i.tenant_id = a.tenant_id
      WHERE a.id = ? AND a.tenant_id = ?`,
      [appointmentId, tenantId]
    );

    if (!apt) {
      return res.status(404).json({ ok: false, error: "Turno no encontrado" });
    }

    if (!apt.phone_e164) {
      return res.status(400).json({ ok: false, error: "El cliente no tiene teléfono registrado" });
    }

    if (!["scheduled", "confirmed", "deposit_paid", "pending_deposit"].includes(apt.status)) {
      return res.status(400).json({ 
        ok: false, 
        error: "Solo se pueden enviar recordatorios para turnos confirmados o programados" 
      });
    }

    const tenantName = await getTenantName(tenantId);
    const startDate = new Date(apt.starts_at);
    const fecha = startDate.toLocaleDateString("es-AR", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const hora = startDate.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    let msg =
      `Hola ${apt.customer_name || "cliente"}! 👋\n\n` +
      `📅 *Recordatorio de tu turno*\n\n` +
      `Tenés un turno programado:\n` +
      `• Servicio: ${apt.service_name}\n` +
      `• Profesional: ${apt.instructor_name}\n` +
      `• Fecha: ${fecha}\n` +
      `• Hora: ${hora}\n`;

    // Si tiene seña pendiente, agregar información
    if (apt.status === "pending_deposit" && apt.deposit_decimal > 0) {
      msg += `\n⚠️ *Recordá que tenés una seña pendiente de $${Number(apt.deposit_decimal).toFixed(2)}*\n`;
    }

    msg += `\n¡Te esperamos en *${tenantName}*! 💈\n\n` +
      `Si necesitás cambiar o cancelar, avisanos con anticipación.`;

    await sendWhatsAppText(apt.phone_e164, msg, tenantId);

    // Marcar como enviado
    await pool.query(
      `UPDATE appointment 
       SET reminder_sent_at = NOW() 
       WHERE id = ? AND tenant_id = ?`,
      [appointmentId, tenantId]
    );

    res.json({ 
      ok: true, 
      message: "Recordatorio enviado correctamente"
    });
  } catch (e) {
    console.error("[POST /reminders/send/:appointmentId] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

