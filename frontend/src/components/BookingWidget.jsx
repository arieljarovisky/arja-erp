// src/components/BookingWidget.jsx - Versión mejorada modo oscuro
import { useMemo, useEffect, useRef, useState } from "react";
import { useApp } from "../context/UseApp";
import ServiceSelect from "./ServiceSelect";
import InstructorSelect from "./InstructorSelect";
import DatePicker from "./DatePicker";
import SlotGrid from "./SlotGrid";
import Button from "./ui/Button";
import { Field } from "./ui/Field";
import { toast } from "sonner";
import { logger } from "../utils/logger.js";
// Unificado: sin react-hook-form para nombre/teléfono
import { Calendar, Clock, User, Phone, CheckCircle2, Scissors, Users, Repeat, Building2, CreditCard, Send, MessageSquare, X } from "lucide-react";
import ClassEnrollForm from "./ClassEnrollForm";
import { apiClient } from "../api";

function Section({ title, children, right, icon: Icon }) {
  return (
    <section className="bg-background rounded-2xl shadow-xl border border-border p-8 md:p-10 mb-8">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-8">

        {/* Título + Ícono */}
        <div className="flex items-center gap-3 min-w-0">
          {Icon && <Icon className="w-6 h-6 text-primary shrink-0" />}
          <h2 className="text-xl md:text-2xl font-bold tracking-tight text-foreground truncate">
            {title}
          </h2>
        </div>

        {/* Acciones a la derecha */}
        {right && (
          <div className="flex items-center gap-3 shrink-0">
            {right}
          </div>
        )}
      </div>

      {/* Contenido */}
      <div className="w-full">
        {children}
      </div>

    </section>
  );
}

