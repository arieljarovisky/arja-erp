import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TrendingUp, CalendarCheck, Coins, PiggyBank, Download,
  Calendar, Loader2, AlertTriangle, Save, RotateCw, Clock, X, Trash2
} from "lucide-react";
import { apiClient } from "../../api/client";
import { toast } from "sonner";
import { logger } from "../../utils/logger.js";
// Chart.js
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Title,
  Tooltip as ChartTooltip,
  Legend
} from 'chart.js';
import { Line } from 'react-chartjs-2';

// Registrar componentes de Chart.js
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Title,
  ChartTooltip,
  Legend
);

/* ===== helpers ===== */
const money = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 })
    .format(Number(n || 0));

const csv = (rows) =>
  [Object.keys(rows[0] || {}).join(","), ...rows.map(r => Object.values(r).map(v =>
    String(v ?? "").replace(/"/g, '""')
  ).map(v => /[",\n]/.test(v) ? `"${v}"` : v).join(","))].join("\n");

const KPI = ({ icon: Icon, label, value, sublabel }) => (
  <div className="card card--space-lg group hover:shadow-lg transition-all">
    <div className="flex items-center gap-3 mb-3">
      <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div className="text-sm font-medium text-foreground-secondary">{label}</div>
    </div>
    <div className="text-2xl font-semibold text-foreground tracking-tight">{value}</div>
    {sublabel ? <div className="mt-1 text-xs text-foreground-muted">{sublabel}</div> : null}
  </div>
);

const Btn = ({ children, className = "", ...props }) => (
  <button
    {...props}
    className={`inline-flex items-center gap-2 rounded-xl border border-border bg-background-secondary px-3.5 py-2 text-sm font-medium text-foreground hover:bg-border active:scale-[.99] transition ${className}`}
  >
    {children}
  </button>
);

/* ===== Editor horarios / francos ===== */
function WorkingHoursEditor({ instructorId }) {
  // Cambiar estructura: cada día tiene un array de horarios (uno por sucursal)
  const [rows, setRows] = useState(() => 
    Array.from({ length: 7 }, (_, d) => ({
      weekday: d,
      schedules: [] // Array de { branch_id, start_time, end_time }
    }))
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [blocks, setBlocks] = useState([]); // bloqueos de tiempo
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [singleBranchId, setSingleBranchId] = useState(null);
  const week = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  const loadBranches = useCallback(async () => {
    try {
      setBranchesLoading(true);
      const branchesList = await apiClient.listActiveBranches();
      // Asegurar que sea un array
      const branchesArray = Array.isArray(branchesList) 
        ? branchesList 
        : (branchesList?.data && Array.isArray(branchesList.data))
        ? branchesList.data
        : [];
      setBranches(branchesArray);
      setSingleBranchId(branchesArray.length === 1 ? Number(branchesArray[0]?.id) : null);
    } catch (e) {
      logger.error("Error cargando sucursales:", e);
      toast.error("Error al cargar sucursales");
      setBranches([]);
    } finally {
      setBranchesLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    if (!instructorId) return;
    setErr("");
    try {
      logger.log(`[loadWorkingHours] Cargando horarios para instructor ${instructorId}`);
      const server = await apiClient.getWorkingHours({ instructorId });
      logger.log(`[loadWorkingHours] Respuesta del servidor:`, server);
      
      // Agrupar por weekday, cada día puede tener múltiples horarios (uno por sucursal)
      const byWeekday = new Map();
      (server || []).forEach(x => {
        const wd = Number(x.weekday);
        if (!byWeekday.has(wd)) {
          byWeekday.set(wd, []);
        }
        if (x.start_time && x.end_time) {
          const schedule = {
            branch_id: x.branch_id !== undefined && x.branch_id !== null ? Number(x.branch_id) : null,
            start_time: x.start_time?.slice(0, 5) || null,
            end_time: x.end_time?.slice(0, 5) || null,
          };
          logger.log(`[loadWorkingHours] Agregando horario para día ${wd}:`, schedule);
          byWeekday.get(wd).push(schedule);
        }
      });
      
      const full = Array.from({ length: 7 }, (_, d) => ({
        weekday: d,
        schedules: byWeekday.get(d) || [],
      }));
      
      logger.log(`[loadWorkingHours] Horarios agrupados por día:`, full);
      logger.log(`[loadWorkingHours] Total de días con horarios:`, full.filter(d => d.schedules.length > 0).length);
      
      setRows(full);
    } catch (e) {
      setErr("No pude cargar horarios.");
      logger.error("[loadWorkingHours] Error:", e);
    }
  }, [instructorId]);

  const loadBlocks = useCallback(async () => {
    if (!instructorId) return;
    try {
      const today = new Date();
      const futureDate = new Date();
      futureDate.setDate(today.getDate() + 90); // próximos 90 días
      
      const res = await apiClient.listDaysOff({
        instructorId,
        from: today.toISOString().split('T')[0],
        to: futureDate.toISOString().split('T')[0],
      });
      setBlocks(res?.data || []);
    } catch (e) {
      logger.error("Error cargando bloqueos:", e);
    }
  }, [instructorId]);

  useEffect(() => { 
    loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    if (singleBranchId == null) return;
    setRows(rs => rs.map(day => ({
      ...day,
      schedules: day.schedules.map(s => ({
        ...s,
        branch_id: s.branch_id == null ? singleBranchId : s.branch_id
      }))
    })));
  }, [singleBranchId]);

  useEffect(() => { 
    load();
    loadBlocks();
  }, [load, loadBlocks]);

  const addSchedule = (dayIdx) => {
    setRows(rs => rs.map((r, i) => {
      if (i === dayIdx) {
        return {
          ...r,
          schedules: [...r.schedules, { branch_id: singleBranchId ?? null, start_time: "10:00:00", end_time: "19:00:00" }]
        };
      }
      return r;
    }));
  };

  const removeSchedule = (dayIdx, scheduleIdx) => {
    setRows(rs => rs.map((r, i) => {
      if (i === dayIdx) {
        return {
          ...r,
          schedules: r.schedules.filter((_, idx) => idx !== scheduleIdx)
        };
      }
      return r;
    }));
  };

  const updateSchedule = (dayIdx, scheduleIdx, patch) => {
    setRows(rs => rs.map((r, i) => {
      if (i === dayIdx) {
        if (patch && patch.clear) {
          return { ...r, schedules: [] };
        } else {
          return {
            ...r,
            schedules: r.schedules.map((s, idx) => 
              idx === scheduleIdx ? { ...s, ...patch } : s
            )
          };
        }
      }
      return r;
    }));
  };

  const save = async () => {
    if (!instructorId) return;
    setSaving(true);
    setErr("");
    try {
      // Convertir la estructura de schedules a un array plano de hours
      const hours = [];
      rows.forEach(day => {
        if (day.schedules.length === 0) {
          // Si no hay horarios, no agregar nada (no guardar francos explícitamente)
          // Los francos se manejan eliminando los registros existentes
        } else {
          // Agregar un registro por cada horario/sucursal
          day.schedules.forEach(schedule => {
            const st = schedule.start_time?.trim?.() || null;
            const et = schedule.end_time?.trim?.() || null;
            if (st && et) {
              // Asegurar que branch_id sea un número o null explícitamente
              // Usar !== null && !== undefined && !== '' para preservar el 0 si existe
              const branchId = (schedule.branch_id !== null && schedule.branch_id !== undefined && schedule.branch_id !== '') 
                ? Number(schedule.branch_id) 
                : null;
              
              hours.push({
                weekday: day.weekday,
                start_time: st.length === 5 ? `${st}:00` : st,
                end_time: et.length === 5 ? `${et}:00` : et,
                branch_id: branchId,
              });
              
              logger.log(`[saveWorkingHours] Agregando horario: weekday=${day.weekday}, branch_id=${branchId}, start=${st}, end=${et}`);
            }
          });
        }
      });
      
      // Validar que no haya horarios solapados
      const validateOverlaps = (hours) => {
        // Convertir tiempo a minutos para facilitar comparación
        const timeToMinutes = (timeStr) => {
          if (!timeStr) return null;
          const [hours, minutes] = timeStr.split(':').map(Number);
          return hours * 60 + minutes;
        };

        // Agrupar por día
        const byDay = {};
        hours.forEach(h => {
          if (!byDay[h.weekday]) {
            byDay[h.weekday] = [];
          }
          byDay[h.weekday].push(h);
        });

        // Verificar solapamientos por día (solo dentro de la misma sucursal)
        const overlaps = [];
        Object.entries(byDay).forEach(([weekday, dayHours]) => {
          for (let i = 0; i < dayHours.length; i++) {
            for (let j = i + 1; j < dayHours.length; j++) {
              const h1 = dayHours[i];
              const h2 = dayHours[j];
              
              // Comparar solo si pertenecen a la misma sucursal (incluye null==null)
              const b1 = h1.branch_id == null ? null : Number(h1.branch_id);
              const b2 = h2.branch_id == null ? null : Number(h2.branch_id);
              if (b1 !== b2) continue;
              
              const start1 = timeToMinutes(h1.start_time);
              const end1 = timeToMinutes(h1.end_time);
              const start2 = timeToMinutes(h2.start_time);
              const end2 = timeToMinutes(h2.end_time);

              // Verificar si se solapan: (start1 < end2 && end1 > start2)
              if (start1 !== null && end1 !== null && start2 !== null && end2 !== null) {
                if (start1 < end2 && end1 > start2) {
                  const branch1 = h1.branch_id ? `Sucursal ${h1.branch_id}` : 'Sin sucursal';
                  const branch2 = h2.branch_id ? `Sucursal ${h2.branch_id}` : 'Sin sucursal';
                  overlaps.push({
                    weekday: Number(weekday),
                    schedule1: { branch: branch1, time: `${h1.start_time.slice(0, 5)} - ${h1.end_time.slice(0, 5)}` },
                    schedule2: { branch: branch2, time: `${h2.start_time.slice(0, 5)} - ${h2.end_time.slice(0, 5)}` }
                  });
                }
              }
            }
          }
        });

        return overlaps;
      };

      const overlaps = validateOverlaps(hours);
      if (overlaps.length > 0) {
        const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const overlapMessages = overlaps.map(ov => {
          const dayName = dayNames[ov.weekday];
          return `${dayName}: ${ov.schedule1.branch} (${ov.schedule1.time}) se solapa con ${ov.schedule2.branch} (${ov.schedule2.time})`;
        });
        
        const errorMsg = `No se pueden guardar horarios que se solapen:\n${overlapMessages.join('\n')}`;
        logger.error(`[saveWorkingHours] ❌ Horarios solapados detectados:`, overlaps);
        toast.error("Horarios solapados", {
          description: overlapMessages.join('; '),
          duration: 8000
        });
        setErr(errorMsg);
        setSaving(false);
        return;
      }
      
      logger.log(`[saveWorkingHours] ==========================================`);
      logger.log(`[saveWorkingHours] RESUMEN ANTES DE ENVIAR:`);
      logger.log(`[saveWorkingHours] Instructor ID: ${instructorId}`);
      logger.log(`[saveWorkingHours] Total de horarios a guardar: ${hours.length}`);
      logger.log(`[saveWorkingHours] Detalle de horarios:`, JSON.stringify(hours, null, 2));
      
      // Agrupar por día para verificar duplicados
      const byDay = {};
      hours.forEach(h => {
        const dayKey = `${h.weekday}-${h.branch_id || 'null'}`;
        if (!byDay[dayKey]) {
          byDay[dayKey] = [];
        }
        byDay[dayKey].push(h);
      });
      
      const duplicates = Object.entries(byDay).filter(([_, items]) => items.length > 1);
      if (duplicates.length > 0) {
        logger.warn(`[saveWorkingHours] ⚠️ ADVERTENCIA: Se detectaron claves duplicadas:`, duplicates);
      }
      
      logger.log(`[saveWorkingHours] Horarios agrupados por día/sucursal:`, byDay);
      logger.log(`[saveWorkingHours] ==========================================`);

      await apiClient.saveWorkingHours({ instructorId, hours });
      toast.success("Horarios guardados correctamente");
      load(); // Recargar para ver los cambios
    } catch (e) {
      const errorData = e?.response?.data || {};
      let errorMessage = errorData.error || e.message || "No se pudieron guardar los horarios.";
      
      // Mejorar mensajes de error específicos
      if (errorData.code === 'ERR_OVERLAPPING_SCHEDULES') {
        // Error de horarios solapados desde el backend
        const details = errorData.details || [];
        errorMessage = "Horarios solapados detectados";
        toast.error(errorMessage, {
          description: details.join('; '),
          duration: 8000
        });
        setErr(details.join('\n'));
      } else if (errorData.code === 'ER_DUP_ENTRY') {
        if (errorMessage.includes('uq_wh')) {
          errorMessage = "Ya existe un horario para este día. Si querés agregar múltiples sucursales, ejecutá la migración 054 en la base de datos para actualizar las restricciones.";
        } else {
          errorMessage = "Ya existe un horario para esta combinación de día y sucursal. Verificá que no estés duplicando horarios.";
        }
        setErr(errorMessage);
        toast.error(errorMessage, {
          description: errorData.code ? `Código de error: ${errorData.code}` : undefined,
          duration: 5000,
        });
      } else if (errorData.code === 'ER_BAD_FIELD_ERROR') {
        errorMessage = "Error en la estructura de la base de datos. Verificá que las migraciones 053 y 054 estén ejecutadas.";
        setErr(errorMessage);
        toast.error(errorMessage, {
          description: errorData.code ? `Código de error: ${errorData.code}` : undefined,
          duration: 5000,
        });
      } else if (errorMessage.includes('migración')) {
        // Ya tiene un mensaje útil sobre migraciones
        setErr(errorMessage);
        toast.error(errorMessage, {
          description: errorData.code ? `Código de error: ${errorData.code}` : undefined,
          duration: 5000,
        });
      } else if (!errorMessage || errorMessage === "No se pudieron guardar los horarios.") {
        errorMessage = "No se pudieron guardar los horarios. Verificá que todos los campos estén completos y que no haya duplicados.";
        setErr(errorMessage);
        toast.error(errorMessage, {
          description: errorData.code ? `Código de error: ${errorData.code}` : undefined,
          duration: 5000,
        });
      } else {
        setErr(errorMessage);
        toast.error(errorMessage, {
          description: errorData.code ? `Código de error: ${errorData.code}` : undefined,
          duration: 5000,
        });
      }
      logger.error("[saveWorkingHours]", e);
    } finally {
      setSaving(false);
    }
  };

  const deleteBlock = async (blockId) => {
    if (!confirm("¿Eliminar este bloqueo?")) return;
    try {
      await apiClient.deleteDayOff(blockId);
      toast.success("Bloqueo eliminado");
      loadBlocks();
    } catch (e) {
      toast.error("Error al eliminar bloqueo");
      logger.error(e);
    }
  };

  if (!instructorId) return null;

  return (
    <div className="mt-10 space-y-6">
      {/* Horarios semanales */}
      <div className="card card--space-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Horarios semanales</h3>
          <div className="flex items-center gap-2">
            <Btn onClick={load}><RotateCw className="size-4" /> Recargar</Btn>
            <button
              onClick={save}
              className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
              disabled={saving}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Guardar
            </button>
          </div>
        </div>
        {err && (
          <div className="mb-3 text-sm rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {err}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((day, dayIdx) => {
            const hasSchedules = day.schedules.length > 0;
            return (
              <div key={dayIdx} className={`rounded-xl border px-4 py-3 ${hasSchedules ? "border-border bg-background-secondary" : "border-border bg-background-secondary/50"}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-foreground">{week[day.weekday]}</span>
                  <div className="flex items-center gap-2">
                    {hasSchedules && (
                      <button
                        onClick={() => addSchedule(dayIdx)}
                        className="text-xs rounded-lg px-2 py-1 border border-primary/30 bg-primary/10 text-primary font-medium hover:bg-primary/20"
                        title={singleBranchId != null ? "Agregar horario" : "Agregar otra sucursal"}
                      >
                        {singleBranchId != null ? "+ Horario" : "+ Sucursal"}
                      </button>
                    )}
                    {hasSchedules && (
                      <button
                        onClick={() => updateSchedule(dayIdx, -1, { clear: true })}
                        className="text-xs rounded-lg px-2 py-1 border border-red-400/30 bg-red-500/10 text-red-400 font-medium hover:bg-red-500/20"
                        title="Marcar día como franco"
                      >
                        Franco
                      </button>
                    )}
                    {!hasSchedules && (
                      <button
                        onClick={() => addSchedule(dayIdx)}
                        className="text-xs rounded-lg px-2 py-1 border border-primary/30 bg-primary/10 text-primary font-medium"
                      >
                        Trabaja
                      </button>
                    )}
                  </div>
                </div>
                
                {hasSchedules ? (
                  <div className="space-y-3">
                    {day.schedules.map((schedule, scheduleIdx) => (
                      <div key={scheduleIdx} className="p-3 rounded-lg border border-border/60 bg-background/50 space-y-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-foreground-secondary">
                            Horario {scheduleIdx + 1}
                          </span>
                          {day.schedules.length > 1 && (
                            <button
                              onClick={() => removeSchedule(dayIdx, scheduleIdx)}
                              className="text-xs text-red-400 hover:text-red-300"
                              title="Eliminar este horario"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-foreground-muted mb-1 block">Sucursal</label>
                          {singleBranchId != null ? (
                            <div className="input w-full text-sm bg-background-secondary border border-border">
                              {branches.find(b => Number(b.id) === Number(singleBranchId))?.name || `Sucursal #${singleBranchId}`}
                            </div>
                          ) : (
                            <select
                              value={schedule.branch_id != null ? String(schedule.branch_id) : ""}
                              onChange={(e) => updateSchedule(dayIdx, scheduleIdx, { branch_id: e.target.value ? Number(e.target.value) : null })}
                              className="input w-full text-sm"
                              disabled={branchesLoading || !Array.isArray(branches) || branches.length === 0}
                            >
                              <option value="">Seleccionar sucursal</option>
                              {Array.isArray(branches) && branches.map((branch) => (
                                <option key={branch.id} value={String(branch.id)}>
                                  {branch.name}
                                </option>
                              ))}
                              {schedule.branch_id != null && Array.isArray(branches) && !branches.some(b => String(b.id) === String(schedule.branch_id)) && (
                                <option value={String(schedule.branch_id)}>
                                  Sucursal #{schedule.branch_id}
                                </option>
                              )}
                            </select>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <label className="text-xs text-foreground-muted mb-1 block">Desde</label>
                            <input
                              type="time"
                              value={(schedule.start_time || "").slice(0, 5)}
                              onChange={(e) => updateSchedule(dayIdx, scheduleIdx, { start_time: `${e.target.value}:00` })}
                              className="input w-full text-sm"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-xs text-foreground-muted mb-1 block">Hasta</label>
                            <input
                              type="time"
                              value={(schedule.end_time || "").slice(0, 5)}
                              onChange={(e) => updateSchedule(dayIdx, scheduleIdx, { end_time: `${e.target.value}:00` })}
                              className="input w-full text-sm"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => addSchedule(dayIdx)}
                      className="w-full text-xs text-center py-2 rounded-lg border border-dashed border-border text-foreground-secondary hover:text-foreground hover:border-primary/50 transition-colors"
                    >
                      {singleBranchId != null ? "+ Agregar horario" : "+ Agregar otra sucursal"}
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-2">
                    <span className="text-xs text-foreground-muted italic">Franco</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bloqueos de tiempo */}
      <TimeBlocksSection
        instructorId={instructorId}
        blocks={blocks}
        onRefresh={loadBlocks}
        onDelete={deleteBlock}
      />
    </div>
  );
}

/* ===== Sección de bloqueos de tiempo ===== */
function TimeBlocksSection({ instructorId, blocks, onRefresh, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    date: "",
    startTime: "",
    endTime: "",
    reason: "",
    repeatDaily: false,
    repeatUntil: "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.startTime || !formData.endTime || (!formData.repeatDaily && !formData.date)) {
      toast.error("Completá todos los campos obligatorios");
      return;
    }

    // Validar que la hora de fin sea posterior a la de inicio
    if (formData.endTime <= formData.startTime) {
      toast.error("La hora de fin debe ser posterior a la de inicio");
      return;
    }

    setSaving(true);
    try {
      if (formData.repeatDaily) {
        await apiClient.createRecurringDaysOff({
          instructorId,
          startTime: formData.startTime,
          endTime: formData.endTime,
          reason: formData.reason || "Bloqueo de tiempo",
        });
      } else {
        const starts_at = `${formData.date}T${formData.startTime}:00`;
        const ends_at = `${formData.date}T${formData.endTime}:00`;
        await apiClient.createDayOff({
          instructorId,
          starts_at,
          ends_at,
          reason: formData.reason || "Bloqueo de tiempo",
        });
      }

      toast.success("Bloqueo creado correctamente");
      setFormData({ date: "", startTime: "", endTime: "", reason: "", repeatDaily: false, repeatUntil: "" });
      setShowForm(false);
      onRefresh();
    } catch (e) {
      toast.error(e?.response?.data?.error || "Error al crear bloqueo");
      logger.error(e);
    } finally {
      setSaving(false);
    }
  };

  // Filtrar solo futuros y ordenar
  const futureBlocks = blocks
    .filter(b => new Date(b.starts_at) > new Date())
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

  return (
    <div className="card card--space-lg">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Bloqueos de tiempo</h3>
          <p className="text-sm text-foreground-secondary mt-1">
            Bloqueá horarios específicos (ej: trámites, descansos, almuerzo)
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
        >
          {showForm ? <X className="w-4 h-4" /> : <>+ Nuevo bloqueo</>}
        </button>
      </div>

      {/* Formulario */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-4 rounded-xl bg-background-secondary border border-border">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!formData.repeatDaily && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Fecha *
                </label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  min={new Date().toISOString().split('T')[0]}
                  className="input w-full text-sm"
                  required
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Desde *
                </label>
                <input
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  className="input w-full text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Hasta *
                </label>
                <input
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  className="input w-full text-sm"
                  required
                />
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-foreground mb-2">
                Motivo (opcional)
              </label>
              <input
                type="text"
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder="Ej: Trámite en el banco, Almuerzo"
                className="input w-full text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-foreground mb-2">
                Repetir
              </label>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={formData.repeatDaily}
                    onChange={(e) => setFormData({ ...formData, repeatDaily: e.target.checked })}
                  />
                  Todos los días
                </label>
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Crear bloqueo
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg bg-background-secondary hover:bg-border border border-border text-sm text-foreground"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Lista de bloqueos */}
      <div className="space-y-2">
        {futureBlocks.length === 0 ? (
          <div className="text-center py-8 text-foreground-secondary text-sm">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No hay bloqueos programados</p>
            <p className="text-xs text-foreground-muted mt-1">
              Creá un bloqueo para reservar tiempo específico
            </p>
          </div>
        ) : (
          futureBlocks.map((block) => (
            <BlockItem key={block.id} block={block} onDelete={onDelete} />
          ))
        )}
      </div>
    </div>
  );
}

/* ===== Item de bloqueo individual ===== */
function BlockItem({ block, onDelete }) {
  const startDate = new Date(block.starts_at);
  const endDate = new Date(block.ends_at);
  
  const formatDate = (date) => {
    return date.toLocaleDateString("es-AR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isToday = startDate.toDateString() === new Date().toDateString();
  const isPast = startDate < new Date();

  return (
    <div className={`flex items-center justify-between p-3 rounded-lg bg-background-secondary border border-border hover:bg-border transition-colors ${isPast ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${
          isToday 
            ? "bg-amber-500/20 border border-amber-500/30" 
            : "bg-primary/20 border border-primary/30"
        }`}>
          <Clock className={`w-4 h-4 ${isToday ? "text-amber-400" : "text-primary"}`} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{formatDate(startDate)}</span>
            {isToday && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Hoy
              </span>
            )}
            {isPast && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-background-secondary text-foreground-muted border border-border">
                Pasado
              </span>
            )}
          </div>
          <div className="text-xs text-foreground-secondary flex items-center gap-2 mt-1">
            <span>{formatTime(startDate)} - {formatTime(endDate)}</span>
            {block.reason && (
              <>
                <span>•</span>
                <span className="text-foreground-muted">{block.reason}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <button
        onClick={() => onDelete(block.id)}
        className="p-2 rounded-lg hover:bg-red-500/10 text-foreground-secondary hover:text-red-400 transition-colors"
        title="Eliminar bloqueo"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

/* ===== Página principal ===== */
export default function InstructorStatsPage() {
  const [instructors, setInstructors] = useState([]);
  const [selected, setSelected] = useState("");
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  // ✅ useRef para mantener la función actualizada sin causar re-renders
  const loadStatsRef = useRef();

  loadStatsRef.current = async () => {
    if (!selected) return;
    setLoading(true);
    setErr("");
    try {
       const data = await apiClient.getInstructorStatsRange({ instructorId: selected, from, to });
      setStats({
        totalReservas: data.total_reservas ?? data.total_cortes ?? 0,
        monto_total: data.monto_total ?? 0,
        porcentaje: data.porcentaje ?? data.percentage ?? null,
        comision_ganada: data.comision_ganada ?? data.comision ?? 0,
        neto_local: data.neto_local ?? 0,
        daily: data.daily || null,
        services: data.services || null,
        turnos: data.turnos || null,
      });
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || "No pude traer las estadísticas.");
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  // ✅ Un solo useEffect con debounce para evitar doble refresh
  useEffect(() => {
    if (!selected) return;

    const timer = setTimeout(() => {
      loadStatsRef.current();
    }, 350);

    return () => clearTimeout(timer);
  }, [selected, from, to]);

  // Cargar instructores al inicio
  useEffect(() => {
    (async () => {
      try {
        let list = await apiClient.getCommissions();
        if (!Array.isArray(list) || !list.length) {
          const s = await apiClient.getInstructors();
          list = (s || []).map(x => ({
            id: x.id,
            name: x.name,
            percentage: x.percentage ?? x.commission ?? null
          }));
        }
        setInstructors(list);
        if (list?.length) setSelected(String(list[0].id));
      } catch (e) {
        setErr("No pude traer la lista de instructores.");
        logger.error(e);
      }
    })();
  }, []);

  const instructor = instructors.find(s => String(s.id) === String(selected));
  const percent = useMemo(() => (stats?.porcentaje ?? instructor?.percentage ?? 0), [stats, instructor]);

  const dailySeries = useMemo(() => {
    if (!stats) return [];
    if (Array.isArray(stats.daily) && stats.daily.length) return stats.daily;
    if (Array.isArray(stats.turnos) && stats.turnos.length) {
      const map = new Map();
      for (const t of stats.turnos) {
        const d = String((t.starts_at || t.date || "").slice(0, 10));
        if (!d) continue;
        const m = map.get(d) || { date: d, amount: 0, reservas: 0 };
        m.amount += Number(t.price_decimal ?? t.amount ?? 0);
        m.reservas += 1;
        map.set(d, m);
      }
      return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
    return [];
  }, [stats]);

  const serviceRows = useMemo(() => {
    if (!stats) return [];
    if (Array.isArray(stats.services) && stats.services.length) return stats.services;
    if (Array.isArray(stats.turnos)) {
      const map = new Map();
      for (const t of stats.turnos) {
        const key = t.service_name ?? `Servicio ${t.service_id}`;
        const row = map.get(key) || { service: key, count: 0, amount: 0 };
        row.count += 1;
        row.amount += Number(t.price_decimal ?? 0);
        map.set(key, row);
      }
      return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
    }
    return [];
  }, [stats]);

  const doExport = async () => {
    try {
      let rows = stats?.turnos;
      if (!rows) rows = await apiClient.getInstructorTurns(selected, { from, to });
      if (!Array.isArray(rows) || !rows.length) return;
      const mapped = rows.map(t => ({
        fecha: (t.starts_at || "").replace("T", " ").slice(0, 16),
        servicio: t.service_name,
        precio: Number(t.price_decimal ?? 0),
        estado: t.status,
        cliente: t.customer_name ?? "",
        instructor: t.instructor_name ?? "",
      }));
      const blob = new Blob([csv(mapped)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `turnos_${selected}_${from}_a_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      logger.error(e);
      alert("No pude exportar.");
    }
  };

  const Empty = () => (
    <div className="mt-8 card card--space-lg text-center">
      <p className="text-foreground-secondary">No hay datos para el rango seleccionado.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">Estadísticas por Instructor</h1>
            <p className="text-foreground-secondary mt-1">Clases, facturación, comisión y configuración de horarios.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Selector instructor */}
            <div className="relative">
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="input appearance-none pr-8 text-sm"
              >
                {instructors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.percentage != null ? `(${s.percentage}% comisión)` : ""}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-foreground-muted">▾</div>
            </div>

            {/* Rango fechas */}
            <div className="flex items-center gap-2 rounded-xl bg-background-secondary border border-border p-1">
              <Calendar className="w-4 h-4 mx-1 text-foreground-muted" />
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-transparent text-sm outline-none px-1 text-foreground" />
              <span className="text-foreground-muted">–</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-transparent text-sm outline-none px-1 text-foreground" />
            </div>

            {/* Presets */}
            <Btn onClick={() => { 
              const d = new Date(); 
              const f = new Date(); 
              f.setDate(d.getDate() - 6); 
              setFrom(f.toISOString().slice(0, 10)); 
              setTo(d.toISOString().slice(0, 10)); 
            }}>7d</Btn>
            
            <Btn onClick={() => { 
              const d = new Date(); 
              const f = new Date(); 
              f.setDate(d.getDate() - 29); 
              setFrom(f.toISOString().slice(0, 10)); 
              setTo(d.toISOString().slice(0, 10)); 
            }}>30d</Btn>

            {/* Export */}
            <Btn onClick={doExport}><Download className="size-4" /> Exportar CSV</Btn>
          </div>
        </div>

        {/* Error visible */}
        {err ? (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            <AlertTriangle className="w-4 h-4" />
            <span>{err}</span>
          </div>
        ) : null}

        {/* KPIs + contenido */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-[108px] animate-pulse rounded-2xl bg-background-secondary border border-border" />
            ))}
          </div>
        ) : stats ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <KPI icon={CalendarCheck} label="Reservas" value={stats?.totalReservas ?? 0} sublabel="Eventos facturables" />
              <KPI icon={Coins} label="Monto total" value={money(stats?.monto_total ?? 0)} />
              <KPI icon={TrendingUp} label={`Comisión (${percent}%)`} value={money(stats?.comision_ganada ?? 0)} />
              <KPI icon={PiggyBank} label="Neto para el local" value={money(stats?.neto_local ?? 0)} />
            </div>

            {/* Gráfico diario */}
            <div className="mt-8 card card--space-lg">
              <div className="mb-3 text-sm font-medium text-foreground-secondary">Evolución diaria</div>
              {dailySeries.length ? (
                <div className="h-64">
                  <Line
                    data={{
                      labels: dailySeries.map(d => {
                        const date = new Date(d.date);
                        return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
                      }),
                      datasets: [
                        {
                          label: 'Monto',
                          data: dailySeries.map(d => d.amount),
                          borderColor: '#8884d8',
                          backgroundColor: 'rgba(136, 132, 216, 0.25)',
                          fill: true,
                          tension: 0.4,
                          pointRadius: 3,
                          pointHoverRadius: 5,
                        }
                      ]
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          display: false
                        },
                        tooltip: {
                          backgroundColor: '#27272a',
                          borderColor: '#3f3f46',
                          borderWidth: 1,
                          borderRadius: 12,
                          padding: 12,
                          titleColor: '#fafafa',
                          bodyColor: '#fafafa',
                          callbacks: {
                            label: function(context) {
                              return `Monto: ${money(context.parsed.y)}`;
                            }
                          }
                        }
                      },
                      scales: {
                        x: {
                          ticks: {
                            color: '#a1a1aa',
                            font: {
                              size: 12
                            }
                          },
                          grid: {
                            color: 'rgba(63, 63, 70, 0.1)'
                          }
                        },
                        y: {
                          ticks: {
                            color: '#a1a1aa',
                            font: {
                              size: 12
                            },
                            callback: function(value) {
                              return money(value);
                            }
                          },
                          grid: {
                            color: 'rgba(63, 63, 70, 0.1)'
                          }
                        }
                      }
                    }}
                  />
                </div>
              ) : (
                <Empty />
              )}
            </div>

            {/* Tabla por servicio */}
            <div className="mt-8 card card--space-lg">
              <div className="mb-3 text-sm font-medium text-foreground-secondary">Servicios</div>
              {serviceRows.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-foreground-secondary">
                      <tr>
                        <th className="text-left py-2 pr-4 font-medium">Servicio</th>
                        <th className="text-right py-2 pr-4 font-medium">Reservas</th>
                        <th className="text-right py-2 font-medium">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serviceRows.map((r, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="py-2 pr-4 text-foreground">{r.service ?? r.name}</td>
                          <td className="py-2 pr-4 text-right text-foreground">{r.count ?? r.cortes ?? 0}</td>
                          <td className="py-2 text-right text-foreground">{money(r.amount ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty />
              )}
            </div>

            {/* Editor de horarios / francos / bloqueos */}
            <WorkingHoursEditor instructorId={selected} />
          </>
        ) : (
          <Empty />
        )}

        {/* Pie */}
        <div className="mt-10 flex items-center gap-2 text-xs text-foreground-muted">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          <span>{loading ? "Actualizando…" : "Listo"}</span>
        </div>
      </div>
    </div>
  );
}
