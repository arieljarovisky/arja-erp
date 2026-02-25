import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, XCircle, Loader2, Mail, ArrowRight, HelpCircle } from "lucide-react";
import { apiClient } from "../api/client";
import Logo from "../components/Logo";

export default function ActivatePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [tenant, setTenant] = useState(null);

  useEffect(() => {
    const token = searchParams.get("token");
    
    if (!token) {
      setError("Token de activación no proporcionado");
      setLoading(false);
      return;
    }

    activateAccount(token);
  }, [searchParams]);

  const activateAccount = async (token) => {
    try {
      setLoading(true);
      const response = await apiClient.get(`/public/onboarding/activate?token=${token}`);
      
      if (response?.data?.ok) {
        setSuccess(true);
        setTenant(response.data.tenant);
        
        // Redirigir al login después de 3 segundos
        setTimeout(() => {
          if (response.data.tenant?.subdomain) {
            navigate(`/${response.data.tenant.subdomain}/login`);
          } else {
            navigate("/login");
          }
        }, 3000);
      } else {
        setError(response?.data?.error || "Error al activar la cuenta");
      }
    } catch (err) {
      setError(
        err?.response?.data?.error || 
        "Token de activación inválido o ya utilizado"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex items-center justify-center p-4">
      {/* Efectos de fondo decorativos */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl"></div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full relative z-10"
      >
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800/50 rounded-2xl shadow-2xl p-8 text-center">
          {/* Logo */}
          <div className="mb-8">
            <Logo size="large" showText />
          </div>

          {/* Estado de carga */}
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              <div className="relative">
                <Loader2 className="w-20 h-20 text-primary mx-auto animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 bg-primary/20 rounded-full animate-pulse"></div>
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-100 mb-3">
                  Activando tu cuenta...
                </h1>
                <p className="text-slate-400">
                  Por favor espera mientras procesamos tu activación.
                </p>
              </div>
              <div className="flex justify-center gap-1 pt-4">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-2 h-2 bg-primary rounded-full"
                    animate={{
                      scale: [1, 1.5, 1],
                      opacity: [0.5, 1, 0.5],
                    }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      delay: i * 0.2,
                    }}
                  />
                ))}
              </div>
            </motion.div>
          )}

          {/* Estado de éxito */}
          {success && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="space-y-6"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ 
                  type: "spring", 
                  duration: 0.6,
                  bounce: 0.4
                }}
                className="relative"
              >
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-24 h-24 bg-green-500/20 rounded-full animate-ping"></div>
                </div>
                <CheckCircle2 className="w-20 h-20 text-green-500 mx-auto relative z-10" />
              </motion.div>
              
              <div className="space-y-3">
                <h1 className="text-3xl font-bold text-slate-100">
                  ¡Cuenta activada exitosamente!
                </h1>
                {tenant && (
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                    <p className="text-slate-300 mb-1">
                      Tu cuenta para
                    </p>
                    <p className="text-xl font-semibold text-primary">
                      {tenant.name}
                    </p>
                    <p className="text-slate-400 text-sm mt-1">
                      está lista para usar
                    </p>
                  </div>
                )}
                <div className="flex items-center justify-center gap-2 text-slate-400 text-sm pt-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Redirigiendo al inicio de sesión...</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Estado de error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", duration: 0.5 }}
              >
                <div className="relative">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-20 h-20 bg-red-500/10 rounded-full"></div>
                  </div>
                  <XCircle className="w-20 h-20 text-red-500 mx-auto relative z-10" />
                </div>
              </motion.div>
              
              <div className="space-y-4">
                <h1 className="text-2xl font-bold text-slate-100">
                  Error al activar
                </h1>
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
                
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50 text-left">
                  <div className="flex items-start gap-3">
                    <HelpCircle className="w-5 h-5 text-slate-400 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-slate-300 space-y-1">
                      <p className="font-medium text-slate-200">Posibles causas:</p>
                      <ul className="list-disc list-inside space-y-1 text-slate-400 ml-2">
                        <li>El enlace de activación ya fue utilizado</li>
                        <li>El enlace expiró (válido por 24 horas)</li>
                        <li>El enlace es inválido o está corrupto</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <button
                  onClick={() => navigate("/login")}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg shadow-primary/20 hover:shadow-primary/30"
                >
                  Ir al inicio de sesión
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => window.open("mailto:soporte@arjaerp.com.ar?subject=Problema con activación de cuenta", "_blank")}
                  className="w-full flex items-center justify-center gap-2 bg-slate-800/50 hover:bg-slate-800 text-slate-200 font-semibold py-3 px-6 rounded-xl transition-all border border-slate-700/50 hover:border-slate-600"
                >
                  <Mail className="w-4 h-4" />
                  Contactar soporte
                </button>
              </div>
            </motion.div>
          )}

          {/* Estado por defecto (sin token) */}
          {!loading && !success && !error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              <Mail className="w-16 h-16 text-slate-400 mx-auto" />
              <div>
                <h1 className="text-xl font-semibold text-slate-200 mb-2">
                  Revisa tu correo
                </h1>
                <p className="text-slate-400">
                  Busca el enlace de activación en tu bandeja de entrada.
                </p>
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

