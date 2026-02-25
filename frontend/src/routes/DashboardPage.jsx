// src/routes/DashboardPage.jsx
import React, { useRef, useEffect } from "react";
import { useQuery } from "../shared/useQuery.js";
import { apiClient } from "../api";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { logger } from "../utils/logger.js";
import { useTranslation } from "../i18n/useTranslation.js";
import {
  TrendingUp,
  Users,
  Calendar,
  DollarSign,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  MessageSquare,
  X
} from "lucide-react";

// Chart.js
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
  Filler
} from 'chart.js';
const Line = React.lazy(() => import('react-chartjs-2').then(m => ({ default: m.Line })));
const Bar = React.lazy(() => import('react-chartjs-2').then(m => ({ default: m.Bar })));

// Drag and Drop
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import {
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Registrar componentes de Chart.js
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  ChartTooltip,
  Legend,
  Filler
);

function StatCard({ title, value, subtitle, icon: Icon, trend, color = "primary" }) {
  const colorClasses = {
    primary: "stat-chip--primary",
    success: "stat-chip--success",
    warning: "stat-chip--warning",
    danger: "stat-chip--danger",
  };

  return (
    <div className="card card--space-lg">
      <div className="stat-card__header">
        <div className={`stat-chip ${colorClasses[color]}`}>
          <Icon />
        </div>
        {trend && (
          <div className={`stat-trend ${trend < 0 ? "stat-trend--down" : "stat-trend--up"}`}>
            <TrendingUp className={trend < 0 ? "stat-trend__icon--down" : "stat-trend__icon"} />
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div>
        <p className="stat-card__subtitle">{title}</p>
        <p className="stat-card__value">{value}</p>
        {subtitle && <p className="stat-card__footnote">{subtitle}</p>}
      </div>
    </div>
  );
}

function Section({ title, children, action }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="section-header">{title}</h2>
        {action}
      </div>
      <div className="card card--space-lg card--no-hover" style={{ minWidth: 0, overflow: 'visible' }}>
        {children}
      </div>
    </div>
  );
}

const STATUS_CONFIG = {
  scheduled: { label: "Programado", color: "bg-primary-600/20 text-primary-400 border-primary-600/30" },
  pending_deposit: { label: "Seña pendiente", color: "bg-amber-600/20 text-amber-400 border-amber-600/30" },
  deposit_paid: { label: "Seña pagada", color: "bg-emerald-600/20 text-emerald-400 border-emerald-600/30" },
  confirmed: { label: "Confirmado", color: "bg-emerald-600/20 text-emerald-400 border-emerald-600/30" },
  completed: { label: "Completado", color: "bg-primary-600/20 text-primary-400 border-primary-600/30" },
  cancelled: { label: "Cancelado", color: "bg-background-secondary text-foreground-secondary border-border" },
};

// Componente de turno arrastrable mejorado - diseño compacto y visual
function SortableAppointmentItem({ item }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    zIndex: isDragging ? 50 : 1,
  };

  const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.scheduled;
  const time = formatArgentinaTime(item.starts_at);
  
  // Permitir mover todos los turnos (incluidos confirmados y completados)
  const canMove = true;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group relative rounded-lg border-l-4 transition-all cursor-grab active:cursor-grabbing ${
        isDragging 
          ? 'shadow-2xl scale-105 rotate-1' 
          : 'hover:shadow-lg hover:scale-[1.02]'
      } ${config.color} bg-background hover:bg-background-secondary`}
    >
      <div className="p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <div className="text-xs font-bold text-foreground truncate">
                {item.customer_name || 'Sin nombre'}
              </div>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${config.color} flex-shrink-0 font-medium`}>
                {config.label}
              </span>
            </div>
            <div className="text-[11px] text-foreground-secondary truncate font-medium mb-0.5">
              {item.service_name}
            </div>
            {item.instructor_name && (
              <div className="flex items-center gap-1 text-[10px] text-foreground-muted">
                <span>👤</span>
                <span className="truncate">{item.instructor_name}</span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-end flex-shrink-0">
            <div className="text-[10px] font-bold text-primary mb-0.5">{time}</div>
            <div className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
          </div>
        </div>
      </div>
      {/* Indicador de arrastre */}
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex gap-0.5">
          <div className="w-1 h-1 rounded-full bg-foreground-muted" />
          <div className="w-1 h-1 rounded-full bg-foreground-muted" />
        </div>
      </div>
    </div>
  );
}

