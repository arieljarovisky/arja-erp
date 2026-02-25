import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import { identifyTenant, requireTenant } from "../auth/tenant.js";
import { sendWhatsAppText, sendWhatsAppTemplate } from "../whatsapp.js";

export const crm = Router();

crm.use(identifyTenant);
crm.use(requireTenant);
crm.use(requireAuth);
crm.use(requireRole("admin", "staff"));

function normPhone(p) {
  if (!p) return null;
  return String(p).replace(/\s+/g, "").replace(/-/g, "");
}

const SEGMENTS = [
  {
    code: "inactive_60_days",
    label: "Inactivos 60 días",
    description: "Clientes sin turnos en los últimos 60 días.",
  },
  {
    code: "renewal_7_days",
    label: "Renovación en 7 días",
    description: "Clientes con membresía autorizada que vence en los próximos 7 días.",
  },
  {
    code: "deposit_pending_recent",
    label: "Seña pendiente (reciente)",
    description: "Clientes con turnos con seña pendiente en los últimos 14 días.",
  },
  {
    code: "deposit_expired_recent",
    label: "Seña vencida (reciente)",
    description: "Clientes con reserva vencida de seña en los últimos 14 días.",
  },
];

crm.get("/segments/presets", async (_req, res) => {
  res.json({ ok: true, data: SEGMENTS });
});

