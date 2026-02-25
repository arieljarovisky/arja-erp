  // src/routes/appointments.js — MULTI-TENANT
import { Router } from "express";
import { pool } from "../db.js";
import { isAfter, isBefore, addDays } from "date-fns";
import { validateAppointmentDate } from "../helpers/dateValidation.js";
import { checkAppointmentOverlap } from "../helpers/overlapValidation.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import { cfgNumber, cfgBool } from "../services/config.js";
import { createNotification } from "./notifications.js";
import { sendNotificationToCustomer } from "../services/pushNotifications.js";
import { createDepositPaymentLink } from "../payments.js";
import {
  resolveBranchFilter,
  resolveBranchForWrite,
  ensureUserCanAccessBranch,
  getPrimaryBranchId,
} from "../helpers/branchAccess.js";

/* ================== Helpers de fecha ================== */
function anyToMySQL(val) {
  if (!val) return null;

  const fmt = (d) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  if (val instanceof Date && !Number.isNaN(val.getTime())) return fmt(val);

  if (typeof val === "string") {
    let s = val.trim();

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
      s = s.replace("T", " ");
      return s.length === 16 ? s + ":00" : s.slice(0, 19);
    }

    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/.test(s)) {
      return s.length === 16 ? s + ":00" : s.slice(0, 19);
    }

    if (/[Zz]$/.test(s) || /[+\-]\d{2}:\d{2}$/.test(s)) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) return fmt(d);
    }

    return null;
  }

  if (typeof val === "number") {
    const ms = val > 1e12 ? val : val * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return fmt(d);
  }

  return null;
}

function fmtLocal(iso) {
  const d = new Date(iso);
  const f = d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const h = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return `${f} ${h}`;
}

/* ========= Working hours ========= */
async function getWorkingHoursForDate(instructorId, dateStr, db = pool, tenantId) {
  const weekday = new Date(`${dateStr}T00:00:00`).getDay();
  const [rows] = await db.query(
    `SELECT start_time, end_time
       FROM working_hours
      WHERE instructor_id=? AND tenant_id=? AND weekday IN (?, ?) 
      ORDER BY start_time
      LIMIT 1`,
    [instructorId, tenantId, weekday, weekday === 0 ? 7 : weekday]
  );
  return rows[0] || null;
}

function insideWorkingHours(dateStr, start_time, end_time, start, end) {
  const dayStart = new Date(`${dateStr}T${start_time}`);
  const dayEnd = new Date(`${dateStr}T${end_time}`);
  return !isBefore(start, dayStart) && !isAfter(end, dayEnd);
}

/* ========= Servicios / duración ========= */
async function resolveServiceDuration(serviceId, fallbackDurationMin, db = pool, tenantId) {
  try {
    if (serviceId) {
      const [[row]] = await db.query(
        "SELECT duration_min FROM service WHERE id = ? AND tenant_id = ? LIMIT 1",
        [serviceId, tenantId]
      );
      if (row && row.duration_min != null) return Number(row.duration_min);
    }
  } catch { /* noop */ }
  return fallbackDurationMin != null ? Number(fallbackDurationMin) : null;
}

/* ========= Clientes ========= */
function normPhone(p) {
  if (!p) return null;
  return String(p).replace(/[\s-]/g, "");
}

const ACTIVE_APPOINTMENT_STATUSES = ["scheduled", "pending_deposit", "deposit_paid", "confirmed"];
const ACTIVE_CLASS_STATUSES = ["reserved", "attended"];

function pad(num) {
  return String(num).padStart(2, "0");
}

function formatDateForSQL(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sunday
  const diff = (day + 6) % 7; // convert to Monday-based week
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function startOfMonth(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfMonth(date) {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) {
    d.setDate(0);
  }
  return d;
}

function computeDueDate(subscription, plan) {
  if (subscription.next_charge_at) {
    return new Date(subscription.next_charge_at);
  }

  const base =
    subscription.last_payment_at ||
    subscription.created_at ||
    subscription.updated_at ||
    new Date();
  const baseDate = new Date(base);
  const frequency = Number(subscription.frequency) || plan.durationMonths || 1;
  let due;

  if (String(subscription.frequency_type || "").toLowerCase() === "days") {
    due = new Date(baseDate.getTime() + frequency * 24 * 60 * 60 * 1000);
  } else {
    due = addMonths(baseDate, frequency);
  }

  if (plan.billingDay) {
    const maxDay = daysInMonth(due.getFullYear(), due.getMonth());
    due.setDate(Math.min(plan.billingDay, maxDay));
  }

  due.setHours(23, 59, 59, 999);
  return due;
}

async function fetchActiveMembershipRecord(db, tenantId, customerId) {
  const [[record]] = await db.query(
    `SELECT cs.id,
            cs.membership_plan_id,
            cs.amount_decimal,
            cs.currency,
            cs.frequency,
            cs.frequency_type,
            cs.next_charge_at,
            cs.last_payment_at,
            cs.created_at,
            cs.updated_at,
            mp.name AS plan_name,
            mp.max_classes_per_week,
            mp.max_classes_per_month,
            mp.max_active_appointments,
            mp.duration_months,
            mp.billing_day,
            mp.grace_days,
            mp.interest_type,
            mp.interest_value,
            mp.auto_block
       FROM customer_subscription cs
       LEFT JOIN membership_plan mp
         ON mp.id = cs.membership_plan_id
      WHERE cs.tenant_id = ?
        AND cs.customer_id = ?
        AND cs.status = 'authorized'
        AND (mp.id IS NULL OR mp.is_active = 1)
      ORDER BY cs.updated_at DESC, cs.id DESC
      LIMIT 1`,
    [tenantId, customerId]
  );
  return record || null;
}

export async function ensureActiveMembership(db, tenantId, customerId, options = {}) {
  // Por defecto, solo validar membresía para clases, no para turnos individuales
  const forClasses = options.forClasses !== undefined ? options.forClasses : true;
  
  // Si es para turnos individuales, no validar membresía
  if (!forClasses) {
    return null;
  }
  
  // Si es para clases, usar la configuración de clases
  const configKey = forClasses ? "classes.require_membership" : "appointments.require_membership";
  const requireMembership = await cfgBool(configKey, false, tenantId);
  if (!requireMembership) {
    return null;
  }

  const record = await fetchActiveMembershipRecord(db, tenantId, customerId);

  if (!record) {
    const error = new Error("El cliente debe tener la cuota al día para reservar clases.");
    error.status = 403;
    throw error;
  }

  const plan = record.membership_plan_id
    ? {
        id: record.membership_plan_id,
        name: record.plan_name || "Membresía",
        maxClassesPerWeek:
          record.max_classes_per_week == null ? null : Number(record.max_classes_per_week),
        maxClassesPerMonth:
          record.max_classes_per_month == null ? null : Number(record.max_classes_per_month),
        maxActiveAppointments:
          record.max_active_appointments == null ? null : Number(record.max_active_appointments),
        durationMonths: Number(record.duration_months || 1),
        billingDay: record.billing_day ? Number(record.billing_day) : null,
        graceDays: Number(record.grace_days || 0),
        interestType: record.interest_type || "none",
        interestValue: Number(record.interest_value || 0),
        autoBlock: record.auto_block !== undefined ? Boolean(record.auto_block) : true,
      }
    : null;

  const now = new Date();
  let dueDate = null;
  let dueWithGrace = null;
  let isOverdue = false;
  let interestDue = 0;

  if (plan) {
    dueDate = computeDueDate(record, plan);
    dueWithGrace = new Date(dueDate);
    dueWithGrace.setDate(dueWithGrace.getDate() + plan.graceDays);

    if (now > dueDate && plan.interestType !== "none") {
      const baseAmount = Number(record.amount_decimal || 0);
      if (plan.interestType === "percent") {
        interestDue = Math.round(baseAmount * (plan.interestValue / 100) * 100) / 100;
      } else if (plan.interestType === "fixed") {
        interestDue = plan.interestValue;
      }
    }

    if (now > dueWithGrace) {
      if (plan.autoBlock) {
        const error = new Error(
          `La cuota de "${plan.name}" está vencida (venció el ${dueDate.toLocaleDateString(
            "es-AR"
          )}).`
        );
        error.status = 403;
        throw error;
      }
      isOverdue = true;
    }
  }

  return {
    subscriptionId: record.id,
    plan,
    dueDate,
    dueWithGrace,
    isOverdue,
    interestDue,
  };
}

async function countActiveAppointments(db, tenantId, customerId) {
  const placeholders = ACTIVE_APPOINTMENT_STATUSES.map(() => "?").join(",");
  const params = [tenantId, customerId, ...ACTIVE_APPOINTMENT_STATUSES];
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS total
       FROM appointment
      WHERE tenant_id = ?
        AND customer_id = ?
        AND status IN (${placeholders})`,
    params
  );
  return Number(row?.total || 0);
}

async function ensurePlanAllowsAppointment(db, { tenantId, customerId, membership, tracker }) {
  if (!membership?.plan || !membership.plan.maxActiveAppointments) {
    return;
  }

  if (tracker.activeAppointments == null) {
    tracker.activeAppointments = await countActiveAppointments(db, tenantId, customerId);
  }

  if (tracker.activeAppointments >= membership.plan.maxActiveAppointments) {
    const error = new Error(
      `El plan "${membership.plan.name}" permite hasta ${membership.plan.maxActiveAppointments} turnos activos.`
    );
    error.status = 403;
    throw error;
  }

  tracker.activeAppointments += 1;
}

async function fetchEnrollmentCountInRange(db, tenantId, customerId, from, to) {
  const placeholders = ACTIVE_CLASS_STATUSES.map(() => "?").join(",");
  const params = [tenantId, customerId, ...ACTIVE_CLASS_STATUSES, formatDateForSQL(from), formatDateForSQL(to)];
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS total
       FROM class_enrollment ce
       JOIN class_session cs ON cs.id = ce.session_id
      WHERE ce.tenant_id = ?
        AND ce.customer_id = ?
        AND ce.status IN (${placeholders})
        AND cs.starts_at BETWEEN ? AND ?`,
    params
  );
  return Number(row?.total || 0);
}

