import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { CheckCircle2, ArrowLeft, Calendar, Users, Package, FileText, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useApp } from "../context/UseApp";
import apiClient from "../api/client";
import { toast } from "sonner";
import { logger } from "../utils/logger.js";

const FEATURE_LABELS = {
  appointments: "Turnos individuales",
  classes: "Turnos de clases",
  stock: "Gestión de stock",
  invoicing: "Facturación",
};

const FEATURE_ICONS = {
  appointments: Calendar,
  classes: Users,
  stock: Package,
  invoicing: FileText,
};

export default function FeatureRequestPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { tenantInfo } = useApp();
  
  // Obtener el plan desde los parámetros de la URL si existe
  const searchParams = new URLSearchParams(location.search);
  const planCode = searchParams.get("plan") || "";
  
  const [form, setForm] = useState({
    name: user?.email?.split("@")[0] || "",
    email: user?.email || "",
    phone: "",
    company: tenantInfo?.name || "",
    requestedFeatures: {
      appointments: false,
      classes: false,
      stock: false,
      invoicing: false,
    },
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleFeatureToggle = (featureKey) => {
    setForm((prev) => ({
      ...prev,
      requestedFeatures: {
        ...prev.requestedFeatures,
        [featureKey]: !prev.requestedFeatures[featureKey],
      },
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    // Validar que al menos una funcionalidad esté seleccionada
    const hasSelectedFeature = Object.values(form.requestedFeatures).some((val) => val);
    if (!hasSelectedFeature) {
      setError("Seleccioná al menos una funcionalidad que necesitás.");
      setSubmitting(false);
      return;
    }

    try {
      const payload = {
        ...form,
        planCode: planCode,
        currentPlan: tenantInfo?.plan?.code || "starter",
        currentPlanLabel: tenantInfo?.plan?.label || "Plan Starter",
      };
      await apiClient.post("/api/config/feature-request", payload);
      setSubmitted(true);
      toast.success("Solicitud enviada correctamente");
    } catch (err) {
      logger.error("Error enviando solicitud de funcionalidades:", err);
      setError("No pudimos enviar tu solicitud. Probá nuevamente en unos minutos.");
      toast.error("Error al enviar la solicitud");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background">
        <main className="pt-8 pb-16 px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={() => navigate(-1)}
              className="mb-6 flex items-center gap-2 text-foreground-secondary hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Volver
            </button>
            <div className="card card--space-xl text-center">
              <div className="flex justify-center mb-6">
                <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                  <CheckCircle2 className="w-10 h-10 text-primary" />
                </div>
              </div>
              <h1 className="text-3xl font-bold text-foreground mb-4">
                ¡Solicitud enviada!
              </h1>
              <p className="text-foreground-secondary mb-8 text-lg">
                Nuestro equipo de ventas revisará tu solicitud y se pondrá en contacto contigo en breve para ayudarte a actualizar tu plan.
              </p>
              <button onClick={() => navigate(-1)} className="btn-primary">
                Volver
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const selectedFeaturesCount = Object.values(form.requestedFeatures).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-background">
      <main className="pt-8 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="mb-6 flex items-center gap-2 text-foreground-secondary hover:text-foreground transition-colors group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Volver
          </button>
          
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-4xl font-bold text-foreground mb-4">
              Solicitar Funcionalidades
            </h1>
            <p className="text-foreground-secondary text-lg max-w-2xl mx-auto">
              Completá el formulario para solicitar funcionalidades adicionales. Nuestro equipo de ventas te contactará para ayudarte a actualizar tu plan.
            </p>
          </div>

          <div className="bg-blue-950/40 dark:bg-blue-900/30 rounded-2xl p-6 sm:p-8 border border-blue-800/30 dark:border-blue-700/30">
            <form onSubmit={handleSubmit} className="card card--space-lg space-y-8">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-foreground">
                  Nombre y apellido <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  required
                  placeholder="Juan Pérez"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-foreground">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  required
                  placeholder="tu@email.com"
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-foreground">
                  Teléfono
                </label>
                <input
                  className="input w-full focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="+54 9 11 1234-5678"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-foreground">
                  Empresa/Negocio
                </label>
                <input
                  className="input w-full focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                  name="company"
                  value={form.company}
                  onChange={handleChange}
                  placeholder="Nombre de tu negocio"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-semibold text-foreground">
                  Funcionalidades que necesitás <span className="text-red-400">*</span>
                </label>
                <span className="text-xs font-medium text-foreground-secondary bg-background-secondary px-3 py-1 rounded-full">
                  {selectedFeaturesCount} {selectedFeaturesCount === 1 ? "seleccionada" : "seleccionadas"}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Object.entries(FEATURE_LABELS).map(([key, label]) => {
                  const Icon = FEATURE_ICONS[key];
                  const isSelected = form.requestedFeatures[key];
                  return (
                    <label
                      key={key}
                      className={`group relative flex items-start gap-4 p-5 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                        isSelected
                          ? "border-primary bg-primary/10 shadow-lg shadow-primary/10"
                          : "border-border bg-background-secondary hover:border-primary/30 hover:bg-background-secondary/80"
                      }`}
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                          isSelected
                            ? "border-primary bg-primary"
                            : "border-border bg-background"
                        }`}>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-white" />
                          )}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleFeatureToggle(key)}
                        className="sr-only"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {Icon && (
                            <Icon className={`w-5 h-5 flex-shrink-0 ${
                              isSelected ? "text-primary" : "text-foreground-secondary"
                            }`} />
                          )}
                          <span className={`font-semibold text-base ${
                            isSelected ? "text-foreground" : "text-foreground-secondary"
                          }`}>
                            {label}
                          </span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-foreground">
                Mensaje adicional <span className="text-foreground-muted font-normal">(opcional)</span>
              </label>
              <textarea
                className="input w-full min-h-[120px] resize-y focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                rows="5"
                name="message"
                value={form.message}
                onChange={handleChange}
                placeholder="Contanos más sobre tus necesidades, preguntas o casos de uso específicos..."
              />
            </div>

            {error && (
              <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 animate-in slide-in-from-top-2">
                <p className="text-sm font-medium text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="btn-ghost flex-1 order-2 sm:order-1"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn-primary flex-1 order-1 sm:order-2 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] font-semibold"
                disabled={submitting || selectedFeaturesCount === 0}
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Enviando...
                  </span>
                ) : (
                  "Enviar solicitud"
                )}
              </button>
            </div>
          </form>
          </div>
        </div>
      </main>
    </div>
  );
}

