import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Loader2, Mail, MapPin, Phone, Plus, ShieldCheck, Star, Trash2, X, User, Lock } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import Button from "../../components/ui/Button";
import { logger } from "../../utils/logger.js";

const EMPTY_FORM = {
  name: "",
  slug: "",
  description: "",
  email: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  zipCode: "",
  country: "Argentina",
  isPrimary: false,
  isActive: true,
  adminUserId: null,
};

function BranchBadge({ label, variant = "default" }) {
  const variants = {
    default: "bg-background-secondary text-foreground-secondary border-border",
    success: "bg-emerald-500/12 text-emerald-700 border-emerald-500/30",
    warning: "bg-amber-500/12 text-amber-700 border-amber-500/30",
  };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border ${variants[variant]}`}>
      {label}
    </span>
  );
}

function BranchCard({ branch, onEdit, onSetPrimary, onToggleActive, onDelete, disableActions }) {
  return (
    <div className="p-5 rounded-2xl border border-border bg-background-secondary/60 shadow-sm flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">{branch.name}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {branch.isPrimary ? (
              <BranchBadge label="Sucursal principal" variant="success" />
            ) : (
              <BranchBadge label="Secundaria" />
            )}
            <BranchBadge label={branch.isActive ? "Activa" : "Inactiva"} variant={branch.isActive ? "success" : "warning"} />
            {branch.adminUserEmail && (
              <BranchBadge 
                label={`Admin: ${branch.adminUserEmail}`} 
                variant="default"
                className="inline-flex items-center gap-1"
              />
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" className="px-3" onClick={() => onEdit(branch)}>
            Editar
          </Button>
          {!branch.isPrimary && (
            <Button
              variant="ghost"
              className="px-3"
              disabled={disableActions}
              onClick={() => onSetPrimary(branch)}
            >
              <Star className="w-4 h-4 mr-1 text-amber-400" /> Principal
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 text-sm text-foreground-secondary">
        {branch.description ? <p>{branch.description}</p> : null}
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4" />
          <span>
            {[branch.addressLine1, branch.addressLine2, branch.city, branch.state, branch.zipCode, branch.country]
              .filter(Boolean)
              .join(" · ") || "Dirección no configurada"}
          </span>
        </div>
        <div className="flex flex-wrap gap-4">
          {branch.phone ? (
            <span className="inline-flex items-center gap-2">
              <Phone className="w-4 h-4" />
              {branch.phone}
            </span>
          ) : null}
          {branch.email ? (
            <span className="inline-flex items-center gap-2">
              <Mail className="w-4 h-4" />
              {branch.email}
            </span>
          ) : null}
        </div>
        <div className="text-xs text-foreground-muted">
          Slug interno: <code>{branch.slug}</code>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          className="flex items-center gap-2"
          disabled={disableActions}
          onClick={() => onToggleActive(branch)}
        >
          {branch.isActive ? (
            <>
              <ShieldCheck className="w-4 h-4" />
              Desactivar
            </>
          ) : (
            <>
              <ShieldCheck className="w-4 h-4" />
              Activar
            </>
          )}
        </Button>
        {!branch.isPrimary && (
          <Button
            variant="danger"
            className="flex items-center gap-2"
            disabled={disableActions}
            onClick={() => onDelete(branch)}
          >
            <Trash2 className="w-4 h-4" />
            Eliminar
          </Button>
        )}
      </div>
    </div>
  );
}

function BranchModal({ open, onClose, form, setForm, onSubmit, saving, editing, users = [], loadingUsers = false }) {
  if (!open) return null;

  const handleChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-background shadow-2xl border border-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {editing ? "Editar sucursal" : "Nueva sucursal"}
            </h3>
            <p className="text-sm text-foreground-secondary">
              Completá los datos de la sede para poder asignarla a tus equipos y reportes.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-border">
            <X className="w-5 h-5 text-foreground-secondary" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid md:grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-sm font-medium text-foreground">Nombre comercial</span>
              <input
                className="input"
                placeholder="Ej: Sucursal Palermo"
                value={form.name}
                onChange={handleChange("name")}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-foreground">
                Identificador interno (slug)
              </span>
              <input
                className="input"
                placeholder="palermo"
                value={form.slug}
                onChange={(event) => {
                  const value = event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
                  setForm((prev) => ({ ...prev, slug: value }));
                }}
              />
              <span className="text-xs text-foreground-muted">
                Se usa para integraciones. Si lo dejás vacío se genera automáticamente.
              </span>
            </label>
          </div>

          <label className="space-y-1 block">
            <span className="text-sm font-medium text-foreground">Descripción</span>
            <textarea
              className="input h-24"
              placeholder="Notas o atributos particulares de esta sede..."
              value={form.description}
              onChange={handleChange("description")}
            />
          </label>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-sm font-medium text-foreground">Email de contacto</span>
              <input className="input" type="email" value={form.email} onChange={handleChange("email")} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-foreground">Teléfono</span>
              <input className="input" value={form.phone} onChange={handleChange("phone")} />
            </label>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-sm font-medium text-foreground">Dirección</span>
              <input className="input" value={form.addressLine1} onChange={handleChange("addressLine1")} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-foreground">Piso / Depto</span>
              <input className="input" value={form.addressLine2} onChange={handleChange("addressLine2")} />
            </label>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <label className="space-y-1">
              <span className="text-sm font-medium text-foreground">Ciudad</span>
              <input className="input" value={form.city} onChange={handleChange("city")} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-foreground">Provincia</span>
              <input className="input" value={form.state} onChange={handleChange("state")} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-foreground">Código postal</span>
              <input className="input" value={form.zipCode} onChange={handleChange("zipCode")} />
            </label>
          </div>

          <label className="space-y-1 block">
            <span className="text-sm font-medium text-foreground">País</span>
            <input className="input" value={form.country} onChange={handleChange("country")} />
          </label>

          {editing && (
            <label className="space-y-1 block">
              <span className="text-sm font-medium text-foreground flex items-center gap-2">
                <User className="w-4 h-4" />
                Administrador de la sucursal
              </span>
              <select
                className="input w-full"
                value={form.adminUserId || ""}
                onChange={(e) => setForm((prev) => ({ ...prev, adminUserId: e.target.value ? Number(e.target.value) : null }))}
                disabled={loadingUsers}
              >
                <option value="">Sin administrador asignado</option>
                {users
                  .filter((u) => u.isActive || u.is_active === 1 || u.is_active === true)
                  .map((user) => {
                    const roleLabel = user.role === "admin" ? "(Admin)" : user.role === "staff" ? "(Empleado)" : "";
                    return (
                      <option key={user.id} value={user.id}>
                        {user.email} {roleLabel}
                      </option>
                    );
                  })}
              </select>
              <span className="text-xs text-foreground-muted">
                Podés asignar cualquier usuario activo (admin o empleado) como administrador de la sucursal. Solo el administrador asignado podrá confirmar transferencias de stock recibidas en esta sucursal.
              </span>
            </label>
          )}

          {editing ? (
            <div className="grid md:grid-cols-2 gap-4">
              <label className="flex items-center gap-3 p-3 border border-border rounded-xl">
                <input
                  type="checkbox"
                  checked={form.isPrimary}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, isPrimary: event.target.checked }))
                  }
                  className="w-5 h-5 rounded border-border"
                />
                <span className="text-sm text-foreground">Definir como sucursal principal</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-border rounded-xl">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, isActive: event.target.checked }))
                  }
                  className="w-5 h-5 rounded border-border"
                />
                <span className="text-sm text-foreground">Sucursal activa</span>
              </label>
            </div>
          ) : (
            <label className="flex items-center gap-3 p-3 border border-border rounded-xl">
              <input
                type="checkbox"
                checked={form.isPrimary}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, isPrimary: event.target.checked }))
                }
                className="w-5 h-5 rounded border-border"
              />
              <span className="text-sm text-foreground">
                Hacerla principal apenas se cree (opcional)
              </span>
            </label>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Guardando...
              </>
            ) : (
              "Guardar cambios"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function BranchesPage() {
  const { user } = useAuth();
  const [branches, setBranches] = useState([]);
  const [limitInfo, setLimitInfo] = useState({ multiBranch: false, maxBranches: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Verificar permisos: solo administradores pueden ver esta página
  if (user?.role !== "admin") {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4 max-w-md">
          <div className="flex justify-center">
            <div className="p-4 rounded-full bg-red-500/10 border border-red-500/30">
              <Lock className="w-12 h-12 text-red-500" />
            </div>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Acceso restringido</h2>
            <p className="text-foreground-secondary">
              No tenés permisos para acceder a la gestión de sucursales. Solo los administradores pueden ver y editar esta sección.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const activeBranches = useMemo(() => branches.filter((branch) => branch.isActive), [branches]);
  const reachedLimit =
    limitInfo.maxBranches != null && activeBranches.length >= limitInfo.maxBranches;

  const loadBranches = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      logger.log("[BranchesPage] Cargando sucursales...");
      // listBranches ya devuelve el array directamente, pero necesitamos también el limitInfo
      // Por eso hacemos la llamada directa al endpoint
      const { data } = await apiClient.get("/api/branches", {
        headers: { "X-Branch-Mode": "skip" },
      });
      logger.log("[BranchesPage] Respuesta completa:", data);
      
      // El endpoint retorna { ok: true, data: [...], limit: {...} }
      const branchesList = Array.isArray(data?.data) ? data.data : [];
      const limitInfo = data?.limit || { multiBranch: false, maxBranches: 1 };
      
      logger.log("[BranchesPage] Sucursales extraídas:", branchesList);
      logger.log("[BranchesPage] Limit info:", limitInfo);
      
      setBranches(branchesList);
      setLimitInfo(limitInfo);
    } catch (err) {
      logger.error("[BranchesPage] list error:", err);
      logger.error("[BranchesPage] error response:", err?.response?.data);
      setError(err?.response?.data?.error || err?.message || "No se pudieron cargar las sucursales");
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      // Solicitar todos los usuarios (activos e inactivos) para el selector
      const response = await apiClient.get("/api/users", {
        params: { active_only: false }
      });
      
      // El backend devuelve { ok: true, data: users }
      // axios envuelve esto en { data: { ok: true, data: users } }
      let usersList = [];
      if (response?.data?.ok && Array.isArray(response.data.data)) {
        usersList = response.data.data;
      } else if (Array.isArray(response?.data)) {
        usersList = response.data;
      } else if (Array.isArray(response?.data?.data)) {
        usersList = response.data.data;
      }
      
      setUsers(usersList);
    } catch (err) {
      logger.error("[BranchesPage] loadUsers error:", err);
      logger.error("[BranchesPage] loadUsers error response:", err?.response);
      const errorMessage = err?.response?.data?.error || err?.message || "No se pudieron cargar los usuarios";
      toast.error(errorMessage);
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    loadBranches();
    loadUsers();
  }, [loadBranches, loadUsers]);

  const closeModal = () => {
    setModalOpen(false);
    setForm(EMPTY_FORM);
    setEditing(null);
  };

  const openCreateModal = () => {
    setForm(EMPTY_FORM);
    setEditing(null);
    setModalOpen(true);
  };

  const openEditModal = (branch) => {
    setEditing(branch);
    setForm({
      name: branch.name || "",
      slug: branch.slug || "",
      description: branch.description || "",
      email: branch.email || "",
      phone: branch.phone || "",
      addressLine1: branch.addressLine1 || "",
      addressLine2: branch.addressLine2 || "",
      city: branch.city || "",
      state: branch.state || "",
      zipCode: branch.zipCode || "",
      country: branch.country || "",
      isPrimary: branch.isPrimary,
      isActive: branch.isActive,
      adminUserId: branch.adminUserId || null,
    });
    setModalOpen(true);
  };

  const normalizePayload = () => {
    const payload = {
      name: form.name.trim(),
      description: form.description?.trim() || null,
      email: form.email?.trim() || null,
      phone: form.phone?.trim() || null,
      addressLine1: form.addressLine1?.trim() || null,
      addressLine2: form.addressLine2?.trim() || null,
      city: form.city?.trim() || null,
      state: form.state?.trim() || null,
      zipCode: form.zipCode?.trim() || null,
      country: form.country?.trim() || null,
      metadata: null,
    };
    if (form.slug?.trim()) {
      payload.slug = form.slug.trim().toLowerCase();
    }
    if (editing) {
      payload.isPrimary = form.isPrimary;
      payload.isActive = form.isActive;
      if (form.adminUserId !== undefined) {
        payload.adminUserId = form.adminUserId || null;
      }
    } else if (form.isPrimary) {
      payload.isPrimary = true;
    }
    return payload;
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    setSaving(true);
    try {
      const payload = normalizePayload();
      if (editing) {
        await apiClient.updateBranch(editing.id, payload);
        toast.success("Sucursal actualizada");
      } else {
        await apiClient.createBranch(payload);
        toast.success("Sucursal creada");
      }
      closeModal();
      await loadBranches();
    } catch (err) {
      logger.error("[BranchesPage] save error:", err);
      toast.error(err?.response?.data?.error || err?.message || "No se pudo guardar la sucursal");
    } finally {
      setSaving(false);
    }
  };

  const handleSetPrimary = async (branch) => {
    try {
      await apiClient.updateBranch(branch.id, { isPrimary: true });
      toast.success(`${branch.name} ahora es la sede principal`);
      await loadBranches();
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo actualizar la sucursal");
    }
  };

  const handleToggleActive = async (branch) => {
    try {
      await apiClient.updateBranch(branch.id, { isActive: !branch.isActive });
      toast.success(branch.isActive ? "Sucursal desactivada" : "Sucursal activada");
      await loadBranches();
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo actualizar la sucursal");
    }
  };

  const handleDelete = async (branch) => {
    const confirmed = window.confirm(
      `¿Eliminar la sucursal "${branch.name}"? No aparecerá más en tus reportes.`
    );
    if (!confirmed) return;
    setDeletingId(branch.id);
    try {
      await apiClient.deleteBranch(branch.id);
      toast.success("Sucursal eliminada");
      await loadBranches();
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo eliminar la sucursal");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sucursales</h1>
          <p className="text-sm text-foreground-secondary">
            Administrá tus locales, direcciones y cupos por plan. Toda la información se replica en reportes,
            agendas y personal asignado.
          </p>
        </div>
        <Button
          onClick={openCreateModal}
          disabled={loading || (reachedLimit && limitInfo.maxBranches !== null)}
          className="inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Nueva sucursal
        </Button>
      </header>

      <div className="p-4 rounded-2xl border border-border bg-background-secondary/60 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <strong>{limitInfo.maxBranches == null ? "Sucursales ilimitadas" : `Podés tener hasta ${limitInfo.maxBranches} sucursal(es) activas`}</strong>
        </div>
        {limitInfo.maxBranches != null && (
          <span className="text-xs text-foreground-muted">
            Actualmente tenés {activeBranches.length} activa(s).{" "}
            {reachedLimit ? "Para sumar otra, desactivá alguna existente o actualizá tu plan." : ""}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-foreground-secondary">
          <Loader2 className="w-5 h-5 animate-spin" />
          Cargando sucursales...
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl border border-red-500/40 bg-red-500/10 text-red-200">
          {error}
        </div>
      ) : branches.length === 0 ? (
        <div className="p-6 rounded-2xl border border-dashed border-border text-center space-y-3">
          <p className="text-foreground">Todavía no configuraste ninguna sucursal</p>
          <p className="text-sm text-foreground-secondary">
            Cargá al menos una para asignar personal, agenda y stock a cada local.
          </p>
          <Button onClick={openCreateModal}>Crear primera sucursal</Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {branches.map((branch) => (
            <BranchCard
              key={branch.id}
              branch={branch}
              onEdit={openEditModal}
              disableActions={deletingId === branch.id}
              onSetPrimary={handleSetPrimary}
              onToggleActive={handleToggleActive}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <BranchModal
        open={modalOpen}
        onClose={closeModal}
        form={form}
        setForm={setForm}
        onSubmit={handleSubmit}
        saving={saving}
        editing={editing}
        users={users}
        loadingUsers={loadingUsers}
      />
    </div>
  );
}