function getWeekKey(date) {
  return startOfWeek(date).toISOString().slice(0, 10);
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export async function enforceClassMembershipLimits(
  db,
  { tenantId, customerId, membership, sessionDate, tracker = { weekly: new Map(), monthly: new Map() } }
) {
  if (!membership?.plan) {
    return;
  }

  const plan = membership.plan;
  const dateObj = new Date(sessionDate);
  if (Number.isNaN(dateObj.getTime())) {
    return;
  }

  if (plan.maxClassesPerWeek) {
    const weekKey = getWeekKey(dateObj);
    if (!tracker.weekly.has(weekKey)) {
      const count = await fetchEnrollmentCountInRange(db, tenantId, customerId, startOfWeek(dateObj), endOfWeek(dateObj));
      tracker.weekly.set(weekKey, count);
    }
    if (tracker.weekly.get(weekKey) >= plan.maxClassesPerWeek) {
      const error = new Error(`El plan "${plan.name}" permite hasta ${plan.maxClassesPerWeek} clases por semana.`);
      error.status = 403;
      throw error;
    }
    tracker.weekly.set(weekKey, tracker.weekly.get(weekKey) + 1);
  }

  if (plan.maxClassesPerMonth) {
    const monthKey = getMonthKey(dateObj);
    if (!tracker.monthly.has(monthKey)) {
      const count = await fetchEnrollmentCountInRange(
        db,
        tenantId,
        customerId,
        startOfMonth(dateObj),
        endOfMonth(dateObj)
      );
      tracker.monthly.set(monthKey, count);
    }
    if (tracker.monthly.get(monthKey) >= plan.maxClassesPerMonth) {
      const error = new Error(`El plan "${plan.name}" permite hasta ${plan.maxClassesPerMonth} clases por mes.`);
      error.status = 403;
      throw error;
    }
    tracker.monthly.set(monthKey, tracker.monthly.get(monthKey) + 1);
  }

}

async function resolveAppointmentBranchId(
  req,
  { instructorBranchId = null, branchIdOverride = null, conn = pool } = {}
) {
  if (branchIdOverride) {
    const branch = await resolveBranchForWrite(req, { branchId: branchIdOverride, conn });
    return branch.id;
  }
  if (instructorBranchId) {
    ensureUserCanAccessBranch(req.user, Number(instructorBranchId));
    return Number(instructorBranchId);
  }
  const branch = await resolveBranchForWrite(req, { conn });
  return branch.id;
}

export async function ensureCustomerId({ name, phone }, db = pool, tenantId) {
  const phoneNorm = normPhone(phone);
  if (!phoneNorm) return null;

  // Por diseño: UNIQUE (tenant_id, phone_e164)
  const [rows] = await db.query(
    "SELECT id FROM customer WHERE phone_e164=? AND tenant_id=? LIMIT 1",
    [phoneNorm, tenantId]
  );
  if (rows.length) return rows[0].id;

  const [ins] = await db.query(
    "INSERT INTO customer (tenant_id, name, phone_e164) VALUES (?, ?, ?)",
    [tenantId, name || null, phoneNorm]
  );
  return ins.insertId;
}
const onlyDigits = (s) => String(s || "").replace(/\D/g, "");
/* ========= WhatsApp (best-effort) ========= */
let sendWhatsAppText = null;
let sendWhatsAppTemplate = null;
try {
  const m = await import("../whatsapp.js");
  sendWhatsAppText = m.sendWhatsAppText || m.waSendText || null;
  sendWhatsAppTemplate = m.sendWhatsAppTemplate || null;
} catch { /* noop */ }

/* ========= Servicio programático (opcional) ========= */
export async function createAppointment({
  customerPhone,
  instructorId,
  serviceId,
  startsAt,
  depositDecimal = 0,
  status = "pending_deposit",
  tenantId,
  seriesId = null,
  seriesParentId = null,
  recurrenceRule = null,
  branchId = null
}) {
  if (!tenantId) throw new Error("tenantId requerido");

  const phone = onlyDigits(customerPhone);
  if (!phone) throw new Error("Teléfono inválido");

  // 1) Cliente (por tenant + phone)
  const [custRows] = await pool.query(
    "SELECT id, exempt_deposit FROM customer WHERE tenant_id=? AND phone_e164=? LIMIT 1",
    [tenantId, phone]
  );

  let customerId = custRows?.[0]?.id;
  let isExemptDeposit = custRows?.[0]?.exempt_deposit === 1 || custRows?.[0]?.exempt_deposit === true;
  
  if (!customerId) {
    const [ins] = await pool.query(
      "INSERT INTO customer (tenant_id, name, phone_e164) VALUES (?, ?, ?)",
      [tenantId, "", phone]
    );
    customerId = ins.insertId;
    isExemptDeposit = false; // Nuevo cliente no está exento por defecto
  }

  if (!customerId) throw new Error("No se pudo crear/obtener el cliente");
  
  // Si el cliente está exento de seña, no asignar seña
  if (isExemptDeposit && depositDecimal > 0) {
    console.log(`ℹ️ [appointments] Cliente exento de seña, omitiendo seña de $${depositDecimal}`);
    depositDecimal = 0;
    status = "scheduled"; // Cambiar a scheduled en lugar de pending_deposit
  }

  // Para turnos individuales, no validar membresía
  const membership = await ensureActiveMembership(pool, tenantId, customerId, { forClasses: false });
  const appointmentTracker = { activeAppointments: null };
  await ensurePlanAllowsAppointment(pool, {
    tenantId,
    customerId,
    membership,
    tracker: appointmentTracker,
  });

  // 2) Servicio por tenant
  const [[svc]] = await pool.query(
    "SELECT id, duration_min, price_decimal FROM service WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1",
    [Number(serviceId), tenantId]
  );
  if (!svc) throw new Error("Servicio inexistente para este tenant");

  // 3) Estilista por tenant
  const [[sty]] = await pool.query(
    "SELECT id, branch_id FROM instructor WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1",
    [Number(instructorId), tenantId]
  );
  if (!sty) throw new Error("Peluquero inexistente para este tenant");

  // Si se pasó branchId explícitamente (por ejemplo desde el bot), usarlo
  // Si no, usar el branch_id del instructor, y si tampoco tiene, usar la sucursal principal
  let appointmentBranchId = branchId ? Number(branchId) : null;
  if (!appointmentBranchId) {
    appointmentBranchId = sty.branch_id ? Number(sty.branch_id) : null;
  }
  if (!appointmentBranchId) {
    appointmentBranchId = await getPrimaryBranchId(tenantId);
  }
  if (!appointmentBranchId) {
    throw new Error("No se pudo determinar la sucursal del turno.");
  }

  // 4) Calcular fin y validar solapamientos (normalizando a horario Argentina, sin conversión de TZ)
  // Interpretar startsAt como hora local (YYYY-MM-DD HH:mm:ss) y operar en MySQL para evitar desfasajes
  const startMySQL =
    /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/.test(String(startsAt))
      ? (String(startsAt).length === 16 ? `${startsAt}:00` : String(startsAt).slice(0, 19))
      : String(startsAt).replace("T", " ").slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(startMySQL)) {
    throw new Error("Fecha/hora inválida");
  }
  const [[{ calc_end }]] = await pool.query(
    "SELECT DATE_ADD(STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s'), INTERVAL ? MINUTE) AS calc_end",
    [startMySQL, Number(svc.duration_min)]
  );
  const endMySQL = String(calc_end).replace("T", " ").slice(0, 19);

  const [busy] = await pool.query(
    `SELECT 1
       FROM appointment
      WHERE tenant_id=?
        AND instructor_id=?
        AND status IN ('scheduled','confirmed','deposit_paid','pending_deposit')
        AND (starts_at < STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s') AND ends_at > STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s'))
      LIMIT 1`,
    [tenantId, Number(instructorId), endMySQL, startMySQL]
  );
  if (busy.length) throw new Error("Horario ocupado");

  // 5) Insertar turno
  const [apt] = await pool.query(
    `INSERT INTO appointment
       (tenant_id, branch_id, customer_id, instructor_id, service_id, starts_at, ends_at,
        status, deposit_decimal, series_id, series_parent_id, recurrence_rule)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      appointmentBranchId,
      customerId,
      Number(instructorId),
      Number(serviceId),
      startMySQL,
      endMySQL,
      status,
      Number(depositDecimal || 0),
      seriesId,
      seriesParentId,
      recurrenceRule ? JSON.stringify(recurrenceRule) : null
    ]
  );

  return { ok: true, id: apt.insertId, deposit: { required: Number(depositDecimal) > 0 } };
}

/* ========= Router ========= */
export const appointments = Router();

appointments.get("/", requireAuth, requireRole("admin", "staff", "user"), async (req, res) => {
  let sql = '';
  try {
    const tenantId = req.tenant.id;
    const { from, to, instructorId, limit = 1000, offset = 0 } = req.query;
    const filter = resolveBranchFilter(req, { allowAll: true });
    const branchClause = filter.mode === "all" ? "" : " AND a.branch_id = ?";

    // Optimización: Usar índices compuestos y limitar resultados
    sql = `
      SELECT a.*, 
             c.name AS customer_name, 
             c.documento AS customer_documento,
             s.name AS service_name, 
             st.name AS instructor_name,
             COALESCE(a.invoiced, 0) AS invoiced,
             0 AS has_invoice
        FROM appointment a
        INNER JOIN customer c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
        INNER JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
        INNER JOIN instructor st ON st.id = a.instructor_id AND st.tenant_id = a.tenant_id
       WHERE a.tenant_id = ?
         ${branchClause}
    `;
    const params = [tenantId];
    if (filter.mode !== "all") {
      params.push(filter.branchId);
    }

    if (from) {
      sql += " AND a.starts_at >= ?";
      params.push(from);
    }
    if (to) {
      sql += " AND a.starts_at <= ?";
      params.push(to);
    }
    if (instructorId) {
      sql += " AND a.instructor_id = ?";
      params.push(instructorId);
    }

    sql += " ORDER BY a.starts_at ASC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(offset));

    const [rows] = await pool.query(sql, params);
    
    // Corregir automáticamente turnos con status incorrecto para clientes exentos
    // Esto corrige turnos que fueron creados antes de que el cliente fuera marcado como exento
    const correctionPromises = rows
      .filter(row => 
        row.status === 'pending_deposit' && 
        (!row.deposit_paid_at || row.deposit_paid_at === null) && 
        (Number(row.deposit_decimal || 0) === 0)
      )
      .map(async (row) => {
        try {
          // Verificar si el cliente está exento
          const [[customerCheck]] = await pool.query(
            `SELECT exempt_deposit FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
            [row.customer_id, tenantId]
          );
          
          const isExemptDeposit = customerCheck?.exempt_deposit === 1 || customerCheck?.exempt_deposit === true;
          
          if (isExemptDeposit) {
            // Corregir el status automáticamente
            await pool.query(
              `UPDATE appointment SET status = 'scheduled' WHERE id = ? AND tenant_id = ?`,
              [row.id, tenantId]
            );
            row.status = 'scheduled'; // Actualizar también en la respuesta
            console.log(`ℹ️ [appointments] Corregido automáticamente status de turno ${row.id} de pending_deposit a scheduled (cliente exento)`);
          }
        } catch (err) {
          console.error(`⚠️ [appointments] Error corrigiendo turno ${row.id}:`, err.message);
        }
      });
    
    // Ejecutar correcciones en paralelo y esperar para que la respuesta incluya los status corregidos
    if (correctionPromises.length > 0) {
      await Promise.all(correctionPromises).catch(err => {
        console.error(`⚠️ [appointments] Error en correcciones automáticas:`, err);
      });
    }
    
    // Obtener total para paginación
    let countSql = `
      SELECT COUNT(*) as total
        FROM appointment a
       WHERE a.tenant_id = ?
         ${branchClause}
    `;
    const countParams = [tenantId];
    if (filter.mode !== "all") {
      countParams.push(filter.branchId);
    }
    if (from) {
      countSql += " AND a.starts_at >= ?";
      countParams.push(from);
    }
    if (to) {
      countSql += " AND a.starts_at <= ?";
      countParams.push(to);
    }
    if (instructorId) {
      countSql += " AND a.instructor_id = ?";
      countParams.push(instructorId);
    }
    
    const [[{ total }]] = await pool.query(countSql, countParams);
    
    res.setHeader("X-Total-Count", total);
    res.json(rows);
  } catch (err) {
    console.error("❌ [GET /appointments] ERROR:", err);
    console.error("❌ [GET /appointments] SQL:", sql);
    res.status(500).json({ ok: false, error: "Error al listar turnos", details: err.message });
  }
});

