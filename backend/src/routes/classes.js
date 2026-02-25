import { Router } from "express";
import { pool } from "../db.js";
import { requireRole } from "../auth/middlewares.js";
import { checkAppointmentOverlap } from "../helpers/overlapValidation.js";
import { ensureCustomerId, ensureActiveMembership, enforceClassMembershipLimits } from "./appointments.js";
import { randomUUID } from "crypto";
import { resolveBranchFilter, resolveBranchForWrite, ensureUserCanAccessBranch } from "../helpers/branchAccess.js";

const ACTIVE_ENROLL_STATUSES = ["reserved", "attended"];
const MAX_CLASS_RECURRING = Number(process.env.CLASS_RECURRING_MAX || 26);

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function toMySQLDateTime(val) {
  if (!val) return null;

  const pad = (n) => String(n).padStart(2, "0");
  const format = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  if (val instanceof Date && !Number.isNaN(val.getTime())) return format(val);

  if (typeof val === "string") {
    const s = val.trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
      const normalized = s.replace("T", " ");
      return normalized.length === 16 ? `${normalized}:00` : normalized.slice(0, 19);
    }
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/.test(s)) {
      return s.length === 16 ? `${s}:00` : s.slice(0, 19);
    }
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return format(parsed);
  }

  if (typeof val === "number") {
    const d = new Date(val > 1e12 ? val : val * 1000);
    if (!Number.isNaN(d.getTime())) return format(d);
  }
  return null;
}

async function countActiveEnrollments(conn, { tenantId, sessionId }) {
  const placeholders = ACTIVE_ENROLL_STATUSES.map(() => "?").join(",");
  const params = [tenantId, sessionId, ...ACTIVE_ENROLL_STATUSES];
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS total
       FROM class_enrollment
      WHERE tenant_id = ?
        AND session_id = ?
        AND status IN (${placeholders})`,
    params
  );
  return Number(row?.total || 0);
}

async function checkInstructorAvailability(conn, { tenantId, instructorId, startTime, endTime, excludeSessionId }) {
  const startStr = toMySQLDateTime(startTime);
  const endStr = toMySQLDateTime(endTime);

  const exclusions = excludeSessionId ? [excludeSessionId] : [];
  const params = [tenantId, instructorId, endStr, startStr, ...exclusions];
  const exclusionSQL = excludeSessionId ? "AND id <> ?" : "";

  const [[sessionOverlap]] = await conn.query(
    `SELECT 1
       FROM class_session
      WHERE tenant_id = ?
        AND instructor_id = ?
        AND status = 'scheduled'
        AND (starts_at < ? AND ends_at > ?)
        ${exclusionSQL}
      LIMIT 1`,
    params
  );
  if (sessionOverlap) {
    throw new Error("El profesor ya tiene otra clase en ese horario");
  }

  try {
    await checkAppointmentOverlap(conn, {
      tenantId,
      instructorId,
      startTime,
      endTime,
      excludeId: null,
      bufferMinutes: Number(process.env.APPT_BUFFER_MIN || 10),
      useLock: false,
    });
  } catch (err) {
    throw new Error("El profesor tiene un turno individual en ese horario");
  }
}

export const classesRouter = Router();

// Permitir a clientes móviles acceder a lectura de clases y a inscribirse
classesRouter.use((req, res, next) => {
  if (req.user?.type === "customer") {
    return next();
  }
  return requireRole("admin", "staff", "user")(req, res, next);
});

/* =========================
   Plantillas de clase
========================= */
classesRouter.get("/templates", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const [rows] = await pool.query(
      `SELECT *
         FROM class_template
        WHERE tenant_id = ?
        ORDER BY created_at DESC`,
      [tenantId]
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ [GET /classes/templates] ERROR:", err);
    res.status(500).json({ ok: false, error: "No se pudieron obtener las plantillas" });
  }
});

classesRouter.post("/templates", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const body = req.body || {};
    const {
      name,
      description,
      activityType,
      defaultCapacity,
      defaultDurationMin,
      defaultPriceDecimal,
      defaultInstructorId,
      color,
      isActive = true,
    } = body;

    if (!name || !activityType) {
      return res.status(400).json({ ok: false, error: "Faltan datos requeridos" });
    }

    const [ins] = await pool.query(
      `INSERT INTO class_template
        (tenant_id, name, description, activity_type, default_capacity, default_duration_min, default_price_decimal, default_instructor_id, color, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        name,
        description || null,
        activityType,
        Number(defaultCapacity || 1),
        Number(defaultDurationMin || 60),
        Number(defaultPriceDecimal || 0),
        defaultInstructorId || null,
        color || null,
        Boolean(isActive),
      ]
    );

    res.status(201).json({ ok: true, id: ins.insertId });
  } catch (err) {
    console.error("❌ [POST /classes/templates] ERROR:", err);
    res.status(500).json({ ok: false, error: "No se pudo crear la plantilla" });
  }
});

