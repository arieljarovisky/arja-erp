import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Search,
  Plus,
  RefreshCw,
  Eye,
  Edit,
  Shield,
  Users,
  CalendarCheck,
  Building2,
  Rocket,
  Phone,
  Power,
  Clock,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client.js";
import { useQuery } from "../../shared/useQuery.js";
import { useDebouncedValue } from "../../shared/useDebouncedValue.js";

const FEATURE_KEYS = ["appointments", "stock", "invoicing", "classes", "multiBranch"];
const FEATURE_LABELS = {
  appointments: "Turnos",
  stock: "Gestión de stock",
  invoicing: "Facturación",
  classes: "Clases grupales",
  multiBranch: "Operación multi-sucursal",
};

const STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "trial", label: "Trial" },
  { value: "paused", label: "Pausados" },
  { value: "suspended", label: "Suspendidos" },
];

function formatDateTimeForInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function parseInputDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatStatus(status) {
  switch (status) {
    case "active":
      return "Activo";
    case "trial":
      return "Trial";
    case "paused":
      return "Pausado";
    case "suspended":
      return "Suspendido";
    case "cancelled":
      return "Cancelado";
    default:
      return status || "Desconocido";
  }
}

export default function SuperAdminTenantsPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 400);
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);
  const navigate = useNavigate();

  const {
    data: tenantsResponse,
    loading,
    error,
    refetch,
  } = useQuery(
    async (signal) => {
      const params = {
        page,
        limit: 20,
        mode: "full",
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status && status !== "all") params.status = status;

      const response = await apiClient.superAdmin.listTenants(params, { signal });
      return response;
    },
    [page, debouncedSearch, status]
  );

  const tenants = useMemo(() => tenantsResponse?.data || [], [tenantsResponse]);
  const tenantsWithDisplay = useMemo(
    () =>
      (tenants || []).map((tenant) => ({
        ...tenant,
        displayName: tenant.is_system
          ? "Panel Global"
          : (tenant.name || tenant.subdomain || `#${tenant.id}`).replace(/\u0000+$/g, ""),
      })),
    [tenants]
  );
  const pagination = tenantsResponse?.pagination || { page: 1, pages: 1, total: tenantsWithDisplay.length, limit: 20 };

  const handleRefresh = async () => {
    try {
      await refetch();
      toast.success("Listado actualizado");
    } catch (err) {
      toast.error(err?.message || "Error al actualizar");
    }
  };

  const openEditModal = (tenant) => {
    setEditingTenant(tenant);
    setShowCreateModal(true);
  };

  const closeModals = () => {
    setShowCreateModal(false);
    setEditingTenant(null);
  };

  const handleStatusChange = async (tenant, newStatus) => {
    if (!tenant?.id) return;
    if (tenant.is_system) {
      toast.error("El tenant del sistema no puede cambiar de estado");
      return;
    }
    if (tenant.status === newStatus) return;

    try {
      await apiClient.superAdmin.updateTenant(tenant.id, {
        tenant: { status: newStatus },
      });
      toast.success(`Tenant ${tenant.subdomain || tenant.id} actualizado`);
      await refetch();
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "Error al actualizar estado");
    }
  };

  const handleCreateOrUpdate = async (payload, tenantId = null) => {
    try {
      if (tenantId) {
        await apiClient.superAdmin.updateTenant(tenantId, payload);
        toast.success("Tenant actualizado");
      } else {
        await apiClient.superAdmin.createTenant(payload);
        toast.success("Tenant creado");
      }
      closeModals();
      await refetch();
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "Error al guardar");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-semibold">Tenants del sistema</h2>
          <p className="text-foreground-secondary text-sm">
            Gestión centralizada de todas las cuentas
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-background-secondary transition-all"
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </button>
          <button
            onClick={() => {
              setEditingTenant(null);
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium shadow hover:bg-primary/90 transition-all"
          >
            <Plus className="w-4 h-4" />
            Nuevo tenant
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 card p-4">
        <div className="md:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
          <input
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
            placeholder="Buscar por nombre, subdominio o email…"
            className="input pl-9"
            type="search"
          />
        </div>
        <div>
          <select
            className="input"
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="card p-10 text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
          <p className="text-sm text-foreground-secondary">Cargando tenants…</p>
        </div>
      ) : error ? (
        <div className="card p-10 text-center text-red-500">
          {error}
        </div>
      ) : tenantsWithDisplay.length === 0 ? (
        <div className="card p-10 text-center">
          <Shield className="w-12 h-12 mx-auto mb-4 text-foreground-muted" />
          <p className="text-foreground-secondary">No se encontraron tenants con los filtros seleccionados.</p>
        </div>
      ) : (
        <div className="card p-0" style={{ overflow: "visible" }}>
          <div className="w-full" style={{ overflow: "visible" }}>
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-background-secondary/60">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-secondary">
                    Tenant
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-secondary">
                    Subdominio
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-secondary">
                    Estado
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-secondary">
                    Usuarios activos
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-secondary">
                    Clientes
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-secondary">
                    Turnos próximos
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-foreground-secondary">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tenantsWithDisplay.map((tenant) => (
                  <tr key={tenant.id} className="hover:bg-background-secondary/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium flex items-center gap-2">
                        {tenant.displayName}
                        {tenant.is_system && <SystemBadge />}
                      </div>
                      <div className="text-xs text-foreground-secondary">
                        #{tenant.id}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-secondary">
                      {tenant.subdomain || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {tenant.is_system ? <SystemBadge /> : <StatusBadge status={tenant.status} />}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">
                      {tenant.active_users ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">
                      {tenant.customers_count ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">
                      {tenant.appointments_upcoming ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => navigate(`/super-admin/tenants/${tenant.id}`)}
                          className="p-2 rounded-lg border border-border hover:bg-background transition-colors"
                          title="Ver detalle"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEditModal(tenant)}
                          className="p-2 rounded-lg border border-border hover:bg-background transition-colors"
                          title="Editar"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        {!tenant.is_system && (
                          <StatusMenu tenant={tenant} onChange={handleStatusChange} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            pagination={pagination}
            onPageChange={setPage}
          />
        </div>
      )}

      {showCreateModal && (
        <TenantFormModal
          tenant={editingTenant}
          onClose={closeModals}
          onSubmit={handleCreateOrUpdate}
        />
      )}

    </div>
  );
}

function StatusBadge({ status }) {
  const label = formatStatus(status);
  const style =
    status === "active"
      ? "bg-emerald-500/20 text-emerald-500"
      : status === "trial"
      ? "bg-primary/20 text-primary"
      : status === "paused"
      ? "bg-amber-500/20 text-amber-500"
      : status === "suspended"
      ? "bg-red-500/20 text-red-500"
      : "bg-foreground-muted/20 text-foreground-secondary";

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${style}`}>
      <Shield className="w-3 h-3" />
      {label}
    </span>
  );
}

function SystemBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/20 text-primary">
      <Shield className="w-3 h-3" />
      Sistema
    </span>
  );
}

function StatusMenu({ tenant, onChange }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="p-2 rounded-lg border border-border hover:bg-background transition-colors"
        title="Cambiar estado"
      >
        <Shield className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-44 rounded-lg border border-border bg-background shadow-lg z-50">
          <div className="py-1">
            {STATUS_OPTIONS.filter((option) => option.value !== "all").map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  setOpen(false);
                  onChange(tenant, option.value);
                }}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-background-secondary transition ${
                  tenant.status === option.value ? "text-primary" : "text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Pagination({ pagination, onPageChange }) {
  if (!pagination) return null;
  const { page = 1, pages = 1 } = pagination;

  if (pages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-background-secondary/40">
      <span className="text-sm text-foreground-secondary">
        Página {page} de {pages}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="px-3 py-1 rounded-md border border-border text-sm hover:bg-background"
          disabled={page <= 1}
        >
          Anterior
        </button>
        <button
          onClick={() => onPageChange(Math.min(pages, page + 1))}
          className="px-3 py-1 rounded-md border border-border text-sm hover:bg-background"
          disabled={page >= pages}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function TenantFormModal({ tenant, onClose, onSubmit }) {
  const isEdit = Boolean(tenant?.id);
  const isSystemTenant = Boolean(tenant?.is_system);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: tenant?.name || "",
    subdomain: tenant?.subdomain || "",
    status: tenant?.status || "active",
    ownerEmail: "",
    ownerPassword: "",
  });

  useEffect(() => {
    if (tenant) {
      setFormData((prev) => ({
        ...prev,
        name: tenant.name || "",
        subdomain: tenant.subdomain || "",
        status: tenant.status || "active",
      }));
    }
  }, [tenant]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);

    try {
      const payload = {
        tenant: {
          name: formData.name || null,
          subdomain: formData.subdomain || undefined,
          status: formData.status,
        },
      };

      if (!isEdit) {
        payload.owner = {};
        if (formData.ownerEmail) payload.owner.email = formData.ownerEmail;
        if (formData.ownerPassword) payload.owner.password = formData.ownerPassword;
      }

      if (isEdit) {
        await onSubmit(payload, tenant.id);
      } else {
        if (!formData.subdomain) {
          throw new Error("El subdominio es obligatorio para crear un tenant");
        }
        if (!formData.ownerEmail || !formData.ownerPassword) {
          throw new Error("Email y contraseña del responsable son obligatorios");
        }
        await onSubmit(payload, null);
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur" onClick={onClose}>
      <div
        className="bg-background rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-border">
          <h3 className="text-lg font-semibold">
            {isEdit ? "Editar tenant" : "Crear nuevo tenant"}
          </h3>
          <p className="text-sm text-foreground-secondary">
            Define los datos principales del tenant {isEdit ? `#${tenant?.id}` : ""}
          </p>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Nombre comercial</label>
              <input
                className="input"
                value={formData.name}
                onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                placeholder="Ej: Studio Centro"
              />
            </div>
            <div>
              <label className="label">Subdominio</label>
              <input
                className="input"
                value={formData.subdomain}
                onChange={(event) => setFormData({ ...formData, subdomain: event.target.value })}
                placeholder="Ej: studio-centro"
                disabled={isEdit}
                required={!isEdit}
              />
            </div>
            <div>
              <label className="label">Estado</label>
              <select
                className="input"
                value={formData.status}
                onChange={(event) => setFormData({ ...formData, status: event.target.value })}
                disabled={isSystemTenant}
              >
                {STATUS_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {isSystemTenant && (
                <p className="text-xs text-foreground-secondary mt-1">
                  El tenant del sistema permanece siempre activo.
                </p>
              )}
            </div>
          </div>

          {!isEdit && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
              <div>
                <label className="label">Email del responsable</label>
                <input
                  className="input"
                  type="email"
                  value={formData.ownerEmail}
                  onChange={(event) => setFormData({ ...formData, ownerEmail: event.target.value })}
                  placeholder="dueño@example.com"
                  required
                />
              </div>
              <div>
                <label className="label">Contraseña inicial</label>
                <input
                  className="input"
                  type="password"
                  value={formData.ownerPassword}
                  onChange={(event) => setFormData({ ...formData, ownerPassword: event.target.value })}
                  placeholder="Contraseña temporal"
                  required
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-background-secondary"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear tenant"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TenantDetailModal({ tenantId, onClose, onEdit }) {
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [businessForm, setBusinessForm] = useState({ business_type_id: "" });
  const [businessTypes, setBusinessTypes] = useState([]);
  const [featuresOverrides, setFeaturesOverrides] = useState(() =>
    FEATURE_KEYS.reduce((acc, key) => ({ ...acc, [key]: null }), {})
  );
  const [planCode, setPlanCode] = useState("");
  const [hubData, setHubData] = useState(null);
  const [hubLoading, setHubLoading] = useState(true);
  const [hubError, setHubError] = useState("");
  const [hubSaving, setHubSaving] = useState(false);
  const [hubClearing, setHubClearing] = useState(false);
  const [hubForm, setHubForm] = useState({
    phoneNumberId: "",
    accessToken: "",
    verifyToken: "",
    refreshToken: "",
    tokenExpiresAt: "",
    isActive: true,
    managedNotes: "",
  });

  const loadHub = useCallback(async () => {
    setHubLoading(true);
    setHubError("");
    try {
      const response = await apiClient.superAdmin.getTenantWhatsApp(tenantId);
      const hub = response?.data ?? null;
      setHubData(hub);
      setHubForm({
        phoneNumberId: hub?.phoneNumberId ?? "",
        accessToken: "",
        verifyToken: hub?.verifyToken ?? "",
        refreshToken: hub?.refreshToken ?? "",
        tokenExpiresAt: hub?.tokenExpiresAt ? formatDateTimeForInput(hub.tokenExpiresAt) : "",
        isActive: hub?.isActive ?? false,
        managedNotes: hub?.managedNotes ?? "",
      });
    } catch (err) {
      setHubError(err?.response?.data?.error || err?.message || "No se pudo cargar WhatsApp");
      setHubData(null);
      setHubForm({
        phoneNumberId: "",
        accessToken: "",
        verifyToken: "",
        refreshToken: "",
        tokenExpiresAt: "",
        isActive: true,
        managedNotes: "",
      });
    } finally {
      setHubLoading(false);
    }
  }, [tenantId]);

  const handleSaveHubCredentials = async () => {
    const phoneNumberId = hubForm.phoneNumberId.trim();
    const accessToken = hubForm.accessToken.trim();
    if (!phoneNumberId) {
      toast.error("Ingresá el Phone Number ID que devuelve Meta para esta línea.");
      return;
    }
    setHubSaving(true);
    try {
      const payload = {
        phoneNumberId,
        verifyToken: hubForm.verifyToken.trim() || undefined,
        refreshToken: hubForm.refreshToken.trim() || undefined,
        tokenExpiresAt: parseInputDateTime(hubForm.tokenExpiresAt) || undefined,
        phoneDisplay: hubData?.phoneDisplay || undefined,
        isActive: !!hubForm.isActive,
        managedNotes: hubForm.managedNotes.trim() || undefined,
      };
      if (accessToken) {
        payload.accessToken = accessToken;
      } else if (!hubData?.hasCredentials) {
        toast.error("Ingresá el access token generado en Meta.");
        setHubSaving(false);
        return;
      }
      await apiClient.superAdmin.upsertTenantWhatsAppCredentials(tenantId, {
        ...payload,
      });
      toast.success("Credenciales de WhatsApp guardadas");
      await loadHub();
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo guardar las credenciales");
    } finally {
      setHubSaving(false);
    }
  };

  const handleClearHubCredentials = async () => {
    if (!hubData) return;
    const confirmed = window.confirm(
      "¿Eliminar todas las credenciales del hub de WhatsApp para este tenant? El asistente quedará inactivo."
    );
    if (!confirmed) return;
    setHubClearing(true);
    try {
      await apiClient.superAdmin.clearTenantWhatsAppCredentials(tenantId);
      toast.success("Credenciales eliminadas");
      await loadHub();
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo eliminar las credenciales");
    } finally {
      setHubClearing(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    apiClient.superAdmin
      .listBusinessTypes()
      .then((items) => {
        if (mounted) {
          setBusinessTypes(items);
        }
      })
      .catch(() => setBusinessTypes([]));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    apiClient.superAdmin
      .getTenant(tenantId, {}, { signal: controller.signal })
      .then((response) => {
        const payload = response?.data || null;
        setDetail(payload);
        let parsedFeatures = {};
        if (payload?.business?.features_config) {
          if (typeof payload.business.features_config === "string") {
            try {
              parsedFeatures = JSON.parse(payload.business.features_config);
            } catch {
              parsedFeatures = {};
            }
          } else {
            parsedFeatures = payload.business.features_config;
          }
        }
        setBusinessForm({
          business_type_id: payload?.business?.business_type_id || "",
        });
        setFeaturesOverrides(
          FEATURE_KEYS.reduce((acc, key) => {
            if (Object.prototype.hasOwnProperty.call(parsedFeatures, key)) {
              acc[key] = Boolean(parsedFeatures[key]);
            } else {
              acc[key] = null;
            }
            return acc;
          }, {})
        );
        setPlanCode(payload?.plan?.code || "");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err?.response?.data?.error || err?.message || "Error al cargar detalle");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [tenantId]);

  useEffect(() => {
    loadHub();
  }, [loadHub]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur" onClick={onClose}>
      <div
        className="bg-background rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Detalle tenant #{tenantId}</h3>
            <p className="text-sm text-foreground-secondary">
              Información resumida del tenant y sus métricas
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onEdit(detail);
              }}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-background"
            >
              <Edit className="w-4 h-4" />
              Editar
            </button>
            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-background"
            >
              Cerrar
            </button>
          </div>
        </header>

        {loading ? (
          <div className="p-8 text-center">
            <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
            <p className="text-foreground-secondary">Cargando detalle…</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">{error}</div>
        ) : !detail ? (
          <div className="p-8 text-center text-foreground-secondary">No hay datos disponibles.</div>
        ) : (
          <div className="px-6 py-5 space-y-6">
            {detail?.tenant?.is_system ? (
              <div className="p-4 border border-primary/40 rounded-lg bg-primary/5 text-sm text-primary">
                Este tenant corresponde al panel global del sistema.
              </div>
            ) : null}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <InfoCard
                title="Información general"
                items={[
                  {
                    label: "Nombre",
                    value: detail.tenant?.is_system
                      ? "Panel Global"
                      : detail.tenant?.name || "—",
                  },
                  { label: "Subdominio", value: detail.tenant?.subdomain || "—" },
                  { label: "Estado", value: formatStatus(detail.tenant?.status) },
                  {
                    label: "Creado",
                    value: detail.tenant?.created_at
                      ? new Date(detail.tenant.created_at).toLocaleString("es-AR")
                      : "—",
                  },
                ]}
              />
              <InfoCard
                title="Métricas"
                items={[
                  { label: "Usuarios activos", value: detail.metrics?.active_users ?? "—", icon: Users },
                  { label: "Clientes", value: detail.metrics?.customers_count ?? "—" },
                  {
                    label: "Turnos próximos",
                    value: detail.metrics?.appointments_upcoming ?? "—",
                    icon: CalendarCheck,
                  },
                ]}
              />
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="border border-border rounded-xl p-4 bg-background-secondary/40 space-y-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-primary" />
                  <h4 className="font-semibold text-sm text-foreground">Tipo de negocio y funcionalidades</h4>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="label">Tipo de negocio</label>
                    <select
                      className="input"
                      value={businessForm.business_type_id}
                      onChange={(event) =>
                        setBusinessForm((prev) => ({
                          ...prev,
                          business_type_id: event.target.value,
                        }))
                      }
                    >
                      <option value="">Seleccionar tipo…</option>
                      {businessTypes.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name} ({type.code})
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-foreground-muted mt-1">
                      Elegí un tipo de negocio para aplicar sus valores por defecto.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <label className="label">Overrides de funcionalidades</label>
                    {FEATURE_KEYS.map((key) => {
                      const planValue = detail.planFeatures?.[key];
                      const override = featuresOverrides[key];
                      const value = override === null ? "inherit" : override ? "true" : "false";
                      return (
                        <div
                          key={key}
                          className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-2 bg-background"
                        >
                          <div>
                            <div className="text-sm font-medium text-foreground">
                              {FEATURE_LABELS[key]}
                            </div>
                            <div className="text-[11px] text-foreground-muted">
                              Incluido por el plan: <strong>{planValue === false ? "No" : "Sí"}</strong>
                            </div>
                          </div>
                          <select
                            className="input w-40"
                            value={value}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setFeaturesOverrides((prev) => ({
                                ...prev,
                                [key]:
                                  nextValue === "inherit"
                                    ? null
                                    : nextValue === "true"
                                    ? true
                                    : false,
                              }));
                            }}
                          >
                            <option value="inherit">Según plan</option>
                            <option value="true">Forzar habilitado</option>
                            <option value="false">Forzar deshabilitado</option>
                          </select>
                        </div>
                      );
                    })}
                    <p className="text-[11px] text-foreground-muted">
                      Seleccioná “Según plan” para respetar el plan contratado. Usá los overrides
                      solo cuando quieras habilitar o deshabilitar manualmente un módulo.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        setSavingBusiness(true);
                        const payload = {
                          business_type_id: businessForm.business_type_id
                            ? Number(businessForm.business_type_id)
                            : undefined,
                          features_config: FEATURE_KEYS.reduce((acc, featureKey) => {
                            const val = featuresOverrides[featureKey];
                            if (val !== null) acc[featureKey] = val;
                            return acc;
                          }, {}),
                        };
                        if (payload.features_config && !Object.keys(payload.features_config).length) {
                          delete payload.features_config;
                        }
                        await apiClient.superAdmin.updateTenantBusiness(detail.tenant.id, payload);
                        toast.success("Configuración de negocio actualizada");
                      } catch (err) {
                        toast.error(err?.response?.data?.error || err?.message || "Error al actualizar");
                      } finally {
                        setSavingBusiness(false);
                      }
                    }}
                    className="btn-secondary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={savingBusiness}
                  >
                    {savingBusiness ? "Guardando…" : "Aplicar cambios"}
                  </button>
                </div>
              </div>

              <div className="border border-border rounded-xl p-4 bg-background-secondary/40 space-y-3">
                <div className="flex items-center gap-2">
                  <Rocket className="w-4 h-4 text-primary" />
                  <h4 className="font-semibold text-sm text-foreground">Plan comercial</h4>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-2">
                    <label className="label">Plan vigente</label>
                    <select
                      className="input"
                      value={planCode}
                      onChange={(event) => setPlanCode(event.target.value)}
                    >
                      <option value="">Seleccionar plan…</option>
                      {(detail.availablePlans || []).map((plan) => (
                        <option key={plan.code} value={plan.code}>
                          {plan.label} — ${plan.amount} {plan.currency}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-foreground-muted">
                      Plan actual: {detail.plan?.label || "Sin plan"} ({detail.plan?.status || "—"})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!planCode) {
                        toast.error("Seleccioná un plan antes de guardar");
                        return;
                      }
                      try {
                        setSavingPlan(true);
                        await apiClient.superAdmin.updateTenantPlan(detail.tenant.id, { plan_code: planCode });
                        toast.success("Plan actualizado correctamente");
                      } catch (err) {
                        toast.error(err?.response?.data?.error || err?.message || "Error al actualizar plan");
                      } finally {
                        setSavingPlan(false);
                      }
                    }}
                    className="btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={savingPlan}
                  >
                    {savingPlan ? "Guardando…" : "Actualizar plan"}
                  </button>
                  {detail.plan ? (
                    <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground-secondary space-y-1">
                      <p>
                        Estado actual: <strong>{detail.plan.status || "—"}</strong>
                      </p>
                      {detail.plan.activated_at ? (
                        <p>
                          Activado el{" "}
                          {new Date(detail.plan.activated_at).toLocaleDateString("es-AR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })}
                        </p>
                      ) : null}
                      <p>
                        Próximo cobro:{" "}
                        {detail.plan.next_charge_at
                          ? new Date(detail.plan.next_charge_at).toLocaleString("es-AR")
                          : "Sin fecha registrada"}
                      </p>
                      <p>Payer email: {detail.plan.payer_email || "—"}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="border border-border rounded-xl p-4 bg-background-secondary/40 space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  <h4 className="font-semibold text-sm text-foreground">WhatsApp centralizado</h4>
                </div>
                <span
                  className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full ${
                    hubData
                      ? hubData.hasCredentials
                        ? hubData.isActive
                          ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30"
                          : "bg-amber-500/15 text-amber-200 border border-amber-500/30"
                        : "bg-slate-500/15 text-slate-200 border border-slate-500/30"
                      : "bg-slate-500/15 text-slate-200 border border-slate-500/30"
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  {hubData
                    ? hubData.hasCredentials
                      ? hubData.isActive
                        ? "Activo"
                        : "Configurado (pausado)"
                      : "Pendiente de credenciales"
                    : "Sin configurar"}
                </span>
              </div>

              {hubLoading ? (
                <div className="flex items-center gap-2 text-sm text-foreground-secondary">
                  <div className="h-4 w-4 animate-spin rounded-full border border-primary border-t-transparent" />
                  Cargando información del hub…
                </div>
              ) : hubError ? (
                <p className="text-sm text-red-400">{hubError}</p>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-foreground-muted">Número informado por el tenant</p>
                      <p className="font-medium text-foreground">
                        {hubData?.phoneDisplay || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-foreground-muted">Última actualización</p>
                      <p className="font-medium text-foreground">
                        {hubData?.updatedAt
                          ? new Date(hubData.updatedAt).toLocaleString("es-AR")
                          : "Sin credenciales"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-foreground-muted">Asignado por</p>
                      <p className="font-medium text-foreground">
                        {hubData?.managedBy || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-foreground-muted">Notas internas</p>
                      <p className="font-medium text-foreground">
                        {hubData?.managedNotes || "—"}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <label className="label">Phone Number ID (Meta)</label>
                      <input
                        className="input w-full bg-background/60 border border-border/70 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-shadow"
                        value={hubForm.phoneNumberId}
                        onChange={(event) =>
                          setHubForm((prev) => ({
                            ...prev,
                            phoneNumberId: event.target.value,
                          }))
                        }
                        placeholder="Ej: 123456789012345"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="label">Access token</label>
                      <input
                        className="input w-full bg-background/60 border border-border/70 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-shadow"
                        type="password"
                        value={hubForm.accessToken}
                        onChange={(event) =>
                          setHubForm((prev) => ({
                            ...prev,
                            accessToken: event.target.value,
                          }))
                        }
                        placeholder="Token prolongado generado en Meta"
                      />
                      <p className="text-[11px] text-foreground-muted mt-1">
                        Siempre que reemplaces las credenciales, cargá el token completo.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="label">Verify token (webhook)</label>
                      <input
                        className="input w-full bg-background/60 border border-border/70 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-shadow"
                        value={hubForm.verifyToken}
                        onChange={(event) =>
                          setHubForm((prev) => ({
                            ...prev,
                            verifyToken: event.target.value,
                          }))
                        }
                        placeholder="Texto utilizado en la verificación"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="label">Refresh token (opcional)</label>
                      <input
                        className="input w-full bg-background/60 border border-border/70 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-shadow"
                        value={hubForm.refreshToken}
                        onChange={(event) =>
                          setHubForm((prev) => ({
                            ...prev,
                            refreshToken: event.target.value,
                          }))
                        }
                        placeholder="Si usás refresh token, ingresalo aquí"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="label">Expira el</label>
                      <input
                        className="input w-full bg-background/60 border border-border/70 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-shadow"
                        type="datetime-local"
                        value={hubForm.tokenExpiresAt}
                        onChange={(event) =>
                          setHubForm((prev) => ({
                            ...prev,
                            tokenExpiresAt: event.target.value,
                          }))
                        }
                      />
                      <p className="text-[11px] text-foreground-muted mt-1">
                        Opcional. Ayuda a recordar cuándo renovar el token.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="label">Notas internas</label>
                      <textarea
                        className="input min-h-[72px] w-full bg-background/60 border border-border/70 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-shadow"
                        value={hubForm.managedNotes}
                        onChange={(event) =>
                          setHubForm((prev) => ({
                            ...prev,
                            managedNotes: event.target.value,
                          }))
                        }
                        placeholder="Información útil para el equipo de soporte"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-6">
                      <input
                        id="hub-active"
                        type="checkbox"
                        className="w-4 h-4 rounded border-border"
                        checked={hubForm.isActive}
                        onChange={(event) =>
                          setHubForm((prev) => ({
                            ...prev,
                            isActive: event.target.checked,
                          }))
                        }
                      />
                      <label htmlFor="hub-active" className="text-sm text-foreground">
                        Marcar asistente como activo en el hub
                      </label>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <button
                        type="button"
                        onClick={handleSaveHubCredentials}
                        disabled={hubSaving}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary/90 disabled:opacity-60"
                      >
                        {hubSaving ? (
                          <>
                            <div className="h-4 w-4 animate-spin rounded-full border border-white/70 border-t-transparent" />
                            Guardando…
                          </>
                        ) : (
                          <>
                            <Shield className="w-4 h-4" />
                            Guardar credenciales
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={handleClearHubCredentials}
                        disabled={hubClearing || !hubData}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-background disabled:opacity-60"
                      >
                        <Trash2 className="w-4 h-4" />
                        Limpiar
                      </button>
                    </div>
                    <p className="text-[11px] text-foreground-muted flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      El asistente solo responde cuando el hub tiene credenciales activas.
                    </p>
                  </div>
                </>
              )}
            </section>

            {detail.planFeatures ? (
              <InfoCard
                title="Funcionalidades del plan"
                items={FEATURE_KEYS.map((key) => ({
                  label: FEATURE_LABELS[key],
                  value: detail.planFeatures[key] ? "Incluido" : "No incluido",
                }))}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ title, items }) {
  return (
    <div className="border border-border rounded-xl p-4 space-y-3 bg-background-secondary/40">
      <h4 className="font-semibold text-sm text-foreground">{title}</h4>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-center justify-between text-sm">
            <span className="text-foreground-secondary">{item.label}</span>
            <span className="font-medium text-foreground flex items-center gap-2">
              {item.icon ? <item.icon className="w-4 h-4" /> : null}
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

