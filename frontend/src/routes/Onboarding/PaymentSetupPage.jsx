import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, CreditCard, ShieldCheck } from "lucide-react";
import { apiClient } from "../../api/client";
import ThemeToggle from "../../components/ThemeToggle";
import Logo from "../../components/Logo";
import { useAuth } from "../../context/AuthContext";
import { logger } from "../../utils/logger.js";

const PLAN_DETAILS = {
  starter: { code: "starter", label: "Plan Starter", currency: "ARS", amount: 9999 },
  growth: { code: "growth", label: "Plan Growth", currency: "ARS", amount: 19999 },
  scale: { code: "scale", label: "Plan Escala", currency: "ARS", amount: 44900 },
  pro: { code: "pro", label: "Plan Pro a Medida", currency: "ARS", amount: 0 },
};

function formatPrice(amount, currency = "ARS") {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export default function PaymentSetupPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, tenant } = useAuth();
  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const sessionId =
    search.get("session") ||
    sessionStorage.getItem("onboardingSessionId") ||
    "";

  const tenantSlug =
    search.get("tenant") ||
    tenant?.slug ||
    tenant?.subdomain ||
    sessionStorage.getItem("onboardingTenantSlug") ||
    "";

  const [status, setStatus] = useState({
    loading: true,
    state: "pending",
    mpStatus: null,
  });
  const [plan, setPlan] = useState(() => {
    const stored = sessionStorage.getItem("onboardingSessionPlan");
    if (!stored) return null;
    const preset = PLAN_DETAILS[stored];
    return preset || { code: stored, label: stored };
  });
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      navigate("/onboarding", { replace: true });
    } else {
      sessionStorage.setItem("onboardingSessionId", sessionId);
    }
  }, [sessionId, navigate]);

  useEffect(() => {
    if (tenantSlug) {
      sessionStorage.setItem("onboardingTenantSlug", tenantSlug);
    }
  }, [tenantSlug]);

  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        if (!sessionId) return;
        const resp = await apiClient.onboarding.subscriptionStatus(sessionId);
        if (cancelled) return;
        setStatus({
          loading: false,
          state: resp?.status || "pending",
          mpStatus: resp?.mpStatus || null,
        });
        if (resp?.plan?.label) {
          setPlan({
            code: resp.plan.code,
            label: resp.plan.label,
            amount: resp.plan.amount,
            currency: resp.plan.currency,
          });
          sessionStorage.setItem(
            "onboardingSessionPlan",
            resp.plan.code || resp.plan.label || ""
          );
        }
        if (resp?.status === "authorized" && tenantSlug) {
          setTimeout(() => {
            navigate(`/${tenantSlug}/dashboard`, { replace: true });
          }, 1800);
        }
      } catch (err) {
        if (cancelled) return;
        logger.error("[ONBOARDING][PAYMENT] status error", err);
        setStatus({ loading: false, state: "error", mpStatus: null });
      }
    };
    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, [navigate, tenantSlug, sessionId]);

  const handleConnect = async () => {
    setError("");
    setConnecting(true);
    try {
      if (!sessionId) {
        throw new Error("Sesión inválida. Volvé a comenzar el registro.");
      }
      const response = await apiClient.onboarding.createSubscription(sessionId);
      if (response?.plan?.label) {
        sessionStorage.setItem(
          "onboardingSessionPlan",
          response.plan.code || response.plan.label
        );
        setPlan(response.plan);
      }
      if (response?.init_point) {
        window.location.href = response.init_point;
      } else {
        throw new Error("No se recibió el enlace de pago.");
      }
    } catch (err) {
      logger.error("[ONBOARDING][PAYMENT] connect error", err);
      setError(
        err.response?.data?.error ||
          err.message ||
          "No pudimos generar el enlace de Mercado Pago. Intentá nuevamente."
      );
      setConnecting(false);
    }
  };

  return (
    <div className="min-h-screen  from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_0%_0%,#6366f122,transparent_55%)]" />
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-10">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            {tenant?.logo_url && !logoError ? (
              <img 
                src={tenant.logo_url} 
                alt={tenant?.name || "Logo"} 
                className="w-9 h-9 object-contain rounded-lg"
                onError={() => setLogoError(true)}
              />
            ) : (
              <Logo size="small" showText />
            )}
            <span className="text-sm text-slate-300">
              Paso final: Configurá tu método de cobro
            </span>
          </div>
          <ThemeToggle />
        </header>

        <div className="rounded-3xl border border-slate-700/40 bg-slate-900/70 p-6 shadow-2xl backdrop-blur">
          <div className="flex flex-col gap-6">
            <div className="rounded-2xl border border-indigo-500/50 bg-indigo-500/10 p-5 flex gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-200">
                <CreditCard className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-indigo-100">
                  Conectá Mercado Pago para empezar a cobrar
                </h1>
                <p className="text-sm text-indigo-100/80 mt-1">
                  Necesitamos vincular tu cuenta de Mercado Pago para habilitar los pagos y señas
                  en tu nuevo sistema. Esta acción es obligatoria para continuar.
                </p>
              </div>
            </div>

            {status.loading ? (
              <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-6 flex items-center gap-3 text-slate-300">
                <Loader2 className="w-5 h-5 animate-spin" />
                Preparando suscripción...
              </div>
            ) : status.state === "authorized" ? (
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 flex items-center gap-3 text-emerald-200">
                <ShieldCheck className="w-6 h-6" />
                ¡Listo! Pago recurrente activado. Te llevamos a tu panel...
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-6 space-y-3">
                {plan && (
                  <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 text-sm text-indigo-100">
                    <div className="font-semibold text-indigo-200">
                      Plan seleccionado: {plan.label || plan.code}
                    </div>
                    {plan.amount && (
                      <div className="mt-1 text-indigo-100/80">
                        {formatPrice(plan.amount, plan.currency)} / mes
                      </div>
                    )}
                    <p className="mt-2 text-indigo-100/70">
                      Este monto se cobrará automáticamente cada mes mediante Mercado Pago.
                    </p>
                  </div>
                )}
                  <h2 className="text-lg font-semibold text-slate-100">
                    Pasos rápidos:
                  </h2>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-slate-300">
                    <li>Presioná el botón “Suscribirme ahora”.</li>
                    <li>Ingresá con la cuenta de Mercado Pago con la que vas a abonar ARJA ERP.</li>
                    <li>Confirmá la suscripción mensual del plan seleccionado.</li>
                    <li>Al finalizar te devolvemos a esta pantalla y activamos tu sistema.</li>
                  </ol>
                </div>

                {error && (
                  <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
                    {error}
                  </div>
                )}

                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold transition hover:from-indigo-600 hover:to-fuchsia-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {connecting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Redirigiendo a Mercado Pago...
                    </>
                  ) : (
                    <>
                      Suscribirme ahora
                      <ArrowRightIcon />
                    </>
                  )}
                </button>
              </>
            )}

            <div className="text-xs text-slate-500">
              Cuenta creada para:{" "}
              <span className="text-slate-300 font-medium">
                {user?.email || user?.name || "tu correo"}
              </span>{" "}
              • Sucursal:{" "}
              <span className="text-slate-300 font-medium">
                {tenant?.name || tenantSlug || "nueva"}
              </span>
              {plan && (
                <>
                  {" "}
                  • Plan:{" "}
                  <span className="text-slate-300 font-medium">
                    {plan.label || plan.code}
                    {plan.amount
                      ? ` — ${formatPrice(plan.amount, plan.currency)} / mes`
                      : ""}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ArrowRightIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
    </svg>
  );
}

