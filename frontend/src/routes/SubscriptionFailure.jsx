import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { XCircle, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import Logo from "../components/Logo";

export default function SubscriptionFailure() {
  const navigate = useNavigate();
  const { tenantSlug } = useParams();
  const [searchParams] = useSearchParams();

  const status = searchParams.get("status") || "rejected";
  const reason = searchParams.get("reason") || "";

  const getErrorMessage = () => {
    if (reason) {
      // Si el error menciona email, mostrar mensaje más específico
      if (reason.toLowerCase().includes("email") || reason.toLowerCase().includes("e-mail")) {
        return "Tu email no coincide con el de la suscripción. Necesitás crear una nueva suscripción con el email correcto.";
      }
      return reason;
    }
    if (status === "cancelled") return "Cancelaste el proceso de pago.";
    if (status === "rejected") return "El pago fue rechazado. Verificá los datos de tu tarjeta.";
    return "No pudimos procesar tu pago. Por favor, intentá nuevamente.";
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full"
      >
        <div className="card p-8 text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
              <XCircle className="w-12 h-12 text-red-600 dark:text-red-400" />
            </div>
          </div>

          <div>
            <h1 className="text-3xl font-bold text-foreground mb-3">
              Pago no procesado
            </h1>
            <p className="text-lg text-foreground-secondary">
              {getErrorMessage()}
            </p>
          </div>

          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
              <div className="text-left space-y-2">
                <p className="text-sm text-foreground-secondary">
                  No te preocupes, tu cuenta sigue activa. Podés intentar suscribirte nuevamente cuando quieras.
                </p>
                {(reason?.toLowerCase().includes("email") || reason?.toLowerCase().includes("e-mail") || 
                  getErrorMessage().toLowerCase().includes("email")) && (
                  <div className="mt-3 pt-3 border-t border-orange-200 dark:border-orange-700">
                    <p className="text-sm font-semibold text-foreground mb-1">
                      💡 Solución para error de email:
                    </p>
                    <p className="text-xs text-foreground-secondary">
                      Al crear una nueva suscripción, asegurate de usar el <strong>mismo email</strong> que tenés registrado en tu cuenta de Mercado Pago. El email que ingreses debe coincidir exactamente con el de tu cuenta.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => navigate(`/${tenantSlug || ""}/plans`)}
              className="w-full btn-primary py-3 flex items-center justify-center gap-2"
            >
              Intentar nuevamente
            </button>
            <button
              onClick={() => {
                if (tenantSlug) {
                  navigate(`/${tenantSlug}/dashboard`);
                } else {
                  navigate("/");
                }
              }}
              className="w-full btn-ghost py-2 text-sm"
            >
              Volver al dashboard
            </button>
          </div>

          <div className="pt-4 border-t border-border">
            <p className="text-sm text-foreground-muted mb-2">
              ¿Necesitás ayuda?{" "}
              <button
                onClick={() => navigate("/contact")}
                className="text-primary hover:text-primary-hover font-medium"
              >
                Contactanos
              </button>
            </p>
            <Logo size="small" showText />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

