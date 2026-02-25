// src/api/index.js

// ✅ Exportar todas las funciones de cliente API
export {
  apiClient,
  authApi,
  setAccessToken,
  getAccessToken,
  setAuthEmail,
  getAuthEmail,
  setTenantId,    // ✅ NUEVO: gestión de tenant
  getTenantId,    // ✅ NUEVO: gestión de tenant
} from "./client";

// Compatibilidad con código viejo que esperaba { api }
export { apiClient as api } from "./client";