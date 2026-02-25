import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { authApi, getAccessToken, setAccessToken } from "../api/client";
import { logger } from "../utils/logger.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const refreshTimerRef = useRef(null);

  // Inicializa la sesión si hay token
  useEffect(() => {
    const init = async () => {
      try {
        const token = getAccessToken();

        if (!token) {
          // Intentar recuperar sesión con cookie de refresh (si existe)
          try {
            const refreshed = await authApi.refresh();
            if (!refreshed) {
              setAuthLoaded(true);
              return;
            }
          } catch (e) {
            setAuthLoaded(true);
            return;
          }
        }

        // Validar token con el backend
        let { ok, user: userData, tenant: tenantData } = await authApi.me();

        if (ok && userData) {
          setUser(userData);
          setTenant(tenantData || null);
        } else {
          // Intentar refresh si el token actual no valida
          try {
            const refreshed = await authApi.refresh();
            if (refreshed) {
              const resp = await authApi.me();
              if (resp?.ok && resp?.user) {
                setUser(resp.user);
                setTenant(resp.tenant || null);
              } else {
                setUser(null);
                setTenant(null);
              }
            } else {
              setUser(null);
              setTenant(null);
            }
          } catch {
            setUser(null);
            setTenant(null);
          }
        }
      } catch (err) {
        logger.error("[AuthContext] Error inicializando sesión:", err);
        // No limpiar token ante errores transitorios
      } finally {
        setAuthLoaded(true);
      }
    };

    init();
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      const expMs = (payload.exp || 0) * 1000;
      const now = Date.now();
      let delay = expMs - now - 60000;
      if (delay < 30000) delay = 30000;
      refreshTimerRef.current = setTimeout(async () => {
        try {
          const ok = await authApi.refresh();
          if (ok) {
            await authApi.me().then((r) => {
              if (r?.ok && r?.user) {
                setUser(r.user);
                setTenant(r.tenant || null);
              }
            });
          }
        } catch (e) {
          logger.warn("[AuthContext] silent refresh error:", e);
        }
      }, delay);
    } catch {
    }
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [user]);

  useEffect(() => {
    const onStorage = async (e) => {
      if (e.key !== "token") return;
      const token = getAccessToken();
      if (!token) {
        setUser(null);
        setTenant(null);
        setAccessToken(null);
        return;
      }
      try {
        const { ok, user: userData, tenant: tenantData } = await authApi.me();
        if (ok && userData) {
          setUser(userData);
          setTenant(tenantData || null);
        }
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ==== Métodos de login ====
  const login = async (email, password) => {
    const data = await authApi.login(email, password);
    if (data?.ok && data?.access) {
      setUser(data.user);
      setTenant(data.tenant || null);
      return { success: true, data };
    }
    if (data?.ok && data?.multiTenant) {
      return {
        success: false,
        multiTenant: true,
        tenants: data.tenants,
        email: data.email,
      };
    }
    return { success: false, error: data?.error || "Error de login" };
  };

  const loginTenant = async (email, password, slug) => {
    const data = await authApi.loginTenant(email, password, slug);
    if (data?.ok && data?.access) {
      setUser(data.user);
      setTenant(data.tenant || null);
      return { success: true, data };
    }
    return { success: false, error: data?.error || "Error de login" };
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (err) {
      logger.warn("[AuthContext] logout warning:", err.message);
    } finally {
      setUser(null);
      setAccessToken(null);
      setTenant(null);
      // Limpiar sessionStorage al cerrar sesión
      sessionStorage.removeItem('stockAlertsShown');
    }
  };

  const refreshSession = useCallback(async () => {
    try {
      const { ok, user: userData, tenant: tenantData } = await authApi.me();
      if (ok && userData) {
        setUser(userData);
        setTenant(tenantData || null);
        return { ok: true };
      }
      setUser(null);
      setTenant(null);
      setAccessToken(null);
      return { ok: false };
    } catch (err) {
      logger.error("[AuthContext] refreshSession error:", err);
      setUser(null);
      setTenant(null);
      setAccessToken(null);
      return { ok: false, error: err?.message || "Error" };
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        tenant,
        authLoaded,
        login,
        loginTenant,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
