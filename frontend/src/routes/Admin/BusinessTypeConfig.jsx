import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../../api";
import { toast } from "sonner";
import { Building2, CheckCircle, RotateCcw, ArrowUp, Sparkles } from "lucide-react";
import { useQuery } from "../../shared/useQuery.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useApp } from "../../context/UseApp.js";
import { useTranslation } from "../../i18n/useTranslation.js";

const FEATURE_KEYS = ["appointments", "classes", "stock", "invoicing"];
const FEATURE_LABELS = {
  appointments: "Turnos individuales",
  classes: "Turnos de clases",
  stock: "Gestión de stock",
  invoicing: "Facturación",
};
const FEATURE_DESCRIPTIONS = {
  appointments: "Gestión de turnos y citas individuales",
  classes: "Gestión de clases grupales y turnos de clases",
  stock: "Control de inventario y productos",
  invoicing: "Facturación electrónica con ARCA",
};
const BASE_FEATURE_DEFAULTS = {
  appointments: true,
  classes: true,
  stock: false,
  invoicing: false,
};

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

function diffFeatures(current, next, locks = {}) {
  return FEATURE_KEYS.map((key) => ({
    key,
    current: Boolean(current?.[key]),
    next: Boolean(next?.[key]),
    locked: Boolean(locks[key]),
    changed: Boolean(current?.[key]) !== Boolean(next?.[key]),
  }));
}

const FeatureToggle = ({ featureKey, checked, onChange, description, customized, locked }) => {
  return (
    <label
      className={`flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg bg-background-secondary ${
        locked ? "opacity-60 cursor-not-allowed" : "hover:bg-border cursor-pointer"
      } transition-colors`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(featureKey, event.target.checked)}
        className="w-4 h-4 rounded border-border text-primary focus:ring-primary flex-shrink-0"
        disabled={locked}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground text-sm sm:text-base">
            {FEATURE_LABELS[featureKey]}
          </span>
          {customized ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400 bg-amber-500/10 border border-amber-400/30 rounded-full px-2 py-0.5">
              Personalizado
            </span>
          ) : null}
          {locked ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-red-300 bg-red-500/10 border border-red-400/30 rounded-full px-2 py-0.5">
              No incluido en tu plan
            </span>
          ) : null}
        </div>
        <div className="text-xs text-foreground-secondary">{description}</div>
      </div>
    </label>
  );
};

