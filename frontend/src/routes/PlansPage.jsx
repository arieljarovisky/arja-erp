import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, CreditCard, Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiClient } from "../api/client";
import { toast } from "sonner";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import { logger } from "../utils/logger.js";

const PLANS = [
  {
    code: "esencial",
    name: "Esencial",
    price: 14900,
    period: "mes",
    description: "Para salones que están comenzando",
    features: [
      "Hasta 2 profesionales",
      "Agenda inteligente de turnos",
      "Recordatorios automáticos",
      "Clientes ilimitados",
      "Reportes básicos"
    ],
    popular: false
  },
  {
    code: "crecimiento",
    name: "Crecimiento",
    price: 24900,
    period: "mes",
    description: "Ideal para equipos en expansión",
    features: [
      "Hasta 6 profesionales",
      "Pagos y señas con Mercado Pago",
      "WhatsApp Bot para reservas",
      "Control de stock y comisiones",
      "Tableros y reportes pro",
      "Soporte prioritario"
    ],
    popular: true
  },
  {
    code: "escala",
    name: "Escala",
    price: 44900,
    period: "mes",
    description: "Operaciones con varias sucursales",
    features: [
      "Profesionales ilimitados",
      "Hasta 2 sucursales operando en simultáneo",
      "Multi-sucursal con roles avanzados",
      "Automatizaciones y campañas",
      "Integración AFIP / ARCA",
      "Dashboards financieros",
      "WhatsApp avanzado + flujos especiales",
      "Onboarding guiado"
    ],
    popular: false
  },
  {
    code: "pro",
    name: "Pro a medida",
    price: null,
    period: "",
    description: "Implementación custom y acompañamiento dedicado",
    features: [
      "Arquitectura multi-tenant",
      "Sucursales ilimitadas a medida",
      "API y flujos personalizados",
      "Integraciones externas",
      "Capacitación in-company",
      "SLA y soporte 24/7",
      "Launch plan con especialista"
    ],
    popular: false,
    custom: true
  }
];

