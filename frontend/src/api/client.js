// src/api/client.js
import axios from "axios";
import { recordRequest } from "../utils/performanceMonitor.js";
import { logger } from "../utils/logger.js";

const apiBase = import.meta.env.VITE_API_URL || "http://localhost:4000";
const apiClient = axios.create({
  baseURL: apiBase,
  headers: {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  },
  withCredentials: true, // ✅ Para cookies HttpOnly
  timeout: 30000, // 30 segundos de timeout para evitar esperas indefinidas
});

let isNgrok = false;
try {
  const host = new URL(apiBase).host;
  isNgrok = /ngrok-free\.dev$/i.test(host);
} catch { /* ignore */ }


function toArray(x) {
  if (Array.isArray(x)) return x;
  if (x?.data && Array.isArray(x.data)) return x.data;
  if (x?.hours && Array.isArray(x.hours)) return x.hours;
  if (x?.items && Array.isArray(x.items)) return x.items;
  return [];
}

/* =========================
   HELPERS DE STORAGE
========================= */

function setAccessToken(token) {
  if (token) {
    localStorage.setItem("token", token);
  } else {
    localStorage.removeItem("token");
  }
}

function getAccessToken() {
  return localStorage.getItem("token");
}

function setAuthEmail(email) {
  if (email) {
    localStorage.setItem("authEmail", email);
  } else {
    localStorage.removeItem("authEmail");
  }
}

function getAuthEmail() {
  return localStorage.getItem("authEmail");
}

function setTenantId(tenantId) {
  if (tenantId) {
    localStorage.setItem("tenantId", String(tenantId));
  } else {
    localStorage.removeItem("tenantId");
  }
}

function getTenantId() {
  const id = localStorage.getItem("tenantId");
  return id ? Number(id) : null;
}

const BRANCH_VIEW_MODE_KEY = "branchViewMode";

function userCanViewAllBranches(user = getUserData()) {
  if (!user) return false;
  if (String(user.role || "").toLowerCase() === "admin") return true;
  const accessMode = user.branchAccessMode || user.branch_access_mode || "all";
  return accessMode !== "custom";
}

function normalizeBranchViewMode(mode) {
  return mode === "all" ? "all" : "single";
}

function setBranchViewMode(mode) {
  const next = normalizeBranchViewMode(mode);
  if (next === "all" && !userCanViewAllBranches()) {
    localStorage.setItem(BRANCH_VIEW_MODE_KEY, "single");
    return;
  }
  localStorage.setItem(BRANCH_VIEW_MODE_KEY, next);
}

function getBranchViewModeRaw() {
  return localStorage.getItem(BRANCH_VIEW_MODE_KEY) || "single";
}

function getBranchViewMode() {
  const raw = getBranchViewModeRaw();
  if (raw === "all" && !userCanViewAllBranches()) {
    localStorage.setItem(BRANCH_VIEW_MODE_KEY, "single");
    return "single";
  }
  return normalizeBranchViewMode(raw);
}

// ✅ NUEVO: Guardar info completa del usuario
function setUserData(user) {
  if (user) {
    localStorage.setItem("user", JSON.stringify(user));
    if (user.tenantId) {
      setTenantId(user.tenantId);
    }
  } else {
    localStorage.removeItem("user");
  }
}

function getUserData() {
  const data = localStorage.getItem("user");
  return data ? JSON.parse(data) : null;
}

/* =========================
   INTERCEPTORS
========================= */