// ✅ POST con tenant en todas las consultas
appointments.post("/", requireAuth, requireRole("admin", "staff", "user"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant.id;

    const {
      instructorId,
      serviceId,
      customerId,
      customerName,
      customerPhone,
      customerNotes,
      startsAt,
      endsAt,
      sendWhatsApp = 'none' // 'with_payment', 'reminder_only', o 'none'
    } = req.body;

    // --- 1) Asegurar cliente ---
    let effectiveCustomerId = customerId || null;

    if (!effectiveCustomerId) {
      effectiveCustomerId = await ensureCustomerId(
        { name: customerName, phone: customerPhone, notes: customerNotes },
        conn,
        tenantId
      );
    }

    if (!effectiveCustomerId) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: "No se pudo determinar/crear el cliente (faltan datos)"
      });
    }

    let membershipInfo = null;
    const appointmentTracker = { activeAppointments: null };
    try {
      // Para turnos individuales, no validar membresía
      membershipInfo = await ensureActiveMembership(conn, tenantId, effectiveCustomerId, { forClasses: false });
      await ensurePlanAllowsAppointment(conn, {
        tenantId,
        customerId: effectiveCustomerId,
        membership: membershipInfo,
        tracker: appointmentTracker,
      });
    } catch (membershipError) {
      await conn.rollback();
      if (membershipError.status) {
        return res.status(membershipError.status).json({ ok: false, error: membershipError.message });
      }
      throw membershipError;
    }

    // --- 2) Validar instructor/servicio ---
    const [[sty]] = await conn.query(
      "SELECT id, branch_id FROM instructor WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1",
      [instructorId, tenantId]
    );
    if (!sty) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Profesional inexistente" });
    }

    const [[svc]] = await conn.query(
      "SELECT duration_min FROM service WHERE id=? AND tenant_id=? LIMIT 1",
      [serviceId, tenantId]
    );
    if (!svc) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Servicio inexistente" });
    }

    // --- 3) Calcular fechas ---
    const startMySQL = anyToMySQL(startsAt);
    let endMySQL = anyToMySQL(endsAt);

    if (!endMySQL) {
      const [[{ calc_end }]] = await conn.query(
        "SELECT DATE_ADD(STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s'), INTERVAL ? MINUTE) AS calc_end",
        [startMySQL, svc.duration_min]
      );
      endMySQL = anyToMySQL(calc_end);
    }

    const startDate = new Date(startMySQL.replace(" ", "T"));
    const endDate = new Date(endMySQL.replace(" ", "T"));

    // --- 4) VALIDAR SOLAPAMIENTO ---
    try {
      await checkAppointmentOverlap(conn, {
        instructorId: Number(instructorId),
        startTime: startDate,
        endTime: endDate,
        bufferMinutes: Number(process.env.APPT_BUFFER_MIN || 10),
        useLock: true
      });
    } catch (overlapError) {
      await conn.rollback();
      return res.status(409).json({
        ok: false,
        error: overlapError.message
      });
    }

    // --- 4.1) Horario laboral del estilista (por tenant) ---
    const dateStr = startMySQL.slice(0, 10);
    const wh = await getWorkingHoursForDate(instructorId, dateStr, conn, tenantId);
    if (!wh) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "El peluquero no tiene horarios definidos para ese día" });
    }
    if (!insideWorkingHours(dateStr, wh.start_time, wh.end_time, startDate, endDate)) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Fuera del horario laboral" });
    }

    const branchIdOverride = req.body.branchId ? Number(req.body.branchId) : null;
    const targetBranchId = await resolveAppointmentBranchId(req, {
      instructorBranchId: sty.branch_id,
      branchIdOverride,
      conn,
    });

    // --- 5) Insertar turno con tenant ---
    const [ins] = await conn.query(
      `INSERT INTO appointment 
       (tenant_id, branch_id, instructor_id, service_id, customer_id, starts_at, ends_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', NOW())`,
      [tenantId, targetBranchId, instructorId, serviceId, effectiveCustomerId, startMySQL, endMySQL]
    );
    const appointmentId = ins.insertId;

    await conn.commit();

    // --- 6) Envío de WhatsApp según opción del usuario (fuera de la transacción) ---
    if (sendWhatsApp !== 'none' && sendWhatsAppText) {
      try {
        const [[customerRow]] = await pool.query(
          "SELECT phone_e164, name FROM customer WHERE id=? AND tenant_id=? LIMIT 1",
          [effectiveCustomerId, tenantId]
        );

        if (customerRow?.phone_e164) {
          const [[serviceRow]] = await pool.query(
            "SELECT name, price_decimal FROM service WHERE id=? AND tenant_id=? LIMIT 1",
            [serviceId, tenantId]
          );
          const [[instructorRow]] = await pool.query(
            "SELECT name FROM instructor WHERE id=? AND tenant_id=? LIMIT 1",
            [instructorId, tenantId]
          );

          const startDate = new Date(startMySQL.replace(" ", "T"));
          const fecha = startDate.toLocaleDateString("es-AR", {
            weekday: "short",
            day: "2-digit",
            month: "2-digit",
          });
          const hora = startDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

          if (sendWhatsApp === 'with_payment') {
            // Enviar confirmación con link de pago (seña)
            await scheduleDepositReminder({ tenantId, appointmentId });
          } else if (sendWhatsApp === 'reminder_only') {
            // Enviar solo confirmación sin link de pago
            const msg = `Hola ${customerRow.name || ""}! 👋\n\n✅ Confirmamos tu turno:\n\n` +
              `• Servicio: *${serviceRow?.name || "Servicio"}*\n` +
              `• Profesional: *${instructorRow?.name || "Nuestro equipo"}*\n` +
              `• Fecha: *${fecha} ${hora}*\n\n` +
              `Si necesitás reprogramar o cancelar, avisanos por acá.`;

            try {
              await sendWhatsAppText(customerRow.phone_e164, msg, tenantId);
            } catch (waError) {
              // Si el error es 131047, significa que:
              // - Han pasado más de 24 horas desde la última respuesta del cliente, O
              // - El cliente nunca ha iniciado una conversación (primera vez)
              // En ambos casos, usamos el template aprobado para iniciar/reabrir la conversación
              if (waError.code === 131047 && sendWhatsAppTemplate) {
                console.log(`ℹ️ [appointments] Ventana de 24 horas cerrada. Usando template "confirmacion_turno" para iniciar la conversación...`);
                // Intentar con diferentes códigos de idioma
                const languageCodes = ["es", "es_AR", "es_419", "es_MX", "es_ES"];
                let templateSent = false;
                let templateError = null;
                
                for (const lang of languageCodes) {
                  try {
                    await sendWhatsAppTemplate(
                      customerRow.phone_e164,
                      "confirmacion_turno",
                      lang,
                      [
                        {
                          type: "body",
                          parameters: [
                            { type: "text", text: customerRow.name || "Cliente" },
                            { type: "text", text: serviceRow?.name || "Servicio" },
                            { type: "text", text: instructorRow?.name || "Nuestro equipo" },
                            { type: "text", text: fecha },
                            { type: "text", text: hora }
                          ]
                        }
                      ],
                      tenantId
                    );
                    console.log(`✅ [appointments] Template "confirmacion_turno" enviado exitosamente a ${customerRow.phone_e164} (idioma: ${lang})`);
                    templateSent = true;
                    break;
                  } catch (error) {
                    console.debug(`[appointments] Template "confirmacion_turno" con idioma "${lang}" no disponible:`, error.message);
                    templateError = error;
                    continue;
                  }
                }
                
                // Si ningún idioma funcionó, usar fallback
                if (!templateSent) {
                  // Si el template no existe (error 132001), usar fallback a mensaje de texto
                  if (templateError && templateError.code === 132001) {
                    console.warn(`⚠️ [appointments] Template "confirmacion_turno" no existe. Usando fallback a mensaje de texto...`);
                    const [[tenant]] = await pool.query(
                      "SELECT name FROM tenant WHERE id = ? LIMIT 1",
                      [tenantId]
                    ).catch(() => [[null]]);
                    const tenantName = tenant?.name || "ARJA ERP";
                    
                    const fallbackMessage = 
                      `¡Hola ${customerRow.name || ""}! 👋\n` +
                      `✅ Confirmamos tu turno:\n` +
                      `• Servicio: *${serviceRow?.name || "Servicio"}*\n` +
                      `• Profesional: *${instructorRow?.name || "Nuestro equipo"}*\n` +
                      `• Fecha: *${fecha} ${hora}*\n\n` +
                      `Si necesitás reprogramar o cancelar, avisanos por acá.`;
                    
                    try {
                      await sendWhatsAppText(customerRow.phone_e164, fallbackMessage, tenantId);
                      console.log(`✅ [appointments] Mensaje de texto de fallback enviado exitosamente a ${customerRow.phone_e164}`);
                    } catch (textError) {
                      console.error(`❌ [appointments] Error enviando mensaje de texto de fallback:`, textError.message || textError);
                    }
                  } else {
                    console.error(`⚠️ [appointments] Error enviando template "confirmacion_turno":`, templateError.message || templateError);
                    console.log(`ℹ️ [appointments] El template puede no estar aprobado aún o hay un error. El turno se creó correctamente.`);
                  }
                }
              } else if (waError.code === 131047) {
                console.log(`ℹ️ [appointments] No se pudo enviar confirmación a ${customerRow.phone_e164}:`);
                console.log(`   - El cliente debe iniciar la conversación primero enviando un mensaje a tu número de WhatsApp Business`);
                console.log(`   - El turno se creó correctamente, pero el mensaje no se pudo enviar`);
              } else if (waError.code === 133010) {
                console.log(`ℹ️ [appointments] No se pudo enviar confirmación a ${customerRow.phone_e164}: cuenta en modo Sandbox.`);
                console.log(`   - El número ${customerRow.phone_e164} debe estar en la lista de números de prueba en Meta Business Manager`);
              } else {
                console.error(`⚠️ [appointments] Error enviando confirmación a ${customerRow.phone_e164}:`, waError.message || waError);
              }
            }
          }
        }
      } catch (waErr) {
        console.error("⚠️ [appointments] Error en envío de WhatsApp:", waErr?.message || waErr);
      }
    }

    // --- 7) Notificaciones (fuera de la transacción) ---
    try {
      let customerLabel = `Cliente #${effectiveCustomerId}`;
      let serviceLabel = `Servicio #${serviceId}`;

      const [[c]] = await pool.query(
        "SELECT COALESCE(name,'') AS name, COALESCE(phone_e164,'') AS phone FROM customer WHERE id=? AND tenant_id=?",
        [effectiveCustomerId, tenantId]
      );
      if (c?.name || c?.phone) customerLabel = c.name || c.phone || customerLabel;

      const [[s]] = await pool.query(
        "SELECT COALESCE(name,'') AS name FROM service WHERE id=? AND tenant_id=?",
        [serviceId, tenantId]
      );
      if (s?.name) serviceLabel = s.name;

      await createNotification({
        tenantId,
        userId: req.user.id,
        type: "appointment",
        title: "Nuevo turno reservado",
        message: `${customerLabel} — ${serviceLabel} — Inicio: ${startsAt}`,
        data: { tenantId, appointmentId, instructorId, serviceId, customerId: effectiveCustomerId, startsAt, endsAt: endMySQL }
      });

                  // Notificar al estilista (Internal Notification, WhatsApp, Email)
      try { await pool.query(`ALTER TABLE instructor ADD COLUMN phone_e164 VARCHAR(32) NULL`); } catch {}

      const [[inst]] = await pool.query(
        "SELECT id, user_id, phone_e164, name FROM instructor WHERE id=? AND tenant_id=? LIMIT 1",
        [instructorId, tenantId]
      );

      if (inst) {
        // 1. Notificación interna (si tiene usuario)
        if (inst.user_id) {
          await createNotification({
            tenantId,
            userId: inst.user_id,
            type: "appointment",
            title: "Te asignaron un nuevo turno",
            message: `${customerLabel} — ${serviceLabel} — Inicio: ${startsAt}`,
            data: { tenantId, appointmentId, instructorId, serviceId, customerId: effectiveCustomerId, startsAt, endsAt: endMySQL }
          });
        }

        // 2. WhatsApp (si tiene teléfono)
        console.log(`[appointments] Evaluando WhatsApp para peluquero ${inst.name || "Sin nombre"}: phone=${inst.phone_e164}, serviceAvailable=${!!sendWhatsAppText}`);
        if (inst.phone_e164 && sendWhatsAppText) {
          try {
            const whenLabel = fmtLocal(startMySQL.replace(" ", "T"));
            const cName = c?.name || "Cliente";
            const cPhone = c?.phone || "";
            const cText = cPhone ? `${cName} (${cPhone})` : cName;

            const msg = `Hola ${inst.name || "👤"}!\n\nNuevo turno asignado:\n` +
                        `• Cliente: ${cText}\n` +
                        `• Servicio: ${serviceLabel}\n` +
                        `• Horario: ${whenLabel}`;
            
            console.log(`[appointments] Enviando WhatsApp a instructor ${inst.phone_e164}...`);
            try {
              await sendWhatsAppText(inst.phone_e164, msg, tenantId);
              console.log(`✅ [appointments] WhatsApp enviado a instructor ${inst.phone_e164}`);
            } catch (waErr) {
              console.warn(`⚠️ [appointments] Falló envío directo a instructor (${waErr.code}). Intentando template...`);
              if (waErr.code === 131047 && sendWhatsAppTemplate) {
                const langs = ["es", "es_AR", "es_419"];
                let sentTemplate = false;
                for (const lang of langs) {
                  try {
                    await sendWhatsAppTemplate(
                      inst.phone_e164,
                      "nuevo_turno_profesional",
                      lang,
                      [
                        { type: "body", parameters: [
                          { type: "text", text: inst.name || "Profesional" },
                          { type: "text", text: cText },
                          { type: "text", text: serviceLabel },
                          { type: "text", text: whenLabel }
                        ] }
                      ],
                      tenantId
                    );
                    console.log(`✅ [appointments] Template enviado a instructor (lang: ${lang})`);
                    sentTemplate = true;
                    break;
                  } catch (tplErr) {
                    console.warn(`⚠️ [appointments] Template falló (lang: ${lang}): ${tplErr.message}`);
                  }
                }
                if (!sentTemplate) console.error(`❌ [appointments] No se pudo enviar ningún template al instructor`);
              } else {
                 console.error(`❌ [appointments] Error no recuperable enviando a instructor: ${waErr.message}`);
              }
            }
          } catch (waSendErr) {
            console.error("⚠️ [appointments] Error general enviando WhatsApp al peluquero:", waSendErr?.message || waSendErr);
          }
        } else {
             if (!inst.phone_e164) console.warn(`⚠️ [appointments] El instructor ${inst.name} no tiene teléfono configurado (phone_e164)`);
             if (!sendWhatsAppText) console.warn(`⚠️ [appointments] El servicio de WhatsApp no está disponible (sendWhatsAppText es null)`);
        }

        // 3. Email (si tiene usuario y email)
        if (inst.user_id) {
          try {
            const [[u]] = await pool.query(
              "SELECT email FROM users WHERE id = ? AND tenant_id = ? LIMIT 1",
              [inst.user_id, tenantId]
            );
            if (u?.email) {
              const { sendEmail } = await import("../email.js").catch(() => ({ sendEmail: null }));
              if (sendEmail) {
                const whenLabel = fmtLocal(startMySQL.replace(" ", "T"));
                const cName = c?.name || "Cliente";
                const cPhone = c?.phone || "";
                const cText = cPhone ? `${cName} (${cPhone})` : cName;
                
                const subject = "Nuevo turno asignado";
                const html = [
                  `<p>Se te asignó un nuevo turno.</p>`,
                  `<p><strong>Cliente:</strong> ${cText}</p>`,
                  `<p><strong>Servicio:</strong> ${serviceLabel}</p>`,
                  `<p><strong>Horario:</strong> ${whenLabel}</p>`
                ].join("");
                await sendEmail({ to: u.email, subject, html, tenantId });
                console.log(`✅ [appointments] Email enviado al peluquero ${u.email}`);
              }
            }
          } catch (emailErr) {
            console.error("⚠️ [appointments] Error enviando email al peluquero:", emailErr?.message || emailErr);
          }
        }
      }

// Notificar al cliente por push (si tiene token registrado en customer_app_settings)
      try {
        const whenLabel = fmtLocal(startMySQL.replace(" ", "T"));
        await sendNotificationToCustomer(tenantId, effectiveCustomerId, {
          title: "Tu turno fue reservado",
          body: `${serviceLabel} — ${whenLabel}`,
          data: { type: "appointment_created", appointmentId, startsAt: startMySQL, instructorId, serviceId }
        });
      } catch (pushErr) {
        console.error("⚠️ [appointments] Error enviando push al cliente:", pushErr?.message || pushErr);
      }
    } catch (e) {
      console.error("⚠️ [appointments] No se pudo crear notificación:", e.message);
    }

    return res.status(201).json({ ok: true, id: appointmentId });

  } catch (err) {
    await conn.rollback();
    console.error("❌ [appointments POST] ERROR:", err);
    if (err?.status) {
      return res.status(err.status).json({ ok: false, error: err.message });
    }
    return res.status(500).json({ ok: false, error: "No se pudo crear el turno" });
  } finally {
    conn.release();
  }
});

