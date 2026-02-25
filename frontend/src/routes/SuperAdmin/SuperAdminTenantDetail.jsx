import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  RefreshCw,
  Shield,
  Rocket,
  Power,
} from "lucide-react";
import { apiClient } from "../../api/client.js";

const FEATURE_KEYS = ["appointments", "stock", "invoicing", "classes", "multiBranch", "mobile_app"];
const FEATURE_LABELS = {
  appointments: "Turnos",
  stock: "Gestión de stock",
  invoicing: "Facturación",
  classes: "Clases grupales",
  multiBranch: "Operación multi-sucursal",
  mobile_app: "App móvil",
};

const BASE_FEATURE_DEFAULTS = {
  appointments: true,
  stock: false,
  invoicing: false,
  classes: false,
  multiBranch: false,
  mobile_app: false,
};

function formatDateTimeForInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function parseInputDateTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function createEmptyOverrides() {
  return FEATURE_KEYS.reduce((acc, key) => {
    acc[key] = null;
    return acc;
  }, {});
}

function parseFeatures(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed != null ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && raw != null) {
    return raw;
  }
  return {};
}

function normalizeFeatures(raw, fallback = BASE_FEATURE_DEFAULTS) {
  const parsed = parseFeatures(raw);
  const merged = { ...fallback, ...parsed };
  return FEATURE_KEYS.reduce((acc, key) => {
    acc[key] = Boolean(merged[key]);
    return acc;
  }, {});
}