// Request interceptor - agregar token automáticamente
apiClient.interceptors.request.use(
  (config) => {
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Solo agregar para ngrok; en localhost NO
    if (isNgrok) {
      config.headers["ngrok-skip-browser-warning"] = "true";
    }
    const method = (config.method || "get").toLowerCase();
    const viewMode = getBranchViewMode();
    if (
      method === "get" &&
      viewMode === "all" &&
      userCanViewAllBranches() &&
      config.headers?.["X-Branch-Mode"] !== "skip" &&
      (config.params?.branchId === undefined || config.params.branchId === null)
    ) {
      config.params = { ...(config.params || {}), branchId: "all" };
    }
    
    // Agregar timestamp para medir tiempo de respuesta
    config.metadata = { startTime: Date.now() };
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// ================================
// Interceptor de respuesta - Auth
// ================================
let isRefreshing = false;
let refreshPromise = null;

apiClient.interceptors.response.use(
  (response) => {
    // Medir tiempo de respuesta del servidor
    const startTime = response.config?.metadata?.startTime;
    if (startTime) {
      const duration = Date.now() - startTime;
      const url = response.config?.url || 'unknown';
      const method = (response.config?.method || 'get').toUpperCase();
      
      // Registrar estadísticas
      recordRequest(url, duration, false, false);
      
      // Solo loggear peticiones lentas (>1 segundo) o en desarrollo
      if (duration > 1000 || import.meta.env.DEV) {
        logger.log(`[API] ${method} ${url} - ${duration}ms ${duration > 2000 ? '⚠️ LENTO' : ''}`);
      }
      
      // Mostrar advertencia si es muy lento (probable problema del servidor)
      if (duration > 5000) {
        logger.warn(`⚠️ Petición muy lenta (${duration}ms). Posible problema del servidor Railway.`);
      }
    }
    return response;
  },
  async (error) => {
    // Ignorar errores de cancelación (son esperados cuando se cancelan peticiones)
    if (error.code === 'ERR_CANCELED' || error.message === 'canceled') {
      return Promise.reject(error);
    }

    const originalRequest = error.config;
    const status = error.response?.status;
    const url = originalRequest?.url || "";

    // Silenciar errores 403 para working-hours (es normal si no hay permisos)
    const isWorkingHours403 = status === 403 && url.includes('/api/working-hours');
    
    // Medir tiempo incluso en errores
    const startTime = originalRequest?.metadata?.startTime;
    if (startTime && !isWorkingHours403) {
      const duration = Date.now() - startTime;
      const method = (originalRequest?.method || 'get').toUpperCase();
      logger.error(`[API ERROR] ${method} ${url} - ${duration}ms - Status: ${status || 'NO RESPONSE'}`);
      
      // Si no hay status, es probable que sea un error de red o CORS
      if (status === undefined) {
        logger.error(`[API ERROR] Detalles del error sin respuesta:`, {
          code: error.code,
          message: error.message,
          response: error.response ? 'existe' : 'no existe',
          request: originalRequest ? 'existe' : 'no existe',
        });
        if (error.code === 'ERR_NETWORK') {
          logger.error('🌐 ERROR DE RED: No se pudo conectar al servidor. Verificá tu conexión a internet.');
        } else {
          logger.error('❓ ERROR DESCONOCIDO: La petición no obtuvo respuesta del servidor.');
        }
      }
      
      // Si el error es timeout, es probable problema del servidor
      const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
      if (isTimeout) {
        recordRequest(url, duration, true, true);
        logger.error('⏱️ TIMEOUT: El servidor Railway no respondió a tiempo. Verifica el estado del servidor.');
      } else {
        recordRequest(url, duration, true, false);
      }
    }

    // No intentar refresh en endpoints de auth
    const isAuthEndpoint =
      url.includes("/auth/login") ||
      url.includes("/auth/tenant") ||
      url.includes("/auth/refresh") ||
      url.includes("/auth/logout");

    // No intentar refresh si estamos en la página de login o no hay token
    const isOnLoginPage = window.location.pathname === "/login";
    const hasToken = !!getAccessToken();

    // Si es 401 y aún no intentamos refresh
    if (status === 401 && !originalRequest._retry && !isAuthEndpoint && !isOnLoginPage && hasToken) {
      originalRequest._retry = true;

      // Si ya hay un refresh en progreso, esperar a que termine
      if (isRefreshing && refreshPromise) {
        try {
          await refreshPromise;
          // Reintentar la request original con el nuevo token
          return apiClient(originalRequest);
        } catch {
          // Si el refresh falló, continuar con el flujo normal
        }
      }

      // Iniciar nuevo refresh
      isRefreshing = true;
      refreshPromise = authApi.refresh()
        .finally(() => {
          isRefreshing = false;
          refreshPromise = null;
        });

      try {
        const refreshed = await refreshPromise;
        if (refreshed) {
          // Reintentar la request original con el nuevo token
          return apiClient(originalRequest);
        }
      } catch (refreshError) {
        // Refresh falló: limpiar sesión y redirigir al login
        setAccessToken(null);
        setAuthEmail(null);
        setTenantId(null);
        setUserData(null);

        // Solo redirigir si no estamos ya en login
        if (!isOnLoginPage) {
          const next = encodeURIComponent(
            window.location.pathname + window.location.search
          );
          window.location.href = `/login?next=${next}`;
        }

        return Promise.reject(refreshError);
      }
    }

    // Cualquier otro error
    return Promise.reject(error);
  }
);


/* =========================
   AUTH API
========================= */

const authApi = {
  /**
   * Login
   */
  async login(email, password, twoFactorCode = null, rememberDevice = false) {
    try {
      const { data } = await apiClient.post("/auth/login", { 
        email, 
        password,
        twoFactorCode,
        rememberDevice
      });

      // Si requiere 2FA, devolver directamente sin procesar
      if (data?.requiresTwoFactor) {
        return data;
      }

      if (data?.ok) {
        // Caso 1: Multi-tenant (necesita elegir tenant)
        if (data.multiTenant) {
          return data; // { ok, multiTenant, email, tenants }
        }

        // Caso 2: Single tenant (login exitoso)
        if (data.access) {
          setAccessToken(data.access);
          setAuthEmail(data?.user?.email || email);

          // ✅ Guardar tenantId y user data
          if (data.user) {
            setUserData(data.user);
          }
          if (data.tenant?.id) {
            setTenantId(data.tenant.id);
          }
        }
      }

      return data;
    } catch (error) {
      // Si es un error HTTP del backend, devolver el formato esperado
      if (error?.response?.data) {
        return error.response.data;
      }
      // Si no, propagar el error para que se maneje en el componente
      throw error;
    }
  },

  /**
   * Login con tenant específico
   */
  async loginTenant(email, password, slug, twoFactorCode = null, rememberDevice = false) {
    try {
      const { data } = await apiClient.post("/auth/login-tenant", {
        email,
        password,
        slug,
        twoFactorCode,
        rememberDevice
      });

      // Si requiere 2FA, devolver directamente sin procesar
      if (data?.requiresTwoFactor) {
        return data;
      }

      if (data?.ok && data?.access) {
        setAccessToken(data.access);
        setAuthEmail(data?.user?.email || email);

        // ✅ Guardar datos completos
        if (data.user) {
          setUserData(data.user);
        }
        if (data.tenant?.id) {
          setTenantId(data.tenant.id);
        }
      }

      return data;
    } catch (error) {
      // Si es un error HTTP del backend, devolver el formato esperado
      if (error?.response?.data) {
        return error.response.data;
      }
      // Si no, propagar el error para que se maneje en el componente
      throw error;
    }
  },

  /**
   * Logout
   */
  async logout() {
    try {
      await apiClient.post("/auth/logout");
    } catch (e) {
      logger.error("Error en logout:", e);
    }

    // Limpiar todo
    setAccessToken(null);
    setAuthEmail(null);
    setTenantId(null);
    setUserData(null);
  },

  /**
   * Refresh token
   */
  async refresh() {
    try {
      const { data } = await apiClient.post("/auth/refresh", {});

      if (data?.ok && data?.access) {
        setAccessToken(data.access);

        // ✅ Actualizar datos de usuario
        if (data.user) {
          setUserData(data.user);
        }
        if (data.tenant?.id) {
          setTenantId(data.tenant.id);
        }

        return true;
      }

      return false;
    } catch (error) {
      logger.error("Error en refresh:", error);
      return false;
    }
  },

  /**
   * Obtener URL de Google OAuth
   */
  async getGoogleAuthUrl(next = "/") {
    try {
      const { data } = await apiClient.get("/auth/google", {
        params: { next }
      });
      return data?.authUrl || null;
    } catch (error) {
      logger.error("Error obteniendo URL de Google OAuth:", error);
      return null;
    }
  },

  /**
   * Get current user
   */
  async me() {
    try {
      const { data } = await apiClient.get("/auth/me");

      // ✅ Actualizar datos si vienen
      if (data?.ok && data?.user) {
        setUserData(data.user);

        if (data.user.tenantId && !getTenantId()) {
          setTenantId(data.user.tenantId);
        }
      }

      return data;
    } catch (error) {
      logger.error("Error en me:", error);
      throw error;
    }
  },

  /**
   * Verificar si está autenticado
   */
  isAuthenticated() {
    return !!getAccessToken();
  },

  /**
   * Obtener token actual
   */
  getToken() {
    return getAccessToken();
  },

  /**
   * Obtener tenant ID actual
   */
  getTenantId() {
    return getTenantId();
  },

  /**
   * Obtener datos de usuario
   */
  getUser() {
    return getUserData();
  },

  /**
   * 2FA: Setup (generar QR code)
   */
  async setup2FA() {
    try {
      const { data } = await apiClient.post("/auth/2fa/setup");
      return data;
    } catch (error) {
      logger.error("Error en setup2FA:", error);
      if (error?.response?.data) {
        return error.response.data;
      }
      throw error;
    }
  },

  /**
   * 2FA: Verificar código y activar
   */
  async verify2FA(code) {
    try {
      const { data } = await apiClient.post("/auth/2fa/verify", { code });
      return data;
    } catch (error) {
      logger.error("Error en verify2FA:", error);
      if (error?.response?.data) {
        return error.response.data;
      }
      throw error;
    }
  },

  /**
   * 2FA: Desactivar
   */
  async disable2FA(password) {
    try {
      const { data } = await apiClient.post("/auth/2fa/disable", { password });
      return data;
    } catch (error) {
      logger.error("Error en disable2FA:", error);
      if (error?.response?.data) {
        return error.response.data;
      }
      throw error;
    }
  },

  /**
   * 2FA: Obtener estado
   */
  async get2FAStatus() {
    try {
      const { data } = await apiClient.get("/auth/2fa/status");
      return data;
    } catch (error) {
      logger.error("Error en get2FAStatus:", error);
      if (error?.response?.data) {
        return error.response.data;
      }
      throw error;
    }
  },
};

/* =========================
   CONFIG API
========================= */

apiClient.getConfig = async function () {
  try {
    const { data } = await apiClient.get("/api/config");
    return data;
  } catch (error) {
    logger.error("Error obteniendo config:", error);
    return {};
  }
};

apiClient.updateConfig = async function (config) {
  const { data } = await apiClient.put("/api/config", config);
  return data;
};

/* =========================
   BRANCHES API
========================= */

apiClient.listBranches = async function () {
  try {
    const { data } = await apiClient.get("/api/branches", {
      headers: { "X-Branch-Mode": "skip" },
    });
    logger.log("[apiClient.listBranches] Respuesta completa:", data);
    // El endpoint retorna { ok: true, data: [...] }
    const branches = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    logger.log("[apiClient.listBranches] Sucursales extraídas:", branches);
    return branches;
  } catch (error) {
    logger.error("[apiClient.listBranches] Error:", error);
    logger.error("[apiClient.listBranches] Error response:", error.response?.data);
    throw error;
  }
};

apiClient.createBranch = async function (payload) {
  const { data } = await apiClient.post("/api/branches", payload);
  return data;
};

apiClient.updateBranch = async function (id, payload) {
  const { data } = await apiClient.put(`/api/branches/${id}`, payload);
  return data;
};

apiClient.deleteBranch = async function (id) {
  const { data } = await apiClient.delete(`/api/branches/${id}`);
  return data;
};

apiClient.listActiveBranches = async function () {
  const { data } = await apiClient.get("/api/branches/catalog", {
    headers: { "X-Branch-Mode": "skip" },
  });
  return data;
};

apiClient.setCurrentBranch = async function (branchId) {
  const { data } = await apiClient.post("/api/branches/current", { branchId });
  return data;
};

/* =========================
   SERVICES API
========================= */

apiClient.listServices = async function ({ active = true } = {}) {
  const params = active ? { active: 1 } : {};
  const { data } = await apiClient.get("/api/meta/services", { params });
  return data?.data || [];
};

/* =========================
   STYLISTS API
========================= */

apiClient.listInstructors = async function ({ active = true } = {}) {
  const params = active ? { active: 1 } : {};
  const { data } = await apiClient.get("/api/meta/instructors", { params });
  return data?.data || [];
};

apiClient.adminListInstructors = async function () {
  const { data } = await apiClient.get("/api/admin/instructors");
  return data?.data || [];
};

apiClient.adminCreateInstructor = async function (payload) {
  const { data } = await apiClient.post("/api/admin/instructors", payload);
  return data;
};

apiClient.adminUpdateInstructor = async function (id, payload) {
  const { data } = await apiClient.put(`/api/admin/instructors/${id}`, payload);
  return data;
};

apiClient.adminDeleteInstructor = async function (id) {
  const { data } = await apiClient.delete(`/api/admin/instructors/${id}`);
  return data;
};

apiClient.adminListServices = async function () {
  const { data } = await apiClient.get("/api/admin/services");
  return data?.data || [];
};

apiClient.adminCreateService = async function (payload) {
  const { data } = await apiClient.post("/api/admin/services", payload);
  return data;
};

apiClient.adminUpdateService = async function (id, payload) {
  const { data } = await apiClient.put(`/api/admin/services/${id}`, payload);
  return data;
};

apiClient.adminDeleteService = async function (id) {
  const { data } = await apiClient.delete(`/api/admin/services/${id}`);
  return data;
};

/* =========================
   AVAILABILITY API
========================= */

apiClient.getAvailability = async function ({ instructorId, serviceId, date }) {
  const { data } = await apiClient.get("/api/availability", {
    params: { instructorId, serviceId, date },
  });
  return data;
};

/* =========================
   APPOINTMENTS API
========================= */

apiClient.createAppointment = async function (appointmentData) {
  const { data } = await apiClient.post("/api/appointments", appointmentData);
  return data;
};

apiClient.createRecurringAppointments = async function (payload) {
  const { data } = await apiClient.post("/api/appointments/recurring", payload);
  return data;
};

apiClient.deleteAppointment = async function (id) {
  const { data } = await apiClient.delete(`/api/appointments/${id}`);
  return data;
};

apiClient.cancelAppointmentSeries = async function (seriesId, { includePast = false, notify = true } = {}) {
  const params = {};
  if (includePast) params.includePast = "true";
  if (!notify) params.notify = "false";
  const { data } = await apiClient.delete(`/api/appointments/series/${seriesId}`, { params });
  return data;
};

apiClient.updateAppointment = async function (id, updates) {
  const { data } = await apiClient.patch(`/api/appointments/${id}`, updates);
  return data;
};

apiClient.listAppointments = async function ({ from, to, instructorId, _t } = {}) {
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  if (instructorId) params.instructorId = instructorId;
  if (_t) params._t = _t; // Cache-busting parameter
  const { data } = await apiClient.get("/api/appointments", { params });
  return data;
};

/* =========================
   PAYMENTS API
========================= */

apiClient.createPaymentPreference = async function (appointmentId) {
  const { data } = await apiClient.post("/api/payments/preference", {
    appointmentId,
  });
  return data;
};

apiClient.createManualPayment = async function (paymentData) {
  const { data } = await apiClient.post("/api/payments/manual", paymentData);
  return data;
};

apiClient.checkPaymentStatus = async function (appointmentId) {
  const { data } = await apiClient.get(`/api/payments/status/${appointmentId}`);
  return data;
};

apiClient.listPayments = async function (params = {}) {
  const { data } = await apiClient.get("/api/payments", { params });
  return data;
};

apiClient.getPaymentStats = async function ({ from, to } = {}) {
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  const { data } = await apiClient.get("/api/payments/stats", { params });
  return data?.stats || {};
};

/* =========================
   MERCADO PAGO OAUTH API
========================= */

apiClient.getMPAuthUrl = async (opts = {}) => {
  const params = {};
  if (opts.fresh) params.fresh = 1;
  if (opts.returnTo) params.return_to = opts.returnTo;
  const { data } = await apiClient.get("/mp/oauth/connect", { params });
  return data;
};
apiClient.getMPStatus = async function () {
  const { data } = await apiClient.get("/mp/oauth/status");
  return data;
};

apiClient.disconnectMP = async function () {
  const { data } = await apiClient.post("/mp/oauth/disconnect");
  return data;
};

apiClient.getMPConnectedAccounts = async function () {
  const { data } = await apiClient.get("/mp/oauth/connected-accounts");
  return data;
};

/* =========================
   CUSTOMERS API
========================= */

apiClient.listCustomers = async function (q = "", signal, options = {}) {
  const params = { q };
  if (options.page) params.page = options.page;
  if (options.limit) params.limit = options.limit;
  
  const { data } = await apiClient.get("/api/admin/customers", {
    params,
    signal,
  });
  
  // Si viene con paginación, devolver objeto completo, sino solo el array
  if (data?.pagination) {
    return {
      data: data.data || [],
      pagination: data.pagination
    };
  }
  
  return data?.data || [];
};

apiClient.customerDetail = async function (customerId, signal) {
  if (!customerId) throw new Error("customerId es requerido");
  const { data } = await apiClient.get(`/api/admin/customers/${customerId}`, { signal });
  return data?.data || data || null;
};

// =========================
//   MOBILE APP SETTINGS
// =========================
apiClient.getCustomerAppSettings = async function (customerId) {
  if (!customerId) throw new Error("customerId es requerido");
  const { data } = await apiClient.get(`/api/customers/${customerId}/app-settings`);
  return data?.data ?? data ?? null;
};

/* =========================
   CRM API
========================= */
apiClient.crmListSegments = async function () {
  const { data } = await apiClient.get("/api/crm/segments/presets");
  return data?.data ?? data ?? [];
};

apiClient.crmListCustomSegments = async function () {
  const { data } = await apiClient.get("/api/crm/segments/custom");
  return data?.data ?? data ?? [];
};

apiClient.crmCreateCustomSegment = async function (payload) {
  const { data } = await apiClient.post("/api/crm/segments/custom", payload);
  return data;
};

apiClient.crmUpdateCustomSegment = async function (code, payload) {
  const { data } = await apiClient.put(`/api/crm/segments/custom/${encodeURIComponent(code)}`, payload);
  return data;
};

apiClient.crmDeleteCustomSegment = async function (code) {
  const { data } = await apiClient.delete(`/api/crm/segments/custom/${encodeURIComponent(code)}`);
  return data;
};

apiClient.crmGetSegment = async function (code) {
  if (!code) throw new Error("code es requerido");
  const { data } = await apiClient.get(`/api/crm/segments/${encodeURIComponent(code)}`, { params: { limit: 200 } });
  return data;
};

apiClient.crmSendCampaign = async function ({ segmentCode, message, preview = false, max = 50 }) {
  const { data } = await apiClient.post("/api/crm/campaigns/send", { segmentCode, message, preview, max });
  return data;
};

apiClient.crmListSchedules = async function () {
  const { data } = await apiClient.get("/api/crm/campaigns/schedules");
  return data?.data ?? data ?? [];
};

apiClient.crmCreateSchedule = async function (payload) {
  const { data } = await apiClient.post("/api/crm/campaigns/schedules", payload);
  return data;
};

apiClient.crmDeleteSchedule = async function (id) {
  const { data } = await apiClient.delete(`/api/crm/campaigns/schedules/${encodeURIComponent(id)}`);
  return data;
};

apiClient.crmListHistory = async function () {
  const { data } = await apiClient.get("/api/crm/campaigns/history");
  return data?.data ?? data ?? [];
};
apiClient.updateCustomerAppSettings = async function (customerId, payload) {
  if (!customerId) throw new Error("customerId es requerido");
  const { data } = await apiClient.put(`/api/customers/${customerId}/app-settings`, payload);
  return data?.data ?? data ?? null;
};

apiClient.updateCustomer = async function (customerId, payload) {
  if (!customerId) throw new Error("customerId es requerido");
  const { data } = await apiClient.put(`/api/customers/${customerId}`, payload);
  return data?.data || data || null;
};

/* =========================
   WORKOUT ROUTINES API
========================= */

apiClient.getAvailableRoutines = async function () {
  const { data } = await apiClient.get("/api/workout-routines/available");
  return data?.data || data || [];
};

apiClient.getCustomerRoutines = async function (customerId) {
  const { data } = await apiClient.get(`/api/workout-routines/customer/${customerId}`);
  return data?.data || data || [];
};

apiClient.assignRoutineToCustomer = async function (routineId, customerId) {
  const { data } = await apiClient.put(`/api/workout-routines/${routineId}/assign`, { customer_id: customerId });
  return data;
};

apiClient.generateWorkoutRoutine = async function (params) {
  const { data } = await apiClient.post("/api/workout-routines/generate", params);
  return data;
};

apiClient.createWorkoutRoutine = async function (params) {
  const { data } = await apiClient.post("/api/workout-routines", params);
  return data;
};

apiClient.getWorkoutRoutine = async function (routineId) {
  const { data } = await apiClient.get(`/api/workout-routines/${routineId}`);
  return data?.data || data || null;
};

apiClient.updateWorkoutRoutine = async function (routineId, params) {
  const { data } = await apiClient.put(`/api/workout-routines/${routineId}`, params);
  return data;
};

apiClient.uploadWorkoutVideo = async function (file) {
  const formData = new FormData();
  formData.append('video', file);
  const { data } = await apiClient.post("/api/workout-routines/upload/video", formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    // Axios necesita que no establezcamos Content-Type manualmente para FormData
    transformRequest: [(data) => data],
  });
  return data;
};

apiClient.uploadWorkoutImage = async function (file) {
  const formData = new FormData();
  formData.append('image', file);
  const { data } = await apiClient.post("/api/workout-routines/upload/image", formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    // Axios necesita que no establezcamos Content-Type manualmente para FormData
    transformRequest: [(data) => data],
  });
  return data;
};

