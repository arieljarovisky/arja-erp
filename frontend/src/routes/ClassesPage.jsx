import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  DollarSign,
  Plus,
  RefreshCw,
  UserPlus,
  Users,
  XCircle,
  Trash2,
  MessageCircle,
  PencilLine,
  Search,
  Calendar,
  Clock,
  Filter,
  X,
  ChevronDown,
  Inbox,
} from "lucide-react";
import { apiClient } from "../api";
import { useQuery } from "../shared/useQuery";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { logger } from "../utils/logger.js";

const DEFAULT_FEATURES_BY_BUSINESS = {
  salon: { classes: false },
  gym: { classes: true },
  pilates: { classes: true },
  kinesiology: { classes: false },
  spa: { classes: false },
  other: { classes: false },
};

const STATUS_OPTIONS = [
  { value: "", label: "Todos los estados" },
  { value: "scheduled", label: "Programadas" },
  { value: "completed", label: "Completadas" },
  { value: "cancelled", label: "Canceladas" },
];

const ENROLLMENT_STATUS_OPTIONS = [
  { value: "reserved", label: "Reservado" },
  { value: "attended", label: "Asistió" },
  { value: "cancelled", label: "Cancelado" },
  { value: "noshow", label: "No asistió" },
];

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Domingo" },
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
];

const DEFAULT_REPEAT_OPTIONS = {
  enabled: false,
  weeks: 4,
  patterns: [],
};

const DEFAULT_SERIES_EDIT = {
  instructorId: "",
  activityType: "",
  serviceId: "",
  capacityMax: "",
  priceDecimal: "",
  notes: "",
  includePast: false,
};

const ACTIVE_ENROLLMENT_STATUSES = new Set(["reserved", "attended"]);

const parseJSON = (raw) => {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw;
  return {};
};

const toDateInputValue = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const addMinutesToISO = (iso, minutes) => {
  if (!iso || !minutes) return iso;
  const base = new Date(iso);
  if (Number.isNaN(base.getTime())) return iso;
  const end = new Date(base.getTime() + Number(minutes) * 60000);
  return toDateTimeLocalValue(end);
};