classesRouter.put("/templates/:id", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    const body = req.body || {};

    const fields = [];
    const params = [];
    const mapping = {
      name: "name",
      description: "description",
      activityType: "activity_type",
      defaultCapacity: "default_capacity",
      defaultDurationMin: "default_duration_min",
      defaultPriceDecimal: "default_price_decimal",
      defaultInstructorId: "default_instructor_id",
      color: "color",
      isActive: "is_active",
    };

    Object.entries(body).forEach(([key, value]) => {
      if (mapping[key] === undefined) return;
      fields.push(`${mapping[key]} = ?`);
      if (["defaultCapacity", "defaultDurationMin"].includes(key)) {
        params.push(Number(value));
      } else if (key === "defaultPriceDecimal") {
        params.push(Number(value));
      } else if (key === "defaultInstructorId") {
        params.push(value || null);
      } else {
        params.push(value);
      }
    });

    if (!fields.length) {
      return res.status(400).json({ ok: false, error: "No hay campos para actualizar" });
    }

    const [upd] = await pool.query(
      `UPDATE class_template
          SET ${fields.join(", ")}
        WHERE id = ? AND tenant_id = ?`,
      [...params, id, tenantId]
    );

    if (upd.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Plantilla no encontrada" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ [PUT /classes/templates/:id] ERROR:", err);
    res.status(500).json({ ok: false, error: "No se pudo actualizar la plantilla" });
  }
});

/* =========================
   Sesiones de clase
========================= */
classesRouter.get("/sessions", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const { from, to, status, instructorId, activityType } = req.query;
    const filter = resolveBranchFilter(req, { allowAll: true });
    const branchClause = filter.mode === "all" ? "" : " AND cs.branch_id = ?";

    const params = [tenantId];
    let sql = `
      SELECT 
        cs.*,
        st.name AS instructor_name,
        ct.name AS template_name,
        cs.series_id,
        (
          SELECT COUNT(*)
            FROM class_enrollment ce
           WHERE ce.session_id = cs.id
             AND ce.tenant_id = cs.tenant_id
             AND ce.status IN ('reserved','attended')
        ) AS enrolled_count
        FROM class_session cs
        JOIN instructor st ON st.id = cs.instructor_id AND st.tenant_id = cs.tenant_id
        LEFT JOIN class_template ct ON ct.id = cs.template_id
       WHERE cs.tenant_id = ?
        ${branchClause}
    `;
    if (filter.mode !== "all") {
      params.push(filter.branchId);
    }

    if (from) {
      sql += " AND cs.starts_at >= ?";
      params.push(from);
    }
    if (to) {
      sql += " AND cs.starts_at <= ?";
      params.push(to);
    }
    if (status) {
      sql += " AND cs.status = ?";
      params.push(status);
    }
    if (instructorId) {
      sql += " AND cs.instructor_id = ?";
      params.push(Number(instructorId));
    }
    if (activityType) {
      sql += " AND cs.activity_type = ?";
      params.push(activityType);
    }

    sql += " ORDER BY cs.starts_at ASC";

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ [GET /classes/sessions] ERROR:", err);
    // Manejar errores de acceso a sucursal
    const statusCode = err?.statusCode || err?.status;
    if (statusCode === 403) {
      return res.status(403).json({ ok: false, error: err.message || "No tenés permisos para esta sucursal" });
    }
    if (statusCode === 400 && err?.message?.includes("permisos")) {
      return res.status(403).json({ ok: false, error: err.message || "No tenés permisos para esta sucursal" });
    }
    if (statusCode) {
      return res.status(statusCode).json({ ok: false, error: err.message || "No se pudieron obtener las clases" });
    }
    res.status(500).json({ ok: false, error: "No se pudieron obtener las clases" });
  }
});

