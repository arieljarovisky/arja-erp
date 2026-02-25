import React, { useEffect, useMemo, useState } from "react";
import { apiClient } from "../api";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "../shared/useQuery.js";
import { formatPhone, initials, formatDateTime, StatusPill } from "../shared/ui.jsx";
import { useApp } from "../context/UseApp.js";
import { toast } from "sonner";
import { XCircle } from "lucide-react";

const DOCUMENT_TYPE_OPTIONS = [
  { value: "", label: "Sin especificar" },
  { value: "96", label: "DNI" },
  { value: "80", label: "CUIT" },
  { value: "86", label: "CUIL" },
  { value: "94", label: "Pasaporte" },
  { value: "99", label: "Consumidor Final (sin documento)" },
];

const CONDICION_IVA_OPTIONS = [
  { value: "", label: "Sin especificar" },
  { value: "5", label: "Consumidor Final" },
  { value: "1", label: "Responsable Inscripto" },
  { value: "6", label: "Monotributista" },
  { value: "4", label: "Exento" },
];

const buildFormData = (customer) => ({
  name: customer?.name ?? "",
  phone: customer?.phone ?? "",
  email: customer?.email ?? "",
  documento: customer?.documento ?? "",
  tipo_documento: customer?.tipo_documento != null && customer?.tipo_documento !== undefined
    ? String(customer.tipo_documento)
    : "",
  cuit: customer?.cuit ?? "",
  razon_social: customer?.razon_social ?? "",
  domicilio: customer?.domicilio ?? "",
  condicion_iva: customer?.condicion_iva != null && customer?.condicion_iva !== undefined
    ? String(customer.condicion_iva)
    : "",
  notes: customer?.notes ?? "",
  exempt_deposit: customer?.exempt_deposit === true || customer?.exempt_deposit === 1,
});

const getOptionLabel = (options, value) => {
  const option = options.find((opt) => opt.value === (value ?? ""));
  if (option) return option.label;
  if (!value) return "Sin especificar";
  return value;
};

function formatSeriesId(seriesId) {
  if (!seriesId) return "—";
  const clean = String(seriesId).replace(/[^a-zA-Z0-9]/g, "");
  if (!clean.length) return "—";
  if (clean.length <= 6) return clean.toUpperCase();
  return `SER-${clean.slice(-6).toUpperCase()}`;
}