apiClient.importWorkoutRoutines = async function (routines) {
  const { data } = await apiClient.post("/api/workout-routines/import", { routines });
  return data;
};

apiClient.importWorkoutRoutineFromWord = async function (file) {
  const formData = new FormData();
  formData.append('word', file);
  const { data } = await apiClient.post("/api/workout-routines/import/word", formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    transformRequest: [(data) => data],
  });
  return data;
};

apiClient.deleteWorkoutRoutine = async function (routineId) {
  const { data } = await apiClient.delete(`/api/workout-routines/${routineId}`);
  return data;
};

apiClient.getBodyParts = async function () {
  const { data } = await apiClient.get("/api/workout-routines/body-parts");
  return data?.data || data || [];
};

/* =========================
   CALENDAR API
========================= */

apiClient.getCalendarDay = async function ({ date, instructorId } = {}) {
  const params = { date };
  if (instructorId) params.instructorId = instructorId;
  const { data } = await apiClient.get("/api/calendar/day", { params });
  return data;
};

apiClient.getCalendarRange = async function ({ from, to, instructorId } = {}) {
  const params = { from, to };
  if (instructorId) params.instructorId = instructorId;
  const { data } = await apiClient.get("/api/calendar/range", { params });
  return data;
};
apiClient.getUnreadCount = async function () {
  try {
    const response = await apiClient.get("/api/notifications/count");
    const data = response.data;
    // El backend devuelve { ok: true, count: ... }
    if (data?.ok && typeof data.count === "number") {
      return { count: data.count };
    }
    // Fallback para otras estructuras
    if (typeof data === "number") return { count: data };
    if (typeof data?.count === "number") return { count: data.count };
    return { count: 0 };
  } catch (error) {
    logger.error("Error obteniendo unread count:", error);
    return { count: 0 };
  }
};