classesRouter.post("/sessions", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant.id;
    const body = req.body || {};

    const templateId = body.templateId ? Number(body.templateId) : null;
    const serviceIdBase = body.serviceId !== undefined && body.serviceId !== null && body.serviceId !== ""
      ? Number(body.serviceId)
      : null;
    const instructorIdBase = Number(body.instructorId);
    const activityTypeBase = body.activityType ? String(body.activityType).trim() : "";
    const notesBase = body.notes ? String(body.notes).trim() : null;
    const repeatSessions = Array.isArray(body.repeat?.sessions) ? body.repeat.sessions : [];
    const seriesIdBase = body.seriesId ? String(body.seriesId) : repeatSessions.length ? randomUUID() : null;
    const branchOverrideBase = body.branchId ? Number(body.branchId) : null;

    if (!instructorIdBase || !body.startsAt || !body.endsAt || !activityTypeBase) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Faltan datos requeridos" });
    }

    const capacityBase = Number(body.capacityMax ?? 1);
    if (!Number.isFinite(capacityBase) || capacityBase <= 0) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "El cupo debe ser mayor a cero" });
    }
    const priceBase = Number(body.priceDecimal ?? 0);

    const baseStartMySQL = toMySQLDateTime(body.startsAt);
    const baseEndMySQL = toMySQLDateTime(body.endsAt);
    if (!baseStartMySQL || !baseEndMySQL) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Fechas inválidas" });
    }

    const baseStartDate = new Date(baseStartMySQL.replace(" ", "T"));
    const baseEndDate = new Date(baseEndMySQL.replace(" ", "T"));
    if (Number.isNaN(baseStartDate.getTime()) || Number.isNaN(baseEndDate.getTime()) || baseStartDate >= baseEndDate) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "La hora de fin debe ser posterior al inicio" });
    }

    const instructorBranchCache = new Map();
    const getInstructorBranch = async (id) => {
      if (instructorBranchCache.has(id)) {
        return instructorBranchCache.get(id);
      }
      const [[row]] = await conn.query(
        "SELECT id, branch_id FROM instructor WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1",
        [Number(id), tenantId]
      );
      if (!row) {
        throw new Error("Profesional inexistente o inactivo");
      }
      instructorBranchCache.set(id, row.branch_id || null);
      return row.branch_id || null;
    };

    const resolveSessionBranch = async ({ branchOverride, instructorId }) => {
      const instructorBranch = await getInstructorBranch(instructorId);
      if (branchOverride) {
        const branch = await resolveBranchForWrite(req, { branchId: branchOverride, conn });
        return branch.id;
      }
      if (instructorBranch) {
        ensureUserCanAccessBranch(req.user, Number(instructorBranch));
        return Number(instructorBranch);
      }
      const branch = await resolveBranchForWrite(req, { conn });
      return branch.id;
    };

    const baseBranchId = await resolveSessionBranch({
      branchOverride: branchOverrideBase,
      instructorId: instructorIdBase,
    });

    const sessionRequests = [
      {
        templateId,
        instructorId: instructorIdBase,
        serviceId: serviceIdBase,
        startsAt: baseStartMySQL,
        endsAt: baseEndMySQL,
        activityType: activityTypeBase,
        capacityMax: capacityBase,
        priceDecimal: priceBase,
        notes: notesBase,
        seriesId: seriesIdBase,
        branchId: baseBranchId,
      },
    ];

    const baseDurationMs = baseEndDate.getTime() - baseStartDate.getTime();

    for (const extra of repeatSessions) {
      const extraStartMySQL = toMySQLDateTime(extra.startsAt);
      if (!extraStartMySQL) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "Fechas inválidas en repetición" });
      }

      let extraEndMySQL = toMySQLDateTime(extra.endsAt);
      if (!extraEndMySQL) {
        const durationMin = extra.durationMin != null ? Number(extra.durationMin) : null;
        if (durationMin && Number.isFinite(durationMin)) {
          const startDate = new Date(extraStartMySQL.replace(" ", "T"));
          const endDateAlt = new Date(startDate.getTime() + durationMin * 60000);
          extraEndMySQL = toMySQLDateTime(endDateAlt);
        } else if (baseDurationMs > 0) {
          const startDate = new Date(extraStartMySQL.replace(" ", "T"));
          const endDateAlt = new Date(startDate.getTime() + baseDurationMs);
          extraEndMySQL = toMySQLDateTime(endDateAlt);
        } else {
          await conn.rollback();
          return res.status(400).json({ ok: false, error: "No se pudo determinar la duración de la clase repetida" });
        }
      }

      const capacityExtra = Number(extra.capacityMax ?? capacityBase);
      const priceExtra = Number(extra.priceDecimal ?? priceBase);
      const seriesIdExtra = extra.seriesId ? String(extra.seriesId) : seriesIdBase;

      const extraInstructorId = extra.instructorId ? Number(extra.instructorId) : instructorIdBase;
      const extraBranchOverride = extra.branchId ? Number(extra.branchId) : null;
      const resolvedBranchId = await resolveSessionBranch({
        branchOverride: extraBranchOverride,
        instructorId: extraInstructorId,
      });

      sessionRequests.push({
        templateId: extra.templateId ? Number(extra.templateId) : templateId,
        instructorId: extraInstructorId,
        serviceId:
          extra.serviceId !== undefined && extra.serviceId !== null && extra.serviceId !== ""
            ? Number(extra.serviceId)
            : serviceIdBase,
        startsAt: extraStartMySQL,
        endsAt: extraEndMySQL,
        activityType: extra.activityType ? String(extra.activityType).trim() : activityTypeBase,
        capacityMax: capacityExtra,
        priceDecimal: priceExtra,
        notes: extra.notes ? String(extra.notes).trim() : notesBase,
        seriesId: seriesIdExtra,
        branchId: resolvedBranchId,
      });
    }

    const insertedIds = [];
    const scheduledWindows = [];

    for (const session of sessionRequests) {
      const startDate = new Date(session.startsAt.replace(" ", "T"));
      const endDate = new Date(session.endsAt.replace(" ", "T"));
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate >= endDate) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "Fechas inválidas" });
      }

      for (const prev of scheduledWindows) {
        if (prev.instructorId === session.instructorId && startDate < prev.endDate && endDate > prev.startDate) {
          await conn.rollback();
          const clashTime = startDate.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
          return res.status(400).json({
            ok: false,
            error: `Las clases generadas se superponen para el mismo profesor (conflicto el ${clashTime}).`,
          });
        }
      }

      await checkInstructorAvailability(conn, {
        tenantId,
        instructorId: session.instructorId,
        startTime: startDate,
        endTime: endDate,
      });

      const [ins] = await conn.query(
        `INSERT INTO class_session
          (tenant_id, branch_id, template_id, instructor_id, service_id, starts_at, ends_at, activity_type, capacity_max, price_decimal, series_id, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
        [
          tenantId,
          session.branchId,
          session.templateId || null,
          session.instructorId,
          session.serviceId || null,
          session.startsAt,
          session.endsAt,
          session.activityType,
          session.capacityMax,
          session.priceDecimal,
          session.seriesId || null,
          session.notes || null,
          req.user?.id || null,
        ]
      );

      insertedIds.push(ins.insertId);
      scheduledWindows.push({ instructorId: session.instructorId, startDate, endDate });
    }

    await conn.commit();
    res.status(201).json({ ok: true, ids: insertedIds, id: insertedIds[0] || null, seriesId: seriesIdBase || null });
  } catch (err) {
    await conn.rollback();
    console.error("❌ [POST /classes/sessions] ERROR:", err);
    // Manejar errores de acceso a sucursal
    const statusCode = err?.statusCode || err?.status;
    if (statusCode === 403) {
      return res.status(403).json({ ok: false, error: err.message || "No tenés permisos para esta sucursal" });
    }
    if (statusCode === 400 && err?.message?.includes("permisos")) {
      return res.status(403).json({ ok: false, error: err.message || "No tenés permisos para esta sucursal" });
    }
    if (statusCode) {
      return res.status(statusCode).json({ ok: false, error: err.message || "No se pudo crear la clase" });
    }
    res.status(500).json({ ok: false, error: err.message || "No se pudo crear la clase" });
  } finally {
    conn.release();
  }
});

classesRouter.get("/sessions/:id", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;

    const [[session]] = await pool.query(
      `SELECT cs.*, st.name AS instructor_name, ct.name AS template_name
         FROM class_session cs
         JOIN instructor st ON st.id = cs.instructor_id AND st.tenant_id = cs.tenant_id
         LEFT JOIN class_template ct ON ct.id = cs.template_id
        WHERE cs.id = ? AND cs.tenant_id = ?
        LIMIT 1`,
      [id, tenantId]
    );
    if (!session) {
      return res.status(404).json({ ok: false, error: "Clase no encontrada" });
    }

    const [enrollments] = await pool.query(
      `SELECT ce.*, c.name AS customer_name, c.phone_e164 AS customer_phone
         FROM class_enrollment ce
         JOIN customer c ON c.id = ce.customer_id AND c.tenant_id = ce.tenant_id
        WHERE ce.session_id = ? AND ce.tenant_id = ?
        ORDER BY ce.created_at ASC`,
      [id, tenantId]
    );

    res.json({ ...session, enrollments });
  } catch (err) {
    console.error("❌ [GET /classes/sessions/:id] ERROR:", err);
    res.status(500).json({ ok: false, error: "No se pudo obtener la clase" });
  }
});

classesRouter.patch("/sessions/:id", requireRole("admin", "user"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant.id;
    const { id } = req.params;
    const body = req.body || {};

    const [[session]] = await conn.query(
      `SELECT * FROM class_session WHERE id = ? AND tenant_id = ? FOR UPDATE`,
      [id, tenantId]
    );
    if (!session) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Clase no encontrada" });
    }

    const updates = [];
    const params = [];

    if (body.startsAt || body.endsAt) {
      const newStart = toMySQLDateTime(body.startsAt) || session.starts_at;
      const newEnd = toMySQLDateTime(body.endsAt) || session.ends_at;
      const startDate = new Date(newStart.replace(" ", "T"));
      const endDate = new Date(newEnd.replace(" ", "T"));
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate >= endDate) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "Fechas inválidas" });
      }

      await checkInstructorAvailability(conn, {
        tenantId,
        instructorId: body.instructorId ? Number(body.instructorId) : session.instructor_id,
        startTime: startDate,
        endTime: endDate,
        excludeSessionId: session.id,
      });

      updates.push("starts_at = ?", "ends_at = ?");
      params.push(newStart, newEnd);
    }

    const fieldsMap = {
      instructorId: { column: "instructor_id", transform: Number },
      serviceId: { column: "service_id", transform: Number },
      activityType: { column: "activity_type" },
      capacityMax: { column: "capacity_max", transform: Number },
      priceDecimal: { column: "price_decimal", transform: Number },
      notes: { column: "notes" },
      status: { column: "status" },
    };

    Object.entries(fieldsMap).forEach(([key, config]) => {
      if (body[key] === undefined) return;
      updates.push(`${config.column} = ?`);
      params.push(
        config.transform ? config.transform(body[key]) : body[key] === "" ? null : body[key]
      );
    });

    if (!updates.length) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "No hay cambios para aplicar" });
    }

    params.push(id, tenantId);
    await conn.query(
      `UPDATE class_session SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`,
      params
    );

    await conn.commit();

    // Procesar notificaciones si se solicitaron
    const notifyWhatsApp = body.notifyWhatsApp === true || body.notifyWhatsApp === "true";
    const notifyEmail = body.notifyEmail === true || body.notifyEmail === "true";
    const messageTemplate = body.messageTemplate || null;
    const customMessage = body.customMessage || null;

    // Rastrear el estado de las notificaciones
    const notificationStatus = {
      whatsApp: { requested: notifyWhatsApp, sent: 0, failed: 0, errors: [] },
      email: { requested: notifyEmail, sent: 0, failed: 0, errors: [] }
    };

    if (notifyWhatsApp || notifyEmail) {
      try {
        // Validar que el botón de ayuda esté habilitado y configurado para notificaciones de WhatsApp
        let canSendWhatsApp = true;
        if (notifyWhatsApp) {
          const { getTenantWhatsAppHub } = await import("../services/whatsappHub.js").catch(() => ({ getTenantWhatsAppHub: null }));
          if (getTenantWhatsAppHub) {
            const waConfig = await getTenantWhatsAppHub(tenantId).catch(() => null);
            const supportAgentEnabled = waConfig?.supportAgentEnabled ?? false;
            const supportAgentPhone = waConfig?.supportAgentPhone;
            
            if (!supportAgentEnabled || !supportAgentPhone || !supportAgentPhone.trim()) {
              console.warn(`⚠️ [classes] No se puede enviar notificación WhatsApp: el botón de ayuda no está habilitado o configurado para el tenant ${tenantId}`);
              canSendWhatsApp = false;
              notificationStatus.whatsApp.errors.push("El botón de ayuda no está habilitado o configurado. Por favor, configurá esto en la sección de WhatsApp Business.");
              
              // Si solo se solicitó WhatsApp y no email, retornar error
              if (!notifyEmail) {
                return res.status(400).json({
                  ok: false,
                  error: "Para enviar notificaciones por WhatsApp, el botón de ayuda debe estar habilitado y tener un número de agente configurado. Por favor, configurá esto en la sección de WhatsApp Business.",
                  notificationStatus
                });
              }
            }
          }
        }
        
        // Obtener alumnos inscritos en la clase
        const [enrollments] = await pool.query(
          `SELECT ce.customer_id, c.name, c.phone_e164, c.email
           FROM class_enrollment ce
           JOIN customer c ON c.id = ce.customer_id AND c.tenant_id = ce.tenant_id
           WHERE ce.session_id = ? AND ce.tenant_id = ? AND ce.status IN ('reserved', 'attended')`,
          [id, tenantId]
        );

        const [[instructorRow]] = await pool.query(
          "SELECT name FROM instructor WHERE id=? AND tenant_id=? LIMIT 1",
          [body.instructorId || session.instructor_id, tenantId]
        );

        const finalStart = body.startsAt ? toMySQLDateTime(body.startsAt) : session.starts_at;
        const startDate = new Date(finalStart.replace(" ", "T"));
        const fecha = startDate.toLocaleDateString("es-AR", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
        });
        const hora = startDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

        // Usar mensaje personalizado o mensaje por defecto
        let message = customMessage;
        if (message && message.trim()) {
          // Reemplazar placeholders
          message = message.replace(/{horario}/g, `${fecha} ${hora}`);
          message = message.replace(/{fecha}/g, fecha);
          message = message.replace(/{hora}/g, hora);
          message = message.replace(/{profesor}/g, instructorRow?.name || "Nuestro equipo");
          message = message.replace(/{instructor}/g, instructorRow?.name || "Nuestro equipo");
          message = message.replace(/{name}/g, "{name}"); // Mantener placeholder para nombre del alumno
          
          // Asegurar que siempre se incluya el horario si no está en el mensaje personalizado
          if (!message.includes(fecha) && !message.includes(hora) && !message.toLowerCase().includes("horario")) {
            message += `\n\n📅 *Nuevo horario: ${fecha} ${hora}*`;
          }
        } else {
          message = `Hola! 👋\n\n` +
            `Te contactamos para informarte que la clase ha sido reprogramada:\n\n` +
            `• Profesor: *${instructorRow?.name || "Nuestro equipo"}*\n` +
            `• Nuevo horario: *${fecha} ${hora}*\n\n` +
            `Si tenés alguna consulta, escribinos por acá.`;
        }

        // Notificar a cada alumno inscrito
        for (const enrollment of enrollments) {
          // Enviar WhatsApp
          if (notifyWhatsApp && canSendWhatsApp && enrollment.phone_e164) {
            try {
              const whatsappModule = await import("../whatsapp.js").catch(() => ({}));
              const sendWA = whatsappModule.sendWhatsAppText || whatsappModule.waSendText || null;
              if (sendWA) {
                const waResponse = await sendWA(enrollment.phone_e164, message.replace("{name}", enrollment.name || ""), tenantId);
                const messageId = waResponse?.messages?.[0]?.id;
                
                // Registrar el message_id para evitar que las respuestas activen el bot
                if (messageId) {
                  try {
                    const whatsappRoutes = await import("./whatsapp.js");
                    if (whatsappRoutes.registerNotificationMessageId) {
                      whatsappRoutes.registerNotificationMessageId(messageId, enrollment.phone_e164, tenantId);
                    }
                  } catch (registerError) {
                    console.warn(`⚠️ [classes] No se pudo registrar message_id:`, registerError.message);
                  }
                }
                
                console.log(`✅ [classes] Notificación WhatsApp enviada a ${enrollment.phone_e164}`);
                notificationStatus.whatsApp.sent++;
              } else {
                notificationStatus.whatsApp.failed++;
                notificationStatus.whatsApp.errors.push(`Servicio de WhatsApp no disponible para ${enrollment.name || enrollment.phone_e164}`);
              }
            } catch (waError) {
              console.error(`⚠️ [classes] Error enviando WhatsApp a ${enrollment.phone_e164}:`, waError.message || waError);
              notificationStatus.whatsApp.failed++;
              notificationStatus.whatsApp.errors.push(`Error enviando a ${enrollment.name || enrollment.phone_e164}: ${waError.message || "Error desconocido"}`);
            }
          } else if (notifyWhatsApp && !canSendWhatsApp) {
            // Ya se registró el error arriba
            notificationStatus.whatsApp.failed++;
          } else if (notifyWhatsApp && !enrollment.phone_e164) {
            notificationStatus.whatsApp.failed++;
            notificationStatus.whatsApp.errors.push(`${enrollment.name || "Alumno"} no tiene número de teléfono configurado`);
          }

          // Enviar Email
          if (notifyEmail && enrollment.email) {
            try {
              const { sendEmail } = await import("../email.js").catch(() => ({ sendEmail: null }));
              if (sendEmail) {
                await sendEmail({
                  to: enrollment.email,
                  subject: "Clase reprogramada",
                  html: message.replace(/\n/g, "<br>").replace(/\*/g, "").replace(/{name}/g, enrollment.name || "Alumno"),
                  tenantId,
                });
                console.log(`✅ [classes] Notificación Email enviada a ${enrollment.email}`);
                notificationStatus.email.sent++;
              } else {
                notificationStatus.email.failed++;
                notificationStatus.email.errors.push(`Servicio de email no configurado para ${enrollment.name || enrollment.email}`);
              }
            } catch (emailError) {
              console.error(`⚠️ [classes] Error enviando Email a ${enrollment.email}:`, emailError.message || emailError);
              notificationStatus.email.failed++;
              notificationStatus.email.errors.push(`Error enviando a ${enrollment.name || enrollment.email}: ${emailError.message || "Error desconocido"}`);
            }
          } else if (notifyEmail && !enrollment.email) {
            notificationStatus.email.failed++;
            notificationStatus.email.errors.push(`${enrollment.name || "Alumno"} no tiene email configurado`);
          }
        }
      } catch (notifError) {
        console.error("⚠️ [classes] Error procesando notificaciones:", notifError.message || notifError);
        // No fallar la actualización si las notificaciones fallan
      }
    }

    // Retornar estado de notificaciones si se solicitaron
    if (notifyWhatsApp || notifyEmail) {
      res.json({ 
        ok: true, 
        notificationStatus 
      });
    } else {
      res.json({ ok: true });
    }
  } catch (err) {
    await conn.rollback();
    console.error("❌ [PATCH /classes/sessions/:id] ERROR:", err);
    res.status(500).json({ ok: false, error: err.message || "No se pudo actualizar la clase" });
  } finally {
    conn.release();
  }
});

classesRouter.put("/series/:seriesId", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant.id;
    const { seriesId } = req.params;
    const body = req.body || {};

    if (!seriesId) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "seriesId es requerido" });
    }

    const includePast = Boolean(body.includePast);

    const updates = [];
    const updateParams = [];

    let newInstructorId;
    if (body.instructorId !== undefined) {
      if (body.instructorId === null || body.instructorId === "") {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "instructorId es requerido" });
      }
      newInstructorId = Number(body.instructorId);
      if (!Number.isInteger(newInstructorId) || newInstructorId <= 0) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "instructorId inválido" });
      }
      updates.push("instructor_id = ?");
      updateParams.push(newInstructorId);
    }

    if (body.serviceId !== undefined) {
      const newServiceId =
        body.serviceId === null || body.serviceId === "" ? null : Number(body.serviceId);
      if (newServiceId !== null && (!Number.isInteger(newServiceId) || newServiceId <= 0)) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "serviceId inválido" });
      }
      updates.push("service_id = ?");
      updateParams.push(newServiceId);
    }

    if (body.activityType !== undefined) {
      const activityType = String(body.activityType || "").trim();
      if (!activityType) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "activityType es requerido" });
      }
      updates.push("activity_type = ?");
      updateParams.push(activityType);
    }

    if (body.capacityMax !== undefined) {
      const capacity = Number(body.capacityMax);
      if (!Number.isFinite(capacity) || capacity <= 0) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "capacityMax inválido" });
      }
      updates.push("capacity_max = ?");
      updateParams.push(capacity);
    }

    if (body.priceDecimal !== undefined) {
      const price = Number(body.priceDecimal);
      if (!Number.isFinite(price) || price < 0) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "priceDecimal inválido" });
      }
      updates.push("price_decimal = ?");
      updateParams.push(price);
    }

    if (body.notes !== undefined) {
      const notes =
        body.notes === null || body.notes === ""
          ? null
          : String(body.notes).trim().slice(0, 500);
      updates.push("notes = ?");
      updateParams.push(notes);
    }

    if (!updates.length) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "No hay campos para actualizar" });
    }

    const nowStr = toMySQLDateTime(new Date());
    const filters = ["tenant_id = ?", "series_id = ?", "status = 'scheduled'"];
    const filterParams = [tenantId, seriesId];
    if (!includePast) {
      filters.push("starts_at >= ?");
      filterParams.push(nowStr);
    }

    const selectSql = `
      SELECT id, starts_at, ends_at, instructor_id
        FROM class_session
       WHERE ${filters.join(" AND ")}
       FOR UPDATE
    `;

    const [sessions] = await conn.query(selectSql, filterParams);

    if (!sessions.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "No se encontraron clases para actualizar" });
    }

    if (body.instructorId !== undefined) {
      for (const session of sessions) {
        const startDate = new Date(session.starts_at);
        const endDate = new Date(session.ends_at);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
          await conn.rollback();
          return res.status(400).json({ ok: false, error: "Sesión con fechas inválidas" });
        }

        await checkInstructorAvailability(conn, {
          tenantId,
          instructorId: newInstructorId,
          startTime: startDate,
          endTime: endDate,
          excludeSessionId: session.id,
        });
      }
    }

    const updateSql = `
      UPDATE class_session
         SET ${updates.join(", ")}
       WHERE ${filters.join(" AND ")}
    `;

    const [result] = await conn.query(updateSql, [...updateParams, ...filterParams]);

    await conn.commit();
    res.json({ ok: true, updated: result.affectedRows });
  } catch (err) {
    await conn.rollback();
    console.error("❌ [PUT /classes/series/:seriesId] ERROR:", err);
    res.status(500).json({ ok: false, error: err.message || "No se pudo actualizar la serie" });
  } finally {
    conn.release();
  }
});

classesRouter.post("/series/:seriesId/cancel", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const { seriesId } = req.params;
    if (!seriesId) {
      return res.status(400).json({ ok: false, error: "seriesId es requerido" });
    }

    const [result] = await pool.query(
      `UPDATE class_session
         SET status = 'cancelled'
       WHERE tenant_id = ?
         AND series_id = ?
         AND status = 'scheduled'`,
      [tenantId, seriesId]
    );

    res.json({ ok: true, seriesId, cancelled: result.affectedRows });
  } catch (err) {
    console.error("❌ [POST /classes/series/:seriesId/cancel] ERROR:", err);
    res.status(500).json({ ok: false, error: err.message || "No se pudieron cancelar las clases" });
  }
});

classesRouter.post("/series/:seriesId/enrollments/cancel", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant.id;
    const { seriesId } = req.params;
    const body = req.body || {};
    const { customerId, customerPhone, scope = "upcoming" } = body;

    if (!seriesId) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "seriesId es requerido" });
    }

    let effectiveCustomerId = customerId ? Number(customerId) : null;
    if (!effectiveCustomerId && customerPhone) {
      const [[customer]] = await conn.query(
        `SELECT id FROM customer WHERE tenant_id = ? AND phone_e164 = ? LIMIT 1`,
        [tenantId, customerPhone]
      );
      effectiveCustomerId = customer?.id || null;
    }

    if (!effectiveCustomerId) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "No se encontró el cliente para cancelar la serie" });
    }

    const nowStr = toMySQLDateTime(new Date());
    const scopeCondition = scope === "all" ? "" : "AND cs.starts_at >= ?";
    const params = scope === "all"
      ? [tenantId, seriesId, tenantId, effectiveCustomerId]
      : [tenantId, seriesId, tenantId, effectiveCustomerId, nowStr];

    const [result] = await conn.query(
      `
      UPDATE class_enrollment ce
      JOIN class_session cs ON cs.id = ce.session_id AND cs.tenant_id = ce.tenant_id
         SET ce.status = 'cancelled',
             ce.cancelled_at = NOW()
       WHERE ce.tenant_id = ?
         AND cs.series_id = ?
         AND ce.customer_id = ?
         ${scopeCondition}
         AND ce.status IN ('reserved','attended')
      `,
      params
    );

    await conn.commit();
    res.json({ ok: true, cancelled: result.affectedRows });
  } catch (err) {
    await conn.rollback();
    console.error("❌ [POST /classes/series/:seriesId/enrollments/cancel] ERROR:", err);
    res.status(500).json({ ok: false, error: err.message || "No se pudieron cancelar las inscripciones" });
  } finally {
    conn.release();
  }
});

classesRouter.delete("/sessions/:id", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    const [del] = await pool.query(
      `UPDATE class_session
          SET status = 'cancelled'
        WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (del.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Clase no encontrada" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ [DELETE /classes/sessions/:id] ERROR:", err);
    res.status(500).json({ ok: false, error: "No se pudo cancelar la clase" });
  }
});