appointments.post("/recurring", requireAuth, requireRole("admin", "staff", "user"), async (req, res) => {
  const tenantId = req.tenant.id;
  const {
    serviceId,
    instructorId,
    customerId: bodyCustomerId,
    customerPhone,
    customerName,
    startsAt,
    repeat = {},
    status = "scheduled",
  } = req.body || {};

  if (!serviceId || !instructorId || !startsAt || !repeat) {
    return res.status(400).json({ ok: false, error: "Faltan datos requeridos" });
  }

  if (!bodyCustomerId && !customerPhone) {
    return res.status(400).json({ ok: false, error: "Falta customerId o customerPhone" });
  }

  const frequency = String(repeat.frequency || "weekly").toLowerCase();
  if (frequency !== "weekly") {
    return res.status(400).json({ ok: false, error: "Solo se admite repetición semanal" });
  }

  const MAX_OCCURRENCES = Number(process.env.APPOINTMENT_RECURRING_MAX || 26);
  let interval = Number.parseInt(repeat.interval ?? 1, 10);
  if (!Number.isFinite(interval) || interval <= 0) interval = 1;

  let count = repeat.count != null ? Number.parseInt(repeat.count, 10) : null;
  if (Number.isFinite(count) && count <= 0) {
    return res.status(400).json({ ok: false, error: "La cantidad de repeticiones debe ser mayor a cero" });
  }
  if (count && count > MAX_OCCURRENCES) {
    return res.status(400).json({
      ok: false,
      error: `No se permiten más de ${MAX_OCCURRENCES} turnos en una serie`,
    });
  }

  const startDate = new Date(startsAt);
  if (Number.isNaN(startDate.getTime())) {
    return res.status(400).json({ ok: false, error: "Fecha/hora inicial inválida" });
  }

  let untilLimit = null;
  if (repeat.until) {
    const until = new Date(repeat.until);
    if (Number.isNaN(until.getTime())) {
      return res.status(400).json({ ok: false, error: "Fecha de fin de recurrencia inválida" });
    }
    untilLimit = new Date(until.getFullYear(), until.getMonth(), until.getDate(), 23, 59, 59, 999);
  }

  if (!count && !untilLimit) {
    return res.status(400).json({
      ok: false,
      error: "Indicá la cantidad de repeticiones (count) o una fecha límite (until)",
    });
  }

  const occurrences = [];
  let current = new Date(startDate.getTime());
  let tooManyGenerated = false;

  while (true) {
    if (count && occurrences.length >= count) break;
    if (untilLimit && current > untilLimit) break;
    if (occurrences.length >= MAX_OCCURRENCES) {
      tooManyGenerated = true;
      break;
    }

    occurrences.push(new Date(current.getTime()));
    current = addDays(current, interval * 7);
  }

  if (!occurrences.length) {
    return res.status(400).json({ ok: false, error: "No se generaron fechas para la recurrencia" });
  }

  if (tooManyGenerated) {
    return res.status(400).json({
      ok: false,
      error: `La recurrencia supera el máximo permitido (${MAX_OCCURRENCES}). Reducí la cantidad o el período.`,
    });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    let customerId = bodyCustomerId ? Number(bodyCustomerId) : null;
    if (customerId) {
      const [[customerRow]] = await conn.query(
        "SELECT id FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1",
        [customerId, tenantId]
      );
      if (!customerRow) {
        await conn.rollback();
        return res.status(404).json({ ok: false, error: "Cliente no encontrado para este tenant" });
      }
    } else {
      customerId = await ensureCustomerId(
        { name: customerName, phone: customerPhone },
        conn,
        tenantId
      );
    }

    // Para turnos individuales, no validar membresía
    const membershipInfo = await ensureActiveMembership(conn, tenantId, customerId, { forClasses: false });
    const appointmentTracker = { activeAppointments: null };

    const [[service]] = await conn.query(
      "SELECT id, duration_min, price_decimal FROM service WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1",
      [Number(serviceId), tenantId]
    );
    if (!service) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Servicio inexistente o inactivo" });
    }

    const [[instructor]] = await conn.query(
      "SELECT id, branch_id FROM instructor WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1",
      [Number(instructorId), tenantId]
    );
    if (!instructor) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Profesional inexistente o inactivo" });
    }

    const branchIdOverride = req.body.branchId ? Number(req.body.branchId) : null;
    const targetBranchId = await resolveAppointmentBranchId(req, {
      instructorBranchId: instructor.branch_id,
      branchIdOverride,
      conn,
    });

    const durationMin = Number(service.duration_min || 0);
    if (!Number.isFinite(durationMin) || durationMin <= 0) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "El servicio no tiene duración configurada" });
    }

    const recurrenceMeta = {
      frequency,
      interval,
      count: repeat.count ?? null,
      until: repeat.until ?? null,
    };

    const [seriesIns] = await conn.query(
      `INSERT INTO appointment_series
        (tenant_id, customer_id, instructor_id, service_id, frequency, interval_value, total_occurrences, starts_at, until_date, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        customerId,
        Number(instructorId),
        Number(serviceId),
        frequency,
        interval,
        occurrences.length,
        occurrences[0],
        untilLimit ? new Date(untilLimit.getFullYear(), untilLimit.getMonth(), untilLimit.getDate()) : null,
        JSON.stringify(recurrenceMeta),
      ]
    );

    const seriesId = seriesIns.insertId;
    const bufferMinutes = Number(process.env.APPT_BUFFER_MIN || 0);
    let parentAppointmentId = null;
    const created = [];

    for (let i = 0; i < occurrences.length; i += 1) {
      const occurrence = occurrences[i];
      const dateStr = occurrence.toISOString().slice(0, 10);
      const timeStr = `${String(occurrence.getHours()).padStart(2, "0")}:${String(
        occurrence.getMinutes()
      ).padStart(2, "0")}`;
      const startsAtLocal = `${dateStr} ${timeStr}:00`;

      await ensurePlanAllowsAppointment(conn, {
        tenantId,
        customerId,
        membership: membershipInfo,
        tracker: appointmentTracker,
      });

      try {
        validateAppointmentDate(startsAtLocal);
      } catch (validationError) {
        throw new Error(`El turno del ${dateStr} ${timeStr} no es válido: ${validationError.message}`);
      }

      const workingHours = await getWorkingHoursForDate(
        Number(instructorId),
        dateStr,
        conn,
        tenantId
      );
      if (!workingHours) {
        throw new Error(`El profesional no tiene horario definido para el ${dateStr}`);
      }

      const endDate = new Date(occurrence.getTime() + durationMin * 60000);

      if (
        !insideWorkingHours(dateStr, workingHours.start_time, workingHours.end_time, occurrence, endDate)
      ) {
        throw new Error(`El turno del ${dateStr} ${timeStr} queda fuera del horario laboral`);
      }

      try {
        await checkAppointmentOverlap(conn, {
          instructorId: Number(instructorId),
          startTime: occurrence,
          endTime: endDate,
          tenantId,
          bufferMinutes,
          useLock: true,
        });
      } catch (overlapError) {
        throw new Error(`El turno del ${dateStr} ${timeStr} se superpone: ${overlapError.message}`);
      }

      const [aptIns] = await conn.query(
        `INSERT INTO appointment
          (tenant_id, branch_id, customer_id, instructor_id, service_id, starts_at, ends_at, status, deposit_decimal, series_id, series_parent_id, recurrence_rule)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          targetBranchId,
          customerId,
          Number(instructorId),
          Number(serviceId),
          occurrence,
          endDate,
          status,
          0,
          seriesId,
          parentAppointmentId,
          i === 0 ? JSON.stringify(recurrenceMeta) : null,
        ]
      );

      const appointmentId = aptIns.insertId;
      if (!parentAppointmentId) {
        parentAppointmentId = appointmentId;
      }

      created.push({
        id: appointmentId,
        startsAt: occurrence.toISOString(),
        endsAt: endDate.toISOString(),
      });
    }

    await conn.commit();

    for (const occ of created) {
      await scheduleDepositReminder({ tenantId, appointmentId: occ.id });
    }

    let customerPhoneE164 = customerPhone;
    if (!customerPhoneE164) {
      const [[custRow]] = await pool.query(
        "SELECT phone_e164 FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1",
        [customerId, tenantId]
      );
      customerPhoneE164 = custRow?.phone_e164 || null;
    }

    if (customerPhoneE164 && sendWhatsAppText) {
      try {
        const formatter = new Intl.DateTimeFormat("es-AR", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });

        const datesText = created
          .map((occ) => formatter.format(new Date(occ.startsAt)).replace(".", ""))
          .join("\n• ");

        const msg =
          `✅ Reservamos tus turnos recurrentes:\n\n` +
          `• ${datesText}\n\n` +
          `Si necesitás reprogramar o cancelar, avisanos por acá.`;

        await sendWhatsAppText(customerPhoneE164, msg, tenantId);
      } catch (waErr) {
        console.error("⚠️ [appointments recurring] No se pudo enviar resumen por WhatsApp:", waErr);
      }
    }

    res.status(201).json({
      ok: true,
      data: {
        seriesId,
        occurrences: created,
      },
    });
  } catch (error) {
    await conn.rollback();
    console.error("❌ [appointments POST /recurring] ERROR:", error);

    const message =
      error?.message ||
      "No se pudo crear la serie de turnos. Revisá los datos ingresados e intentá nuevamente.";

    if (error?.status) {
      return res.status(error.status).json({ ok: false, error: message });
    }

    if (/superpone|horario|válido|no tiene horario/i.test(message)) {
      return res.status(409).json({ ok: false, error: message });
    }

    return res.status(500).json({ ok: false, error: message });
  } finally {
    conn.release();
  }
});

