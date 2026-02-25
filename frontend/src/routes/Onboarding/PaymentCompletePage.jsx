import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { apiClient } from "../../api/client";
import ThemeToggle from "../../components/ThemeToggle";
import Logo from "../../components/Logo";
import { logger } from "../../utils/logger.js";

export default function PaymentCompletePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const sessionId =
    search.get("session") ||
    sessionStorage.getItem("onboardingSessionId") ||
    "";
  const tenantSlug =
    search.get("tenant") ||
    sessionStorage.getItem("onboardingTenantSlug") ||
    "";
  const successQuery = search.get("success");
  const errorQuery = search.get("error");

  const [status, setStatus] = useState({ loading: true, state: "pending" });

  useEffect(() => {
    if (sessionId) {
      sessionStorage.setItem("onboardingSessionId", sessionId);
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    const checkStatus = async () => {
      try {
        if (!sessionId) return;
        const resp = await apiClient.onboarding.subscriptionStatus(sessionId);
        if (cancelled) return;
        setStatus({ loading: false, state: resp?.status || "pending" });
        if (resp?.status === "authorized" && tenantSlug) {
          setTimeout(() => {
            navigate(`/${tenantSlug}/dashboard`, { replace: true });
          }, 2000);
        }
      } catch (err) {
        if (cancelled) return;
        logger.error("[ONBOARDING][PAYMENT_COMPLETE] status error", err);
        setStatus({ loading: false, state: "error" });
      }
    };
    checkStatus();
    return () => {
      cancelled = true;
    };
  }, [navigate, tenantSlug, sessionId]);

  const handleTryAgain = () => {
    if (tenantSlug) {
      navigate(`/onboarding/payment?tenant=${tenantSlug}${sessionId ? `&session=${sessionId}` : ""}`, {
        replace: true,
      });
    } else {
      navigate(`/onboarding/payment${sessionId ? `?session=${sessionId}` : ""}`, { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_0%_0%,#6366f122,transparent_55%)]" />
      <div className="relative z-10 max-w-3xl mx-auto px-4 py-10">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Logo size="small" showText />
            <span className="text-sm text-slate-300">
              Confirmación de método de pago
            </span>
          </div>
          <ThemeToggle />
        </header>

        <div className="rounded-3xl border border-slate-700/40 bg-slate-900/70 p-6 shadow-2xl backdrop-blur">
          {status.loading ? (
            <LoadingState />
          ) : status.state === "authorized" ? (
            <SuccessState tenantSlug={tenantSlug} />
          ) : (
            <ErrorState
              errorQuery={errorQuery}
              successQuery={successQuery}
              onTryAgain={handleTryAgain}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-10">
      <Loader2 className="w-10 h-10 animate-spin text-indigo-300" />
      <div>
        <h1 className="text-xl font-semibold text-slate-100">
          Confirmando la conexión con Mercado Pago...
        </h1>
        <p className="text-sm text-slate-400 mt-2">
          Esto puede demorar unos segundos. No cierres esta ventana.
        </p>
      </div>
    </div>
  );
}

function SuccessState({ tenantSlug }) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-10">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
        <ShieldCheck className="w-7 h-7" />
      </div>
      <div>
        <h1 className="text-xl font-semibold text-emerald-100">
          ¡Excelente! Mercado Pago quedó conectado.
        </h1>
        <p className="text-sm text-emerald-100/80 mt-2">
          Te llevamos automáticamente a tu panel para que empieces a configurar tu cuenta.
        </p>
      </div>
      <button
        onClick={() => navigateImmediately(tenantSlug)}
        className="mt-4 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-6 py-2 text-sm font-semibold hover:from-indigo-600 hover:to-fuchsia-600"
      >
        Ir ahora al dashboard
      </button>
    </div>
  );
}

function ErrorState({ errorQuery, successQuery, onTryAgain }) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-10">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20 text-red-300">
        <AlertTriangle className="w-7 h-7" />
      </div>
      <div>
        <h1 className="text-xl font-semibold text-red-100">
          Necesitamos completar la conexión
        </h1>
        <p className="text-sm text-red-100/80 mt-2 max-w-md">
          {errorQuery === "cancelled"
            ? "Cancelaste la autorización en Mercado Pago. Es necesario conectar tu cuenta para continuar."
            : successQuery
            ? "No pudimos confirmar la conexión. Intentá nuevamente."
            : "Parece que todavía no vinculaste Mercado Pago. Intentá nuevamente."}
        </p>
      </div>
      <button
        onClick={onTryAgain}
        className="mt-4 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-6 py-2 text-sm font-semibold hover:from-indigo-600 hover:to-fuchsia-600"
      >
        Reintentar conexión
      </button>
    </div>
  );
}

function navigateImmediately(slug) {
  if (slug) {
    window.location.replace(`/${slug}/dashboard`);
  } else {
    window.location.replace("/login");
  }
}