/* =========================
   NOTIFICATIONS API
========================= */
apiClient.sendNotificationToCustomer = async function (userId, { type = "info", title, message, data = {} } = {}) {
  if (!userId) throw new Error("userId es requerido");
  const payload = { userId, type, title, message, data };
  const { data: res } = await apiClient.post("/api/notifications", payload);
  return res;
};

apiClient.getCommissions = async function (params = {}) {
  try {
    const { data } = await apiClient.get("/api/commissions", { params });
    // si tu endpoint devuelve { ok, data: [...] }
    if (Array.isArray(data?.data)) return data.data;
    return data;
  } catch (error) {
    logger.error("❌ [getCommissions] Error:", error);
    return [];
  }
};
apiClient.updateCommission = async function (instructorId, percentage) {
  try {
    const { data } = await apiClient.put(`/api/commissions/${instructorId}`, {
      percentage: Number(percentage),
    });
    return data;
  } catch (error) {
    logger.error("❌ [updateCommission] Error:", error);
    throw error;
  }
};
/* =========================
   STYLIST STATS API
========================= */
apiClient.getInstructorStatsRange = async function ({ from, to, instructorId }) {
  if (!instructorId) throw new Error("instructorId es requerido");
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  const { data } = await apiClient.get(`/api/stats/${encodeURIComponent(instructorId)}`, { params });
  return data ?? {};
};
/* =========================
   WORKING HOURS API
========================= */
// Muchos routers de hours requieren instructorId. Envíalo siempre si lo tenés.
apiClient.getWorkingHours = async function ({ instructorId } = {}) {
  const params = {};
  if (instructorId) params.instructorId = instructorId;
  try {
    const { data } = await apiClient.get("/api/working-hours", { params });
    return toArray(data); // <-- siempre array
  } catch (error) {
    // Si es un error 403 (sin permisos), retornar array vacío silenciosamente
    // Esto es normal si el usuario no tiene permisos para ver horarios de instructores
    if (error?.response?.status === 403) {
      return [];
    }
    // Re-lanzar otros errores
    throw error;
  }
};