appointments.delete("/series/:seriesId", requireAuth, requireRole("admin", "staff", "user"), async (req, res) => {
  const tenantId = req.tenant.id;
  const { seriesId } = req.params;
  const includePast = String(req.query.includePast || "false") === "true";
  const notify = String(req.query.notify || "true") === "true";

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[series]] = await conn.query(
      `SELECT id, tenant_id, customer_id
         FROM appointment_series
        WHERE id = ? AND tenant_id = ? FOR UPDATE`,
      [seriesId, tenantId]
    );

    if (!series) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Serie no encontrada" });
    }

    const condition = includePast ? "" : "AND starts_at >= NOW()";

    const [appointmentsToCancel] = await conn.query(
      `SELECT id, starts_at
         FROM appointment
        WHERE tenant_id = ?
          AND series_id = ?
          ${condition}
          AND status NOT IN ('cancelled','completed')`,
      [tenantId, seriesId]
    );

    if (!appointmentsToCancel.length) {
      await conn.rollback();
      return res.status(409).json({
        ok: false,
        error: "No hay turnos futuros de la serie para cancelar",
      });
    }

    const ids = appointmentsToCancel.map((a) => a.id);
    await conn.query(
      `UPDATE appointment
          SET status = 'cancelled',
              hold_until = NULL
        WHERE tenant_id = ?
          AND series_id = ?
          ${condition}`,
      [tenantId, seriesId]
    );

    await conn.query(
      `UPDATE appointment_series
          SET updated_at = NOW()
        WHERE id = ? AND tenant_id = ?`,
      [seriesId, tenantId]
    );

    await conn.commit();

    if (notify && sendWhatsAppText) {
      try {
        const [[customerRow]] = await pool.query(
          `SELECT phone_e164, name
             FROM customer
            WHERE id = ? AND tenant_id = ?`,
          [series.customer_id, tenantId]
        );

        if (customerRow?.phone_e164) {
          const formatter = new Intl.DateTimeFormat("es-AR", {
            weekday: "short",
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });

          const dates = appointmentsToCancel
            .map((appt) => formatter.format(new Date(appt.starts_at)).replace(".", ""))
            .join("\n• ");

          const msg =
            `ℹ️ Cancelamos los turnos recurrentes que tenías agendados:\n\n` +
            `• ${dates}\n\n` +
            `Si querés reservar nuevos horarios, escribime de nuevo 🙂`;

          await sendWhatsAppText(customerRow.phone_e164, msg, tenantId);
        }
      } catch (waErr) {
        console.error("⚠️ [appointments series cancel] No se pudo notificar por WhatsApp:", waErr);
      }
    }

    res.json({
      ok: true,
      cancelled: ids.length,
      appointmentIds: ids,
    });
  } catch (error) {
    await conn.rollback();
    console.error("❌ [appointments DELETE /series/:id] ERROR:", error);
    if (error?.status) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    conn.release();
  }
});