/* =========================
   Inscripciones
========================= */
classesRouter.post("/sessions/:id/enrollments", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant.id;
    const { id } = req.params;
    const body = req.body || {};
    const {
      customerId,
      customerName,
      customerPhone,
      notes,
      repeat = {},
    } = body;

    const [[session]] = await conn.query(
      `SELECT * FROM class_session WHERE id = ? AND tenant_id = ? FOR UPDATE`,
      [id, tenantId]
    );
    if (!session) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Clase no encontrada" });
    }
    if (session.status !== "scheduled") {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "La clase no admite nuevas inscripciones" });
    }

    let effectiveCustomerId = customerId || null;
    if (!effectiveCustomerId) {
      try {
        effectiveCustomerId = await ensureCustomerId(
          { name: customerName, phone: customerPhone, notes },
          conn,
          tenantId
        );
      } catch (err) {
        console.error("⚠️ [classes] ensureCustomerId error:", err);
      }
    }

    if (!effectiveCustomerId) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "No se pudo determinar el cliente" });
    }

    // Para clases, validar membresía si está configurado
    const membershipInfo = await ensureActiveMembership(conn, tenantId, effectiveCustomerId, { forClasses: true });
    const membershipTracker = { weekly: new Map(), monthly: new Map() };

    const ensureMembershipForSession = async (sessionRecord) => {
      if (!membershipInfo?.plan) return;
      await enforceClassMembershipLimits(conn, {
        tenantId,
        customerId: effectiveCustomerId,
        membership: membershipInfo,
        sessionDate: sessionRecord.starts_at,
        tracker: membershipTracker,
      });
    };

    const currentEnrollments = await countActiveEnrollments(conn, { tenantId, sessionId: session.id });
    if (currentEnrollments >= session.capacity_max) {
      await conn.rollback();
      return res.status(409).json({ ok: false, error: "La clase ya alcanzó el cupo máximo" });
    }

    const shouldRepeat = Boolean(repeat?.enabled && session.series_id);

    const enrollmentsCreated = [];

    const addEnrollment = async (sessionRecord, noteValue = notes || null) => {
      const [ins] = await conn.query(
        `INSERT INTO class_enrollment
          (tenant_id, session_id, customer_id, status, notes)
         VALUES (?, ?, ?, 'reserved', ?)`,
        [tenantId, sessionRecord.id, effectiveCustomerId, noteValue]
      );

      enrollmentsCreated.push({
        sessionId: sessionRecord.id,
        enrollmentId: ins.insertId,
        startsAt: sessionRecord.starts_at,
      });
    };

    await ensureMembershipForSession(session);
    await addEnrollment(session, notes || null);

    if (shouldRepeat) {
      const { count, until } = repeat;
      let limitCount = Number.isFinite(Number(count)) ? Number(count) : null;
      if (limitCount && limitCount > MAX_CLASS_RECURRING) {
        limitCount = MAX_CLASS_RECURRING;
      }

      let untilDate = null;
      if (until) {
        const parsed = new Date(until);
        if (!Number.isNaN(parsed.getTime())) {
          untilDate = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 23, 59, 59, 999);
        }
      }

      if (!limitCount && !untilDate) {
        untilDate = addDays(new Date(session.starts_at), 90);
      }

      const params = [tenantId, session.series_id, session.id];
      if (untilDate) params.push(untilDate);

      const [seriesSessions] = await conn.query(
        `
        SELECT id, starts_at, capacity_max
          FROM class_session
         WHERE tenant_id = ?
           AND series_id = ?
           AND id <> ?
           AND status = 'scheduled'
           ${untilDate ? "AND starts_at >= ?" : ""}
         ORDER BY starts_at ASC
        `,
        params
      );

      let used = 0;
      for (const next of seriesSessions) {
        if (limitCount && used >= limitCount - 1) break;

        if (new Date(next.starts_at) <= new Date(session.starts_at)) continue;

        const occupancy = await countActiveEnrollments(conn, {
          tenantId,
          sessionId: next.id,
        });

        if (occupancy >= next.capacity_max) {
          await conn.rollback();
          return res.status(409).json({
            ok: false,
            error: `No se pudo inscribir en la clase del ${new Date(next.starts_at).toLocaleDateString(
              "es-AR"
            )} por falta de cupo`,
          });
        }

        await ensureMembershipForSession(next);
        await addEnrollment(next, notes || null);
        used += 1;
      }
    }

    await conn.commit();
    res.status(201).json({
      ok: true,
      data: enrollmentsCreated,
      meta: {
        seriesId: session.series_id || null,
        customerId: effectiveCustomerId,
      },
    });
  } catch (err) {
    await conn.rollback();
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ ok: false, error: "El cliente ya está inscripto en esta clase" });
    }
    console.error("❌ [POST /classes/sessions/:id/enrollments] ERROR:", err);
    res.status(500).json({ ok: false, error: err.message || "No se pudo inscribir al cliente" });
  } finally {
    conn.release();
  }
});

