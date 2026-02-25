import { useState, useEffect, useMemo } from "react";
import { useQuery } from "../../shared/useQuery.js";
import { apiClient } from "../../api";
import {
  DollarSign,
  Plus,
  Search,
  Eye,
  XCircle,
  CheckCircle,
  Clock,
  Filter,
  Calendar,
  Lock,
  Unlock,
  TrendingUp,
  TrendingDown,
  Minus,
  Receipt,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { logger } from "../../utils/logger.js";

const PAYMENT_METHODS = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  mp: "Mercado Pago",
  other: "Otro",
};

const STATUS_COLORS = {
  open: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400",
  closed: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  cancelled: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
};

const STATUS_LABELS = {
  open: "Abierto",
  closed: "Cerrado",
  cancelled: "Cancelado",
};

export default function CashRegisterPage() {
  const { tenant, user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [selectedClosure, setSelectedClosure] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showCancelConfirmModal, setShowCancelConfirmModal] = useState(false);
  const [closureToCancel, setClosureToCancel] = useState(null);

  // Cargar sucursales disponibles según permisos del usuario
  useEffect(() => {
    const loadBranches = async () => {
      try {
        setBranchesLoading(true);
        const response = await apiClient.get("/api/branches/catalog");
        // El endpoint devuelve { ok: true, data: [...] }
        const branchesList = Array.isArray(response?.data?.data) 
          ? response.data.data 
          : Array.isArray(response?.data) 
            ? response.data 
            : [];
        logger.log("[CashRegisterPage] Sucursales cargadas:", branchesList);
        setBranches(branchesList);
      } catch (error) {
        logger.error("[CashRegisterPage] Error cargando sucursales:", error);
        setBranches([]);
      } finally {
        setBranchesLoading(false);
      }
    };
    loadBranches();
  }, [user]);

  // Obtener fecha máxima (hoy) - usar useMemo para que no cambie en cada render
  const maxDate = useMemo(() => new Date().toISOString().split("T")[0], []);

  // Formulario para crear cierre
  const [newClosure, setNewClosure] = useState({
    branchId: "",
    closureDate: maxDate,
    notes: "",
  });

  // Totales esperados para el modal de crear cierre
  const [expectedTotals, setExpectedTotals] = useState({
    expected_cash: 0,
    expected_card: 0,
    expected_transfer: 0,
    expected_mp: 0,
    total_expected: 0,
  });
  const [loadingExpectedTotals, setLoadingExpectedTotals] = useState(false);

  // Calcular totales esperados cuando cambia la fecha o sucursal
  useEffect(() => {
    const fetchExpectedTotals = async () => {
      if (!newClosure.closureDate) return;
      
      setLoadingExpectedTotals(true);
      try {
        const params = { date: newClosure.closureDate };
        if (newClosure.branchId) {
          params.branchId = newClosure.branchId;
        }
        const response = await apiClient.get("/api/cash-register/expected-totals", { params });
        if (response.data?.ok && response.data?.data) {
          setExpectedTotals(response.data.data);
        }
      } catch (error) {
        logger.error("[CashRegisterPage] Error calculando totales esperados:", error);
        // Si hay error, resetear a 0
        setExpectedTotals({
          expected_cash: 0,
          expected_card: 0,
          expected_transfer: 0,
          expected_mp: 0,
          total_expected: 0,
        });
      } finally {
        setLoadingExpectedTotals(false);
      }
    };

    fetchExpectedTotals();
  }, [newClosure.closureDate, newClosure.branchId]);

  // Formulario para cerrar cierre
  const [closeForm, setCloseForm] = useState({
    actual_cash: "",
    actual_card: "",
    actual_transfer: "",
    actual_mp: "",
    expenses: "",
    notes: "",
  });

  // Cargar cierres
  const { data: closures = [], loading, error, refetch } = useQuery(
    async () => {
      const params = new URLSearchParams();
      if (selectedBranch) params.append("branchId", selectedBranch);
      if (statusFilter) params.append("status", statusFilter);
      if (dateFrom) params.append("from", dateFrom);
      if (dateTo) params.append("to", dateTo);

      const response = await apiClient.get(
        `/api/cash-register/closures?${params.toString()}`
      );
      return response.data?.data || [];
    },
    [selectedBranch, statusFilter, dateFrom, dateTo]
  );

  const handleCreateClosure = async (e) => {
    e.preventDefault();
    try {
      const response = await apiClient.post("/api/cash-register/closures", {
        branchId: newClosure.branchId && newClosure.branchId !== "" ? Number(newClosure.branchId) : null,
        closureDate: newClosure.closureDate,
        notes: newClosure.notes || null,
      });

      if (response.data?.ok) {
        toast.success("Cierre de caja creado correctamente");
        setShowCreateModal(false);
        setNewClosure({
          branchId: "",
          closureDate: maxDate,
          notes: "",
        });
        refetch();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || "Error al crear el cierre");
    }
  };

  const handleCloseClosure = async (e) => {
    e.preventDefault();
    try {
      const response = await apiClient.put(
        `/api/cash-register/closures/${selectedClosure.id}/close`,
        {
          actual_cash: Number(closeForm.actual_cash) || 0,
          actual_card: Number(closeForm.actual_card) || 0,
          actual_transfer: Number(closeForm.actual_transfer) || 0,
          actual_mp: Number(closeForm.actual_mp) || 0,
          expenses: Number(closeForm.expenses) || 0,
          notes: closeForm.notes || null,
        }
      );

      if (response.data?.ok) {
        toast.success("Cierre de caja cerrado correctamente");
        setShowCloseModal(false);
        setSelectedClosure(null);
        setCloseForm({
          actual_cash: "",
          actual_card: "",
          actual_transfer: "",
          actual_mp: "",
          expenses: "",
          notes: "",
        });
        refetch();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || "Error al cerrar el cierre");
    }
  };

  const openCloseModal = async (closure) => {
    setSelectedClosure(closure);
    
    // Recalcular totales esperados basándose en la fecha del cierre
    try {
      const params = { date: closure.closure_date };
      if (closure.branch_id) {
        params.branchId = closure.branch_id;
      }
      const response = await apiClient.get("/api/cash-register/expected-totals", { params });
      if (response.data?.ok && response.data?.data) {
        // Actualizar el closure con los totales recalculados
        const updatedClosure = {
          ...closure,
          expected_cash: response.data.data.expected_cash,
          expected_card: response.data.data.expected_card,
          expected_transfer: response.data.data.expected_transfer,
          expected_mp: response.data.data.expected_mp,
          total_expected: response.data.data.total_expected,
        };
        setSelectedClosure(updatedClosure);
        setCloseForm({
          actual_cash: updatedClosure.expected_cash || "",
          actual_card: updatedClosure.expected_card || "",
          actual_transfer: updatedClosure.expected_transfer || "",
          actual_mp: updatedClosure.expected_mp || "",
          expenses: "",
          notes: closure.notes || "",
        });
      } else {
        // Si falla, usar los valores del closure
        setCloseForm({
          actual_cash: closure.expected_cash || "",
          actual_card: closure.expected_card || "",
          actual_transfer: closure.expected_transfer || "",
          actual_mp: closure.expected_mp || "",
          expenses: "",
          notes: closure.notes || "",
        });
      }
    } catch (error) {
      logger.error("[CashRegisterPage] Error recalculando totales:", error);
      // Si falla, usar los valores del closure
      setCloseForm({
        actual_cash: closure.expected_cash || "",
        actual_card: closure.expected_card || "",
        actual_transfer: closure.expected_transfer || "",
        actual_mp: closure.expected_mp || "",
        expenses: "",
        notes: closure.notes || "",
      });
    }
    
    setShowCloseModal(true);
  };

  const openDetailsModal = async (closure) => {
    try {
      const response = await apiClient.get(
        `/api/cash-register/closures/${closure.id}`
      );
      if (response.data?.ok) {
        setSelectedClosure(response.data.data);
        setShowDetailsModal(true);
      }
    } catch (error) {
      toast.error("Error al cargar los detalles del cierre");
    }
  };

  const handleCancelClosure = (closure) => {
    if (!isAdmin) {
      toast.error("Solo los administradores pueden anular cierres");
      return;
    }
    setClosureToCancel(closure);
    setShowCancelConfirmModal(true);
  };

  const confirmCancelClosure = async () => {
    if (!closureToCancel) return;

    try {
      const response = await apiClient.put(
        `/api/cash-register/closures/${closureToCancel.id}/cancel`
      );
      if (response.data?.ok) {
        toast.success("Cierre anulado correctamente");
        refetch();
        setShowCancelConfirmModal(false);
        setClosureToCancel(null);
      }
    } catch (error) {
      toast.error(
        error.response?.data?.error || "Error al anular el cierre"
      );
    }
  };

  const filteredClosures = (closures || []).filter((closure) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      closure.user_name?.toLowerCase().includes(searchLower) ||
      closure.branch_name?.toLowerCase().includes(searchLower) ||
      closure.id?.toString().includes(searchLower)
    );
  });

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
    }).format(amount || 0);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("es-AR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("es-AR", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-6 animate-fade-in overflow-x-hidden max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1 sm:mb-2">
            Cierre de Caja
          </h1>
          <p className="text-sm sm:text-base text-foreground-secondary">
            Gestiona los cierres de caja diarios
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary flex items-center gap-2 whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Nuevo Cierre
        </button>
      </div>

      {/* Filtros */}
      <div className="card p-4 overflow-x-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2 min-w-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-foreground-muted" />
              <input
                type="text"
                placeholder="Buscar por usuario, sucursal o ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-background-secondary border border-border text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/50 min-w-0"
              />
            </div>
          </div>

          {branches && branches.length > 0 && (
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 min-w-0"
            >
              <option value="">Todas las sucursales</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          )}

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 min-w-0"
          >
            <option value="">Todos los estados</option>
            <option value="open">Abierto</option>
            <option value="closed">Cerrado</option>
            <option value="cancelled">Cancelado</option>
          </select>

          <div className="flex gap-2 min-w-0">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="flex-1 min-w-0 px-4 py-2 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Desde"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="flex-1 min-w-0 px-4 py-2 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Hasta"
            />
          </div>
        </div>
      </div>

      {/* Lista de cierres */}
      {loading ? (
        <div className="card p-8 text-center">
          <Clock className="w-8 h-8 mx-auto mb-4 text-foreground-muted animate-spin" />
          <p className="text-foreground-secondary">Cargando cierres...</p>
        </div>
      ) : error ? (
        <div className="card p-8 text-center">
          <XCircle className="w-8 h-8 mx-auto mb-4 text-red-500" />
          <p className="text-red-600 dark:text-red-400">
            Error al cargar los cierres
          </p>
        </div>
      ) : filteredClosures.length === 0 ? (
        <div className="card p-8 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-4 text-foreground-muted" />
          <p className="text-foreground-secondary">
            No hay cierres de caja registrados
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 overflow-x-hidden">
          {filteredClosures.map((closure) => (
            <div
              key={closure.id}
              className="card p-6 hover:shadow-lg transition-shadow overflow-x-hidden"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 min-w-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <h3 className="text-lg font-semibold text-foreground whitespace-nowrap">
                      Cierre #{closure.id}
                    </h3>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                        STATUS_COLORS[closure.status] || STATUS_COLORS.open
                      }`}
                    >
                      {STATUS_LABELS[closure.status] || "Abierto"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm min-w-0">
                    <div>
                      <p className="text-foreground-muted mb-1">Fecha</p>
                      <p className="text-foreground font-medium">
                        {formatDate(closure.closure_date)}
                      </p>
                    </div>
                    <div>
                      <p className="text-foreground-muted mb-1">Sucursal</p>
                      <p className="text-foreground font-medium">
                        {closure.branch_name || "Principal"}
                      </p>
                    </div>
                    <div>
                      <p className="text-foreground-muted mb-1">Usuario</p>
                      <p className="text-foreground font-medium">
                        {closure.user_name || closure.user_email}
                      </p>
                    </div>
                    <div>
                      <p className="text-foreground-muted mb-1">Total Esperado</p>
                      <p className="text-foreground font-semibold text-lg">
                        {formatCurrency(closure.total_expected)}
                      </p>
                    </div>
                  </div>

                  {closure.status === "closed" && (
                    <div className="mt-4 pt-4 border-t border-border">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-foreground-muted mb-1">Total Real</p>
                          <p className="text-foreground font-semibold">
                            {formatCurrency(closure.total_actual)}
                          </p>
                        </div>
                        <div>
                          <p className="text-foreground-muted mb-1">Diferencia</p>
                          <p
                            className={`font-semibold ${
                              closure.total_difference >= 0
                                ? "text-green-600 dark:text-green-400"
                                : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            {closure.total_difference >= 0 ? "+" : ""}
                            {formatCurrency(closure.total_difference)}
                          </p>
                        </div>
                        <div>
                          <p className="text-foreground-muted mb-1">Egresos</p>
                          <p className="text-foreground font-medium">
                            {formatCurrency(closure.expenses)}
                          </p>
                        </div>
                        <div>
                          <p className="text-foreground-muted mb-1">Cerrado</p>
                          <p className="text-foreground font-medium">
                            {formatDateTime(closure.closed_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 flex-wrap shrink-0">
                  <button
                    onClick={() => openDetailsModal(closure)}
                    className="btn-ghost btn--compact flex items-center gap-2 whitespace-nowrap"
                  >
                    <Eye className="w-4 h-4" />
                    Ver
                  </button>
                  {closure.status === "open" && (
                    <button
                      onClick={() => openCloseModal(closure)}
                      className="btn-primary btn--compact flex items-center gap-2 whitespace-nowrap"
                    >
                      <Lock className="w-4 h-4" />
                      Cerrar
                    </button>
                  )}
                  {isAdmin && closure.status !== "cancelled" && (
                    <button
                      onClick={() => handleCancelClosure(closure)}
                      className="btn-ghost btn--compact flex items-center gap-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 whitespace-nowrap"
                      title="Anular cierre (solo admin)"
                    >
                      <Trash2 className="w-4 h-4" />
                      Anular
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Crear Cierre */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-background rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-foreground mb-4">
              Nuevo Cierre de Caja
            </h2>
            <form onSubmit={handleCreateClosure} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Sucursal <span className="text-foreground-muted text-xs">(opcional)</span>
                </label>
                <select
                  value={newClosure.branchId}
                  onChange={(e) =>
                    setNewClosure({ ...newClosure, branchId: e.target.value })
                  }
                  disabled={branchesLoading}
                  className="w-full px-4 py-2 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Principal / Sin sucursal</option>
                  {branchesLoading ? (
                    <option value="" disabled>
                      Cargando sucursales...
                    </option>
                  ) : branches && branches.length > 0 ? (
                    branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))
                  ) : (
                    <option value="" disabled>
                      No hay sucursales disponibles
                    </option>
                  )}
                </select>
                <p className="text-xs text-foreground-muted mt-1">
                  {branches.length > 0
                    ? "Solo se muestran las sucursales a las que tenés acceso. Si no seleccionás una, se creará el cierre para la sucursal principal."
                    : "No tenés acceso a ninguna sucursal específica. El cierre se creará para la sucursal principal."}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Fecha del Cierre
                </label>
                <input
                  type="date"
                  value={newClosure.closureDate}
                  onChange={(e) => {
                    const selectedDate = e.target.value;
                    // Validar que no sea una fecha futura
                    if (selectedDate <= maxDate) {
                      setNewClosure({ ...newClosure, closureDate: selectedDate });
                    }
                  }}
                  max={maxDate}
                  required
                  className="w-full px-4 py-2 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-xs text-foreground-muted mt-1">
                  No se pueden crear cierres para fechas futuras
                </p>
              </div>

              {/* Mostrar totales esperados calculados automáticamente */}
              {newClosure.closureDate && (
                <div className="p-4 rounded-lg bg-background-secondary border border-border">
                  <h3 className="text-sm font-semibold text-foreground mb-3">
                    Totales Esperados para {formatDate(newClosure.closureDate)}
                    {loadingExpectedTotals && (
                      <span className="ml-2 text-xs text-foreground-muted">(calculando...)</span>
                    )}
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-foreground-muted mb-1">Efectivo</p>
                      <p className="text-foreground font-semibold">
                        {formatCurrency(expectedTotals.expected_cash)}
                      </p>
                    </div>
                    <div>
                      <p className="text-foreground-muted mb-1">Tarjeta</p>
                      <p className="text-foreground font-semibold">
                        {formatCurrency(expectedTotals.expected_card)}
                      </p>
                    </div>
                    <div>
                      <p className="text-foreground-muted mb-1">Transferencia</p>
                      <p className="text-foreground font-semibold">
                        {formatCurrency(expectedTotals.expected_transfer)}
                      </p>
                    </div>
                    <div>
                      <p className="text-foreground-muted mb-1">Mercado Pago</p>
                      <p className="text-foreground font-semibold">
                        {formatCurrency(expectedTotals.expected_mp)}
                      </p>
                    </div>
                    <div className="col-span-2 pt-2 border-t border-border">
                      <p className="text-foreground-muted mb-1">Total Esperado</p>
                      <p className="text-foreground font-bold text-lg">
                        {formatCurrency(expectedTotals.total_expected)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Notas (opcional)
                </label>
                <textarea
                  value={newClosure.notes}
                  onChange={(e) =>
                    setNewClosure({ ...newClosure, notes: e.target.value })
                  }
                  rows={3}
                  className="w-full px-4 py-2 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 btn-ghost"
                >
                  Cancelar
                </button>
                <button type="submit" className="flex-1 btn-primary">
                  Crear Cierre
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Cerrar Cierre */}
      {showCloseModal && selectedClosure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-background rounded-lg shadow-xl max-w-2xl w-full p-6 my-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">
              Cerrar Cierre de Caja #{selectedClosure.id}
            </h2>
            <form onSubmit={handleCloseClosure} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Efectivo Real
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={closeForm.actual_cash}
                    onChange={(e) =>
                      setCloseForm({ ...closeForm, actual_cash: e.target.value })
                    }
                    required
                    className="w-full px-4 py-2 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <p className="text-xs text-foreground-muted mt-1">
                    Esperado: {formatCurrency(selectedClosure.expected_cash)}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Tarjeta Real
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={closeForm.actual_card}
                    onChange={(e) =>
                      setCloseForm({ ...closeForm, actual_card: e.target.value })
                    }
                    required
                    className="w-full px-4 py-2 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <p className="text-xs text-foreground-muted mt-1">
                    Esperado: {formatCurrency(selectedClosure.expected_card)}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Transferencia Real
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={closeForm.actual_transfer}
                    onChange={(e) =>
                      setCloseForm({
                        ...closeForm,
                        actual_transfer: e.target.value,
                      })
                    }
                    required
                    className="w-full px-4 py-2 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <p className="text-xs text-foreground-muted mt-1">
                    Esperado: {formatCurrency(selectedClosure.expected_transfer)}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Mercado Pago Real
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={closeForm.actual_mp}
                    onChange={(e) =>
                      setCloseForm({ ...closeForm, actual_mp: e.target.value })
                    }
                    required
                    className="w-full px-4 py-2 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <p className="text-xs text-foreground-muted mt-1">
                    Esperado: {formatCurrency(selectedClosure.expected_mp)}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Egresos del Día
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={closeForm.expenses}
                  onChange={(e) =>
                    setCloseForm({ ...closeForm, expenses: e.target.value })
                  }
                  className="w-full px-4 py-2 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Notas (opcional)
                </label>
                <textarea
                  value={closeForm.notes}
                  onChange={(e) =>
                    setCloseForm({ ...closeForm, notes: e.target.value })
                  }
                  rows={3}
                  className="w-full px-4 py-2 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCloseModal(false);
                    setSelectedClosure(null);
                  }}
                  className="flex-1 btn-ghost"
                >
                  Cancelar
                </button>
                <button type="submit" className="flex-1 btn-primary">
                  Cerrar Cierre
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Detalles */}
      {showDetailsModal && selectedClosure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-background rounded-lg shadow-xl max-w-4xl w-full p-6 my-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-foreground">
                Detalles del Cierre #{selectedClosure.id}
              </h2>
              <button
                onClick={() => {
                  setShowDetailsModal(false);
                  setSelectedClosure(null);
                }}
                className="btn-ghost btn--compact"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-6">
              {/* Información General */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-foreground-muted mb-1">Fecha</p>
                  <p className="text-foreground font-medium">
                    {formatDate(selectedClosure.closure_date)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-foreground-muted mb-1">Estado</p>
                  <span
                    className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                      STATUS_COLORS[selectedClosure.status] || STATUS_COLORS.open
                    }`}
                  >
                    {STATUS_LABELS[selectedClosure.status] || "Abierto"}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-foreground-muted mb-1">Sucursal</p>
                  <p className="text-foreground font-medium">
                    {selectedClosure.branch_name || "Principal"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-foreground-muted mb-1">Usuario</p>
                  <p className="text-foreground font-medium">
                    {selectedClosure.user_name || selectedClosure.user_email}
                  </p>
                </div>
              </div>

              {/* Totales */}
              <div className="border-t border-border pt-4">
                <h3 className="text-lg font-semibold text-foreground mb-4">
                  Totales
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {["cash", "card", "transfer", "mp"].map((method) => (
                    <div key={method} className="card p-4">
                      <p className="text-sm text-foreground-muted mb-2">
                        {PAYMENT_METHODS[method]}
                      </p>
                      <p className="text-foreground font-semibold text-lg">
                        {formatCurrency(selectedClosure[`expected_${method}`] || 0)}
                      </p>
                      {selectedClosure.status === "closed" && (
                        <>
                          <p className="text-sm text-foreground-secondary mt-1">
                            Real: {formatCurrency(selectedClosure[`actual_${method}`] || 0)}
                          </p>
                          <p
                            className={`text-sm font-medium mt-1 ${
                              (selectedClosure[`${method}_difference`] || 0) >= 0
                                ? "text-green-600 dark:text-green-400"
                                : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            Diferencia:{" "}
                            {formatCurrency(selectedClosure[`${method}_difference`] || 0)}
                          </p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Transacciones */}
              {selectedClosure.transactions && selectedClosure.transactions.length > 0 && (
                <div className="border-t border-border pt-4">
                  <h3 className="text-lg font-semibold text-foreground mb-4">
                    Transacciones ({selectedClosure.transactions.length})
                  </h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {selectedClosure.transactions.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="flex items-center justify-between p-3 bg-background-secondary rounded-lg"
                      >
                        <div className="flex-1">
                          <p className="text-foreground font-medium">
                            {transaction.description || "Sin descripción"}
                          </p>
                          <p className="text-sm text-foreground-muted">
                            {PAYMENT_METHODS[transaction.payment_method]} •{" "}
                            {transaction.transaction_type === "income"
                              ? "Ingreso"
                              : "Egreso"}
                          </p>
                        </div>
                        <p
                          className={`font-semibold ${
                            transaction.transaction_type === "income"
                              ? "text-green-600 dark:text-green-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {transaction.transaction_type === "income" ? "+" : "-"}
                          {formatCurrency(transaction.amount)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación para anular cierre */}
      {showCancelConfirmModal && closureToCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-background rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-foreground">
                  Anular Cierre de Caja
                </h2>
                <p className="text-sm text-foreground-muted mt-1">
                  Esta acción no se puede deshacer
                </p>
              </div>
            </div>

            <div className="mb-6">
              <p className="text-foreground">
                ¿Estás seguro de que querés anular el{" "}
                <span className="font-semibold">Cierre #{closureToCancel.id}</span>?
              </p>
              <div className="mt-4 p-3 bg-background-secondary rounded-lg">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-foreground-muted">Fecha</p>
                    <p className="text-foreground font-medium">
                      {formatDate(closureToCancel.closure_date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-foreground-muted">Sucursal</p>
                    <p className="text-foreground font-medium">
                      {closureToCancel.branch_name || "Principal"}
                    </p>
                  </div>
                  <div>
                    <p className="text-foreground-muted">Estado</p>
                    <p className="text-foreground font-medium">
                      {STATUS_LABELS[closureToCancel.status] || "Abierto"}
                    </p>
                  </div>
                  <div>
                    <p className="text-foreground-muted">Total Esperado</p>
                    <p className="text-foreground font-medium">
                      {formatCurrency(closureToCancel.total_expected)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowCancelConfirmModal(false);
                  setClosureToCancel(null);
                }}
                className="btn-ghost px-4 py-2 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={confirmCancelClosure}
                className="btn-primary px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Anular Cierre
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