// Componente de slot droppable mejorado - diseño tipo timeline compacto
function DroppableSlot({ slot, children }) {
  const { setNodeRef, isOver } = useDroppable({
    id: slot.id,
  });

  const hasAppointments = slot.items.length > 0;
  const multipleAppointments = slot.items.length > 1;

  return (
    <div
      ref={setNodeRef}
      className={`relative flex items-start gap-3 py-1.5 min-h-[60px] transition-all ${
        isOver 
          ? 'bg-primary/10 rounded-lg px-2 -mx-2' 
          : ''
      }`}
    >
      {/* Línea vertical del timeline */}
      <div className="flex flex-col items-center flex-shrink-0 w-16 pointer-events-none">
        <div className={`text-xs font-bold ${
          isOver ? 'text-primary' : hasAppointments ? 'text-foreground' : 'text-foreground-muted'
        }`}>
          {slot.time}
        </div>
        <div className={`w-0.5 flex-1 mt-0.5 ${
          isOver 
            ? 'bg-primary' 
            : hasAppointments 
              ? 'bg-primary/40' 
              : 'bg-border/20'
        }`} />
      </div>
      
      {/* Contenido de los turnos */}
      <div className="flex-1 min-w-0 pt-0.5">
        {hasAppointments ? (
          <div className={`${multipleAppointments ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2' : ''}`}>
            {children}
          </div>
        ) : (
          <div className={`text-[10px] text-foreground-muted italic py-1 ${
            isOver ? 'text-primary' : ''
          }`}>
            {isOver ? 'Soltar aquí' : 'Libre'}
          </div>
        )}
      </div>
      
    </div>
  );
}

const asArray = (v) => Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : [];

const getMonthName = (monthNumber) => {
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const num = parseInt(monthNumber, 10);
  return months[num - 1] || monthNumber;
};

// Funciones para manejar hora argentina (UTC-3)
const ARGENTINA_TIMEZONE = 'America/Argentina/Buenos_Aires';

// Convertir fecha ISO a hora argentina
const toArgentinaTime = (dateString) => {
  if (!dateString) return null;
  const date = new Date(dateString);
  // Obtener la fecha en hora argentina
  return new Date(date.toLocaleString('en-US', { timeZone: ARGENTINA_TIMEZONE }));
};

// Obtener fecha/hora actual en hora argentina
const getArgentinaNow = () => {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: ARGENTINA_TIMEZONE }));
};

// Crear fecha en hora argentina con hora específica
const createArgentinaDate = (year, month, day, hour = 0, minute = 0) => {
  // Crear fecha en UTC y luego convertir a hora argentina
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const localDate = new Date(dateStr);
  // Calcular offset de Argentina (UTC-3)
  const offset = -3 * 60; // -3 horas en minutos
  const utc = localDate.getTime() + (localDate.getTimezoneOffset() * 60000);
  return new Date(utc + (offset * 60000));
};

// Formatear hora en hora argentina
const formatArgentinaTime = (dateString, options = { hour: '2-digit', minute: '2-digit' }) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleTimeString('es-AR', { ...options, timeZone: ARGENTINA_TIMEZONE });
};

// Obtener hora y minutos en hora argentina
const getArgentinaHoursMinutes = (dateString) => {
  if (!dateString) return { hour: 0, minute: 0 };
  const date = new Date(dateString);
  // Obtener componentes en hora argentina usando Intl
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ARGENTINA_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  return { hour, minute };
};