classesRouter.patch("/sessions/:sessionId/enrollments/:enrollmentId", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const { sessionId, enrollmentId } = req.params;
    const body = req.body || {};

    const fields = [];
    const params = [];

    if (body.status) {
      fields.push("status = ?");
      params.push(body.status);
      if (body.status === "cancelled") {
        fields.push("cancelled_at = NOW()");
      }
    }
    if (body.notes !== undefined) {
      fields.push("notes = ?");
      params.push(body.notes || null);
    }

    if (!fields.length) {
      return res.status(400).json({ ok: false, error: "No hay cambios para aplicar" });
    }

    const [upd] = await pool.query(
      `UPDATE class_enrollment
          SET ${fields.join(", ")}
        WHERE id = ? AND session_id = ? AND tenant_id = ?`,
      [...params, enrollmentId, sessionId, tenantId]
    );

    if (upd.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ [PATCH /classes/sessions/:sessionId/enrollments/:enrollmentId] ERROR:", err);
    res.status(500).json({ ok: false, error: "No se pudo actualizar la inscripción" });
  }
});

classesRouter.delete("/sessions/:sessionId/enrollments/:enrollmentId", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const { sessionId, enrollmentId } = req.params;

    const [del] = await pool.query(
      `DELETE FROM class_enrollment
        WHERE id = ? AND session_id = ? AND tenant_id = ?`,
      [enrollmentId, sessionId, tenantId]
    );
    if (del.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ [DELETE /classes/sessions/:sessionId/enrollments/:enrollmentId] ERROR:", err);
    res.status(500).json({ ok: false, error: "No se pudo eliminar la inscripción" });
  }
});

export default classesRouter;


