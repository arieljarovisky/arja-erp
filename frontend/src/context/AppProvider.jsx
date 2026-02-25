// src/context/AppProvider.jsx
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiClient } from "../api/client";
import { useAuth } from "./AuthContext";
import { logger } from "../utils/logger.js";

const BUSINESS_TYPE_DEFAULT_FEATURES = {
  salon: { classes: false, routines: false },
  gym: { classes: true, routines: true },
  pilates: { classes: true, routines: true },
  kinesiology: { classes: false, routines: true },
  spa: { classes: false, routines: false },
  other: { classes: false, routines: false },
};

export const AppContext = createContext(null);

export function AppProvider({ children, pollMs = 30000 }) { // Aumentado a 30 segundos para reducir carga
  // --- Meta ---
  const [services, setServices] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState("");

  // --- Availability ---
  const [availability, setAvailability] = useState({
    slots: [],
    busySlots: [],
    loading: false,
    error: "",
  });

  // --- Booking form ---
  const [booking, setBooking] = useState({
    serviceId: "",
    instructorId: "",
    date: "",
    selectedSlot: "",
    customerId: "",
    customerName: "",
    customerPhone: "",
    repeatEnabled: false,
    repeatCount: 4,
    repeatUntil: "",
    branchId: "",
  });
  const updateBooking = (patch) => setBooking((b) => ({ ...b, ...patch }));

  const authContext = useAuth();
  const user = authContext?.user ?? null;
  const preferredBranchId = useMemo(
    () =>
      user?.currentBranchId || user?.current_branch_id
        ? String(user.currentBranchId || user.current_branch_id)
        : "",
    [user?.currentBranchId, user?.current_branch_id]
  );

  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState("");

  // --- Calendar events ---
  const [range, _setRange] = useState(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 30);
    return { fromIso: start.toISOString(), toIso: end.toISOString() };
  });
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  const setRangeSafe = useCallback((next) => {
    if (!next) return;
    _setRange((prev) =>
      prev.fromIso === next.fromIso && prev.toIso === next.toIso ? prev : next
    );
  }, []);

  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const pollTimer = useRef(null);
  const debounceTimer = useRef(null);

  // --- Booking save state ---
  const [bookingSave, setBookingSave] = useState({
    saving: false,
    ok: false,
    error: "",
  });

  // --- Tenant features ---
  const [tenantInfo, setTenantInfo] = useState(null);
  const [features, setFeatures] = useState({});
  const [featuresLoading, setFeaturesLoading] = useState(false);
  const classesEnabled = useMemo(() => features?.classes !== false, [features]);
  const appointmentsEnabled = useMemo(() => features?.appointments !== false, [features]);

  const loadBranches = useCallback(async () => {
    try {
      setBranchesLoading(true);
      setBranchesError("");
      const response = await apiClient.listActiveBranches();
      const list = Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response)
          ? response
          : [];
      setBranches(list);
      setBooking((prev) => {
        if (prev.branchId && list.some((branch) => String(branch.id) === String(prev.branchId))) {
          return prev;
        }
        const fallback =
          (preferredBranchId &&
            list.some((branch) => String(branch.id) === String(preferredBranchId)))
            ? preferredBranchId
            : list[0]?.id
              ? String(list[0].id)
              : "";
        if (!fallback && prev.branchId === "") {
          return prev;
        }
        return fallback ? { ...prev, branchId: fallback } : { ...prev, branchId: "" };
      });
    } catch (error) {
      logger.error("❌ [AppProvider] Error cargando sucursales:", error);
      setBranchesError(error?.message || "No se pudieron cargar las sucursales");
    } finally {
      setBranchesLoading(false);
    }
  }, [preferredBranchId]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    if (!preferredBranchId) return;
    setBooking((prev) => (prev.branchId ? prev : { ...prev, branchId: preferredBranchId }));
  }, [preferredBranchId]);

  // ============================================
  // 🧰 Helper: Local MySQL datetime
  // ============================================
  const toLocalMySQL = useCallback((val) => {
    if (!val) return "";
    const fmt = (d) => {
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
        d.getHours()
      )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
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
        return "";
      }
    }
    if (val instanceof Date) return fmt(val);
    if (typeof val === "number") {
      const ms = val > 1e12 ? val : val * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return fmt(d);
    }
    return "";
  }, []);

  // ============================================
  // 🔄 Cargar metadata (servicios + estilistas)
  // ============================================
  useEffect(() => {
    (async () => {
      try {
        setMetaLoading(true);
        setMetaError("");

        const [srv, sty] = await Promise.all([
          apiClient.listServices(),
          apiClient.listInstructors(),
        ]);

        setServices(srv);
        setInstructors(sty);
      } catch (e) {
        logger.error("❌ Error cargando metadata:", e);
        setMetaError(String(e.message || e));
      } finally {
        setMetaLoading(false);
      }
    })();
  }, [tenantInfo?.business_type_id]);

  // ============================================
  // 🏢 Cargar información del tenant (features)
  // ============================================
  const refreshFeatures = useCallback(async () => {
    setFeaturesLoading(true);
    try {
      const info = await apiClient.getTenantBusinessInfo();
      setTenantInfo(info);
      const raw = info?.features_config ?? info?.featuresConfig;
      let parsed = {};
      if (typeof raw === "string") {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = {};
        }
      } else if (typeof raw === "object" && raw != null) {
        parsed = raw;
      }
      const defaults = BUSINESS_TYPE_DEFAULT_FEATURES[info?.code] || {};
      const planFeatures = info?.plan?.features || {};
      const merged = {
        ...defaults,
        ...parsed,
      };
      Object.entries(planFeatures).forEach(([key, value]) => {
        if (value === false) {
          merged[key] = false;
        } else if (value === true) {
          if (merged[key] === undefined) {
            merged[key] = true;
          }
        } else if (merged[key] === undefined) {
          merged[key] = value;
        }
      });
      setFeatures(merged);
    } catch (e) {
      logger.warn("⚠️ [AppProvider] No se pudo obtener features del tenant:", e?.message || e);
      setFeatures((prev) =>
        Object.keys(prev || {}).length ? prev : { classes: false }
      );
    } finally {
      setFeaturesLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshFeatures();
  }, [refreshFeatures]);

  // ============================================
  // 📅 Cargar eventos — función ESTABLE
  // ============================================
  const loadEvents = useCallback(async (forceRefresh = false) => {
    const { fromIso, toIso } = rangeRef.current || {};
    if (!fromIso || !toIso) return;
    try {
      setEventsLoading(true);
      setEventsError("");

      const params = { from: fromIso, to: toIso };
      // Agregar cache-busting si se fuerza la recarga
      if (forceRefresh) {
        params._t = Date.now();
      }
    const appointmentsPromise = apiClient.listAppointments(params);
    const classesPromise = classesEnabled
      ? apiClient.listClassSessions({ ...params })
      : Promise.resolve([]);

      const [appointmentsData, sessionsData] = await Promise.all([appointmentsPromise, classesPromise]);

      const appointmentEvents = (appointmentsData?.appointments ?? appointmentsData ?? [])
        .filter((a) => {
          // Filtrar appointments sin fecha de inicio válida
          if (!a.starts_at) return false;
          const startDate = new Date(a.starts_at);
          return !isNaN(startDate.getTime());
        })
        .map((a) => ({
          id: String(a.id),
          title: `${a.customer_name ?? "Cliente"} • ${a.service_name ?? "Servicio"}`,
          start: a.starts_at,
          end: a.ends_at,
          backgroundColor: a.color_hex || undefined,
          borderColor: a.color_hex || undefined,
          extendedProps: {
            ...a,
            eventType: "appointment",
          },
        }));

      const classEvents = (Array.isArray(sessionsData) ? sessionsData : [])
        .filter((session) => {
          // Filtrar sesiones sin fecha de inicio válida
          if (!session.starts_at) return false;
          const startDate = new Date(session.starts_at);
          return !isNaN(startDate.getTime());
        })
        .map((session) => ({
          id: `class-${session.id}`,
          title: session.activity_type || "Clase",
          start: session.starts_at,
          end: session.ends_at,
        backgroundColor: "#7c3aed",
        borderColor: "#7c3aed",
        extendedProps: {
          ...session,
          eventType: "class_session",
          session_id: session.id,
          instructor_id: session.instructor_id,
          instructor_name: session.instructor_name,
          enrolled_count: session.enrolled_count ?? 0,
          capacity_max: session.capacity_max ?? null,
        },
      }));

      const combined = [...appointmentEvents, ...classEvents].sort(
        (a, b) => new Date(a.start) - new Date(b.start)
      );

      setEvents(combined);
    } catch (e) {
      setEventsError(String(e.message || e));
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [classesEnabled]);

  // 🔔 Debounce cuando cambia el rango visible (navegación)
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      loadEvents();
      debounceTimer.current = null;
    }, 150);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [range, loadEvents]);

  // ⏱️ Polling estable (no se reinicia al scrollear)
  useEffect(() => {
    loadEvents(); // primer carga
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(loadEvents, pollMs);
    return () => pollTimer.current && clearInterval(pollTimer.current);
  }, [loadEvents, pollMs]);

  // ============================================
  // 🔍 Cargar disponibilidad
  // ============================================
  const loadAvailability = useCallback(async () => {
    const { serviceId, instructorId, date } = booking;
    if (!serviceId || !instructorId || !date) return;

    const selectedDate = new Date(date + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (selectedDate < today) {
      setAvailability({
        slots: [],
        busySlots: [],
        loading: false,
        error: "⚠️ No podés buscar horarios para fechas pasadas",
      });
      return;
    }

    try {
      setAvailability((s) => ({ ...s, loading: true, error: "" }));

      const resp = await apiClient.getAvailability({
        serviceId,
        instructorId,
        date,
        stepMin: 20,
      });

      if (resp?.ok === false) throw new Error(resp?.error || "Sin disponibilidad");

      const rawSlots = resp?.data?.slots ?? resp?.slots ?? [];
      const rawBusySlots = resp?.data?.busySlots ?? resp?.busySlots ?? [];

      const normalizeSlot = (slot) => {
        if (typeof slot === "string" && /^\d{1,2}:\d{2}$/.test(slot)) {
          const [h, m] = slot.split(":");
          return `${date} ${h.padStart(2, "0")}:${m.padStart(2, "0")}:00`;
        }
        return toLocalMySQL(slot);
      };

      let slots = Array.isArray(rawSlots) ? rawSlots.map(normalizeSlot).filter(Boolean) : [];
      let busySlots =
        Array.isArray(rawBusySlots) ? rawBusySlots.map(normalizeSlot).filter(Boolean) : [];

      const now = new Date();
      const validSlots = slots.filter((iso) => new Date(iso.replace(" ", "T")) > now);
      const validBusySlots = busySlots.filter((iso) => new Date(iso.replace(" ", "T")) > now);

      setAvailability({
        slots: validSlots,
        busySlots: validBusySlots,
        loading: false,
        error: validSlots.length === 0 ? "No hay horarios disponibles" : "",
      });
    } catch (e) {
      logger.error("❌ [AVAIL] error", e);
      setAvailability({
        slots: [],
        busySlots: [],
        loading: false,
        error: String(e.message || e),
      });
    }
  }, [booking, toLocalMySQL]);

  // ============================================
  // ✅ Crear / Editar / Eliminar turno
  // ============================================
  const createAppointment = useCallback(
    async (overrideData = {}) => {
      const customerPhone = overrideData.customerPhone || booking.customerPhone;
      const customerName =
        overrideData.customerName !== undefined ? overrideData.customerName : booking.customerName;
      const customerId =
        overrideData.customerId !== undefined ? overrideData.customerId : booking.customerId;
      const repeatEnabled =
        overrideData.repeatEnabled !== undefined ? overrideData.repeatEnabled : booking.repeatEnabled;
      const repeatCount =
        overrideData.repeatCount !== undefined ? overrideData.repeatCount : booking.repeatCount;
      const repeatUntil =
        overrideData.repeatUntil !== undefined ? overrideData.repeatUntil : booking.repeatUntil;

      const { selectedSlot, serviceId, instructorId } = booking;
      const branchId =
        overrideData.branchId ??
        booking.branchId ??
        preferredBranchId ??
        user?.currentBranchId ??
        user?.current_branch_id ??
        "";

      if (!customerPhone && !customerId) {
        setBookingSave({ saving: false, ok: false, error: "⚠️ Ingresá tu teléfono de WhatsApp" });
        return;
      }
      if (!selectedSlot || !serviceId || !instructorId) {
        setBookingSave({
          saving: false,
          ok: false,
          error: "⚠️ Completá todos los pasos antes de confirmar",
        });
        return;
      }
      const slotTime = new Date(selectedSlot);
      if (slotTime <= new Date()) {
        setBookingSave({
          saving: false,
          ok: false,
          error: "⚠️ El horario seleccionado ya pasó. Refrescá la página.",
        });
        return;
      }

      if (!branchId) {
        setBookingSave({
          saving: false,
          ok: false,
          error: "⚠️ Seleccioná la sucursal del turno",
        });
        return;
      }

      try {
        setBookingSave({ saving: true, ok: false, error: "" });

        const srv = (services || []).find((s) => String(s.id) === String(serviceId));
        const durationMin = srv?.duration_min ?? srv?.durationMin ?? undefined;
        const startsAt = toLocalMySQL(selectedSlot);

        const basePayload = {
          customerPhone: customerPhone ? customerPhone.trim() : undefined,
          customerId: customerId ? Number(customerId) : undefined,
          customerName: customerName ? customerName.trim() : undefined,
          instructorId: Number(instructorId),
          serviceId: Number(serviceId),
          startsAt,
          durationMin,
          status: "scheduled",
          branchId: Number(branchId),
          sendWhatsApp: overrideData.sendWhatsApp || 'none', // 'with_payment', 'reminder_only', o 'none'
        };

        if (repeatEnabled) {
          const repeat = { frequency: "weekly", interval: 1 };
          if (repeatUntil) {
            repeat.until = repeatUntil;
          } else {
            const numericCount = Number.parseInt(repeatCount, 10);
            repeat.count = Number.isFinite(numericCount) && numericCount > 1 ? numericCount : 4;
          }

          const res = await apiClient.createRecurringAppointments({
            ...basePayload,
            repeat,
          });

          if (!res?.ok) throw new Error(res?.error || "No se pudo crear la serie de turnos");
        } else {
          const res = await apiClient.createAppointment(basePayload);
          if (!res?.ok && !res?.id) throw new Error(res?.error || "No se pudo crear el turno");
        }

        setBookingSave({ saving: false, ok: true, error: "" });
        await loadEvents();
        setTimeout(() => setBookingSave({ saving: false, ok: false, error: "" }), 3000);
      } catch (e) {
        const message =
          e?.response?.data?.error || e?.message || "No se pudo confirmar el turno. Verificá la cuota.";
        setBookingSave({ saving: false, ok: false, error: message });
      }
    },
    [booking, services, toLocalMySQL, loadEvents, preferredBranchId]
  );

  const updateAppointment = useCallback(
    async (id, patch, optimistic = true) => {
      try {
        // Actualización optimista: actualizar el estado local inmediatamente
        if (optimistic) {
          setEvents(prevEvents => {
            return prevEvents.map(event => {
              if (String(event.id) === String(id)) {
                const updated = { ...event };
                
                // Actualizar fechas si se proporcionan
                if (patch.starts_at || patch.startsAt) {
                  const newStart = patch.starts_at || patch.startsAt;
                  // Si es formato MySQL (YYYY-MM-DD HH:mm:ss), convertir a ISO
                  if (typeof newStart === 'string') {
                    if (newStart.includes('T')) {
                      // Ya es ISO
                      updated.start = newStart;
                    } else {
                      // Es formato MySQL, convertir a ISO
                      updated.start = newStart.replace(' ', 'T') + (newStart.includes('Z') ? '' : 'Z');
                    }
                  } else {
                    updated.start = newStart.toISOString();
                  }
                  if (updated.extendedProps) {
                    updated.extendedProps.starts_at = updated.start;
                  }
                }
                
                if (patch.ends_at || patch.endsAt) {
                  const newEnd = patch.ends_at || patch.endsAt;
                  // Si es formato MySQL (YYYY-MM-DD HH:mm:ss), convertir a ISO
                  if (typeof newEnd === 'string') {
                    if (newEnd.includes('T')) {
                      // Ya es ISO
                      updated.end = newEnd;
                    } else {
                      // Es formato MySQL, convertir a ISO
                      updated.end = newEnd.replace(' ', 'T') + (newEnd.includes('Z') ? '' : 'Z');
                    }
                  } else {
                    updated.end = newEnd.toISOString();
                  }
                  if (updated.extendedProps) {
                    updated.extendedProps.ends_at = updated.end;
                  }
                }
                
                // Actualizar instructor_id si se proporciona
                if (patch.instructor_id !== undefined) {
                  if (!updated.extendedProps) {
                    updated.extendedProps = {};
                  }
                  updated.extendedProps.instructor_id = patch.instructor_id;
                  updated.extendedProps.instructorId = patch.instructor_id;
                }
                
                return updated;
              }
              return event;
            });
          });
        }
        
        // Preparar body para el backend
        const body = {
          ...patch,
          startsAt: patch.startsAt || patch.starts_at,
          endsAt: patch.endsAt || patch.ends_at,
        };
        
        // Convertir fechas a formato MySQL si son strings ISO
        if (body.startsAt && typeof body.startsAt === 'string' && body.startsAt.includes('T')) {
          body.startsAt = toLocalMySQL(body.startsAt);
        }
        if (body.endsAt && typeof body.endsAt === 'string' && body.endsAt.includes('T')) {
          body.endsAt = toLocalMySQL(body.endsAt);
        }
        
        if (patch.branchId !== undefined) {
          body.branchId =
            patch.branchId === null || patch.branchId === ""
              ? null
              : Number(patch.branchId);
        }
        if (patch.applySeries) {
          body.applySeries = patch.applySeries;
        }
        
        // Actualizar en el backend de forma completamente asíncrona sin bloquear
        // No esperamos la respuesta para que la UI sea instantánea
        apiClient.updateAppointment(id, body)
          .then(() => {
            // Sincronizar en background inmediatamente después de actualizar
            // Sin delays para mantener la fluidez
            loadEvents(true).catch(err => {
              console.error("Error al sincronizar eventos:", err);
            });
          })
          .catch(err => {
            console.error("Error al actualizar en backend:", err);
            // Si falla, revertir la actualización optimista recargando eventos
            loadEvents(true).catch(() => {});
          });
        
        // Retornar inmediatamente sin esperar - la actualización optimista ya se hizo
        return { ok: true };
      } catch (e) {
        // Si falla, revertir la actualización optimista recargando eventos
        if (optimistic) {
          loadEvents(true).catch(() => {});
        }
        const message = e?.response?.data?.error || String(e.message || e);
        return { ok: false, error: message };
      }
    },
    [toLocalMySQL, loadEvents]
  );

  const deleteAppointment = useCallback(
    async (id) => {
      try {
        await apiClient.deleteAppointment(id);
        await loadEvents();
        return { ok: true };
      } catch (e) {
        const message = e?.response?.data?.error || String(e.message || e);
        return { ok: false, error: message };
      }
    },
    [loadEvents]
  );

  const cancelAppointmentSeries = useCallback(
    async (seriesId, options = {}) => {
      try {
        const data = await apiClient.cancelAppointmentSeries(seriesId, options);
        await loadEvents();
        return { ok: true, data };
      } catch (e) {
        const message = e?.response?.data?.error || String(e.message || e);
        return { ok: false, error: message };
      }
    },
    [loadEvents]
  );

  // ============================================
  // 📦 Context value
  // ============================================
  const value = useMemo(
    () => ({
      // Meta
      services,
      instructors,
      metaLoading,
      metaError,
      // Booking + availability
      booking,
      updateBooking,
      availability,
      loadAvailability,
      bookingSave,
      createAppointment,
      branches,
      branchesLoading,
      branchesError,
      reloadBranches: loadBranches,
      // Calendar
      events,
      setEvents,
      eventsLoading,
      eventsError,
      range,
      setRange: setRangeSafe, // 👈 versión que evita renders inútiles
      loadEvents,
      updateAppointment,
      deleteAppointment,
      cancelAppointmentSeries,
      // Tenant features
      tenantInfo,
      features,
      featuresLoading,
      classesEnabled,
      appointmentsEnabled,
      refreshFeatures,
    }),
    [
      services,
      instructors,
      metaLoading,
      metaError,
      booking,
      availability,
      bookingSave,
      events,
      eventsLoading,
      eventsError,
      range,
      loadAvailability,
      createAppointment,
      loadEvents,
      updateAppointment,
      deleteAppointment,
      cancelAppointmentSeries,
      setRangeSafe,
      tenantInfo,
      features,
      featuresLoading,
      classesEnabled,
      appointmentsEnabled,
      refreshFeatures,
      loadBranches,
      branches,
      branchesLoading,
      branchesError,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
