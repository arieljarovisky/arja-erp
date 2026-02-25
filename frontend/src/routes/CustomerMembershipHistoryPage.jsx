import React, { useEffect, useState } from "react";
import { apiClient } from "../api";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "../shared/useQuery.js";
import { formatDateTime } from "../shared/ui.jsx";
import { toast } from "sonner";
import { XCircle } from "lucide-react";

export default function CustomerMembershipHistoryPage() {
  const { id, tenantSlug } = useParams();
  const { data, loading, error, refetch } = useQuery((signal) => apiClient.customerDetail(id, signal), [id]);
  const [customer, setCustomer] = useState(null);
  const [cancellingSubscriptionId, setCancellingSubscriptionId] = useState(null);

  useEffect(() => {
    if (data) {
      setCustomer(data);
    }
  }, [data]);

  const subscriptions = customer?.subscriptions ?? [];
  const subscriptionSummary = customer?.subscription_summary ?? { hasSubscription: false, hasActiveSubscription: false, status: null };

  const membershipStatusMap = {
    authorized: { label: "Activa", tone: "bg-emerald-500/10 text-emerald-300 border border-emerald-400/20" },
    pending: { label: "Pendiente", tone: "bg-amber-500/10 text-amber-300 border border-amber-400/20" },
    paused: { label: "Pausada", tone: "bg-slate-500/10 text-slate-300 border border-slate-400/20" },
    cancelled: { label: "Cancelada", tone: "bg-rose-500/10 text-rose-300 border border-rose-400/20" },
    default: { label: "Sin suscripción", tone: "bg-foreground/5 text-foreground-secondary border border-border" },
  };

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
      await refetch();
    } catch (error) {
      console.error("Error cancelando suscripción:", error);
      toast.error(error?.response?.data?.error || "Error al cancelar la suscripción");
    } finally {
      setCancellingSubscriptionId(null);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Cargando…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!customer) return <p className="text-sm text-gray-500">No encontrado.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-1">Historial de suscripciones</h1>
          <p className="text-sm text-foreground-secondary">
            {customer.name || "(Sin nombre)"}
          </p>
        </div>
        <Link
          to={`/${tenantSlug}/customers/${id}`}
          className="text-sm text-foreground-secondary hover:text-foreground"
        >
          ← Volver al cliente
        </Link>
      </div>

      <div className="card p-5 space-y-4">
        {/* Resumen de membresía activa */}
        {subscriptionSummary?.hasSubscription && (
          <div className="rounded-xl border border-border bg-background-secondary/30 p-5 space-y-4 mb-6">
            <div className="text-sm font-medium mb-3">Membresía activa</div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <div className="text-xs uppercase text-foreground-muted tracking-wide">Estado principal</div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${
                    subscriptionSummary?.hasActiveSubscription
                      ? membershipStatusMap.authorized.tone
                      : membershipStatusMap[subscriptionSummary?.status || "default"]?.tone || membershipStatusMap.default.tone
                  }`}>
                    {subscriptionSummary?.hasActiveSubscription
                      ? "Activa"
                      : membershipStatusMap[subscriptionSummary?.status || "default"]?.label || "Sin suscripción"}
                  </span>
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
                  {" • "}
                  {subscriptionSummary?.plan_billing_day
                    ? `Vence día ${subscriptionSummary.plan_billing_day}`
                    : "Vence según fecha de pago"}
                </div>
              </div>
              <div className="flex gap-6 text-sm text-foreground-secondary">
                <div>
                  <div className="text-xs uppercase text-foreground-muted tracking-wide">Último pago</div>
                  <div className="font-medium text-foreground">
                    {subscriptionSummary?.last_payment_at ? formatDateTime(subscriptionSummary.last_payment_at) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-foreground-muted tracking-wide">Próximo cobro</div>
                  <div className="font-medium text-foreground">
                    {subscriptionSummary?.next_charge_at ? formatDateTime(subscriptionSummary.next_charge_at) : "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Historial completo */}
        <div className="space-y-3">
          <div className="text-sm font-medium">Historial de suscripciones</div>
          {subscriptions.length > 0 ? (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <div className="grid grid-cols-12 px-4 py-2 text-xs font-medium bg-dark-200 text-white-500 border-b">
                <div className="col-span-2">Creada</div>
                <div className="col-span-2">Plan / Motivo</div>
                <div className="col-span-2 text-right">Monto</div>
                <div className="col-span-2 text-right">Último pago</div>
                <div className="col-span-2 text-right">Próximo cobro</div>
                <div className="col-span-1 text-right">Estado</div>
                <div className="col-span-1 text-right">Acciones</div>
              </div>
              <div className="divide-y divide-border/60">
                {subscriptions.map((sub) => {
                  const tone = membershipStatusMap[sub.status]?.tone || membershipStatusMap.default.tone;
                  const label = membershipStatusMap[sub.status]?.label || sub.status || "—";
                  const canCancel = (sub.status === "authorized" || sub.status === "pending") && cancellingSubscriptionId !== sub.id;
                  return (
                    <div key={sub.id} className="grid grid-cols-12 px-4 py-2 text-sm items-center">
                      <div className="col-span-2">{formatDateTime(sub.created_at)}</div>
                      <div className="col-span-2">
                        <div className="font-medium text-foreground">{sub.plan_name || sub.reason || "Sin plan"}</div>
                        {sub.plan_name && sub.reason ? (
                          <div className="text-xs text-foreground-muted">{sub.reason}</div>
                        ) : null}
                      </div>
                      <div className="col-span-2 text-right">{formatCurrency(sub.amount_decimal, sub.currency)}</div>
                      <div className="col-span-2 text-right">
                        {sub.last_payment_at ? formatDateTime(sub.last_payment_at) : "—"}
                      </div>
                      <div className="col-span-2 text-right">
                        {sub.next_charge_at ? formatDateTime(sub.next_charge_at) : "—"}
                      </div>
                      <div className="col-span-1 text-right">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${tone}`}>
                          {label}
                        </span>
                      </div>
                      <div className="col-span-1 text-right">
                        {canCancel ? (
                          <button
                            onClick={() => handleCancelSubscription(sub.id)}
                            disabled={cancellingSubscriptionId === sub.id}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/30 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Cancelar suscripción"
                          >
                            <XCircle className="w-3 h-3" />
                            {cancellingSubscriptionId === sub.id ? "..." : "Cancelar"}
                          </button>
                        ) : (
                          <span className="text-xs text-foreground-muted">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-sm text-foreground-secondary py-8 text-center">
              No hay suscripciones cargadas para este cliente.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