export default function BookingWidget() {
  const {
    services = [],
    instructors = [],
    branches = [],
    branchesLoading = false,
    metaLoading,
    metaError,
    booking,
    updateBooking,
    availability,
    loadAvailability,
    bookingSave,
    createAppointment,
    classesEnabled,
  } = useApp();
  const { appointmentsEnabled } = useApp();

  const [paymentLink, setPaymentLink] = useState(null);
  const [creatingPaymentLink, setCreatingPaymentLink] = useState(false);
  const [sendingPaymentLink, setSendingPaymentLink] = useState(false);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [pendingBookingData, setPendingBookingData] = useState(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  
  // Determinar el tab inicial basado en qué está habilitado
  const initialTab = appointmentsEnabled ? "appointments" : classesEnabled ? "classes" : "appointments";
  const [activeTab, setActiveTab] = useState(initialTab);
  
  // Actualizar el tab si cambian las opciones disponibles
  useEffect(() => {
    if (activeTab === "appointments" && !appointmentsEnabled && classesEnabled) {
      setActiveTab("classes");
    } else if (activeTab === "classes" && !classesEnabled && appointmentsEnabled) {
      setActiveTab("appointments");
    }
  }, [appointmentsEnabled, classesEnabled, activeTab]);

  const selectedService = useMemo(
    () => (Array.isArray(services) ? services : []).find((s) => String(s.id) === String(booking.serviceId)),
    [services, booking.serviceId]
  );

  const selectedInstructor = useMemo(
    () => (Array.isArray(instructors) ? instructors : []).find((s) => String(s.id) === String(booking.instructorId)),
    [instructors, booking.instructorId]
  );

  const lastSuccessRef = useRef(false);
  const lastErrorRef = useRef("");

  const reset = (vals = {}) => {
    // Mantener API similar al reset de react-hook-form usado en UI
    updateBooking({
      customerName: vals.customerName ?? booking.customerName ?? "",
      customerPhone: vals.customerPhone ?? booking.customerPhone ?? "",
    });
  };

  useEffect(() => {
    if (bookingSave.ok && !lastSuccessRef.current) {
      lastSuccessRef.current = true;
      const wasRecurring = booking.repeatEnabled;
      toast.success(wasRecurring ? "¡Serie de turnos reservada! 🎉" : "¡Turno confirmado! 🎉", {
        description: wasRecurring
          ? "Registramos tus turnos semanales y te enviamos el detalle por WhatsApp."
          : "Te va a llegar la confirmación por WhatsApp.",
      });
      reset({ customerName: "", customerPhone: "" });
      updateBooking({
        selectedSlot: "",
        customerId: "",
        customerName: "",
        customerPhone: "",
        repeatEnabled: false,
        repeatCount: 4,
        repeatUntil: "",
      });
    }
    if (!bookingSave.ok && lastSuccessRef.current) {
      lastSuccessRef.current = false;
    }
  }, [bookingSave.ok, booking.repeatEnabled, reset, updateBooking]);

  useEffect(() => {
    if (bookingSave.error && bookingSave.error !== lastErrorRef.current) {
      lastErrorRef.current = bookingSave.error;
      toast.error(bookingSave.error);
    }
    if (!bookingSave.error) {
      lastErrorRef.current = "";
    }
  }, [bookingSave.error]);

  useEffect(() => {
    const q = (customerQuery || "").trim();
    if (!q) {
      setCustomerResults([]);
      setCustomerSearching(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setCustomerSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.listCustomers(q, controller.signal, { limit: 20 });
        const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        if (!cancelled) setCustomerResults(list);
      } catch (e) {
        if (!cancelled) setCustomerResults([]);
      } finally {
        if (!cancelled) setCustomerSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [customerQuery]);

  const onSubmit = async () => {
    const phone = (booking.customerPhone || "").trim();
    const validPhone = /^\+\d{10,15}$/.test(phone);
    if (!booking.customerId && !validPhone) {
      toast.error("Ingresá el teléfono en formato +54911...");
      return;
    }

    // Guardar los datos y mostrar el modal
    setPendingBookingData({
      customerName: booking.customerName || "",
      customerPhone: phone || "",
      customerId: booking.customerId || undefined,
      repeatEnabled: booking.repeatEnabled,
      repeatCount: booking.repeatCount,
      repeatUntil: booking.repeatUntil || undefined,
    });
    setShowWhatsAppModal(true);
  };

  const handleConfirmBooking = async (sendWhatsAppOption) => {
    if (!pendingBookingData) return;

    try {
      await createAppointment({
        ...pendingBookingData,
        sendWhatsApp: sendWhatsAppOption, // 'with_payment', 'reminder_only', o 'none'
      });
      // Limpiar link de pago al crear nuevo turno
      setPaymentLink(null);
      setShowWhatsAppModal(false);
      setPendingBookingData(null);
    } catch (error) {
      logger.error("❌ Error:", error);
      setShowWhatsAppModal(false);
      setPendingBookingData(null);
    }
  };

  const handleCreatePaymentLink = async () => {
    if (!selectedService) {
      toast.error("Seleccioná un servicio primero");
      return;
    }

    const servicePrice = selectedService.price_decimal || selectedService.price || selectedService.amount;
    if (!servicePrice || servicePrice <= 0) {
      toast.error("El servicio no tiene un precio configurado");
      return;
    }

    if (!booking.customerPhone) {
      toast.error("Necesitamos tu teléfono para enviar el link de pago");
      return;
    }

    setCreatingPaymentLink(true);
    try {
      const result = await apiClient.createPaymentLink({
        amount: Number(servicePrice),
        title: `Pago completo - ${selectedService.name}`,
        description: `Pago del servicio ${selectedService.name}${selectedInstructor ? ` con ${selectedInstructor.name}` : ""}`,
        customerId: booking.customerId || null,
        expiresInDays: 7,
      });

      setPaymentLink(result.link);
      toast.success("Link de pago creado correctamente");
    } catch (error) {
      console.error("Error creando link de pago:", error);
      toast.error(error?.response?.data?.error || "Error al crear el link de pago");
    } finally {
      setCreatingPaymentLink(false);
    }
  };

  const handleSendPaymentLink = async () => {
    if (!paymentLink || !booking.customerPhone) {
      toast.error("Falta información para enviar el link");
      return;
    }

    setSendingPaymentLink(true);
    try {
      // Enviar por WhatsApp usando el endpoint de envío
      // Como no tenemos customerId, necesitamos crear un endpoint alternativo o usar el teléfono directamente
      // Por ahora, mostraremos el link para que el usuario lo copie
      const message = `💳 *Link de pago*\n\nHola${booking.customerName ? ` ${booking.customerName}` : ""}, te enviamos el link para realizar el pago completo de tu turno:\n\n${paymentLink}\n\nUna vez completado el pago, recibirás la confirmación automáticamente.`;
      
      // Copiar al portapapeles y mostrar mensaje
      await navigator.clipboard.writeText(message);
      toast.success("Mensaje copiado. Podés pegarlo en WhatsApp y enviarlo al cliente");
    } catch (error) {
      console.error("Error enviando link:", error);
      toast.error("Error al preparar el mensaje");
    } finally {
      setSendingPaymentLink(false);
    }
  };

  // Calcular progreso
  const progress = useMemo(() => {
    let completed = 0;
    if (booking.serviceId) completed++;
    if (booking.date) completed++;
    if (booking.selectedSlot) completed++;
    return (completed / 3) * 100;
  }, [booking.serviceId, booking.date, booking.selectedSlot]);

  return (
    <div className="bg-background rounded-2xl shadow-2xl border-2 border-primary/30 p-6 md:p-8 mb-0 relative overflow-hidden">
      {/* Efecto de fondo destacado */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-purple-500/5 to-transparent pointer-events-none" />
      <div className="relative z-10">
        {/* Header y progreso solo para turnos */}
        {activeTab === "appointments" && appointmentsEnabled && (
          <header className="mb-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-4 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-2xl ring-2 ring-indigo-500/30 shadow-lg">
                <Scissors className="w-8 h-8 text-indigo-400" />
              </div>
              <div className="flex-1">
                <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
                  Reservá tu turno
                </h1>
                <p className="text-foreground-secondary text-base">
                  Seguí los pasos para confirmar tu turno en minutos
                </p>
              </div>
            </div>

            {/* Barra de progreso */}
            <div className="relative h-2 bg-border rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-accent transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

          {/* Indicadores de pasos */}
          <div className="mt-6 flex items-center gap-3 flex-wrap">
              <StepBadge completed={!!booking.serviceId} label="Servicio" number={1} />
              <StepBadge completed={!!booking.date} label="Fecha" number={2} />
              <StepBadge completed={!!booking.selectedSlot} label="Horario" number={3} />
              <StepBadge completed={false} label="Confirmación" number={4} />
            </div>
          </header>
        )}

        {/* Header para clases */}
        {activeTab === "classes" && classesEnabled && (
          <header className="mb-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-4 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-2xl ring-2 ring-indigo-500/30 shadow-lg">
                <Users className="w-8 h-8 text-indigo-400" />
              </div>
              <div className="flex-1">
                <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
                  Inscribite en una clase
                </h1>
                <p className="text-foreground-secondary text-base">
                  Elegí la clase y completá tus datos para inscribirte
                </p>
              </div>
            </div>
          </header>
        )}

        {/* Tabs para Turnos y Clases */}
        {(appointmentsEnabled || classesEnabled) && (
          <div className="flex border-b border-border mb-8">
            {appointmentsEnabled && (
              <button
                onClick={() => setActiveTab("appointments")}
                className={`px-6 py-3 text-sm font-semibold transition-all duration-200 border-b-2 ${
                  activeTab === "appointments"
                    ? "border-primary text-primary bg-primary/5"
                    : "border-transparent text-foreground-secondary hover:text-foreground hover:bg-background-secondary/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Scissors className="w-4 h-4" />
                  <span>Turnos</span>
                </div>
              </button>
            )}
            {classesEnabled && (
              <button
                onClick={() => setActiveTab("classes")}
                className={`px-6 py-3 text-sm font-semibold transition-all duration-200 border-b-2 ${
                  activeTab === "classes"
                    ? "border-primary text-primary bg-primary/5"
                    : "border-transparent text-foreground-secondary hover:text-foreground hover:bg-background-secondary/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  <span>Clases</span>
                </div>
              </button>
            )}
          </div>
        )}

        {/* Contenido de Turnos */}
        {activeTab === "appointments" && appointmentsEnabled && (<>
        {/* Errores */}
        <div aria-live="polite" className="mb-6">
          {(metaError || availability.error) && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 p-5 text-sm flex items-start gap-3">
              <div className="text-lg">⚠️</div>
              <div>{metaError || availability.error}</div>
            </div>
          )}
        </div>

        {/* 1) Servicio */}
        <Section
          title="Paso 1: Elegí tu servicio"
          icon={Scissors}
          right={metaLoading ? <span className="text-xs text-foreground-muted">cargando...</span> : null}
        >
          <div className="grid md:grid-cols-3 gap-6">

            {/* Servicio */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground">
                Servicio
              </label>
              {/* NO PONER ICONO ACÁ — el componente ya lo tiene */}
              <ServiceSelect
                services={services}
                value={booking.serviceId}
                onChange={(v) => updateBooking({ serviceId: v })}
              />
            </div>

            {/* Instructor */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground">
                Instructor/a
              </label>
              {/* NO PONER ICONO ACÁ — el componente ya lo tiene */}
              <InstructorSelect
                instructors={instructors}
                value={booking.instructorId}
                onChange={(v) => updateBooking({ instructorId: v })}
              />
            </div>

            {/* Sucursal */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground flex items-center gap-2">

                <Building2 className="w-4 h-4" />
                Sucursal
              </label>
              <select
                className="input h-12 pr-12 rounded-xl w-full disabled:opacity-60"
                value={booking.branchId || ""}
                onChange={(e) => updateBooking({ branchId: e.target.value })}
                disabled={branchesLoading || branches.length === 0}
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
              <p className="mt-3 text-xs text-foreground-muted leading-relaxed">
                El turno se registrará en la sucursal seleccionada. Podés cambiarla manualmente.
              </p>
            </div>

          </div>
        </Section>

        {/* 2) Fecha */}
        <Section title="Paso 2: Seleccioná la fecha" icon={Calendar}>
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <DatePicker
              value={booking.date}
              onChange={(v) => updateBooking({ date: v })}
            />
            <Button
              onClick={loadAvailability}
              disabled={!booking.serviceId || !booking.instructorId || !booking.date || availability.loading}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:opacity-50"
            >
              {availability.loading ? (
                <>
                  <div className="animate-spin mr-2 h-4 w-4 border-2 border-white/30 border-t-white rounded-full" />
                  Buscando...
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4 mr-2" />
                  Buscar horarios
                </>
              )}
            </Button>
          </div>
          <div className="mt-4 px-5 py-3 rounded-lg bg-background-secondary border border-border text-sm text-foreground-muted leading-relaxed">
            💡 La disponibilidad depende del servicio seleccionado y del estilista elegido
          </div>
        </Section>

        {/* 3) Horarios */}
        <Section
          title="Paso 3: Elegí tu horario"
          icon={Clock}
          right={availability.loading ? (
            <span className="text-xs text-primary flex items-center gap-2">
              <div className="animate-spin h-3 w-3 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full" />
              buscando...
            </span>
          ) : null}
        >
          <SlotGrid
            slots={availability.slots}
            busySlots={availability.busySlots}
            loading={availability.loading}
            selected={booking.selectedSlot}
            onSelect={(iso) => updateBooking({ selectedSlot: iso })}
          />
        </Section>

        {/* 4) Datos + Confirmación */}
        <Section title="Paso 4: Confirmá tus datos" icon={User}>
          <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="space-y-6">
            <Field label="Nombre del cliente">
              <div className="relative">
                <input
                  value={booking.customerName || ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    updateBooking({ customerName: v, customerId: "" });
                    setCustomerQuery(v);
                  }}
                  placeholder="Juan Pérez"
                  className="input px-4 py-3 w-full"
                />
                {customerQuery && !booking.customerId && (
                  <div className="absolute z-10 mt-2 w-full rounded-xl border border-border bg-background shadow-lg">
                    <div className="max-h-56 overflow-auto">
                      {customerSearching ? (
                        <div className="px-4 py-3 text-sm text-foreground-muted">Buscando...</div>
                      ) : (customerResults || []).length === 0 ? (
                        <div className="px-4 py-3 text-sm text-foreground-muted">
                          Ingresá el teléfono para crear el cliente
                        </div>
                      ) : (
                        (customerResults || []).slice(0, 10).map((c) => (
                          <button
                            type="button"
                            key={c.id}
                            onClick={() => {
                              updateBooking({
                                customerId: String(c.id),
                                customerName: c.name || "",
                                customerPhone: c.phone_e164 || c.phoneE164 || "",
                              });
                              setCustomerQuery("");
                            }}
                            className="w-full text-left px-4 py-2 hover:bg-background-secondary flex items-center justify-between"
                          >
                            <span className="text-sm text-foreground">
                              {c.name || "Sin nombre"}
                            </span>
                            <span className="text-xs text-foreground-muted">
                              {c.phone_e164 || c.phoneE164 || ""}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
              {booking.customerId && (
                <div className="mt-2 flex items-center justify-between rounded-xl border border-border bg-background-secondary px-4 py-2">
                  <div className="text-xs text-foreground">
                    Cliente seleccionado
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      updateBooking({ customerId: "", customerName: "", customerPhone: "" });
                      setCustomerQuery("");
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-background-secondary"
                  >
                    Quitar
                  </button>
                </div>
              )}
            </Field>

            <Field
              label="Teléfono (WhatsApp)"
              hint={booking.customerId ? "Se completó automáticamente desde el cliente seleccionado. Podés editarlo." : "Formato: +54911..."}
            >
              <div className="relative">
                <input
                  value={booking.customerPhone || ""}
                  onChange={(e) => updateBooking({ customerPhone: e.target.value })}
                  inputMode="tel"
                  placeholder="+54911..."
                  className="input pl-11 pr-4 py-3 w-full"
                />
              </div>
            </Field>

            <div className="rounded-xl border border-border bg-background-secondary px-6 py-5">
              <label className="flex items-center justify-between text-sm font-medium text-foreground">
                <span className="flex items-center gap-2">
                  <Repeat className="w-4 h-4 text-indigo-400" />
                  Repetir este turno todas las semanas
                </span>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border bg-background-secondary text-primary focus:ring-primary"
                  checked={!!booking.repeatEnabled}
                  onChange={(e) =>
                    updateBooking({
                      repeatEnabled: e.target.checked,
                      repeatCount: e.target.checked ? booking.repeatCount || 4 : booking.repeatCount,
                    })
                  }
                />
              </label>

              {booking.repeatEnabled && (
                <div className="mt-6 space-y-4 text-sm text-foreground">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-foreground-muted mb-1">
                        Cantidad de turnos
                      </label>
                      <input
                        type="number"
                        min={2}
                        max={26}
                        value={booking.repeatCount ?? 4}
                        onChange={(e) =>
                          updateBooking({
                            repeatCount: e.target.value ? Number(e.target.value) : "",
                          })
                        }
                        className="w-full rounded-lg border border-border bg-background-secondary px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                      />
                      <p className="mt-1 text-xs text-foreground-muted">
                        Máximo 26 turnos. Si usás fecha límite, se ignora este número.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-foreground-muted mb-1">
                        Fecha límite (opcional)
                      </label>
                      <input
                        type="date"
                        value={booking.repeatUntil || ""}
                        onChange={(e) =>
                          updateBooking({
                            repeatUntil: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-border bg-background-secondary px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                      />
                      <p className="mt-1 text-xs text-foreground-muted">
                        Reservaremos todos los turnos hasta este día inclusive.
                      </p>
                    </div>
                  </div>
                  <div className="rounded-lg bg-background-secondary border border-border px-3 py-2 text-xs text-foreground leading-relaxed">
                    Crearemos turnos semanales con el mismo servicio, profesional y horario. Vas a recibir
                    un resumen por WhatsApp.
                  </div>
                </div>
              )}
            </div>

            <Button
              type="submit"
              disabled={bookingSave.saving || !booking.selectedSlot || !booking.serviceId || !booking.instructorId}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-slate-700 disabled:to-slate-700 disabled:opacity-50 text-white font-semibold py-5 text-base md:text-lg shadow-lg mt-6"
            >
              {bookingSave.saving ? (
                <>
                  <div className="animate-spin mr-2 h-5 w-5 border-2 border-white/30 border-t-white rounded-full" />
                  Reservando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 mr-2" />
                  Confirmar turno
                </>
              )}
            </Button>
          </form>

          {/* Botón de pago completo - solo mostrar si el turno fue confirmado exitosamente */}
          {bookingSave.ok && selectedService && (selectedService.price_decimal || selectedService.price || selectedService.amount) && (
            <div className="mt-8 space-y-4">
              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Pago completo del servicio</h3>
                    <p className="text-xs text-foreground-muted mt-1">
                      Precio: ${(selectedService.price_decimal || selectedService.price || selectedService.amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>

                {!paymentLink ? (
                  <Button
                    onClick={handleCreatePaymentLink}
                    disabled={creatingPaymentLink || !booking.customerPhone}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:opacity-50 text-white font-semibold py-3"
                  >
                    {creatingPaymentLink ? (
                      <>
                        <div className="animate-spin mr-2 h-4 w-4 border-2 border-white/30 border-t-white rounded-full" />
                        Creando link...
                      </>
                    ) : (
                      <>
                        <CreditCard className="w-4 h-4 mr-2" />
                        Generar link de pago completo
                      </>
                    )}
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <div className="rounded-lg border border-border bg-background-secondary/30 p-3">
                      <div className="text-xs font-medium text-foreground-muted mb-2">Link de pago generado:</div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={paymentLink}
                          readOnly
                          className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(paymentLink);
                            toast.success("Link copiado al portapapeles");
                          }}
                          className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground hover:bg-background-secondary"
                        >
                          Copiar
                        </button>
                      </div>
                    </div>
                    <Button
                      onClick={handleSendPaymentLink}
                      disabled={sendingPaymentLink || !booking.customerPhone}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:opacity-50 text-white font-semibold py-3"
                    >
                      {sendingPaymentLink ? (
                        <>
                          <div className="animate-spin mr-2 h-4 w-4 border-2 border-white/30 border-t-white rounded-full" />
                          Preparando...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 mr-2" />
                          Copiar mensaje para WhatsApp
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </Section>

        {/* Resumen */}
        {(selectedService || selectedInstructor || booking.branchId) && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-background-secondary border border-border mb-6">
            <div className="text-xs text-foreground-muted mb-2">Resumen de tu reserva:</div>
            <div className="flex flex-wrap gap-4 text-sm text-foreground">
              {selectedService && (
                <div className="flex items-center gap-2">
                  <span className="text-foreground-secondary">Servicio:</span>
                  <span className="font-semibold">{selectedService.name}</span>
                  <span className="text-foreground-secondary">• {selectedService.duration_min}min</span>
                </div>
              )}
              {selectedInstructor && (
                <div className="flex items-center gap-2">
                  <span className="text-foreground-secondary">Estilista:</span>
                  <span className="font-semibold">{selectedInstructor.name}</span>
                </div>
              )}
              {booking.branchId && (
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  <span>
                    Sucursal:{" "}
                    {branches.find((b) => String(b.id) === String(booking.branchId))?.name || "Sin asignar"}
                  </span>
                </div>
              )}
              {booking.repeatEnabled && (
                <div className="flex items-center gap-2 text-primary">
                  <Repeat className="w-4 h-4" />
                  <span>
                    Turno semanal •{" "}
                    {booking.repeatUntil
                      ? `Hasta ${booking.repeatUntil}`
                      : `${booking.repeatCount ?? 4} repeticiones`}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/** Fin formulario de turnos */}
        </>)}

        {/* Contenido de Clases */}
        {activeTab === "classes" && classesEnabled && (
          <Section title="Inscribir en clase" icon={Users}>
            <ClassEnrollForm
              defaultName={booking.customerName}
              defaultPhone={booking.customerPhone}
            />
          </Section>
        )}
      </div>

      {/* Modal de confirmación de WhatsApp */}
      {showWhatsAppModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-background rounded-2xl shadow-2xl border border-border p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <MessageSquare className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-xl font-bold text-foreground">Enviar confirmación por WhatsApp</h3>
              </div>
              <button
                onClick={() => {
                  setShowWhatsAppModal(false);
                  setPendingBookingData(null);
                }}
                className="text-foreground-muted hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-foreground-secondary mb-6">
              ¿Cómo querés notificar al cliente sobre su turno?
            </p>

            <div className="space-y-3">
              <button
                onClick={() => handleConfirmBooking('with_payment')}
                className="w-full p-4 rounded-xl border-2 border-primary bg-primary/10 hover:bg-primary/20 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/20 rounded-lg">
                    <CreditCard className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-foreground">Confirmación con link de pago</div>
                    <div className="text-sm text-foreground-muted mt-1">
                      Se enviará la confirmación del turno junto con el link para pagar la seña
                    </div>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleConfirmBooking('reminder_only')}
                className="w-full p-4 rounded-xl border-2 border-border bg-background-secondary hover:bg-background-secondary/80 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-background rounded-lg">
                    <Clock className="w-5 h-5 text-foreground-secondary" />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-foreground">Solo recordatorio</div>
                    <div className="text-sm text-foreground-muted mt-1">
                      Se enviará solo la confirmación del turno sin link de pago
                    </div>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleConfirmBooking('none')}
                className="w-full p-4 rounded-xl border border-border bg-background hover:bg-background-secondary transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-background-secondary rounded-lg">
                    <X className="w-5 h-5 text-foreground-secondary" />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-foreground">No enviar WhatsApp</div>
                    <div className="text-sm text-foreground-muted mt-1">
                      El turno se creará sin enviar ningún mensaje
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Componente auxiliar para badges de pasos
function StepBadge({ completed, label, number }) {
  return (
    <div
      className={`
        inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
        ${completed
          ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
          : 'bg-background-secondary text-foreground-secondary border border-border'
        }
      `}
    >
      <span className={`
        inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold
        ${completed ? 'bg-emerald-500 text-white' : 'bg-border text-foreground-secondary'}
      `}>
        {completed ? '✓' : number}
      </span>
      {label}
    </div>
  );
}
