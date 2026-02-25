import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, Edit3, RefreshCw, Save, Plus } from "lucide-react";
import { toast } from "sonner";
import Button from "../../components/ui/Button";
import { apiClient } from "../../api/client.js";
import { logger } from "../../utils/logger.js";

const DEFAULT_PLAN_FORM = {
  id: null,
  name: "",
  price_decimal: 0,
  duration_months: 1,
  description: "",
  is_active: true,
  max_classes_per_week: "",
  max_classes_per_month: "",
  max_active_appointments: "",
  billing_day: "",
  grace_days: "",
  interest_type: "none",
  interest_value: 0,
  auto_block: true,
};

const formatCurrency = (value, currency = "ARS") => {
  const number = Number(value ?? 0);
  if (Number.isNaN(number)) return "-";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(number);
};

function FieldGroup({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">{label}</label>
      {children}
      {hint && <p className="text-xs text-foreground-muted mt-1">{hint}</p>}
    </div>
  );
}

function SwitchField({ label, description, checked, onChange, disabled = false }) {
  return (
    <label
      className={`flex items-center gap-3 p-3 rounded-xl border border-border bg-background-secondary hover:bg-border transition-all ${
        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="w-5 h-5 rounded border-border text-primary focus:ring-primary disabled:cursor-not-allowed"
      />
      <div className="flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && <p className="text-xs text-foreground-secondary mt-0.5">{description}</p>}
      </div>
    </label>
  );
}

export default function MembershipPlansPage() {
  const navigate = useNavigate();
  const { tenantSlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const [plans, setPlans] = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [plansError, setPlansError] = useState(null);
  const [form, setForm] = useState({ ...DEFAULT_PLAN_FORM });
  const [saving, setSaving] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState(null);

  const loadPlans = useCallback(async () => {
    setLoadingPlans(true);
    setPlansError(null);
    try {
      const response = await apiClient.listMembershipPlans();
      setPlans(Array.isArray(response) ? response : []);
    } catch (error) {
      logger.error("[MembershipPlansPage] loadPlans error:", error);
      setPlans([]);
      setPlansError(error.response?.data?.error || "No se pudieron cargar los planes.");
      toast.error("No pudimos obtener los planes de membresía.");
    } finally {
      setLoadingPlans(false);
    }
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const applyPlanToForm = useCallback((plan) => {
    if (!plan) {
      setForm({ ...DEFAULT_PLAN_FORM });
      setSelectedPlanId(null);
      return;
    }

    setForm({
      id: plan.id,
      name: plan.name || "",
      price_decimal: plan.price_decimal ?? 0,
      duration_months: plan.duration_months ?? 1,
      description: plan.description || "",
      is_active: !!plan.is_active,
      max_classes_per_week: plan.max_classes_per_week ?? "",
      max_classes_per_month: plan.max_classes_per_month ?? "",
      max_active_appointments: plan.max_active_appointments ?? "",
      billing_day: plan.billing_day ?? "",
      grace_days: plan.grace_days ?? "",
      interest_type: plan.interest_type || "none",
      interest_value: plan.interest_value ?? 0,
      auto_block: plan.auto_block !== undefined ? !!plan.auto_block : true,
    });
    setSelectedPlanId(plan.id);
  }, []);

  useEffect(() => {
    if (loadingPlans) return;
    const planIdParam = searchParams.get("planId");
    if (!planIdParam) {
      applyPlanToForm(null);
      return;
    }
    const match = plans.find((plan) => String(plan.id) === planIdParam);
    if (match) {
      applyPlanToForm(match);
    } else {
      applyPlanToForm(null);
    }
  }, [loadingPlans, searchParams, plans, applyPlanToForm]);

  const updateSearchParam = (nextPlanId) => {
    const next = new URLSearchParams(searchParams);
    if (nextPlanId) {
      next.set("planId", nextPlanId);
    } else {
      next.delete("planId");
    }
    setSearchParams(next, { replace: true });
  };

  const handleSelectPlan = (plan) => {
    updateSearchParam(plan?.id);
    applyPlanToForm(plan);
  };

  const handleNewPlan = () => {
    updateSearchParam(null);
    applyPlanToForm(null);
  };

  const toPositiveIntOrNull = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Ingresá un nombre para la membresía.");
      return;
    }

    const description = (form.description || "").trim();

    const payload = {
      name: form.name.trim(),
      description: description || null,
      price_decimal: Number(form.price_decimal) >= 0 ? Number(form.price_decimal) : 0,
      duration_months: Math.max(1, parseInt(form.duration_months, 10) || 1),
      billing_day:
        form.billing_day === "" || form.billing_day == null
          ? null
          : Math.min(31, Math.max(1, parseInt(form.billing_day, 10) || 1)),
      grace_days: Math.max(0, parseInt(form.grace_days, 10) || 0),
      interest_type: form.interest_type || "none",
      interest_value:
        form.interest_type === "none" ? 0 : Math.max(0, Number(form.interest_value) || 0),
      auto_block: !!form.auto_block,
    };

    const weeklyLimit = toPositiveIntOrNull(form.max_classes_per_week);
    if (weeklyLimit != null) {
      payload.max_classes_per_week = weeklyLimit;
    } else if (form.max_classes_per_week === "" || form.max_classes_per_week == null) {
      payload.max_classes_per_week = null;
    }

    const monthlyLimit = toPositiveIntOrNull(form.max_classes_per_month);
    if (monthlyLimit != null) {
      payload.max_classes_per_month = monthlyLimit;
    } else if (form.max_classes_per_month === "" || form.max_classes_per_month == null) {
      payload.max_classes_per_month = null;
    }

    const appointmentLimit = toPositiveIntOrNull(form.max_active_appointments);
    if (appointmentLimit != null) {
      payload.max_active_appointments = appointmentLimit;
    } else if (form.max_active_appointments === "" || form.max_active_appointments == null) {
      payload.max_active_appointments = null;
    }

    if (form.id) {
      payload.is_active = form.is_active;
    }

    setSaving(true);
    try {
      if (form.id) {
        await apiClient.updateMembershipPlan(form.id, payload);
        toast.success("Plan actualizado correctamente");
      } else {
        await apiClient.createMembershipPlan(payload);
        toast.success("Plan creado correctamente");
      }
      await loadPlans();
      if (!form.id) {
        handleNewPlan();
      }
    } catch (error) {
      logger.error("[MembershipPlansPage] handleSubmit error:", error);
      toast.error(error.response?.data?.error || "No pudimos guardar el plan.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (plan) => {
    try {
      await apiClient.updateMembershipPlan(plan.id, { is_active: !plan.is_active });
      toast.success(
        `Plan ${plan.is_active ? "desactivado" : "activado"} correctamente`
      );
      await loadPlans();
    } catch (error) {
      logger.error("[MembershipPlansPage] handleToggleActive error:", error);
      toast.error("No pudimos actualizar el estado del plan.");
    }
  };

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-foreground-muted mb-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/${tenantSlug}/admin/config`)}
              className="inline-flex items-center gap-2 text-foreground-muted hover:text-primary transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Volver a Configuración
            </button>
          </p>
          <h1 className="text-2xl font-semibold text-foreground">Planes de membresía</h1>
          <p className="text-sm text-foreground-secondary mt-1">
            Definí precios, límites y reglas de vencimiento para tus clientes con cuota mensual.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={loadPlans} disabled={loadingPlans}>
            <RefreshCw className={`w-4 h-4 ${loadingPlans ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <Button onClick={handleNewPlan} variant="primary">
            <Plus className="w-4 h-4" />
            Nuevo plan
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,420px)]">
        <div className="rounded-2xl border border-border/80 bg-background-secondary/50 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border/70 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">Planes configurados</h2>
              <p className="text-sm text-foreground-muted">Tocá un plan para editarlo.</p>
            </div>
            <span className="text-xs px-2 py-1 rounded-full border border-border/60 text-foreground-secondary">
              {plans.length} planes
            </span>
          </div>

          {plansError ? (
            <div className="p-6 text-sm text-red-400">{plansError}</div>
          ) : loadingPlans ? (
            <div className="p-10 flex flex-col items-center gap-2 text-foreground-muted">
              <Loader2 className="w-5 h-5 animate-spin" />
              Cargando planes...
            </div>
          ) : plans.length === 0 ? (
            <div className="p-8 text-center text-sm text-foreground-muted">
              Todavía no creaste planes. Creá tu primer plan para empezar a controlar las cuotas.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left bg-background/60 text-foreground-muted uppercase text-xs tracking-wide">
                  <tr>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Duración</th>
                    <th className="px-4 py-3">Precio</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr
                      key={plan.id}
                      className={`border-t border-border/60 ${
                        selectedPlanId === plan.id ? "bg-primary/5" : "bg-transparent"
                      }`}
                    >
                      <td className="px-4 py-3 align-top">
                        <button
                          type="button"
                          onClick={() => handleSelectPlan(plan)}
                          className="text-left"
                        >
                          <p className="font-medium text-foreground">{plan.name}</p>
                          {plan.description && (
                            <p className="text-xs text-foreground-muted">{plan.description}</p>
                          )}
                          {(plan.max_classes_per_week ||
                            plan.max_classes_per_month ||
                            plan.max_active_appointments) && (
                            <p className="text-xs text-foreground-muted mt-1 space-x-2">
                              {plan.max_classes_per_week ? (
                                <span>Semanal: {plan.max_classes_per_week}</span>
                              ) : null}
                              {plan.max_classes_per_month ? (
                                <span>Mensual: {plan.max_classes_per_month}</span>
                              ) : null}
                              {plan.max_active_appointments ? (
                                <span>Turnos: {plan.max_active_appointments}</span>
                              ) : null}
                            </p>
                          )}
                          <p className="text-xs text-foreground-muted mt-1 space-x-2">
                            {plan.billing_day ? (
                              <span>Vence día {plan.billing_day}</span>
                            ) : (
                              <span>Vence según pago</span>
                            )}
                            <span>Gracia: {plan.grace_days ?? 0} días</span>
                            <span>
                              Interés:{" "}
                              {plan.interest_type === "none"
                                ? "Sin interés"
                                : plan.interest_type === "percent"
                                ? `${plan.interest_value ?? 0}%`
                                : `$${plan.interest_value ?? 0}`}
                            </span>
                            <span>Bloquea: {plan.auto_block ? "Sí" : "No"}</span>
                          </p>
                        </button>
                      </td>
                      <td className="px-4 py-3 align-top text-foreground-secondary">
                        {plan.duration_months <= 1 ? "1 mes" : `${plan.duration_months} meses`}
                      </td>
                      <td className="px-4 py-3 align-top">{formatCurrency(plan.price_decimal)}</td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium ${
                            plan.is_active
                              ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40"
                              : "bg-slate-500/10 text-slate-300 border border-slate-500/40"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              plan.is_active ? "bg-emerald-300" : "bg-slate-400"
                            }`}
                          />
                          {plan.is_active ? "Activo" : "Inactivo"}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleSelectPlan(plan)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-foreground-secondary hover:text-primary hover:bg-primary/10 transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(plan)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-foreground-secondary hover:text-foreground hover:bg-border transition-colors"
                          >
                            {plan.is_active ? "Desactivar" : "Activar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border/80 bg-background-secondary/60 shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-foreground-muted">
                {form.id ? "Editar plan" : "Nuevo plan"}
              </p>
              <h2 className="text-lg font-semibold text-foreground">
                {form.name || (form.id ? "Plan sin nombre" : "Nuevo plan de membresía")}
              </h2>
            </div>
            {form.id && (
              <span className="text-xs px-2 py-1 rounded-full border border-border/70 text-foreground-secondary">
                ID #{form.id}
              </span>
            )}
          </div>

          <FieldGroup label="Nombre del plan">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              className="input w-full"
              placeholder="Ej: Mensual clásica"
            />
          </FieldGroup>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldGroup label="Precio">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price_decimal}
                onChange={(e) => setForm((prev) => ({ ...prev, price_decimal: e.target.value }))}
                className="input w-full"
              />
            </FieldGroup>
            <FieldGroup label="Duración (meses)">
              <input
                type="number"
                min="1"
                value={form.duration_months}
                onChange={(e) => setForm((prev) => ({ ...prev, duration_months: e.target.value }))}
                className="input w-full"
              />
            </FieldGroup>
          </div>

          <div>
            <p className="text-xs uppercase text-foreground-muted tracking-wide mb-2">
              Límites (dejá vacío para ilimitado)
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldGroup label="Clases por semana">
                <input
                  type="number"
                  min="0"
                  value={form.max_classes_per_week}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, max_classes_per_week: e.target.value }))
                  }
                  className="input w-full"
                  placeholder="ej. 3"
                />
              </FieldGroup>
              <FieldGroup label="Clases por mes">
                <input
                  type="number"
                  min="0"
                  value={form.max_classes_per_month}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, max_classes_per_month: e.target.value }))
                  }
                  className="input w-full"
                  placeholder="ej. 12"
                />
              </FieldGroup>
              <FieldGroup label="Turnos activos simultáneos">
                <input
                  type="number"
                  min="0"
                  value={form.max_active_appointments}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, max_active_appointments: e.target.value }))
                  }
                  className="input w-full"
                  placeholder="ej. 4"
                />
              </FieldGroup>
            </div>
          </div>

  <div className="grid gap-3 sm:grid-cols-2">
          <FieldGroup label="Día de vencimiento" hint="Dejalo vacío para usar fecha de pago.">
            <input
              type="number"
              min="1"
              max="31"
              value={form.billing_day}
              onChange={(e) => setForm((prev) => ({ ...prev, billing_day: e.target.value }))}
              className="input w-full"
              placeholder="Ej: 10"
            />
          </FieldGroup>
          <FieldGroup label="Días de gracia">
            <input
              type="number"
              min="0"
              value={form.grace_days}
              onChange={(e) => setForm((prev) => ({ ...prev, grace_days: e.target.value }))}
              className="input w-full"
            />
          </FieldGroup>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldGroup label="Interés por mora">
            <select
              value={form.interest_type}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  interest_type: e.target.value,
                  interest_value: e.target.value === "none" ? 0 : prev.interest_value ?? 0,
                }))
              }
              className="input w-full"
            >
              <option value="none">Sin interés</option>
              <option value="fixed">Monto fijo</option>
              <option value="percent">Porcentaje</option>
            </select>
          </FieldGroup>
          {form.interest_type !== "none" && (
            <FieldGroup label={form.interest_type === "percent" ? "Porcentaje" : "Monto fijo"}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.interest_value}
                onChange={(e) => setForm((prev) => ({ ...prev, interest_value: e.target.value }))}
                className="input w-full"
                placeholder={form.interest_type === "percent" ? "Ej: 5" : "Ej: 1500"}
              />
            </FieldGroup>
          )}
        </div>

        <div className="border border-border rounded-xl p-3 space-y-3">
          <SwitchField
            label="Bloquear automáticamente al vencer"
            description="Si está activado, los clientes con cuota vencida no podrán reservar."
            checked={!!form.auto_block}
            onChange={(e) => setForm((prev) => ({ ...prev, auto_block: e.target.checked }))}
          />
          <SwitchField
            label="Plan activo"
            description="Los planes inactivos no se muestran en el alta de clientes."
            checked={!!form.is_active}
            disabled={!form.id}
            onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
          />
        </div>

        <FieldGroup label="Descripción (opcional)">
          <textarea
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            className="input w-full min-h-[90px]"
          />
        </FieldGroup>

        <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={handleNewPlan} disabled={saving}>
            Resetear
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Guardar plan
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  </div>
);
}