export default function CustomerDetailPage() {
  const { id, tenantSlug } = useParams();
  const { data, loading, error, refetch } = useQuery((signal) => apiClient.customerDetail(id, signal), [id]);
  const [customer, setCustomer] = useState(null);
  const [formData, setFormData] = useState(buildFormData(null));
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [cancellingSubscriptionId, setCancellingSubscriptionId] = useState(null);
  const { classesEnabled } = useApp();
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyTitle, setNotifyTitle] = useState("");
  const [notifyMessage, setNotifyMessage] = useState("");
  const [sendingNotify, setSendingNotify] = useState(false);

  useEffect(() => {
    if (data) {
      setCustomer(data);
      if (!isEditing) {
        setFormData(buildFormData(data));
      }
    }
  }, [data, isEditing]);

  const appointments = useMemo(() => customer?.appointments ?? [], [customer]);
  const classEnrollments = useMemo(() => customer?.class_enrollments ?? [], [customer]);
  const classStats = useMemo(() => customer?.class_stats ?? {}, [customer]);
  const subscriptions = useMemo(() => customer?.subscriptions ?? [], [customer]);
  const subscriptionSummary = useMemo(
    () => customer?.subscription_summary ?? { hasSubscription: false, hasActiveSubscription: false, status: null },
    [customer]
  );

  const showClassSection = classesEnabled || (classEnrollments?.length ?? 0) > 0;
  const showMembershipSection =
    Boolean(subscriptionSummary?.hasSubscription || subscriptionSummary?.hasActiveSubscription) ||
    subscriptions.length > 0;

  const membershipStatusMap = {
    authorized: { label: "Activa", tone: "bg-emerald-500/10 text-emerald-300 border border-emerald-400/20" },
    pending: { label: "Pendiente", tone: "bg-amber-500/10 text-amber-300 border border-amber-400/20" },
    paused: { label: "Pausada", tone: "bg-slate-500/10 text-slate-300 border border-slate-400/20" },
    cancelled: { label: "Cancelada", tone: "bg-rose-500/10 text-rose-300 border border-rose-400/20" },
    default: { label: "Sin suscripción", tone: "bg-foreground/5 text-foreground-secondary border border-border" },
  };

  const membershipToneKey = subscriptionSummary?.hasActiveSubscription
    ? "authorized"
    : subscriptionSummary?.status || (subscriptionSummary?.hasSubscription ? "pending" : "default");
  const primaryMembershipTone =
    membershipStatusMap[membershipToneKey] ?? membershipStatusMap.default;

  const formatCurrency = (amount, currency = "ARS") => {
    if (amount == null) return "—";
    const numeric = Number(amount);
    if (!Number.isFinite(numeric)) return "—";
    try {
      return new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: currency || "ARS",
        minimumFractionDigits: 2,
      }).format(numeric);
    } catch {
      return `$${numeric.toFixed(2)} ${currency || ""}`.trim();
    }
  };

  const handleCancelSubscription = async (subscriptionId) => {
    if (!window.confirm("¿Estás seguro de que deseas cancelar esta suscripción? Esta acción no se puede deshacer.")) {
      return;
    }

    setCancellingSubscriptionId(subscriptionId);
    try {
      await apiClient.updateSubscriptionStatus(subscriptionId, "cancelled");
      toast.success("Suscripción cancelada correctamente");
      // Recargar los datos del cliente
      await refetch();
    } catch (error) {
      console.error("Error cancelando suscripción:", error);
      toast.error(error?.response?.data?.error || "Error al cancelar la suscripción");
    } finally {
      setCancellingSubscriptionId(null);
    }
  };

  // Obtener la suscripción activa para mostrar el botón de cancelar
  const activeSubscription = subscriptions.find((s) => s.status === "authorized" || s.status === "pending");

  const handleChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleStartEditing = () => {
    setFormData(buildFormData(customer));
    setIsEditing(true);
    setSaveError("");
  };

  const handleCancelEditing = () => {
    setFormData(buildFormData(customer));
    setIsEditing(false);
    setSaveError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!formData) return;
    setSaving(true);
    setSaveError("");

    try {
      // Preparar payload asegurando que exempt_deposit sea 1 o 0
      const payload = {
        ...formData,
        exempt_deposit: formData.exempt_deposit === true || formData.exempt_deposit === 1 ? 1 : 0,
      };
      
      const updated = await apiClient.updateCustomer(id, payload);
      const merged = { ...customer, ...updated };
      setCustomer(merged);
      setFormData(buildFormData(merged));
      setIsEditing(false);
      refetch();
    } catch (e) {
      const message = e?.response?.data?.error || e?.message || "Error al guardar";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Cargando…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!customer) return <p className="text-sm text-gray-500">No encontrado.</p>;

  const summaryCards = [
    {
      label: "Turnos totales",
      value: appointments.length,
      hint: "Incluye todos los estados",
    },
    showClassSection
      ? {
          label: "Clases anotadas",
          value: classStats?.upcoming_reserved ?? 0,
          hint: `${classStats?.past_reserved ?? 0} reservas anteriores`,
        }
      : null,
    showClassSection
      ? {
          label: "Clases realizadas",
          value: classStats?.attended ?? 0,
          hint: `${classEnrollments.length} inscripciones totales`,
        }
      : null,
    showMembershipSection
      ? {
          label: "Membresía",
          value: subscriptionSummary?.hasSubscription ? primaryMembershipTone.label : "Sin suscripción",
          hint: subscriptionSummary?.hasSubscription
            ? [
                subscriptionSummary?.plan_name || null,
                subscriptionSummary?.amount_decimal != null
                  ? formatCurrency(subscriptionSummary.amount_decimal, subscriptionSummary.currency)
                  : null,
                subscriptionSummary?.last_payment_at
                  ? `Último pago ${formatDateTime(subscriptionSummary.last_payment_at)}`
                  : null,
                subscriptionSummary?.next_charge_at
                  ? `Próximo ${formatDateTime(subscriptionSummary.next_charge_at)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" • ") ||
              (subscriptionSummary?.hasActiveSubscription ? "Cuota al día" : "Revisar estado de pago")
            : "No hay suscripciones asociadas",
          badgeClass: subscriptionSummary?.hasSubscription ? primaryMembershipTone.tone : membershipStatusMap.default.tone,
        }
      : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative size-12">
            {customer.picture ? (
              <img 
                src={customer.picture} 
                alt={customer.name || "Cliente"} 
                className="size-12 rounded-full object-cover border border-border"
                style={{ display: 'block' }}
                onError={(e) => {
                  e.target.style.display = 'none';
                  const fallback = e.target.nextElementSibling;
                  if (fallback) {
                    fallback.style.display = 'flex';
                  }
                }}
              />
            ) : null}
            <div 
              className="size-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-base"
              style={{ 
                display: customer.picture ? 'none' : 'flex',
                position: customer.picture ? 'absolute' : 'static',
                top: customer.picture ? 0 : 'auto',
                left: customer.picture ? 0 : 'auto',
                right: customer.picture ? 0 : 'auto',
                bottom: customer.picture ? 0 : 'auto'
              }}
            >
              {initials(customer.name || "?")}
            </div>
          </div>
          <div>
            <div className="text-lg font-semibold">{customer.name || "(Sin nombre)"}</div>
            <div className="text-sm text-white-600">{formatPhone(customer.phone)}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link to={`/${tenantSlug}/customers`} className="text-sm text-white-600 hover:text-gray-900">
            ← Volver
          </Link>
          {!isEditing ? (
              <button
                type="button"
                onClick={handleStartEditing}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground-secondary hover:text-foreground hover:bg-background-secondary"
              >
                Editar
              </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowNotifyModal(true)}
            className="rounded-lg bg-primary text-white px-3 py-2 text-sm font-medium hover:bg-primary-hover"
            title="Enviar notificación push al cliente"
          >
            Enviar notificación
          </button>
        </div>
      </div>

      {summaryCards.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-border bg-background-secondary/40 px-4 py-4 shadow-sm">
              <div className="text-xs font-medium text-foreground-muted uppercase tracking-wide">{card.label}</div>
              {card.badgeClass ? (
                <div className="mt-3">
                  <span className={`inline-flex px-3 py-1 rounded-lg text-sm font-semibold ${card.badgeClass}`}>
                    {card.value}
                  </span>
                </div>
              ) : (
                <div className="mt-3 text-2xl font-semibold text-foreground">{card.value}</div>
              )}
              {card.hint ? <div className="text-xs text-foreground-secondary mt-2">{card.hint}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="card p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Datos del cliente</h2>
          {isEditing ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancelEditing}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground-secondary hover:text-foreground hover:bg-background-secondary"
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-lg bg-primary text-white px-4 py-2 text-sm font-semibold hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={saving}
              >
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          ) : null}
        </div>

        {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground-secondary uppercase">Nombre</span>
            <input
              type="text"
              value={formData.name}
              onChange={handleChange("name")}
              className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
              disabled={!isEditing}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground-secondary uppercase">Teléfono</span>
            <input
              type="text"
              value={formData.phone}
              onChange={handleChange("phone")}
              className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
              disabled={!isEditing}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground-secondary uppercase">Email</span>
            <input
              type="email"
              value={formData.email}
              onChange={handleChange("email")}
              className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
              disabled={!isEditing}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground-secondary uppercase">Documento</span>
            <input
              type="text"
              value={formData.documento}
              onChange={handleChange("documento")}
              className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
              disabled={!isEditing}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground-secondary uppercase">Tipo documento</span>
            {isEditing ? (
              <select
                value={formData.tipo_documento}
                onChange={handleChange("tipo_documento")}
                className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
              >
                {DOCUMENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-lg border border-border px-3 py-2 text-sm bg-background text-foreground-secondary">
                {getOptionLabel(DOCUMENT_TYPE_OPTIONS, formData.tipo_documento)}
              </div>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground-secondary uppercase">CUIT</span>
            <input
              type="text"
              value={formData.cuit}
              onChange={handleChange("cuit")}
              className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
              disabled={!isEditing}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground-secondary uppercase">Razón social</span>
            <input
              type="text"
              value={formData.razon_social}
              onChange={handleChange("razon_social")}
              className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
              disabled={!isEditing}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground-secondary uppercase">Domicilio</span>
            <input
              type="text"
              value={formData.domicilio}
              onChange={handleChange("domicilio")}
              className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
              disabled={!isEditing}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground-secondary uppercase">Condición IVA</span>
            {isEditing ? (
              <select
                value={formData.condicion_iva}
                onChange={handleChange("condicion_iva")}
                className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
              >
                {CONDICION_IVA_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-lg border border-border px-3 py-2 text-sm bg-background text-foreground-secondary">
                {getOptionLabel(CONDICION_IVA_OPTIONS, formData.condicion_iva)}
              </div>
            )}
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-foreground-secondary uppercase">Notas</span>
          <textarea
            value={formData.notes}
            onChange={handleChange("notes")}
            className="rounded-lg border border-border px-3 py-2 text-sm bg-background min-h-24"
            disabled={!isEditing}
          />
        </label>

        <div className="flex items-center gap-3 p-4 rounded-lg border border-border bg-background-secondary/40">
          <input
            type="checkbox"
            id="exempt_deposit"
            checked={Boolean(formData.exempt_deposit)}
            onChange={handleChange("exempt_deposit")}
            className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
            disabled={!isEditing}
          />
          <label htmlFor="exempt_deposit" className="flex-1 cursor-pointer">
            <div className="text-sm font-medium text-foreground">Cliente habitual (exento de seña)</div>
            <div className="text-xs text-foreground-secondary mt-1">
              Si está marcado, este cliente no deberá pagar seña al reservar turnos
            </div>
          </label>
        </div>
      </form>

      <section className="space-y-3">
        <div className="text-sm font-medium mb-1">Historial de turnos</div>
        <div className="rounded-xl border border-gray-200 bg-background-secondary/30 overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-2 text-xs font-medium text-white-500 bg-dark-200 border-b">
            <div className="col-span-4">Fecha</div>
            <div className="col-span-3">Estado</div>
            <div className="col-span-5">Servicio / Instructor</div>
          </div>
          {Array.isArray(appointments) && appointments.length > 0 ? (
            <div className="divide-y divide-border/60">
              {appointments.map((a) => (
                <div key={a.id} className="grid grid-cols-12 px-4 py-2 text-sm">
                  <div className="col-span-4">{formatDateTime(a.starts_at)}</div>
                  <div className="col-span-3">
                    <StatusPill status={a.status} />
                  </div>
                  <div className="col-span-5 text-white-700">
                    {a.service} · <span className="text-dark-500">{a.instructor}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-sm text-gray-500">Sin turnos todavía.</div>
          )}
        </div>
      </section>

      {showClassSection ? (
        <section className="space-y-3">
          <div className="text-sm font-medium flex items-center justify-between">
            <span>Historial de clases</span>
            <span className="text-xs text-foreground-muted">{classEnrollments.length} inscripciones totales</span>
          </div>
          <div className="rounded-xl border border-gray-200 bg-background-secondary/30 overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-2 text-xs font-medium text-white-500 bg-dark-200 border-b">
              <div className="col-span-4">Fecha</div>
              <div className="col-span-3">Estado</div>
              <div className="col-span-5">Clase / Instructor</div>
            </div>
            {classEnrollments.length ? (
              <div className="divide-y divide-border/60">
                {classEnrollments.map((cl) => {
                  const statusMeta =
                    {
                      reserved: {
                        label: "Anotada",
                        tone: "bg-primary/10 text-primary border border-primary/20",
                      },
                      attended: {
                        label: "Realizada",
                        tone: "bg-emerald-500/10 text-emerald-300 border border-emerald-400/20",
                      },
                      cancelled: {
                        label: "Cancelada",
                        tone: "bg-rose-500/10 text-rose-300 border border-rose-400/20",
                      },
                    }[cl.enrollment_status] || {
                      label: cl.enrollment_status || "—",
                      tone: "bg-foreground/5 text-foreground-secondary border border-border",
                    };

                  return (
                    <div key={`${cl.id}-${cl.session_id}`} className="grid grid-cols-12 px-4 py-2 text-sm">
                      <div className="col-span-4">
                        <div>{formatDateTime(cl.starts_at)}</div>
                        <div className="text-xs text-foreground-muted">
                          Cupo {cl.capacity_max ?? "—"} • Serie {formatSeriesId(cl.series_id)}
                        </div>
                      </div>
                      <div className="col-span-3">
                        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusMeta.tone}`}>
                          {statusMeta.label}
                        </span>
                      </div>
                      <div className="col-span-5 text-white-700">
                        <div className="font-medium">
                          {cl.template_name || cl.activity_type || "Clase"}
                        </div>
                        <div className="text-xs text-dark-500">{cl.instructor_name}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-6 text-sm text-gray-500">Sin clases registradas.</div>
            )}
          </div>
        </section>
      ) : null}

      {showMembershipSection ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Membresía</div>
            {subscriptions.length > 0 && (
              <Link
                to={`/${tenantSlug}/customers/${id}/membership-history`}
                className="text-xs font-medium text-primary hover:text-primary-hover"
              >
                Ver historial →
              </Link>
            )}
          </div>
          <div className="rounded-xl border border-border bg-background-secondary/30 p-5 space-y-4">
            {subscriptionSummary?.hasActiveSubscription ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs uppercase text-foreground-muted tracking-wide">Estado principal</div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${primaryMembershipTone.tone}`}>
                      {primaryMembershipTone.label}
                    </span>
                    {activeSubscription && (activeSubscription.status === "authorized" || activeSubscription.status === "pending") && (
                      <button
                        onClick={() => handleCancelSubscription(activeSubscription.id)}
                        disabled={cancellingSubscriptionId === activeSubscription.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/30 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Cancelar suscripción"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        {cancellingSubscriptionId === activeSubscription.id ? "Cancelando..." : "Cancelar"}
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1 text-sm text-foreground">
                  <div className="text-xs uppercase text-foreground-muted tracking-wide">Plan actual</div>
                  <div className="font-semibold">
                    {subscriptionSummary?.plan_name || "Sin plan asignado"}
                  </div>
                  <div className="text-xs text-foreground-muted">
                    {subscriptionSummary?.amount_decimal != null
                      ? formatCurrency(subscriptionSummary.amount_decimal, subscriptionSummary.currency)
                      : "Sin monto definido"}
                    {subscriptionSummary?.plan_billing_day && (
                      <>
                        {" • "}
                        {`Vence día ${subscriptionSummary.plan_billing_day}`}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-foreground-secondary">No hay suscripciones activas para este cliente.</div>
            )}
          </div>
        </section>
      ) : null}

      {/* Sección de Rutinas */}
      <section className="space-y-3">
        <div className="text-sm font-medium flex items-center justify-between">
          <span>Rutinas de ejercicios</span>
        </div>
        <CustomerRoutinesSection customerId={id} />
      </section>

      {showNotifyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNotifyModal(false)}>
          <div className="bg-background rounded-lg border border-border p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Enviar notificación</h3>
              <button
                onClick={() => setShowNotifyModal(false)}
                className="text-foreground-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-foreground-secondary uppercase">Título</span>
                <input
                  type="text"
                  value={notifyTitle}
                  onChange={(e) => setNotifyTitle(e.target.value)}
                  className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-foreground-secondary uppercase">Mensaje</span>
                <textarea
                  value={notifyMessage}
                  onChange={(e) => setNotifyMessage(e.target.value)}
                  className="rounded-lg border border-border px-3 py-2 text-sm bg-background min-h-24"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground-secondary hover:text-foreground hover:bg-background-secondary"
                onClick={() => setShowNotifyModal(false)}
                disabled={sendingNotify}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-primary text-white px-4 py-2 text-sm font-semibold hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={async () => {
                  const t = notifyTitle.trim();
                  const m = notifyMessage.trim();
                  if (!t || !m) {
                    toast.error("Ingresá título y mensaje");
                    return;
                  }
                  setSendingNotify(true);
                  try {
                    await apiClient.sendNotificationToCustomer(Number(id), {
                      type: "info",
                      title: t,
                      message: m,
                      data: { source: "admin" },
                    });
                    toast.success("Notificación enviada");
                    setShowNotifyModal(false);
                    setNotifyTitle("");
                    setNotifyMessage("");
                  } catch (error) {
                    toast.error(error?.response?.data?.error || "Error enviando notificación");
                  } finally {
                    setSendingNotify(false);
                  }
                }}
                disabled={sendingNotify}
              >
                {sendingNotify ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Componente para la sección de rutinas
function CustomerRoutinesSection({ customerId }) {
  const [assignedRoutines, setAssignedRoutines] = useState([]);
  const [availableRoutines, setAvailableRoutines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);

  useEffect(() => {
    loadRoutines();
  }, [customerId]);

  const loadRoutines = async () => {
    try {
      setLoading(true);
      const [assigned, available] = await Promise.all([
        apiClient.getCustomerRoutines(customerId),
        apiClient.getAvailableRoutines(),
      ]);
      setAssignedRoutines(Array.isArray(assigned) ? assigned : []);
      setAvailableRoutines(Array.isArray(available) ? available : []);
    } catch (error) {
      console.error("Error cargando rutinas:", error);
      toast.error("Error al cargar las rutinas");
    } finally {
      setLoading(false);
    }
  };

  const handleAssignRoutine = async (routineId) => {
    try {
      setAssigning(true);
      await apiClient.assignRoutineToCustomer(routineId, customerId);
      toast.success("Rutina asignada correctamente");
      setShowAssignModal(false);
      await loadRoutines();
    } catch (error) {
      console.error("Error asignando rutina:", error);
      toast.error(error?.response?.data?.error || "Error al asignar la rutina");
    } finally {
      setAssigning(false);
    }
  };

  const unassignedRoutines = availableRoutines.filter(
    (r) => !assignedRoutines.some((ar) => ar.id === r.id)
  );

  if (loading) {
    return (
      <div className="card p-5">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 space-y-4">
      {/* Rutinas asignadas */}
      <div>
        <div className="text-xs font-medium text-foreground-secondary uppercase tracking-wide mb-3">
          Rutinas asignadas ({assignedRoutines.length})
        </div>
        {assignedRoutines.length > 0 ? (
          <div className="space-y-2">
            {assignedRoutines.map((routine) => (
              <div
                key={routine.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border bg-background-secondary/40"
              >
                <div className="flex-1">
                  <div className="text-sm font-semibold text-foreground">{routine.name}</div>
                  {routine.description && (
                    <div className="text-xs text-foreground-muted mt-1">{routine.description}</div>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-foreground-secondary">
                    {routine.duration_minutes && (
                      <span>⏱️ {routine.duration_minutes} min</span>
                    )}
                    {routine.difficulty && (
                      <span>💪 {routine.difficulty}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-foreground-muted py-4 text-center">
            No hay rutinas asignadas a este cliente
          </div>
        )}
      </div>

      {/* Botón para asignar rutinas */}
      <div className="flex items-center justify-between pt-3 border-t border-border">
        <div className="text-xs text-foreground-muted">
          {unassignedRoutines.length > 0
            ? `${unassignedRoutines.length} rutina${unassignedRoutines.length !== 1 ? "s" : ""} disponible${unassignedRoutines.length !== 1 ? "s" : ""}`
            : "No hay rutinas disponibles para asignar"}
        </div>
        {unassignedRoutines.length > 0 && (
          <button
            onClick={() => setShowAssignModal(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-hover transition-colors"
          >
            Asignar rutina
          </button>
        )}
      </div>

      {/* Modal para asignar rutinas */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAssignModal(false)}>
          <div className="bg-background rounded-lg border border-border p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Asignar rutina</h3>
              <button
                onClick={() => setShowAssignModal(false)}
                className="text-foreground-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2">
              {unassignedRoutines.map((routine) => (
                <button
                  key={routine.id}
                  onClick={() => handleAssignRoutine(routine.id)}
                  disabled={assigning}
                  className="w-full text-left p-3 rounded-lg border border-border bg-background-secondary/40 hover:bg-background-secondary transition-colors disabled:opacity-50"
                >
                  <div className="text-sm font-semibold text-foreground">{routine.name}</div>
                  {routine.description && (
                    <div className="text-xs text-foreground-muted mt-1">{routine.description}</div>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-foreground-secondary">
                    {routine.duration_minutes && (
                      <span>⏱️ {routine.duration_minutes} min</span>
                    )}
                    {routine.difficulty && (
                      <span>💪 {routine.difficulty}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