apiClient.saveWorkingHours = async function ({ instructorId, hours }) {
  const { data } = await apiClient.put("/api/working-hours", { instructorId, hours });
  return data;
};

/* =========================
   DAYS OFF / BLOQUEOS API
========================= */
apiClient.listDaysOff = async function ({ from, to, instructorId } = {}) {
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  if (instructorId) params.instructorId = instructorId;
  const { data } = await apiClient.get("/api/days-off", { params });
  return toArray(data); // <-- siempre array
};

/* =========================
   DAYS OFF / BLOQUEOS API
========================= */
apiClient.listDaysOff = async function ({ from, to, instructorId } = {}) {
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  if (instructorId) params.instructorId = instructorId;
  const { data } = await apiClient.get("/api/days-off", { params });
  return data?.data ?? data ?? [];
};
apiClient.createDayOff = async function (payload) {
  const { data } = await apiClient.post("/api/days-off", payload);
  return data;
};
apiClient.deleteDayOff = async function (id) {
  const { data } = await apiClient.delete(`/api/days-off/${id}`);
  return data;
};
apiClient.createRecurringDaysOff = async function (payload) {
  const { data } = await apiClient.post("/api/days-off/recurring", payload);
  return data;
};
/* =========================
   CONFIG API (match backend)
========================= */