// Crear ISO string desde hora argentina
const createISOFromArgentinaTime = (year, month, day, hour, minute) => {
  // Crear fecha en hora argentina (UTC-3)
  // Formato: YYYY-MM-DDTHH:mm:ss-03:00
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-03:00`;
  return dateStr;
};

const money = (n) =>
  typeof n === "number"
    ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n)
    : "—";

const ymd = (d) => {
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const startOfWeek = (base = new Date()) => {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay() || 7;
  d.setDate(d.getDate() - (dow - 1));
  return d;
};

const endOfWeek = (base = new Date()) => {
  const s = startOfWeek(base), e = new Date(s);
  e.setDate(s.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
};

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  
  const { data: topServices, loading: loadingSvc, error: errorSvc } =
    useQuery(() => apiClient.getTopServices({ months: 3, limit: 6 }), []);

  const { data: raw, loading: loadingM, error: errorM } =
    useQuery(() => apiClient.getAdminDashboard({}), []);
  const dashboard = raw?.data ?? raw ?? {};

  const from = ymd(startOfWeek());
  const to = ymd(endOfWeek());
  const { data: rawWeek, error: errorWeek } =
    useQuery(() => apiClient.getAdminDashboard({ from, to }), [from, to]);
  const week = rawWeek?.data ?? rawWeek ?? {};

  const year = getArgentinaNow().getFullYear();
  const { data: income, loading: loadingInc, error: errorInc } =
    useQuery(() => apiClient.getIncomeByMonth(year), [year]);
  const incomeArr = React.useMemo(() => {
    const arr = asArray(income);
    return arr.map(d => ({
      month: String(d.month ?? d.mm ?? d.m ?? "").padStart(2, "0"),
      income: Number(d.income ?? d.total ?? 0),
    })).filter(d => d.month); // Filtrar elementos sin mes válido
  }, [income]);

  const topServicesArr = React.useMemo(() => {
    const arr = asArray(topServices);
    return arr.map(d => ({
      service_name: String(d.service_name ?? d.name ?? "").trim(),
      count: Number(d.count ?? d.qty ?? 0),
    })).filter(d => d.service_name && d.count > 0); // Filtrar servicios vacíos o sin count
  }, [topServices]);


  // Debug: Log errores si existen
  if (errorInc) console.error("[Dashboard] Error cargando ingresos:", errorInc);
  if (errorSvc) console.error("[Dashboard] Error cargando servicios top:", errorSvc);
  if (errorM) console.error("[Dashboard] Error cargando dashboard:", errorM);
  if (errorWeek) console.error("[Dashboard] Error cargando semana:", errorWeek);
  
  // Debug: Log datos recibidos




  const { data: agenda, loading: loadingAgenda, refetch: refetchAgenda } =
    useQuery(() => apiClient.getAgendaToday(), []);
  const agendaArr = asArray(agenda);
  
  // Drag and Drop para agenda
  const [activeId, setActiveId] = React.useState(null);
  const [agendaItems, setAgendaItems] = React.useState([]);
  const [showWhatsAppModal, setShowWhatsAppModal] = React.useState(false);
  const [pendingUpdate, setPendingUpdate] = React.useState(null); // { itemId, newTime, oldTime }
  const [expandedSlots, setExpandedSlots] = React.useState(0); // Número de veces que se ha expandido (0 = compacto)
  const modalRef = React.useRef(null);
  const closeBtnRef = React.useRef(null);
  const confirmBtnRef = React.useRef(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Reducido para facilitar el arrastre
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  React.useEffect(() => {
    setAgendaItems(agendaArr);
  }, [agendaArr]);

  React.useEffect(() => {
    if (showWhatsAppModal) {
      confirmBtnRef.current?.focus();
    }
  }, [showWhatsAppModal]);

  const handleModalKeyDown = (e) => {
    if (e.key === 'Escape') {
      setShowWhatsAppModal(false);
      setPendingUpdate(null);
      return;
    }
    if (e.key === 'Tab' && modalRef.current) {
      const selectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
      const nodes = modalRef.current.querySelectorAll(selectors);
      const focusables = Array.from(nodes);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    }
  };

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const draggedItem = agendaItems.find(item => item.id === active.id);
    if (!draggedItem) return;

    // Si se soltó sobre un slot de hora (formato "slot-XX:XX")
    if (String(over.id).startsWith('slot-')) {
      const slotTime = String(over.id).replace('slot-', '');
      const [hours, minutes] = slotTime.split(':');
      
      // Obtener la fecha actual en hora argentina
      const today = getArgentinaNow();
      const oldTime = getArgentinaHoursMinutes(draggedItem.starts_at);
      
      // Verificar si realmente cambió la hora
      if (oldTime.hour === parseInt(hours) && oldTime.minute === parseInt(minutes)) {
        return; // No hay cambio, no hacer nada
      }
      
      // Crear nueva fecha en hora argentina con la hora del slot
      const newDateISO = createISOFromArgentinaTime(
        today.getFullYear(),
        today.getMonth() + 1,
        today.getDate(),
        parseInt(hours),
        parseInt(minutes)
      );
      
      // Guardar información para el modal
      setPendingUpdate({
        itemId: draggedItem.id,
        item: draggedItem,
        oldTime: `${String(oldTime.hour).padStart(2, '0')}:${String(oldTime.minute).padStart(2, '0')}`,
        newTime: slotTime,
        newDateISO
      });
      setShowWhatsAppModal(true);
      return;
    }

    // Si se soltó sobre otro turno, intercambiar posiciones
    const targetItem = agendaItems.find(item => item.id === over.id);
    if (targetItem && targetItem.id !== draggedItem.id) {
      const today = getArgentinaNow();
      const oldTime = getArgentinaHoursMinutes(draggedItem.starts_at);
      const newTime = getArgentinaHoursMinutes(targetItem.starts_at);
      
      // Verificar si realmente cambió la hora
      if (oldTime.hour === newTime.hour && oldTime.minute === newTime.minute) {
        return; // No hay cambio
      }
      
      // Crear nuevas fechas en hora argentina (intercambiar horas)
      const draggedNewDateISO = createISOFromArgentinaTime(
        today.getFullYear(),
        today.getMonth() + 1,
        today.getDate(),
        newTime.hour,
        newTime.minute
      );
      const targetNewDateISO = createISOFromArgentinaTime(
        today.getFullYear(),
        today.getMonth() + 1,
        today.getDate(),
        oldTime.hour,
        oldTime.minute
      );
      
      // Guardar información para el modal (solo para el primer turno)
      setPendingUpdate({
        itemId: draggedItem.id,
        item: draggedItem,
        oldTime: `${String(oldTime.hour).padStart(2, '0')}:${String(oldTime.minute).padStart(2, '0')}`,
        newTime: `${String(newTime.hour).padStart(2, '0')}:${String(newTime.minute).padStart(2, '0')}`,
        newDateISO: draggedNewDateISO,
        targetItemId: targetItem.id,
        targetItem: targetItem,
        targetNewDateISO: targetNewDateISO
      });
      setShowWhatsAppModal(true);
    }
  };

  const confirmUpdate = async (sendWhatsApp = false) => {
    if (!pendingUpdate) return;
    
    setShowWhatsAppModal(false);
    const updateData = { ...pendingUpdate };
    setPendingUpdate(null);
    
    try {
      // Actualizar el turno principal
      await apiClient.updateAppointment(updateData.itemId, {
        startsAt: updateData.newDateISO
      });
      
      // Si hay un segundo turno (intercambio), actualizarlo también
      if (updateData.targetItemId && updateData.targetNewDateISO) {
        await apiClient.updateAppointment(updateData.targetItemId, {
          startsAt: updateData.targetNewDateISO
        });
      }
      
      // Enviar WhatsApp si se solicitó
      if (sendWhatsApp && updateData.item?.phone_e164) {
        try {
          const customerName = updateData.item.customer_name || 'Cliente';
          const customText = `Hola ${customerName} 💈\nNecesitamos *reprogramar tu turno* de ${updateData.oldTime} a ${updateData.newTime}. ¿Te viene bien este nuevo horario? 🙏`;
          
          await apiClient.post("/api/whatsapp/reprogram", {
            appointmentId: updateData.itemId,
            phone: updateData.item.phone_e164 || updateData.item.customer_phone,
            customText: customText,
            autoCancel: false,
          });
          
          toast.success("Turno actualizado y mensaje enviado por WhatsApp");
        } catch (whatsappError) {
          logger.error("Error enviando WhatsApp:", whatsappError);
          toast.success("Turno actualizado", {
            description: "No se pudo enviar el mensaje de WhatsApp"
          });
        }
      } else {
        toast.success("Turno actualizado correctamente");
      }
      
      // Recargar agenda para reflejar cambios desde el servidor
      // Esto actualizará agendaArr y luego el useEffect actualizará agendaItems
      await refetchAgenda();
    } catch (error) {
      toast.error("Error al actualizar el turno");
      logger.error(error);
      // Revertir cambios locales recargando desde el servidor
      await refetchAgenda();
    }
  };

  // Organizar turnos por slots de hora (en hora argentina) - solo mostrar primeros horarios
  const organizeByTimeSlots = () => {
    // Crear todos los slots posibles
    const allSlots = Array.from({ length: 24 }, (_, i) => {
      const hour = Math.floor(i / 2) + 8;
      const minute = (i % 2) * 30;
      const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      return { 
        time, 
        id: `slot-${time}`,
        items: [],
        index: i
      };
    });

    // Asignar turnos a slots
    agendaItems.forEach(item => {
      // Obtener hora en hora argentina
      const { hour, minute } = getArgentinaHoursMinutes(item.starts_at);
      // Calcular el slot más cercano (redondeando a los 30 minutos más cercanos)
      const totalMinutes = hour * 60 + minute;
      const slotMinutes = Math.round(totalMinutes / 30) * 30;
      const slotHour = Math.floor(slotMinutes / 60);
      const slotMin = slotMinutes % 60;
      
      // Buscar el slot correspondiente
      const slotIndex = (slotHour - 8) * 2 + (slotMin / 30);
      
      if (slotIndex >= 0 && slotIndex < 24) {
        allSlots[slotIndex].items.push(item);
      } else {
        // Si está fuera del rango, agregarlo al slot más cercano
        if (slotIndex < 0) {
          allSlots[0].items.push(item);
        } else if (slotIndex >= 24) {
          allSlots[23].items.push(item);
        }
      }
    });

    // Siempre mostrar solo los primeros horarios (8:00 a 14:00 = 12 slots = 6 horas)
    // Independientemente de si hay turnos más tarde
    const DEFAULT_END_SLOT = 11; // 14:00 (slot 11 = índice 11, que es 8 + 11*0.5 = 13.5 = 14:00)
    const baseEndIndex = DEFAULT_END_SLOT;
    
    // Calcular cuántos slots mostrar según el nivel de expansión
    // Cada expansión agrega 4 slots más (2 horas)
    const expansionIncrement = 4; // 4 slots = 2 horas por expansión
    const maxExpandedIndex = baseEndIndex + (expandedSlots * expansionIncrement);
    const endIndex = Math.min(23, maxExpandedIndex);
    
    // Verificar si hay turnos más allá del rango visible
    const slotsWithAppointments = allSlots.filter(slot => slot.items.length > 0);
    const hasAppointmentsLater = slotsWithAppointments.some(slot => slot.index > endIndex);
    
    const slots = allSlots.slice(0, endIndex + 1);
    const hasMore = hasAppointmentsLater || endIndex < 23;
    const canMinimize = expandedSlots > 0;
    
    return { slots, hasMore, canMinimize };
  };

  const todayTotal = dashboard?.today?.total ?? 0;
  const todayConfirmed = dashboard?.today?.confirmed ?? 0;
  const todayPending = dashboard?.today?.pending ?? 0;
  const incomeWeek = week?.deposits?.rangeAmount ?? 0;


  return (
    <div className="space-y-6 lg:space-y-8 animate-fade-in">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {t("dashboard.title")}
          </h1>
          <p className="text-foreground-secondary">
            {t("dashboard.subtitle")}
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <StatCard
          title={t("dashboard.appointmentsToday")}
          value={todayTotal}
          subtitle={t("dashboard.allStatuses")}
          icon={Calendar}
          color="primary"
        />
        <StatCard
          title={t("dashboard.confirmed")}
          value={todayConfirmed}
          subtitle={t("dashboard.completedPayments")}
          icon={CheckCircle2}
          color="success"
        />
        <StatCard
          title={t("dashboard.pending")}
          value={todayPending}
          subtitle={t("dashboard.requiresAttention")}
          icon={AlertCircle}
          color="warning"
        />
        <StatCard
          title={t("dashboard.weeklyIncome")}
          value={money(incomeWeek)}
          subtitle={t("dashboard.depositsCollected")}
          icon={DollarSign}
          color="success"
        />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Income Chart */}
        <div className="lg:col-span-3">
          <Section title={t("dashboard.incomeYear", { year })}>
            {loadingInc ? (
              <div className="w-full h-[280px] flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
              </div>
            ) : errorInc ? (
              <div className="w-full h-[280px] flex flex-col items-center justify-center text-center p-6">
                <AlertCircle className="w-12 h-12 text-foreground-muted mb-3" />
                <p className="text-foreground-secondary text-sm">
                  {t("dashboard.errorLoadingIncome")}
                </p>
                <p className="text-foreground-muted text-xs mt-1">
                  {typeof errorInc === 'string' ? errorInc : errorInc?.message || t("dashboard.tryReload")}
                </p>
              </div>
            ) : !incomeArr || incomeArr.length === 0 ? (
              <div className="w-full h-[280px] flex flex-col items-center justify-center text-center p-6">
                <DollarSign className="w-12 h-12 text-foreground-muted mb-3" />
                <p className="text-foreground-secondary text-sm">
                  {t("dashboard.noIncomeData")}
                </p>
                <p className="text-foreground-muted text-xs mt-1">
                  {t("dashboard.incomeWillAppear")}
                </p>
              </div>
            ) : (
              <div 
                className="w-full" 
                style={{ height: '280px', position: 'relative', minWidth: '300px', width: '100%' }}
              >
                <React.Suspense fallback={<div className="w-full h-[280px] flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" /></div>}>
                  <Line
                    data={{
                      labels: incomeArr.map(d => getMonthName(d.month)),
                      datasets: [
                        {
                          label: t("dashboard.income"),
                          data: incomeArr.map(d => d.income),
                          borderColor: '#0ea5e9',
                          backgroundColor: 'rgba(14, 165, 233, 0.1)',
                          borderWidth: 3,
                          fill: true,
                          tension: 0.4,
                          pointRadius: 4,
                          pointHoverRadius: 6,
                          pointBackgroundColor: '#0ea5e9',
                          pointBorderColor: '#0ea5e9',
                        }
                      ]
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          display: true,
                          position: 'top',
                          labels: {
                            color: '#a1a1aa',
                            font: {
                              size: 12
                            }
                          }
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
                              return `Ingresos: ${money(context.parsed.y)}`;
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
                            color: 'rgba(63, 63, 70, 0.3)',
                            borderDash: [3, 3]
                          }
                        },
                        y: {
                          ticks: {
                            color: '#a1a1aa',
                            font: {
                              size: 12
                            },
                            callback: function(value) {
                              return `$${value.toLocaleString('es-AR')}`;
                            }
                          },
                          grid: {
                            color: 'rgba(63, 63, 70, 0.3)',
                            borderDash: [3, 3]
                          }
                        }
                      }
                    }}
                  />
                </React.Suspense>
              </div>
            )}
          </Section>
        </div>

        {/* Top Services Chart */}
        <div className="lg:col-span-2">
          <Section title={t("dashboard.topServices")}>
            {loadingSvc ? (
              <div className="w-full h-[280px] flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
              </div>
            ) : errorSvc ? (
              <div className="w-full h-[280px] flex flex-col items-center justify-center text-center p-6">
                <AlertCircle className="w-12 h-12 text-foreground-muted mb-3" />
                <p className="text-foreground-secondary text-sm">
                  {t("dashboard.errorLoadingServices")}
                </p>
                <p className="text-foreground-muted text-xs mt-1">
                  {typeof errorSvc === 'string' ? errorSvc : errorSvc?.message || t("dashboard.tryReload")}
                </p>
              </div>
            ) : !topServicesArr || topServicesArr.length === 0 ? (
              <div className="w-full h-[280px] flex flex-col items-center justify-center text-center p-6">
                <Users className="w-12 h-12 text-foreground-muted mb-3" />
                <p className="text-foreground-secondary text-sm">
                  {t("dashboard.noServicesData")}
                </p>
                <p className="text-foreground-muted text-xs mt-1">
                  {t("dashboard.servicesWillAppear")}
                </p>
              </div>
            ) : (
              <div 
                className="w-full" 
                style={{ height: '280px', position: 'relative', minWidth: '200px', width: '100%' }}
              >
                <React.Suspense fallback={<div className="w-full h-[280px] flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" /></div>}>
                  <Bar
                    data={{
                      labels: topServicesArr.map(d => d.service_name),
                      datasets: [
                        {
                          label: t("navigation.appointments"),
                          data: topServicesArr.map(d => d.count),
                          backgroundColor: (context) => {
                            const ctx = context.chart.ctx;
                            const gradient = ctx.createLinearGradient(0, 0, 0, 280);
                            gradient.addColorStop(0, '#60a5fa');
                            gradient.addColorStop(1, '#a78bfa');
                            return gradient;
                          },
                          borderRadius: 12,
                          borderSkipped: false,
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
                          backgroundColor: '#18181b',
                          borderColor: '#3f3f46',
                          borderWidth: 1,
                          borderRadius: 12,
                          padding: 12,
                          titleColor: '#fafafa',
                          bodyColor: '#fafafa',
                          callbacks: {
                            label: function(context) {
                              const value = context.parsed.y;
                              return `${value} turno${value !== 1 ? 's' : ''}`;
                            }
                          }
                        }
                      },
                      scales: {
                        x: {
                          ticks: {
                            color: '#a1a1aa',
                            font: {
                              size: 11
                            },
                            maxRotation: 12,
                            minRotation: 12
                          },
                          grid: {
                            display: false
                          }
                        },
                        y: {
                          ticks: {
                            color: '#a1a1aa',
                            font: {
                              size: 12
                            }
                          },
                          grid: {
                            color: 'rgba(63, 63, 70, 0.25)',
                            borderDash: [3, 3]
                          }
                        }
                      }
                    }}
                  />
                </React.Suspense>
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* Today's Agenda - Calendario */}
      <Section
        title={t("dashboard.todayAgenda")}
        action={
          <span className="text-sm text-foreground-secondary">
            {t("dashboard.scheduledAppointments", { count: agendaArr.length })}
          </span>
        }
      >
        {loadingAgenda ? (
          <div className="py-12 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
          </div>
        ) : agendaArr.length === 0 ? (
          <div className="py-12 text-center">
            <Clock className="w-12 h-12 mx-auto mb-3 text-foreground-muted" />
            <p className="text-foreground-secondary">{t("dashboard.noAppointmentsToday")}</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={agendaItems.map(item => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="relative pr-2 w-full">
                <div className="space-y-0">
                  {(() => {
                    const { slots, hasMore, canMinimize } = organizeByTimeSlots();
                    return (
                      <>
                        {slots.map((slot, slotIndex) => {
                          return (
                            <DroppableSlot key={slot.time} slot={slot}>
                              {slot.items.map((item) => (
                                <SortableAppointmentItem key={item.id} item={item} />
                              ))}
                            </DroppableSlot>
                          );
                        })}
                        {(hasMore || canMinimize) && (
                          <div className="flex items-center justify-center gap-2 py-4">
                            {canMinimize && (
                              <button
                                onClick={() => setExpandedSlots(0)}
                                className="px-4 py-2 rounded-lg bg-background-secondary hover:bg-background border border-border text-sm font-medium text-foreground transition-colors flex items-center gap-2"
                              >
                                <Clock className="w-4 h-4 rotate-180" />
                                Minimizar
                              </button>
                            )}
                            {hasMore && (
                              <button
                                onClick={() => setExpandedSlots(prev => prev + 1)}
                                className="px-4 py-2 rounded-lg bg-background-secondary hover:bg-background border border-border text-sm font-medium text-foreground transition-colors flex items-center gap-2"
                              >
                                <Clock className="w-4 h-4" />
                                Cargar más horarios
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </SortableContext>
            <DragOverlay>
              {activeId ? (
                <div className="p-3 rounded-lg border-l-4 border-primary bg-background shadow-2xl">
                  {(() => {
                    const item = agendaItems.find(i => i.id === activeId);
                    if (!item) return null;
                    const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.scheduled;
                    const time = formatArgentinaTime(item.starts_at);
                    return (
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-bold text-foreground">{item.customer_name}</div>
                          <div className="text-xs text-foreground-secondary">{item.service_name}</div>
                        </div>
                        <div className="text-xs font-bold text-primary">{time}</div>
                      </div>
                    );
                  })()}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </Section>

      {/* Modal de confirmación para WhatsApp */}
      {showWhatsAppModal && pendingUpdate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(4px)'
          }}
          onClick={() => {
            setShowWhatsAppModal(false);
            setPendingUpdate(null);
          }}
        >
          <div
            className="bg-background rounded-2xl shadow-2xl border border-border p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-whatsapp-modal-title"
            aria-describedby="dashboard-whatsapp-modal-desc"
            tabIndex="-1"
            ref={modalRef}
            onKeyDown={handleModalKeyDown}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                <h3 id="dashboard-whatsapp-modal-title" className="text-lg font-semibold text-foreground">
                  Turno reprogramado
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowWhatsAppModal(false);
                  setPendingUpdate(null);
                }}
                className="p-1 rounded-lg hover:bg-background-secondary transition-colors"
                ref={closeBtnRef}
              >
                <X className="w-4 h-4 text-foreground-secondary" />
              </button>
            </div>
            
            <div className="mb-6">
              <p id="dashboard-whatsapp-modal-desc" className="text-sm text-foreground-secondary mb-3">
                El turno de <strong className="text-foreground">{pendingUpdate.item?.customer_name || 'Cliente'}</strong> se actualizó:
              </p>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-background-secondary border border-border">
                <span className="text-sm text-foreground-muted line-through">{pendingUpdate.oldTime}</span>
                <span className="text-foreground-secondary">→</span>
                <span className="text-sm font-semibold text-primary">{pendingUpdate.newTime}</span>
              </div>
            </div>
            
            <div className="mb-6 p-4 rounded-lg bg-primary/5 border border-primary/20">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  defaultChecked={true}
                  id="sendWhatsApp"
                  className="mt-0.5 rounded"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground mb-1">
                    Enviar mensaje de WhatsApp al cliente
                  </div>
                  <p className="text-xs text-foreground-muted">
                    Se enviará un mensaje automático informando sobre el cambio de horario
                  </p>
                </div>
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowWhatsAppModal(false);
                  setPendingUpdate(null);
                }}
                className="flex-1 px-4 py-2 rounded-lg border border-border bg-background-secondary hover:bg-border text-sm font-medium text-foreground transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const sendWhatsApp = document.getElementById('sendWhatsApp')?.checked ?? true;
                  confirmUpdate(sendWhatsApp);
                }}
                className="flex-1 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                ref={confirmBtnRef}
              >
                <MessageSquare className="w-4 h-4" />
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
