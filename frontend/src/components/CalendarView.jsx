// src/components/CalendarView.jsx — Vista de Agenda Personalizada
import { useMemo, useState, useCallback, useEffect, useContext, useRef } from "react";
import { createPortal } from "react-dom";
import "../calendar-dark.css";
import "../calendar-light.css";
import { 
  Filter, 
  RefreshCw, 
  Calendar,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CalendarRange,
  Activity,
  LayoutGrid,
  Columns,
  MessageSquare,
  Mail,
  X
} from "lucide-react";
import AppointmentModal from "./AppointmentModal";
import { AppContext } from "../context/AppProvider";
import { useTheme } from "../context/ThemeContext";
import apiClient from "../api/client";
import { logger } from "../utils/logger.js";
import { toast } from "sonner";

/* =========================
   Helpers Responsive
========================= */
function useIsMobile(bp = 768) {
  const get = () => (typeof window !== "undefined" ? window.innerWidth < bp : false);
  const [isMobile, setIsMobile] = useState(get);
  useEffect(() => {
    const onResize = () => setIsMobile(get());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [bp]);
  return isMobile;
}

/* =========================
   Vista de Slots de Tiempo (como Dashboard)
========================= */
function TimeSlotListView({ events, onEventClick, instructorColors, timeRange }) {
  // Crear slots de 1 hora basado en el rango configurado
  const generateTimeSlots = () => {
    const slots = [];
    const minHour = parseInt(timeRange?.min?.split(':')[0] || 6);
    const maxHour = parseInt(timeRange?.max?.split(':')[0] || 23);
    
    // Intervalos de 1 hora para mejor visualización
    for (let hour = minHour; hour <= maxHour; hour++) {
      const time = `${String(hour).padStart(2, '0')}:00`;
      slots.push({
        time,
        id: `slot-${time}`,
        items: []
      });
    }
    return slots;
  };

  const allSlots = useMemo(() => {
    const slots = generateTimeSlots();
    
    // Asignar eventos a slots
    events.forEach(event => {
      const start = new Date(event.start);
      const hour = start.getHours();
      
      // Calcular el slot más cercano (redondeando a la hora más cercana)
      const eventSlotTime = `${String(hour).padStart(2, '0')}:00`;
      const slot = slots.find(s => s.time === eventSlotTime);
      
      if (slot) {
        slot.items.push(event);
      }
    });
    
    return slots;
  }, [events, timeRange]);

  return (
    <div className="w-full space-y-0">
      {allSlots.map((slot) => {
        const hasAppointments = slot.items.length > 0;
        const multipleAppointments = slot.items.length > 1;
        
        return (
          <div
            key={slot.id}
            className="relative flex items-start gap-2 sm:gap-3 py-1 sm:py-1.5 min-h-[55px] sm:min-h-[60px] transition-all"
          >
            {/* Línea vertical del timeline */}
            <div className="flex flex-col items-center flex-shrink-0 w-12 sm:w-14 md:w-16 pointer-events-none">
              <div className={`text-[10px] sm:text-xs font-bold ${
                hasAppointments ? 'text-foreground' : 'text-foreground-muted'
              }`}>
                {slot.time}
              </div>
              <div className={`w-0.5 flex-1 mt-0.5 ${
                hasAppointments 
                  ? 'bg-primary/40' 
                  : 'bg-border/20'
              }`} />
            </div>
            
            {/* Contenido de los turnos */}
            <div className="flex-1 min-w-0 pt-0.5">
              {hasAppointments ? (
                <div className={`${multipleAppointments ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2' : ''}`}>
                  {slot.items.map((item) => {
                    const ep = item.extendedProps || {};
                    const type = ep.eventType || "appointment";
                    const status = ep.status;
                    const instructorId = ep.instructor_id || ep.instructorId;
                    const instructorColor = instructorColors[instructorId] || "#3b82f6";
                    
                    return (
                      <div
                        key={item.id}
                        onClick={() => onEventClick(item)}
                        className="cursor-pointer rounded-lg border-2 p-2 sm:p-2.5 md:p-3 transition-all hover:shadow-lg hover:scale-[1.02]"
                        style={{
                          borderColor: instructorColor,
                          backgroundColor: `${instructorColor}15`
                        }}
                      >
                        <div className="flex items-start justify-between gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs sm:text-sm font-semibold text-foreground truncate">
                              {item.title}
                            </div>
                            {ep.customer_name && (
                              <div className="text-[10px] sm:text-xs text-foreground-muted mt-0.5 truncate">
                                {ep.customer_name}
                              </div>
                            )}
                          </div>
                          {status === "confirmed" && (
                            <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-emerald-400 rounded-full animate-pulse shrink-0 mt-1" title="Confirmado" />
                          )}
                        </div>
                        
                        <div className="flex flex-wrap gap-1 items-center">
                          {ep.instructor_name && (
                            <span
                              className="px-1 sm:px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-medium text-white truncate max-w-full"
                              style={{ backgroundColor: instructorColor }}
                            >
                              {ep.instructor_name}
                            </span>
                          )}
                          {type === "class_session" && ep.enrolled_count != null && ep.capacity_max != null && (
                            <span className="px-1 sm:px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] bg-indigo-500/20 text-indigo-200 font-medium">
                              👥 {ep.enrolled_count}/{ep.capacity_max}
                            </span>
                          )}
                          {type !== "class_session" && status === "deposit_paid" && (
                            <span className="px-1 sm:px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] bg-emerald-500/20 text-emerald-200 font-medium">
                              💰 Seña
                            </span>
                          )}
                          {status === "cancelled" && (
                            <span className="px-1 sm:px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] bg-red-500/20 text-red-200 font-medium">
                              ❌ Cancelado
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[9px] sm:text-[10px] text-foreground-muted italic py-1">
                  Libre
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* =========================
   Colores por estilista
========================= */
const PALETTE = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6", "#e11d48"];

const colorByIndex = (i) => PALETTE[i % PALETTE.length];

function hexToRgba(hex, alpha = 0.08) {
  const h = hex.replace("#", "").trim();
  const bigint = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildInstructorColorMap(instructors) {
  const map = {};
  (instructors || []).forEach((s, idx) => {
    map[s.id] = s.color_hex?.trim() || colorByIndex(idx);
  });
  return map;
}

/* =========================
   Vista de Día por Instructor
========================= */
function DayView({ events, instructors, instructorColors, timeRange, onEventClick, selectedDate, onDateChange, onEventDrop }) {
  // Estado para drag and drop
  const [draggedEvent, setDraggedEvent] = useState(null);
  const [dragOverSlot, setDragOverSlot] = useState(null);
  const [dragOverInstructor, setDragOverInstructor] = useState(null);
  const [forceUpdate, setForceUpdate] = useState(0);
  const instructorPhotos = useMemo(() => {
    const map = {};
    (instructors || []).forEach((i) => {
      if (i.photo_url) map[i.id] = i.photo_url;
    });
    return map;
  }, [instructors]);
  
  // Forzar re-render cuando cambien los eventos
  // Usamos un hash simple basado en los IDs y fechas de los eventos
  const eventsHash = useMemo(() => {
    if (!Array.isArray(events) || events.length === 0) return '';
    return events
      .map(e => {
        const start = e.start ? new Date(e.start).toISOString() : '';
        const end = e.end ? new Date(e.end).toISOString() : '';
        return `${e.id}-${start}-${end}`;
      })
      .sort()
      .join('|');
  }, [events]);

  useEffect(() => {
    if (eventsHash) {
      setForceUpdate(prev => prev + 1);
      logger.info("[DayView] Eventos cambiaron, forzando re-render:", { hashLength: eventsHash.length, eventsCount: events.length });
    }
  }, [eventsHash, events.length]);

  // Filtrar eventos para la fecha seleccionada
  const dayEvents = useMemo(() => {
    if (!selectedDate) return [];
    
    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    const filtered = events.filter(e => {
      if (!e.start) return false;
      const start = new Date(e.start);
      if (isNaN(start.getTime())) return false;
      return start >= startOfDay && start <= endOfDay && e.extendedProps?.status !== 'cancelled';
    });
    
    logger.info("[DayView] dayEvents recalculado:", { count: filtered.length, forceUpdate, eventsCount: events.length, selectedDate: selectedDate.toISOString() });
    return filtered;
  }, [events, selectedDate, forceUpdate]);

  // Agrupar eventos por instructor
  const eventsByInstructor = useMemo(() => {
    const grouped = {};
    
    // Inicializar con todos los instructores
    (instructors || []).forEach(instructor => {
      grouped[instructor.id] = {
        instructor,
        events: []
      };
    });
    
    // Agregar eventos sin instructor asignado
    const hasUnassignedEvents = dayEvents.some(event => {
      const instructorId = event.extendedProps?.instructor_id || event.extendedProps?.instructorId;
      return !instructorId;
    });
    
    if (hasUnassignedEvents) {
      grouped['unassigned'] = {
        instructor: { id: 'unassigned', name: 'Sin asignar', color_hex: '#6B7280' },
        events: []
      };
    }
    
    // Agrupar eventos
    dayEvents.forEach(event => {
      const instructorId = event.extendedProps?.instructor_id || event.extendedProps?.instructorId;
      const key = instructorId || 'unassigned';
      
      if (!grouped[key]) {
        grouped[key] = {
          instructor: { id: key, name: 'Sin asignar', color_hex: '#6B7280' },
          events: []
        };
      }
      
      grouped[key].events.push(event);
    });
    
    // Mostrar todos los instructores, incluso si no tienen eventos
    return Object.values(grouped);
  }, [dayEvents, instructors]);

  // Generar slots de tiempo (cada hora para mejor visualización)
  const generateTimeSlots = useCallback(() => {
    const slots = [];
    const minHour = parseInt(timeRange?.min?.split(':')[0] || 6);
    const maxHour = parseInt(timeRange?.max?.split(':')[0] || 23);
    
    // Intervalos de 1 hora para mejor visualización
    for (let hour = minHour; hour <= maxHour; hour++) {
      const time = `${String(hour).padStart(2, '0')}:00`;
      slots.push({ time, id: `slot-${time}` });
    }
    return slots;
  }, [timeRange]);

  const timeSlots = useMemo(() => generateTimeSlots(), [generateTimeSlots]);

  // Asignar eventos a slots por instructor (redondeando a la hora más cercana)
  const getEventsForSlot = useCallback((slotTime, instructorEvents) => {
    return instructorEvents.filter(event => {
      const start = new Date(event.start);
      const hour = start.getHours();
      // Redondear a la hora más cercana
      const eventSlotTime = `${String(hour).padStart(2, '0')}:00`;
      return eventSlotTime === slotTime;
    });
  }, []);

  // Handlers para drag and drop
  const handleDragStart = useCallback((e, event, instructorId) => {
    if (event.extendedProps?.status === 'cancelled') return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ''); // Necesario para algunos navegadores
    logger.info("[DayView] Drag iniciado:", { eventId: event.id, instructorId });
    setDraggedEvent({ event, sourceInstructorId: instructorId });
  }, []);

  const handleDragEnter = useCallback((e, slotTime, instructorId) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedEvent) {
      e.dataTransfer.dropEffect = 'move';
      setDragOverSlot(slotTime);
      setDragOverInstructor(instructorId);
    }
  }, [draggedEvent]);

  const handleDragOver = useCallback((e, slotTime, instructorId) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedEvent) {
      e.dataTransfer.dropEffect = 'move';
      setDragOverSlot(slotTime);
      setDragOverInstructor(instructorId);
    }
  }, [draggedEvent]);

  const handleDragLeave = useCallback((e) => {
    // Solo limpiar si realmente salimos del área de drop (no solo de un hijo)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverSlot(null);
      setDragOverInstructor(null);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedEvent(null);
    setDragOverSlot(null);
    setDragOverInstructor(null);
  }, []);

  const handleDrop = useCallback(async (e, slotTime, targetInstructorId) => {
    e.preventDefault();
    e.stopPropagation();
    
    logger.info("[DayView] Drop detectado:", { slotTime, targetInstructorId, draggedEvent: !!draggedEvent, onEventDrop: !!onEventDrop });
    
    if (!draggedEvent || !onEventDrop) {
      logger.warn("[DayView] Drop cancelado - falta draggedEvent o onEventDrop");
      handleDragEnd();
      return;
    }

    const { event, sourceInstructorId } = draggedEvent;
    
    // Calcular nueva fecha/hora en hora local (sin conversión a UTC)
    const [hour, minute] = slotTime.split(':').map(Number);
    const newDate = new Date(selectedDate);
    newDate.setHours(hour, minute || 0, 0, 0);
    
    // Calcular duración del evento original
    const originalStart = new Date(event.start);
    const originalEnd = new Date(event.end || new Date(originalStart.getTime() + 30 * 60 * 1000));
    const duration = originalEnd.getTime() - originalStart.getTime();
    
    // Calcular nueva hora sin minutos para comparación más precisa
    const newDateRounded = new Date(newDate);
    newDateRounded.setSeconds(0, 0);
    newDateRounded.setMilliseconds(0);
    const originalStartRounded = new Date(originalStart);
    originalStartRounded.setSeconds(0, 0);
    originalStartRounded.setMilliseconds(0);
    
    // Si cambió el instructor o el horario (comparar con tolerancia de 1 minuto)
    const oldInstructorId = event.extendedProps?.instructor_id || event.extendedProps?.instructorId || null;
    const instructorChanged = String(targetInstructorId) !== String(oldInstructorId || 'unassigned');
    const timeChanged = Math.abs(newDateRounded.getTime() - originalStartRounded.getTime()) > 60000; // Más de 1 minuto de diferencia
    
    // Función helper para convertir Date a formato MySQL local (sin UTC)
    const toLocalMySQL = (date) => {
      const pad = (n) => String(n).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    };
    
    logger.info("[DayView] Comparación de cambios:", {
      originalStart: originalStartRounded.toISOString(),
      newDate: newDateRounded.toISOString(),
      newDateLocal: toLocalMySQL(newDateRounded),
      timeDiff: Math.abs(newDateRounded.getTime() - originalStartRounded.getTime()),
      timeChanged,
      instructorChanged,
      oldInstructorId,
      targetInstructorId
    });

    // Permitir mover tanto appointments como clases
    const eventType = event.extendedProps?.eventType;

    // Siempre actualizar si hay cambios
    // Forzar actualización si el slot es diferente (incluso si el tiempo parece igual)
    const slotChanged = slotTime !== `${String(originalStart.getHours()).padStart(2, '0')}:${String(originalStart.getMinutes()).padStart(2, '0')}`;
    
    if (instructorChanged || timeChanged || slotChanged) {
      try {
        // Convertir a formato MySQL local (YYYY-MM-DD HH:mm:ss) en hora local, no UTC
        // El backend espera la hora en formato local de Argentina
        const newEndDate = new Date(newDate.getTime() + duration);
        const updates = {
          starts_at: toLocalMySQL(newDate),
          ends_at: toLocalMySQL(newEndDate),
        };

        if (targetInstructorId && targetInstructorId !== 'unassigned') {
          updates.instructor_id = parseInt(targetInstructorId);
        } else {
          updates.instructor_id = null;
        }

        logger.info("[DayView] Actualizando evento:", { 
          eventId: event.id, 
          updates, 
          instructorChanged, 
          timeChanged, 
          slotChanged,
          originalSlot: `${String(originalStart.getHours()).padStart(2, '0')}:${String(originalStart.getMinutes()).padStart(2, '0')}`,
          newSlot: slotTime
        });
        
        // Llamar a onEventDrop con el tipo de evento para mostrar diálogo de notificación
        await onEventDrop(event.id, updates, eventType);
        
        // Limpiar el estado de drag después de la actualización
        handleDragEnd();
      } catch (error) {
        logger.error("[DayView] Error en handleDrop:", error);
        handleDragEnd(); // Limpiar estado incluso si hay error
        throw error;
      }
    } else {
      // Si no hay cambios, solo limpiar el estado
      logger.info("[DayView] No hay cambios, cancelando drop", {
        originalSlot: `${String(originalStart.getHours()).padStart(2, '0')}:${String(originalStart.getMinutes()).padStart(2, '0')}`,
        newSlot: slotTime,
        instructorChanged,
        timeChanged
      });
      handleDragEnd();
    }
  }, [draggedEvent, selectedDate, onEventDrop, handleDragEnd]);

  // Formatear fecha
  const formattedDate = useMemo(() => {
    if (!selectedDate) return '';
    const date = new Date(selectedDate);
    const isToday = date.toDateString() === new Date().toDateString();
    return {
      label: isToday ? 'Hoy' : date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }),
      isToday
    };
  }, [selectedDate]);

  if ((!instructors || instructors.length === 0) && eventsByInstructor.length === 0) {
    return (
      <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 rounded-2xl p-6 border border-blue-500/20 mb-6">
        <p className="text-sm text-blue-300 text-center">No hay instructores configurados</p>
      </div>
    );
  }

  return (
    <div className="mb-6">
      {/* Header con navegación de fechas */}
      <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-blue-500/20 mb-3 sm:mb-4">
        <div className="flex items-center justify-between gap-2 sm:gap-3 md:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <div className="p-1.5 sm:p-2 bg-blue-500/20 rounded-lg sm:rounded-xl flex-shrink-0">
              <CalendarDays className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs text-blue-300 font-semibold">Agenda</p>
              <p className="text-xs sm:text-sm text-blue-200 truncate">{formattedDate.label}</p>
            </div>
          </div>
          
          {/* Navegación de fechas */}
          {onDateChange && (
            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  const prev = new Date(selectedDate);
                  prev.setDate(prev.getDate() - 1);
                  onDateChange(prev);
                }}
                className="p-1.5 sm:p-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 transition-colors flex-shrink-0"
                title="Día anterior"
              >
                <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400" />
              </button>
              
              <button
                onClick={() => onDateChange(new Date())}
                className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 transition-colors text-[10px] sm:text-xs text-blue-300 font-medium whitespace-nowrap"
                title="Ir a hoy"
              >
                Hoy
              </button>
              
              <button
                onClick={() => {
                  const next = new Date(selectedDate);
                  next.setDate(next.getDate() + 1);
                  onDateChange(next);
                }}
                className="p-1.5 sm:p-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 transition-colors flex-shrink-0"
                title="Día siguiente"
              >
                <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400" />
              </button>
            </div>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 overflow-x-hidden">
        {eventsByInstructor.map(({ instructor, events: instructorEvents }) => {
          const instructorColor = instructorColors[instructor.id] || instructor.color_hex || "#3b82f6";
          
          return (
            <div 
              key={instructor.id} 
              className="bg-background-secondary rounded-xl border border-border p-3 sm:p-4 w-full min-w-0"
            >
              {/* Header del instructor */}
              <div className="flex items-center gap-1.5 sm:gap-2 mb-3 sm:mb-4 pb-2 sm:pb-3 border-b border-border">
                {instructor.photo_url ? (
                  <img
                    src={instructor.photo_url}
                    alt={instructor.name}
                    className="w-5 h-5 sm:w-6 sm:h-6 rounded-full border border-border flex-shrink-0 object-cover"
                  />
                ) : (
                  <div 
                    className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: instructorColor }}
                  />
                )}
                <h3 className="text-xs sm:text-sm font-semibold text-foreground truncate min-w-0 flex-1">
                  {instructor.name}
                </h3>
                <span className="text-[10px] sm:text-xs text-foreground-muted ml-auto whitespace-nowrap flex-shrink-0">
                  {instructorEvents.length} {instructorEvents.length === 1 ? 'turno' : 'turnos'}
                </span>
              </div>
              
              {/* Slots de tiempo - sin scroll, altura automática según contenido */}
              <div className="space-y-0">
                  {timeSlots.map((slot) => {
                  const slotEvents = getEventsForSlot(slot.time, instructorEvents);
                  const hasAppointments = slotEvents.length > 0;
                  
                  return (
                    <div
                      key={slot.id}
                      className="relative flex items-start gap-1.5 sm:gap-2 py-1.5 sm:py-2 min-h-[55px] sm:min-h-[60px]"
                    >
                      {/* Hora */}
                      <div className="flex flex-col items-center flex-shrink-0 w-10 sm:w-12">
                        <div className={`text-[9px] sm:text-[10px] font-bold ${
                          hasAppointments ? 'text-foreground' : 'text-foreground-muted'
                        }`}>
                          {slot.time}
                        </div>
                        <div className={`w-0.5 flex-1 mt-0.5 ${
                          hasAppointments 
                            ? 'bg-primary/40' 
                            : 'bg-border/20'
                        }`} />
                      </div>
                      
                      {/* Contenido */}
                      <div 
                        className={`flex-1 min-w-0 pt-0.5 transition-all ${
                          dragOverSlot === slot.time && dragOverInstructor === instructor.id
                            ? 'bg-primary/10 rounded-lg border-2 border-primary/40 border-dashed'
                            : ''
                        }`}
                        onDragEnter={(e) => handleDragEnter(e, slot.time, instructor.id)}
                        onDragOver={(e) => handleDragOver(e, slot.time, instructor.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, slot.time, instructor.id)}
                      >
                        {hasAppointments ? (
                          <div className="space-y-1 sm:space-y-1.5">
                            {slotEvents.map((item) => {
                              const ep = item.extendedProps || {};
                              const status = ep.status;
                              
                              const isDragging = draggedEvent?.event.id === item.id;
                              
                              return (
                                <div
                                  key={item.id}
                                  draggable={status !== 'cancelled'}
                                  onDragStart={(e) => {
                                    if (status !== 'cancelled') {
                                      e.stopPropagation(); // Evitar que se propague al contenedor
                                      handleDragStart(e, item, instructor.id);
                                    }
                                  }}
                                  onDragEnd={(e) => {
                                    e.stopPropagation();
                                    handleDragEnd();
                                  }}
                                  onClick={(e) => {
                                    // Solo hacer click si no se está arrastrando
                                    if (!draggedEvent) {
                                      onEventClick(item);
                                    }
                                  }}
                                  className={`cursor-grab active:cursor-grabbing rounded-lg border-2 p-1.5 sm:p-2 transition-all hover:shadow-md hover:scale-[1.01] ${
                                    isDragging ? 'opacity-50' : ''
                                  } ${status === 'cancelled' ? 'opacity-50 cursor-not-allowed' : ''}`}
                                  style={{
                                    borderColor: instructorColor,
                                    backgroundColor: `${instructorColor}15`
                                  }}
                                >
                                  <div className="flex items-center gap-1">
                                    {(() => {
                                      const ep = item.extendedProps || {};
                                      const pid = ep.instructor_id || ep.instructorId;
                                      const photo = instructorPhotos[pid];
                                      if (photo) {
                                        return <img src={photo} alt="" className="w-4 h-4 sm:w-5 sm:h-5 rounded-full border border-border flex-shrink-0 object-cover" />;
                                      }
                                      return null;
                                    })()}
                                    <div className="text-[11px] sm:text-xs font-semibold text-foreground truncate mb-0.5 sm:mb-1">
                                      {item.title}
                                    </div>
                                  </div>
                                  {ep.customer_name && (
                                    <div className="text-[9px] sm:text-[10px] text-foreground-muted truncate">
                                      {ep.customer_name}
                                    </div>
                                  )}
                                  {status === "confirmed" && (
                                    <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full mt-1" />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-[8px] sm:text-[9px] text-foreground-muted/50 italic py-1">
                            Libre
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =========================
   Vista de Semana por Instructor
========================= */
function WeekView({ events, instructors, instructorColors, timeRange, onEventClick, selectedDate, onDateChange, onEventDrop, instructorFilter }) {
  const [draggedEvent, setDraggedEvent] = useState(null);
  const [dragOverSlot, setDragOverSlot] = useState(null);
  const [dragOverInstructor, setDragOverInstructor] = useState(null);
  const [dragOverDay, setDragOverDay] = useState(null);
  const instructorPhotos = useMemo(() => {
    const map = {};
    (instructors || []).forEach((i) => {
      if (i.photo_url) map[i.id] = i.photo_url;
    });
    return map;
  }, [instructors]);

  // Calcular inicio y fin de semana (lunes a domingo)
  const weekRange = useMemo(() => {
    if (!selectedDate) return { start: null, end: null, days: [] };
    
    const date = new Date(selectedDate);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Ajuste para lunes como primer día
    
    const weekStart = new Date(date.setDate(diff));
    weekStart.setHours(0, 0, 0, 0);
    
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      days.push(day);
    }
    
    const weekEnd = new Date(days[6]);
    weekEnd.setHours(23, 59, 59, 999);
    
    return { start: weekStart, end: weekEnd, days };
  }, [selectedDate]);

  // Filtrar eventos de la semana (ya vienen filtrados desde CalendarView)
  const weekEvents = useMemo(() => {
    if (!weekRange.start || !weekRange.end) return [];
    return events.filter(e => {
      if (!e.start) return false;
      const start = new Date(e.start);
      if (isNaN(start.getTime())) return false;
      return start >= weekRange.start && start <= weekRange.end && e.extendedProps?.status !== 'cancelled';
    });
  }, [events, weekRange]);

  // Filtrar instructores si hay un filtro aplicado
  const filteredInstructors = useMemo(() => {
    if (!instructorFilter || instructorFilter === "") {
      return instructors || [];
    }
    const filterId = Number(instructorFilter);
    return (instructors || []).filter(instructor => {
      if (!isNaN(filterId)) {
        return Number(instructor.id) === filterId;
      }
      return String(instructor.id) === String(instructorFilter);
    });
  }, [instructors, instructorFilter]);

  // Agrupar eventos por día e instructor
  const eventsByDayAndInstructor = useMemo(() => {
    const grouped = {};
    
    weekRange.days.forEach(day => {
      const dayKey = day.toISOString().split('T')[0];
      grouped[dayKey] = {};
      
      // Inicializar solo con los instructores filtrados
      filteredInstructors.forEach(instructor => {
        grouped[dayKey][instructor.id] = {
          instructor,
          events: []
        };
      });
      
      // Eventos sin asignar
      grouped[dayKey]['unassigned'] = {
        instructor: { id: 'unassigned', name: 'Sin asignar', color_hex: '#6B7280' },
        events: []
      };
    });
    
    // Agrupar eventos
    weekEvents.forEach(event => {
      const start = new Date(event.start);
      const dayKey = start.toISOString().split('T')[0];
      if (!grouped[dayKey]) return;
      
      const instructorId = event.extendedProps?.instructor_id || event.extendedProps?.instructorId;
      const key = instructorId || 'unassigned';
      
      if (!grouped[dayKey][key]) {
        grouped[dayKey][key] = {
          instructor: { id: key, name: 'Sin asignar', color_hex: '#6B7280' },
          events: []
        };
      }
      
      grouped[dayKey][key].events.push(event);
    });
    
    return grouped;
  }, [weekEvents, weekRange.days, filteredInstructors]);

  // Generar slots de tiempo (cada hora para semana, más compacto)
  const generateTimeSlots = useCallback(() => {
    const slots = [];
    const minHour = parseInt(timeRange?.min?.split(':')[0] || 6);
    const maxHour = parseInt(timeRange?.max?.split(':')[0] || 23);
    
    // Para semana, usar intervalos de 1 hora para hacerla más compacta
    for (let hour = minHour; hour <= maxHour; hour++) {
      const time = `${String(hour).padStart(2, '0')}:00`;
      slots.push({ time, id: `slot-${time}` });
    }
    return slots;
  }, [timeRange]);

  const timeSlots = useMemo(() => generateTimeSlots(), [generateTimeSlots]);

  const getEventsForSlot = useCallback((slotTime, dayEvents) => {
    return dayEvents.filter(event => {
      const start = new Date(event.start);
      const hour = start.getHours();
      const minute = start.getMinutes();
      // Redondear a la hora más cercana para vista semanal
      const eventSlotTime = `${String(hour).padStart(2, '0')}:00`;
      return eventSlotTime === slotTime;
    });
  }, []);

  // Handlers drag and drop
  const handleDragStart = useCallback((e, event) => {
    if (event.extendedProps?.status === 'cancelled') return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ''); // Necesario para algunos navegadores
    console.log("[WeekView] handleDragStart:", { eventId: event.id, event });
    setDraggedEvent(event);
  }, []);

  const handleDragEnter = useCallback((e, slotTime, instructorId, day) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedEvent) {
      e.dataTransfer.dropEffect = 'move';
      setDragOverSlot(slotTime);
      setDragOverInstructor(instructorId);
      setDragOverDay(day);
    }
  }, [draggedEvent]);

  const handleDragOver = useCallback((e, slotTime, instructorId, day) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedEvent) {
      e.dataTransfer.dropEffect = 'move';
      setDragOverSlot(slotTime);
      setDragOverInstructor(instructorId);
      setDragOverDay(day);
    }
  }, [draggedEvent]);

  const handleDragLeave = useCallback((e) => {
    // Solo limpiar si realmente salimos del área de drop (no solo de un hijo)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverSlot(null);
      setDragOverInstructor(null);
      setDragOverDay(null);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedEvent(null);
    setDragOverSlot(null);
    setDragOverInstructor(null);
    setDragOverDay(null);
  }, []);

  const handleDrop = useCallback(async (e, slotTime, targetInstructorId, targetDay) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedEvent || !onEventDrop) {
      handleDragEnd();
      return;
    }

    // Parsear fecha del día objetivo
    const [hour, minute] = slotTime.split(':').map(Number);
    let newDate;
    
    if (targetDay) {
      // Si targetDay es un string (dayKey), crear fecha desde ese string
      if (typeof targetDay === 'string') {
        newDate = new Date(targetDay + 'T00:00:00');
      } else {
        newDate = new Date(targetDay);
      }
    } else {
      // Fallback a selectedDate si no hay targetDay
      newDate = new Date(selectedDate);
    }
    
    newDate.setHours(hour, minute || 0, 0, 0);
    
    // Calcular duración del evento original
    const originalStart = new Date(draggedEvent.start);
    const originalEnd = new Date(draggedEvent.end || new Date(originalStart.getTime() + 30 * 60 * 1000));
    const duration = originalEnd.getTime() - originalStart.getTime();
    
    // Función helper para convertir Date a formato MySQL local (sin UTC)
    const toLocalMySQL = (date) => {
      const pad = (n) => String(n).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    };

    const oldInstructorId = draggedEvent.extendedProps?.instructor_id || draggedEvent.extendedProps?.instructorId || null;
    const instructorChanged = String(targetInstructorId) !== String(oldInstructorId || 'unassigned');
    const timeChanged = Math.abs(newDate.getTime() - originalStart.getTime()) > 60000; // Más de 1 minuto de diferencia

    // Verificar que sea un appointment (no una clase)
    const eventType = draggedEvent.extendedProps?.eventType;
    if (eventType === 'class_session') {
      logger.warn("[WeekView] No se puede mover una clase con drag and drop");
      handleDragEnd();
      return;
    }

    // Siempre actualizar si hay cambios
    if (instructorChanged || timeChanged) {
      try {
        // Convertir a formato MySQL local (YYYY-MM-DD HH:mm:ss) en hora local, no UTC
        const newEndDate = new Date(newDate.getTime() + duration);
        const updates = {
          starts_at: toLocalMySQL(newDate),
          ends_at: toLocalMySQL(newEndDate),
        };

        if (targetInstructorId && targetInstructorId !== 'unassigned') {
          updates.instructor_id = parseInt(targetInstructorId);
        } else {
          updates.instructor_id = null;
        }

        // Llamar a onEventDrop con el tipo de evento para mostrar diálogo de notificación
        await onEventDrop(draggedEvent.id, updates, eventType);
        
        // Limpiar el estado de drag después de la actualización
        handleDragEnd();
      } catch (error) {
        logger.error("[WeekView] Error en handleDrop:", error);
        handleDragEnd(); // Limpiar estado incluso si hay error
        throw error;
      }
    } else {
      // Si no hay cambios, solo limpiar el estado
      handleDragEnd();
    }
  }, [draggedEvent, selectedDate, onEventDrop, handleDragEnd]);

  // Formatear rango de semana
  const formattedWeek = useMemo(() => {
    if (!weekRange.start || !weekRange.end) return '';
    const start = weekRange.start.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
    const end = weekRange.end.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${start} - ${end}`;
  }, [weekRange]);

  if (!weekRange.start || !weekRange.end) {
    return (
      <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 rounded-2xl p-6 border border-blue-500/20 mb-6">
        <p className="text-sm text-blue-300 text-center">Cargando semana...</p>
      </div>
    );
  }

  return (
    <div className="mb-6 overflow-x-hidden">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-blue-500/20 mb-3 sm:mb-4">
        <div className="flex items-center justify-between gap-2 sm:gap-3 md:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <div className="p-1.5 sm:p-2 bg-blue-500/20 rounded-lg sm:rounded-xl flex-shrink-0">
              <CalendarRange className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs text-blue-300 font-semibold">Semana</p>
              <p className="text-xs sm:text-sm text-blue-200 truncate">{formattedWeek}</p>
            </div>
          </div>
          
          {onDateChange && (
            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  const prev = new Date(selectedDate);
                  prev.setDate(prev.getDate() - 7);
                  onDateChange(prev);
                }}
                className="p-1.5 sm:p-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 transition-colors flex-shrink-0"
                title="Semana anterior"
              >
                <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400" />
              </button>
              
              <button
                onClick={() => onDateChange(new Date())}
                className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 transition-colors text-[10px] sm:text-xs text-blue-300 font-medium whitespace-nowrap"
              >
                Hoy
              </button>
              
              <button
                onClick={() => {
                  const next = new Date(selectedDate);
                  next.setDate(next.getDate() + 7);
                  onDateChange(next);
                }}
                className="p-1.5 sm:p-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 transition-colors flex-shrink-0"
                title="Semana siguiente"
              >
                <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Grid de días e instructores */}
      <div className="overflow-x-auto -mx-2 sm:mx-0 px-2 sm:px-0">
        <div className="min-w-full">
          {/* Header de días */}
          <div className="grid grid-cols-8 gap-1.5 sm:gap-2 mb-2 sticky top-0 bg-background-secondary z-10 pb-2 min-w-[640px]">
            <div className="w-12 sm:w-14 md:w-16"></div> {/* Columna de horas */}
            {weekRange.days.map((day) => {
              const isToday = day.toDateString() === new Date().toDateString();
              return (
                <div
                  key={day.toISOString()}
                  className={`text-center p-1.5 sm:p-2 rounded-lg ${isToday ? 'bg-blue-500/20' : 'bg-background-secondary'}`}
                >
                  <div className="text-[10px] sm:text-xs font-semibold text-foreground-muted uppercase">
                    {day.toLocaleDateString('es-AR', { weekday: 'short' })}
                  </div>
                  <div className={`text-sm sm:text-base md:text-lg font-bold ${isToday ? 'text-blue-400' : 'text-foreground'}`}>
                    {day.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Grid principal: horas x días x instructores */}
          <div className="space-y-4">
            {filteredInstructors.map((instructor) => {
              const instructorColor = instructorColors[instructor.id] || instructor.color_hex || "#3b82f6";
              
              return (
                <div key={instructor.id} className="bg-background-secondary rounded-lg border border-border p-3">
                  {/* Header del instructor - más compacto */}
                  <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-border/50">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: instructorColor }}
                    />
                    <h3 className="text-xs font-semibold text-foreground">{instructor.name}</h3>
                  </div>

                  {/* Grid de días - diseño compacto */}
                  <div className="grid grid-cols-8 gap-1.5 min-w-[640px]">
                    {/* Columna de horas */}
                    <div className="space-y-0 sticky left-0 bg-background-secondary z-5">
                      {timeSlots.map((slot) => (
                        <div key={slot.id} className="h-[35px] sm:h-[40px] flex items-center justify-end pr-1 sm:pr-2">
                          <span className="text-[9px] sm:text-[10px] text-foreground-muted font-semibold">
                            {slot.time}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Columnas de días */}
                    {weekRange.days.map((day) => {
                      const dayKey = day.toISOString().split('T')[0];
                      const dayEvents = eventsByDayAndInstructor[dayKey]?.[instructor.id]?.events || [];
                      const isToday = day.toDateString() === new Date().toDateString();
                      
                      return (
                        <div
                          key={dayKey}
                          className={`space-y-0 rounded border ${isToday ? 'border-blue-500/40 bg-blue-500/5' : 'border-border/50'}`}
                        >
                          {timeSlots.map((slot) => {
                            const slotEvents = getEventsForSlot(slot.time, dayEvents);
                            const hasAppointments = slotEvents.length > 0;
                            const isDragOver = dragOverSlot === slot.time && 
                                              dragOverInstructor === String(instructor.id) && 
                                              dragOverDay === dayKey;

                            return (
                              <div
                                key={slot.id}
                                className={`h-[40px] border-b border-border/10 relative transition-all ${
                                  isDragOver ? 'bg-primary/10 border-primary/40 border-2 border-dashed' : ''
                                }`}
                                onDragEnter={(e) => handleDragEnter(e, slot.time, instructor.id, dayKey)}
                                onDragOver={(e) => handleDragOver(e, slot.time, instructor.id, dayKey)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, slot.time, instructor.id, dayKey)}
                              >
                                {hasAppointments && (
                                  <div className="absolute inset-0 p-0.5 flex flex-col gap-0.5">
                                    {slotEvents.slice(0, 2).map((item) => {
                                      const ep = item.extendedProps || {};
                                      const isDragging = draggedEvent?.id === item.id;
                                      const photo = instructorPhotos[ep.instructor_id || ep.instructorId];
                                      return (
                                        <div
                                          key={item.id}
                                          draggable={ep.status !== 'cancelled'}
                                          onDragStart={(e) => {
                                            if (ep.status !== 'cancelled') {
                                              e.stopPropagation(); // Evitar que se propague al contenedor
                                              handleDragStart(e, item);
                                            }
                                          }}
                                          onDragEnd={(e) => {
                                            e.stopPropagation();
                                            handleDragEnd();
                                          }}
                                          onClick={(e) => {
                                            // Solo hacer click si no se está arrastrando
                                            if (!draggedEvent) {
                                              onEventClick(item);
                                            }
                                          }}
                                          className={`cursor-grab active:cursor-grabbing rounded text-[8px] px-1 py-0.5 truncate transition-all hover:scale-[1.02] ${
                                            isDragging ? 'opacity-50' : ''
                                          } ${ep.status === 'cancelled' ? 'opacity-50 cursor-not-allowed' : ''}`}
                                          style={{
                                            backgroundColor: `${instructorColor}25`,
                                            borderLeft: `2px solid ${instructorColor}`,
                                            color: '#fff',
                                            fontWeight: '500'
                                          }}
                                          title={`${item.title} - ${new Date(item.start).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`}
                                        >
                                          <span className="inline-flex items-center gap-1">
                                            {photo ? <img src={photo} alt="" className="w-3 h-3 rounded-full border border-border object-cover" /> : null}
                                            <span className="truncate">{item.title}</span>
                                          </span>
                                        </div>
                                      );
                                    })}
                                    {slotEvents.length > 2 && (
                                      <div className="text-[7px] text-foreground-muted/70 px-1">
                                        +{slotEvents.length - 2}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Vista de Mes
========================= */
function MonthView({ events, instructors, instructorColors, onEventClick, selectedDate, onDateChange, instructorFilter }) {
  const instructorPhotos = useMemo(() => {
    const map = {};
    (instructors || []).forEach((i) => {
      if (i.photo_url) map[i.id] = i.photo_url;
    });
    return map;
  }, [instructors]);
  // Calcular inicio y fin del mes
  const monthRange = useMemo(() => {
    if (!selectedDate) return { start: null, end: null, days: [] };
    
    const date = new Date(selectedDate);
    const year = date.getFullYear();
    const month = date.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    // Ajustar para empezar en lunes
    const startDate = new Date(firstDay);
    const dayOfWeek = startDate.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    startDate.setDate(startDate.getDate() - diff);
    
    // Generar todas las fechas del mes (incluyendo días previos y siguientes para completar semanas)
    const days = [];
    const currentDate = new Date(startDate);
    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + (6 - endDate.getDay())); // Completar hasta domingo
    
    while (currentDate <= endDate) {
      days.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return {
      start: firstDay,
      end: lastDay,
      days,
      monthName: date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    };
  }, [selectedDate]);

  // Filtrar eventos del mes
  // Filtrar eventos del mes (ya vienen filtrados desde CalendarView)
  const monthEvents = useMemo(() => {
    if (!monthRange.start || !monthRange.end) return [];
    return events.filter(e => {
      if (!e.start) return false;
      const start = new Date(e.start);
      if (isNaN(start.getTime())) return false;
      return start >= monthRange.start && start <= monthRange.end && e.extendedProps?.status !== 'cancelled';
    });
  }, [events, monthRange]);

  // Agrupar eventos por día
  const eventsByDay = useMemo(() => {
    const grouped = {};
    
    monthEvents.forEach(event => {
      const start = new Date(event.start);
      const dayKey = start.toISOString().split('T')[0];
      
      if (!grouped[dayKey]) {
        grouped[dayKey] = [];
      }
      
      grouped[dayKey].push(event);
    });
    
    return grouped;
  }, [monthEvents]);

  const isToday = (day) => day.toDateString() === new Date().toDateString();
  const isCurrentMonth = (day) => day.getMonth() === new Date(selectedDate).getMonth();

  return (
    <div className="mb-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 rounded-2xl p-4 border border-blue-500/20 mb-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-xl">
              <LayoutGrid className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-blue-300 font-semibold">Mes</p>
              <p className="text-sm text-blue-200 capitalize">{monthRange.monthName}</p>
            </div>
          </div>
          
          {onDateChange && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const prev = new Date(selectedDate);
                  prev.setMonth(prev.getMonth() - 1);
                  onDateChange(prev);
                }}
                className="p-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 transition-colors"
                title="Mes anterior"
              >
                <ChevronLeft className="w-4 h-4 text-blue-400" />
              </button>
              
              <button
                onClick={() => onDateChange(new Date())}
                className="px-3 py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 transition-colors text-xs text-blue-300 font-medium"
              >
                Hoy
              </button>
              
              <button
                onClick={() => {
                  const next = new Date(selectedDate);
                  next.setMonth(next.getMonth() + 1);
                  onDateChange(next);
                }}
                className="p-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 transition-colors"
                title="Mes siguiente"
              >
                <ChevronRight className="w-4 h-4 text-blue-400" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Grid del mes */}
      <div className="bg-background-secondary rounded-xl border border-border p-4">
        {/* Días de la semana */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => (
            <div key={day} className="text-center p-2 text-xs font-semibold text-foreground-muted uppercase">
              {day}
            </div>
          ))}
        </div>

        {/* Días del mes */}
        <div className="grid grid-cols-7 gap-2">
          {monthRange.days.map((day) => {
            const dayKey = day.toISOString().split('T')[0];
            const dayEvents = eventsByDay[dayKey] || [];
            const today = isToday(day);
            const currentMonth = isCurrentMonth(day);
            
            return (
              <div
                key={dayKey}
                className={`min-h-[120px] rounded-lg border p-2 transition-all ${
                  today 
                    ? 'border-blue-500 bg-blue-500/10' 
                    : currentMonth
                      ? 'border-border bg-background-secondary/50'
                      : 'border-border/30 bg-background-secondary/20 opacity-50'
                }`}
                onClick={() => onDateChange?.(day)}
              >
                <div className={`text-sm font-bold mb-1 ${today ? 'text-blue-400' : currentMonth ? 'text-foreground' : 'text-foreground-muted'}`}>
                  {day.getDate()}
                </div>
                
                <div className="space-y-1">
                  {dayEvents.slice(0, 3).map((event) => {
                    const ep = event.extendedProps || {};
                    const instructorId = ep.instructor_id || ep.instructorId;
                    const instructorColor = instructorColors[instructorId] || "#3b82f6";
                    const photo = instructorPhotos[instructorId];
                    
                    return (
                      <div
                        key={event.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(event);
                        }}
                        className="text-[10px] px-2 py-1 rounded truncate cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02]"
                        style={{
                          backgroundColor: `${instructorColor}20`,
                          borderLeft: `3px solid ${instructorColor}`,
                          color: '#fff'
                        }}
                        title={event.title}
                      >
                        <div className="flex items-center gap-1">
                          {photo ? (
                            <img src={photo} alt="" className="w-3.5 h-3.5 rounded-full border border-border flex-shrink-0 object-cover" />
                          ) : null}
                          <div className="font-semibold truncate">{event.title}</div>
                        </div>
                        <div className="text-[9px] opacity-75 truncate">
                          {new Date(event.start).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    );
                  })}
                  
                  {dayEvents.length > 3 && (
                    <div className="text-[9px] text-foreground-muted font-semibold">
                      +{dayEvents.length - 3} más
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* =========================
   Estadísticas rápidas (solo estadísticas, sin "Hoy")
========================= */
function QuickStats({ events, instructors }) {
  const stats = useMemo(() => {
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const weekEvents = events.filter(e => {
      if (!e.start) return false;
      const start = new Date(e.start);
      if (isNaN(start.getTime())) return false;
      return start >= weekStart && start < weekEnd && e.extendedProps?.status !== 'cancelled';
    });

    const pendingDeposits = events.filter(e => 
      e.extendedProps?.status === 'pending_deposit'
    );

    return {
      weekCount: weekEvents.length,
      pendingCount: pendingDeposits.length,
      cancelledCount: events.filter(e => e.extendedProps?.status === 'cancelled').length
    };
  }, [events]);

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3 md:gap-4 mb-4 sm:mb-5 md:mb-6">
      <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/10 rounded-xl sm:rounded-2xl p-2.5 sm:p-3 md:p-4 border border-purple-500/20">
        <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3">
          <div className="p-1.5 sm:p-2 bg-purple-500/20 rounded-lg sm:rounded-xl flex-shrink-0">
            <CalendarRange className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-5 md:h-5 text-purple-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] sm:text-xs text-purple-300 truncate">Esta semana</p>
            <p className="text-lg sm:text-xl md:text-2xl font-bold text-purple-100">{stats.weekCount}</p>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/10 rounded-xl sm:rounded-2xl p-2.5 sm:p-3 md:p-4 border border-amber-500/20">
        <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3">
          <div className="p-1.5 sm:p-2 bg-amber-500/20 rounded-lg sm:rounded-xl flex-shrink-0">
            <Activity className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-5 md:h-5 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] sm:text-xs text-amber-300 truncate">Seña pendiente</p>
            <p className="text-lg sm:text-xl md:text-2xl font-bold text-amber-100">{stats.pendingCount}</p>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-br from-red-500/10 to-red-600/10 rounded-xl sm:rounded-2xl p-2.5 sm:p-3 md:p-4 border border-red-500/20">
        <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3">
          <div className="p-1.5 sm:p-2 bg-red-500/20 rounded-lg sm:rounded-xl flex-shrink-0">
            <EyeOff className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-5 md:h-5 text-red-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] sm:text-xs text-red-300 truncate">Cancelados</p>
            <p className="text-lg sm:text-xl md:text-2xl font-bold text-red-100">{stats.cancelledCount}</p>
          </div>
        </div>
      </div>
    </div>
  );
}


export default function CalendarView() {
  const appCtx = useContext(AppContext);
  const { theme } = useTheme();

  if (!appCtx) {
    return (
      <div className="p-6 text-center text-sm text-foreground-muted">
        Calendario no disponible. Este componente necesita el contexto de la app.
      </div>
    );
  }

  const { events, eventsLoading, eventsError, setRange, loadEvents, instructors, deleteAppointment, updateAppointment, setEvents } = appCtx;
  const [instructorFilter, setInstructorFilter] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [notificationDialog, setNotificationDialog] = useState(null); // { eventId, updates, eventType, pending: boolean }
  const [supportAgentEnabled, setSupportAgentEnabled] = useState(true); // Por defecto true para no romper la funcionalidad existente
  const isMobile = useIsMobile(768);
  const [hideCancelled, setHideCancelled] = useState(false);
  const [showStats, setShowStats] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentView, setCurrentView] = useState("day"); // "day" | "week" | "month"
  const [refreshKey, setRefreshKey] = useState(0); // Key para forzar re-render después de actualizaciones
  const [lastUpdateTime, setLastUpdateTime] = useState(Date.now()); // Timestamp de última actualización

  const instructorColors = useMemo(() => buildInstructorColorMap(instructors), [instructors]);

  // Cargar configuración de WhatsApp para verificar si el botón de ayuda está habilitado
  useEffect(() => {
    const loadWhatsAppConfig = async () => {
      try {
        const config = await apiClient.getWhatsAppConfig();
        setSupportAgentEnabled(config?.supportAgentEnabled ?? true);
      } catch (error) {
        logger.warn("[CalendarView] Error cargando configuración de WhatsApp, usando valor por defecto:", error);
        setSupportAgentEnabled(true); // Por defecto permitir notificaciones
      }
    };
    loadWhatsAppConfig();
  }, []);

  // Función helper para actualizar turno/clase sin mostrar modal
  const handleDirectUpdate = useCallback(async (eventId, updates, eventType = 'appointment') => {
    try {
      const isClassSession = eventType === 'class_session';
      
      if (isClassSession) {
        // Extraer el ID real de la clase
        const classId = String(eventId).startsWith('class-') 
          ? String(eventId).replace('class-', '') 
          : eventId;
        
        // Preparar body para clase
        const formatToMySQL = (dateValue) => {
          if (!dateValue) return null;
          if (dateValue instanceof Date) {
            const pad = (n) => String(n).padStart(2, '0');
            return `${dateValue.getFullYear()}-${pad(dateValue.getMonth() + 1)}-${pad(dateValue.getDate())} ${pad(dateValue.getHours())}:${pad(dateValue.getMinutes())}:${pad(dateValue.getSeconds())}`;
          }
          if (typeof dateValue === 'string') {
            if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateValue)) {
              return dateValue;
            }
            if (dateValue.includes('T')) {
              return dateValue.replace('T', ' ').slice(0, 19);
            }
            return dateValue;
          }
          return null;
        };
        
        const classBody = {};
        if (updates.starts_at || updates.startsAt) {
          classBody.startsAt = formatToMySQL(updates.starts_at || updates.startsAt);
        }
        if (updates.ends_at || updates.endsAt) {
          classBody.endsAt = formatToMySQL(updates.ends_at || updates.endsAt);
        }
        if (updates.instructor_id !== undefined) {
          classBody.instructorId = updates.instructor_id;
        }
        
        logger.info("[CalendarView] Actualizando clase directamente:", { classId, classBody });
        const result = await apiClient.updateClassSession(classId, classBody);
        
        // Actualización optimista para clases
        setEvents(prevEvents => {
          return prevEvents.map(event => {
            const eventIdStr = String(event.id);
            if (eventIdStr === String(eventId) || eventIdStr === `class-${classId}`) {
              const updated = { ...event };
              if (classBody.startsAt) {
                updated.start = typeof classBody.startsAt === 'string' 
                  ? classBody.startsAt.replace(' ', 'T') 
                  : classBody.startsAt.toISOString();
              }
              if (classBody.endsAt) {
                updated.end = typeof classBody.endsAt === 'string' 
                  ? classBody.endsAt.replace(' ', 'T') 
                  : classBody.endsAt.toISOString();
              }
              if (classBody.instructorId !== undefined && updated.extendedProps) {
                updated.extendedProps.instructor_id = classBody.instructorId;
                updated.extendedProps.instructorId = classBody.instructorId;
              }
              return updated;
            }
            return event;
          });
        });
        
        if (!result || !result.ok) {
          logger.error("[CalendarView] La actualización de clase no fue exitosa:", result);
          toast.error(result?.error || 'Error al actualizar la clase');
          return;
        }
        
        toast.success('Clase actualizada correctamente');
        await loadEvents();
      } else {
        // Actualizar appointment directamente
        logger.info("[CalendarView] Actualizando turno directamente:", { eventId, updates });
        const result = await updateAppointment(eventId, updates, true);
        
        if (!result || !result.ok) {
          logger.error("[CalendarView] La actualización de turno no fue exitosa:", result);
          toast.error(result?.error || 'Error al actualizar el turno');
          return;
        }
        
        toast.success('Turno actualizado correctamente');
        await loadEvents();
      }
    } catch (error) {
      logger.error("[CalendarView] Error al actualizar directamente:", error);
      toast.error(error?.message || 'Error al actualizar');
    }
  }, [updateAppointment, loadEvents, setEvents]);

  // Calcular rango de horarios dinámicamente basado en los horarios de las sucursales
  const [calendarTimeRange, setCalendarTimeRange] = useState({ min: "06:00:00", max: "23:00:00" });

  useEffect(() => {
    // Cargar configuración personalizada de horarios del calendario
    const loadCalendarTimeRange = async () => {
      try {
        const config = await apiClient.getConfigSection("calendar").catch(() => ({}));
        const minTime = config.minTime || "06:00:00";
        const maxTime = config.maxTime || "23:00:00";
        setCalendarTimeRange({ min: minTime, max: maxTime });
      } catch (error) {
        // Si hay error, usar valores por defecto
        logger.warn("[CalendarView] Error cargando configuración de horarios, usando valores por defecto:", error);
        setCalendarTimeRange({ min: "06:00:00", max: "23:00:00" });
      }
    };
    
    loadCalendarTimeRange();
  }, []);

  const resources = useMemo(() => {
    const map = new Map();
    (instructors || []).forEach((s, idx) => {
      map.set(String(s.id), {
        id: String(s.id),
        title: s.name,
        color_hex: s.color_hex?.trim() || colorByIndex(idx),
      });
    });

    let needsUnassigned = false;
    (events || []).forEach((ev) => {
      const ep = ev.extendedProps || {};
      const sid = ep.instructor_id ?? ep.instructorId;
      if (!sid) needsUnassigned = true;
    });

    if (needsUnassigned) {
      map.set("unassigned", { id: "unassigned", title: "Sin asignar", color_hex: "#6B7280" });
    }

    if (map.size === 0) {
      map.set("unassigned", { id: "unassigned", title: "Sin asignar", color_hex: "#6B7280" });
    }

    return Array.from(map.values());
  }, [instructors, events]);

  const filtered = useMemo(() => {
    let list = Array.isArray(events) ? events : [];
    
    // Aplicar filtro de instructor
    if (instructorFilter && instructorFilter !== "") {
      const beforeCount = list.length;
      list = list.filter((ev) => {
        const evInstructorId = ev?.extendedProps?.instructor_id ?? ev?.extendedProps?.instructorId ?? null;
        // Comparar como números si ambos son numéricos, sino como strings
        const filterId = Number(instructorFilter);
        const evId = evInstructorId !== null ? Number(evInstructorId) : null;
        
        if (!isNaN(filterId) && evId !== null && !isNaN(evId)) {
          return filterId === evId;
        }
        // Fallback a comparación de strings
        return String(evInstructorId) === String(instructorFilter);
      });
      logger.info("[CalendarView] Filtro de instructor aplicado:", {
        filterId: instructorFilter,
        antes: beforeCount,
        despues: list.length,
        eventosFiltrados: list.map(e => ({
          id: e.id,
          instructor_id: e.extendedProps?.instructor_id ?? e.extendedProps?.instructorId
        }))
      });
    }
    
    // Aplicar filtro de cancelados
    if (hideCancelled) {
      const beforeCount = list.length;
      list = list.filter((ev) => (ev?.extendedProps?.status || "") !== "cancelled");
      logger.info("[CalendarView] Filtro de cancelados aplicado:", {
        antes: beforeCount,
        despues: list.length
      });
    }
    
    return list;
  }, [events, instructorFilter, hideCancelled]);

  // Forzar actualización visual cuando cambian los eventos
  // Usamos un hash simple basado en los IDs y fechas de los eventos para detectar cambios reales
  const eventsHash = useMemo(() => {
    if (!Array.isArray(events) || events.length === 0) return '';
    // Incluir más información para detectar cambios: ID, start, end, instructor_id
    const hash = events
      .map(e => {
        const start = e.start ? new Date(e.start).toISOString() : '';
        const end = e.end ? new Date(e.end).toISOString() : '';
        const instructorId = e.extendedProps?.instructor_id || e.extendedProps?.instructorId || 'none';
        return `${e.id}-${start}-${end}-${instructorId}`;
      })
      .sort()
      .join('|');
    logger.info("[CalendarView] Hash de eventos calculado:", { hashLength: hash.length, eventsCount: events.length, sample: hash.substring(0, 150) });
    return hash;
  }, [events]);

  useEffect(() => {
    // Actualizar lastUpdateTime cuando cambia el hash de eventos
    if (eventsHash) {
      const newUpdateTime = Date.now();
      setLastUpdateTime(newUpdateTime);
      logger.info("[CalendarView] Hash de eventos cambió, actualizando lastUpdateTime:", newUpdateTime, "hash length:", eventsHash.length);
    }
  }, [eventsHash]);

  // Cargar eventos según la vista actual
  useEffect(() => {
    if (!selectedDate) return;
    
    let startDate, endDate;
    
    if (currentView === "day") {
      startDate = new Date(selectedDate);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(selectedDate);
      endDate.setHours(23, 59, 59, 999);
    } else if (currentView === "week") {
      const date = new Date(selectedDate);
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Lunes como primer día
      
      startDate = new Date(date.setDate(diff));
      startDate.setHours(0, 0, 0, 0);
      
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else if (currentView === "month") {
      const date = new Date(selectedDate);
      const year = date.getFullYear();
      const month = date.getMonth();
      
      startDate = new Date(year, month, 1);
      startDate.setHours(0, 0, 0, 0);
      
      endDate = new Date(year, month + 1, 0);
      endDate.setHours(23, 59, 59, 999);
    }
    
    setRange({ fromIso: startDate.toISOString(), toIso: endDate.toISOString() });
  }, [selectedDate, currentView, setRange]);

  return (
    <div className={`${theme === "dark" ? "calendar-dark" : "calendar-light"} relative w-full overflow-x-hidden`}>
      <div className="relative z-10 w-full">
        <div className="bg-background/95 backdrop-blur-xl border border-border rounded-2xl sm:rounded-3xl p-3 sm:p-4 md:p-6 transition-all duration-500 shadow-2xl w-full max-w-full overflow-x-hidden">
          {/* Header mejorado */}
          <div className="flex flex-col gap-3 sm:gap-4 md:gap-6 mb-3 sm:mb-4 md:mb-6 w-full">
            {/* Título y controles principales */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 sm:gap-3 md:gap-4 w-full min-w-0">
              <div className="flex items-center gap-2 sm:gap-3 md:gap-4 min-w-0 flex-1">
                <div className="p-2 sm:p-2.5 md:p-3 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-xl sm:rounded-2xl flex-shrink-0">
                  <Calendar className="w-5 h-5 sm:w-6 sm:h-6 md:w-8 md:h-8 text-blue-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 truncate">
                    Calendario General
                  </h2>
                  <p className="text-xs sm:text-sm text-foreground-muted mt-0.5 sm:mt-1 hidden sm:block">
                    Vista completa de turnos y clases
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                <button
                  onClick={() => setShowStats(!showStats)}
                  className="p-2.5 sm:p-3 rounded-xl bg-background-secondary border border-border hover:border-primary/30 transition-all flex-shrink-0"
                  title={showStats ? "Ocultar estadísticas" : "Mostrar estadísticas"}
                >
                  <Activity className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
                
                <button
                  onClick={loadEvents}
                  disabled={eventsLoading}
                  className="inline-flex items-center gap-2 px-3 sm:px-4 md:px-5 py-2 sm:py-2.5 md:py-3 rounded-xl 
                           bg-gradient-to-r from-blue-600 to-purple-600 text-white text-xs sm:text-sm font-medium
                           hover:from-blue-700 hover:to-purple-700 
                           shadow-lg hover:shadow-xl transform hover:-translate-y-0.5
                           transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 sm:w-5 sm:h-5 ${eventsLoading ? "animate-spin" : ""}`} />
                  <span className="hidden xs:inline">{eventsLoading ? "Actualizando..." : "Actualizar"}</span>
                  <span className="xs:hidden">{eventsLoading ? "..." : "Actualizar"}</span>
                </button>
              </div>
            </div>

            {/* Estadísticas rápidas */}
            {showStats && (
              <QuickStats events={events} instructors={instructors} />
            )}

            {/* Filtros y controles */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 md:gap-4 w-full min-w-0">
              {/* Filtro estilista mejorado */}
              <div className="relative flex-1 min-w-0 w-full sm:max-w-xs">
                <Filter className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-foreground-muted/60 pointer-events-none" />
                <select
                  value={instructorFilter}
                  onChange={(e) => setInstructorFilter(e.target.value)}
                  disabled={Array.isArray(instructors) && instructors.length === 0}
                  className="
                    w-full pl-10 sm:pl-12 pr-10 sm:pr-12 py-2.5 sm:py-3
                    rounded-xl
                    bg-background-secondary/80 backdrop-blur-sm
                    border border-border
                    text-foreground text-xs sm:text-sm
                    placeholder:text-foreground-muted
                    focus:outline-none
                    focus:ring-2 focus:ring-primary/40
                    focus:border-primary
                    focus:bg-background-secondary
                    transition-all duration-200
                    hover:border-border/80
                    disabled:opacity-50 disabled:cursor-not-allowed
                    appearance-none
                    cursor-pointer
                    min-w-0
                  "
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                    backgroundSize: '1.5rem'
                  }}
                >
                  <option className="bg-background" value="">
                    {Array.isArray(instructors) && instructors.length > 0
                      ? "Todos los profesionales"
                      : "Sin filtro de profesional"}
                  </option>
                  {(instructors || []).map((s) => (
                    <option key={s.id} className="bg-background" value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Toggle cancelados mejorado */}
              <button
                onClick={() => setHideCancelled(v => !v)}
                className={`
                  inline-flex items-center gap-2 sm:gap-2.5 px-3 sm:px-4 md:px-5 py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm font-medium
                  border transition-all duration-200 transform hover:scale-[1.02] whitespace-nowrap flex-shrink-0
                  ${hideCancelled 
                    ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20" 
                    : "bg-background-secondary/80 border-border text-foreground hover:border-primary/30"}
                `}
                title={hideCancelled ? "Mostrar cancelados" : "Ocultar cancelados"}
              >
                {hideCancelled ? <Eye className="w-4 h-4 sm:w-5 sm:h-5" /> : <EyeOff className="w-4 h-4 sm:w-5 sm:h-5" />}
                <span className="hidden sm:inline">{hideCancelled ? "Mostrar cancelados" : "Ocultar cancelados"}</span>
                <span className="sm:hidden">{hideCancelled ? "Mostrar" : "Ocultar"}</span>
              </button>
            </div>
          </div>

          {/* Errores mejorados */}
          {eventsError && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-gradient-to-r from-red-500/10 to-red-600/10 
                            border border-red-500/20 text-red-400 text-sm backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="p-1.5 bg-red-500/20 rounded-lg">
                  <Activity className="w-4 h-4" />
                </div>
                {eventsError}
              </div>
            </div>
          )}

          {/* Vista de Agenda Personalizada */}
          <div className="relative rounded-xl sm:rounded-2xl border border-border bg-background-secondary backdrop-blur-sm p-2 sm:p-3 shadow-inner overflow-x-hidden">
            {/* Loading overlay */}
            {eventsLoading && (
              <div className="absolute inset-0 bg-background/60 backdrop-blur-sm z-20 flex items-center justify-center rounded-2xl">
                <div className="flex flex-col items-center gap-3">
                  <div className="relative">
                    <div className="w-16 h-16 border-4 border-primary/20 rounded-full" />
                    <div className="absolute inset-0 w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                  <p className="text-sm font-medium text-foreground-muted">Cargando eventos...</p>
                </div>
              </div>
            )}
            
            {/* Selector de vista */}
            <div className="flex items-center justify-center gap-1.5 sm:gap-2 mb-3 sm:mb-4 overflow-x-auto pb-2 -mx-2 sm:mx-0 px-2 sm:px-0">
              <button
                onClick={() => setCurrentView("day")}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex-shrink-0 ${
                  currentView === "day"
                    ? "bg-blue-500/20 text-blue-400 border-2 border-blue-500/40"
                    : "bg-background-secondary text-foreground-muted hover:bg-background-secondary/80 border-2 border-transparent"
                }`}
              >
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <CalendarDays className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="whitespace-nowrap">Día</span>
                </div>
              </button>
              
              <button
                onClick={() => setCurrentView("week")}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex-shrink-0 ${
                  currentView === "week"
                    ? "bg-blue-500/20 text-blue-400 border-2 border-blue-500/40"
                    : "bg-background-secondary text-foreground-muted hover:bg-background-secondary/80 border-2 border-transparent"
                }`}
              >
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <Columns className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="whitespace-nowrap">Semana</span>
                </div>
              </button>
              
              <button
                onClick={() => setCurrentView("month")}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex-shrink-0 ${
                  currentView === "month"
                    ? "bg-blue-500/20 text-blue-400 border-2 border-blue-500/40"
                    : "bg-background-secondary text-foreground-muted hover:bg-background-secondary/80 border-2 border-transparent"
                }`}
              >
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <LayoutGrid className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="whitespace-nowrap">Mes</span>
                </div>
              </button>
            </div>
            
            {/* Vista según selección */}
            {currentView === "day" && (
              <DayView
                key={`day-${lastUpdateTime}-${filtered.length}-${selectedDate.toISOString()}`}
                events={filtered}
                instructors={instructors}
                instructorColors={instructorColors}
                timeRange={calendarTimeRange}
                selectedDate={selectedDate}
                onDateChange={(date) => {
                  setSelectedDate(date);
                }}
                onEventClick={(event) => {
                  setSelectedEvent(event);
                  setModalOpen(true);
                }}
                onEventDrop={(eventId, updates, eventType = 'appointment') => {
                  // Mostrar diálogo ANTES de actualizar - solo actualizar cuando el usuario confirme
                  logger.info("[CalendarView] Mostrando diálogo de confirmación:", { eventId, eventType, updates });
                  setNotificationDialog({
                    eventId,
                    updates: updates, // Guardar los updates para aplicar después de confirmar
                    eventType: eventType || 'appointment',
                    pending: true // Marcar como pendiente de confirmación
                  });
                }}
              />
            )}
            
            {currentView === "week" && (
              <WeekView
                key={`week-${lastUpdateTime}-${filtered.length}-${selectedDate.toISOString()}`}
                events={filtered}
                instructors={instructors}
                instructorColors={instructorColors}
                timeRange={calendarTimeRange}
                selectedDate={selectedDate}
                instructorFilter={instructorFilter}
                onDateChange={(date) => {
                  setSelectedDate(date);
                }}
                onEventClick={(event) => {
                  setSelectedEvent(event);
                  setModalOpen(true);
                }}
                onEventDrop={(eventId, updates, eventType = 'appointment') => {
                  // Mostrar diálogo ANTES de actualizar - solo actualizar cuando el usuario confirme
                  logger.info("[CalendarView] Mostrando diálogo de confirmación:", { eventId, eventType, updates });
                  setNotificationDialog({
                    eventId,
                    updates: updates, // Guardar los updates para aplicar después de confirmar
                    eventType: eventType || 'appointment',
                    pending: true // Marcar como pendiente de confirmación
                  });
                }}
              />
            )}
            
            {currentView === "month" && (
              <MonthView
                events={filtered}
                instructors={instructors}
                instructorColors={instructorColors}
                selectedDate={selectedDate}
                instructorFilter={instructorFilter}
                onDateChange={(date) => {
                  setSelectedDate(date);
                }}
                onEventClick={(event) => {
                  setSelectedEvent(event);
                  setModalOpen(true);
                }}
              />
            )}
          </div>

          <AppointmentModal
            open={modalOpen}
            event={selectedEvent}
            onClose={() => {
              setModalOpen(false);
              setSelectedEvent(null);
            }}
          />

          {/* Diálogo de notificación */}
          {notificationDialog && (
            <NotificationDialog
              key={`notification-${notificationDialog.eventId}-${Date.now()}`}
              open={true}
              eventType={notificationDialog.eventType}
              event={events.find(e => String(e.id) === String(notificationDialog.eventId))}
              updates={notificationDialog.updates}
              instructors={instructors}
              onClose={() => {
                logger.info("[CalendarView] Cerrando diálogo de notificación");
                setNotificationDialog(null);
              }}
              onConfirm={async (notifyWhatsApp, notifyEmail, templateId, message) => {
                try {
                  const { eventId, updates, eventType } = notificationDialog;
                  const isClassSession = eventType === 'class_session';
                  
                  // Primero actualizar el turno/clase
                  let result;
                  
                  if (isClassSession) {
                    // Extraer el ID real de la clase
                    const classId = String(eventId).startsWith('class-') 
                      ? String(eventId).replace('class-', '') 
                      : eventId;
                    
                    // Preparar body para clase
                    const formatToMySQL = (dateValue) => {
                      if (!dateValue) return null;
                      if (dateValue instanceof Date) {
                        const pad = (n) => String(n).padStart(2, '0');
                        return `${dateValue.getFullYear()}-${pad(dateValue.getMonth() + 1)}-${pad(dateValue.getDate())} ${pad(dateValue.getHours())}:${pad(dateValue.getMinutes())}:${pad(dateValue.getSeconds())}`;
                      }
                      if (typeof dateValue === 'string') {
                        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateValue)) {
                          return dateValue;
                        }
                        if (dateValue.includes('T')) {
                          return dateValue.replace('T', ' ').slice(0, 19);
                        }
                        return dateValue;
                      }
                      return null;
                    };
                    
                    const classBody = {};
                    if (updates.starts_at || updates.startsAt) {
                      classBody.startsAt = formatToMySQL(updates.starts_at || updates.startsAt);
                    }
                    if (updates.ends_at || updates.endsAt) {
                      classBody.endsAt = formatToMySQL(updates.ends_at || updates.endsAt);
                    }
                    if (updates.instructor_id !== undefined) {
                      classBody.instructorId = updates.instructor_id;
                    }
                    
                    // Agregar notificaciones si se solicitaron
                    if (notifyWhatsApp || notifyEmail) {
                      classBody.notifyWhatsApp = notifyWhatsApp || false;
                      classBody.notifyEmail = notifyEmail || false;
                      classBody.messageTemplate = templateId || null;
                      classBody.customMessage = message || null;
                    }
                    
                    logger.info("[CalendarView] Actualizando clase:", { classId, classBody });
                    result = await apiClient.updateClassSession(classId, classBody);
                    
                    // Actualización optimista para clases
                    setEvents(prevEvents => {
                      return prevEvents.map(event => {
                        const eventIdStr = String(event.id);
                        if (eventIdStr === String(eventId) || eventIdStr === `class-${classId}`) {
                          const updated = { ...event };
                          if (classBody.startsAt) {
                            updated.start = typeof classBody.startsAt === 'string' 
                              ? classBody.startsAt.replace(' ', 'T') 
                              : classBody.startsAt.toISOString();
                          }
                          if (classBody.endsAt) {
                            updated.end = typeof classBody.endsAt === 'string' 
                              ? classBody.endsAt.replace(' ', 'T') 
                              : classBody.endsAt.toISOString();
                          }
                          if (classBody.instructorId !== undefined && updated.extendedProps) {
                            updated.extendedProps.instructor_id = classBody.instructorId;
                            updated.extendedProps.instructorId = classBody.instructorId;
                          }
                          return updated;
                        }
                        return event;
                      });
                    });
                  } else {
                    // Preparar updates para appointment
                    const appointmentUpdates = { ...updates };
                    
                    // Agregar notificaciones si se solicitaron
                    if (notifyWhatsApp || notifyEmail) {
                      appointmentUpdates.notifyWhatsApp = notifyWhatsApp || false;
                      appointmentUpdates.notifyEmail = notifyEmail || false;
                      appointmentUpdates.messageTemplate = templateId || null;
                      appointmentUpdates.customMessage = message || null;
                    }
                    
                    // Actualizar appointment
                    result = await updateAppointment(eventId, appointmentUpdates, true);
                  }
                  
                  if (!result || !result.ok) {
                    logger.error("[CalendarView] La actualización no fue exitosa:", result);
                    toast.error(result?.error || `Error al actualizar ${isClassSession ? 'la clase' : 'el turno'}`);
                    setNotificationDialog(null);
                    return;
                  }
                  
                  // Verificar estado de notificaciones
                  const notificationStatus = result?.notificationStatus;
                  if (notificationStatus) {
                    const whatsAppStatus = notificationStatus.whatsApp;
                    const emailStatus = notificationStatus.email;
                    
                    // Verificar si hubo errores en las notificaciones
                    if (whatsAppStatus?.requested && !whatsAppStatus?.sent && whatsAppStatus?.error) {
                      toast.error(`⚠️ ${isClassSession ? 'Clase' : 'Turno'} actualizado, pero la notificación WhatsApp no se pudo enviar: ${whatsAppStatus.error}`);
                    } else if (emailStatus?.requested && !emailStatus?.sent && emailStatus?.error) {
                      toast.warning(`⚠️ ${isClassSession ? 'Clase' : 'Turno'} actualizado, pero la notificación Email no se pudo enviar: ${emailStatus.error}`);
                    } else if (whatsAppStatus?.requested && whatsAppStatus?.sent) {
                      toast.success(`${isClassSession ? 'Clase' : 'Turno'} actualizado y notificación WhatsApp enviada`);
                    } else if (emailStatus?.requested && emailStatus?.sent) {
                      toast.success(`${isClassSession ? 'Clase' : 'Turno'} actualizado y notificación Email enviada`);
                    } else if (whatsAppStatus?.requested || emailStatus?.requested) {
                      // Para clases, puede haber múltiples alumnos
                      if (isClassSession) {
                        const waSent = whatsAppStatus?.sent || 0;
                        const waFailed = whatsAppStatus?.failed || 0;
                        const emailSent = emailStatus?.sent || 0;
                        const emailFailed = emailStatus?.failed || 0;
                        
                        let message = `${isClassSession ? 'Clase' : 'Turno'} actualizado. `;
                        if (waSent > 0 || emailSent > 0) {
                          message += `Notificaciones enviadas: `;
                          if (waSent > 0) message += `${waSent} WhatsApp`;
                          if (waSent > 0 && emailSent > 0) message += `, `;
                          if (emailSent > 0) message += `${emailSent} Email`;
                        }
                        if (waFailed > 0 || emailFailed > 0) {
                          message += `. Fallos: `;
                          if (waFailed > 0) message += `${waFailed} WhatsApp`;
                          if (waFailed > 0 && emailFailed > 0) message += `, `;
                          if (emailFailed > 0) message += `${emailFailed} Email`;
                        }
                        
                        if (waFailed > 0 || emailFailed > 0) {
                          toast.warning(message);
                        } else {
                          toast.success(message);
                        }
                      } else {
                        toast.warning(`${isClassSession ? 'Clase' : 'Turno'} actualizado, pero las notificaciones no se pudieron enviar`);
                      }
                    } else {
                      toast.success(isClassSession ? "Clase actualizada" : "Turno actualizado");
                    }
                  } else {
                    // Sin notificaciones solicitadas
                    toast.success(isClassSession ? "Clase actualizada" : "Turno actualizado");
                  }
                  
                  // Si el evento cambió de día, actualizar la fecha seleccionada
                  if (updates.starts_at) {
                    const dateStr = typeof updates.starts_at === 'string' ? updates.starts_at.replace(' ', 'T') : updates.starts_at.toISOString();
                    const newDate = new Date(dateStr);
                    if (!isNaN(newDate.getTime())) {
                      const newDateOnly = new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate());
                      const currentDateOnly = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
                      
                      if (newDateOnly.getTime() !== currentDateOnly.getTime()) {
                        setSelectedDate(newDateOnly);
                      }
                    }
                  }
                  
                  // Actualizar el hash para forzar re-render
                  setLastUpdateTime(Date.now());
                  
                  // Recargar eventos en background
                  setTimeout(() => {
                    loadEvents(true).catch(err => {
                      console.error("Error al sincronizar eventos:", err);
                    });
                  }, 500);
                  
                  setNotificationDialog(null);
                } catch (error) {
                  logger.error("[CalendarView] Error al actualizar:", error);
                  toast.error(error?.response?.data?.error || error?.message || "Error al actualizar");
                  setNotificationDialog(null);
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Componente de diálogo de notificación
function NotificationDialog({ open, eventType, onClose, onConfirm, event, updates, instructors = [] }) {
  // Debug inicial
  console.log("[NotificationDialog] Componente renderizado:", { open, eventType });
  const [notifyWhatsApp, setNotifyWhatsApp] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const isClassSession = eventType === 'class_session';

  // Plantillas predeterminadas - diferentes para turnos y clases
  const templates = isClassSession ? [
    {
      id: 'reprogramar_profesional_no_disponible',
      name: 'Instructor no disponible',
      message: 'Hola! Te contactamos para informarte que la clase necesita ser reprogramada porque el instructor no está disponible en ese horario. ¿Podrías indicarnos un horario alternativo?'
    },
    {
      id: 'cambiar_profesional',
      name: 'Cambiar a otro instructor',
      message: 'Hola! Te contactamos para informarte que la clase ha sido reasignada a otro instructor. El horario se mantiene igual. ¿Te parece bien?'
    },
    {
      id: 'reprogramar_horario',
      name: 'Reprogramar horario de clase',
      message: 'Hola! Te contactamos para informarte que el horario de la clase ha sido reprogramado. ¿Podrías confirmar si el nuevo horario te funciona?'
    },
    {
      id: 'cancelar_clase',
      name: 'Cancelar clase',
      message: 'Hola! Te contactamos para informarte que la clase ha sido cancelada. Si necesitas reagendar, por favor contáctanos.'
    },
    {
      id: 'personalizado',
      name: 'Mensaje personalizado',
      message: ''
    }
  ] : [
    {
      id: 'reprogramar_profesional_no_disponible',
      name: 'Profesional no disponible',
      message: 'Hola! Te contactamos para informarte que tu turno necesita ser reprogramado porque el profesional no está disponible en ese horario. ¿Podrías indicarnos un horario alternativo?'
    },
    {
      id: 'cambiar_profesional',
      name: 'Cambiar a otro profesional',
      message: 'Hola! Te contactamos para informarte que tu turno ha sido reasignado a otro profesional. El horario se mantiene igual. ¿Te parece bien?'
    },
    {
      id: 'reprogramar_horario',
      name: 'Reprogramar horario',
      message: 'Hola! Te contactamos para informarte que tu turno ha sido reprogramado. ¿Podrías confirmar si el nuevo horario te funciona?'
    },
    {
      id: 'cancelar_turno',
      name: 'Cancelar turno',
      message: 'Hola! Te contactamos para informarte que tu turno ha sido cancelado. Si necesitas reagendar, por favor contáctanos.'
    },
    {
      id: 'personalizado',
      name: 'Mensaje personalizado',
      message: ''
    }
  ];

  // Función para formatear fecha y hora
  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const fecha = date.toLocaleDateString('es-AR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    });
    const hora = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    return `${fecha} ${hora}`;
  };

  // Función para construir el mensaje con los cambios detectados
  const buildMessageWithChanges = (baseMessage, changes) => {
    if (!baseMessage) return '';
    
    const changesText = [];
    if (changes.horarioCambio) {
      changesText.push(`📅 *Horario:* ${changes.oldHorario} → ${changes.newHorario}`);
    }
    if (changes.profesionalCambio && changes.oldProfesional && changes.newProfesional && changes.oldProfesional !== changes.newProfesional) {
      changesText.push(`👤 *Profesional:* ${changes.oldProfesional} → ${changes.newProfesional}`);
    }
    if (changes.servicioCambio && changes.oldServicio && changes.newServicio && changes.oldServicio !== changes.newServicio) {
      changesText.push(`💇 *Servicio:* ${changes.oldServicio} → ${changes.newServicio}`);
    }
    
    if (changesText.length > 0) {
      return `${baseMessage}\n\n${changesText.join('\n')}`;
    }
    
    return baseMessage;
  };

  // Detectar tipo de cambio para sugerir plantilla y agregar cambios al mensaje
  useEffect(() => {
    if (!updates || !event) return;
    
    const oldInstructorId = event.extendedProps?.instructor_id || event.extendedProps?.instructorId;
    const newInstructorId = updates.instructor_id;
    const instructorChanged = newInstructorId !== undefined && 
      String(newInstructorId) !== String(oldInstructorId || '');
    
    const oldStart = event.start;
    const newStart = updates.starts_at;
    const timeChanged = newStart && oldStart && newStart !== oldStart;
    
    const oldServiceId = event.extendedProps?.service_id || event.extendedProps?.serviceId;
    const newServiceId = updates.service_id;
    const servicioCambio = newServiceId !== undefined && 
      String(newServiceId) !== String(oldServiceId || '');
    
    // Obtener nombres de profesionales y servicios
    const oldInstructorName = event.extendedProps?.instructor_name || event.extendedProps?.instructorName || 'Nuestro equipo';
    // Si cambió el instructor, buscar el nombre del nuevo instructor en la lista
    let newInstructorName = oldInstructorName;
    if (instructorChanged && newInstructorId) {
      const newInstructor = (instructors || []).find(inst => String(inst.id) === String(newInstructorId));
      newInstructorName = newInstructor?.name || 'Nuestro equipo';
    } else if (updates.instructor_name) {
      newInstructorName = updates.instructor_name;
    }
    
    const oldServiceName = event.extendedProps?.service_name || event.extendedProps?.serviceName || 'Servicio';
    const newServiceName = updates.service_name || oldServiceName;
    
    // Construir información de cambios - solo incluir cambios reales (verificar que los nombres sean diferentes)
    const changes = {
      horarioCambio: timeChanged,
      oldHorario: oldStart ? formatDateTime(oldStart) : '',
      newHorario: newStart ? formatDateTime(newStart) : '',
      // Solo mostrar cambio de profesional si realmente cambió Y los nombres son diferentes
      profesionalCambio: instructorChanged && oldInstructorName !== newInstructorName,
      oldProfesional: oldInstructorName,
      newProfesional: newInstructorName,
      // Solo mostrar cambio de servicio si realmente cambió Y los nombres son diferentes
      servicioCambio: servicioCambio && oldServiceName !== newServiceName,
      oldServicio: oldServiceName,
      newServicio: newServiceName,
    };
    
    let templateId = '';
    let baseMessage = '';
    
    // Solo seleccionar plantilla si realmente cambió algo
    const realmenteCambioProfesional = instructorChanged && oldInstructorName !== newInstructorName;
    const realmenteCambioHorario = timeChanged;
    
    if (realmenteCambioProfesional && realmenteCambioHorario) {
      const template = templates.find(t => t.id === 'reprogramar_profesional_no_disponible');
      if (template) {
        templateId = 'reprogramar_profesional_no_disponible';
        baseMessage = template.message;
      }
    } else if (realmenteCambioProfesional) {
      const template = templates.find(t => t.id === 'cambiar_profesional');
      if (template) {
        templateId = 'cambiar_profesional';
        baseMessage = template.message;
      }
    } else if (realmenteCambioHorario) {
      const template = templates.find(t => t.id === 'reprogramar_horario');
      if (template) {
        templateId = 'reprogramar_horario';
        baseMessage = template.message;
      }
    }
    
    if (templateId && baseMessage) {
      setSelectedTemplate(templateId);
      const messageWithChanges = buildMessageWithChanges(baseMessage, changes);
      setCustomMessage(messageWithChanges);
    }
  }, [updates, event, instructors]);

  // Actualizar mensaje cuando se selecciona una plantilla, manteniendo los cambios detectados
  useEffect(() => {
    if (!updates || !event) return;
    if (!selectedTemplate || selectedTemplate === 'personalizado') {
      if (selectedTemplate === 'personalizado') {
        setCustomMessage('');
      }
      return;
    }
    
    const template = templates.find(t => t.id === selectedTemplate);
    if (!template) return;
    
    // Detectar cambios nuevamente para incluirlos en el mensaje
    const oldInstructorId = event.extendedProps?.instructor_id || event.extendedProps?.instructorId;
    const newInstructorId = updates.instructor_id;
    const instructorChanged = newInstructorId !== undefined && 
      String(newInstructorId) !== String(oldInstructorId || '');
    
    const oldStart = event.start;
    const newStart = updates.starts_at;
    const timeChanged = newStart && oldStart && newStart !== oldStart;
    
    const oldServiceId = event.extendedProps?.service_id || event.extendedProps?.serviceId;
    const newServiceId = updates.service_id;
    const servicioCambio = newServiceId !== undefined && 
      String(newServiceId) !== String(oldServiceId || '');
    
    // Obtener nombres
    const oldInstructorName = event.extendedProps?.instructor_name || event.extendedProps?.instructorName || 'Nuestro equipo';
    // Si cambió el instructor, buscar el nombre del nuevo instructor en la lista
    let newInstructorName = oldInstructorName;
    if (instructorChanged && newInstructorId) {
      const newInstructor = (instructors || []).find(inst => String(inst.id) === String(newInstructorId));
      newInstructorName = newInstructor?.name || 'Nuestro equipo';
    } else if (updates.instructor_name) {
      newInstructorName = updates.instructor_name;
    }
    
    const oldServiceName = event.extendedProps?.service_name || event.extendedProps?.serviceName || 'Servicio';
    const newServiceName = updates.service_name || oldServiceName;
    
    // Construir información de cambios - solo incluir cambios reales (verificar que los nombres sean diferentes)
    const changes = {
      horarioCambio: timeChanged,
      oldHorario: oldStart ? formatDateTime(oldStart) : '',
      newHorario: newStart ? formatDateTime(newStart) : '',
      // Solo mostrar cambio de profesional si realmente cambió Y los nombres son diferentes
      profesionalCambio: instructorChanged && oldInstructorName !== newInstructorName,
      oldProfesional: oldInstructorName,
      newProfesional: newInstructorName,
      // Solo mostrar cambio de servicio si realmente cambió Y los nombres son diferentes
      servicioCambio: servicioCambio && oldServiceName !== newServiceName,
      oldServicio: oldServiceName,
      newServicio: newServiceName,
    };
    
    // Agregar cambios al mensaje de la plantilla
    const messageWithChanges = buildMessageWithChanges(template.message, changes);
    setCustomMessage(messageWithChanges);
  }, [selectedTemplate, updates, event]);

  // Debug: verificar si el diálogo debería mostrarse
  useEffect(() => {
    logger.info("[NotificationDialog] Estado:", { open, eventType, hasEvent: !!event, hasUpdates: !!updates });
  }, [open, eventType, event, updates]);

  if (!open) {
    return null;
  }

  const dialogContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6" style={{ zIndex: 9999 }}>
      {/* Overlay oscuro de fondo */}
      <div 
        className="absolute inset-0 bg-black/50" 
        onClick={onClose}
        style={{ zIndex: 9998 }}
      />
      {/* Modal centrado */}
      <div className="relative pointer-events-auto w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ zIndex: 10000 }}>
        <div className="bg-background-secondary rounded-xl border border-border p-4 sm:p-6 w-full shadow-2xl">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {isClassSession ? 'Confirmar cambio de clase' : 'Confirmar cambio de turno'}
              </h3>
              <p className="text-sm text-foreground-muted">
                {isClassSession 
                  ? 'Se actualizará el horario de la clase. ¿Deseas notificar a los alumnos inscritos?'
                  : 'Se actualizará el horario del turno. ¿Deseas notificar al cliente?'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="ml-2 p-1 rounded-lg hover:bg-background transition-colors text-foreground-muted hover:text-foreground"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Selector de plantillas */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-foreground mb-2">
              Plantilla de mensaje
            </label>
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="w-full px-4 py-2.5 text-sm rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Seleccionar plantilla...</option>
              {templates.map(template => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>

          {/* Campo de mensaje personalizado */}
          {selectedTemplate && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-2">
                Mensaje {isClassSession ? 'para los alumnos' : 'para el cliente'}
              </label>
              <textarea
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder={isClassSession 
                  ? "Escribe el mensaje que se enviará a los alumnos inscritos..." 
                  : "Escribe el mensaje que se enviará al cliente..."}
                rows={5}
                className="w-full px-4 py-3 text-sm rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>
          )}

          {/* Opciones de notificación */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-foreground mb-3">
              {isClassSession ? 'Notificar a los alumnos por:' : 'Notificar al cliente por:'}
            </label>
            {isClassSession ? (
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-background transition-colors border border-transparent hover:border-border">
                  <input
                    type="checkbox"
                    checked={notifyWhatsApp}
                    onChange={(e) => setNotifyWhatsApp(e.target.checked)}
                    className="w-5 h-5 text-primary rounded focus:ring-primary"
                  />
                  <MessageSquare className="w-5 h-5 text-primary" />
                  <span className="text-sm font-medium text-foreground">WhatsApp</span>
                </label>
                
                <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-background transition-colors border border-transparent hover:border-border">
                  <input
                    type="checkbox"
                    checked={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.checked)}
                    className="w-5 h-5 text-primary rounded focus:ring-primary"
                  />
                  <Mail className="w-5 h-5 text-primary" />
                  <span className="text-sm font-medium text-foreground">Email</span>
                </label>
              </div>
            ) : (
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-background transition-colors border border-transparent hover:border-border">
                <input
                  type="checkbox"
                  checked={notifyWhatsApp}
                  onChange={(e) => setNotifyWhatsApp(e.target.checked)}
                  className="w-5 h-5 text-primary rounded focus:ring-primary"
                />
                <MessageSquare className="w-5 h-5 text-primary" />
                <span className="text-sm font-medium text-foreground">Notificar vía WhatsApp</span>
              </label>
            )}
          </div>

          <div className="flex gap-3 justify-end pt-2 border-t border-border">
            <button
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-background rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => onConfirm(notifyWhatsApp, notifyEmail, selectedTemplate, customMessage)}
              disabled={(notifyWhatsApp || notifyEmail) && (!selectedTemplate || !customMessage.trim())}
              className="px-5 py-2.5 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {notifyWhatsApp || notifyEmail ? 'Confirmar y Enviar' : 'Confirmar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Usar portal para renderizar fuera del árbol DOM
  return typeof document !== 'undefined' 
    ? createPortal(dialogContent, document.body)
    : null;
}
