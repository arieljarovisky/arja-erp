import React, { useEffect, useState } from "react";
import { apiClient } from "../api";
import { useQuery } from "../shared/useQuery.js";
import { toast } from "sonner";
import { SearchInput } from "../shared/ui.jsx";
import { useDebouncedValue } from "../shared/useDebouncedValue.js";
import { useTranslation } from "../i18n/useTranslation.js";
import { Link, useParams } from "react-router-dom";
import { Plus, Upload, Trash2, Edit, UserPlus, UserCheck } from "lucide-react";

export default function WorkoutRoutinesPage() {
  const { t } = useTranslation();
  const { tenantSlug } = useParams();
  const [searchQuery, setSearchQuery] = useState("");
  const qDebounced = useDebouncedValue(searchQuery, 300);
  const [selectedRoutine, setSelectedRoutine] = useState(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [customers, setCustomers] = useState([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [bodyParts, setBodyParts] = useState([]);
  const [selectedBodyParts, setSelectedBodyParts] = useState([]);
  const [routineName, setRoutineName] = useState("");
  const [routineDescription, setRoutineDescription] = useState("");
  const [difficulty, setDifficulty] = useState("intermedio");
  const [duration, setDuration] = useState(60);
  const [assignToCustomerId, setAssignToCustomerId] = useState(null);

  const { data: routines, loading, error, refetch } = useQuery(
    (signal) => apiClient.getAvailableRoutines(),
    []
  );

  // Cargar partes del cuerpo
  useEffect(() => {
    const loadBodyParts = async () => {
      try {
        const data = await apiClient.getBodyParts();
        setBodyParts(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Error cargando partes del cuerpo:", error);
      }
    };
    loadBodyParts();
  }, []);

  // Cargar clientes cuando se abre el modal de crear
  useEffect(() => {
    if (showCreateModal) {
      const loadCustomers = async () => {
        setLoadingCustomers(true);
        try {
          const customersData = await apiClient.listCustomers("", null, { limit: 500 });
          setCustomers(Array.isArray(customersData) ? customersData : customersData?.data || []);
        } catch (error) {
          console.error("Error cargando clientes:", error);
        } finally {
          setLoadingCustomers(false);
        }
      };
      loadCustomers();
    }
  }, [showCreateModal]);

  const routinesList = Array.isArray(routines) ? routines : [];

  // Filtrar rutinas por búsqueda
  const filteredRoutines = routinesList.filter((routine) => {
    if (!qDebounced) return true;
    const search = qDebounced.toLowerCase();
    return (
      routine.name?.toLowerCase().includes(search) ||
      routine.description?.toLowerCase().includes(search) ||
      routine.difficulty?.toLowerCase().includes(search)
    );
  });

  const handleAssignClick = async (routine) => {
    setSelectedRoutine(routine);
    setShowAssignModal(true);
    setCustomerSearchQuery(""); // Resetear búsqueda
    // Cargar lista de clientes
    setLoadingCustomers(true);
    try {
      const customersData = await apiClient.listCustomers("", null, { limit: 500 });
      setCustomers(Array.isArray(customersData) ? customersData : customersData?.data || []);
    } catch (error) {
      console.error("Error cargando clientes:", error);
      toast.error("Error al cargar la lista de clientes");
    } finally {
      setLoadingCustomers(false);
    }
  };

  const handleAssignToCustomer = async (customerId) => {
    if (!selectedRoutine) return;

    try {
      setAssigning(true);
      await apiClient.assignRoutineToCustomer(selectedRoutine.id, customerId);
      toast.success("Rutina asignada correctamente");
      setShowAssignModal(false);
      setSelectedRoutine(null);
      await refetch();
    } catch (error) {
      console.error("Error asignando rutina:", error);
      toast.error(error?.response?.data?.error || "Error al asignar la rutina");
    } finally {
      setAssigning(false);
    }
  };

  const getAssignedCustomerName = (routine) => {
    if (routine.assigned_to_customer_id) {
      // Primero intentar usar el nombre que viene del backend
      if (routine.assigned_customer_name) {
        return routine.assigned_customer_name;
      }
      // Si no está, buscar en la lista de clientes cargados
      const customer = customers.find((c) => c.id === routine.assigned_to_customer_id);
      return customer ? customer.name : `Cliente #${routine.assigned_to_customer_id}`;
    }
    return null;
  };

  const handleCreateRoutine = async () => {
    if (!routineName.trim()) {
      toast.error(t("routines.routineNameRequired"));
      return;
    }

    try {
      setCreating(true);
      const params = {
        name: routineName.trim(),
        description: routineDescription.trim() || '',
        duration_minutes: duration,
        difficulty,
        body_parts: selectedBodyParts,
        exercises_data: {
          exercises: [],
          warmup: [],
          cooldown: [],
        },
      };
      
      if (assignToCustomerId) {
        params.assigned_to_customer_id = assignToCustomerId;
      }

      await apiClient.createWorkoutRoutine(params);
      toast.success("Rutina creada exitosamente");
      setShowCreateModal(false);
      // Resetear formulario
      setRoutineName("");
      setRoutineDescription("");
      setSelectedBodyParts([]);
      setDifficulty("intermedio");
      setDuration(60);
      setAssignToCustomerId(null);
      await refetch();
    } catch (error) {
      console.error("Error creando rutina:", error);
      toast.error(error?.response?.data?.error || "Error al crear la rutina");
    } finally {
      setCreating(false);
    }
  };

  const toggleBodyPart = (bodyPartId) => {
    setSelectedBodyParts((prev) =>
      prev.includes(bodyPartId)
        ? prev.filter((id) => id !== bodyPartId)
        : [...prev, bodyPartId]
    );
  };

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-1">{t("routines.title")}</h1>
          <p className="text-sm text-foreground-secondary">
            {t("routines.manageAndAssign")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImportModal(true)}
            className="px-4 py-2 text-sm font-medium text-foreground-secondary hover:text-foreground border border-border rounded-lg hover:bg-background-secondary transition-colors flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            {t("routines.importRoutines")}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-hover transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t("routines.createRoutine")}
          </button>
        </div>
      </div>

      {/* Búsqueda */}
      <div className="flex items-center justify-between gap-3">
        <div className="w-full flex flex-col gap-0">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={t("routines.searchPlaceholder")}
            width="100%"
          />
        </div>
      </div>

      {/* Lista de rutinas */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="px-6 py-12 flex flex-col items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mb-3" />
            <div className="text-sm text-foreground-muted">{t("common.loading")}</div>
          </div>
        ) : error ? (
          <div className="px-6 py-12 text-center">
            <div className="text-sm text-red-400 mb-2">Error al cargar rutinas</div>
            <div className="text-xs text-foreground-muted">{error}</div>
          </div>
        ) : filteredRoutines.length === 0 ? (
          <div className="px-6 py-12 flex flex-col items-center justify-center text-center">
            <div className="text-sm text-foreground-secondary mb-1">
              {qDebounced ? t("routines.noRoutinesFound") : t("routines.noRoutinesYet")}
            </div>
            <div className="text-xs text-foreground-muted">
              {qDebounced
                ? t("routines.tryAnotherSearch")
                : t("routines.routinesWillAppear")}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredRoutines.map((routine) => {
              const assignedCustomer = getAssignedCustomerName(routine);
              return (
                <div
                  key={routine.id}
                  className="px-6 py-4 hover:bg-background-secondary/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-base font-semibold text-foreground">{routine.name}</h3>
                        {routine.difficulty && (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-primary-500/10 text-primary-400 border border-primary-500/20">
                            {routine.difficulty}
                          </span>
                        )}
                        {routine.duration_minutes && (
                          <span className="text-xs text-foreground-muted">
                            ⏱️ {routine.duration_minutes} min
                          </span>
                        )}
                      </div>
                      {routine.description && (
                        <p className="text-sm text-foreground-secondary mb-3 line-clamp-2">
                          {routine.description}
                        </p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-foreground-muted">
                        {assignedCustomer ? (
                          <div className="flex items-center gap-2">
                            <span className="text-foreground-secondary">{t("routines.assignedTo")}</span>
                            <Link
                              to={`/${tenantSlug}/customers/${routine.assigned_to_customer_id}`}
                              className="text-primary hover:text-primary-hover font-medium"
                            >
                              {assignedCustomer}
                            </Link>
                          </div>
                        ) : (
                          <span className="text-foreground-muted">{t("routines.unassigned")}</span>
                        )}
                        {routine.created_at && (
                          <span>
                            {t("routines.created")} {new Date(routine.created_at).toLocaleDateString("es-AR")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/${tenantSlug}/workout-routines/${routine.id}/edit`}
                        className="p-2 text-foreground-secondary hover:text-foreground border border-border rounded-lg hover:bg-background-secondary transition-colors"
                        title={t("routines.editRoutine")}
                      >
                        <Edit className="w-5 h-5" />
                      </Link>
                      <button
                        onClick={() => handleAssignClick(routine)}
                        className="p-2 text-white bg-primary rounded-lg hover:bg-primary-hover transition-colors"
                        title={assignedCustomer ? t("routines.reassignRoutine") : t("routines.assignRoutine")}
                      >
                        {assignedCustomer ? <UserCheck className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(t("routines.confirmDelete", { name: routine.name }))) {
                            return;
                          }
                          
                          try {
                            setDeleting(routine.id);
                            await apiClient.deleteWorkoutRoutine(routine.id);
                            toast.success("Rutina eliminada correctamente");
                            await refetch();
                          } catch (error) {
                            console.error("Error eliminando rutina:", error);
                            toast.error(error?.response?.data?.error || "Error al eliminar la rutina");
                          } finally {
                            setDeleting(null);
                          }
                        }}
                        disabled={deleting === routine.id}
                        className="p-2 text-rose-400 hover:text-rose-300 border border-rose-500/20 rounded-lg hover:bg-rose-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title={t("routines.deleteRoutine")}
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal para asignar rutina */}
      {showAssignModal && selectedRoutine && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => {
            setShowAssignModal(false);
            setSelectedRoutine(null);
          }}
        >
          <div
            className="bg-background rounded-lg border border-border p-6 max-w-md w-full mx-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <h3 className="text-lg font-semibold text-foreground">
                {t("routines.assignRoutineTitle", { name: selectedRoutine.name })}
              </h3>
              <button
                onClick={() => {
                  setShowAssignModal(false);
                  setSelectedRoutine(null);
                  setCustomerSearchQuery("");
                }}
                className="text-foreground-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>

            {/* Campo de búsqueda */}
            <div className="mb-4 flex-shrink-0">
              <SearchInput
                value={customerSearchQuery}
                onChange={setCustomerSearchQuery}
                placeholder={t("routines.searchCustomer")}
                width="100%"
              />
            </div>

            {loadingCustomers ? (
              <div className="py-8 flex items-center justify-center flex-1">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500" />
              </div>
            ) : (
              <>
                {/* Lista de clientes filtrados */}
                <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                  {(() => {
                    // Filtrar clientes por búsqueda
                    const filteredCustomers = customers.filter((customer) => {
                      if (!customerSearchQuery.trim()) return true;
                      const query = customerSearchQuery.toLowerCase();
                      const name = (customer.name || "").toLowerCase();
                      const phone = (customer.phone || "").toLowerCase();
                      return name.includes(query) || phone.includes(query);
                    });

                    if (filteredCustomers.length === 0) {
                      return (
                        <div className="text-sm text-foreground-secondary py-8 text-center">
                          {customerSearchQuery
                            ? t("routines.noCustomersFound")
                            : t("routines.noCustomersAvailable")}
                        </div>
                      );
                    }

                    return filteredCustomers.map((customer) => {
                      const isAssigned = selectedRoutine.assigned_to_customer_id === customer.id;
                      const initials = customer.name
                        ? customer.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .toUpperCase()
                            .slice(0, 2)
                        : "??";
                      
                      return (
                        <button
                          key={customer.id}
                          onClick={() => handleAssignToCustomer(customer.id)}
                          disabled={assigning || isAssigned}
                          className={`w-full text-left p-3 rounded-lg border transition-colors ${
                            isAssigned
                              ? "border-primary bg-primary/10 cursor-not-allowed"
                              : "border-border bg-background-secondary/40 hover:bg-background-secondary"
                          } disabled:opacity-50`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              {/* Foto del cliente */}
                              <div className="relative flex-shrink-0">
                                {customer.picture ? (
                                  <img
                                    src={customer.picture}
                                    alt={customer.name || "Cliente"}
                                    className="w-10 h-10 rounded-full object-cover border border-border"
                                    onError={(e) => {
                                      e.target.style.display = 'none';
                                      e.target.nextSibling.style.display = 'flex';
                                    }}
                                  />
                                ) : null}
                                <div
                                  className={`w-10 h-10 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-semibold text-primary ${
                                    customer.picture ? 'hidden' : 'flex'
                                  }`}
                                >
                                  {initials}
                                </div>
                              </div>
                              
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-foreground truncate">
                                  {customer.name || t("customers.noName")}
                                </div>
                                {customer.phone && (
                                  <div className="text-xs text-foreground-muted mt-1 truncate">
                                    {customer.phone}
                                  </div>
                                )}
                              </div>
                            </div>
                            {isAssigned && (
                              <span className="text-xs font-medium text-primary ml-2 flex-shrink-0">
                                {t("routines.assigned")}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    });
                  })()}
                </div>

                {/* Contador de resultados */}
                {customerSearchQuery && customers.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border text-xs text-foreground-muted text-center flex-shrink-0">
                    {(() => {
                      const filtered = customers.filter((customer) => {
                        if (!customerSearchQuery.trim()) return true;
                        const query = customerSearchQuery.toLowerCase();
                        const name = (customer.name || "").toLowerCase();
                        const phone = (customer.phone || "").toLowerCase();
                        return name.includes(query) || phone.includes(query);
                      });
                      return t("routines.ofCustomers", { filtered: filtered.length, total: customers.length });
                    })()}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal para crear rutina */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => {
            setShowCreateModal(false);
            setRoutineName("");
            setRoutineDescription("");
            setSelectedBodyParts([]);
            setDifficulty("intermedio");
            setDuration(60);
            setAssignToCustomerId(null);
          }}
        >
          <div
            className="bg-background rounded-lg border border-border p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Crear nueva rutina</h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setRoutineName("");
                  setRoutineDescription("");
                  setSelectedBodyParts([]);
                  setDifficulty("intermedio");
                  setDuration(60);
                  setAssignToCustomerId(null);
                }}
                className="text-foreground-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6">
              {/* Nombre de la rutina */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t("routines.routineName")} <span className="text-red-400">{t("routines.required")}</span>
                </label>
                <input
                  type="text"
                  value={routineName}
                  onChange={(e) => setRoutineName(e.target.value)}
                  placeholder="Ej: Rutina de fuerza para principiantes"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                />
              </div>

              {/* Descripción */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t("routines.description")}
                </label>
                <textarea
                  value={routineDescription}
                  onChange={(e) => setRoutineDescription(e.target.value)}
                  placeholder="Describe la rutina, objetivos, etc..."
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background min-h-24"
                />
              </div>

              {/* Partes del cuerpo */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-3">
                  Partes del cuerpo (opcional)
                </label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {bodyParts.map((part) => (
                    <button
                      key={part.id}
                      type="button"
                      onClick={() => toggleBodyPart(part.id)}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        selectedBodyParts.includes(part.id)
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background-secondary/40 hover:bg-background-secondary"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedBodyParts.includes(part.id)}
                          onChange={() => toggleBodyPart(part.id)}
                          className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                        />
                        <span className="text-sm font-medium text-foreground">{part.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Dificultad y duración */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Dificultad
                  </label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                  >
                    <option value="principiante">Principiante</option>
                    <option value="intermedio">Intermedio</option>
                    <option value="avanzado">Avanzado</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Duración (minutos)
                  </label>
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    min="15"
                    max="180"
                    step="15"
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                  />
                </div>
              </div>

              {/* Asignar a cliente (opcional) */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t("routines.assignDirectly")}
                </label>
                <select
                  value={assignToCustomerId || ""}
                  onChange={(e) => setAssignToCustomerId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                >
                  <option value="">No asignar ahora</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name || t("customers.noName")} {customer.phone ? `- ${customer.phone}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Botones */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setRoutineName("");
                    setRoutineDescription("");
                    setSelectedBodyParts([]);
                    setDifficulty("intermedio");
                    setDuration(60);
                    setAssignToCustomerId(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-foreground-secondary hover:text-foreground"
                  disabled={creating}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreateRoutine}
                  disabled={creating || !routineName.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? t("common.saving") : t("routines.createRoutine")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de importación */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg border border-border p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-foreground">{t("routines.importTitle")}</h2>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-foreground-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-foreground-secondary mb-4">
                  {t("routines.uploadWordFile")}
                </p>
                
                <div className="mb-4">
                  <label className="block text-sm font-medium text-foreground-secondary mb-2">
                    {t("routines.wordFileLabel")}
                  </label>
                  <input
                    type="file"
                    accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      try {
                        setImporting(true);
                        const result = await apiClient.importWorkoutRoutineFromWord(file);

                        if (result?.data) {
                          toast.success(t("routines.importSuccess", { name: result.data.name }));
                          await refetch();
                          setShowImportModal(false);
                        }
                      } catch (error) {
                        console.error("Error importando rutina desde Word:", error);
                        toast.error(error?.response?.data?.error || t("routines.importError"));
                      } finally {
                        setImporting(false);
                        e.target.value = ''; // Reset input
                      }
                    }}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                    disabled={importing}
                  />
                  <p className="text-xs text-foreground-muted mt-1 mb-3">
                    {t("routines.importDocument")}
                  </p>
                  
                  <div className="bg-background-secondary rounded-lg p-4 border border-border">
                    <p className="text-xs font-medium text-foreground-secondary mb-2">{t("routines.wordExampleTitle")}</p>
                    <div className="bg-white dark:bg-gray-900 rounded border border-border p-4 text-sm font-mono text-left whitespace-pre-wrap text-foreground">
{`RUTINA DE PIERNAS Y GLÚTEOS

Descripción: Rutina completa para trabajar piernas y glúteos

Dificultad: Intermedio
Duración: 60 minutos

EJERCICIOS PRINCIPALES

Sentadillas
3 series x 10-12 repeticiones
Descanso: 60 segundos
Descripción: Realizar sentadillas profundas manteniendo la espalda recta

Prensa de piernas
4 series x 8-10 repeticiones
Descanso: 90 segundos
Descripción: Ejecutar con control completo del movimiento

Zancadas
3 series x 12 repeticiones por pierna
Descanso: 45 segundos

CALENTAMIENTO

Movilidad de cadera
2 series x 10 repeticiones

ENFRIAMIENTO

Estiramiento de cuádriceps
30 segundos por pierna`}
                    </div>
                    <p className="text-xs text-foreground-muted mt-2">
                      {t("routines.autoDetect")}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
                  <button
                    onClick={() => setShowImportModal(false)}
                    disabled={importing}
                    className="px-4 py-2 text-sm font-medium text-foreground-secondary hover:text-foreground"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

