import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  CalendarCheck,
  Check,
  Edit3,
  Loader2,
  Plus,
  Shield,
  Trash2,
  Users,
} from "lucide-react";
import { apiClient } from "../../api";
import Button from "../../components/ui/Button";
import { useAuth } from "../../context/AuthContext";
import { logger } from "../../utils/logger.js";

const DEFAULT_INSTRUCTOR_FORM = {
  name: "",
  colorHex: "#2563EB",
  isActive: true,
  serviceIds: [],
  branchIds: [],
  photoUrl: "",
  phoneE164: "",
};

const DEFAULT_SERVICE_FORM = {
  name: "",
  durationMin: 60,
  priceDecimal: 0,
  isActive: true,
  instructorIds: [],
};

function sortByName(list) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

function MultiSelect({ label, value = [], options = [], onChange, helper, disabled = false, loading = false, emptyMessage = null }) {
  const toggleItem = (itemId) => {
    if (disabled) return;
    const isSelected = value.includes(itemId);
    if (isSelected) {
      onChange(value.filter((id) => id !== itemId));
    } else {
      onChange([...value, itemId]);
    }
  };

  const itemLabel = label.toLowerCase().includes("sucursal") ? "sucursal" : "servicio";
  const itemLabelPlural = label.toLowerCase().includes("sucursal") ? "sucursales" : "servicios";

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {helper && <span className="text-xs text-foreground-muted">{helper}</span>}
      {loading ? (
        <div className="col-span-full text-sm text-foreground-muted py-4 text-center">
          Cargando...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
          {options.length === 0 ? (
            <div className="col-span-full text-sm text-foreground-muted py-4 text-center">
              {emptyMessage || `No hay ${itemLabelPlural} disponibles`}
            </div>
          ) : (
            options.map((option) => {
              const isSelected = value.includes(option.id);
              return (
                <label
                  key={option.id}
                  className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200 ${
                    disabled
                      ? "opacity-50 cursor-not-allowed"
                      : isSelected
                      ? "border-primary bg-primary/10 shadow-md"
                      : "border-border bg-background-secondary hover:border-primary/50 hover:bg-background-secondary/80"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleItem(option.id)}
                    disabled={disabled}
                    className="w-5 h-5 rounded border-border text-primary focus:ring-primary focus:ring-2 focus:ring-offset-0 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <span className={`text-sm font-medium flex-1 ${isSelected ? "text-foreground" : "text-foreground-secondary"}`}>
                    {option.name}
                  </span>
                  {isSelected && (
                    <Check className="w-5 h-5 text-primary flex-shrink-0" />
                  )}
                </label>
              );
            })
          )}
        </div>
      )}
      {value.length > 0 && (
        <div className="mt-2 text-xs text-foreground-muted">
          {value.length} {value.length === 1 ? `${itemLabel} seleccionado` : `${itemLabelPlural} seleccionadas`}
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm text-foreground-secondary">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`w-12 h-6 rounded-full transition-all ${
          checked ? "bg-emerald-500/80" : "bg-background-secondary"
        }`}
      >
        <span
          className={`block w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </label>
  );
}