// Lee una sección
apiClient.getConfigSection = async function (section) {
  if (!section) throw new Error("section es requerido");
  if (section === "general") {
    const { data } = await apiClient.get("/api/config"); // <-- GET sin sección
    return data?.data ?? data ?? {};
  } else if (section === "deposit") {
    const { data } = await apiClient.get("/api/config/deposit");
    return data?.data ?? data ?? {};
  } else {
    const { data } = await apiClient.get(`/api/config/${encodeURIComponent(section)}`);
    return data?.data ?? data ?? {};
  }
};

// Guarda una sección
apiClient.saveConfigSection = async function (section, payload) {
  if (!section) throw new Error("section es requerido");
  if (section === "general") {
    const { data } = await apiClient.put("/api/config/general", payload);
    return data?.data ?? data ?? {};
  } else if (section === "deposit") {
    const { data } = await apiClient.put("/api/config/deposit", payload);
    return data?.data ?? data ?? {};
  } else {
    const { data } = await apiClient.put(`/api/config/${encodeURIComponent(section)}`, payload);
    return data?.data ?? data ?? {};
  }
};

// Lee todo (equivalente a la sección general)
apiClient.getAllConfig = async function () {
  const { data } = await apiClient.get("/api/config");
  return data?.data ?? data ?? {};
};

// Bulk update: body con claves completas "section.key"
apiClient.saveConfigBulk = async function (updates) {
  const { data } = await apiClient.put("/api/config", updates);
  return data?.data ?? data ?? {};
};

apiClient.payPlanManual = async function (payload = {}) {
  const { data } = await apiClient.post("/api/config/subscription/manual-charge", payload);
  return data?.data ?? data ?? {};
};

apiClient.getAppointmentsConfig = async function () {
  const { data } = await apiClient.get("/api/config/appointments");
  return data?.data ?? data ?? {};
};

apiClient.saveAppointmentsConfig = async function (payload = {}) {
  const { data } = await apiClient.put("/api/config/appointments", payload);
  return data?.data ?? data ?? {};
};

apiClient.getWhatsAppConfig = async function () {
  const { data } = await apiClient.get("/api/config/whatsapp");
  return data?.data ?? data ?? {};
};

apiClient.saveWhatsAppConfig = async function (payload) {
  const { data } = await apiClient.put("/api/config/whatsapp", payload);
  return data?.data ?? data ?? {};
};

apiClient.listMembershipPlans = async function () {
  const { data } = await apiClient.get("/api/memberships/plans");
  return data?.data ?? data ?? [];
};