async function getSchedules(tenantId) {
  const [[row]] = await pool.query(
    `SELECT config_value FROM system_config WHERE tenant_id = ? AND config_key = 'crm.schedules' LIMIT 1`,
    [tenantId]
  );
  if (!row?.config_value) return [];
  try {
    const parsed = JSON.parse(row.config_value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveSchedules(tenantId, schedules) {
  const value = JSON.stringify(schedules || []);
  await pool.query(
    `INSERT INTO system_config (tenant_id, config_key, config_value)
     VALUES (?, 'crm.schedules', ?)
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [tenantId, value]
  );
}

async function getHistory(tenantId) {
  const [[row]] = await pool.query(
    `SELECT config_value FROM system_config WHERE tenant_id = ? AND config_key = 'crm.history' LIMIT 1`,
    [tenantId]
  );
  if (!row?.config_value) return [];
  try {
    const parsed = JSON.parse(row.config_value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveHistory(tenantId, history) {
  const value = JSON.stringify(history || []);
  await pool.query(
    `INSERT INTO system_config (tenant_id, config_key, config_value)
     VALUES (?, 'crm.history', ?)
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [tenantId, value]
  );
}

crm.get("/campaigns/schedules", async (req, res) => {
  try {
    const tenantId = Number(req.tenant?.id);
    const list = await getSchedules(tenantId);
    res.json({ ok: true, data: list });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error obteniendo programaciones" });
  }
});

crm.post("/campaigns/schedules", async (req, res) => {
  try {
    const tenantId = Number(req.tenant?.id);
    const { segmentCode, message, sendAt, max = 50 } = req.body || {};
    if (!segmentCode || !message || !sendAt) {
      return res.status(400).json({ ok: false, error: "segmentCode, message y sendAt son requeridos" });
    }
    const id = Date.now();
    const list = await getSchedules(tenantId);
    const next = [...list, { id, segmentCode, message, sendAt: String(sendAt), max: Number(max) || 50 }];
    await saveSchedules(tenantId, next);
    res.json({ ok: true, data: next });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error creando programación" });
  }
});

crm.delete("/campaigns/schedules/:id", async (req, res) => {
  try {
    const tenantId = Number(req.tenant?.id);
    const id = Number(req.params.id);
    const list = await getSchedules(tenantId);
    const next = list.filter((s) => Number(s.id) !== id);
    await saveSchedules(tenantId, next);
    res.json({ ok: true, data: next });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error eliminando programación" });
  }
});

crm.get("/campaigns/history", async (req, res) => {
  try {
    const tenantId = Number(req.tenant?.id);
    const list = await getHistory(tenantId);
    res.json({ ok: true, data: list });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error obteniendo historial" });
  }
});

// Segmentos personalizados almacenados en system_config (por tenant)
async function getCustomSegments(tenantId) {
  const [[row]] = await pool.query(
    `SELECT config_value 
       FROM system_config 
      WHERE tenant_id = ? 
        AND config_key = 'crm.custom_segments'
      LIMIT 1`,
    [tenantId]
  );
  if (!row?.config_value) return [];
  try {
    const parsed = JSON.parse(row.config_value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveCustomSegments(tenantId, segments) {
  const value = JSON.stringify(segments || []);
  await pool.query(
    `INSERT INTO system_config (tenant_id, config_key, config_value)
     VALUES (?, 'crm.custom_segments', ?)
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [tenantId, value]
  );
}

crm.get("/segments/custom", async (req, res) => {
  try {
    const tenantId = Number(req.tenant?.id);
    const segments = await getCustomSegments(tenantId);
    res.json({ ok: true, data: segments });
  } catch (error) {
    console.error("❌ [CRM /segments/custom] Error:", error);
    res.status(500).json({ ok: false, error: "Error obteniendo segmentos personalizados" });
  }
});

crm.post("/segments/custom", async (req, res) => {
  try {
    const tenantId = Number(req.tenant?.id);
    const { code, label, description, type, params } = req.body || {};
    if (!code || !label || !type) {
      return res.status(400).json({ ok: false, error: "code, label y type son requeridos" });
    }
    const allowedTypes = new Set(["inactive_x_days", "renewal_in_days", "deposit_pending_recent_days", "deposit_expired_recent_days"]);
    if (!allowedTypes.has(String(type))) {
      return res.status(400).json({ ok: false, error: "type inválido" });
    }
    const list = await getCustomSegments(tenantId);
    if (list.find((s) => String(s.code) === String(code))) {
      return res.status(400).json({ ok: false, error: "Ya existe un segmento con ese code" });
    }
    const next = [...list, { code, label, description: description || "", type, params: params || {} }];
    await saveCustomSegments(tenantId, next);
    res.json({ ok: true, data: next });
  } catch (error) {
    console.error("❌ [CRM POST /segments/custom] Error:", error);
    res.status(500).json({ ok: false, error: "Error guardando segmento personalizado" });
  }
});

crm.put("/segments/custom/:code", async (req, res) => {
  try {
    const tenantId = Number(req.tenant?.id);
    const code = String(req.params.code || "");
    const { label, description, type, params } = req.body || {};
    const list = await getCustomSegments(tenantId);
    const idx = list.findIndex((s) => String(s.code) === code);
    if (idx === -1) return res.status(404).json({ ok: false, error: "Segmento no encontrado" });
    if (type) {
      const allowedTypes = new Set(["inactive_x_days", "renewal_in_days", "deposit_pending_recent_days", "deposit_expired_recent_days"]);
      if (!allowedTypes.has(String(type))) {
        return res.status(400).json({ ok: false, error: "type inválido" });
      }
    }
    const updated = { ...list[idx] };
    if (label !== undefined) updated.label = label;
    if (description !== undefined) updated.description = description;
    if (type !== undefined) updated.type = type;
    if (params !== undefined) updated.params = params || {};
    const next = [...list];
    next[idx] = updated;
    await saveCustomSegments(tenantId, next);
    res.json({ ok: true, data: next });
  } catch (error) {
    console.error("❌ [CRM PUT /segments/custom/:code] Error:", error);
    res.status(500).json({ ok: false, error: "Error actualizando segmento personalizado" });
  }
});

crm.delete("/segments/custom/:code", async (req, res) => {
  try {
    const tenantId = Number(req.tenant?.id);
    const code = String(req.params.code || "");
    const list = await getCustomSegments(tenantId);
    const next = list.filter((s) => String(s.code) !== code);
    await saveCustomSegments(tenantId, next);
    res.json({ ok: true, data: next });
  } catch (error) {
    console.error("❌ [CRM DELETE /segments/custom/:code] Error:", error);
    res.status(500).json({ ok: false, error: "Error eliminando segmento personalizado" });
  }
});
crm.get("/segments/:code", async (req, res) => {
  const tenantId = Number(req.tenant?.id);
  const code = String(req.params.code || "").trim();
  const limit = Math.min(500, Number(req.query.limit) || 200);

  try {
    let rows = [];
    if (code === "inactive_60_days") {
      const [r] = await pool.query(
        `
        SELECT c.id, c.name, c.phone_e164 AS phone,
               MAX(a.starts_at) AS last_appointment_at
          FROM customer c
          LEFT JOIN appointment a
            ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
         WHERE c.tenant_id = ?
         GROUP BY c.id, c.name, c.phone_e164
        HAVING (last_appointment_at IS NULL OR last_appointment_at < DATE_SUB(NOW(), INTERVAL 60 DAY))
         ORDER BY last_appointment_at IS NULL DESC, last_appointment_at ASC
         LIMIT ?
        `,
        [tenantId, limit]
      );
      rows = r;
    } else if (code === "renewal_7_days") {
      const [r] = await pool.query(
        `
        SELECT c.id, c.name, c.phone_e164 AS phone, cs.next_charge_at
          FROM customer c
          JOIN customer_subscription cs
            ON cs.customer_id = c.id AND cs.tenant_id = c.tenant_id
         WHERE c.tenant_id = ?
           AND cs.status = 'authorized'
           AND cs.next_charge_at IS NOT NULL
           AND cs.next_charge_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)
         ORDER BY cs.next_charge_at ASC
         LIMIT ?
        `,
        [tenantId, limit]
      );
      rows = r;
    } else if (code === "deposit_pending_recent") {
      const [r] = await pool.query(
        `
        SELECT 
          c.id, 
          c.name, 
          c.phone_e164 AS phone,
          MAX(a.starts_at) AS last_starts_at
          FROM customer c
          JOIN appointment a
            ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
         WHERE c.tenant_id = ?
           AND a.status = 'pending_deposit'
           AND a.starts_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
         GROUP BY c.id, c.name, c.phone_e164
         ORDER BY last_starts_at DESC
         LIMIT ?
        `,
        [tenantId, limit]
      );
      rows = r;
    } else if (code === "deposit_expired_recent") {
      const [r] = await pool.query(
        `
        SELECT 
          c.id, 
          c.name, 
          c.phone_e164 AS phone,
          MAX(a.hold_until) AS last_hold_until
          FROM customer c
          JOIN appointment a
            ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
         WHERE c.tenant_id = ?
           AND a.status = 'pending_deposit'
           AND a.deposit_paid_at IS NULL
           AND a.hold_until IS NOT NULL
           AND a.hold_until < NOW()
           AND a.hold_until >= DATE_SUB(NOW(), INTERVAL 14 DAY)
         GROUP BY c.id, c.name, c.phone_e164
         ORDER BY last_hold_until DESC
         LIMIT ?
        `,
        [tenantId, limit]
      );
      rows = r;
    } else {
      // Intentar segmentos personalizados
      const custom = await getCustomSegments(tenantId);
      const seg = custom.find((s) => String(s.code) === code);
      if (!seg) {
        return res.status(400).json({ ok: false, error: "Segmento inválido" });
      }
      const type = String(seg.type || "");
      const days = Number(seg?.params?.days || seg?.days || 14);
      if (type === "inactive_x_days") {
        const [r] = await pool.query(
          `
          SELECT c.id, c.name, c.phone_e164 AS phone,
                 MAX(a.starts_at) AS last_appointment_at
            FROM customer c
            LEFT JOIN appointment a
              ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
           WHERE c.tenant_id = ?
           GROUP BY c.id, c.name, c.phone_e164
          HAVING (last_appointment_at IS NULL OR last_appointment_at < DATE_SUB(NOW(), INTERVAL ? DAY))
           ORDER BY last_appointment_at IS NULL DESC, last_appointment_at ASC
           LIMIT ?
          `,
          [tenantId, days, limit]
        );
        rows = r;
      } else if (type === "renewal_in_days") {
        const [r] = await pool.query(
          `
          SELECT c.id, c.name, c.phone_e164 AS phone, cs.next_charge_at
            FROM customer c
            JOIN customer_subscription cs
              ON cs.customer_id = c.id AND cs.tenant_id = c.tenant_id
           WHERE c.tenant_id = ?
             AND cs.status = 'authorized'
             AND cs.next_charge_at IS NOT NULL
             AND cs.next_charge_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? DAY)
           ORDER BY cs.next_charge_at ASC
           LIMIT ?
          `,
          [tenantId, days, limit]
        );
        rows = r;
      } else if (type === "deposit_pending_recent_days") {
        const [r] = await pool.query(
          `
          SELECT 
            c.id, 
            c.name, 
            c.phone_e164 AS phone,
            MAX(a.starts_at) AS last_starts_at
            FROM customer c
            JOIN appointment a
              ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
           WHERE c.tenant_id = ?
             AND a.status = 'pending_deposit'
             AND a.starts_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
           GROUP BY c.id, c.name, c.phone_e164
           ORDER BY last_starts_at DESC
           LIMIT ?
          `,
          [tenantId, days, limit]
        );
        rows = r;
      } else if (type === "deposit_expired_recent_days") {
        const [r] = await pool.query(
          `
          SELECT 
            c.id, 
            c.name, 
            c.phone_e164 AS phone,
            MAX(a.hold_until) AS last_hold_until
            FROM customer c
            JOIN appointment a
              ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
           WHERE c.tenant_id = ?
             AND a.status = 'pending_deposit'
             AND a.deposit_paid_at IS NULL
             AND a.hold_until IS NOT NULL
             AND a.hold_until < NOW()
             AND a.hold_until >= DATE_SUB(NOW(), INTERVAL ? DAY)
           GROUP BY c.id, c.name, c.phone_e164
           ORDER BY last_hold_until DESC
           LIMIT ?
          `,
          [tenantId, days, limit]
        );
        rows = r;
      } else {
        return res.status(400).json({ ok: false, error: "Tipo de segmento personalizado inválido" });
      }
    }

    const data = rows
      .map((r) => ({ id: r.id, name: r.name, phone: normPhone(r.phone) }))
      .filter((x) => x.phone && x.phone !== "");

    res.json({ ok: true, data, count: data.length });
  } catch (error) {
    console.error("❌ [CRM /segments/:code] Error:", error);
    res.status(500).json({ ok: false, error: "Error calculando segmento" });
  }
});

crm.post("/campaigns/send", async (req, res) => {
  const tenantId = Number(req.tenant?.id);
  const { segmentCode, message, preview = false, max = 50 } = req.body || {};

  if (!segmentCode || !message) {
    return res.status(400).json({ ok: false, error: "segmentCode y message son requeridos" });
  }

  try {
    // Reutilizar el endpoint de segmentos
    const fakeReq = { ...req, params: { code: segmentCode }, query: { limit: Math.min(500, Number(max) || 50) } };
    let recipients = [];
    {
      const [rows] = await pool.query("SELECT 1"); // dummy to ensure pool available
      // manual call: duplicar la lógica del GET para evitar dependencia de req/res
      let segRows = [];
      if (segmentCode === "inactive_60_days") {
        const [r] = await pool.query(
          `
          SELECT c.id, c.name, c.phone_e164 AS phone,
                 MAX(a.starts_at) AS last_appointment_at
            FROM customer c
            LEFT JOIN appointment a
              ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
           WHERE c.tenant_id = ?
           GROUP BY c.id, c.name, c.phone_e164
          HAVING (last_appointment_at IS NULL OR last_appointment_at < DATE_SUB(NOW(), INTERVAL 60 DAY))
           ORDER BY last_appointment_at IS NULL DESC, last_appointment_at ASC
           LIMIT ?
          `,
          [tenantId, Math.min(500, Number(max) || 50)]
        );
        segRows = r;
      } else if (segmentCode === "renewal_7_days") {
        const [r] = await pool.query(
          `
          SELECT c.id, c.name, c.phone_e164 AS phone, cs.next_charge_at
            FROM customer c
            JOIN customer_subscription cs
              ON cs.customer_id = c.id AND cs.tenant_id = c.tenant_id
           WHERE c.tenant_id = ?
             AND cs.status = 'authorized'
             AND cs.next_charge_at IS NOT NULL
             AND cs.next_charge_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)
           ORDER BY cs.next_charge_at ASC
           LIMIT ?
          `,
          [tenantId, Math.min(500, Number(max) || 50)]
        );
        segRows = r;
      } else if (segmentCode === "deposit_pending_recent") {
        const [r] = await pool.query(
          `
          SELECT 
            c.id, 
            c.name, 
            c.phone_e164 AS phone,
            MAX(a.starts_at) AS last_starts_at
            FROM customer c
            JOIN appointment a
              ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
           WHERE c.tenant_id = ?
             AND a.status = 'pending_deposit'
             AND a.starts_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
           GROUP BY c.id, c.name, c.phone_e164
           ORDER BY last_starts_at DESC
           LIMIT ?
          `,
          [tenantId, Math.min(500, Number(max) || 50)]
        );
        segRows = r;
      } else if (segmentCode === "deposit_expired_recent") {
        const [r] = await pool.query(
          `
          SELECT 
            c.id, 
            c.name, 
            c.phone_e164 AS phone,
            MAX(a.hold_until) AS last_hold_until
            FROM customer c
            JOIN appointment a
              ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
           WHERE c.tenant_id = ?
             AND a.status = 'pending_deposit'
             AND a.deposit_paid_at IS NULL
             AND a.hold_until IS NOT NULL
             AND a.hold_until < NOW()
             AND a.hold_until >= DATE_SUB(NOW(), INTERVAL 14 DAY)
           GROUP BY c.id, c.name, c.phone_e164
           ORDER BY last_hold_until DESC
           LIMIT ?
          `,
          [tenantId, Math.min(500, Number(max) || 50)]
        );
        segRows = r;
      } else {
        // Intentar personalizado
        const custom = await getCustomSegments(tenantId);
        const seg = custom.find((s) => String(s.code) === String(segmentCode));
        if (!seg) {
          return res.status(400).json({ ok: false, error: "Segmento inválido" });
        }
        const type = String(seg.type || "");
        const days = Number(seg?.params?.days || seg?.days || 14);
        if (type === "inactive_x_days") {
          const [r] = await pool.query(
            `
            SELECT c.id, c.name, c.phone_e164 AS phone,
                   MAX(a.starts_at) AS last_appointment_at
              FROM customer c
              LEFT JOIN appointment a
                ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
             WHERE c.tenant_id = ?
             GROUP BY c.id, c.name, c.phone_e164
            HAVING (last_appointment_at IS NULL OR last_appointment_at < DATE_SUB(NOW(), INTERVAL ? DAY))
             ORDER BY last_appointment_at IS NULL DESC, last_appointment_at ASC
             LIMIT ?
            `,
            [tenantId, days, Math.min(500, Number(max) || 50)]
          );
          segRows = r;
        } else if (type === "renewal_in_days") {
          const [r] = await pool.query(
            `
            SELECT c.id, c.name, c.phone_e164 AS phone, cs.next_charge_at
              FROM customer c
              JOIN customer_subscription cs
                ON cs.customer_id = c.id AND cs.tenant_id = c.tenant_id
             WHERE c.tenant_id = ?
               AND cs.status = 'authorized'
               AND cs.next_charge_at IS NOT NULL
               AND cs.next_charge_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? DAY)
             ORDER BY cs.next_charge_at ASC
             LIMIT ?
            `,
            [tenantId, days, Math.min(500, Number(max) || 50)]
          );
          segRows = r;
        } else if (type === "deposit_pending_recent_days") {
          const [r] = await pool.query(
            `
            SELECT 
              c.id, 
              c.name, 
              c.phone_e164 AS phone,
              MAX(a.starts_at) AS last_starts_at
              FROM customer c
              JOIN appointment a
                ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
             WHERE c.tenant_id = ?
               AND a.status = 'pending_deposit'
               AND a.starts_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
             GROUP BY c.id, c.name, c.phone_e164
             ORDER BY last_starts_at DESC
             LIMIT ?
            `,
            [tenantId, days, Math.min(500, Number(max) || 50)]
          );
          segRows = r;
        } else if (type === "deposit_expired_recent_days") {
          const [r] = await pool.query(
            `
            SELECT 
              c.id, 
              c.name, 
              c.phone_e164 AS phone,
              MAX(a.hold_until) AS last_hold_until
              FROM customer c
              JOIN appointment a
                ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
             WHERE c.tenant_id = ?
               AND a.status = 'pending_deposit'
               AND a.deposit_paid_at IS NULL
               AND a.hold_until IS NOT NULL
               AND a.hold_until < NOW()
               AND a.hold_until >= DATE_SUB(NOW(), INTERVAL ? DAY)
             GROUP BY c.id, c.name, c.phone_e164
             ORDER BY last_hold_until DESC
             LIMIT ?
            `,
            [tenantId, days, Math.min(500, Number(max) || 50)]
          );
          segRows = r;
        } else {
          return res.status(400).json({ ok: false, error: "Tipo de segmento personalizado inválido" });
        }
      }
      recipients = segRows.map((r) => ({ id: r.id, name: r.name, phone: normPhone(r.phone) })).filter((x) => x.phone);
    }

    const sample = recipients.slice(0, Math.min(5, recipients.length));

    if (preview) {
      return res.json({
        ok: true,
        preview: sample.map((r) => ({
          to: r.phone,
          name: r.name,
          text: message.replace("{nombre}", r.name || "Cliente"),
        })),
        totalCandidates: recipients.length,
      });
    }

    let sent = 0;
    const results = [];
    for (const r of recipients) {
      const text = message.replace("{nombre}", r.name || "Cliente");
      try {
        const resp = await sendWhatsAppText(r.phone, text, tenantId, null);
        results.push({ to: r.phone, ok: true, id: resp?.messages?.[0]?.id || null });
        sent++;
        await new Promise((resolve) => setTimeout(resolve, 200)); // rate-limit suave
      } catch (err) {
        if (String(err?.code) === "131047") {
          let templateOk = false;
          let templateId = null;
          const langs = ["es_AR", "es", "es_419", "es_MX", "es_ES"];
          for (const lang of langs) {
            try {
              const tResp = await sendWhatsAppTemplate(
                r.phone,
                "reabrir_chat",
                lang,
                [
                  {
                    type: "body",
                    parameters: [
                      { type: "text", text: r.name || "Cliente" }
                    ]
                  }
                ],
                tenantId
              );
              templateOk = true;
              templateId = tResp?.messages?.[0]?.id || null;
              break;
            } catch {}
          }
          // Fallback si reabrir_chat no existe: intentar hello_world
          if (!templateOk) {
            const fallbackLangs = ["en_US", "es_AR", "es"];
            for (const lang of fallbackLangs) {
              try {
                const components = lang === "en_US" ? [] : [
                  {
                    type: "body",
                    parameters: [
                      { type: "text", text: r.name || "Cliente" }
                    ]
                  }
                ];
                const tResp = await sendWhatsAppTemplate(
                  r.phone,
                  "hello_world",
                  lang,
                  components,
                  tenantId
                );
                templateOk = true;
                templateId = tResp?.messages?.[0]?.id || null;
                break;
              } catch {}
            }
          }
          if (templateOk) {
            try {
              const followResp = await sendWhatsAppText(r.phone, text, tenantId, null);
              results.push({ to: r.phone, ok: true, id: followResp?.messages?.[0]?.id || templateId });
              sent++;
            } catch (followErr) {
              results.push({ to: r.phone, ok: false, id: templateId, error: followErr?.message || "followup_send_error" });
            }
          } else {
            results.push({
              to: r.phone,
              ok: false,
              id: templateId,
              error: "reengagement_failed"
            });
          }
        } else {
          results.push({ to: r.phone, ok: false, error: err?.message || "send_error" });
        }
      }
    }

    const total = recipients.length;
    const entry = {
      id: Date.now(),
      segmentCode,
      sent,
      total,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      preview: Boolean(preview),
    };
    try {
      const history = await getHistory(tenantId);
      const nextHist = [entry, ...history].slice(0, 200);
      await saveHistory(tenantId, nextHist);
    } catch {}
    res.json({ ok: true, sent, total, results });
  } catch (error) {
    console.error("❌ [CRM /campaigns/send] Error:", error);
    res.status(500).json({ ok: false, error: "Error enviando campaña" });
  }
});

export default crm;