function StatusBadge({ status }) {
  const label =
    status === "active"
      ? "Activo"
      : status === "trial"
      ? "Trial"
      : status === "paused"
      ? "Pausado"
      : status === "suspended"
      ? "Suspendido"
      : "Desconocido";

  const style =
    status === "active"
      ? "bg-emerald-500/20 text-emerald-500"
      : status === "trial"
      ? "bg-primary/20 text-primary"
      : status === "paused"
      ? "bg-amber-500/20 text-amber-500"
      : status === "suspended"
      ? "bg-red-500/20 text-red-500"
      : "bg-foreground-muted/20 text-foreground-secondary";

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${style}`}>
      <Shield className="w-3 h-3" />
      {label}
    </span>
  );
}

export default function SuperAdminTenantDetail() {
  const { tenantId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [businessTypes, setBusinessTypes] = useState([]);
  const [selectedType, setSelectedType] = useState("");
  const [featureOverrides, setFeatureOverrides] = useState(() => createEmptyOverrides());
  const [initialOverrides, setInitialOverrides] = useState(() => createEmptyOverrides());
  const [saving, setSaving] = useState(false);
  const [planCode, setPlanCode] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);
  const [hubData, setHubData] = useState(null);
  const [hubLoading, setHubLoading] = useState(true);
  const [hubError, setHubError] = useState("");
  const [hubSaving, setHubSaving] = useState(false);
  const [hubClearing, setHubClearing] = useState(false);
  const [hubForm, setHubForm] = useState({
    phoneNumberId: "",
    accessToken: "",
    verifyToken: "",
    refreshToken: "",
    tokenExpiresAt: "",
    isActive: true,
    managedNotes: "",
  });

  const loadDetail = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.superAdmin.getTenant(Number(tenantId));
      setDetail(response?.data || null);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "No se pudo cargar el tenant");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const loadHub = useCallback(async () => {
    if (!tenantId) return;
    setHubLoading(true);
    setHubError("");
    try {
      const response = await apiClient.superAdmin.getTenantWhatsApp(Number(tenantId));
      const hub = response?.data ?? null;
      setHubData(hub);
      setHubForm({
        phoneNumberId: hub?.phoneNumberId ?? "",
        accessToken: "",
        verifyToken: hub?.verifyToken ?? "",
        refreshToken: hub?.refreshToken ?? "",
        tokenExpiresAt: hub?.tokenExpiresAt ? formatDateTimeForInput(hub.tokenExpiresAt) : "",
        isActive: hub?.isActive ?? false,
        managedNotes: hub?.managedNotes ?? "",
      });
    } catch (err) {
      setHubError(err?.response?.data?.error || err?.message || "No se pudo cargar WhatsApp");
      setHubData(null);
      setHubForm({
        phoneNumberId: "",
        accessToken: "",
        verifyToken: "",
        refreshToken: "",
        tokenExpiresAt: "",
        isActive: true,
        managedNotes: "",
      });
    } finally {
      setHubLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    let mounted = true;
    apiClient.superAdmin
      .listBusinessTypes()
      .then((items) => mounted && setBusinessTypes(items))
      .catch(() => mounted && setBusinessTypes([]));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!detail) return;
    const initialType = detail?.business?.business_type_id || "";
    setSelectedType(initialType);
    setPlanCode(detail?.plan?.code || "");
    const parsed = parseFeatures(detail?.business?.features_config);
    const nextOverrides = createEmptyOverrides();
    FEATURE_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(parsed, key)) {
        nextOverrides[key] = Boolean(parsed[key]);
      }
    });
    setFeatureOverrides(nextOverrides);
    setInitialOverrides(nextOverrides);
  }, [detail]);

  useEffect(() => {
    loadHub();
  }, [loadHub]);

  const selectedTypeData = useMemo(
    () => businessTypes.find((bt) => bt.id === Number(selectedType)) || null,
    [businessTypes, selectedType]
  );

  const defaultFeatures = useMemo(
    () => normalizeFeatures(selectedTypeData?.features, BASE_FEATURE_DEFAULTS),
    [selectedTypeData]
  );

  const effectiveFeatures = useMemo(() => {
    const result = { ...defaultFeatures };
    FEATURE_KEYS.forEach((key) => {
      if (featureOverrides[key] !== null && featureOverrides[key] !== undefined) {
        result[key] = Boolean(featureOverrides[key]);
      }
    });
    return result;
  }, [defaultFeatures, featureOverrides]);

  const initialTypeId = detail?.business?.business_type_id || "";
  const typeChanged =
    selectedType !== "" && Number(selectedType) !== Number(initialTypeId || 0);

  const overridesChanged = FEATURE_KEYS.some(
    (key) => (featureOverrides[key] ?? null) !== (initialOverrides[key] ?? null)
  );

  const overridesToSend = useMemo(() => {
    const entries = Object.entries(featureOverrides).filter(([, value]) => value !== null);
    return Object.fromEntries(entries);
  }, [featureOverrides]);

  const hasChanges = typeChanged || overridesChanged;

  const handleSaveBusinessType = async () => {
    if (!selectedType) {
      toast.error("Seleccioná un tipo de negocio");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        tenant_id: Number(tenantId),
        business_type_id: Number(selectedType),
      };
      if (Object.keys(overridesToSend).length) {
        payload.features_config = overridesToSend;
      }
      await apiClient.put("/api/business-types/tenant/business-type", payload);
      toast.success("Tipo de negocio actualizado");
      await loadDetail();
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo guardar los cambios");
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreDefaults = () => {
    const reset = createEmptyOverrides();
    setFeatureOverrides(reset);
    toast.info("Se restauraron los valores predeterminados");
  };

  const handleUpdatePlan = async () => {
    if (!planCode) {
      toast.error("Seleccioná un plan antes de guardar");
      return;
    }
    setSavingPlan(true);
    try {
      await apiClient.superAdmin.updateTenantPlan(Number(tenantId), { plan_code: planCode });
      toast.success("Plan actualizado correctamente");
      await loadDetail();
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo actualizar el plan");
    } finally {
      setSavingPlan(false);
    }
  };

  const handleSaveHubCredentials = async () => {
    const phoneNumberId = hubForm.phoneNumberId.trim();
    const accessToken = hubForm.accessToken.trim();
    if (!phoneNumberId) {
      toast.error("Ingresá el Phone Number ID de Meta.");
      return;
    }
    setHubSaving(true);
    try {
      const payload = {
        phoneNumberId,
        verifyToken: hubForm.verifyToken.trim() || undefined,
        refreshToken: hubForm.refreshToken.trim() || undefined,
        tokenExpiresAt: parseInputDateTime(hubForm.tokenExpiresAt) || undefined,
        phoneDisplay: hubData?.phoneDisplay || undefined,
        isActive: !!hubForm.isActive,
        managedNotes: hubForm.managedNotes.trim() || undefined,
      };
      if (accessToken) {
        payload.accessToken = accessToken;
      } else if (!hubData?.hasCredentials) {
        toast.error("Ingresá el access token generado en Meta.");
        setHubSaving(false);
        return;
      }
      await apiClient.superAdmin.upsertTenantWhatsAppCredentials(Number(tenantId), payload);
      toast.success("Credenciales de WhatsApp guardadas");
      await loadHub();
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo guardar las credenciales");
    } finally {
      setHubSaving(false);
    }
  };

  const handleClearHubCredentials = async () => {
    if (!hubData) return;
    const confirmed = window.confirm(
      "¿Eliminar todas las credenciales del hub de WhatsApp? El asistente quedará inactivo."
    );
    if (!confirmed) return;
    setHubClearing(true);
    try {
      await apiClient.superAdmin.clearTenantWhatsAppCredentials(Number(tenantId));
      toast.success("Credenciales eliminadas");
      await loadHub();
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo eliminar las credenciales");
    } finally {
      setHubClearing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-background"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver
        </button>
        <h1 className="text-2xl font-semibold">Tenant #{tenantId}</h1>
      </div>

      {loading ? (
        <div className="card card--space-xl card--no-hover text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
          <p className="text-foreground-secondary mt-4">Cargando información…</p>
        </div>
      ) : error ? (
        <div className="card card--space-lg text-red-300 border-red-500/40 bg-red-500/5">{error}</div>
      ) : !detail ? (
        <div className="card card--space-lg text-foreground-secondary">No se encontró el tenant.</div>
      ) : (
        <>
          <section className="card card--space-lg space-y-3">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  {detail?.tenant?.name || detail?.tenant?.subdomain || `Tenant #${tenantId}`}
                </h2>
                <p className="text-sm text-foreground-secondary">
                  Subdominio: <span className="font-medium">{detail?.tenant?.subdomain || "No definido"}</span>
                </p>
              </div>
              <StatusBadge status={detail?.tenant?.status} />
            </header>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-foreground-secondary">
              <div>
                <dt>Creado</dt>
                <dd className="text-foreground">
                  {detail?.tenant?.created_at
                    ? new Date(detail.tenant.created_at).toLocaleString("es-AR")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Plan actual</dt>
                <dd className="text-foreground">{detail?.plan?.label || "Sin plan asignado"}</dd>
              </div>
            </dl>
          </section>

          <section className="card card--space-lg space-y-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-foreground">Tipo de negocio y módulos</h3>
                <p className="text-sm text-foreground-secondary">
                  Configurá el tipo de negocio y qué módulos están disponibles para este tenant.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRestoreDefaults}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-background"
                >
                  <RefreshCw className="w-4 h-4" />
                  Restaurar predeterminado
                </button>
                <button
                  type="button"
                  onClick={handleSaveBusinessType}
                  disabled={saving || !hasChanges}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-60"
                >
                  {saving ? "Guardando…" : "Guardar cambios"}
                </button>
              </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-3">
                <label className="label">Tipo de negocio</label>
                <select
                  className="input"
                  value={selectedType || ""}
                  onChange={(event) => setSelectedType(event.target.value ? Number(event.target.value) : "")}
                >
                  <option value="">Seleccioná una opción</option>
                  {businessTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="label">Módulos activos</label>
                <div className="grid grid-cols-2 gap-2">
                  {FEATURE_KEYS.map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="rounded border-border text-primary focus:ring-primary"
                        checked={effectiveFeatures[key]}
                        onChange={(event) => {
                          const nextValue = event.target.checked;
                          const defaultValue = defaultFeatures[key];
                          setFeatureOverrides((prev) => ({
                            ...prev,
                            [key]: nextValue === defaultValue ? null : nextValue,
                          }));
                        }}
                      />
                      {FEATURE_LABELS[key]}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-foreground-secondary">
                  Desmarca un módulo para deshabilitarlo para el tenant. Restaurar predeterminado vuelve a aplicar la
                  configuración base del tipo seleccionado.
                </p>
              </div>
            </div>
          </section>

          <section className="card card--space-lg space-y-4">
            <header className="flex items-center gap-2">
              <Rocket className="w-4 h-4 text-primary" />
              <div>
                <h3 className="text-base font-semibold text-foreground">Plan comercial</h3>
                <p className="text-sm text-foreground-secondary">
                  Cambiá el plan asignado al tenant y consulta los datos del ciclo actual.
                </p>
              </div>
            </header>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <label className="label">Plan vigente</label>
                <select className="input" value={planCode} onChange={(event) => setPlanCode(event.target.value)}>
                  <option value="">Seleccioná un plan…</option>
                  {(detail.availablePlans || []).map((plan) => (
                    <option key={plan.code} value={plan.code}>
                      {plan.label} — ${plan.amount} {plan.currency}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-foreground-secondary">
                  Plan actual: {detail.plan?.label || "Sin plan"} ({detail.plan?.status || "—"})
                </p>
                <button
                  type="button"
                  onClick={handleUpdatePlan}
                  disabled={savingPlan}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                >
                  {savingPlan ? "Guardando…" : "Actualizar plan"}
                </button>
              </div>
              {detail.plan ? (
                <div className="rounded-xl border border-border bg-background-secondary/40 p-4 text-sm text-foreground-secondary space-y-2">
                  <p>
                    Estado: <span className="text-foreground font-medium">{detail.plan.status || "—"}</span>
                  </p>
                  {detail.plan.activated_at ? (
                    <p>
                      Activado el{" "}
                      {new Date(detail.plan.activated_at).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </p>
                  ) : null}
                  <p>
                    Próximo cobro:{" "}
                    {detail.plan.next_charge_at
                      ? new Date(detail.plan.next_charge_at).toLocaleString("es-AR")
                      : "Sin fecha registrada"}
                  </p>
                  <p>Payer email: {detail.plan.payer_email || "—"}</p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="card card--space-lg space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                <h3 className="text-base font-semibold text-foreground">WhatsApp centralizado</h3>
              </div>
              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
                  hubData
                    ? hubData.hasCredentials
                      ? hubData.isActive
                        ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30"
                        : "bg-amber-500/15 text-amber-200 border border-amber-500/30"
                      : "bg-slate-500/15 text-slate-200 border border-slate-500/30"
                    : "bg-slate-500/15 text-slate-200 border border-slate-500/30"
                }`}
              >
                <Power className="w-3.5 h-3.5" />
                {hubData
                  ? hubData.hasCredentials
                    ? hubData.isActive
                      ? "Activo"
                      : "Configurado (pausado)"
                    : "Pendiente de credenciales"
                  : "Sin configurar"}
              </span>
            </div>

            {hubLoading ? (
              <div className="flex items-center gap-2 text-sm text-foreground-secondary">
                <div className="h-4 w-4 animate-spin rounded-full border border-primary border-t-transparent" />
                Cargando información del hub…
              </div>
            ) : hubError ? (
              <p className="text-sm text-red-400">{hubError}</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-foreground-muted">Número informado por el tenant</p>
                    <p className="font-medium text-foreground">{hubData?.phoneDisplay || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground-muted">Última actualización</p>
                    <p className="font-medium text-foreground">
                      {hubData?.updatedAt ? new Date(hubData.updatedAt).toLocaleString("es-AR") : "Sin credenciales"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground-muted">Asignado por</p>
                    <p className="font-medium text-foreground">{hubData?.managedBy || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground-muted">Estado actual</p>
                    <p className="font-medium text-foreground">
                      {hubData?.isActive ? "Activo" : "Inactivo / pendiente"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-sm text-foreground-secondary">
                    Phone Number ID (Meta)
                    <input
                      className="input mt-1"
                      value={hubForm.phoneNumberId}
                      onChange={(event) =>
                        setHubForm((prev) => ({ ...prev, phoneNumberId: event.target.value }))
                      }
                      placeholder="Ej: 1234567890"
                    />
                  </label>
                  <label className="block text-sm text-foreground-secondary">
                    Access Token (solo si se reemplaza)
                    <input
                      className="input mt-1"
                      value={hubForm.accessToken}
                      onChange={(event) => setHubForm((prev) => ({ ...prev, accessToken: event.target.value }))}
                      placeholder="EAA..."
                    />
                  </label>
                  <label className="block text-sm text-foreground-secondary">
                    Verify Token
                    <input
                      className="input mt-1"
                      value={hubForm.verifyToken}
                      onChange={(event) => setHubForm((prev) => ({ ...prev, verifyToken: event.target.value }))}
                    />
                  </label>
                  <label className="block text-sm text-foreground-secondary">
                    Refresh Token
                    <input
                      className="input mt-1"
                      value={hubForm.refreshToken}
                      onChange={(event) => setHubForm((prev) => ({ ...prev, refreshToken: event.target.value }))}
                    />
                  </label>
                  <label className="block text-sm text-foreground-secondary">
                    Expira el
                    <input
                      type="datetime-local"
                      className="input mt-1"
                      value={hubForm.tokenExpiresAt}
                      onChange={(event) =>
                        setHubForm((prev) => ({ ...prev, tokenExpiresAt: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-foreground-secondary">
                    Notas internas
                    <textarea
                      className="input mt-1 min-h-[110px] resize-none"
                      value={hubForm.managedNotes}
                      onChange={(event) => setHubForm((prev) => ({ ...prev, managedNotes: event.target.value }))}
                      placeholder="Notas internas sobre la línea o la configuración"
                    />
                  </label>
                </div>

                <label className="inline-flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="rounded border-border text-primary focus:ring-primary"
                    checked={hubForm.isActive}
                    onChange={(event) => setHubForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                  />
                  Marcar como activo
                </label>

                <div className="flex flex-col gap-3 md:flex-row md:justify-between">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleSaveHubCredentials}
                      disabled={hubSaving}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                    >
                      {hubSaving ? "Guardando…" : "Guardar credenciales"}
                    </button>
                    <button
                      type="button"
                      onClick={loadHub}
                      disabled={hubLoading}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
                    >
                      <RefreshCw className={`w-4 h-4 ${hubLoading ? "animate-spin" : ""}`} />
                      Recargar
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearHubCredentials}
                    disabled={!hubData || hubClearing}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-500 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-60"
                  >
                    {hubClearing ? "Eliminando…" : "Eliminar credenciales"}
                  </button>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