apiClient.getMyMembership = async function () {
  try {
    const { data } = await apiClient.get("/api/memberships/my");
    return data?.data ?? data ?? null;
  } catch (error) {
    // Si no hay suscripción (404), devolver null en lugar de lanzar error
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
};

apiClient.createMembershipPlan = async function (payload = {}) {
  const { data } = await apiClient.post("/api/memberships/plans", payload);
  return data?.data ?? data ?? {};
};

apiClient.updateMembershipPlan = async function (id, payload = {}) {
  const { data } = await apiClient.put(`/api/memberships/plans/${id}`, payload);
  return data?.data ?? data ?? {};
};

apiClient.deleteMembershipPlan = async function (id) {
  const { data } = await apiClient.delete(`/api/memberships/plans/${id}`);
  return data?.data ?? data ?? {};
};

apiClient.testWhatsAppConfig = async function (payload) {
  const { data } = await apiClient.post("/api/config/whatsapp/test", payload);
  return data;
};

/* =========================
   WHATSAPP OAUTH API
========================= */

apiClient.getWhatsAppAuthUrl = async function () {
  const { data } = await apiClient.get("/api/config/whatsapp/connect");
  return data;
};

apiClient.disconnectWhatsApp = async function () {
  const { data } = await apiClient.delete("/api/config/whatsapp/disconnect");
  return data;
};

apiClient.refreshWhatsAppPhoneId = async function () {
  const { data } = await apiClient.post("/api/config/whatsapp/refresh-phone-id");
  return data;
};

/* =========================
   TENANT / FEATURES API
========================= */

apiClient.getTenantBusinessInfo = async function () {
  const { data } = await apiClient.get("/api/business-types/tenant/business-type");
  return data?.data ?? data ?? null;
};

/* =========================
   CLASSES API
========================= */

apiClient.listClassTemplates = async function () {
  const { data } = await apiClient.get("/api/classes/templates");
  if (Array.isArray(data)) return data;
  return data?.data ?? data ?? [];
};

apiClient.createClassTemplate = async function (payload) {
  const { data } = await apiClient.post("/api/classes/templates", payload);
  return data;
};

apiClient.updateClassTemplate = async function (id, payload) {
  const { data } = await apiClient.put(`/api/classes/templates/${id}`, payload);
  return data;
};

apiClient.listClassSessions = async function ({ from, to, status, instructorId, activityType, _t } = {}) {
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  if (status) params.status = status;
  if (instructorId) params.instructorId = instructorId;
  if (activityType) params.activityType = activityType;
  if (_t) params._t = _t; // Cache-busting parameter
  const { data } = await apiClient.get("/api/classes/sessions", { params });
  if (Array.isArray(data)) return data;
  return data?.data ?? data ?? [];
};

apiClient.createClassSession = async function (payload) {
  const { data } = await apiClient.post("/api/classes/sessions", payload);
  return data;
};

apiClient.getClassSession = async function (id) {
  const { data } = await apiClient.get(`/api/classes/sessions/${id}`);
  return data?.data ?? data ?? null;
};

apiClient.updateClassSession = async function (id, payload) {
  const { data } = await apiClient.patch(`/api/classes/sessions/${id}`, payload);
  return data;
};

apiClient.cancelClassSession = async function (id) {
  const { data } = await apiClient.delete(`/api/classes/sessions/${id}`);
  return data;
};

apiClient.createClassEnrollment = async function (sessionId, payload) {
  const { data } = await apiClient.post(`/api/classes/sessions/${sessionId}/enrollments`, payload);
  return data;
};

apiClient.cancelClassSeriesEnrollments = async function (seriesId, payload) {
  const { data } = await apiClient.post(`/api/classes/series/${seriesId}/enrollments/cancel`, payload);
  return data;
};

apiClient.updateClassEnrollment = async function (sessionId, enrollmentId, payload) {
  const { data } = await apiClient.patch(
    `/api/classes/sessions/${sessionId}/enrollments/${enrollmentId}`,
    payload
  );
  return data;
};

apiClient.deleteClassEnrollment = async function (sessionId, enrollmentId) {
  const { data } = await apiClient.delete(
    `/api/classes/sessions/${sessionId}/enrollments/${enrollmentId}`
  );
  return data;
};

apiClient.updateClassSeries = async function (seriesId, payload) {
  const { data } = await apiClient.put(`/api/classes/series/${encodeURIComponent(seriesId)}`, payload);
  return data;
};

apiClient.cancelClassSeries = async function (seriesId) {
  const { data } = await apiClient.post(`/api/classes/series/${encodeURIComponent(seriesId)}/cancel`);
  return data;
};

// Actualizar estado de suscripción (paused, authorized, cancelled)
apiClient.updateSubscriptionStatus = async function (subscriptionId, status) {
  const { data } = await apiClient.patch(`/api/subscriptions/${subscriptionId}`, { status });
  return data;
};

// Crear link de pago genérico
apiClient.createPaymentLink = async function ({ amount, title, description, customerId, expiresInDays }) {
  const { data } = await apiClient.post("/api/payments/create-link", {
    amount,
    title,
    description,
    customerId,
    expiresInDays,
  });
  return data;
};

// Enviar link de pago por WhatsApp
apiClient.sendPaymentLinkWhatsApp = async function ({ customerId, link, message }) {
  const { data } = await apiClient.post("/api/payments/send-whatsapp", {
    customerId,
    link,
    message,
  });
  return data;
};

/* =========================
   SUPER ADMIN API
========================= */

apiClient.superAdmin = {
  async listTenants(params = {}, options = {}) {
    const { data } = await apiClient.get("/api/super-admin/tenants", {
      params,
      signal: options.signal,
    });
    return data;
  },

  async getTenant(id, params = {}, options = {}) {
    if (!id) throw new Error("tenantId es requerido");
    const { data } = await apiClient.get(`/api/super-admin/tenants/${id}`, {
      params,
      signal: options.signal,
    });
    return data;
  },

  async createTenant(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("payload es requerido");
    }
    const { data } = await apiClient.post("/api/super-admin/tenants", payload);
    return data;
  },

  async updateTenant(id, payload) {
    if (!id) throw new Error("tenantId es requerido");
    if (!payload || typeof payload !== "object") {
      throw new Error("payload es requerido");
    }
    const { data } = await apiClient.patch(`/api/super-admin/tenants/${id}`, payload);
    return data;
  },

  async updateTenantBusiness(id, payload) {
    if (!id) throw new Error("tenantId es requerido");
    const { data } = await apiClient.patch(`/api/super-admin/tenants/${id}/business`, payload);
    return data;
  },

  async updateTenantPlan(id, payload) {
    if (!id) throw new Error("tenantId es requerido");
    const { data } = await apiClient.patch(`/api/super-admin/tenants/${id}/plan`, payload);
    return data;
  },

  async updateTenantFeatures(id, payload) {
    if (!id) throw new Error("tenantId es requerido");
    const { data } = await apiClient.patch(`/api/super-admin/tenants/${id}/features`, payload);
    return data;
  },

  async getTenantWhatsApp(id) {
    if (!id) throw new Error("tenantId es requerido");
    const { data } = await apiClient.get(`/api/super-admin/tenants/${id}/whatsapp`);
    return data;
  },

  async upsertTenantWhatsAppCredentials(id, payload) {
    if (!id) throw new Error("tenantId es requerido");
    if (!payload || typeof payload !== "object") {
      throw new Error("payload es requerido");
    }
    const { data } = await apiClient.put(
      `/api/super-admin/tenants/${id}/whatsapp/credentials`,
      payload
    );
    return data;
  },

  async clearTenantWhatsAppCredentials(id) {
    if (!id) throw new Error("tenantId es requerido");
    const { data } = await apiClient.delete(
      `/api/super-admin/tenants/${id}/whatsapp/credentials`
    );
    return data;
  },

  async listBusinessTypes() {
    const { data } = await apiClient.get("/api/super-admin/business-types");
    return data?.data || [];
  },
};

/* =========================
   ONBOARDING PUBLIC API
========================= */

