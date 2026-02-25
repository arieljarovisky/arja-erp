import { useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Lock, CreditCard, AlertTriangle } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const TRIAL_DAYS = 14;

export default function TrialExpiredBlock({ children }) {
  const { tenant, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Calcular si el trial expiró (misma lógica que TrialWarning)
  const isTrialExpired = useMemo(() => {
    if (!tenant || tenant.status !== "trial" || !tenant.created_at) {
      return false;
    }

    const createdDate = new Date(tenant.created_at);
    const now = new Date();
    const trialEndDate = new Date(createdDate);
    trialEndDate.setDate(trialEndDate.getDate() + TRIAL_DAYS);

    return now > trialEndDate;
  }, [tenant]);

  const expired = isTrialExpired;

  // Permitir acceso a la página de configuración, planes y contacto para que puedan suscribirse o pedir ayuda
  const isConfigPage = location.pathname.includes("/admin/config");
  const isContactPage = location.pathname === "/contact" || location.pathname.includes("/contact");
  const isPlansPage = location.pathname.includes("/plans");

  if (!expired || isConfigPage || isContactPage || isPlansPage) {
    return <>{children}</>;
  }

  const tenantSlug = tenant?.slug || tenant?.subdomain;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        <div className="card p-8 text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
              <Lock className="w-10 h-10 text-red-600 dark:text-red-400" />
            </div>
          </div>

          <div>
            <h1 className="text-3xl font-bold text-foreground mb-3">
              Tu período de prueba ha finalizado
            </h1>
            <p className="text-lg text-foreground-secondary">
              Para continuar usando ARJA ERP, necesitás suscribirte a un plan.
            </p>
          </div>

          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
              <div className="text-left">
                <h3 className="font-semibold text-foreground mb-2">
                  Acceso limitado
                </h3>
                <p className="text-sm text-foreground-secondary">
                  Tu cuenta está activa pero las funcionalidades están bloqueadas hasta que actives tu suscripción.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <button
              onClick={() => {
                if (tenantSlug) {
                  navigate(`/${tenantSlug}/plans`);
                }
              }}
              className="w-full btn-primary py-4 flex items-center justify-center gap-2 text-lg"
            >
              <CreditCard className="w-5 h-5" />
              Ver planes y suscribirme
            </button>
            <button
              onClick={() => navigate("/")}
              className="w-full btn-ghost py-3"
            >
              Volver al inicio
            </button>
          </div>

          <div className="pt-4 border-t border-border">
            <p className="text-sm text-foreground-muted">
              ¿Necesitás ayuda?{" "}
              <a
                href="/contact"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/contact");
                }}
                className="text-primary hover:text-primary-hover font-medium"
              >
                Contactanos
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

