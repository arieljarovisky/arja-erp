import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Lock, ArrowRight, AlertCircle, CheckCircle2, Check, X } from "lucide-react";
import apiClient from "../api/client";
import ThemeToggle from "../components/ThemeToggle";
import Logo from "../components/Logo";
import { validatePassword, getPasswordRequirements } from "../utils/passwordValidation.js";
import { logger } from "../utils/logger.js";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const token = searchParams.get("token");
  const email = searchParams.get("email");

  // Validar contraseña en tiempo real
  const passwordValidation = useMemo(() => {
    if (!password) return null;
    return validatePassword(password);
  }, [password]);

  const requirements = getPasswordRequirements();

  useEffect(() => {
    if (!token || !email) {
      setError("Enlace inválido. Solicitá un nuevo enlace de recuperación.");
    }
  }, [token, email]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!token || !email) {
      setError("Enlace inválido");
      return;
    }

    // Validar contraseña con restricciones
    const validation = validatePassword(password);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }

    setLoading(true);

    try {
      const { data } = await apiClient.post("/auth/reset-password", {
        token,
        email,
        password,
      });

      if (data?.ok) {
        setSuccess(true);
        setTimeout(() => {
          navigate("/login");
        }, 3000);
      } else {
        setError(data?.error || "Error al restablecer la contraseña");
      }
    } catch (err) {
      logger.error("Error en reset-password:", err);
      const errorMsg = err.response?.data?.error || "No se pudo conectar con el servidor";
      setError(errorMsg);
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
                ¡Contraseña actualizada!
              </h1>
              <p className="text-foreground-secondary">
                Tu contraseña ha sido restablecida correctamente.
                Serás redirigido al login en unos segundos...
              </p>
            </div>
            <button
              onClick={() => navigate("/login")}
              className="w-full btn-primary py-3 flex items-center justify-center gap-2"
            >
              Ir al login
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
                Nueva contraseña
              </h1>
              <p className="text-foreground-muted">
                Ingresá tu nueva contraseña
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
                Nueva contraseña
              </label>
              <div className="input-group">
                <span className="input-group__icon">
                  <Lock />
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`input input--with-icon input--with-icon-right ${
                    password && passwordValidation && !passwordValidation.valid
                      ? "border-red-500 focus:border-red-500"
                      : password && passwordValidation && passwordValidation.valid
                      ? "border-green-500 focus:border-green-500"
                      : ""
                  }`}
                  placeholder="••••••••"
                  required
                  minLength={8}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="input-group__action"
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.29 3.29m13.42 13.42l-3.29-3.29M3 3l18 18" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              
              {/* Mostrar requisitos de contraseña */}
              {password && (
                <div className="mt-3 p-3 rounded-lg bg-background-secondary border border-border">
                  <p className="text-xs font-semibold text-foreground mb-2">
                    Requisitos de contraseña:
                  </p>
                  <ul className="space-y-1 text-xs">
                    {passwordValidation && passwordValidation.missingRequirements ? (
                      <>
                        <li className={`flex items-center gap-2 ${
                          passwordValidation.missingRequirements.minLength
                            ? "text-green-600 dark:text-green-400"
                            : "text-foreground-secondary"
                        }`}>
                          {passwordValidation.missingRequirements.minLength ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <X className="w-3 h-3" />
                          )}
                          Al menos 8 caracteres
                        </li>
                        <li className={`flex items-center gap-2 ${
                          passwordValidation.missingRequirements.hasUpperCase
                            ? "text-green-600 dark:text-green-400"
                            : "text-foreground-secondary"
                        }`}>
                          {passwordValidation.missingRequirements.hasUpperCase ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <X className="w-3 h-3" />
                          )}
                          Al menos una mayúscula (A-Z)
                        </li>
                        <li className={`flex items-center gap-2 ${
                          passwordValidation.missingRequirements.hasLowerCase
                            ? "text-green-600 dark:text-green-400"
                            : "text-foreground-secondary"
                        }`}>
                          {passwordValidation.missingRequirements.hasLowerCase ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <X className="w-3 h-3" />
                          )}
                          Al menos una minúscula (a-z)
                        </li>
                        <li className={`flex items-center gap-2 ${
                          passwordValidation.missingRequirements.hasNumber
                            ? "text-green-600 dark:text-green-400"
                            : "text-foreground-secondary"
                        }`}>
                          {passwordValidation.missingRequirements.hasNumber ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <X className="w-3 h-3" />
                          )}
                          Al menos un número (0-9)
                        </li>
                        <li className={`flex items-center gap-2 ${
                          passwordValidation.missingRequirements.hasSpecialChar
                            ? "text-green-600 dark:text-green-400"
                            : "text-foreground-secondary"
                        }`}>
                          {passwordValidation.missingRequirements.hasSpecialChar ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <X className="w-3 h-3" />
                          )}
                          Al menos un carácter especial
                        </li>
                      </>
                    ) : (
                      requirements.mustHave.map((req, idx) => (
                        <li key={idx} className="text-foreground-secondary">
                          • {req}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">
                Confirmar contraseña
              </label>
              <div className="input-group">
                <span className="input-group__icon">
                  <Lock />
                </span>
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input input--with-icon input--with-icon-right"
                  placeholder="••••••••"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="input-group__action"
                >
                  {showConfirmPassword ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.29 3.29m13.42 13.42l-3.29-3.29M3 3l18 18" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !token || !email}
              className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Actualizando...
                </>
              ) : (
                <>
                  Restablecer contraseña
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