function toDateTimeLocalValue(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

const formatDateTime = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const currency = (value) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(
    Number(value || 0)
  );

// Componente helper para badges de estado mejorados
const StatusBadge = ({ status, className = "" }) => {
  const statusConfig = {
    scheduled: {
      label: "Programada",
      icon: Clock,
      bg: "bg-blue-500/15",
      border: "border-blue-500/30",
      text: "text-blue-200",
      iconColor: "text-blue-400",
    },
    completed: {
      label: "Completada",
      icon: CheckCircle2,
      bg: "bg-green-500/15",
      border: "border-green-500/30",
      text: "text-green-200",
      iconColor: "text-green-400",
    },
    cancelled: {
      label: "Cancelada",
      icon: XCircle,
      bg: "bg-red-500/15",
      border: "border-red-500/30",
      text: "text-red-200",
      iconColor: "text-red-400",
    },
    reserved: {
      label: "Reservado",
      icon: Users,
      bg: "bg-indigo-500/15",
      border: "border-indigo-500/30",
      text: "text-indigo-200",
      iconColor: "text-indigo-400",
    },
    attended: {
      label: "Asistió",
      icon: CheckCircle2,
      bg: "bg-emerald-500/15",
      border: "border-emerald-500/30",
      text: "text-emerald-200",
      iconColor: "text-emerald-400",
    },
    noshow: {
      label: "No asistió",
      icon: AlertCircle,
      bg: "bg-amber-500/15",
      border: "border-amber-500/30",
      text: "text-amber-200",
      iconColor: "text-amber-400",
    },
  };

  const config = statusConfig[status] || {
    label: status || "Desconocido",
    icon: AlertCircle,
    bg: "bg-gray-500/15",
    border: "border-gray-500/30",
    text: "text-gray-200",
    iconColor: "text-gray-400",
  };

  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${config.bg} ${config.border} ${config.text} ${className}`}
    >
      <Icon className={`w-3.5 h-3.5 ${config.iconColor}`} />
      {config.label}
    </span>
  );
};

const findInstructorOverlap = (sessions) => {
  if (!Array.isArray(sessions) || !sessions.length) return null;

  const normalized = sessions
    .map((session) => {
      const instructorId = Number(session.instructorId);
      const start = new Date(session.startsAt);
      const end = new Date(session.endsAt);
      if (!Number.isFinite(instructorId) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return null;
      }
      return { instructorId, start, end };
    })
    .filter(Boolean);

  const byInstructor = new Map();
  normalized.forEach((session) => {
    if (!byInstructor.has(session.instructorId)) {
      byInstructor.set(session.instructorId, []);
    }
    byInstructor.get(session.instructorId).push(session);
  });

  for (const [instructorId, list] of byInstructor.entries()) {
    list.sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1];
      const current = list[i];
      if (current.start < prev.end && current.end > prev.start) {
        return { instructorId, prev, current };
      }
    }
  }

  return null;
};

function formatSeriesId(seriesId) {
  if (!seriesId) return "—";
  const clean = String(seriesId).replace(/[^a-zA-Z0-9]/g, "");
  if (clean.length <= 6) return clean.toUpperCase();
  return `SER-${clean.slice(-6).toUpperCase()}`;
}

function groupActivityLabel({ key, activity }) {
  if (key === "__sin-serie__") return "Turnos sueltos";
  return activity || "Clase";
}

const ActionBanner = ({ message, onClose }) => {
  if (!message) return null;
  const palette =
    message.type === "error"
      ? "bg-red-500/10 border-red-500/40 text-red-200"
      : message.type === "success"
        ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-200"
        : "bg-primary/10 border-primary/40 text-primary";

  return (
    <div className={`flex items-start justify-between gap-4 px-4 py-3 rounded-xl border ${palette}`}>
      <div>
        <p className="font-medium">{message.title}</p>
        {message.body && <p className="text-sm opacity-80">{message.body}</p>}
      </div>
      <button
        onClick={onClose}
        className="text-sm opacity-70 hover:opacity-100 transition"
        aria-label="Cerrar mensaje"
      >
        ✕
      </button>
    </div>
  );
};

export default function ClassesPage() {
  const { user } = useAuth();
  const preferredBranchId = useMemo(
    () =>
      user?.currentBranchId || user?.current_branch_id
        ? String(user.currentBranchId || user.current_branch_id)
        : "",
    [user?.currentBranchId, user?.current_branch_id]
  );
  const today = new Date();
  const defaultFrom = toDateInputValue(today);
  const defaultTo = toDateInputValue(new Date(today.getTime() + 1000 * 60 * 60 * 24 * 14));
  const defaultStartsAt = `${defaultFrom}T09:00`;
  const defaultEndsAt = `${defaultFrom}T10:00`;

  const [filters, setFilters] = useState({
    from: defaultFrom,
    to: defaultTo,
    status: "scheduled",
    instructorId: "",
    activityType: "",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) {
        setShowAdvancedFilters(true);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");

  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState("");

  const [instructors, setInstructors] = useState([]);
  const [services, setServices] = useState([]);

  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [sessionDetail, setSessionDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [sessionFormOpen, setSessionFormOpen] = useState(false);
  const [templateFormOpen, setTemplateFormOpen] = useState(false);

  const [sessionForm, setSessionForm] = useState({
    templateId: "",
    activityType: "",
    instructorId: "",
    serviceId: "",
    startsAt: defaultStartsAt,
    endsAt: defaultEndsAt,
    capacityMax: 10,
    priceDecimal: 0,
    notes: "",
    branchId: preferredBranchId,
  });
  const [sessionDurationMin, setSessionDurationMin] = useState(60);
  const [repeatOptions, setRepeatOptions] = useState(DEFAULT_REPEAT_OPTIONS);
  const [savingSession, setSavingSession] = useState(false);

  const [templateForm, setTemplateForm] = useState({
    name: "",
    activityType: "",
    defaultCapacity: 10,
    defaultDurationMin: 60,
    defaultPriceDecimal: 0,
    defaultInstructorId: "",
    color: "",
    description: "",
    isActive: true,
  });
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [enrollForm, setEnrollForm] = useState({
    customerId: "",
    customerName: "",
    customerPhone: "",
    notes: "",
  });
  const [savingEnrollment, setSavingEnrollment] = useState(false);

  const [actionMessage, setActionMessage] = useState(null);
  const [groupBySeries, setGroupBySeries] = useState(true);
  const [seriesModal, setSeriesModal] = useState(null);
  const [seriesEnrollForm, setSeriesEnrollForm] = useState({
    sessionId: "",
    customerName: "",
    customerPhone: "",
    notes: "",
    repeatEnabled: true,
  });
  const [seriesEnrollLoading, setSeriesEnrollLoading] = useState(false);
  const [seriesEditOpen, setSeriesEditOpen] = useState(false);
  const [seriesEditValues, setSeriesEditValues] = useState(DEFAULT_SERIES_EDIT);
  const [seriesEditSaving, setSeriesEditSaving] = useState(false);

  const resetSeriesEditForm = useCallback(() => {
    if (!seriesModal || seriesModal.key === "__sin-serie__") {
      setSeriesEditValues(DEFAULT_SERIES_EDIT);
      return;
    }
    const firstSession = seriesModal.sessions?.[0] || {};
    setSeriesEditValues({
      instructorId: firstSession?.instructor_id ? String(firstSession.instructor_id) : "",
      activityType: firstSession?.activity_type || "",
      serviceId: firstSession?.service_id ? String(firstSession.service_id) : "",
      capacityMax: firstSession?.capacity_max != null ? String(firstSession.capacity_max) : "",
      priceDecimal:
        firstSession?.price_decimal != null ? String(Number(firstSession.price_decimal)) : "",
      notes: firstSession?.notes || "",
      includePast: false,
    });
  }, [seriesModal]);

  const dismissMessage = () => setActionMessage(null);

  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(false);

  const loadBranches = useCallback(async () => {
    try {
      setBranchesLoading(true);
      const response = await apiClient.listActiveBranches();
      const list = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
      setBranches(list);
      setSessionForm((prev) => {
        if (prev.branchId) return prev;
        const fallback = preferredBranchId || (list[0]?.id ? String(list[0].id) : "");
        return fallback ? { ...prev, branchId: fallback } : prev;
      });
    } catch (error) {
      logger.error("❌ [classes] Error cargando sucursales:", error);
      toast.error("No se pudieron cargar las sucursales");
    } finally {
      setBranchesLoading(false);
    }
  }, [preferredBranchId]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    if (preferredBranchId) {
      setSessionForm((prev) => (prev.branchId ? prev : { ...prev, branchId: preferredBranchId }));
    }
  }, [preferredBranchId]);

const { data: tenantBusinessInfo, loading: businessInfoLoading } = useQuery(
    () => apiClient.getTenantBusinessInfo(),
    []
  );

  const tenantFeatures = useMemo(
    () => parseJSON(tenantBusinessInfo?.features_config || tenantBusinessInfo?.featuresConfig),
    [tenantBusinessInfo]
  );
  const enabledFeatures = useMemo(
    () => ({
      ...(DEFAULT_FEATURES_BY_BUSINESS[tenantBusinessInfo?.code] || {}),
      ...tenantFeatures,
    }),
    [tenantFeatures, tenantBusinessInfo?.code]
  );
  const classesEnabled = Boolean(enabledFeatures.classes);

  // Filtrar sesiones por búsqueda - DEBE estar antes de cualquier hook que lo use
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const query = searchQuery.toLowerCase().trim();
    return sessions.filter((session) => {
      const activity = (session.activity_type || "").toLowerCase();
      const instructor = (session.instructor_name || "").toLowerCase();
      const seriesId = (session.series_id || "").toLowerCase();
      return activity.includes(query) || instructor.includes(query) || seriesId.includes(query);
    });
  }, [sessions, searchQuery]);

  const fetchInstructors = useCallback(async () => {
    try {
      const list = await apiClient.listInstructors({ active: true });
      setInstructors(Array.isArray(list) ? list : []);
    } catch (error) {
      logger.error("❌ [classes] Error cargando estilistas:", error);
    }
  }, []);

  const fetchServices = useCallback(async () => {
    try {
      const list = await apiClient.listServices({ active: true });
      setServices(Array.isArray(list) ? list : []);
    } catch (error) {
      logger.error("❌ [classes] Error cargando servicios:", error);
    }
  }, []);

  const fetchTemplates = useCallback(async () => {
    try {
      setTemplatesLoading(true);
      setTemplatesError("");
      const list = await apiClient.listClassTemplates();
      setTemplates(Array.isArray(list) ? list : []);
    } catch (error) {
      logger.error("❌ [classes] Error cargando plantillas:", error);
      setTemplatesError(error?.message || "No se pudieron obtener las plantillas");
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      setSessionsLoading(true);
      setSessionsError("");
      const params = {
        from: filters.from ? `${filters.from} 00:00:00` : undefined,
        to: filters.to ? `${filters.to} 23:59:59` : undefined,
        status: filters.status || undefined,
      };
      if (filters.instructorId) params.instructorId = filters.instructorId;
      if (filters.activityType) params.activityType = filters.activityType;
      const list = await apiClient.listClassSessions(params);
      setSessions(Array.isArray(list) ? list : []);
    } catch (error) {
      logger.error("❌ [classes] Error cargando sesiones:", error);
      setSessions([]);
      setSessionsError(error?.message || "No se pudieron obtener las clases");
    } finally {
      setSessionsLoading(false);
    }
  }, [filters]);

  const fetchSessionDetail = useCallback(
    async (sessionId) => {
      if (!sessionId) {
        setSessionDetail(null);
        setDetailError("");
        return;
      }
      try {
        setDetailLoading(true);
        setDetailError("");
        const detail = await apiClient.getClassSession(sessionId);
        setSessionDetail(detail);
      } catch (error) {
        logger.error("❌ [classes] Error cargando detalle:", error);
        setDetailError(error?.message || "No se pudo cargar la clase seleccionada");
        setSessionDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchInstructors();
    fetchServices();
    fetchTemplates();
  }, [fetchInstructors, fetchServices, fetchTemplates]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    setPage(1);
  }, [filters, groupBySeries]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(sessions.length / pageSize));
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [sessions, page, pageSize]);

  useEffect(() => {
    if (!seriesModal) return;
    const upcoming =
      seriesModal.sessions?.filter((s) => new Date(s.starts_at) >= new Date()) ?? [];
    const defaultSessionId =
      upcoming[0]?.id ?? seriesModal.sessions?.[0]?.id ?? "";
    setSeriesEnrollForm({
      sessionId: defaultSessionId ? String(defaultSessionId) : "",
      customerName: "",
      customerPhone: "",
      notes: "",
      repeatEnabled: true,
    });
    setSeriesEnrollLoading(false);
  }, [seriesModal]);

  useEffect(() => {
    resetSeriesEditForm();
    setSeriesEditOpen(false);
  }, [seriesModal, resetSeriesEditForm]);

  useEffect(() => {
    if (selectedSessionId) {
      fetchSessionDetail(selectedSessionId);
    }
  }, [selectedSessionId, fetchSessionDetail]);

  // Atajos de teclado para acciones rápidas
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignorar si el usuario está escribiendo en un input, textarea o select
      if (
        e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA" ||
        e.target.tagName === "SELECT" ||
        e.target.isContentEditable
      ) {
        return;
      }

      // Ctrl/Cmd + N: Nueva clase
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        setRepeatOptions(DEFAULT_REPEAT_OPTIONS);
        setSessionFormOpen(true);
      }

      // Ctrl/Cmd + R: Refrescar
      if ((e.ctrlKey || e.metaKey) && e.key === "r") {
        e.preventDefault();
        fetchSessions();
      }

      // Ctrl/Cmd + F: Focus en búsqueda
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        const searchInput = document.querySelector('input[type="text"][placeholder*="Buscar"]');
        if (searchInput) {
          searchInput.focus();
        }
      }

      // Escape: Cerrar modales
      if (e.key === "Escape") {
        if (sessionFormOpen) setSessionFormOpen(false);
        if (templateFormOpen) setTemplateFormOpen(false);
        if (seriesModal) setSeriesModal(null);
        setSearchQuery("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fetchSessions, sessionFormOpen, templateFormOpen, seriesModal]);

  const handleTemplateApply = (templateId) => {
    setSessionForm((prev) => ({ ...prev, templateId }));
    const template = templates.find((tpl) => String(tpl.id) === String(templateId));
    if (!template) return;

    setSessionForm((prev) => {
      const next = {
        ...prev,
        activityType: prev.activityType || template.activity_type || "",
        capacityMax: template.default_capacity ?? prev.capacityMax,
        priceDecimal: template.default_price_decimal ?? prev.priceDecimal,
      };
      if (!prev.instructorId && template.default_instructor_id) {
        next.instructorId = String(template.default_instructor_id);
      }
      if (template.default_duration_min) {
        const duration = Number(template.default_duration_min);
        setSessionDurationMin(duration);
        next.endsAt = addMinutesToISO(prev.startsAt || defaultStartsAt, duration);
      }
      return next;
    });
  };

  const handleSessionFormChange = (field, value) => {
    setSessionForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSessionFormSubmit = async (event) => {
    event.preventDefault();
    if (!sessionForm.activityType.trim()) {
      setActionMessage({ type: "error", title: "Ingresá el tipo de actividad." });
      return;
    }
    if (!sessionForm.instructorId) {
      setActionMessage({ type: "error", title: "Seleccioná un profesor." });
      return;
    }
    if (!sessionForm.startsAt) {
      setActionMessage({ type: "error", title: "Elegí una fecha y hora de inicio." });
      return;
    }
    if (!sessionForm.branchId) {
      setActionMessage({ type: "error", title: "Seleccioná la sucursal." });
      return;
    }

    // Calcular endsAt si no está definido o si la duración es válida
    let calculatedEndsAt = sessionForm.endsAt;
    if (!calculatedEndsAt && sessionForm.startsAt && sessionDurationMin > 0) {
      calculatedEndsAt = addMinutesToISO(sessionForm.startsAt, sessionDurationMin);
    }
    
    // Validar que endsAt sea posterior a startsAt
    if (sessionForm.startsAt && calculatedEndsAt) {
      const startDate = new Date(sessionForm.startsAt);
      const endDate = new Date(calculatedEndsAt);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate >= endDate) {
        setActionMessage({ 
          type: "error", 
          title: "La hora de fin debe ser posterior al inicio.",
          body: "Asegurate de que la duración sea mayor a cero y que las fechas sean válidas."
        });
        return;
      }
    }

    if (!calculatedEndsAt) {
      setActionMessage({ 
        type: "error", 
        title: "No se pudo calcular la fecha de fin.",
        body: "Verificá que la fecha de inicio y la duración sean correctas."
      });
      return;
    }

    const payload = {
      templateId: sessionForm.templateId ? Number(sessionForm.templateId) : undefined,
      instructorId: Number(sessionForm.instructorId),
      serviceId: sessionForm.serviceId ? Number(sessionForm.serviceId) : undefined,
      startsAt: sessionForm.startsAt,
      endsAt: calculatedEndsAt,
      activityType: sessionForm.activityType.trim(),
      capacityMax: Number(sessionForm.capacityMax || 0),
      priceDecimal: Number(sessionForm.priceDecimal || 0),
      notes: sessionForm.notes?.trim() || undefined,
      branchId: Number(sessionForm.branchId),
    };

    if (payload.capacityMax <= 0) {
      setActionMessage({ type: "error", title: "El cupo debe ser mayor a cero." });
      return;
    }

    if (!sessionDurationMin || sessionDurationMin <= 0) {
      setActionMessage({ type: "error", title: "La duración debe ser mayor a cero." });
      return;
    }

    let generatedSeriesId = null;
    let additionalSessions = [];

    if (repeatOptions.enabled) {
      generatedSeriesId = window.crypto?.randomUUID?.() || `series-${Date.now()}`;
      payload.seriesId = generatedSeriesId;
      const totalWeeks = Math.max(1, Number(repeatOptions.weeks || 0));
      const baseStartDate = new Date(sessionForm.startsAt);
      const baseEndDate = new Date(payload.endsAt);

      if (Number.isNaN(baseStartDate.getTime()) || Number.isNaN(baseEndDate.getTime())) {
        setActionMessage({ type: "error", title: "No se pudo interpretar la fecha de la clase base." });
        return;
      }

      const baseDurationMin = Math.max(1, sessionDurationMin || Math.round((baseEndDate - baseStartDate) / 60000));
      const baseTime = sessionForm.startsAt.slice(11, 16) || "09:00";
      const patterns = [
        {
          isBase: true,
          weekday: baseStartDate.getDay(),
          startTime: baseTime,
          durationMin: baseDurationMin,
        },
        ...repeatOptions.patterns.map((pattern) => ({
          weekday: Number(pattern.weekday ?? 0),
          startTime: pattern.startTime || baseTime,
          endTime: pattern.endTime || "",
          durationMin: pattern.durationMin ? Number(pattern.durationMin) : null,
          instructorId: pattern.instructorId || "",
          serviceId: pattern.serviceId || "",
          capacityMax: pattern.capacityMax,
          priceDecimal: pattern.priceDecimal,
          activityType: pattern.activityType,
          notes: pattern.notes,
        })),
      ];

      additionalSessions = [];

      for (let week = 0; week < totalWeeks; week += 1) {
        patterns.forEach((pattern) => {
          const occurrence = new Date(baseStartDate);
          const diffDays = ((Number(pattern.weekday) - baseStartDate.getDay() + 7) % 7) + week * 7;
          occurrence.setDate(occurrence.getDate() + diffDays);

          const [hour, minute] = (pattern.startTime || baseTime).split(":").map((n) => Number(n));
          occurrence.setHours(
            Number.isFinite(hour) ? hour : baseStartDate.getHours(),
            Number.isFinite(minute) ? minute : baseStartDate.getMinutes(),
            0,
            0
          );

          let endDate;
          if (pattern.endTime) {
            const [eh, em] = pattern.endTime.split(":").map((n) => Number(n));
            endDate = new Date(occurrence);
            endDate.setHours(
              Number.isFinite(eh) ? eh : occurrence.getHours(),
              Number.isFinite(em) ? em : occurrence.getMinutes(),
              0,
              0
            );
          } else {
            const duration = Number.isFinite(pattern.durationMin) && pattern.durationMin > 0 ? pattern.durationMin : baseDurationMin;
            endDate = new Date(occurrence.getTime() + duration * 60000);
          }

          if (pattern.isBase && week === 0) {
            return;
          }

          const sessionOverride = {
            startsAt: toDateTimeLocalValue(occurrence),
            endsAt: toDateTimeLocalValue(endDate),
            seriesId: generatedSeriesId,
            branchId: Number(sessionForm.branchId),
          };

          if (pattern.instructorId) sessionOverride.instructorId = Number(pattern.instructorId);
          if (pattern.serviceId) sessionOverride.serviceId = Number(pattern.serviceId);
          if (pattern.activityType) sessionOverride.activityType = String(pattern.activityType).trim();
          if (pattern.capacityMax !== undefined && pattern.capacityMax !== null && pattern.capacityMax !== "") {
            sessionOverride.capacityMax = Number(pattern.capacityMax);
          }
          if (pattern.priceDecimal !== undefined && pattern.priceDecimal !== null && pattern.priceDecimal !== "") {
            sessionOverride.priceDecimal = Number(pattern.priceDecimal);
          }
          if (pattern.notes) sessionOverride.notes = String(pattern.notes).trim();

          additionalSessions.push(sessionOverride);
        });
      }

      if (additionalSessions.length) {
        payload.repeat = { sessions: additionalSessions };
      }
    }

    const sessionsForValidation = [
      {
        instructorId: payload.instructorId,
        startsAt: payload.startsAt,
        endsAt: payload.endsAt,
      },
      ...additionalSessions.map((session) => ({
        instructorId:
          session.instructorId != null ? Number(session.instructorId) : payload.instructorId,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
      })),
    ];

    const overlap = findInstructorOverlap(sessionsForValidation);
    if (overlap) {
      const instructorName =
        instructors.find((sty) => Number(sty.id) === Number(overlap.instructorId))?.name ||
        "el instructor seleccionado";
      const clashTime = formatDateTime(overlap.current.start);
      setActionMessage({
        type: "error",
        title: "Revisá los horarios",
        body: `Hay dos clases para ${instructorName} que se superponen (${clashTime}). Ajustá los horarios o el profesor antes de guardar.`,
      });
      return;
    }

    try {
      setSavingSession(true);
      const response = await apiClient.createClassSession(payload);
      const createdCount = Array.isArray(response?.ids) ? response.ids.length : 1;

      setActionMessage({
        type: "success",
        title: createdCount > 1 ? `${createdCount} clases creadas` : "Clase creada correctamente.",
        body: createdCount > 1 ? "Se generaron todas las sesiones programadas." : "Ya podés anotar alumnos en la sesión.",
      });

      setSessionForm({
        templateId: "",
        activityType: "",
        instructorId: "",
        serviceId: "",
        startsAt: defaultStartsAt,
        endsAt: defaultEndsAt,
        capacityMax: 10,
        priceDecimal: 0,
        notes: "",
        branchId: preferredBranchId || (branches[0]?.id ? String(branches[0].id) : ""),
      });
      setSessionDurationMin(60);
      setRepeatOptions(DEFAULT_REPEAT_OPTIONS);
      setSessionFormOpen(false);
      await fetchSessions();
    } catch (error) {
      setActionMessage({
        type: "error",
        title: "No se pudo crear la clase.",
        body: error?.response?.data?.error || error?.message || "Intentá nuevamente más tarde.",
      });
    } finally {
      setSavingSession(false);
    }
  };

  const handleTemplateFormSubmit = async (event) => {
    event.preventDefault();
    if (!templateForm.name.trim() || !templateForm.activityType.trim()) {
      setActionMessage({
        type: "error",
        title: "Completá nombre y tipo de actividad.",
      });
      return;
    }
    try {
      setSavingTemplate(true);
      await apiClient.createClassTemplate({
        name: templateForm.name.trim(),
        description: templateForm.description?.trim() || undefined,
        activityType: templateForm.activityType.trim(),
        defaultCapacity: Number(templateForm.defaultCapacity || 0),
        defaultDurationMin: Number(templateForm.defaultDurationMin || 0),
        defaultPriceDecimal: Number(templateForm.defaultPriceDecimal || 0),
        defaultInstructorId: templateForm.defaultInstructorId ? Number(templateForm.defaultInstructorId) : undefined,
        color: templateForm.color || null,
        isActive: templateForm.isActive,
      });
      setActionMessage({
        type: "success",
        title: "Plantilla creada.",
        body: "Ahora podés reutilizarla al programar nuevas clases.",
      });
      setTemplateForm({
        name: "",
        activityType: "",
        defaultCapacity: 10,
        defaultDurationMin: 60,
        defaultPriceDecimal: 0,
        defaultInstructorId: "",
        color: "",
        description: "",
        isActive: true,
      });
      setTemplateFormOpen(false);
      fetchTemplates();
    } catch (error) {
      setActionMessage({
        type: "error",
        title: "No se pudo crear la plantilla.",
        body: error?.response?.data?.error || error?.message || "Intentá nuevamente más tarde.",
      });
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleAddEnrollment = async (event) => {
    event.preventDefault();
    if (!selectedSessionId) return;
    if (!enrollForm.customerPhone.trim()) {
      setActionMessage({ type: "error", title: "Ingresá el teléfono del alumno." });
      return;
    }
    try {
      setSavingEnrollment(true);
      await apiClient.createClassEnrollment(selectedSessionId, {
        customerId: enrollForm.customerId ? Number(enrollForm.customerId) : undefined,
        customerName: enrollForm.customerName?.trim() || undefined,
        customerPhone: enrollForm.customerPhone.trim(),
        notes: enrollForm.notes?.trim() || undefined,
      });
      setActionMessage({
        type: "success",
        title: "Alumno inscripto.",
      });
      setEnrollForm({
        customerId: "",
        customerName: "",
        customerPhone: "",
        notes: "",
      });
      await Promise.all([fetchSessionDetail(selectedSessionId), fetchSessions()]);
    } catch (error) {
      setActionMessage({
        type: "error",
        title: "No se pudo inscribir al alumno.",
        body: error?.response?.data?.error || error?.message || "",
      });
    } finally {
      setSavingEnrollment(false);
    }
  };

  const handleUpdateEnrollment = async (enrollmentId, nextStatus) => {
    if (!selectedSessionId || !enrollmentId) return;
    try {
      await apiClient.updateClassEnrollment(selectedSessionId, enrollmentId, { status: nextStatus });
      setActionMessage({
        type: "success",
        title: "Inscripción actualizada.",
      });
      await Promise.all([fetchSessionDetail(selectedSessionId), fetchSessions()]);
    } catch (error) {
      setActionMessage({
        type: "error",
        title: "No se pudo actualizar la inscripción.",
        body: error?.response?.data?.error || error?.message || "",
      });
    }
  };

  const handleDeleteEnrollment = async (enrollmentId) => {
    if (!selectedSessionId || !enrollmentId) return;
    if (!window.confirm("¿Eliminar la inscripción seleccionada?")) return;
    try {
      await apiClient.deleteClassEnrollment(selectedSessionId, enrollmentId);
      setActionMessage({
        type: "success",
        title: "Inscripción eliminada.",
      });
      await Promise.all([fetchSessionDetail(selectedSessionId), fetchSessions()]);
    } catch (error) {
      setActionMessage({
        type: "error",
        title: "No se pudo eliminar la inscripción.",
        body: error?.response?.data?.error || error?.message || "",
      });
    }
  };

  const handleCloseSession = async (id, status) => {
    if (!id) return;
    try {
      const payload = status ? { status } : undefined;
      await apiClient.updateClassSession(id, payload || {});
      setActionMessage({
        type: "success",
        title: "Clase actualizada.",
      });
      await Promise.all([fetchSessions(), fetchSessionDetail(id)]);
    } catch (error) {
      setActionMessage({
        type: "error",
        title: "No se pudo actualizar la clase.",
        body: error?.response?.data?.error || error?.message || "",
      });
    }
  };

  const handleCancelSession = async (id) => {
    if (!id) return;
    if (!window.confirm("Vas a cancelar la clase y todas las inscripciones quedarán en espera. ¿Continuar?")) {
      return;
    }
    try {
      await apiClient.cancelClassSession(id);
      setActionMessage({
        type: "success",
        title: "Clase cancelada.",
      });
      if (selectedSessionId === id) {
        setSelectedSessionId(null);
      }
      await fetchSessions();
    } catch (error) {
      setActionMessage({
        type: "error",
        title: "No se pudo cancelar la clase.",
        body: error?.response?.data?.error || error?.message || "",
      });
    }
  };

  const handleCancelSeries = async (seriesId) => {
    if (!seriesId) return;
    const confirm = window.confirm("¿Cancelar todas las clases programadas en esta serie?");
    if (!confirm) return;
    try {
      await apiClient.cancelClassSeries(seriesId);
      setActionMessage({
        type: "success",
        title: "Clases canceladas",
        body: "Se cancelaron todas las sesiones programadas de la serie.",
      });
      await fetchSessions();
      if (selectedSessionId) {
        await fetchSessionDetail(selectedSessionId);
      }
      setSeriesModal(null);
      setSeriesEditOpen(false);
      setSeriesEditValues(DEFAULT_SERIES_EDIT);
    } catch (error) {
      setActionMessage({
        type: "error",
        title: "No se pudieron cancelar las clases",
        body: error?.response?.data?.error || error?.message || "Intentá nuevamente más tarde.",
      });
    }
  };

  const activeEnrollments = useMemo(() => {
    if (!sessionDetail?.enrollments) return 0;
    return sessionDetail.enrollments.filter((e) => ACTIVE_ENROLLMENT_STATUSES.has(e.status)).length;
  }, [sessionDetail]);

  const handleSeriesEnrollSubmit = async (event) => {
    event.preventDefault();
    if (!seriesModal) return;
    const { sessionId, customerPhone, customerName, notes, repeatEnabled } = seriesEnrollForm;
    if (!sessionId || !customerPhone.trim()) {
      toast.error("Seleccioná una clase y completá el teléfono del alumno.");
      return;
    }
    try {
      setSeriesEnrollLoading(true);
      const payload = {
        customerName: customerName?.trim() || undefined,
        customerPhone: customerPhone.trim(),
        notes: notes?.trim() || undefined,
      };
      if (repeatEnabled) payload.repeat = { enabled: true };
      const response = await apiClient.createClassEnrollment(Number(sessionId), payload);
      if (response?.ok === false) {
        throw new Error(response?.error || "No se pudo inscribir al alumno.");
      }
      toast.success(
        repeatEnabled ? "Alumno inscripto en toda la serie." : "Alumno inscripto en la clase seleccionada."
      );
      await fetchSessions();
      setSeriesModal(null);
    } catch (error) {
      const msg = error?.response?.data?.error || error?.message || "Error al inscribir al alumno.";
      toast.error("No se pudo inscribir al alumno", { description: msg });
    } finally {
      setSeriesEnrollLoading(false);
    }
  };

  const handleSeriesEditChange = (field, value) => {
    setSeriesEditValues((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSeriesEditSubmit = async (event) => {
    event.preventDefault();
    if (!seriesModal || seriesModal.key === "__sin-serie__") return;

    const { instructorId, activityType, serviceId, capacityMax, priceDecimal, notes, includePast } =
      seriesEditValues;

    if (!instructorId) {
      setActionMessage({ type: "error", title: "Seleccioná un profesor para la serie." });
      return;
    }
    if (!activityType?.trim()) {
      setActionMessage({ type: "error", title: "Ingresá el tipo de actividad para la serie." });
      return;
    }

    const capacityValue = Number(capacityMax);
    if (!Number.isFinite(capacityValue) || capacityValue <= 0) {
      setActionMessage({ type: "error", title: "El cupo debe ser un número mayor a cero." });
      return;
    }

    const priceValue = Number(priceDecimal);
    if (!Number.isFinite(priceValue) || priceValue < 0) {
      setActionMessage({ type: "error", title: "El precio debe ser un número positivo." });
      return;
    }

    const payload = {
      instructorId: Number(instructorId),
      activityType: activityType.trim(),
      serviceId: serviceId === "" ? null : Number(serviceId),
      capacityMax: capacityValue,
      priceDecimal: priceValue,
      notes: notes ?? "",
      includePast,
    };

    setSeriesEditSaving(true);
    try {
      await apiClient.updateClassSeries(seriesModal.key, payload);
      setActionMessage({
        type: "success",
        title: "Serie actualizada",
        body: includePast
          ? "Se actualizaron todas las clases de la serie."
          : "Se actualizaron las próximas clases de la serie.",
      });
      await fetchSessions();

      const instructorName =
        instructors.find((sty) => String(sty.id) === String(instructorId))?.name ||
        seriesModal.instructor;

      setSeriesModal((prev) => {
        if (!prev || prev.key !== seriesModal.key) return prev;
        return {
          ...prev,
          instructor: instructorName,
          activity: payload.activityType || prev.activity,
          sessions: prev.sessions.map((session) => ({
            ...session,
            instructor_id: payload.instructorId,
            instructor_name: instructorName,
            service_id: payload.serviceId,
            activity_type: payload.activityType,
            capacity_max: payload.capacityMax,
            price_decimal: payload.priceDecimal,
            notes: payload.notes,
          })),
        };
      });

      setSeriesEditOpen(false);
    } catch (error) {
      setActionMessage({
        type: "error",
        title: "No se pudo actualizar la serie",
        body: error?.response?.data?.error || error?.message || "Intentá nuevamente más tarde.",
      });
    } finally {
      setSeriesEditSaving(false);
    }
  };

  const handleShareSeriesWhatsApp = useCallback(() => {
    if (!seriesModal) return;
    const activityLabel = groupActivityLabel({
      key: seriesModal.key,
      activity: seriesModal.activity,
    });
    const instructorName = seriesModal.instructor || "nuestro equipo";
    const firstClass = seriesModal.sessions?.[0]
      ? formatDateTime(seriesModal.sessions[0].starts_at)
      : "Próximamente";

    const scheduleMap = new Map();
    (seriesModal.sessions || []).forEach((session) => {
      const start = new Date(session.starts_at);
      const end = session.ends_at ? new Date(session.ends_at) : null;
      const day = start.toLocaleDateString("es-AR", { weekday: "long" });
      const normalizedDay = day.charAt(0).toUpperCase() + day.slice(1);
      const timeLabel = end
        ? `${start.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} – ${end.toLocaleTimeString(
            "es-AR",
            { hour: "2-digit", minute: "2-digit" }
          )}`
        : start.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
      if (!scheduleMap.has(normalizedDay)) {
        scheduleMap.set(normalizedDay, new Set());
      }
      scheduleMap.get(normalizedDay).add(timeLabel);
    });
    const scheduleLines = Array.from(scheduleMap.entries())
      .map(([day, times]) => `• ${day}: ${Array.from(times).join(", ")}`)
      .join("\n");

    const message = [
      `Hola! 👋`,
      `Te comparto la serie *${activityLabel}*.`,
      `Profesor: ${instructorName}`,
      `Primera clase: ${firstClass}`,
      scheduleLines ? `Horarios:\n${scheduleLines}` : "",
      `Si querés anotarte, respondeme por acá con tu nombre y teléfono. 🙌`,
    ]
      .filter(Boolean)
      .join("\n");

    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [seriesModal]);

  const groupedSessions = useMemo(() => {
    if (!groupBySeries) return [];
    const seriesMap = new Map();
    const sourceSessions = searchQuery ? filteredSessions : sessions;

    sourceSessions.forEach((session) => {
      const key = session.series_id || "__sin-serie__";
      const entry = seriesMap.get(key);
      if (entry) {
        entry.sessions.push(session);
        return;
      }

      seriesMap.set(key, {
        key,
        label: session.series_id ? session.series_id : "Sesiones sin serie",
        sessions: [session],
      });
    });

    const result = Array.from(seriesMap.values()).map((group) => {
      const ordered = [...group.sessions].sort(
        (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
      );

      const first = ordered[0];
      const representativeInstructor =
        ordered.find((s) => s.instructor_name)?.instructor_name || first?.instructor_name || "Sin asignar";
      const representativeActivity =
        ordered.find((s) => s.activity_type)?.activity_type || first?.activity_type || "Clase";
      const formattedHash =
        group.key === "__sin-serie__"
          ? ""
          : `SER-${String(group.key).slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, "")}`;

      return {
        ...group,
        sessions: ordered,
        instructor: representativeInstructor,
        activity: representativeActivity,
        hash: formattedHash,
        firstStartsAt: ordered[0]?.starts_at ? new Date(ordered[0].starts_at).getTime() : Number.MAX_SAFE_INTEGER,
      };
    });

    result.sort((a, b) => a.firstStartsAt - b.firstStartsAt);
    return result;
  }, [groupBySeries, sessions, searchQuery, filteredSessions]);

  const paginatedSessions = useMemo(() => {
    const source = searchQuery ? filteredSessions : sessions;
    const start = (page - 1) * pageSize;
    return groupBySeries ? source : source.slice(start, start + pageSize);
  }, [sessions, filteredSessions, searchQuery, page, pageSize, groupBySeries]);

  const paginatedSeries = useMemo(() => {
    const start = (page - 1) * pageSize;
    return groupBySeries ? groupedSessions.slice(start, start + pageSize) : groupedSessions;
  }, [groupedSessions, page, pageSize, groupBySeries]);

  const paginationInfo = useMemo(() => {
    const sourceSessions = searchQuery ? filteredSessions : sessions;
    const total = groupBySeries ? groupedSessions.length : sourceSessions.length;
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return { start, end, total, totalPages };
  }, [groupBySeries, groupedSessions.length, sessions.length, filteredSessions.length, searchQuery, page, pageSize]);

  const handleRepeatToggle = (enabled) => {
    setRepeatOptions((prev) => ({
      ...prev,
      enabled,
    }));
  };

  const handleRepeatFieldChange = (field, value) => {
    setRepeatOptions((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleAddPattern = () => {
    const baseStart = new Date(sessionForm.startsAt);
    const baseWeekday = Number.isNaN(baseStart.getTime()) ? 0 : baseStart.getDay();
    const baseTime = sessionForm.startsAt ? sessionForm.startsAt.slice(11, 16) : "09:00";

    setRepeatOptions((prev) => ({
      ...prev,
      patterns: [
        ...prev.patterns,
        {
          weekday: baseWeekday,
          startTime: baseTime,
          durationMin: sessionDurationMin || 60,
          instructorId: "",
          serviceId: "",
          capacityMax: "",
          priceDecimal: "",
          activityType: "",
          notes: "",
        },
      ],
    }));
  };

  const handlePatternFieldChange = (index, field, value) => {
    setRepeatOptions((prev) => {
      const patterns = [...prev.patterns];
      patterns[index] = { ...patterns[index], [field]: value };
      return { ...prev, patterns };
    });
  };

  const handleRemovePattern = (index) => {
    setRepeatOptions((prev) => ({
      ...prev,
      patterns: prev.patterns.filter((_, i) => i !== index),
    }));
  };

  // Funciones helper para estadísticas y presets de filtros - DEBEN estar antes de cualquier return condicional
  const getTodayStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todaySessions = sessions.filter((s) => {
      const sessionDate = new Date(s.starts_at);
      sessionDate.setHours(0, 0, 0, 0);
      return sessionDate.getTime() === today.getTime();
    });
    
    return {
      total: todaySessions.length,
      scheduled: todaySessions.filter((s) => s.status === "scheduled").length,
      completed: todaySessions.filter((s) => s.status === "completed").length,
      cancelled: todaySessions.filter((s) => s.status === "cancelled").length,
    };
  }, [sessions]);

  // Indicadores de urgencia: sesiones próximas (próximas 2 horas)
  const urgentSessions = useMemo(() => {
    const now = Date.now();
    const twoHoursFromNow = now + 2 * 60 * 60 * 1000;
    
    return sessions.filter((s) => {
      if (s.status !== "scheduled") return false;
      const sessionTime = new Date(s.starts_at).getTime();
      return sessionTime >= now && sessionTime <= twoHoursFromNow;
    });
  }, [sessions]);

  // Sesiones pendientes de confirmación (sin depósito si aplica)
  const pendingSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (s.status !== "scheduled") return false;
      // Aquí podrías agregar lógica adicional para detectar sesiones que requieren confirmación
      return false; // Por ahora retornamos vacío, pero se puede expandir
    });
  }, [sessions]);

  const applyFilterPreset = useCallback((preset) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let from, to;
    
    switch (preset) {
      case "today":
        from = toDateInputValue(today);
        to = toDateInputValue(today);
        break;
      case "tomorrow":
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        from = toDateInputValue(tomorrow);
        to = toDateInputValue(tomorrow);
        break;
      case "thisWeek":
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay() + 1); // Lunes
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6); // Domingo
        from = toDateInputValue(weekStart);
        to = toDateInputValue(weekEnd);
        break;
      case "nextWeek":
        const nextWeekStart = new Date(today);
        nextWeekStart.setDate(today.getDate() - today.getDay() + 8); // Próximo lunes
        const nextWeekEnd = new Date(nextWeekStart);
        nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
        from = toDateInputValue(nextWeekStart);
        to = toDateInputValue(nextWeekEnd);
        break;
      case "thisMonth":
        from = toDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1));
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        to = toDateInputValue(lastDay);
        break;
      case "next7Days":
        from = toDateInputValue(today);
        const in7Days = new Date(today);
        in7Days.setDate(today.getDate() + 7);
        to = toDateInputValue(in7Days);
        break;
      default:
        return;
    }
    
    setFilters((prev) => ({ ...prev, from, to }));
  }, []);

  // Usar sesiones filtradas en lugar de sesiones originales
  const displaySessions = searchQuery ? filteredSessions : sessions;

  if (businessInfoLoading) {
    return (
      <div className="p-8 flex items-center gap-3 text-foreground-secondary">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Cargando configuración…
      </div>
    );
  }

  if (!classesEnabled) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center space-y-4">
        <AlertCircle className="w-12 h-12 mx-auto text-amber-400" />
        <h1 className="text-3xl font-semibold text-foreground">Clases deshabilitadas</h1>
        <p className="text-foreground-secondary">
          Este negocio no tiene activada la gestión de clases grupales. Podés habilitarla desde{" "}
          <strong>Configuración → Sucursal → Features</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header mejorado con contadores y búsqueda */}
      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-foreground">Clases grupales</h1>
            <p className="text-foreground-secondary">
              Programá sesiones, gestioná plantillas y controlá inscripciones en un solo lugar.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => fetchSessions()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:border-primary-500 hover:text-primary-300 transition"
            >
              <RefreshCw className="w-4 h-4" />
              Refrescar
            </button>
            <button
              onClick={() => setTemplateFormOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary-500/10 text-secondary-200 border border-secondary-500/40 hover:bg-secondary-500/20 transition"
            >
              <Plus className="w-4 h-4" />
              Nueva plantilla
            </button>
            <button
              onClick={() => {
                setRepeatOptions(DEFAULT_REPEAT_OPTIONS);
                setSessionFormOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition"
            >
              <Plus className="w-4 h-4" />
              Programar clase
            </button>
          </div>
        </div>

        {/* Contadores del día y alertas de urgencia */}
        {(getTodayStats.total > 0 || urgentSessions.length > 0) && (
          <div className="space-y-3">
            {urgentSessions.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-amber-500/10 border-2 border-amber-500/50 animate-pulse">
                <AlertCircle className="w-5 h-5 text-amber-400" />
                <div className="flex-1">
                  <span className="text-sm font-semibold text-amber-200">
                    {urgentSessions.length} {urgentSessions.length === 1 ? "clase próxima" : "clases próximas"} en las próximas 2 horas
                  </span>
                </div>
                <button
                  onClick={() => {
                    setFilters((prev) => ({
                      ...prev,
                      from: toDateInputValue(new Date()),
                      to: toDateInputValue(new Date(Date.now() + 2 * 60 * 60 * 1000)),
                    }));
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-xs font-medium text-amber-200 hover:bg-amber-500/30 transition"
                >
                  Ver urgentes
                </button>
              </div>
            )}
            {getTodayStats.total > 0 && (
              <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-background-secondary/40 border border-border/60">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-primary-400" />
                  <span className="text-sm font-semibold text-foreground">Hoy:</span>
                </div>
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary-500/15 border border-primary-500/30">
                  <span className="text-xs text-primary-200">Total</span>
                  <span className="text-sm font-bold text-primary-100">{getTodayStats.total}</span>
                </div>
                {getTodayStats.scheduled > 0 && (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-500/15 border border-blue-500/30">
                    <span className="text-xs text-blue-200">Programadas</span>
                    <span className="text-sm font-bold text-blue-100">{getTodayStats.scheduled}</span>
                  </div>
                )}
                {getTodayStats.completed > 0 && (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-green-500/15 border border-green-500/30">
                    <span className="text-xs text-green-200">Completadas</span>
                    <span className="text-sm font-bold text-green-100">{getTodayStats.completed}</span>
                  </div>
                )}
                {getTodayStats.cancelled > 0 && (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/15 border border-red-500/30">
                    <span className="text-xs text-red-200">Canceladas</span>
                    <span className="text-sm font-bold text-red-100">{getTodayStats.cancelled}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Búsqueda global */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-foreground-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por actividad, profesor o serie..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background-secondary/40 text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 rounded hover:bg-background-secondary transition"
            >
              <X className="w-4 h-4 text-foreground-muted" />
            </button>
          )}
        </div>

        {/* Presets de filtros rápidos */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-foreground-secondary">Filtros rápidos:</span>
          {[
            { key: "today", label: "Hoy" },
            { key: "tomorrow", label: "Mañana" },
            { key: "thisWeek", label: "Esta semana" },
            { key: "nextWeek", label: "Próxima semana" },
            { key: "thisMonth", label: "Este mes" },
            { key: "next7Days", label: "Próximos 7 días" },
          ].map((preset) => {
            const isActive = 
              preset.key === "today" && filters.from === toDateInputValue(new Date()) && filters.to === toDateInputValue(new Date()) ||
              preset.key === "tomorrow" && filters.from === toDateInputValue(new Date(new Date().setDate(new Date().getDate() + 1))) ||
              preset.key === "thisWeek" || preset.key === "nextWeek" || preset.key === "thisMonth" || preset.key === "next7Days";
            
            return (
              <button
                key={preset.key}
                onClick={() => applyFilterPreset(preset.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                  isActive
                    ? "bg-primary-500 text-white border border-primary-400"
                    : "bg-background-secondary/40 text-foreground-secondary border border-border hover:border-primary-500/50 hover:text-primary-300"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <section className="card p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          {/* Botón para mostrar/ocultar filtros avanzados en móvil */}
          <div className="lg:hidden">
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:border-primary-500 hover:text-primary-300 transition w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <Filter className="w-4 h-4" />
                Filtros avanzados
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
            </button>
          </div>
          
          <div className={`grid grid-cols-1 md:grid-cols-5 gap-4 ${showAdvancedFilters || !isMobile ? '' : 'hidden'}`}>
            <div>
              <label className="text-xs uppercase tracking-wide text-foreground-secondary block mb-1">
                Desde
              </label>
              <input
                type="date"
                value={filters.from}
                onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
                className="input"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-foreground-secondary block mb-1">
                Hasta
              </label>
              <input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
                className="input"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-foreground-secondary block mb-1">
                Estado
              </label>
              <select
                value={filters.status}
                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                className="input"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-foreground-secondary block mb-1">
                Profesor
              </label>
              <select
                value={filters.instructorId}
                onChange={(e) => setFilters((prev) => ({ ...prev, instructorId: e.target.value }))}
                className="input"
              >
                <option value="">Todos</option>
                {instructors.map((sty) => (
                  <option key={sty.id} value={sty.id}>
                    {sty.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-foreground-secondary block mb-1">
                Actividad
              </label>
              <select
                value={filters.activityType}
                onChange={(e) => setFilters((prev) => ({ ...prev, activityType: e.target.value }))}
                className="input"
              >
                <option value="">Todas</option>
                {Array.from(new Set(sessions.map((session) => session.activity_type).filter(Boolean))).map((activity) => (
                  <option key={activity} value={activity}>
                    {activity}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col md:flex-row md:items-center md:justify-end gap-3">
            <label className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-foreground-secondary">
              <input
                type="checkbox"
                className="rounded"
                checked={groupBySeries}
                onChange={(e) => setGroupBySeries(e.target.checked)}
              />
              Agrupar por serie
            </label>
            <div className="flex items-center gap-2 text-sm text-foreground-secondary">
              <CalendarClock className="w-4 h-4" />
              {groupBySeries
                ? paginationInfo.total === 0
                  ? "Sin series"
                  : `Mostrando ${paginationInfo.start}-${paginationInfo.end} de ${paginationInfo.total} series`
                : displaySessions.length === 0
                  ? "Sin clases"
                  : `Mostrando ${paginationInfo.start}-${paginationInfo.end} de ${paginationInfo.total} clases`}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto border p-3 border-border rounded-xl">
          {sessionsLoading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-foreground-secondary">
              <RefreshCw className="w-6 h-6 animate-spin text-primary-400" />
              <p className="text-sm">Cargando clases…</p>
            </div>
          ) : sessionsError ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-center">
              <AlertCircle className="w-12 h-12 text-red-400" />
              <div>
                <p className="text-red-400 font-semibold mb-1">Error al cargar clases</p>
                <p className="text-sm text-foreground-secondary">{sessionsError}</p>
              </div>
              <button
                onClick={() => fetchSessions()}
                className="mt-2 px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition text-sm"
              >
                Reintentar
              </button>
            </div>
          ) : displaySessions.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center gap-4 text-center">
              <div className="p-4 rounded-full bg-background-secondary/40 border border-border/60">
                <Inbox className="w-12 h-12 text-foreground-muted" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {searchQuery ? "No se encontraron resultados" : "No hay clases programadas"}
                </h3>
                <p className="text-sm text-foreground-secondary mb-4 max-w-md">
                  {searchQuery
                    ? `No se encontraron clases que coincidan con "${searchQuery}". Intentá con otros términos de búsqueda.`
                    : "No se encontraron clases en este rango de fechas. Programá tu primera clase para comenzar."}
                </p>
                {!searchQuery && (
                  <button
                    onClick={() => {
                      setRepeatOptions(DEFAULT_REPEAT_OPTIONS);
                      setSessionFormOpen(true);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition"
                  >
                    <Plus className="w-4 h-4" />
                    Programar primera clase
                  </button>
                )}
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:border-primary-500 hover:text-primary-300 transition"
                  >
                    <X className="w-4 h-4" />
                    Limpiar búsqueda
                  </button>
                )}
              </div>
            </div>
          ) : groupBySeries ? (
            <>
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {paginatedSeries.map((group) => {
                const nextClass = group.sessions[0];
                const daySchedules = (() => {
                  const map = new Map();
                  group.sessions.forEach((s) => {
                    const startDate = new Date(s.starts_at);
                    const endDate = s.ends_at ? new Date(s.ends_at) : null;
                    const day = startDate.toLocaleDateString("es-AR", { weekday: "long" });
                    const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);
                    const timeLabel = endDate
                      ? `${startDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} – ${endDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`
                      : startDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
                    if (!map.has(dayLabel)) {
                      map.set(dayLabel, new Set());
                    }
                    map.get(dayLabel).add(timeLabel);
                  });
                  return Array.from(map.entries()).map(([day, times]) => ({
                    day,
                    times: Array.from(times),
                  }));
                })();
                // Calcular estadísticas de la serie
                const seriesStats = {
                  scheduled: group.sessions.filter((s) => s.status === "scheduled").length,
                  completed: group.sessions.filter((s) => s.status === "completed").length,
                  cancelled: group.sessions.filter((s) => s.status === "cancelled").length,
                };
                const nextUpcomingSession = group.sessions.find((s) => new Date(s.starts_at) >= new Date());
                const isUpcoming = nextUpcomingSession && new Date(nextUpcomingSession.starts_at).getTime() - Date.now() < 2 * 60 * 60 * 1000; // Próximas 2 horas

                return (
                  <article
                    key={group.key}
                    onClick={() => setSeriesModal(group)}
                    className={`rounded-2xl border bg-background-secondary/40 shadow-lg transition cursor-pointer flex flex-col p-5 space-y-4 ${
                      isUpcoming
                        ? "border-amber-500/50 shadow-amber-500/20 hover:shadow-amber-500/30"
                        : "border-border shadow-black/40 hover:shadow-primary-500/20"
                    }`}
                  >
                    <header className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs uppercase tracking-wide text-primary-200/70 font-semibold">
                            {group.key === "__sin-serie__" ? "Sin serie" : "Serie recurrente"}
                          </span>
                          {isUpcoming && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-medium text-amber-200">
                              <Clock className="w-3 h-3" />
                              Próxima
                            </span>
                          )}
                        </div>
                        {group.hash && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-primary-500/40 bg-primary-500/15 px-2 py-0.5 text-[10px] tracking-wider text-primary-100">
                            {group.hash}
                          </span>
                        )}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-foreground mb-1">
                          {groupActivityLabel({ key: group.key, activity: group.activity })}
                        </h3>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs text-foreground-secondary">
                            <Users className="w-3 h-3 inline mr-1" />
                            {group.instructor}
                          </p>
                          {seriesStats.scheduled > 0 && (
                            <StatusBadge status="scheduled" className="text-[10px] px-1.5 py-0.5" />
                          )}
                        </div>
                      </div>
                    </header>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="bg-background/40 p-2 rounded-lg">
                        <span className="text-foreground-muted uppercase block text-[10px] mb-1">Primera clase</span>
                        <span className="text-foreground font-semibold text-sm">
                          {formatDateTime(group.sessions[0]?.starts_at)}
                        </span>
                      </div>
                      <div className="bg-background/40 p-2 rounded-lg">
                        <span className="text-foreground-muted uppercase block text-[10px] mb-1">Última clase</span>
                        <span className="text-foreground font-semibold text-sm">
                          {formatDateTime(group.sessions[group.sessions.length - 1]?.starts_at)}
                        </span>
                      </div>
                      <div className="bg-background/40 p-2 rounded-lg">
                        <span className="text-foreground-muted uppercase block text-[10px] mb-1">Total</span>
                        <span className="text-foreground font-semibold text-sm">{group.sessions.length} clases</span>
                      </div>
                      <div className="bg-background/40 p-2 rounded-lg">
                        <span className="text-foreground-muted uppercase block text-[10px] mb-1">Próxima</span>
                        <span className="text-foreground font-semibold text-sm">
                          {nextClass ? formatDateTime(nextClass.starts_at) : "Sin fecha"}
                        </span>
                      </div>
                      <div className="col-span-2 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {seriesStats.scheduled > 0 && (
                            <span className="text-[10px] text-blue-200">
                              {seriesStats.scheduled} programadas
                            </span>
                          )}
                          {seriesStats.completed > 0 && (
                            <span className="text-[10px] text-green-200">
                              {seriesStats.completed} completadas
                            </span>
                          )}
                          {seriesStats.cancelled > 0 && (
                            <span className="text-[10px] text-red-200">
                              {seriesStats.cancelled} canceladas
                            </span>
                          )}
                        </div>
                        <div className="pt-2 border-t border-border/40">
                          <span className="text-foreground-muted uppercase block text-[10px] mb-1">Días y horarios</span>
                          {daySchedules.length ? (
                            <ul className="space-y-1">
                              {daySchedules.map(({ day, times }) => (
                                <li key={`schedule-${group.key}-${day}`} className="flex items-start gap-2 text-foreground text-xs">
                                  <span className="font-semibold min-w-[80px]">{day}</span>
                                  <span className="text-foreground-secondary">{times.join(", ")}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-foreground-secondary text-xs">—</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <footer className="flex items-center justify-between pt-3 border-t border-border/60">
                      <span className="text-xs text-foreground-muted">Click para ver detalle</span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-primary-500/50 bg-primary-500/15 text-[11px] font-medium text-primary-200 hover:bg-primary-500/25 transition">
                        Ver detalle →
                      </span>
                    </footer>
                  </article>
                );
              })}
              </div>
              {groupBySeries && paginationInfo.total > 0 && (
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-4 py-4 border-t border-border bg-background/40 mt-6 rounded-2xl">
                  <div className="text-xs text-foreground-secondary">
                    Página {page} de {paginationInfo.totalPages}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-xs text-foreground-secondary flex items-center gap-2">
                      Mostrar
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setPage(1);
                        }}
                        className="input text-xs w-auto px-2 py-1"
                      >
                        {[6, 9, 12].map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                      series
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                        disabled={page === 1}
                        className="px-2 py-1 rounded-lg border border-border text-xs text-foreground-secondary hover:bg-background-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        ◀
                      </button>
                      <button
                        onClick={() => setPage((prev) => Math.min(paginationInfo.totalPages, prev + 1))}
                        disabled={page === paginationInfo.totalPages}
                        className="px-2 py-1 rounded-lg border border-border text-xs text-foreground-secondary hover:bg-background-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        ▶
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Vista de tabla en desktop */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background-secondary text-foreground-muted text-xs uppercase tracking-wide">
                      <th className="py-3 px-4 text-left">Inicio</th>
                      <th className="py-3 px-4 text-left">Actividad</th>
                      <th className="py-3 px-4 text-left">Serie</th>
                      <th className="py-3 px-4 text-left">Profesor</th>
                      <th className="py-3 px-4 text-left">Cupo</th>
                      <th className="py-3 px-4 text-left">Precio</th>
                      <th className="py-3 px-4 text-left">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedSessions.map((session) => {
                      const isSelected = String(session.id) === String(selectedSessionId);
                      return (
                        <tr
                          key={session.id}
                          onClick={() => setSelectedSessionId(session.id)}
                          className={`border-b border-border cursor-pointer hover:bg-background-secondary transition ${
                            isSelected ? "bg-primary-500/10" : ""
                          }`}
                        >
                          <td className="py-3 px-4 font-medium text-foreground">{formatDateTime(session.starts_at)}</td>
                          <td className="py-3 px-4 text-foreground-secondary">{session.activity_type}</td>
                          <td className="py-3 px-4 text-foreground-secondary">
                            {formatSeriesId(session.series_id)}
                          </td>
                          <td className="py-3 px-4 text-foreground-secondary">{session.instructor_name}</td>
                          <td className="py-3 px-4 text-foreground-secondary">
                            {session.capacity_max} lugares
                          </td>
                          <td className="py-3 px-4 text-foreground-secondary">{currency(session.price_decimal)}</td>
                          <td className="py-3 px-4">
                            <StatusBadge status={session.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              
              {/* Vista de cards en móvil */}
              <div className="md:hidden space-y-4">
                {paginatedSessions.map((session) => {
                  const isSelected = String(session.id) === String(selectedSessionId);
                  const isUpcoming = new Date(session.starts_at).getTime() - Date.now() < 2 * 60 * 60 * 1000 && new Date(session.starts_at) >= new Date();
                  
                  return (
                    <article
                      key={session.id}
                      onClick={() => setSelectedSessionId(session.id)}
                      className={`rounded-xl border p-4 cursor-pointer transition ${
                        isSelected
                          ? "bg-primary-500/10 border-primary-500/50"
                          : isUpcoming
                          ? "bg-background-secondary/40 border-amber-500/50 hover:border-amber-500/70"
                          : "bg-background-secondary/40 border-border hover:border-primary-500/50"
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Clock className="w-4 h-4 text-primary-400" />
                            <span className="font-semibold text-foreground">{formatDateTime(session.starts_at)}</span>
                            {isUpcoming && (
                              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-medium text-amber-200">
                                Próxima
                              </span>
                            )}
                          </div>
                          <h3 className="text-base font-semibold text-foreground mb-1">{session.activity_type}</h3>
                          <p className="text-sm text-foreground-secondary">{session.instructor_name}</p>
                        </div>
                        <StatusBadge status={session.status} />
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs pt-3 border-t border-border/40">
                        <div>
                          <span className="text-foreground-muted block mb-1">Serie</span>
                          <span className="text-foreground font-medium">{formatSeriesId(session.series_id)}</span>
                        </div>
                        <div>
                          <span className="text-foreground-muted block mb-1">Cupo</span>
                          <span className="text-foreground font-medium">{session.capacity_max} lugares</span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-foreground-muted block mb-1">Precio</span>
                          <span className="text-foreground font-semibold">{currency(session.price_decimal)}</span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              {!groupBySeries && paginationInfo.total > 0 && (
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-4 py-4 border-t border-border bg-background/40">
                  <div className="text-xs text-foreground-secondary">
                    Página {page} de {paginationInfo.totalPages}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-xs text-foreground-secondary flex items-center gap-2">
                      Mostrar
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setPage(1);
                        }}
                        className="input text-xs w-auto px-2 py-1"
                      >
                        {[10, 25, 50].map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                      clases
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                        disabled={page === 1}
                        className="px-2 py-1 rounded-lg border border-border text-xs text-foreground-secondary hover:bg-background-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        ◀
                      </button>
                      <button
                        onClick={() => setPage((prev) => Math.min(paginationInfo.totalPages, prev + 1))}
                        disabled={page === paginationInfo.totalPages}
                        className="px-2 py-1 rounded-lg border border-border text-xs text-foreground-secondary hover:bg-background-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        ▶
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="card p-5 space-y-4 xl:col-span-2">
          <h2 className="text-lg font-semibold text-foreground">Plantillas</h2>
          {templatesLoading ? (
            <div className="py-6 flex items-center gap-2 text-foreground-secondary">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Cargando plantillas…
            </div>
          ) : templatesError ? (
            <div className="py-6 text-red-400">{templatesError}</div>
          ) : templates.length === 0 ? (
            <div className="py-6 text-foreground-secondary">Aún no cargaste plantillas.</div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {templates.map((tpl) => (
                <article
                  key={tpl.id}
                  className="rounded-xl border border-border bg-background-secondary/40 p-4 space-y-2"
                >
                  <header className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-md font-semibold text-foreground">{tpl.name}</h3>
                      <p className="text-sm text-foreground-secondary">{tpl.activity_type}</p>
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded-lg ${
                        tpl.is_active ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"
                      }`}
                    >
                      {tpl.is_active ? "Activa" : "Inactiva"}
                    </span>
                  </header>
                  {tpl.description && (
                    <p className="text-sm text-foreground-secondary line-clamp-2">{tpl.description}</p>
                  )}
                  <dl className="grid grid-cols-2 gap-2 text-xs text-foreground-secondary">
                    <div className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5" />
                      <span>Cupo: {tpl.default_capacity}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-3.5 h-3.5" />
                      <span>{currency(tpl.default_price_decimal)}</span>
                    </div>
                  </dl>
                  <button
                    className="text-xs text-primary-300 hover:text-primary-200 transition"
                    onClick={() => handleTemplateApply(tpl.id)}
                  >
                    Usar en nueva clase
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="card p-5 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Detalle de la clase</h2>

          {!selectedSessionId ? (
            <p className="text-sm text-foreground-secondary">
              Seleccioná una fila en la tabla para ver inscripciones y acciones rápidas.
            </p>
          ) : detailLoading ? (
            <div className="py-6 flex items-center gap-2 text-foreground-secondary">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Cargando detalle…
            </div>
          ) : detailError ? (
            <p className="text-sm text-red-400">{detailError}</p>
          ) : !sessionDetail ? (
            <p className="text-sm text-foreground-secondary">No se encontró información para esta clase.</p>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-background-secondary/50 p-4 space-y-3">
                <div>
                  <p className="text-xs uppercase text-foreground-muted tracking-wide">Actividad</p>
                  <p className="text-sm font-medium text-foreground">{sessionDetail.activity_type}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm text-foreground-secondary">
                  <div>
                    <span className="text-xs uppercase text-foreground-muted block">Inicio</span>
                    {formatDateTime(sessionDetail.starts_at)}
                  </div>
                  <div>
                    <span className="text-xs uppercase text-foreground-muted block">Fin</span>
                    {formatDateTime(sessionDetail.ends_at)}
                  </div>
                  <div>
                    <span className="text-xs uppercase text-foreground-muted block">Profesor</span>
                    {sessionDetail.instructor_name}
                  </div>
                  <div>
                    <span className="text-xs uppercase text-foreground-muted block">Precio</span>
                    {currency(sessionDetail.price_decimal)}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm text-foreground-secondary">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-border/40 bg-background/60 text-xs">
                    Serie: {formatSeriesId(sessionDetail.series_id)}
                  </span>
                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-500/10 text-primary-200 border border-primary-500/20 text-xs font-medium">
                    {sessionDetail.status}
                  </span>
                </div>
                {sessionDetail.notes && (
                  <p className="text-sm text-foreground-secondary border-t border-border pt-3">
                    {sessionDetail.notes}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleCloseSession(sessionDetail.id, "completed")}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition text-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Marcar como completada
                  </button>
                  <button
                    onClick={() => handleCancelSession(sessionDetail.id)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10 transition text-xs"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Cancelar clase
                  </button>
                  {sessionDetail.series_id && (
                    <button
                      onClick={() => handleCancelSeries(sessionDetail.series_id)}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10 transition text-xs"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Cancelar serie completa
                    </button>
                  )}
                </div>
              </div>

              <form onSubmit={handleAddEnrollment} className="bg-background-secondary/60 border-2 border-border rounded-2xl p-5 space-y-4 shadow-lg">
                <h3 className="text-base font-bold text-foreground flex items-center gap-2 mb-4">
                  <UserPlus className="w-5 h-5 text-primary-400" />
                  Añadir alumno
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-foreground">Nombre</span>
                    <input
                      className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                      placeholder="Nombre del alumno"
                      value={enrollForm.customerName}
                      onChange={(e) => setEnrollForm((prev) => ({ ...prev, customerName: e.target.value }))}
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                      Teléfono
                      <span className="text-red-400">*</span>
                    </span>
                    <input
                      className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                      placeholder="+54911..."
                      value={enrollForm.customerPhone}
                      onChange={(e) => setEnrollForm((prev) => ({ ...prev, customerPhone: e.target.value }))}
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      ID cliente
                      <span className="text-xs font-normal text-foreground-muted ml-2">(opcional)</span>
                    </span>
                    <input
                      className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                      placeholder="ID del cliente existente"
                      value={enrollForm.customerId}
                      onChange={(e) => setEnrollForm((prev) => ({ ...prev, customerId: e.target.value }))}
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      Notas
                      <span className="text-xs font-normal text-foreground-muted ml-2">(opcional)</span>
                    </span>
                    <input
                      className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                      placeholder="Notas adicionales"
                      value={enrollForm.notes}
                      onChange={(e) => setEnrollForm((prev) => ({ ...prev, notes: e.target.value }))}
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={savingEnrollment}
                  className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-primary-500 text-white hover:bg-primary-600 transition disabled:opacity-60 disabled:cursor-not-allowed font-semibold text-base shadow-lg shadow-primary-500/20"
                >
                  {savingEnrollment ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                  Inscribir alumno
                </button>
              </form>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Inscripciones ({sessionDetail.enrollments?.length || 0})
                </h3>

                {sessionDetail.enrollments?.length ? (
                  <div className="space-y-2">
                    {sessionDetail.enrollments.map((enrollment) => (
                      <div
                        key={enrollment.id}
                        className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border border-border rounded-lg px-3 py-2"
                      >
                        <div>
                          <p className="text-sm text-foreground font-medium">
                            {enrollment.customer_name || "Cliente sin nombre"}
                          </p>
                          <p className="text-xs text-foreground-secondary">
                            {enrollment.customer_phone || "Sin teléfono"}
                          </p>
                          {enrollment.notes && (
                            <p className="text-xs text-foreground-secondary mt-1">{enrollment.notes}</p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <select
                            value={enrollment.status}
                            onChange={(e) => handleUpdateEnrollment(enrollment.id, e.target.value)}
                            className="input text-xs"
                          >
                            {ENROLLMENT_STATUS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleDeleteEnrollment(enrollment.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-red-300 hover:text-red-200"
                          >
                            <XCircle className="w-3 h-3" />
                            Eliminar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-foreground-secondary">Aún no hay alumnos inscriptos.</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {sessionFormOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 overflow-y-auto p-4" onClick={(e) => e.target === e.currentTarget && setSessionFormOpen(false)}>
          <div className="max-w-3xl w-full mx-auto my-8 bg-background border-2 border-border rounded-2xl shadow-2xl overflow-y-auto max-h-[90vh]">
            <header className="flex items-center justify-between px-6 py-5 border-b-2 border-border bg-background-secondary/40">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Programar nueva clase</h2>
                <p className="text-sm text-foreground-secondary">
                  Completá la información para agregar una sesión al calendario.
                </p>
              </div>
              <button
                onClick={() => {
                  setSessionFormOpen(false);
                  setRepeatOptions(DEFAULT_REPEAT_OPTIONS);
                }}
                className="p-2 rounded-full hover:bg-background-secondary transition"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </header>
            <div className="px-6 pt-5">
              <ActionBanner message={actionMessage} onClose={dismissMessage} />
            </div>
            <form onSubmit={handleSessionFormSubmit} className="px-6 py-5 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    Plantilla
                    <span className="text-xs font-normal text-foreground-muted">(opcional)</span>
                  </span>
                  <select
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                    value={sessionForm.templateId}
                    onChange={(e) => handleTemplateApply(e.target.value)}
                  >
                    <option value="">Sin plantilla</option>
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    Tipo de actividad
                    <span className="text-red-400">*</span>
                  </span>
                  <input
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                    value={sessionForm.activityType}
                    onChange={(e) => handleSessionFormChange("activityType", e.target.value)}
                    placeholder="Ej: Yoga, Pilates, Spinning..."
                    required
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    Profesor
                    <span className="text-red-400">*</span>
                  </span>
                  <select
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                    value={sessionForm.instructorId}
                    onChange={(e) => handleSessionFormChange("instructorId", e.target.value)}
                    required
                  >
                    <option value="">Seleccionar profesor</option>
                    {instructors.map((sty) => (
                      <option key={sty.id} value={sty.id}>
                        {sty.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    Servicio
                    <span className="text-xs font-normal text-foreground-muted">(opcional)</span>
                  </span>
                  <select
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                    value={sessionForm.serviceId}
                    onChange={(e) => handleSessionFormChange("serviceId", e.target.value)}
                  >
                    <option value="">Sin servicio asociado</option>
                    {services.map((svc) => (
                      <option key={svc.id} value={svc.id}>
                        {svc.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    Sucursal
                    <span className="text-red-400">*</span>
                  </span>
                  <select
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base disabled:opacity-50 disabled:cursor-not-allowed"
                    value={sessionForm.branchId || ""}
                    onChange={(e) => handleSessionFormChange("branchId", e.target.value)}
                    disabled={branchesLoading || branches.length === 0}
                    required
                  >
                    {branchesLoading ? (
                      <option value="">Cargando sucursales...</option>
                    ) : branches.length === 0 ? (
                      <option value="">No hay sucursales activas</option>
                    ) : (
                      branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    Fecha y hora de inicio
                    <span className="text-red-400">*</span>
                  </span>
                  <input
                    type="datetime-local"
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                    value={sessionForm.startsAt}
                    onChange={(e) => {
                      handleSessionFormChange("startsAt", e.target.value);
                      // Calcular automáticamente la fecha de fin basada en la duración
                      if (e.target.value && sessionDurationMin > 0) {
                        const calculatedEnd = addMinutesToISO(e.target.value, sessionDurationMin);
                        handleSessionFormChange("endsAt", calculatedEnd);
                      }
                    }}
                    required
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    Duración (minutos)
                    <span className="text-red-400">*</span>
                  </span>
                  <input
                    type="number"
                    min={1}
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                    value={sessionDurationMin}
                    onChange={(e) => {
                      const newDuration = Number(e.target.value || 0);
                      setSessionDurationMin(newDuration);
                      // Calcular automáticamente la fecha de fin cuando cambia la duración
                      if (sessionForm.startsAt && newDuration > 0) {
                        const calculatedEnd = addMinutesToISO(sessionForm.startsAt, newDuration);
                        handleSessionFormChange("endsAt", calculatedEnd);
                      }
                    }}
                    placeholder="60"
                    required
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    Cupo máximo
                    <span className="text-red-400">*</span>
                  </span>
                  <input
                    type="number"
                    min={1}
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                    value={sessionForm.capacityMax}
                    onChange={(e) => handleSessionFormChange("capacityMax", e.target.value)}
                    placeholder="10"
                    required
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    Precio
                    <span className="text-xs font-normal text-foreground-muted">(opcional)</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                    value={sessionForm.priceDecimal}
                    onChange={(e) => handleSessionFormChange("priceDecimal", e.target.value)}
                    placeholder="0.00"
                  />
                </label>

                <label className="flex flex-col gap-2 md:col-span-2">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    Notas
                    <span className="text-xs font-normal text-foreground-muted">(opcional)</span>
                  </span>
                  <textarea
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base min-h-[100px] resize-y"
                    value={sessionForm.notes}
                    onChange={(e) => handleSessionFormChange("notes", e.target.value)}
                    placeholder="Notas adicionales sobre la clase..."
                  />
                </label>
              </div>

              <div className="rounded-2xl border-2 border-border bg-background-secondary/60 p-5 space-y-5 shadow-lg">
                <label className="flex items-center gap-3 text-base font-semibold text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-5 h-5 rounded border-2 border-border text-primary-500 focus:ring-2 focus:ring-primary-500/50 cursor-pointer"
                    checked={repeatOptions.enabled}
                    onChange={(e) => handleRepeatToggle(e.target.checked)}
                  />
                  Repetir semanalmente
                </label>

                {repeatOptions.enabled && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-foreground">Semanas (incluye la actual)</span>
                        <input
                          type="number"
                          min={1}
                          className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                          value={repeatOptions.weeks}
                          onChange={(e) => handleRepeatFieldChange("weeks", e.target.value)}
                          placeholder="4"
                        />
                      </label>
                      <div className="md:col-span-2 text-sm text-foreground-secondary bg-background/40 p-4 rounded-xl border border-border/60">
                        Elegí cuántas semanas se generarán automáticamente. Podés sumar múltiples días y horarios por
                        semana con configuraciones personalizadas.
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/60 bg-background p-3 text-xs text-foreground-secondary">
                      La clase base se programará el {formatDateTime(sessionForm.startsAt)}. También se crearán todas las
                      repeticiones configuradas para las semanas indicadas.
                    </div>

                    <div className="space-y-4">
                      {repeatOptions.patterns.map((pattern, index) => (
                        <div key={`repeat-pattern-${index}`} className="rounded-xl border-2 border-border bg-background-secondary/40 p-5 space-y-4 shadow-md">
                          <div className="flex items-center justify-between pb-3 border-b border-border">
                            <span className="text-base font-bold text-foreground">Repetición #{index + 1}</span>
                            <button
                              type="button"
                              onClick={() => handleRemovePattern(index)}
                              className="px-3 py-1.5 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/30 transition"
                            >
                              Quitar
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                            <label className="flex flex-col gap-2">
                              <span className="text-sm font-semibold text-foreground">Día</span>
                              <select
                                className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                                value={pattern.weekday}
                                onChange={(e) => handlePatternFieldChange(index, "weekday", Number(e.target.value))}
                              >
                                {WEEKDAY_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="flex flex-col gap-2">
                              <span className="text-sm font-semibold text-foreground">Hora</span>
                              <input
                                type="time"
                                className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                                value={pattern.startTime || ""}
                                onChange={(e) => handlePatternFieldChange(index, "startTime", e.target.value)}
                              />
                            </label>

                            <label className="flex flex-col gap-2">
                              <span className="text-sm font-semibold text-foreground">Duración (min)</span>
                              <input
                                type="number"
                                min={15}
                                className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                                value={pattern.durationMin ?? ""}
                                onChange={(e) => handlePatternFieldChange(index, "durationMin", e.target.value)}
                                placeholder={String(sessionDurationMin || 60)}
                              />
                            </label>

                            <label className="flex flex-col gap-2">
                              <span className="text-sm font-semibold text-foreground">Profesor</span>
                              <select
                                className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                                value={pattern.instructorId}
                                onChange={(e) => handlePatternFieldChange(index, "instructorId", e.target.value)}
                              >
                                <option value="">Usar profesor base</option>
                                {instructors.map((sty) => (
                                  <option key={sty.id} value={sty.id}>
                                    {sty.name}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="flex flex-col gap-2">
                              <span className="text-sm font-semibold text-foreground">Cupo</span>
                              <input
                                type="number"
                                min={1}
                                className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                                value={pattern.capacityMax ?? ""}
                                onChange={(e) => handlePatternFieldChange(index, "capacityMax", e.target.value)}
                                placeholder={String(sessionForm.capacityMax || 1)}
                              />
                            </label>

                            <label className="flex flex-col gap-2">
                              <span className="text-sm font-semibold text-foreground">Precio</span>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                                value={pattern.priceDecimal ?? ""}
                                onChange={(e) => handlePatternFieldChange(index, "priceDecimal", e.target.value)}
                                placeholder={String(sessionForm.priceDecimal || 0)}
                              />
                            </label>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className="flex flex-col gap-2">
                              <span className="text-sm font-semibold text-foreground">Actividad</span>
                              <input
                                className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                                value={pattern.activityType || ""}
                                onChange={(e) => handlePatternFieldChange(index, "activityType", e.target.value)}
                                placeholder="Usar actividad base"
                              />
                            </label>
                            <label className="flex flex-col gap-2">
                              <span className="text-sm font-semibold text-foreground">Servicio</span>
                              <select
                                className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                                value={pattern.serviceId || ""}
                                onChange={(e) => handlePatternFieldChange(index, "serviceId", e.target.value)}
                              >
                                <option value="">Usar servicio base</option>
                                {services.map((svc) => (
                                  <option key={svc.id} value={svc.id}>
                                    {svc.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <label className="flex flex-col gap-2">
                            <span className="text-sm font-semibold text-foreground">Notas</span>
                            <textarea
                              className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base min-h-[80px] resize-y"
                              value={pattern.notes || ""}
                              onChange={(e) => handlePatternFieldChange(index, "notes", e.target.value)}
                              placeholder="Notas específicas para esta repetición"
                            />
                          </label>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={handleAddPattern}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-border text-base font-semibold text-foreground hover:bg-background-secondary hover:border-primary-500/50 transition"
                      >
                        <Plus className="w-5 h-5" />
                        Agregar día y horario
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t-2 border-border">
                <button
                  type="button"
                  onClick={() => {
                    setSessionFormOpen(false);
                    setRepeatOptions(DEFAULT_REPEAT_OPTIONS);
                  }}
                  className="px-6 py-3 rounded-xl border-2 border-border text-foreground-secondary hover:bg-background-secondary transition font-semibold text-base"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingSession}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary-500 text-white hover:bg-primary-600 transition disabled:opacity-60 disabled:cursor-not-allowed font-semibold text-base shadow-lg shadow-primary-500/20"
                >
                  {savingSession ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                  Guardar clase
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {templateFormOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 overflow-y-auto p-4" onClick={(e) => e.target === e.currentTarget && setTemplateFormOpen(false)}>
          <div className="max-w-2xl w-full mx-auto my-8 bg-background border-2 border-border rounded-2xl shadow-2xl overflow-y-auto max-h-[85vh]">
            <header className="flex items-center justify-between px-6 py-5 border-b-2 border-border bg-background-secondary/40">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Nueva plantilla de clase</h2>
                <p className="text-sm text-foreground-secondary">
                  Guardá configuraciones frecuentes y reutilizalas al programar sesiones.
                </p>
              </div>
              <button
                onClick={() => setTemplateFormOpen(false)}
                className="p-2 rounded-full hover:bg-background-secondary transition"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </header>
            <form onSubmit={handleTemplateFormSubmit} className="px-6 py-5 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    Nombre de la plantilla
                    <span className="text-red-400">*</span>
                  </span>
                  <input
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                    placeholder="Ej: Yoga Matutino"
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm((prev) => ({ ...prev, name: e.target.value }))}
                    required
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    Tipo de actividad
                    <span className="text-red-400">*</span>
                  </span>
                  <input
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                    value={templateForm.activityType}
                    onChange={(e) => setTemplateForm((prev) => ({ ...prev, activityType: e.target.value }))}
                    placeholder="Ej: Yoga, Pilates..."
                    required
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    Cupo por defecto
                    <span className="text-red-400">*</span>
                  </span>
                  <input
                    type="number"
                    min={1}
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                    value={templateForm.defaultCapacity}
                    onChange={(e) => setTemplateForm((prev) => ({ ...prev, defaultCapacity: e.target.value }))}
                    placeholder="10"
                    required
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground">Duración (minutos)</span>
                  <input
                    type="number"
                    min={1}
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                    value={templateForm.defaultDurationMin}
                    onChange={(e) =>
                      setTemplateForm((prev) => ({ ...prev, defaultDurationMin: e.target.value }))
                    }
                    placeholder="60"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground">Precio sugerido</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                    value={templateForm.defaultPriceDecimal}
                    onChange={(e) =>
                      setTemplateForm((prev) => ({ ...prev, defaultPriceDecimal: e.target.value }))
                    }
                    placeholder="0.00"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-foreground">Profesor por defecto</span>
                  <select
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base"
                    value={templateForm.defaultInstructorId}
                    onChange={(e) => setTemplateForm((prev) => ({ ...prev, defaultInstructorId: e.target.value }))}
                  >
                    <option value="">Sin asignar</option>
                    {instructors.map((sty) => (
                      <option key={sty.id} value={sty.id}>
                        {sty.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-2 md:col-span-2">
                  <span className="text-sm font-semibold text-foreground">Descripción</span>
                  <textarea
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition text-base min-h-[100px] resize-y"
                    value={templateForm.description}
                    onChange={(e) => setTemplateForm((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Descripción de la plantilla..."
                  />
                </label>
                <label className="flex items-center gap-3 text-base font-semibold text-foreground cursor-pointer md:col-span-2">
                  <input
                    type="checkbox"
                    className="w-5 h-5 rounded border-2 border-border text-primary-500 focus:ring-2 focus:ring-primary-500/50 cursor-pointer"
                    checked={templateForm.isActive}
                    onChange={(e) => setTemplateForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                  />
                  Plantilla activa
                </label>
              </div>
              <div className="flex items-center justify-end gap-3 pt-4 border-t-2 border-border">
                <button
                  type="button"
                  onClick={() => setTemplateFormOpen(false)}
                  className="px-6 py-3 rounded-xl border-2 border-border text-foreground-secondary hover:bg-background-secondary transition font-semibold text-base"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingTemplate}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary-500 text-white hover:bg-primary-600 transition disabled:opacity-60 disabled:cursor-not-allowed font-semibold text-base shadow-lg shadow-primary-500/20"
                >
                  {savingTemplate ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                  Guardar plantilla
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {seriesModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSeriesModal(null);
          }}
        >
          <div className="w-full max-w-3xl bg-background border border-border rounded-3xl shadow-2xl overflow-hidden">
            <header className="flex items-center justify-between px-6 py-4 border-b border-border gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-foreground-muted">
                  {seriesModal.hash || "SERIE"}
                </p>
                <h2 className="text-xl font-semibold text-foreground">
                  {groupActivityLabel({ key: seriesModal.key, activity: seriesModal.activity })}
                </h2>
                <p className="text-sm text-foreground-secondary">
                  Profesor principal:{" "}
                  <span className="font-medium text-foreground">{seriesModal.instructor}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {seriesModal.key !== "__sin-serie__" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSeriesEditOpen((prev) => !prev)}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary-500/40 text-primary-100 hover:bg-primary-500/15 transition"
                    >
                      <PencilLine className="w-4 h-4" />
                      {seriesEditOpen ? "Cerrar edición" : "Editar serie"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelSeries(seriesModal.key)}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-red-500/40 text-red-200 hover:bg-red-500/15 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                      Eliminar serie
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleShareSeriesWhatsApp}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/15 transition"
                >
                  <MessageCircle className="w-4 h-4" />
                  Compartir por WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => setSeriesModal(null)}
                  className="px-3 py-1.5 rounded-full border border-border text-sm text-foreground-secondary hover:bg-background-secondary transition"
                >
                  Cerrar
                </button>
              </div>
            </header>
            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3 text-xs text-foreground-secondary">
                <div>
                  <span className="text-foreground-muted uppercase block">Primera clase</span>
                  <span className="text-foreground font-medium">
                    {formatDateTime(seriesModal.sessions[0]?.starts_at)}
                  </span>
                </div>
                <div>
                  <span className="text-foreground-muted uppercase block">Última clase</span>
                  <span className="text-foreground font-medium">
                    {formatDateTime(seriesModal.sessions[seriesModal.sessions.length - 1]?.starts_at)}
                  </span>
                </div>
                <div>
                  <span className="text-foreground-muted uppercase block">Total de clases</span>
                  <span className="text-foreground font-medium">{seriesModal.sessions.length}</span>
                </div>
                <div>
                  <span className="text-foreground-muted uppercase block">Serie</span>
                  <span className="text-foreground font-medium">{seriesModal.hash || "—"}</span>
                </div>
              </div>
              <table className="w-full text-sm border border-border/60 rounded-2xl overflow-hidden">
                <thead className="bg-background-secondary">
                  <tr className="text-xs uppercase tracking-wide text-foreground-muted">
                    <th className="py-3 px-4 text-left">Inicio</th>
                    <th className="py-3 px-4 text-left">Profesor</th>
                    <th className="py-3 px-4 text-left">Cupo</th>
                    <th className="py-3 px-4 text-left">Precio</th>
                    <th className="py-3 px-4 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {seriesModal.sessions.map((session) => (
                    <tr key={`modal-session-${session.id}`} className="border-t border-border/50">
                      <td className="py-3 px-4 text-foreground">{formatDateTime(session.starts_at)}</td>
                      <td className="py-3 px-4 text-foreground-secondary">{session.instructor_name}</td>
                      <td className="py-3 px-4 text-foreground-secondary">{session.capacity_max} lugares</td>
                      <td className="py-3 px-4 text-foreground-secondary">{currency(session.price_decimal)}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
                            session.status === "scheduled"
                              ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40"
                              : session.status === "completed"
                                ? "bg-primary/10 text-primary border border-primary/20"
                                : "bg-red-500/10 text-red-300 border border-red-500/40"
                          }`}
                        >
                          {session.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {seriesModal.key !== "__sin-serie__" && seriesEditOpen && (
                <div className="border border-border/60 rounded-2xl bg-background-secondary/40 p-4 space-y-4">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold text-foreground">Editar datos de la serie</h3>
                    <p className="text-xs text-foreground-secondary">
                      Los cambios se aplican a todas las clases programadas {seriesEditValues.includePast ? "(incluidas las pasadas)." : "a partir de hoy."}
                    </p>
                  </div>
                  <form className="space-y-4" onSubmit={handleSeriesEditSubmit}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1 text-xs text-foreground-secondary">
                        Profesor
                        <select
                          className="input"
                          value={seriesEditValues.instructorId}
                          onChange={(e) => handleSeriesEditChange("instructorId", e.target.value)}
                          required
                        >
                          <option value="">Seleccioná un profesor</option>
                          {instructors.map((sty) => (
                            <option key={`series-edit-instructor-${sty.id}`} value={String(sty.id)}>
                              {sty.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-foreground-secondary">
                        Actividad
                        <input
                          className="input"
                          value={seriesEditValues.activityType}
                          onChange={(e) => handleSeriesEditChange("activityType", e.target.value)}
                          placeholder="Ej: Yoga intermedio"
                          required
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="flex flex-col gap-1 text-xs text-foreground-secondary">
                        Servicio
                        <select
                          className="input"
                          value={seriesEditValues.serviceId}
                          onChange={(e) => handleSeriesEditChange("serviceId", e.target.value)}
                        >
                          <option value="">Sin servicio asociado</option>
                          {services.map((svc) => (
                            <option key={`series-edit-service-${svc.id}`} value={String(svc.id)}>
                              {svc.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-foreground-secondary">
                        Cupo
                        <input
                          type="number"
                          min={1}
                          className="input"
                          value={seriesEditValues.capacityMax}
                          onChange={(e) => handleSeriesEditChange("capacityMax", e.target.value)}
                          required
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-foreground-secondary">
                        Precio
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="input"
                          value={seriesEditValues.priceDecimal}
                          onChange={(e) => handleSeriesEditChange("priceDecimal", e.target.value)}
                          required
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-1 text-xs text-foreground-secondary">
                      Notas para la serie
                      <textarea
                        className="input min-h-[72px]"
                        value={seriesEditValues.notes}
                        onChange={(e) => handleSeriesEditChange("notes", e.target.value)}
                        placeholder="Comentarios visibles en cada clase"
                      />
                    </label>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="inline-flex items-center gap-2 text-xs text-foreground-secondary">
                        <input
                          type="checkbox"
                          checked={seriesEditValues.includePast}
                          onChange={(e) => handleSeriesEditChange("includePast", e.target.checked)}
                        />
                        Aplicar también a clases pasadas
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            resetSeriesEditForm();
                            setSeriesEditOpen(false);
                          }}
                          className="px-3 py-1.5 rounded-full border border-border text-xs text-foreground-secondary hover:bg-background-secondary transition"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={seriesEditSaving}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-500 text-white text-xs hover:bg-primary-600 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {seriesEditSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                          Guardar cambios
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              )}
              <div className="border border-border/60 rounded-2xl bg-background-secondary/40 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Inscribir alumno en la serie</h3>
                <form className="grid grid-cols-1 md:grid-cols-2 gap-3" onSubmit={handleSeriesEnrollSubmit}>
                  <label className="flex flex-col gap-1 text-xs text-foreground-secondary">
                    Clase
                    <select
                      className="input"
                      value={seriesEnrollForm.sessionId}
                      onChange={(e) =>
                        setSeriesEnrollForm((prev) => ({ ...prev, sessionId: e.target.value }))
                      }
                      required
                    >
                      {(seriesModal.sessions || []).map((session) => (
                        <option key={`enroll-option-${session.id}`} value={String(session.id)}>
                          {formatDateTime(session.starts_at)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-foreground-secondary">
                    Teléfono (WhatsApp)
                    <input
                      className="input"
                      value={seriesEnrollForm.customerPhone}
                      onChange={(e) =>
                        setSeriesEnrollForm((prev) => ({ ...prev, customerPhone: e.target.value }))
                      }
                      placeholder="+54911..."
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-foreground-secondary">
                    Nombre
                    <input
                      className="input"
                      value={seriesEnrollForm.customerName}
                      onChange={(e) =>
                        setSeriesEnrollForm((prev) => ({ ...prev, customerName: e.target.value }))
                      }
                      placeholder="Nombre del alumno (opcional)"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-foreground-secondary">
                    Notas
                    <input
                      className="input"
                      value={seriesEnrollForm.notes}
                      onChange={(e) =>
                        setSeriesEnrollForm((prev) => ({ ...prev, notes: e.target.value }))
                      }
                      placeholder="Notas para el profesor (opcional)"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-foreground-secondary md:col-span-2">
                    <input
                      type="checkbox"
                      checked={seriesEnrollForm.repeatEnabled}
                      onChange={(e) =>
                        setSeriesEnrollForm((prev) => ({ ...prev, repeatEnabled: e.target.checked }))
                      }
                    />
                    Inscribir en todas las clases futuras de la serie
                  </label>
                  <div className="md:col-span-2 flex justify-end gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={seriesEnrollLoading}
                      className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {seriesEnrollLoading ? "Inscribiendo…" : "Inscribir alumno"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


