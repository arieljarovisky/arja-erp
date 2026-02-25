// ===== Customers =====
// públicos (ABM)
const PATH_CUSTOMERS = "/api/customers";
// admin (búsqueda/tabla)
const PATH_CUSTOMERS_ADMIN = "/api/admin/customers";

// Listado/búsqueda pública (si tu backend lo soporta)
apiClient.getCustomers = async function ({ q, page, limit } = {}) {
  const params = {};
  if (q) params.q = q;
  if (page) params.page = page;
  if (limit) params.limit = limit;
  const { data } = await apiClient.get(PATH_CUSTOMERS, { params });
  return data;
};

// Crear
apiClient.createCustomer = async function (payload) {
  const { data } = await apiClient.post(PATH_CUSTOMERS, payload);
  return data;
};

// Actualizar
apiClient.updateCustomer = async function (id, patch) {
  const { data } = await apiClient.put(`${PATH_CUSTOMERS}/${id}`, patch);
  return data;
};

// Eliminar
apiClient.deleteCustomer = async function (id) {
  const { data } = await apiClient.delete(`${PATH_CUSTOMERS}/${id}`);
  return data;
};

// -------- Admin (requiere rol admin/staff) --------
apiClient.searchAdminCustomers = async function (q = "") {
  const params = q ? { q } : {};
  const { data } = await apiClient.get(PATH_CUSTOMERS_ADMIN, { params });
  return data; // tipicamente { rows, total } o array
};

// ✅ Alias para compatibilidad con el código existente:
apiClient.customers = apiClient.searchAdminCustomers;