export default function PlansPage() {
  const { tenantSlug } = useParams();
  const { user, tenant } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [currentPlan, setCurrentPlan] = useState(null);
  const [mpConnected, setMpConnected] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [payerEmail, setPayerEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [activeSubscriptionInfo, setActiveSubscriptionInfo] = useState(null);

  useEffect(() => {
    loadCurrentSubscription();
    checkMpConnection();
  }, []);

  const loadCurrentSubscription = async () => {
    try {
      // Verificar si hay una suscripción activa consultando el endpoint de business-type
      // que incluye información de la suscripción
      const response = await apiClient.get("/api/business-types/tenant/business-type");
      const subscription = response?.data?.data?.plan;
      
      if (subscription && subscription.status === "authorized") {
        setHasActiveSubscription(true);
        setActiveSubscriptionInfo(subscription);
      }
    } catch (error) {
      logger.error("Error cargando suscripción:", error);
    }
  };

  const checkMpConnection = async () => {
    try {
      // Verificar si hay token de Mercado Pago configurado
      // El endpoint de suscripción verificará si está conectado
      // Por ahora asumimos que si el usuario puede acceder, puede intentar suscribirse
      // La verificación real se hará al intentar crear la suscripción
      setMpConnected(true); // Permitir intentar suscribirse
    } catch (error) {
      logger.error("Error verificando Mercado Pago:", error);
      setMpConnected(false);
    }
  };

  const handleSubscribe = async (plan) => {
    if (plan.custom) {
      // Plan Pro a medida - redirigir al formulario
      navigate("/enterprise-request");
      return;
    }

    if (!mpConnected) {
      toast.error("Necesitás conectar Mercado Pago primero");
      navigate(`/${tenantSlug}/admin/config?tab=mercadopago`);
      return;
    }

    // Mostrar modal para solicitar email
    setSelectedPlan(plan);
    setPayerEmail(user?.email || "");
    setEmailError("");
    setShowEmailModal(true);
  };

  const handleEmailSubmit = async () => {
    if (!payerEmail || !payerEmail.trim()) {
      setEmailError("El email es requerido");
      return;
    }

    // Validar formato básico de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(payerEmail.trim())) {
      setEmailError("Por favor, ingresá un email válido");
      return;
    }

    setShowEmailModal(false);
    try {
      const response = await apiClient.post("/api/config/platform-subscription/create", {
        plan: selectedPlan.code,
        payerEmail: payerEmail.trim()
      });

      if (response?.data?.ok && response?.data?.init_point) {
        // Redirigir a Mercado Pago
        const paymentUrl = response.data.init_point;
        
        // Detectar si está en una PWA instalada (standalone mode)
        const isStandalone = window.navigator.standalone || 
                            (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
        
        if (isStandalone) {
          // Si está en una PWA, mostrar mensaje y abrir en navegador
          toast.info("Abriendo Mercado Pago en tu navegador...", { duration: 2000 });
          
          // Intentar abrir en el navegador del sistema usando window.open
          const opened = window.open(paymentUrl, '_blank');
          
          // Si window.open falla o está bloqueado, usar location.href
          if (!opened || opened.closed) {
            window.location.href = paymentUrl;
          }
        } else {
          // En navegador normal (móvil o desktop), usar location.href
          // Esto funciona correctamente en navegadores móviles estándar
          window.location.href = paymentUrl;
        }
      } else {
        toast.error(response?.data?.error || "Error al crear la suscripción");
        setLoading(false);
      }
    } catch (error) {
      logger.error("Error suscribiéndose:", error);
      
      // Si ya tiene una suscripción activa
      if (error?.response?.status === 409 && error?.response?.data?.requiresContact) {
        const errorData = error.response.data;
        toast.error(errorData.message || errorData.error, {
          duration: 6000,
          action: {
            label: "Contactar ventas",
            onClick: () => {
              // Abrir email o WhatsApp para contactar a ventas
              const email = "ventas@arjaerp.com"; // Ajustar según corresponda
              const subject = encodeURIComponent("Cambio de plan de suscripción");
              const body = encodeURIComponent(
                `Hola,\n\nYa tengo una suscripción activa al plan "${errorData.existingSubscription?.plan || 'N/A'}" y me gustaría cambiar de plan.\n\nPor favor, contactame para coordinar el cambio.\n\nGracias.`
              );
              window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank');
            }
          }
        });
      } else {
        toast.error(
          error?.response?.data?.error ||
          error?.response?.data?.message ||
          "No se pudo crear la suscripción. Verificá tu conexión a Mercado Pago."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price) => {
    if (price === null) return "Consultar";
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 0,
    }).format(price);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background-secondary/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(tenantSlug ? `/${tenantSlug}/dashboard` : "/")}
                className="p-2 hover:bg-border rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <Logo size="default" showText />
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
            Elige tu plan
          </h1>
          <p className="text-xl text-foreground-secondary max-w-2xl mx-auto">
            Seleccioná el plan que mejor se adapte a tu negocio. Podés cambiar o cancelar en cualquier momento.
          </p>
        </motion.div>

        {/* Alerta si Mercado Pago no está conectado */}
        {!mpConnected && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 max-w-4xl mx-auto"
          >
            <div className="card p-6 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-6 h-6 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground mb-2">
                    Conectá Mercado Pago para suscribirte
                  </h3>
                  <p className="text-sm text-foreground-secondary mb-4">
                    Necesitás conectar tu cuenta de Mercado Pago antes de suscribirte a un plan.
                  </p>
                  <button
                    onClick={() => navigate(`/${tenantSlug}/admin/config?tab=mercadopago`)}
                    className="btn-primary text-sm"
                  >
                    Conectar Mercado Pago
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Plans Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-7xl mx-auto">
          {PLANS.map((plan, index) => (
            <motion.div
              key={plan.code}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`card p-8 relative ${
                plan.popular
                  ? "ring-2 ring-primary scale-105"
                  : ""
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                  <span className="bg-primary text-white px-4 py-1 rounded-full text-sm font-semibold">
                    Más Popular
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-2xl font-bold text-foreground mb-2">{plan.name}</h3>
                <p className="text-foreground-secondary text-sm mb-4">{plan.description}</p>
                <div className="flex items-baseline">
                  <span className="text-4xl font-bold text-foreground">
                    {formatPrice(plan.price)}
                  </span>
                  {plan.period && (
                    <span className="text-foreground-secondary ml-2">/{plan.period}</span>
                  )}
                </div>
              </div>

              <ul className="space-y-3 mb-8">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start">
                    <CheckCircle2 className="w-5 h-5 text-primary mr-2 flex-shrink-0 mt-0.5" />
                    <span className="text-foreground-secondary text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleSubscribe(plan)}
                disabled={loading || hasActiveSubscription || (!mpConnected && !plan.custom)}
                className={`w-full py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
                  plan.popular
                    ? "bg-primary text-white hover:bg-primary-hover shadow-md"
                    : "bg-white dark:bg-background-secondary text-gray-900 dark:text-foreground border-2 border-gray-300 dark:border-border hover:border-primary hover:bg-primary-light dark:hover:bg-border"
                } disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-inherit disabled:hover:border-inherit`}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Procesando...
                  </>
                ) : hasActiveSubscription ? (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    Ya tenés una suscripción activa
                  </>
                ) : plan.custom ? (
                  <>
                    <CreditCard className="w-4 h-4" />
                    Consultar
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4" />
                    Suscribirme
                  </>
                )}
              </button>
            </motion.div>
          ))}
        </div>
      </main>

      {/* Modal para solicitar email del pagador */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/20 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-6 h-6 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-foreground mb-2">
                  Email para el pago
                </h3>
                <p className="text-sm text-foreground-secondary mb-4">
                  Mercado Pago requiere que el email del pagador coincida <strong>exactamente</strong> con el email de tu cuenta de Mercado Pago.
                </p>
                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3 mb-4">
                  <p className="text-sm text-foreground-secondary">
                    <strong>⚠️ Importante:</strong> Usá el mismo email que tenés registrado en tu cuenta de Mercado Pago. Si pagás con un email diferente, el pago será rechazado.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-foreground">
                    Email de tu cuenta de Mercado Pago
                  </label>
                  <input
                    type="email"
                    value={payerEmail}
                    onChange={(e) => {
                      setPayerEmail(e.target.value);
                      setEmailError("");
                    }}
                    placeholder="tu-email@ejemplo.com"
                    className={`w-full px-3 py-2 border rounded-lg bg-background text-foreground ${
                      emailError
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                        : "border-border focus:border-primary focus:ring-primary"
                    } focus:outline-none focus:ring-2`}
                    autoFocus
                  />
                  {emailError && (
                    <p className="text-sm text-red-500">{emailError}</p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => {
                  setShowEmailModal(false);
                  setPayerEmail("");
                  setEmailError("");
                }}
                className="flex-1 px-4 py-2 border border-border rounded-lg hover:bg-background-secondary transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleEmailSubmit}
                className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

