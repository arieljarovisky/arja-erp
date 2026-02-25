// src/services/classesWhatsapp.js
import { pool } from "../db.js";

const ACTIVE_ENROLL_STATUSES = ["reserved", "attended"];
const MAX_CLASS_RECURRING = Number(process.env.CLASS_RECURRING_MAX || 26);

function toMySQLDateTime(date) {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return null;
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  if (typeof date === "string") {
    const trimmed = date.trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      const normalized = trimmed.replace("T", " ");
      return normalized.length === 16 ? `${normalized}:00` : normalized.slice(0, 19);
    }
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      return trimmed.length === 16 ? `${trimmed}:00` : trimmed.slice(0, 19);
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return toMySQLDateTime(parsed);
    }
  }

  return null;
}

function normPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

async function resolveCustomerId(conn, { tenantId, normalizedPhone, name }) {
  if (!normalizedPhone) throw new Error("Teléfono inválido");

  const [customerRows] = await conn.query(
    `SELECT id, name 
       FROM customer 
      WHERE tenant_id = ? AND phone_e164 = ? 
      LIMIT 1`,
    [tenantId, normalizedPhone]
  );

  if (customerRows.length) {
    const customer = customerRows[0];
    if (name && !customer.name) {
      await conn.query(
        `UPDATE customer 
            SET name = ? 
          WHERE id = ? AND tenant_id = ?`,
        [name.trim().slice(0, 80), customer.id, tenantId]
      );
    }
    return customer.id;
  }

  const [ins] = await conn.query(
    `INSERT INTO customer (tenant_id, name, phone_e164) 
     VALUES (?, ?, ?)`,
    [tenantId, name?.trim().slice(0, 80) || null, normalizedPhone]
  );
  return ins.insertId;
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

export async function listUpcomingClassSessions({
  tenantId,
  from = new Date(),
  limit = 30,
  includeFull = false,
}) {
  if (!tenantId) throw new Error("tenantId requerido en listUpcomingClassSessions");
  const fromMySQL = toMySQLDateTime(from) || toMySQLDateTime(new Date());

  const [rows] = await pool.query(
    `
    SELECT 
      cs.id,
      cs.starts_at,
      cs.ends_at,
      cs.series_id,
      cs.activity_type,
      cs.capacity_max,
      cs.price_decimal,
      cs.notes,
      st.name AS instructor_name,
      ct.name AS template_name,
      (
        SELECT COUNT(*)
          FROM class_enrollment ce
         WHERE ce.session_id = cs.id
           AND ce.tenant_id = cs.tenant_id
           AND ce.status IN ('reserved','attended')
      ) AS enrolled_count
    FROM class_session cs
    LEFT JOIN instructor st 
      ON st.id = cs.instructor_id 
     AND st.tenant_id = cs.tenant_id
    LEFT JOIN class_template ct 
      ON ct.id = cs.template_id
    WHERE cs.tenant_id = ?
      AND cs.status = 'scheduled'
      AND cs.starts_at >= ?
    ORDER BY cs.starts_at ASC
    LIMIT ?
    `,
    [tenantId, fromMySQL, limit]
  );

  return rows
    .map((row) => {
      const available = Number(row.capacity_max || 0) - Number(row.enrolled_count || 0);
      return {
        id: row.id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        seriesId: row.series_id,
        instructorName: row.instructor_name || "Sin asignar",
        templateName: row.template_name,
        activityType: row.activity_type,
        capacityMax: Number(row.capacity_max || 0),
        enrolledCount: Number(row.enrolled_count || 0),
        availableCount: Math.max(0, available),
        priceDecimal: row.price_decimal != null ? Number(row.price_decimal) : null,
        notes: row.notes,
      };
    })
    .filter((session) => includeFull || session.availableCount > 0);
}

export async function listUpcomingClassSeriesWithSingles({
  tenantId,
  limitSeries = 12,
  maxSessionsPerSeries = 10,
}) {
  if (!tenantId) throw new Error("tenantId requerido en listUpcomingClassSeriesWithSingles");

  const sessions = await listUpcomingClassSessions({
    tenantId,
    includeFull: false,
    limit: limitSeries * maxSessionsPerSeries + 20,
  });

  const seriesMap = new Map();
  const singles = [];

  for (const session of sessions) {
    if (!session.seriesId) {
      singles.push(session);
      continue;
    }

    if (!seriesMap.has(session.seriesId)) {
      seriesMap.set(session.seriesId, {
        id: session.seriesId,
        sessions: [],
        instructorName: session.instructorName,
        templateName: session.templateName,
        activityType: session.activityType,
      });
    }
    const entry = seriesMap.get(session.seriesId);
    entry.sessions.push(session);
  }

  const series = Array.from(seriesMap.values())
    .map((entry) => ({
      ...entry,
      sessions: entry.sessions
        .slice()
        .sort(
          (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
        )
        .slice(0, maxSessionsPerSeries),
    }))
    .filter((entry) => entry.sessions.length)
    .sort(
      (a, b) =>
        new Date(a.sessions[0].startsAt).getTime() - new Date(b.sessions[0].startsAt).getTime()
    )
    .slice(0, limitSeries);

  return { series, singles };
}

export async function listCustomerClassEnrollments({ tenantId, phone, from = new Date(), limit = 5 }) {
  if (!tenantId) throw new Error("tenantId requerido en listCustomerClassEnrollments");
  const normalizedPhone = normPhone(phone);
  if (!normalizedPhone) return [];

  const [[customer]] = await pool.query(
    `SELECT id, name 
       FROM customer 
      WHERE tenant_id = ? AND phone_e164 = ? 
      LIMIT 1`,
    [tenantId, normalizedPhone]
  );

  if (!customer) return [];

  const fromMySQL = toMySQLDateTime(from) || toMySQLDateTime(new Date());

  const [rows] = await pool.query(
    `
    SELECT 
      cs.id AS session_id,
      cs.starts_at,
      cs.ends_at,
      cs.activity_type,
      cs.capacity_max,
      cs.price_decimal,
      st.name AS instructor_name,
      ct.name AS template_name,
      ce.status
    FROM class_enrollment ce
    JOIN class_session cs 
      ON cs.id = ce.session_id 
     AND cs.tenant_id = ce.tenant_id
    JOIN instructor st 
      ON st.id = cs.instructor_id 
     AND st.tenant_id = cs.tenant_id
    LEFT JOIN class_template ct 
      ON ct.id = cs.template_id
    WHERE ce.tenant_id = ?
      AND ce.customer_id = ?
      AND ce.status IN ('reserved','attended')
      AND cs.status = 'scheduled'
      AND cs.starts_at >= ?
    ORDER BY cs.starts_at ASC
    LIMIT ?
    `,
    [tenantId, customer.id, fromMySQL, limit]
  );

  return rows.map((row) => ({
    sessionId: row.session_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    instructorName: row.instructor_name,
    templateName: row.template_name,
    activityType: row.activity_type,
    priceDecimal: row.price_decimal != null ? Number(row.price_decimal) : null,
    status: row.status,
  }));
}

export async function enrollCustomerToClassSession({ tenantId, sessionId, phone, name, notes = null }) {
  if (!tenantId) throw new Error("tenantId requerido en enrollCustomerToClassSession");
  if (!sessionId) throw new Error("sessionId requerido");

  const normalizedPhone = normPhone(phone);
  if (!normalizedPhone) {
    return { ok: false, error: "Teléfono inválido" };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[session]] = await conn.query(
      `SELECT * 
         FROM class_session 
        WHERE id = ? AND tenant_id = ? 
        FOR UPDATE`,
      [sessionId, tenantId]
    );

    if (!session) {
      await conn.rollback();
      return { ok: false, error: "Clase no encontrada" };
    }

    if (session.status !== "scheduled") {
      await conn.rollback();
      return { ok: false, error: "La clase no admite nuevas reservas" };
    }

    const customerId = await resolveCustomerId(conn, { tenantId, normalizedPhone, name });

    const enrolledCount = await countActiveEnrollments(conn, { tenantId, sessionId });
    if (enrolledCount >= Number(session.capacity_max || 0)) {
      await conn.rollback();
      return { ok: false, error: "La clase ya alcanzó el cupo máximo" };
    }

    try {
      await conn.query(
        `INSERT INTO class_enrollment
          (tenant_id, session_id, customer_id, status, notes)
         VALUES (?, ?, ?, 'reserved', ?)`,
        [tenantId, sessionId, customerId, notes]
      );
    } catch (err) {
      if (err?.code === "ER_DUP_ENTRY") {
        await conn.rollback();
        return { ok: false, error: "Ya estabas inscripto en esta clase" };
      }
      throw err;
    }

    await conn.commit();
    return {
      ok: true,
      session: {
        id: session.id,
        startsAt: session.starts_at,
        endsAt: session.ends_at,
        activityType: session.activity_type,
        instructorId: session.instructor_id,
        capacityMax: session.capacity_max,
      },
    };
  } catch (err) {
    await conn.rollback();
    console.error("[enrollCustomerToClassSession] ERROR:", err);
    return { ok: false, error: err.message || "No se pudo inscribir a la clase" };
  } finally {
    conn.release();
  }
}

export async function enrollCustomerToClassSeries({
  tenantId,
  seriesId,
  startingSessionId,
  phone,
  name,
  notes = null,
  limitCount = null,
}) {
  if (!tenantId) throw new Error("tenantId requerido en enrollCustomerToClassSeries");
  if (!seriesId) throw new Error("seriesId requerido");

  const normalizedPhone = normPhone(phone);
  if (!normalizedPhone) {
    return { ok: false, error: "Teléfono inválido" };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const customerId = await resolveCustomerId(conn, { tenantId, normalizedPhone, name });

    const [sessions] = await conn.query(
      `SELECT id, starts_at, ends_at, capacity_max
         FROM class_session
        WHERE tenant_id = ?
          AND series_id = ?
          AND status = 'scheduled'
        ORDER BY starts_at ASC
        FOR UPDATE`,
      [tenantId, seriesId]
    );

    if (!sessions.length) {
      await conn.rollback();
      return { ok: false, error: "No encontramos clases disponibles en esta serie" };
    }

    let startIndex = 0;
    if (startingSessionId) {
      startIndex = sessions.findIndex((s) => s.id === startingSessionId);
      if (startIndex === -1) {
        await conn.rollback();
        return { ok: false, error: "La clase seleccionada no pertenece a la serie" };
      }
    } else {
      const now = Date.now();
      const upcomingIndex = sessions.findIndex((s) => new Date(s.starts_at).getTime() >= now);
      startIndex = upcomingIndex >= 0 ? upcomingIndex : 0;
    }

    const maxAllowed = limitCount
      ? Math.max(1, Math.min(Number(limitCount), MAX_CLASS_RECURRING))
      : MAX_CLASS_RECURRING;

    const enrollments = [];

    for (let idx = startIndex; idx < sessions.length && enrollments.length < maxAllowed; idx += 1) {
      const session = sessions[idx];
      const occupancy = await countActiveEnrollments(conn, { tenantId, sessionId: session.id });
      if (occupancy >= Number(session.capacity_max || 0)) {
        await conn.rollback();
        const date = new Date(session.starts_at);
        const fecha = date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
        return {
          ok: false,
          error: `Sin cupo en la clase del ${fecha}`,
        };
      }

      try {
        const [ins] = await conn.query(
          `INSERT INTO class_enrollment
            (tenant_id, session_id, customer_id, status, notes)
           VALUES (?, ?, ?, 'reserved', ?)`,
          [tenantId, session.id, customerId, notes]
        );

        enrollments.push({
          enrollmentId: ins.insertId,
          sessionId: session.id,
          startsAt: session.starts_at,
          endsAt: session.ends_at,
        });
      } catch (err) {
        if (err?.code === "ER_DUP_ENTRY") {
          await conn.rollback();
          return { ok: false, error: "Ya estabas inscripto en esta serie" };
        }
        throw err;
      }
    }

    if (!enrollments.length) {
      await conn.rollback();
      return { ok: false, error: "No se pudo generar ninguna inscripción" };
    }

    await conn.commit();
    return { ok: true, enrollments };
  } catch (err) {
    await conn.rollback();
    console.error("[enrollCustomerToClassSeries] ERROR:", err);
    return { ok: false, error: err.message || "No se pudo inscribir a la serie" };
  } finally {
    conn.release();
  }
}