const ConfirmDialog = ({ open, onCancel, onConfirm, typeChanged, fromType, toType, featureSummary }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-background border border-border shadow-2xl p-6 space-y-4">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-foreground">Confirmar cambios</h3>
          <p className="text-sm text-foreground-secondary">
            {typeChanged
              ? `Estás por cambiar el tipo de negocio de "${fromType || "Sin especificar"}" a "${toType}".`
              : "Estás por actualizar las funcionalidades habilitadas."}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-background-secondary/50 divide-y divide-border/60">
          <div className="px-4 py-3 text-sm font-medium text-foreground-secondary uppercase tracking-wide">
            Impacto en módulos
          </div>
          <ul className="px-4 py-2 text-sm space-y-2">
            {featureSummary.map(({ key, current, next, changed, locked }) => (
              <li key={key} className="flex items-center justify-between gap-4">
                <span className="text-foreground">{FEATURE_LABELS[key]}</span>
                {locked ? (
                  <span className="text-xs font-semibold uppercase tracking-wide text-red-300">
                    No disponible en tu plan
                  </span>
                ) : (
                  <span
                    className={`text-xs font-semibold uppercase tracking-wide ${
                      changed
                        ? next
                          ? "text-emerald-400"
                          : "text-rose-400"
                        : "text-foreground-muted"
                    }`}
                  >
                    {changed ? (next ? "Se habilitará" : "Se desactivará") : "Se mantiene"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {typeChanged ? (
          <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Cambiar el tipo de negocio reemplazará tus servicios actuales por los predeterminados del nuevo tipo.
            Guardá o exportá tus servicios si necesitás conservarlos.
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground-secondary hover:text-foreground hover:bg-background-secondary"
          >
            Revisar de nuevo
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90 transition"
          >
            Confirmar y guardar
          </button>
        </div>
      </div>
    </div>
  );
};

export default function BusinessTypeConfig() {
  const { user } = useAuth();
  const { refreshFeatures, tenantInfo } = useApp();
  const navigate = useNavigate();
  const { tenantSlug } = useParams();
  const canEditType = Boolean(user?.isSuperAdmin || user?.is_super_admin);
  const planLocks = useMemo(() => {
    const planFeatures = tenantInfo?.plan?.features || {};
    return FEATURE_KEYS.reduce((acc, key) => {
      if (planFeatures[key] === false) acc[key] = true;
      return acc;
    }, {});
  }, [tenantInfo?.plan?.features]);

  const { data: businessTypes = [], loading: loadingTypes } = useQuery(
    async () => {
      const response = await apiClient.get("/api/business-types");
      return response.data?.data || [];
    },
    []
  );

  // Planes de suscripción de la plataforma (definidos en el backend)
  const PLATFORM_PLANS = [
    {
      code: "starter",
      label: "Starter Plan",
      description: "Ideal to start with up to 2 professionals",
      features: {
        appointments: true,
        classes: true,
        stock: false,
        invoicing: false,
        multiBranch: false,
        maxBranches: 1,
      },
    },
    {
      code: "growth",
      label: "Growth Plan",
      description: "Expanding businesses, up to 8 professionals",
      features: {
        appointments: true,
        classes: true,
        stock: true,
        invoicing: false,
        multiBranch: false,
        maxBranches: 1,
      },
    },
    {
      code: "scale",
      label: "Scale Plan",
      description: "Operations with multiple branches (up to 2 locations)",
      features: {
        appointments: true,
        classes: true,
        stock: true,
        invoicing: true,
        multiBranch: true,
        maxBranches: 2,
      },
    },
    {
      code: "pro",
      label: "Custom Pro Plan",
      description: "Large companies with unlimited branches",
      features: {
        appointments: true,
        classes: true,
        stock: true,
        invoicing: true,
        multiBranch: true,
        maxBranches: null,
      },
    },
  ];

  const availablePlans = PLATFORM_PLANS;
  const loadingPlans = false;

  const { data: currentBusinessType, loading: loadingCurrent, refetch } = useQuery(
    async () => {
      const response = await apiClient.get("/api/business-types/tenant/business-type");
      return response.data?.data || null;
    },
    []
  );

  const [selectedType, setSelectedType] = useState(null);
  const [featuresConfig, setFeaturesConfig] = useState(BASE_FEATURE_DEFAULTS);
  const [currentFeatures, setCurrentFeatures] = useState(BASE_FEATURE_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const selectedTypeData = useMemo(
    () => (businessTypes || []).find((bt) => bt.id === selectedType) || null,
    [businessTypes, selectedType]
  );
  const currentTypeData = useMemo(
    () =>
      (businessTypes || []).find((bt) => bt.id === currentBusinessType?.business_type_id) || null,
    [businessTypes, currentBusinessType?.business_type_id]
  );
  const selectedTypeDefaults = useMemo(
    () => normalizeFeatures(selectedTypeData?.features, BASE_FEATURE_DEFAULTS),
    [selectedTypeData]
  );
  const typeChanged =
    canEditType && selectedType != null && selectedType !== (currentBusinessType?.business_type_id ?? null);

  const applyPlanLocks = useCallback(
    (config) =>
      FEATURE_KEYS.reduce((acc, key) => {
        acc[key] = planLocks[key] ? false : Boolean(config[key]);
        return acc;
      }, {}),
    [planLocks]
  );

  useEffect(() => {
    if (!loadingTypes && !loadingCurrent && currentBusinessType) {
      const typeId = currentBusinessType.business_type_id;
      setSelectedType(typeId);

      const typeDefaults = normalizeFeatures(
        (businessTypes || []).find((t) => t.id === typeId)?.features,
        BASE_FEATURE_DEFAULTS
      );
      const persisted = normalizeFeatures(
        currentBusinessType.features_config ?? currentBusinessType.features,
        { ...BASE_FEATURE_DEFAULTS, ...typeDefaults }
      );
      const locked = applyPlanLocks(persisted);
      setFeaturesConfig(locked);
      setCurrentFeatures(locked);
    }
  }, [businessTypes, currentBusinessType, loadingCurrent, loadingTypes, applyPlanLocks]);

  const handleSelectType = (type) => {
    if (!type) return;
    if (!canEditType && type.id !== (currentBusinessType?.business_type_id ?? null)) {
      toast.info("Contactá al dueño del sistema para cambiar el tipo de negocio y actualizar tu plan.");
      return;
    }
    setSelectedType(type.id);
    const defaults = normalizeFeatures(type.features, BASE_FEATURE_DEFAULTS);
    setFeaturesConfig((prev) => (type.id === selectedType ? prev : applyPlanLocks(defaults)));
  };

  const handleToggleFeature = (key, value) => {
    if (planLocks[key]) {
      toast.info("Necesitás un plan superior para habilitar esta funcionalidad.");
      return;
    }
    setFeaturesConfig((prev) => ({ ...prev, [key]: Boolean(value) }));
  };

  const handleRestoreDefaults = () => {
    setFeaturesConfig(applyPlanLocks(selectedTypeDefaults));
    toast.info("Se restauraron las funcionalidades por defecto del tipo seleccionado.");
  };

  const featureChanges = useMemo(
    () => diffFeatures(currentFeatures, featuresConfig, planLocks),
    [currentFeatures, featuresConfig, planLocks]
  );
  const hasFeatureChanges = featureChanges.some((change) => change.changed && !change.locked);
  const hasUnsavedChanges = typeChanged || (canEditType && hasFeatureChanges);
  const customizedKeys = useMemo(
    () =>
      FEATURE_KEYS.filter(
        (key) =>
          !planLocks[key] &&
          Boolean(featuresConfig[key]) !== Boolean(selectedTypeDefaults[key])
      ),
    [featuresConfig, selectedTypeDefaults, planLocks]
  );
  const pendingChangeLabels = useMemo(() => {
    const labels = [];
    if (typeChanged) labels.push("tipo de negocio");
    if (canEditType && hasFeatureChanges) labels.push("funcionalidades");
    return labels;
  }, [typeChanged, hasFeatureChanges, canEditType]);

  const handleOpenConfirm = () => {
    if (!canEditType) {
      toast.info("Contactá al dueño del sistema para gestionar estos cambios.");
      return;
    }
    if (!selectedType) {
      toast.error("Seleccioná un tipo de negocio");
      return;
    }
    if (!hasUnsavedChanges) {
      toast.info("No hay cambios para guardar.");
      return;
    }
    setShowConfirm(true);
  };

  const performSave = async () => {
    setSaving(true);
    try {
      await apiClient.put("/api/business-types/tenant/business-type", {
        business_type_id: canEditType
          ? selectedType
          : currentBusinessType?.business_type_id ?? selectedType,
        features_config: applyPlanLocks(featuresConfig),
      });

      toast.success(
        typeChanged
          ? `Tipo de negocio actualizado a ${selectedTypeData?.name || "nuevo tipo"}.`
          : "Funcionalidades actualizadas correctamente."
      );

      const lockedConfig = applyPlanLocks(featuresConfig);
      setFeaturesConfig(lockedConfig);
      setCurrentFeatures(lockedConfig);
      setShowConfirm(false);
      if (refetch) refetch();
      if (refreshFeatures) {
        refreshFeatures();
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || "No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  };

  const planFeatureList = useMemo(
    () =>
      FEATURE_KEYS.map((key) => ({
        key,
        label: FEATURE_LABELS[key],
        enabled: Boolean(featuresConfig[key]),
        locked: planLocks[key],
      })),
    [featuresConfig, planLocks]
  );
  const hasLockedFeatures = useMemo(
    () => planFeatureList.some((feature) => feature.locked),
    [planFeatureList]
  );

  const handleRequestUpgrade = (planCode) => {
    toast.info("Contactá al dueño del sistema o escribinos a ventas@arjaerp.com para cambiar tu plan.");
  };

  // Determinar plan actual y planes de upgrade
  const currentPlanCode = tenantInfo?.plan?.code || "starter";
  const currentPlan = useMemo(() => {
    return availablePlans.find((p) => p.code === currentPlanCode) || {
      code: currentPlanCode,
      label: tenantInfo?.plan?.label || "Plan Starter",
      features: tenantInfo?.plan?.features || {},
    };
  }, [availablePlans, currentPlanCode, tenantInfo?.plan]);

  // Orden de planes para determinar upgrades
  const PLAN_ORDER = ["starter", "growth", "scale", "pro"];
  const currentPlanIndex = PLAN_ORDER.indexOf(currentPlanCode);
  
  const upgradePlans = useMemo(() => {
    if (currentPlanIndex === -1 || currentPlanIndex === PLAN_ORDER.length - 1) {
      return []; // No hay upgrades disponibles
    }
    return availablePlans.filter((plan) => {
      const planIndex = PLAN_ORDER.indexOf(plan.code);
      return planIndex > currentPlanIndex && planIndex !== -1;
    });
  }, [availablePlans, currentPlanIndex]);

  // Calcular funcionalidades adicionales que se agregarían con cada upgrade
  const getAdditionalFeatures = useCallback((upgradePlan) => {
    const currentFeatures = currentPlan.features || {};
    const upgradeFeatures = upgradePlan.features || {};
    return FEATURE_KEYS.filter((key) => {
      return !currentFeatures[key] && upgradeFeatures[key];
    });
  }, [currentPlan]);

  const { t } = useTranslation();

  if (loadingTypes || loadingCurrent || loadingPlans) {
    return (
      <div className="card card--space-xl card--no-hover text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
        <p className="text-foreground-secondary mt-4">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-2">{t("businessType.planFeaturesTitle")}</h3>
        <p className="text-sm text-foreground-secondary">
          {t("businessType.planFeaturesDescription")}
        </p>
      </div>

      {/* Plan Actual */}
      <div className="card p-4 sm:p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </div>
            <div>
              <h4 className="font-semibold text-foreground text-base sm:text-lg">
                {currentPlan.label || "Current Plan"}
              </h4>
              <p className="text-xs text-foreground-muted mt-0.5">{t("businessType.currentPlanHint")}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          {FEATURE_KEYS.map((key) => {
            const isEnabled = Boolean(currentPlan.features?.[key]);
            return (
              <div
                key={key}
                className={`rounded-lg border px-4 py-3 text-left ${
                  isEnabled
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-border bg-background-secondary opacity-60"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {isEnabled ? (
                    <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-foreground-muted flex-shrink-0" />
                  )}
                  <div className="font-semibold text-sm text-foreground">{t(`businessType.features.${key}`)}</div>
                </div>
                <div className="text-xs text-foreground-secondary mt-1">
                  {isEnabled ? t("businessType.available") : t("businessType.notIncluded")}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Planes de Upgrade */}
      {upgradePlans.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-primary" />
            <h4 className="text-base font-semibold text-foreground">{t("businessType.upgradePlansTitle")}</h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {upgradePlans.map((plan) => {
              const additionalFeatures = getAdditionalFeatures(plan);
              return (
                <div
                  key={plan.code}
                  className="card p-4 sm:p-6 text-left border-2 border-primary/30 hover:border-primary/50 transition-all"
                >
                  <div className="flex items-start justify-between mb-2 sm:mb-3">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <ArrowUp className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-semibold text-foreground text-sm sm:text-base truncate">
                          {plan.label || plan.name || plan.code}
                        </h4>
                        {plan.description && (
                          <p className="text-xs text-foreground-muted mt-0.5 line-clamp-2">
                            {plan.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {additionalFeatures.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-xs font-medium text-foreground-secondary mb-2">
                        {t("businessType.additionalFeaturesTitle")}
                      </p>
                      <div className="text-xs text-foreground-muted space-y-1">
                        {additionalFeatures.map((key) => (
                          <div key={key} className="flex items-center gap-1.5">
                            <ArrowUp className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                            <span>{t(`businessType.features.${key}`)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 pt-3 border-t border-border">
                    <div className="text-xs text-foreground-muted space-y-0.5">
                      {FEATURE_KEYS.map((key) => {
                        const isEnabled = Boolean(plan.features?.[key]);
                        return isEnabled ? (
                          <div key={key} className="flex items-center gap-1.5">
                            <CheckCircle className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                            <span>{t(`businessType.features.${key}`)}</span>
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>

                  {plan.code === "pro" ? (
                    <button
                      type="button"
                      onClick={() => {
                        navigate(`/${tenantSlug}/feature-request?plan=${plan.code}`);
                      }}
                      className="mt-4 w-full btn-primary text-sm"
                    >
                      {t("businessType.contactSales")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        navigate(`/${tenantSlug}/feature-request?plan=${plan.code}`);
                      }}
                      className="mt-4 w-full btn-primary text-sm"
                    >
                      {t("businessType.requestUpgrade")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {upgradePlans.length === 0 && (
        <div className="card p-4 sm:p-6 text-center">
          <p className="text-sm text-foreground-secondary">
            {t("businessType.maxPlanMessage")}
          </p>
        </div>
      )}


    </div>
  );
}
