import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, Lock, ArrowRight, AlertCircle, Calendar, Users, DollarSign, Bell, CheckCircle2, Sparkles } from "lucide-react";
import {
  authApi,
  setAccessToken,
  setTenantId,
  setAuthEmail,
  setUserData,
} from "../api/client";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import ThemeToggle from "../components/ThemeToggle";
import Logo from "../components/Logo";
import { logger } from "../utils/logger.js";
import { useTranslation } from "../i18n/useTranslation.js";

function safeNextParam(search) {
  const next = new URLSearchParams(search).get("next");
  return next && next.startsWith("/") ? next : null;
}

export default function LoginPage() {
  const location = useLocation();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { user, authLoaded, logout } = useAuth();
  useTheme();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  

  // Multi-tenant
  const [showTenantSelector, setShowTenantSelector] = useState(false);
  const [availableTenants, setAvailableTenants] = useState([]);

  // 2FA
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);

  const goAfterLogin = (resp, fallbackSlug) => {
    const next = safeNextParam(location.search);
    const isSuperAdmin = resp?.user?.isSuperAdmin || resp?.user?.is_super_admin;
    const slug = resp?.tenant?.slug || fallbackSlug || null;
    const defaultDest = isSuperAdmin
      ? "/super-admin/tenants"
      : slug
      ? `/${slug}/dashboard`
      : "/login";
    const dest = next || defaultDest;
    window.location.replace(dest);
  };

  useEffect(() => {
    if (!authLoaded || !user) return;
    if (location.pathname === "/login") return;

    const isSuperAdmin = user?.isSuperAdmin || user?.is_super_admin;
    if (isSuperAdmin) {
      if (!location.pathname.startsWith("/super-admin")) {
        navigate("/super-admin/tenants", { replace: true });
      }
      return;
    }

    if (user?.tenant?.slug) {
      navigate(`/${user.tenant.slug}/dashboard`, { replace: true });
    }
  }, [authLoaded, user, navigate, location.pathname]);

  useEffect(() => {
    if (user) return;

    // Interceptar navegación hacia atrás cuando estamos en login sin sesión
    const handlePop = () => {
      const currentPath = window.location.pathname;
      
      // Si estamos en login sin sesión y presionan atrás, ir directamente a /
      if (currentPath === "/login") {
        // Prevenir la navegación y redirigir a /
        window.history.replaceState(null, "", "/");
        window.location.replace("/");
        return;
      }
      
      // Si salimos de login hacia cualquier otra ruta que no sea /, redirigir a /
      if (currentPath !== "/login" && currentPath !== "/") {
        window.location.replace("/");
      }
    };

    window.addEventListener("popstate", handlePop);
    
    // Cuando el componente se monta en login sin sesión, asegurar que la entrada anterior sea /
    if (window.location.pathname === "/login") {
      // Si la entrada anterior no es /, reemplazarla
      // Esto se hace manipulando el historial antes de que el usuario presione atrás
      const currentState = window.history.state;
      // Guardar el estado actual
      const savedState = currentState;
      // Reemplazar la entrada actual con / (esto será la entrada anterior cuando agreguemos /login)
      window.history.replaceState({ ...savedState, fromLogin: true }, "", "/");
      // Agregar /login de nuevo
      window.history.pushState({ ...savedState, fromLogin: false }, "", "/login");
    }

    return () => window.removeEventListener("popstate", handlePop);
  }, [user]);



  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (authApi.isAuthenticated()) {
        const me = await authApi.me();
        if (me?.ok && me?.user) {
          goAfterLogin(me);
          return;
        }
      }
      const resp = await authApi.login(email, password, twoFactorCode || null, rememberDevice);

      if (resp?.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setError("");
        setLoading(false);
        return;
      }

      if (!resp?.ok) {
        setError(resp?.error || "Credenciales incorrectas");
        setLoading(false);
        return;
      }

      if (resp.multiTenant) {
        const tenants = resp.tenants || [];
        if (resp.isSuperAdmin) {
          const systemTenant = tenants.find(
            (t) => t.is_system || t.slug === "system"
          );
          if (systemTenant) {
            await handleTenantSelect(systemTenant.slug);
            return;
          }
        }
        setAvailableTenants(tenants);
        setShowTenantSelector(true);
        setLoading(false);
        return;
      }

      if (resp.access) setAccessToken(resp.access);
      if (resp.user) setUserData(resp.user);
      if (resp.tenant?.id) setTenantId(resp.tenant.id);
      setAuthEmail(resp?.user?.email || email);

      goAfterLogin(resp);
    } catch (err) {
      logger.error("Error en login:", err);
      let errorMessage = "No se pudo conectar con el servidor";
      if (err?.response?.data?.error) {
        errorMessage = err.response.data.error;
      } else if (err?.response?.data?.message) {
        errorMessage = err.response.data.message;
      } else if (err?.message) {
        if (err.message.includes("Network Error") || err.message.includes("timeout")) {
          errorMessage = "No se pudo conectar con el servidor. Verificá tu conexión a internet.";
        } else {
          errorMessage = err.message;
        }
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleTenantSelect = async (slug) => {
    setError("");
    setLoading(true);
    try {
      const resp = await authApi.loginTenant(email, password, slug, twoFactorCode || null, rememberDevice);

      if (resp?.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setError("");
        setLoading(false);
        return;
      }

      if (!resp?.ok) {
        setError(resp?.error || "Error al iniciar sesión");
        setLoading(false);
        return;
      }

      if (resp.access) setAccessToken(resp.access);
      if (resp.user) setUserData(resp.user);
      if (resp.tenant?.id) setTenantId(resp.tenant.id);
      setAuthEmail(resp?.user?.email || email);

      goAfterLogin(resp, slug);
    } catch (err) {
      logger.error("Error en login tenant:", err);
      let errorMessage = "Error al conectar con el servidor";
      if (err?.response?.data?.error) {
        errorMessage = err.response.data.error;
      } else if (err?.response?.data?.message) {
        errorMessage = err.response.data.message;
      } else if (err?.message) {
        if (err.message.includes("Network Error") || err.message.includes("timeout")) {
          errorMessage = "No se pudo conectar con el servidor. Verificá tu conexión a internet.";
        } else {
          errorMessage = err.message;
        }
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (showTenantSelector) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full"
        >
          <div className="card p-8 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-foreground">
                {t("login.selectTenant")}
              </h2>
              <ThemeToggle />
            </div>

            <div className="space-y-3">
              {availableTenants.map((tenant) => (
                <button
                  key={tenant.slug}
                  onClick={() => handleTenantSelect(tenant.slug)}
                  disabled={loading}
                  className="w-full p-4 text-left rounded-lg border border-border bg-background-secondary hover:bg-border transition-colors disabled:opacity-50"
                >
                  <div className="font-medium text-foreground flex items-center gap-2">
                    {tenant.is_system && (
          <div className="flex justify-center">
            <Logo size="default" showText />
          </div>
                    )}
                    <span>
                      {tenant.name || tenant.slug}
                    </span>
                  </div>
                  <div className="text-sm text-foreground-muted">
                    {tenant.role}
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                setShowTenantSelector(false);
                setAvailableTenants([]);
              }}
              className="w-full text-sm text-foreground-secondary hover:text-foreground transition-colors"
            >
              ← {t("common.back")}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const features = [
    { icon: Calendar, text: t("landing.features.appointments.title") },
    { icon: Users, text: t("landing.features.customers.title") },
    { icon: DollarSign, text: t("landing.features.payments.title") },
    { icon: Bell, text: t("landing.features.notifications.title") }
  ];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
        {/* Columna izquierda - Información y características */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="hidden lg:block space-y-8"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Logo size="default" showText />
            </div>
            <h2 className="text-4xl font-bold text-foreground">
              {t("landing.hero.title")} {t("landing.hero.titleHighlight")}
            </h2>
            <p className="text-lg text-foreground-secondary">
              {t("landing.hero.subtitle")}
            </p>
          </div>

          {/* Características destacadas */}
          <div className="grid grid-cols-2 gap-4">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.2 + index * 0.1 }}
                  className="flex items-center gap-3 p-4 rounded-lg bg-background-secondary border border-border"
                >
                  <div className="w-10 h-10 bg-primary-light dark:bg-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-foreground">{feature.text}</span>
                </motion.div>
              );
            })}
          </div>

          {/* Beneficios */}
            <div className="space-y-3 pt-4">
            <div className="flex items-center gap-2 text-foreground-secondary">
              <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" />
                <span className="text-sm">{t("login.benefits.freeTrial")}</span>
            </div>
            <div className="flex items-center gap-2 text-foreground-secondary">
              <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" />
                <span className="text-sm">{t("login.benefits.noCard")}</span>
            </div>
            <div className="flex items-center gap-2 text-foreground-secondary">
              <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" />
                <span className="text-sm">{t("login.benefits.cancelAnytime")}</span>
            </div>
          </div>
        </motion.div>

        {/* Columna derecha - Formulario de login */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full"
        >
          <div className="card p-8 space-y-8 max-w-md mx-auto">
            {/* Logo y título */}
            <div className="text-center space-y-4">
              <div className="flex justify-center lg:hidden mb-4">
                <Logo size="default" showText />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground mb-2">
                  {t("login.welcome")}
                </h1>
                <p className="text-foreground-muted">
                  {t("login.signInToContinue")}
                </p>
              </div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="p-4 rounded-lg border bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
              >
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-300">
                    {typeof error === "string" ? error : error.message || "Error al iniciar sesión"}
                  </p>
                </div>
              </motion.div>
            )}

            {/* Aviso de sesión activa */}
            {authLoaded && (user || authApi.isAuthenticated()) && (
              <div className="p-4 rounded-lg border bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
                <div className="space-y-3">
                  <div className="text-sm text-yellow-800 dark:text-yellow-200">
                    {t("login.activeSessionWarning")}
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={async () => {
                        if (user) {
                          goAfterLogin({ user, tenant: user.tenant });
                          return;
                        }
                        try {
                          const me = await authApi.me();
                          if (me?.ok) {
                            goAfterLogin(me);
                          } else {
                            toast.error("Could not get current session");
                          }
                        } catch {
                          toast.error("Could not get current session");
                        }
                      }}
                      className="px-4 py-2 rounded-md bg-primary text-white hover:bg-primary-hover transition"
                    >
                      {t("login.goToPanel")}
                    </button>
                    <button
                      type="button"
                      onClick={logout}
                      className="px-4 py-2 rounded-md border border-border hover:bg-border transition"
                    >
                      {t("navigation.logout")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-6">
              {!requiresTwoFactor ? (
                <>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">
                      {t("login.email")}
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
                        placeholder={t("login.placeholderEmail")}
                        required
                        autoFocus
                        disabled={authLoaded && (user || authApi.isAuthenticated())}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">
                      {t("login.password")}
                    </label>
                    <div className="input-group">
                      <span className="input-group__icon">
                        <Lock />
                      </span>
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="input input--with-icon input--with-icon-right"
                        placeholder="••••••••"
                        required
                        disabled={authLoaded && (user || authApi.isAuthenticated())}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="input-group__action"
                        disabled={authLoaded && (user || authApi.isAuthenticated())}
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
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="rememberDevice-main"
                      checked={rememberDevice}
                      onChange={(e) => setRememberDevice(e.target.checked)}
                      className="w-4 h-4 rounded border-border"
                      disabled={authLoaded && (user || authApi.isAuthenticated())}
                    />
                    <label htmlFor="rememberDevice-main" className="text-sm text-foreground-muted cursor-pointer">
                      {t("login.rememberDevice")}
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-4">
                    <div className="text-center space-y-2">
                      <h3 className="text-lg font-semibold text-foreground">
                        {t("login.twoFactor.title")}
                      </h3>
                      <p className="text-sm text-foreground-muted">
                        Ingresá el código de 6 dígitos de tu aplicación de autenticación
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-foreground">
                        Código 2FA
                      </label>
                      <input
                        type="text"
                        value={twoFactorCode}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, "").slice(0, 6);
                          setTwoFactorCode(value);
                        }}
                        className="input text-center text-2xl tracking-widest font-mono"
                        placeholder="000000"
                        maxLength={6}
                        required
                        autoFocus
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="rememberDevice"
                        checked={rememberDevice}
                        onChange={(e) => setRememberDevice(e.target.checked)}
                        className="w-4 h-4 rounded border-border"
                      />
                      <label htmlFor="rememberDevice" className="text-sm text-foreground-muted cursor-pointer">
                        Recordar este dispositivo durante 30 días
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setRequiresTwoFactor(false);
                        setTwoFactorCode("");
                        setRememberDevice(false);
                      }}
                      className="w-full text-sm text-foreground-secondary hover:text-foreground transition-colors"
                    >
                      ← Volver
                    </button>
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={loading || (requiresTwoFactor && twoFactorCode.length !== 6) || (authLoaded && (user || authApi.isAuthenticated()))}
                className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {requiresTwoFactor ? "Verificando..." : "Iniciando sesión..."}
                  </>
                ) : (
                  <>
                    {requiresTwoFactor ? "Verificar código" : "Ingresar"}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-background text-foreground-muted">o</span>
              </div>
            </div>

            {/* Botón de Google OAuth */}
            <button
              type="button"
              onClick={async () => {
                try {
                  if (authApi.isAuthenticated()) {
                    const me = await authApi.me();
                    if (me?.ok && me?.user) {
                      goAfterLogin(me);
                      return;
                    }
                  }
                  const next = safeNextParam(location.search) || "/";
                  const authUrl = await authApi.getGoogleAuthUrl(next);
                  if (authUrl) {
                    window.location.href = authUrl;
                  } else {
                    toast.error("Error al iniciar sesión con Google. Intentá nuevamente.");
                  }
                } catch (err) {
                  logger.error("Error iniciando sesión con Google:", err);
                  toast.error("Error al iniciar sesión con Google. Intentá nuevamente.");
                }
              }}
              disabled={loading || (authLoaded && (user || authApi.isAuthenticated()))}
              className="w-full py-3 px-4 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 font-semibold rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continuar con Google
            </button>

            {/* Botón para nuevos usuarios */}
            <div className="space-y-4">
              <button
                onClick={() => navigate("/onboarding")}
                className="w-full py-3 px-4 bg-background-secondary hover:bg-border border-2 border-primary text-primary font-semibold rounded-lg transition-all flex items-center justify-center gap-2 group"
              >
                <Sparkles className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                ¿No tenés tu ERP todavía? Empezá ahora
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            {/* Footer */}
            <div className="text-center space-y-2 text-sm text-foreground-muted">
              <p>
                <button
                  onClick={() => navigate("/forgot-password")}
                  className="text-primary hover:text-primary-hover font-medium"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </p>
              <p>
                ¿Necesitás ayuda?{" "}
                <button
                  onClick={() => navigate("/contact")}
                  className="text-primary hover:text-primary-hover font-medium"
                >
                  Contactanos
                </button>
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