function EmptyState({ icon: Icon = Users, title, body, action }) {
  return (
    <div className="border border-dashed border-border rounded-2xl p-10 text-center space-y-3 bg-background-secondary/40">
      <div className="mx-auto w-12 h-12 rounded-full bg-primary/5 text-primary flex items-center justify-center">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      {body ? <p className="text-sm text-foreground-secondary">{body}</p> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export default function InstructorsPage() {
  const { tenantSlug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState("instructors");
  const [loading, setLoading] = useState(false);

  const [instructors, setInstructors] = useState([]);
  const [services, setServices] = useState([]);
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(true);

  const [instructorForm, setInstructorForm] = useState(DEFAULT_INSTRUCTOR_FORM);
  const [editingInstructorId, setEditingInstructorId] = useState(null);
  const [savingInstructor, setSavingInstructor] = useState(false);

  const [serviceForm, setServiceForm] = useState(DEFAULT_SERVICE_FORM);
  const [editingServiceId, setEditingServiceId] = useState(null);
  const [savingService, setSavingService] = useState(false);

  const loadBranches = useCallback(async () => {
    try {
      setBranchesLoading(true);
      const response = await apiClient.listActiveBranches();
      setBranches(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      logger.error("[InstructorsPage] loadBranches error:", error);
      toast.error("No se pudieron cargar las sucursales");
    } finally {
      setBranchesLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [instructorsData, servicesData] = await Promise.all([
        apiClient.adminListInstructors(),
        apiClient.adminListServices(),
      ]);
      setInstructors(sortByName(instructorsData));
      setServices(sortByName(servicesData));
    } catch (error) {
      logger.error("Error cargando instructores o servicios", error);
      toast.error("No se pudieron cargar los datos", {
        description: error?.response?.data?.error || error?.message,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const defaultBranchId = user?.currentBranchId || user?.current_branch_id || null;

  useEffect(() => {
    loadBranches();
    loadData();
  }, [loadBranches, loadData]);

  useEffect(() => {
    if (!editingInstructorId && defaultBranchId && instructorForm.branchIds.length === 0) {
      setInstructorForm((prev) => ({ ...prev, branchIds: [defaultBranchId] }));
    }
  }, [defaultBranchId, editingInstructorId, instructorForm.branchIds.length]);

  const availableServices = useMemo(() => sortByName(services), [services]);
  const availableInstructors = useMemo(() => sortByName(instructors), [instructors]);

  const resetInstructorForm = () => {
    setEditingInstructorId(null);
    setInstructorForm({
      ...DEFAULT_INSTRUCTOR_FORM,
      branchIds: defaultBranchId ? [defaultBranchId] : [],
    });
  };

  const resetServiceForm = () => {
    setEditingServiceId(null);
    setServiceForm(DEFAULT_SERVICE_FORM);
  };

  const handleInstructorSubmit = async (event) => {
    event.preventDefault();
    if (!instructorForm.name.trim()) {
      toast.error("Ingresá el nombre del instructor.");
      return;
    }

    setSavingInstructor(true);
    try {
      const payload = {
        name: instructorForm.name.trim(),
        colorHex: instructorForm.colorHex || null,
        isActive: instructorForm.isActive,
        serviceIds: instructorForm.serviceIds,
        branchIds: instructorForm.branchIds || [],
        photoUrl: instructorForm.photoUrl || null,
        phoneE164: instructorForm.phoneE164 || null,
      };

      if (editingInstructorId) {
        await apiClient.adminUpdateInstructor(editingInstructorId, payload);
        toast.success("Instructor actualizado");
      } else {
        await apiClient.adminCreateInstructor(payload);
        toast.success("Instructor creado");
      }
      resetInstructorForm();
      await loadData();
    } catch (error) {
      logger.error("Error guardando instructor", error);
      toast.error("No se pudo guardar el instructor", {
        description: error?.response?.data?.error || error?.message,
      });
    } finally {
      setSavingInstructor(false);
    }
  };

  const handleServiceSubmit = async (event) => {
    event.preventDefault();
    if (!serviceForm.name.trim()) {
      toast.error("Ingresá el nombre del servicio.");
      return;
    }

    if (!Number.isFinite(Number(serviceForm.durationMin)) || Number(serviceForm.durationMin) <= 0) {
      toast.error("Ingresá una duración válida.");
      return;
    }

    if (!Number.isFinite(Number(serviceForm.priceDecimal)) || Number(serviceForm.priceDecimal) < 0) {
      toast.error("Ingresá un precio válido.");
      return;
    }

    setSavingService(true);
    try {
      const payload = {
        name: serviceForm.name.trim(),
        durationMin: Number(serviceForm.durationMin),
        priceDecimal: Number(serviceForm.priceDecimal),
        isActive: serviceForm.isActive,
        instructorIds: serviceForm.instructorIds,
      };

      if (editingServiceId) {
        await apiClient.adminUpdateService(editingServiceId, payload);
        toast.success("Servicio actualizado");
      } else {
        await apiClient.adminCreateService(payload);
        toast.success("Servicio creado");
      }
      resetServiceForm();
      await loadData();
    } catch (error) {
      logger.error("Error guardando servicio", error);
      toast.error("No se pudo guardar el servicio", {
        description: error?.response?.data?.error || error?.message,
      });
    } finally {
      setSavingService(false);
    }
  };

  const handleDeleteInstructor = async (id) => {
    const target = instructors.find((item) => item.id === id);
    const label = target?.name || "el instructor";
    if (!window.confirm(`¿Desactivar ${label}?`)) return;
    try {
      await apiClient.adminDeleteInstructor(id);
      toast.success("Instructor desactivado");
      if (editingInstructorId === id) {
        resetInstructorForm();
      }
      await loadData();
    } catch (error) {
      logger.error("Error eliminando instructor", error);
      toast.error("No se pudo desactivar el instructor", {
        description: error?.response?.data?.error || error?.message,
      });
    }
  };

  const handleDeleteService = async (id) => {
    const target = services.find((item) => item.id === id);
    const label = target?.name || "el servicio";
    if (!window.confirm(`¿Desactivar ${label}?`)) return;
    try {
      await apiClient.adminDeleteService(id);
      toast.success("Servicio desactivado");
      if (editingServiceId === id) {
        resetServiceForm();
      }
      await loadData();
    } catch (error) {
      logger.error("Error eliminando servicio", error);
      toast.error("No se pudo desactivar el servicio", {
        description: error?.response?.data?.error || error?.message,
      });
    }
  };

  const isLoading = loading && instructors.length === 0 && services.length === 0;

  return (
    <div className="space-y-8">
      <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-foreground">Equipo e inventario de clases</h1>
          <p className="text-sm text-foreground-secondary">
            Gestioná instructores, servicios y sus asociaciones en un solo lugar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={tab === "instructors" ? "primary" : "secondary"}
            onClick={() => setTab("instructors")}
          >
            Instructores
          </Button>
          <Button
            variant={tab === "services" ? "primary" : "secondary"}
            onClick={() => setTab("services")}
          >
            Servicios
          </Button>
          <Button
            variant="secondary"
            onClick={() => navigate(`/${tenantSlug}/admin/instructores/estadisticas`)}
          >
            Horarios & estadísticas
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center gap-3 py-24 text-foreground-secondary">
          <Loader2 className="w-5 h-5 animate-spin" />
          Cargando…
        </div>
      ) : tab === "instructors" ? (
        <section className="grid grid-cols-1 xl:grid-cols-[1.2fr_minmax(0,0.8fr)] gap-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-foreground">Instructores</h2>
              <Button
                onClick={() => {
                  resetInstructorForm();
                  setEditingInstructorId(null);
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Nuevo instructor
              </Button>
            </div>

            {instructors.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Todavía no cargaste instructores"
                body="Creá tu primer instructor para asignarlo a clases y servicios."
                action={
                  <Button onClick={() => setInstructorForm(DEFAULT_INSTRUCTOR_FORM)}>Crear instructor</Button>
                }
              />
            ) : (
              <div className="border border-border/80 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-background-secondary/60 border-b border-border/60 text-xs uppercase tracking-wide text-foreground-muted">
                    <tr>
                      <th className="text-left py-3 px-4">Nombre</th>
                      <th className="text-left py-3 px-4">Servicios</th>
                      <th className="text-left py-3 px-4">Sucursal</th>
                      <th className="text-left py-3 px-4">Estado</th>
                      <th className="text-right py-3 px-4">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {instructors.map((instructor) => (
                      <tr key={instructor.id} className="border-b border-border/50 last:border-b-0">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            {instructor.photoUrl ? (
                              <img
                                src={instructor.photoUrl}
                                alt={instructor.name}
                                className="w-8 h-8 rounded-full object-cover border border-border"
                              />
                            ) : (
                              <span
                                className="inline-flex w-2.5 h-2.5 rounded-full ring-2 ring-offset-2 ring-offset-background"
                                style={{ backgroundColor: instructor.colorHex || "#6366F1" }}
                              />
                            )}
                            <div>
                              <p className="font-medium text-foreground">{instructor.name}</p>
                              <p className="text-xs text-foreground-muted">ID {instructor.id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-foreground-secondary">
                          {instructor.services.length ? (
                            <div className="flex flex-wrap gap-1">
                              {instructor.services.map((service) => (
                                <span
                                  key={`${instructor.id}-service-${service.id}`}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border/70 bg-background-secondary text-xs"
                                >
                                  <CalendarCheck className="w-3 h-3 text-foreground-muted" />
                                  {service.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-foreground-muted italic">
                              Sin servicios asociados
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-foreground-secondary">
                          {instructor.branchNames && instructor.branchNames.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {instructor.branchNames.map((branchName, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border/60 bg-background text-xs"
                                >
                                  {branchName}
                                </span>
                              ))}
                            </div>
                          ) : instructor.branchName ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border/60 bg-background text-xs">
                              {instructor.branchName}
                            </span>
                          ) : (
                            <span className="text-xs text-foreground-muted italic">Sin asignar</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium ${
                              instructor.isActive
                                ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40"
                                : "bg-zinc-500/10 text-zinc-300 border border-zinc-500/40"
                            }`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full ${
                                instructor.isActive ? "bg-emerald-400" : "bg-zinc-400"
                              }`}
                            />
                            {instructor.isActive ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              className="p-2 rounded-lg hover:bg-background-secondary transition"
                              onClick={() => {
                                setEditingInstructorId(instructor.id);
                                setInstructorForm({
                                  name: instructor.name,
                                  colorHex: instructor.colorHex || "#2563EB",
                                  isActive: instructor.isActive,
                                  serviceIds: instructor.serviceIds || [],
                                  branchIds: instructor.branchIds || (instructor.branchId ? [instructor.branchId] : (defaultBranchId ? [defaultBranchId] : [])),
                                  photoUrl: instructor.photoUrl || "",
                                  phoneE164: instructor.phoneE164 || "",
                                });
                              }}
                              aria-label="Editar instructor"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              className="p-2 rounded-lg hover:bg-red-500/10 text-red-400 transition"
                              onClick={() => handleDeleteInstructor(instructor.id)}
                              aria-label="Desactivar instructor"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="border border-border/80 rounded-2xl bg-background-secondary/40 p-6 space-y-5">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">
                {editingInstructorId ? "Editar instructor" : "Nuevo instructor"}
              </h3>
            </div>

            <form className="space-y-4" onSubmit={handleInstructorSubmit}>
              <label className="flex flex-col gap-2 text-sm text-foreground-secondary">
                <span className="font-medium text-foreground">Nombre</span>
                <input
                  className="input"
                  placeholder="Nombre y apellido"
                  value={instructorForm.name}
                  onChange={(event) =>
                    setInstructorForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  required
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-foreground-secondary">
                <span className="font-medium text-foreground">Foto (URL)</span>
                <input
                  className="input"
                  placeholder="https://..."
                  value={instructorForm.photoUrl}
                  onChange={(event) =>
                    setInstructorForm((prev) => ({ ...prev, photoUrl: event.target.value }))
                  }
                />
                {instructorForm.photoUrl && (
                  <div className="mt-2">
                    <img
                      src={instructorForm.photoUrl}
                      alt="Vista previa"
                      className="w-16 h-16 rounded-full object-cover border border-border"
                    />
                  </div>
                )}
              </label>

              <label className="flex flex-col gap-2 text-sm text-foreground-secondary">
                <span className="font-medium text-foreground">Teléfono WhatsApp</span>
                <input
                  className="input"
                  placeholder="+54911..."
                  value={instructorForm.phoneE164}
                  onChange={(event) =>
                    setInstructorForm((prev) => ({ ...prev, phoneE164: event.target.value }))
                  }
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-foreground-secondary">
                <span className="font-medium text-foreground">Color de identificación</span>
                <input
                  type="color"
                  className="h-12 w-20 rounded-lg border border-border cursor-pointer"
                  value={instructorForm.colorHex || "#2563EB"}
                  onChange={(event) =>
                    setInstructorForm((prev) => ({ ...prev, colorHex: event.target.value }))
                  }
                />
              </label>

              <MultiSelect
                label="Sucursales"
                value={instructorForm.branchIds}
                options={branches}
                onChange={(branchIds) =>
                  setInstructorForm((prev) => ({ ...prev, branchIds }))
                }
                helper="Definí en qué sedes trabaja este empleado."
                disabled={branchesLoading || branches.length === 0}
                loading={branchesLoading}
                emptyMessage={branches.length === 0 ? "No hay sucursales activas" : null}
              />

              <MultiSelect
                label="Servicios habilitados"
                value={instructorForm.serviceIds}
                options={availableServices}
                onChange={(serviceIds) =>
                  setInstructorForm((prev) => ({ ...prev, serviceIds }))
                }
                helper="Seleccioná los servicios que puede prestar."
              />

              <Toggle
                label="Instructor activo"
                checked={instructorForm.isActive}
                onChange={(isActive) => setInstructorForm((prev) => ({ ...prev, isActive }))}
              />

              <div className="flex items-center gap-2 pt-2">
                <Button type="submit" disabled={savingInstructor}>
                  {savingInstructor ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : editingInstructorId ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Guardar cambios
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Crear instructor
                    </>
                  )}
                </Button>
                {editingInstructorId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={resetInstructorForm}
                    className="text-foreground-secondary"
                  >
                    Cancelar
                  </Button>
                ) : null}
              </div>
            </form>
          </div>
        </section>
      ) : (
        <section className="grid grid-cols-1 xl:grid-cols-[1.2fr_minmax(0,0.8fr)] gap-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-foreground">Servicios</h2>
              <Button
                onClick={() => {
                  resetServiceForm();
                  setEditingServiceId(null);
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Nuevo servicio
              </Button>
            </div>

            {services.length === 0 ? (
              <EmptyState
                icon={CalendarCheck}
                title="No hay servicios configurados"
                body="Definí los servicios para poder asignarlos a tus instructores."
                action={<Button onClick={() => setServiceForm(DEFAULT_SERVICE_FORM)}>Crear servicio</Button>}
              />
            ) : (
              <div className="border border-border/80 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-background-secondary/60 border-b border-border/60 text-xs uppercase tracking-wide text-foreground-muted">
                    <tr>
                      <th className="text-left py-3 px-4">Servicio</th>
                      <th className="text-left py-3 px-4">Instructores</th>
                      <th className="text-left py-3 px-4">Duración</th>
                      <th className="text-left py-3 px-4">Precio</th>
                      <th className="text-left py-3 px-4">Estado</th>
                      <th className="text-right py-3 px-4">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {services.map((service) => (
                      <tr key={service.id} className="border-b border-border/50 last:border-b-0">
                        <td className="py-3 px-4">
                          <div>
                            <p className="font-medium text-foreground">{service.name}</p>
                            <p className="text-xs text-foreground-muted">ID {service.id}</p>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-foreground-secondary">
                          {service.instructors.length ? (
                            <div className="flex flex-wrap gap-1">
                              {service.instructors.map((instructor) => (
                                <span
                                  key={`${service.id}-instructor-${instructor.id}`}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border/70 bg-background-secondary text-xs"
                                >
                                  <Users className="w-3 h-3 text-foreground-muted" />
                                  {instructor.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-foreground-muted italic">
                              Sin instructores asignados
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-foreground-secondary">{service.durationMin} min</td>
                        <td className="py-3 px-4 text-foreground-secondary">
                          {new Intl.NumberFormat("es-AR", {
                            style: "currency",
                            currency: "ARS",
                            maximumFractionDigits: 2,
                          }).format(service.priceDecimal || 0)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium ${
                              service.isActive
                                ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40"
                                : "bg-zinc-500/10 text-zinc-300 border border-zinc-500/40"
                            }`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full ${
                                service.isActive ? "bg-emerald-400" : "bg-zinc-400"
                              }`}
                            />
                            {service.isActive ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              className="p-2 rounded-lg hover:bg-background-secondary transition"
                              onClick={() => {
                                setEditingServiceId(service.id);
                                setServiceForm({
                                  name: service.name,
                                  durationMin: service.durationMin || 60,
                                  priceDecimal: service.priceDecimal || 0,
                                  isActive: service.isActive,
                                  instructorIds: service.instructorIds || [],
                                });
                              }}
                              aria-label="Editar servicio"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              className="p-2 rounded-lg hover:bg-red-500/10 text-red-400 transition"
                              onClick={() => handleDeleteService(service.id)}
                              aria-label="Desactivar servicio"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="border border-border/80 rounded-2xl bg-background-secondary/40 p-6 space-y-5">
            <div className="flex items-center gap-2">
              <CalendarCheck className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">
                {editingServiceId ? "Editar servicio" : "Nuevo servicio"}
              </h3>
            </div>

            <form className="space-y-4" onSubmit={handleServiceSubmit}>
              <label className="flex flex-col gap-2 text-sm text-foreground-secondary">
                <span className="font-medium text-foreground">Nombre</span>
                <input
                  className="input"
                  placeholder="Ej: Clase de yoga"
                  value={serviceForm.name}
                  onChange={(event) =>
                    setServiceForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  required
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-foreground-secondary">
                <span className="font-medium text-foreground">Duración (minutos)</span>
                <input
                  type="number"
                  min={1}
                  className="input"
                  value={serviceForm.durationMin}
                  onChange={(event) =>
                    setServiceForm((prev) => ({ ...prev, durationMin: event.target.value }))
                  }
                  required
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-foreground-secondary">
                <span className="font-medium text-foreground">Precio</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input"
                  value={serviceForm.priceDecimal}
                  onChange={(event) =>
                    setServiceForm((prev) => ({ ...prev, priceDecimal: event.target.value }))
                  }
                  required
                />
              </label>

              <MultiSelect
                label="Instructores habilitados"
                value={serviceForm.instructorIds}
                options={availableInstructors}
                onChange={(instructorIds) =>
                  setServiceForm((prev) => ({ ...prev, instructorIds }))
                }
                helper="Estos instructores pueden dictar el servicio."
              />

              <Toggle
                label="Servicio activo"
                checked={serviceForm.isActive}
                onChange={(isActive) => setServiceForm((prev) => ({ ...prev, isActive }))}
              />

              <div className="flex items-center gap-2 pt-2">
                <Button type="submit" disabled={savingService}>
                  {savingService ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : editingServiceId ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Guardar cambios
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Crear servicio
                    </>
                  )}
                </Button>
                {editingServiceId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={resetServiceForm}
                    className="text-foreground-secondary"
                  >
                    Cancelar
                  </Button>
                ) : null}
              </div>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}





