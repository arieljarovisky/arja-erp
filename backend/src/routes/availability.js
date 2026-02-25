// src/routes/availability.js — MULTI-TENANT
import { Router } from "express";
import { pool } from "../db.js";
import { addMinutes, isBefore } from "date-fns";
import { requireAuth } from "../auth/middlewares.js";

export const availability = Router();
availability.use(requireAuth);

const TIME_ZONE = process.env.TIME_ZONE || "America/Argentina/Buenos_Aires";

function todayBA() {
  const d = new Date();
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(d);
}

function currentHMBA() {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const hh = p.find(x => x.type === "hour")?.value || "00";
  const mm = p.find(x => x.type === "minute")?.value || "00";
  return `${hh}:${mm}`;
}

/**
 * Core: obtiene slots libres/ocupados (requiere tenantId)
 * @returns {{ slots: string[], busySlots: string[] }}
 */
export async function getFreeSlots({ tenantId, instructorId, serviceId, date, stepMin }) {
  if (!tenantId || !instructorId || !serviceId || !date) return { slots: [], busySlots: [] };

  // 1) Duración del servicio (scoped)
  const [[svc]] = await pool.query(
    `SELECT duration_min 
       FROM service 
      WHERE id=? AND tenant_id=? AND is_active=1`,
    [serviceId, tenantId]
  );
  if (!svc) return { slots: [], busySlots: [] };

  const blockMin = Number(stepMin || svc.duration_min || 30);

  // --- 2) Working hours (weekday 0..6 y 1..7) ---
  const jsWeekday = new Date(`${date}T12:00:00`).getDay();
  const altWeekday = jsWeekday === 0 ? 7 : jsWeekday;

  const [whRows] = await pool.query(
    `SELECT weekday, start_time, end_time
       FROM working_hours
      WHERE tenant_id=? 
        AND instructor_id=? 
        AND weekday IN (?, ?)
      ORDER BY start_time`,
    [tenantId, instructorId, jsWeekday, altWeekday]
  );
  if (!whRows.length) return { slots: [], busySlots: [] };

  const OCCUPYING = ["scheduled", "pending_deposit", "deposit_paid", "confirmed"];
  const placeholders = OCCUPYING.map(() => "?").join(",");

  const dayOpen = `${date} 00:00:00`;
  const dayClose = `${date} 23:59:59`;

  // 3) Turnos existentes (scoped)
  const [appts] = await pool.query(
    `SELECT id, starts_at, ends_at, status
       FROM appointment
      WHERE tenant_id=? 
        AND instructor_id=? 
        AND starts_at < ? 
        AND ends_at   > ? 
        AND status IN (${placeholders})`,
    [tenantId, instructorId, dayClose, dayOpen, ...OCCUPYING]
  );

  // 4) Bloqueos del estilista (scoped)
  const [offs] = await pool.query(
    `SELECT starts_at, ends_at
       FROM time_off
      WHERE tenant_id=? 
        AND instructor_id=? 
        AND starts_at < ? 
        AND ends_at   > ?`,
    [tenantId, instructorId, dayClose, dayOpen]
  );

  const BUFFER_MIN = Number(process.env.APPT_BUFFER_MIN || 10);
  const busy = [
    ...appts.map(a => ({
      start: addMinutes(new Date(String(a.starts_at).replace(" ", "T")), -BUFFER_MIN),
      end: addMinutes(new Date(String(a.ends_at).replace(" ", "T")), +BUFFER_MIN),
    })),
    ...offs.map(o => ({
      start: new Date(String(o.starts_at).replace(" ", "T")),
      end: new Date(String(o.ends_at).replace(" ", "T")),
    })),
  ];

  // 5) Generar slots por cada intervalo laboral
  const allSlots = new Set();
  const busySlots = new Set();
  const isToday = date === todayBA();
  const nowHM = isToday ? currentHMBA() : null;

  for (const wh of whRows) {
    const open = new Date(`${date}T${wh.start_time}`);
    const close = new Date(`${date}T${wh.end_time}`);

    for (let t = new Date(open);
      isBefore(addMinutes(t, blockMin), addMinutes(close, 1));
      t = addMinutes(t, blockMin)) {

      const start = new Date(t);
      const end = addMinutes(start, blockMin);

      const hh = String(start.getHours()).padStart(2, "0");
      const mm = String(start.getMinutes()).padStart(2, "0");
      const timeSlot = `${hh}:${mm}`;
      if (isToday && timeSlot <= nowHM) continue;

      const solapa = busy.some(({ start: b0, end: b1 }) => start < b1 && end > b0);

      allSlots.add(timeSlot);
      if (solapa) busySlots.add(timeSlot);
    }
  }

  const slotsArr = Array.from(allSlots).sort();
  const busyArr = Array.from(busySlots).sort();

  return { slots: slotsArr, busySlots: busyArr };
}

// GET /api/availability
availability.get("/", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const instructorId = Number(req.query.instructorId);
    const serviceId = Number(req.query.serviceId);
    const date = String(req.query.date || "");
    const stepMin = req.query.stepMin ? Number(req.query.stepMin) : undefined;

    if (!instructorId || !serviceId || !date) {
      return res.status(400).json({ ok: false, error: "Parámetros requeridos: instructorId, serviceId, date" });
    }

    const result = await getFreeSlots({ tenantId, instructorId, serviceId, date, stepMin });
    res.json({ ok: true, data: { slots: result.slots, busySlots: result.busySlots } });
  } catch (e) {
    console.error("❌ [GET /api/availability] error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
