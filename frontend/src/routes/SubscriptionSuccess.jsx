import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import Logo from "../components/Logo";
import { apiClient } from "../api/client";

export default function SubscriptionSuccess() {
  const navigate = useNavigate();
  const { tenantSlug } = useParams();
  const [searchParams] = useSearchParams();
  const [countdown, setCountdown] = useState(10);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkingCount, setCheckingCount] = useState(0);
  const maxChecks = 10; // Intentar verificar hasta 10 veces (10 segundos)

  // Verificar el estado del pago desde los query params
  const status = searchParams.get("status");
  const preapprovalId = searchParams.get("preapproval_id");

  // Función para obtener la suscripción del cliente
  const fetchSubscription = async () => {
    try {
      const subscriptionData = await apiClient.getMyMembership();
      if (subscriptionData) {
        setSubscription(subscriptionData);
        setLoading(false);
        return subscriptionData;
      }
      return null;
    } catch (error) {
      console.error("Error obteniendo suscripción:", error);
      // Si no hay suscripción, no es un error crítico
      setLoading(false);
      return null;
    }
  };

  useEffect(() => {
    // Si el estado no es autorizado, redirigir a la página de fallo
    if (status && status !== "authorized" && status !== "approved" && status !== "pending") {
      navigate(`/${tenantSlug || ""}/subscription/failure?status=${status}`);
      return;
    }

    // Verificar la suscripción inmediatamente
    fetchSubscription();

    // Si el estado es pending, verificar periódicamente hasta que se active
    // (el webhook puede tardar unos segundos en procesar)
    if (status === "pending" || !status) {
      const checkInterval = setInterval(async () => {
        setCheckingCount((prev) => {
          if (prev >= maxChecks) {
            clearInterval(checkInterval);
            setLoading(false);
            return prev;
          }
          
          fetchSubscription().then((sub) => {
            // Si encontramos una suscripción activa, detener las verificaciones
            if (sub && sub.status === "authorized") {
              clearInterval(checkInterval);
              setLoading(false);
            }
          });
          
          return prev + 1;
        });
      }, 1000); // Verificar cada segundo

      return () => clearInterval(checkInterval);
    } else {
      setLoading(false);
    }
  }, [navigate, tenantSlug, status]);

  useEffect(() => {
    // Redirigir automáticamente después de 10 segundos solo si el pago fue exitoso
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          if (tenantSlug) {
            navigate(`/${tenantSlug}/dashboard`);
          } else {
            navigate("/");
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [navigate, tenantSlug]);

  const handleGoToDashboard = () => {
    if (tenantSlug) {
      navigate(`/${tenantSlug}/dashboard`);
    } else {
      navigate("/");
    }
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
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-green-600 dark:text-green-400" />
            </div>
          </div>

          <div>
            <h1 className="text-3xl font-bold text-foreground mb-3">
              ¡Pago realizado correctamente!
            </h1>
            {loading ? (
              <div className="flex items-center justify-center gap-2 text-foreground-secondary">
                <Loader2 className="w-5 h-5 animate-spin" />
                <p className="text-lg">Verificando tu suscripción...</p>
              </div>
            ) : subscription && subscription.status === "authorized" ? (
              <div className="space-y-3">
                <p className="text-lg text-foreground-secondary">
                  Tu suscripción ha sido activada exitosamente.
                </p>
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 text-left">
                  <h3 className="font-semibold text-foreground mb-2">Detalles de tu suscripción:</h3>
                  <div className="space-y-1 text-sm">
                    <p className="text-foreground-secondary">
                      <span className="font-medium">Plan:</span> {subscription.plan_name}
                    </p>
                    <p className="text-foreground-secondary">
                      <span className="font-medium">Estado:</span>{" "}
                      <span className="text-green-600 dark:text-green-400 font-semibold">Activa</span>
                    </p>
                    {subscription.last_payment_at && (
                      <p className="text-foreground-secondary">
                        <span className="font-medium">Último pago:</span>{" "}
                        {new Date(subscription.last_payment_at).toLocaleDateString("es-AR", {
                          day: "numeric",
                          month: "long",
                          year: "numeric"
                        })}
                      </p>
                    )}
                    {subscription.next_charge_at && (
                      <p className="text-foreground-secondary">
                        <span className="font-medium">Próxima renovación:</span>{" "}
                        {new Date(subscription.next_charge_at).toLocaleDateString("es-AR", {
                          day: "numeric",
                          month: "long",
                          year: "numeric"
                        })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-lg text-foreground-secondary">
                Tu suscripción está siendo procesada. Podés cerrar esta ventana y te notificaremos cuando esté activa.
              </p>
            )}
          </div>

          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <p className="text-sm text-foreground-secondary">
              {subscription && subscription.status === "authorized" 
                ? "Ya podés usar todas las funcionalidades de ARJA ERP. Serás redirigido al dashboard en " + countdown + " segundos..."
                : "Serás redirigido al dashboard en " + countdown + " segundos..."}
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleGoToDashboard}
              className="w-full btn-primary py-3 flex items-center justify-center gap-2"
            >
              Ir al dashboard ahora
            </button>
            <button
              onClick={() => navigate(`/${tenantSlug || ""}/plans`)}
              className="w-full btn-ghost py-2 text-sm"
            >
              Ver detalles de mi plan
            </button>
          </div>

          <div className="pt-4 border-t border-border">
            <Logo size="small" showText />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