// ✅ PUT con tenant en locks/selects/updates
appointments.put("/:id", requireAuth, requireRole("admin", "staff", "user"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const tenantId = req.tenant.id;
    const { id } = req.params;
    const b = req.body || {};

    const depositDecimal = b.depositDecimal ?? null;
    const markDepositAsPaid = b.markDepositAsPaid === true;
    const applySeries = String(b.applySeries || "none").toLowerCase();

    if (!["none", "all", "future"].includes(applySeries)) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Valor de applySeries inválido" });
    }

    // Turno actual (lock y tenant)
    const [[current]] = await conn.query(
      `SELECT id, customer_id, instructor_id, service_id, branch_id, starts_at, ends_at, status, deposit_decimal, deposit_paid_at, series_id
         FROM appointment 
        WHERE id=? AND tenant_id=? FOR UPDATE`,
      [id, tenantId]
    );

    if (!current) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Turno no encontrado" });
    }

    // Verificar si el cliente está exento de seña y corregir status si es necesario
    const customerIdToCheck = newCustomerId || current.customer_id;
    if (customerIdToCheck) {
      const [[customerCheck]] = await conn.query(
        `SELECT exempt_deposit FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [customerIdToCheck, tenantId]
      );
      
      const isExemptDeposit = customerCheck?.exempt_deposit === 1 || customerCheck?.exempt_deposit === true;
      const finalDepositDecimal = depositDecimal != null ? Number(depositDecimal) : current.deposit_decimal;
      const hasNoPaidDeposit = !current.deposit_paid_at;
      const isPendingDeposit = (status === "pending_deposit") || (!status && current.status === "pending_deposit");
      
      // Si el cliente está exento, no debería tener seña pendiente
      if (isExemptDeposit && isPendingDeposit && hasNoPaidDeposit && finalDepositDecimal === 0) {
        if (!status) {
          status = "scheduled"; // Cambiar a scheduled si no se especificó otro status
        } else if (status === "pending_deposit") {
          status = "scheduled"; // Forzar a scheduled si está exento
        }
        console.log(`ℹ️ [appointments] Cliente exento de seña, corrigiendo status de turno ${id} de pending_deposit a scheduled`);
      }
    }

    if (applySeries !== "none" && !current.series_id) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "El turno no pertenece a una serie" });
    }

    const baseOldStart = new Date(current.starts_at);

    let newCustomerId = null;
    if (b.customerPhone || b.phone_e164) {
      newCustomerId = await ensureCustomerId({
        name: b.customerName ?? b.customer_name,
        phone: b.customerPhone ?? b.phone_e164
      }, conn, tenantId);
    }

    const instructorId = (b.instructorId ?? b.instructor_id) ?? current.instructor_id;
    const serviceId = (b.serviceId ?? b.service_id) ?? current.service_id;
    const branchOverride = b.branchId ?? b.branch_id ?? null;
    let targetBranchId = current.branch_id;

    if (
      branchOverride != null ||
      Number(instructorId) !== Number(current.instructor_id)
    ) {
      const [[sty]] = await conn.query(
        "SELECT id, branch_id FROM instructor WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1",
        [Number(instructorId), tenantId]
      );
      if (!sty) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "Profesional inexistente" });
      }
      try {
        targetBranchId = await resolveAppointmentBranchId(req, {
          instructorBranchId: sty.branch_id,
          branchIdOverride: branchOverride != null ? Number(branchOverride) : null,
          conn,
        });
      } catch (branchError) {
        await conn.rollback();
        return res
          .status(branchError?.statusCode || branchError?.status || 400)
          .json({ ok: false, error: branchError.message });
      }
    }

    const status = b.status ?? null;
    const durationMin = b.durationMin ?? null;

    let startMySQL = anyToMySQL(b.startsAt ?? b.starts_at);
    let endMySQL = anyToMySQL(b.endsAt ?? b.ends_at);

    // Validación de fecha si cambia inicio
    if (startMySQL) {
      try {
        validateAppointmentDate(startMySQL);
      } catch (validationError) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: validationError.message });
      }
    }

    // Recalcular fin si hace falta
    if (!endMySQL) {
      const effectiveStart = startMySQL || current.starts_at;
      const mustRecalc =
        Boolean(startMySQL) || Boolean(b.serviceId ?? b.service_id) || durationMin != null;

      if (mustRecalc) {
        const dur = await resolveServiceDuration(serviceId, durationMin, conn, tenantId);
        if (dur && effectiveStart) {
          const [[{ calc_end }]] = await conn.query(
            "SELECT DATE_ADD(STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s'), INTERVAL ? MINUTE) AS calc_end",
            [anyToMySQL(effectiveStart), Number(dur)]
          );
          endMySQL = anyToMySQL(calc_end);
        } else {
          endMySQL = current.ends_at;
        }
      } else {
        endMySQL = current.ends_at;
      }
    }

    // Validar horarios y overlaps si cambia rango
    if (startMySQL && endMySQL) {
      const dateStr = startMySQL.slice(0, 10);
      const wh = await getWorkingHoursForDate(instructorId, dateStr, conn, tenantId);

      if (!wh) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "El peluquero no tiene horarios definidos para ese día" });
      }

      const startDate = new Date(startMySQL.replace(" ", "T"));
      const endDate = new Date(endMySQL.replace(" ", "T"));

      if (!insideWorkingHours(dateStr, wh.start_time, wh.end_time, startDate, endDate)) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "Fuera del horario laboral" });
      }

      try {
        await checkAppointmentOverlap(conn, {
          instructorId: Number(instructorId),
          startTime: startDate,
          endTime: endDate,
          tenantId: tenantId,
          excludeId: id,
          bufferMinutes: Number(process.env.APPT_BUFFER_MIN || 10),
          useLock: true
        });
      } catch (overlapError) {
        await conn.rollback();
        return res.status(409).json({ ok: false, error: overlapError.message });
      }
    }

    // Validación de seña si viene
    if (depositDecimal != null) {
      const [[svc]] = await conn.query(
        "SELECT price_decimal FROM service WHERE id=? AND tenant_id=? LIMIT 1",
        [serviceId, tenantId]
      );
      if (!svc) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "Servicio inexistente" });
      }
      const price = Number(svc.price_decimal ?? 0);
      const dep = Number(depositDecimal);
      if (Number.isNaN(dep)) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "Seña inválida" });
      }
      if (dep < 0) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "La seña no puede ser negativa" });
      }
      if (price > 0 && dep > price) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "La seña no puede superar el precio del servicio" });
      }
    }

    // UPDATE (scoped)
    let setPaidAtSQL = "";
    const params = [
      newCustomerId,
      instructorId,
      serviceId,
      targetBranchId,
      startMySQL,
      endMySQL,
      status,
      depositDecimal,
      id,
      tenantId
    ];

    if (markDepositAsPaid) {
      setPaidAtSQL = ", deposit_paid_at = NOW()";
    }

    const [r] = await conn.query(
      `UPDATE appointment a
          SET a.customer_id     = COALESCE(?, a.customer_id),
              a.instructor_id      = COALESCE(?, a.instructor_id),
              a.service_id      = COALESCE(?, a.service_id),
              a.branch_id       = COALESCE(?, a.branch_id),
              a.starts_at       = COALESCE(?, a.starts_at),
              a.ends_at         = COALESCE(?, a.ends_at),
              a.status          = COALESCE(?, a.status),
              a.deposit_decimal = COALESCE(?, a.deposit_decimal)
              ${setPaidAtSQL}
        WHERE a.id = ? AND a.tenant_id = ?`,
      params
    );

    if (r.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Turno no encontrado" });
    }

    if (applySeries !== "none" && current.series_id) {
      const [[updatedBase]] = await conn.query(
        `SELECT id, starts_at, ends_at, instructor_id, service_id, branch_id
           FROM appointment
          WHERE id = ? AND tenant_id = ? FOR UPDATE`,
        [id, tenantId]
      );

      const durationMs = new Date(updatedBase.ends_at).getTime() - new Date(updatedBase.starts_at).getTime();

      await updateSeriesAppointments(conn, {
        tenantId,
        seriesId: current.series_id,
        baseAppointmentId: Number(id),
        scope: applySeries === "all" ? "all" : "future",
        baseOldStart,
        baseNewStart: new Date(updatedBase.starts_at),
        instructorId: Number(updatedBase.instructor_id),
        serviceId: Number(updatedBase.service_id),
        branchId: targetBranchId ?? updatedBase.branch_id,
        durationMs,
        bufferMinutes: Number(process.env.APPT_BUFFER_MIN || 10),
      });
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    console.error("❌ [PUT /appointments/:id] ERROR:", e);
    if (e?.status) {
      return res.status(e.status).json({ ok: false, error: e.message });
    }
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
  }
});
// ✅ Agregar soporte para PATCH (alias de PUT)
appointments.patch("/:id", requireAuth, requireRole("admin", "staff", "user"), async (req, res) => {
  // Reutilizar la misma lógica del PUT
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const tenantId = req.tenant.id;
    const { id } = req.params;
    const b = req.body || {};

    const depositDecimal = b.depositDecimal ?? null;
    const markDepositAsPaid = b.markDepositAsPaid === true;

    // Turno actual (lock y tenant)
    const [[current]] = await conn.query(
      `SELECT id, customer_id, instructor_id, service_id, branch_id, starts_at, ends_at, status, deposit_decimal
         FROM appointment 
        WHERE id=? AND tenant_id=? FOR UPDATE`,
      [id, tenantId]
    );

    if (!current) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Turno no encontrado" });
    }

    let newCustomerId = null;
    if (b.customerPhone || b.phone_e164) {
      const { getCustomerByPhone, upsertCustomerNameByPhone } = await import("./customers.js");
      newCustomerId = await upsertCustomerNameByPhone({
        name: b.customerName ?? b.customer_name,
        phone: b.customerPhone ?? b.phone_e164
      }, conn, tenantId);
    }

    const instructorId = (b.instructorId ?? b.instructor_id) ?? current.instructor_id;
    const serviceId = (b.serviceId ?? b.service_id) ?? current.service_id;
    const branchOverride = b.branchId ?? b.branch_id ?? null;
    let targetBranchId = current.branch_id;

    if (
      branchOverride != null ||
      Number(instructorId) !== Number(current.instructor_id)
    ) {
      const [[sty]] = await conn.query(
        "SELECT id, branch_id FROM instructor WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1",
        [Number(instructorId), tenantId]
      );
      if (!sty) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "Profesional inexistente" });
      }
      try {
        targetBranchId = await resolveAppointmentBranchId(req, {
          instructorBranchId: sty.branch_id,
          branchIdOverride: branchOverride != null ? Number(branchOverride) : null,
          conn,
        });
      } catch (branchError) {
        await conn.rollback();
        return res
          .status(branchError?.statusCode || branchError?.status || 400)
          .json({ ok: false, error: branchError.message });
      }
    }
    const status = b.status ?? null;
    const durationMin = b.durationMin ?? null;

    // Helper para normalizar fechas
    const anyToMySQL = (val) => {
      if (!val) return null;
      const fmt = (d) => {
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      };
      if (val instanceof Date && !Number.isNaN(val.getTime())) return fmt(val);
      if (typeof val === "string") {
        let s = val.trim();
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
          s = s.replace("T", " ");
          return s.length === 16 ? s + ":00" : s.slice(0, 19);
        }
        if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/.test(s)) {
          return s.length === 16 ? s + ":00" : s.slice(0, 19);
        }
        if (/[Zz]$/.test(s) || /[+\-]\d{2}:\d{2}$/.test(s)) {
          // Si tiene timezone (ej: -03:00), extraer la fecha/hora directamente sin convertir
          // porque la BD ya está en UTC-3
          const match = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
          if (match) {
            return `${match[1]} ${match[2]}`;
          }
          // Fallback: usar Date pero ajustar para Argentina
          const d = new Date(s);
          if (!Number.isNaN(d.getTime())) {
            // Si la fecha viene con -03:00, ya está en hora argentina, no convertir
            if (s.includes('-03:00')) {
              // Extraer directamente la fecha/hora sin conversión
              const localMatch = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
              if (localMatch) {
                return `${localMatch[1]} ${localMatch[2]}`;
              }
            }
            return fmt(d);
          }
        }
        return null;
      }
      return null;
    };

    let startMySQL = anyToMySQL(b.startsAt ?? b.starts_at);
    let endMySQL = anyToMySQL(b.endsAt ?? b.ends_at);

    // Recalcular fin si hace falta
    if (!endMySQL && startMySQL) {
      const [[svc]] = await conn.query(
        "SELECT duration_min FROM service WHERE id=? AND tenant_id=? LIMIT 1",
        [serviceId, tenantId]
      );
      if (svc?.duration_min) {
        const [[{ calc_end }]] = await conn.query(
          "SELECT DATE_ADD(STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s'), INTERVAL ? MINUTE) AS calc_end",
          [startMySQL, svc.duration_min]
        );
        endMySQL = anyToMySQL(calc_end);
      }
    }

    // UPDATE
    let setPaidAtSQL = "";
    const params = [
      newCustomerId,
      instructorId,
      serviceId,
      targetBranchId,
      startMySQL,
      endMySQL,
      status,
      depositDecimal,
      id,
      tenantId
    ];

    if (markDepositAsPaid) {
      setPaidAtSQL = ", deposit_paid_at = NOW()";
    }

    const [r] = await conn.query(
      `UPDATE appointment a
          SET a.customer_id     = COALESCE(?, a.customer_id),
              a.instructor_id      = COALESCE(?, a.instructor_id),
              a.service_id      = COALESCE(?, a.service_id),
              a.branch_id       = COALESCE(?, a.branch_id),
              a.starts_at       = COALESCE(?, a.starts_at),
              a.ends_at         = COALESCE(?, a.ends_at),
              a.status          = COALESCE(?, a.status),
              a.deposit_decimal = COALESCE(?, a.deposit_decimal)
              ${setPaidAtSQL}
        WHERE a.id = ? AND a.tenant_id = ?`,
      params
    );

    if (r.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Turno no encontrado" });
    }

    await conn.commit();

    // Procesar notificaciones si se solicitaron
    const notifyWhatsApp = b.notifyWhatsApp === true || b.notifyWhatsApp === "true";
    const notifyEmail = b.notifyEmail === true || b.notifyEmail === "true";
    const messageTemplate = b.messageTemplate || null;
    const customMessage = b.customMessage || null;

    // Rastrear el estado de las notificaciones
    const notificationStatus = {
      whatsApp: { requested: notifyWhatsApp, sent: false, error: null },
      email: { requested: notifyEmail, sent: false, error: null }
    };

    if (notifyWhatsApp || notifyEmail) {
      try {
        // Validar que el botón de ayuda esté habilitado y configurado para notificaciones de WhatsApp
        let canSendWhatsApp = true;
        if (notifyWhatsApp) {
          const { getTenantWhatsAppHub } = await import("../services/whatsappHub.js").catch(() => ({ getTenantWhatsAppHub: null }));
          if (getTenantWhatsAppHub) {
            const waConfig = await getTenantWhatsAppHub(tenantId).catch((err) => {
              console.error(`⚠️ [appointments] Error obteniendo configuración de WhatsApp para tenant ${tenantId}:`, err);
              return null;
            });
            
            console.log(`[appointments] Configuración de WhatsApp obtenida para tenant ${tenantId}:`, {
              hasConfig: !!waConfig,
              supportAgentEnabled: waConfig?.supportAgentEnabled,
              supportAgentPhone: waConfig?.supportAgentPhone,
              supportAgentPhoneType: typeof waConfig?.supportAgentPhone,
            });
            
            const supportAgentEnabled = waConfig?.supportAgentEnabled ?? false;
            const supportAgentPhone = waConfig?.supportAgentPhone;
            const hasValidPhone = supportAgentPhone && String(supportAgentPhone).trim();
            
            console.log(`[appointments] Validación de configuración:`, {
              supportAgentEnabled,
              supportAgentPhone,
              hasValidPhone,
              willFail: !supportAgentEnabled || !hasValidPhone,
            });
            
            if (!supportAgentEnabled || !hasValidPhone) {
              console.warn(`⚠️ [appointments] No se puede enviar notificación WhatsApp: el botón de ayuda no está habilitado o configurado para el tenant ${tenantId}`, {
                supportAgentEnabled,
                supportAgentPhone,
                hasValidPhone,
                waConfigKeys: waConfig ? Object.keys(waConfig) : null,
              });
              canSendWhatsApp = false;
              const errorMessage = !supportAgentEnabled 
                ? "El botón de ayuda no está habilitado. Por favor, habilitá el botón de ayuda en la sección de Configuración → WhatsApp Business y asegurate de presionar 'Guardar Cambios'."
                : "El número del agente de ayuda no está configurado o no se guardó correctamente. Por favor:\n1. Ve a Configuración → WhatsApp Business\n2. Verificá que el número del agente esté ingresado (formato: 5491170590570)\n3. Asegurate de presionar 'Guardar Cambios' en la parte superior de la página";
              notificationStatus.whatsApp.error = errorMessage;
              
              // Si solo se solicitó WhatsApp y no email, retornar error
              if (!notifyEmail) {
                return res.status(400).json({
                  ok: false,
                  error: errorMessage,
                  notificationStatus,
                  debug: {
                    supportAgentEnabled,
                    supportAgentPhone,
                    hasValidPhone,
                    tenantId,
                    suggestion: !hasValidPhone ? "El número del agente aparece configurado en la interfaz pero no se guardó en la base de datos. Por favor, guardá los cambios nuevamente." : null
                  }
                });
              }
            } else {
              console.log(`✅ [appointments] Validación de WhatsApp pasada para tenant ${tenantId}:`, {
                supportAgentEnabled,
                supportAgentPhone,
              });
            }
          } else {
            console.warn(`⚠️ [appointments] No se pudo importar getTenantWhatsAppHub`);
          }
        }
        
        const effectiveCustomerId = newCustomerId || current.customer_id;
        const [[customerRow]] = await pool.query(
          "SELECT phone_e164, name, email FROM customer WHERE id=? AND tenant_id=? LIMIT 1",
          [effectiveCustomerId, tenantId]
        );

        if (customerRow) {
          const [[serviceRow]] = await pool.query(
            "SELECT name FROM service WHERE id=? AND tenant_id=? LIMIT 1",
            [serviceId, tenantId]
          );
          const [[instructorRow]] = await pool.query(
            "SELECT name FROM instructor WHERE id=? AND tenant_id=? LIMIT 1",
            [instructorId, tenantId]
          );
          
          // Obtener datos anteriores para comparar y mostrar en el mensaje
          const [[oldInstructorRow]] = await pool.query(
            "SELECT name FROM instructor WHERE id=? AND tenant_id=? LIMIT 1",
            [current.instructor_id, tenantId]
          );
          const [[oldServiceRow]] = await pool.query(
            "SELECT name FROM service WHERE id=? AND tenant_id=? LIMIT 1",
            [current.service_id, tenantId]
          );

          const finalStart = startMySQL || current.starts_at;
          const startDate = new Date(finalStart.replace(" ", "T"));
          const fecha = startDate.toLocaleDateString("es-AR", {
            weekday: "short",
            day: "2-digit",
            month: "2-digit",
          });
          const hora = startDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
          
          // Obtener el horario anterior para comparar
          const oldStartDate = new Date(current.starts_at.replace(" ", "T"));
          const oldFecha = oldStartDate.toLocaleDateString("es-AR", {
            weekday: "short",
            day: "2-digit",
            month: "2-digit",
          });
          const oldHora = oldStartDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

          // Detectar qué cambió
          const horarioCambio = startMySQL && finalStart !== current.starts_at;
          const profesionalCambio = Number(instructorId) !== Number(current.instructor_id);
          const servicioCambio = Number(serviceId) !== Number(current.service_id);

          // Usar mensaje personalizado o mensaje por defecto
          // Si hay mensaje personalizado, reemplazar los placeholders
          let message = customMessage;
          if (message && message.trim()) {
            // Reemplazar placeholders de horario, fecha, hora, servicio, profesional
            message = message.replace(/{horario}/g, `${fecha} ${hora}`);
            message = message.replace(/{fecha}/g, fecha);
            message = message.replace(/{hora}/g, hora);
            message = message.replace(/{servicio}/g, serviceRow?.name || "Servicio");
            message = message.replace(/{profesional}/g, instructorRow?.name || "Nuestro equipo");
            
            // Si cambió el horario, asegurar que se incluya en el mensaje con formato anterior → nuevo
            if (horarioCambio) {
              const hasHorario = message.includes(fecha) || message.includes(hora) || 
                                message.toLowerCase().includes("horario") || 
                                message.toLowerCase().includes("nuevo horario") ||
                                message.toLowerCase().includes("fecha") ||
                                message.match(/\d{1,2}\/\d{1,2}/); // Formato de fecha
              
              if (!hasHorario) {
                message += `\n\n📅 *Horario:* ${oldFecha} ${oldHora} → ${fecha} ${hora}`;
              }
            }
            
            // Si cambió el profesional, asegurar que se incluya en el mensaje con formato anterior → nuevo
            if (profesionalCambio) {
              const oldProfesional = oldInstructorRow?.name || "Nuestro equipo";
              const newProfesional = instructorRow?.name || "Nuestro equipo";
              const hasProfesional = message.toLowerCase().includes("profesional") || 
                                    message.toLowerCase().includes(newProfesional.toLowerCase()) ||
                                    message.toLowerCase().includes(oldProfesional.toLowerCase());
              
              if (!hasProfesional) {
                message += `\n\n👤 *Profesional:* ${oldProfesional} → ${newProfesional}`;
              }
            }
            
            // Si cambió el servicio, asegurar que se incluya en el mensaje con formato anterior → nuevo
            if (servicioCambio) {
              const oldServicio = oldServiceRow?.name || "Servicio";
              const newServicio = serviceRow?.name || "Servicio";
              const hasServicio = message.toLowerCase().includes("servicio") || 
                                 message.toLowerCase().includes(newServicio.toLowerCase()) ||
                                 message.toLowerCase().includes(oldServicio.toLowerCase());
              
              if (!hasServicio) {
                message += `\n\n💇 *Servicio:* ${oldServicio} → ${newServicio}`;
              }
            }
          } else {
            // Construir mensaje dinámico mostrando el cambio (anterior → nuevo)
            const cambios = [];
            
            if (horarioCambio) {
              cambios.push(`📅 *Horario:* ${oldFecha} ${oldHora} → ${fecha} ${hora}`);
            }
            
            if (profesionalCambio) {
              const oldProfesional = oldInstructorRow?.name || "Nuestro equipo";
              const newProfesional = instructorRow?.name || "Nuestro equipo";
              cambios.push(`👤 *Profesional:* ${oldProfesional} → ${newProfesional}`);
            }
            
            if (servicioCambio) {
              const oldServicio = oldServiceRow?.name || "Servicio";
              const newServicio = serviceRow?.name || "Servicio";
              cambios.push(`💇 *Servicio:* ${oldServicio} → ${newServicio}`);
            }
            
            // Si no hay cambios específicos detectados, mostrar información completa del turno
            if (cambios.length === 0) {
              cambios.push(`• Servicio: *${serviceRow?.name || "Servicio"}*`);
              cambios.push(`• Profesional: *${instructorRow?.name || "Nuestro equipo"}*`);
              cambios.push(`• Horario: *${fecha} ${hora}*`);
            }
            
            message = `Hola ${customerRow.name || ""}! 👋\n\n` +
              `Te contactamos para informarte que tu turno ha sido reprogramado:\n\n` +
              cambios.join("\n") + `\n\n` +
              `Si tenés alguna consulta, escribinos por acá.`;
          }

          // Enviar WhatsApp (solo si la validación pasó)
          if (notifyWhatsApp && canSendWhatsApp && customerRow.phone_e164) {
            try {
              if (sendWhatsAppText) {
                const waResponse = await sendWhatsAppText(customerRow.phone_e164, message, tenantId);
                const messageId = waResponse?.messages?.[0]?.id;
                
                console.log(`[appointments] 📨 Respuesta de WhatsApp:`, {
                  hasResponse: !!waResponse,
                  messageId,
                  responseKeys: waResponse ? Object.keys(waResponse) : [],
                  messages: waResponse?.messages?.length || 0
                });
                
                // Registrar el message_id para evitar que las respuestas activen el bot
                if (messageId) {
                  try {
                    const whatsappRoutes = await import("./whatsapp.js");
                    if (whatsappRoutes.registerNotificationMessageId) {
                      whatsappRoutes.registerNotificationMessageId(messageId, customerRow.phone_e164, tenantId);
                      console.log(`✅ [appointments] Message_id ${messageId} registrado para ${customerRow.phone_e164}`);
                    } else {
                      console.warn(`⚠️ [appointments] registerNotificationMessageId no está disponible en whatsapp.js`);
                    }
                  } catch (registerError) {
                    console.error(`⚠️ [appointments] Error registrando message_id:`, registerError);
                  }
                } else {
                  console.warn(`⚠️ [appointments] No se obtuvo message_id de la respuesta de WhatsApp:`, waResponse);
                  // Intentar registrar igual por teléfono y tiempo
                  try {
                    const whatsappRoutes = await import("./whatsapp.js");
                    if (whatsappRoutes.registerNotificationMessageId) {
                      // Registrar con un ID temporal basado en timestamp
                      const tempMessageId = `temp_${Date.now()}_${customerRow.phone_e164.replace(/\D/g, "")}`;
                      whatsappRoutes.registerNotificationMessageId(tempMessageId, customerRow.phone_e164, tenantId);
                      console.log(`✅ [appointments] Message_id temporal registrado para ${customerRow.phone_e164}`);
                    }
                  } catch (registerError) {
                    console.warn(`⚠️ [appointments] No se pudo registrar message_id temporal:`, registerError.message);
                  }
                }
                
                console.log(`✅ [appointments] Notificación WhatsApp enviada a ${customerRow.phone_e164}`);
                notificationStatus.whatsApp.sent = true;
                
                // Crear sesión en modo "waiting_for_agent" para que las respuestas del cliente vayan al agente
                try {
                  const { getSession, setStep } = await import("../helpers/session.js");
                  const { getTenantWhatsAppHub } = await import("../services/whatsappHub.js");
                  const waConfig = await getTenantWhatsAppHub(tenantId).catch(() => null);
                  const supportAgentPhone = waConfig?.supportAgentEnabled && waConfig?.supportAgentPhone 
                    ? waConfig.supportAgentPhone 
                    : null;
                  
                  if (supportAgentPhone) {
                    // Obtener o crear sesión para el cliente
                    const session = getSession(customerRow.phone_e164);
                    
                    // Configurar sesión en modo "waiting_for_agent"
                    setStep(customerRow.phone_e164, "waiting_for_agent", {
                      ...session.data,
                      tenantId: tenantId,
                      supportAgentPhone: supportAgentPhone,
                      customerName: customerRow.name || "Sin nombre",
                      appointmentId: id, // Usar 'id' que es el parámetro de la ruta
                      notificationType: "reprogramation",
                      lastMessageIdToAgent: messageId || null
                    });
                    
                    console.log(`✅ [appointments] Sesión creada en modo "waiting_for_agent" para ${customerRow.phone_e164}`);
                    
                    // Notificar al agente sobre la reprogramación (similar al botón de ayuda)
                    try {
                      const { sendMessageToAgentWithFallback } = await import("./whatsapp.js");
                      const { getTenantName } = await import("../services/tenantFeatures.js");
                      const tenantName = await getTenantName(tenantId).catch(() => "El negocio");
                      
                      const agentNotification = `📅 *Reprogramación de turno*\n\n` +
                        `Se ha reprogramado un turno y el cliente puede responder.\n\n` +
                        `📱 Cliente: ${customerRow.name || "Sin nombre"}\n` +
                        `📞 Teléfono: ${customerRow.phone_e164}\n` +
                        `🏢 Negocio: ${tenantName}\n\n` +
                        `El cliente recibió una notificación sobre la reprogramación. Si responde, recibirás sus mensajes aquí.\n\n` +
                        `_Podés responder directamente escribiendo al número: ${customerRow.phone_e164}_`;
                      
                      const agentContext = messageId ? { message_id: messageId } : null;
                      const agentResult = await sendMessageToAgentWithFallback(supportAgentPhone, agentNotification, tenantId, agentContext);
                      
                      if (agentResult.success && agentResult.messageId) {
                        // Guardar el message_id para mantener el contexto
                        const session = getSession(customerRow.phone_e164);
                        session.data.lastMessageIdToAgent = agentResult.messageId;
                        console.log(`✅ [appointments] Agente notificado sobre reprogramación (método: ${agentResult.method})`);
                      }
                    } catch (agentNotifyError) {
                      console.error(`⚠️ [appointments] Error notificando al agente:`, agentNotifyError);
                      // No fallar si hay error notificando al agente
                    }
                  }
                } catch (sessionError) {
                  console.error(`⚠️ [appointments] Error creando sesión para agente:`, sessionError);
                  // No fallar la actualización si hay error creando la sesión
                }
              }
            } catch (waError) {
              console.error(`⚠️ [appointments] Error enviando WhatsApp a ${customerRow.phone_e164}:`, waError.message || waError);
              notificationStatus.whatsApp.error = waError.message || "Error al enviar WhatsApp";
            }
          } else if (notifyWhatsApp && !canSendWhatsApp) {
            // Ya se registró el error arriba
          } else if (notifyWhatsApp && !customerRow.phone_e164) {
            notificationStatus.whatsApp.error = "El cliente no tiene número de teléfono configurado";
          }

          // Enviar Email (si está configurado)
          if (notifyEmail && customerRow.email) {
            try {
              const { sendEmail } = await import("../email.js").catch(() => ({ sendEmail: null }));
              if (sendEmail) {
                await sendEmail({
                  to: customerRow.email,
                  subject: "Turno reprogramado",
                  html: message.replace(/\n/g, "<br>").replace(/\*/g, "<strong>").replace(/\*(.*?)\*/g, "<strong>$1</strong>"),
                  tenantId,
                });
                console.log(`✅ [appointments] Notificación Email enviada a ${customerRow.email}`);
                notificationStatus.email.sent = true;
              } else {
                notificationStatus.email.error = "El servicio de email no está configurado";
              }
            } catch (emailError) {
              console.error(`⚠️ [appointments] Error enviando Email a ${customerRow.email}:`, emailError.message || emailError);
              notificationStatus.email.error = emailError.message || "Error al enviar Email";
            }
          } else if (notifyEmail && !customerRow.email) {
            notificationStatus.email.error = "El cliente no tiene email configurado";
          }
        }
      } catch (notifError) {
        console.error("⚠️ [appointments] Error procesando notificaciones:", notifError.message || notifError);
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
  } catch (e) {
    await conn.rollback();
    console.error("❌ [PATCH /appointments/:id] ERROR:", e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
  }
});

appointments.delete("/:id", requireAuth, requireRole("admin", "staff", "user"), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    const [r] = await pool.query(
      `DELETE FROM appointment WHERE id=? AND tenant_id=?`,
      [id, tenantId]
    );

    if (r.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Turno no encontrado" });
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

async function updateSeriesAppointments(conn, {
  tenantId,
  seriesId,
  baseAppointmentId,
  scope,
  baseOldStart,
  baseNewStart,
  instructorId,
  serviceId,
  branchId,
  durationMs,
  bufferMinutes,
}) {
  const condition = scope === "all" ? "" : "AND starts_at >= ?";
  const params = scope === "all"
    ? [tenantId, seriesId, baseAppointmentId]
    : [tenantId, seriesId, baseAppointmentId, baseOldStart];

  const [rows] = await conn.query(
    `SELECT id, starts_at
       FROM appointment
      WHERE tenant_id = ?
        AND series_id = ?
        AND id <> ?
        ${condition}
      ORDER BY starts_at ASC
      FOR UPDATE`,
    params
  );

  if (!rows.length) {
    return;
  }

  const deltaMs = baseNewStart.getTime() - baseOldStart.getTime();

  for (const row of rows) {
    const originalStart = new Date(row.starts_at);
    const newStart = new Date(originalStart.getTime() + deltaMs);
    const newEnd = new Date(newStart.getTime() + durationMs);

    const dateStr = formatLocalDate(newStart);
    const timeStr = `${pad2(newStart.getHours())}:${pad2(newStart.getMinutes())}`;

    validateAppointmentDate(`${dateStr} ${timeStr}:00`);

    const workingHours = await getWorkingHoursForDate(
      Number(instructorId),
      dateStr,
      conn,
      tenantId
    );

    if (!workingHours) {
      const err = new Error(`El profesional no tiene horario definido para el ${dateStr}`);
      err.status = 409;
      throw err;
    }

    if (!insideWorkingHours(dateStr, workingHours.start_time, workingHours.end_time, newStart, newEnd)) {
      const err = new Error(`El turno del ${dateStr} ${timeStr} queda fuera del horario laboral`);
      err.status = 409;
      throw err;
    }

    await checkAppointmentOverlap(conn, {
      instructorId: Number(instructorId),
      startTime: newStart,
      endTime: newEnd,
      tenantId,
      bufferMinutes,
      excludeId: row.id,
      useLock: true,
    });

    const updateFragments = ["instructor_id = ?", "service_id = ?"];
    const updateParams = [Number(instructorId), Number(serviceId)];

    if (branchId != null) {
      updateFragments.push("branch_id = ?");
      updateParams.push(Number(branchId));
    }

    updateFragments.push("starts_at = ?", "ends_at = ?");
    updateParams.push(newStart, newEnd, row.id, tenantId);

    await conn.query(
      `UPDATE appointment
          SET ${updateFragments.join(", ")}
        WHERE id = ? AND tenant_id = ?`,
      updateParams
    );
  }

  const [[seriesRow]] = await conn.query(
    `SELECT metadata
       FROM appointment_series
      WHERE id = ? AND tenant_id = ? FOR UPDATE`,
    [seriesId, tenantId]
  );

  let metadata = {};
  if (seriesRow?.metadata) {
    try {
      metadata = JSON.parse(seriesRow.metadata);
    } catch {
      metadata = {};
    }
  }

  metadata = {
    ...metadata,
    instructorId: Number(instructorId),
    serviceId: Number(serviceId),
    timeOfDay: { hour: baseNewStart.getHours(), minute: baseNewStart.getMinutes() },
    lastUpdateAt: new Date().toISOString(),
    lastUpdateScope: scope,
  };

  await conn.query(
    `UPDATE appointment_series
        SET metadata = ?, updated_at = NOW()
      WHERE id = ? AND tenant_id = ?`,
    [JSON.stringify(metadata), seriesId, tenantId]
  );

  await conn.query(
    `UPDATE appointment
        SET recurrence_rule = ?
      WHERE id = ? AND tenant_id = ?`,
    [JSON.stringify(metadata), baseAppointmentId, tenantId]
  );
}

/* -------- Utilidades -------- */
const UPCOMING_STATUSES = ["scheduled", "confirmed", "deposit_paid", "pending_deposit"];

// Si la usás fuera de rutas, pasá explícito tenantId en opts
export async function listUpcomingAppointmentsByPhone(phone_e164, { limit = 5, tenantId } = {}) {
  if (!phone_e164) return [];
  if (!tenantId) throw new Error("Tenant no identificado");

  const phone = String(phone_e164).replace(/\D/g, "");
  const params = [tenantId, phone, ...UPCOMING_STATUSES, Number(limit)];
  const placeholders = UPCOMING_STATUSES.map(() => "?").join(",");

  const [rows] = await pool.query(
    `
    SELECT a.id, a.starts_at, a.ends_at, a.status,
           s.name  AS service_name,
           st.name AS instructor_name
      FROM appointment a
      JOIN customer  c  ON c.id  = a.customer_id AND c.tenant_id = a.tenant_id
      JOIN service   s  ON s.id  = a.service_id  AND s.tenant_id = a.tenant_id
      JOIN instructor   st ON st.id = a.instructor_id AND st.tenant_id = a.tenant_id
     WHERE a.tenant_id = ?
       AND c.phone_e164 = ?
       AND a.status IN (${placeholders})
       AND a.starts_at >= NOW()
     ORDER BY a.starts_at ASC
     LIMIT ?
    `,
    params
  );

  return rows;
}

function withTimeout(promise, ms, label = "timeout") {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); })
      .catch((e) => { clearTimeout(t); reject(e); });
  });
}

async function scheduleDepositReminder({ tenantId, appointmentId }) {
  if (!sendWhatsAppText) return;

  try {
    const [[row]] = await pool.query(
      `
      SELECT 
        a.id,
        a.starts_at,
        a.status,
        s.name AS service_name,
        s.price_decimal,
        i.name AS instructor_name,
        c.phone_e164,
        c.name AS customer_name,
        c.exempt_deposit
      FROM appointment a
      JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
      JOIN instructor i ON i.id = a.instructor_id AND i.tenant_id = a.tenant_id
      JOIN customer c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
      WHERE a.id = ? AND a.tenant_id = ?
      LIMIT 1
      `,
      [appointmentId, tenantId]
    );

    if (!row?.phone_e164) return;

    // Verificar si el cliente está exento de seña
    if (row.exempt_deposit === 1 || row.exempt_deposit === true) {
      console.log(`ℹ️ [appointments] Cliente ${row.customer_name} está exento de seña, omitiendo recordatorio`);
      return;
    }

    const [[requireDepositRow]] = await pool.query(
      `SELECT config_value 
         FROM system_config 
        WHERE tenant_id = ? AND config_key = 'payments.require_deposit'
        LIMIT 1`,
      [tenantId]
    );

    const requireDeposit =
      requireDepositRow?.config_value === "1" || requireDepositRow?.config_value === "true";

    if (!requireDeposit) return;

    const [[modeRow]] = await pool.query(
      `SELECT config_value 
         FROM system_config 
        WHERE tenant_id = ? AND config_key = 'payments.deposit_mode'
        LIMIT 1`,
      [tenantId]
    );
    const depositMode = String(modeRow?.config_value || "percent").toLowerCase();

    let depositAmount = 0;
    if (depositMode === "fixed") {
      const [[fixedRow]] = await pool.query(
        `SELECT config_value 
           FROM system_config 
          WHERE tenant_id = ? AND config_key = 'payments.deposit_fixed'
          LIMIT 1`,
        [tenantId]
      );
      depositAmount = Number(fixedRow?.config_value || 0);
    } else {
      const [[pctRow]] = await pool.query(
        `SELECT config_value 
           FROM system_config 
          WHERE tenant_id = ? AND config_key = 'payments.deposit_percent'
          LIMIT 1`,
        [tenantId]
      );
      const pct = Number(pctRow?.config_value || 20);
      depositAmount = Math.round(Number(row.price_decimal || 0) * pct) / 100;
    }

    if (!Number.isFinite(depositAmount) || depositAmount <= 0) return;

    // Configurar hold_until con máximo 60 minutos
    const holdMinutesCfg = await cfgNumber("deposit.holdMinutes", 30, tenantId);
    const holdMinutes = Math.min(30, Math.max(1, Number(holdMinutesCfg || 30)));
    await pool.query(
      `UPDATE appointment
          SET deposit_decimal = ?, 
              status = CASE WHEN status = 'scheduled' THEN 'pending_deposit' ELSE status END,
              hold_until = DATE_ADD(NOW(), INTERVAL ? MINUTE)
        WHERE id = ? AND tenant_id = ?`,
      [depositAmount, holdMinutes, appointmentId, tenantId]
    );

    let payLink = null;
    try {
      payLink = await createDepositPaymentLink({
        tenantId,
        appointmentId,
        amount: depositAmount,
        title: `Seña - ${row.service_name || "Servicio"}`,
        holdMinutes: holdMinutes,
      });
    } catch (payErr) {
      console.error("⚠️ [appointments] No se pudo generar link de seña:", payErr?.message || payErr);
    }

    const startDate = new Date(row.starts_at);
    const fecha = startDate.toLocaleDateString("es-AR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    });
    const hora = startDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    const depositText = depositAmount.toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    });

    const msg = payLink
      ? `Hola ${row.customer_name || ""}! 👋\n\nPara confirmar tu turno de *${row.service_name || "servicio"}* con *${
          row.instructor_name || "nuestro equipo"
        }* el *${fecha} ${hora}* necesitamos una seña de *${depositText}*.\n\nPagá acá 👉 ${payLink}\n\nTu reserva queda retenida por ${holdMinutes} minutos. Una vez acreditado el pago, el turno queda confirmado automáticamente.`
      : `Hola ${row.customer_name || ""}! 👋\n\nPara confirmar tu turno de *${row.service_name || "servicio"}* con *${
          row.instructor_name || "nuestro equipo"
        }* el *${fecha} ${hora}* necesitamos una seña de *${depositText}*.\n\nContactanos por acá para coordinar el pago.`;

    try {
      await sendWhatsAppText(row.phone_e164, msg, tenantId);
      console.log(`✅ [appointments] Mensaje de texto enviado exitosamente a ${row.phone_e164}`);
    } catch (waError) {
      console.log(`⚠️ [appointments] Error al enviar mensaje a ${row.phone_e164}:`, waError.code, waError.message);
      // Si el error es 131047, significa que:
      // - Han pasado más de 24 horas desde la última respuesta del cliente, O
      // - El cliente nunca ha iniciado una conversación (primera vez)
      // En ambos casos, usamos el template aprobado para iniciar/reabrir la conversación
      if (waError.code === 131047 && sendWhatsAppTemplate && payLink) {
        console.log(`ℹ️ [appointments] Error 131047 detectado. sendWhatsAppTemplate=${!!sendWhatsAppTemplate}, payLink=${!!payLink}`);
        console.log(`ℹ️ [appointments] Ventana de 24 horas cerrada. Usando template "confirmacion_turno" para iniciar la conversación...`);
        // Intentar con diferentes códigos de idioma
        const languageCodes = ["es", "es_AR", "es_419", "es_MX", "es_ES"];
        let templateSent = false;
        let templateError = null;
        
        for (const lang of languageCodes) {
          try {
            await sendWhatsAppTemplate(
              row.phone_e164,
              "confirmacion_turno",
              lang,
              [
                {
                  type: "body",
                  parameters: [
                    { type: "text", text: row.customer_name || "Cliente" },
                    { type: "text", text: row.service_name || "Servicio" },
                    { type: "text", text: row.instructor_name || "Nuestro equipo" },
                    { type: "text", text: fecha },
                    { type: "text", text: hora },
                    { type: "text", text: depositText },
                    { type: "text", text: payLink },
                    { type: "text", text: String(holdMinutes) }
                  ]
                }
              ],
              tenantId
            );
            console.log(`✅ [appointments] Template "confirmacion_turno" enviado exitosamente a ${row.phone_e164} (idioma: ${lang})`);
            templateSent = true;
            return;
          } catch (error) {
            console.debug(`[appointments] Template "confirmacion_turno" con idioma "${lang}" no disponible:`, error.message);
            templateError = error;
            continue;
          }
        }
        
        // Si ningún idioma funcionó, usar fallback
        if (!templateSent) {
          // Si el template no existe (error 132001), usar fallback a mensaje de texto
          if (templateError && templateError.code === 132001) {
            console.warn(`⚠️ [appointments] Template "confirmacion_turno" no existe. Usando fallback a mensaje de texto...`);
            const [[tenant]] = await pool.query(
              "SELECT name FROM tenant WHERE id = ? LIMIT 1",
              [tenantId]
            ).catch(() => [[null]]);
            const tenantName = tenant?.name || "ARJA ERP";
            
            const fallbackMessage = 
              `¡Hola ${row.customer_name || ""}! 👋\n` +
              `✅ Confirmamos tu turno:\n` +
              `• Servicio: *${row.service_name || "Servicio"}*\n` +
              `• Profesional: *${row.instructor_name || "Nuestro equipo"}*\n` +
              `• Fecha: *${fecha} ${hora}*\n` +
              `• Seña: *${depositText}*\n` +
              `\n🔗 Link de pago: ${payLink}\n` +
              `⏰ Tienes ${holdMinutes} minutos para completar el pago.\n\n` +
              `Si necesitás reprogramar, escribinos a ${tenantName} por acá.`;
            
            try {
              await sendWhatsAppText(row.phone_e164, fallbackMessage, tenantId);
              console.log(`✅ [appointments] Mensaje de texto de fallback enviado exitosamente a ${row.phone_e164}`);
              return;
            } catch (textError) {
              console.error(`❌ [appointments] Error enviando mensaje de texto de fallback:`, textError.message || textError);
              return;
            }
          } else {
            console.error(`⚠️ [appointments] Error enviando template "confirmacion_turno":`, templateError.message || templateError);
            console.log(`ℹ️ [appointments] El template puede no estar aprobado aún o hay un error. El turno se creó correctamente.`);
            return;
          }
        }
      }
      
      if (waError.code === 131047) {
        console.log(`ℹ️ [appointments] No se pudo enviar recordatorio de seña a ${row.phone_e164}:`);
        console.log(`   - El cliente debe iniciar la conversación primero enviando un mensaje a tu número de WhatsApp Business`);
        console.log(`   - El turno se creó correctamente, pero el mensaje no se pudo enviar`);
        return;
      }
      if (waError.code === 133010) {
        console.log(`ℹ️ [appointments] No se pudo enviar recordatorio de seña a ${row.phone_e164}: cuenta en modo Sandbox.`);
        console.log(`   - El número ${row.phone_e164} debe estar en la lista de números de prueba en Meta Business Manager`);
        return;
      }
      // Para otros errores, solo loguear pero no relanzar para no interrumpir el flujo
      console.error(`⚠️ [appointments] Error enviando recordatorio de seña a ${row.phone_e164}:`, waError.message || waError);
    }
  } catch (error) {
    console.error("⚠️ [appointments] Recordatorio de seña falló:", error?.message || error);
  }
}
