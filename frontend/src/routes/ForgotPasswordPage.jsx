import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";
import apiClient from "../api/client";
import ThemeToggle from "../components/ThemeToggle";
import Logo from "../components/Logo";
import { logger } from "../utils/logger.js";

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data } = await apiClient.post("/auth/forgot-password", { email });
      
      if (data?.ok) {
        setSuccess(true);
      } else {
        setError(data?.error || "Error al enviar el correo");
      }
    } catch (err) {
      logger.error("Error en forgot-password:", err);
      setError("No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="max-w-md w-full"
        >
          <div className="card p-8 space-y-6 text-center">
            <div className="flex justify-center">
              <Logo size="default" showText />
            </div>
            <div className="flex justify-center">
              <CheckCircle2 className="w-16 h-16 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground mb-3">
                Correo enviado
              </h1>
              <p className="text-foreground-secondary">
                Si el email <strong>{email}</strong> existe en nuestro sistema, 
                recibirás un correo con instrucciones para restablecer tu contraseña.
              </p>
              <p className="text-foreground-muted text-sm mt-4">
                Revisá tu bandeja de entrada y la carpeta de spam.
              </p>
            </div>
            <button
              onClick={() => navigate("/login")}
              className="w-full btn-primary py-3 flex items-center justify-center gap-2"
            >
              Volver al login
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full"
      >
        <div className="card p-8 space-y-6">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <Logo size="default" showText />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Recuperar contraseña
              </h1>
              <p className="text-foreground-muted">
                Ingresá tu email y te enviaremos un enlace para restablecer tu contraseña
              </p>
            </div>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
            >
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">
                Email
              </label>
              <div className="input-group">
                <span className="input-group__icon">
                  <Mail />
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input input--with-icon"
                  placeholder="tu@email.com"
                  required
                  autoFocus
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Enviando...
                </>
              ) : (
                <>
                  Enviar enlace
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="text-center">
            <button
              onClick={() => navigate("/login")}
              className="text-sm text-foreground-secondary hover:text-foreground transition-colors"
            >
              ← Volver al login
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

