import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Calendar } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const TRIAL_DAYS = 14;

export default function TrialWarning() {
  const { tenant, user } = useAuth();
  const navigate = useNavigate();

  // Calcular días restantes basado en created_at del tenant
  const daysRemaining = useMemo(() => {
    if (!tenant || tenant.status !== "trial" || !tenant.created_at) {
      return null;
    }

    const createdDate = new Date(tenant.created_at);
    const now = new Date();
    const trialEndDate = new Date(createdDate);
    trialEndDate.setDate(trialEndDate.getDate() + TRIAL_DAYS);
    
    const diffTime = trialEndDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays > 0 ? diffDays : 0;
  }, [tenant]);

  // No mostrar si no está en trial o no hay información del tenant
  if (!tenant || tenant.status !== "trial" || daysRemaining === null) {
    return null;
  }

  const isExpiringSoon = daysRemaining <= 3;
  const isExpired = daysRemaining <= 0;

  return (
    <div
      className={`sticky top-0 z-50 ${
        isExpired
          ? "bg-gradient-to-r from-red-600 to-red-700"
          : isExpiringSoon
          ? "bg-gradient-to-r from-orange-500 to-orange-600"
          : "bg-gradient-to-r from-primary to-primary-hover"
      } text-white shadow-lg`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <div className="flex items-center gap-2 flex-wrap">
              {isExpired ? (
                <span className="font-semibold">
                  Tu período de prueba ha finalizado
                </span>
              ) : (
                <>
                  <span className="font-semibold">
                    Período de prueba activo
                  </span>
                  <span className="hidden sm:inline">•</span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {daysRemaining === 1
                      ? "Te queda 1 día"
                      : `Te quedan ${daysRemaining} días`}
                  </span>
                </>
              )}
              <span className="text-sm opacity-90">
                {isExpired
                  ? "Suscribite para continuar usando ARJA ERP"
                  : "Suscribite antes de que termine para no perder acceso"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const tenantSlug = tenant?.slug || tenant?.subdomain;
                if (tenantSlug) {
                  navigate(`/${tenantSlug}/plans`);
                }
              }}
              className="px-4 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold transition-colors backdrop-blur-sm"
            >
              Ver planes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