apiClient.onboarding = {
  checkEmail: async function (email) {
    const { data } = await apiClient.get("/public/onboarding/check-email", {
      params: { email }
    });
    return data;
  },
  async start(payload) {
    const { data } = await apiClient.post("/public/onboarding/start", payload);
    return data;
  },

  async saveBusiness(sessionId, payload) {
    const { data } = await apiClient.patch(
      `/public/onboarding/${encodeURIComponent(sessionId)}/business`,
      payload
    );
    return data;
  },

  async saveBranding(sessionId, payload) {
    const { data } = await apiClient.patch(
      `/public/onboarding/${encodeURIComponent(sessionId)}/branding`,
      payload
    );
    return data;
  },

  async recommendPlan(sessionId) {
    const { data } = await apiClient.post(
      `/public/onboarding/${encodeURIComponent(sessionId)}/recommend-plan`
    );
    return data;
  },

  async checkSubdomain(slug) {
    const { data } = await apiClient.get("/public/onboarding/check-subdomain", {
      params: { slug },
    });
    return data;
  },

  async finish(sessionId, payload) {
    const { data } = await apiClient.post(
      `/public/onboarding/${encodeURIComponent(sessionId)}/finish`,
      payload
    );
    return data;
  },

  async createSubscription(sessionId, payload = {}) {
    const { data } = await apiClient.post(
      `/public/onboarding/${encodeURIComponent(sessionId)}/create-subscription`,
      payload
    );
    return data;
  },

  async subscriptionStatus(sessionId) {
    const { data } = await apiClient.get(
      `/public/onboarding/${encodeURIComponent(sessionId)}/subscription-status`
    );
    return data;
  },

  async resendActivation(email) {
    const { data } = await apiClient.post("/public/onboarding/resend-activation", { email });
    return data;
  },
};

/* =========================
   ARCA / FACTURACIÓN API
========================= */
apiClient.verifyArcaConnection = async function () {
  const { data } = await apiClient.get("/api/invoicing/arca/verify");
  return data;
};

apiClient.testArcaInvoice = async function () {
  const { data } = await apiClient.post("/api/invoicing/arca/test");
  return data;
};

/* =========================
   DASHBOARD API
========================= */

apiClient.getAdminDashboard = async function ({ date, from, to } = {}) {
  const params = {};
  if (date) params.date = date;
  if (from) params.from = from;
  if (to) params.to = to;
  const { data } = await apiClient.get("/api/dashboard/summary", { params });
  
  // Transformar la respuesta para que coincida con lo que espera el frontend
  if (data?.ok && data?.data) {
    const byStatus = data.data.byStatus || {};
    return {
      ok: true,
      data: {
        today: {
          total: Object.values(byStatus).reduce((sum, val) => sum + Number(val || 0), 0),
          confirmed: Number(byStatus.confirmed || 0) + Number(byStatus.completed || 0),
          pending: Number(byStatus.pending_deposit || 0),
          scheduled: Number(byStatus.scheduled || 0),
        },
        upcoming: data.data.upcoming || [],
        customersTotal: data.data.customersTotal || 0,
        amountToday: data.data.amountToday || 0,
        deposits: {
          rangeAmount: data.data.amountToday || 0, // Para compatibilidad con semana
        }
      }
    };
  }
  return data;
};

apiClient.getTopServices = async function ({ months = 3, limit = 6 } = {}) {
  const { data } = await apiClient.get("/api/admin/charts/top-services", {
    params: { months, limit }
  });
  return data?.data || [];
};

apiClient.getIncomeByMonth = async function (year) {
  const { data } = await apiClient.get("/api/admin/charts/income-by-month", {
    params: { year }
  });
  return data?.data || [];
};

apiClient.getAgendaToday = async function () {
  const { data } = await apiClient.get("/api/admin/agenda/today");
  return data?.data || [];
};

/* =========================
   STOCK RESERVATIONS API
========================= */

apiClient.listStockReservations = async function (params = {}) {
  const { data } = await apiClient.get("/api/stock/reservations", { params });
  return data?.data || [];
};

apiClient.createStockReservation = async function (payload) {
  const { data } = await apiClient.post("/api/stock/reservations", payload);
  return data;
};

apiClient.cancelStockReservation = async function (id) {
  const { data } = await apiClient.put(`/api/stock/reservations/${id}/cancel`);
  return data;
};

apiClient.fulfillStockReservation = async function (id) {
  const { data } = await apiClient.put(`/api/stock/reservations/${id}/fulfill`);
  return data;
};

/* =========================
   STOCK TRANSFERS API
========================= */

apiClient.listStockTransfers = async function (params = {}) {
  const { data } = await apiClient.get("/api/stock/transfers", { params });
  return data?.data || [];
};

apiClient.createStockTransfer = async function (payload) {
  const { data } = await apiClient.post("/api/stock/transfers", payload);
  return data;
};

apiClient.confirmStockTransfer = async function (id) {
  const { data } = await apiClient.put(`/api/stock/transfers/${id}/confirm`);
  return data;
};

apiClient.cancelStockTransfer = async function (id, notes) {
  const { data } = await apiClient.put(`/api/stock/transfers/${id}/cancel`, { notes });
  return data;
};

/* =========================
   STOCK ALERTS API
========================= */

apiClient.listStockAlerts = async function (params = {}) {
  const { data } = await apiClient.get("/api/stock/alerts", { params });
  return data?.data || [];
};

apiClient.generateStockAlerts = async function () {
  const { data } = await apiClient.post("/api/stock/alerts/generate");
  return data;
};

apiClient.acknowledgeStockAlert = async function (id) {
  const { data } = await apiClient.put(`/api/stock/alerts/${id}/acknowledge`);
  return data;
};

apiClient.dismissStockAlert = async function (id) {
  const { data } = await apiClient.put(`/api/stock/alerts/${id}/dismiss`);
  return data;
};

/* =========================
   STOCK VALUATION API
========================= */

apiClient.getInventoryValuation = async function (params = {}) {
  const { data } = await apiClient.get("/api/stock/valuation", { params });
  return data?.data || {};
};

apiClient.getInventoryValuationDetail = async function (params = {}) {
  const { data } = await apiClient.get("/api/stock/valuation/detail", { params });
  return data?.data || [];
};

/* =========================
   EXPORT
========================= */

export {
  // Storage helpers
  setAccessToken,
  getAccessToken,
  setAuthEmail,
  getAuthEmail,
  setTenantId,
  getTenantId,
  setUserData,
  getUserData,
  setBranchViewMode,
  getBranchViewMode,

  // Auth API
  authApi,

  // Main client
  apiClient,
};

export default apiClient;
