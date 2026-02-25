import { useState } from "react";
import { useQuery } from "../../shared/useQuery.js";
import { apiClient } from "../../api";
import { AlertTriangle, TrendingDown, TrendingUp, Package, RefreshCw, CheckCircle, X } from "lucide-react";
import { toast } from "sonner";
import { logger } from "../../utils/logger.js";

export default function StockAlertsPage() {
  const [branchFilter, setBranchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [alertTypeFilter, setAlertTypeFilter] = useState("");
  const [showDismissModal, setShowDismissModal] = useState(false);
  const [alertToDismiss, setAlertToDismiss] = useState(null);

  // Cargar alertas
  const { data: alertsData, loading, refetch } = useQuery(
    async () => {
      try {
        const params = {};
        if (branchFilter) params.branch_id = branchFilter;
        if (statusFilter) params.status = statusFilter;
        if (alertTypeFilter) params.alert_type = alertTypeFilter;
        const result = await apiClient.listStockAlerts(params);
        // listStockAlerts ya devuelve el array directamente
        return Array.isArray(result) ? result : [];
      } catch (error) {
        logger.error("Error al cargar alertas:", error);
        return [];
      }
    },
    [branchFilter, statusFilter, alertTypeFilter]
  );
  const alerts = Array.isArray(alertsData) ? alertsData : [];

  // Cargar sucursales
  const { data: branchesData } = useQuery(
    async () => {
      try {
        const response = await apiClient.listActiveBranches();
        return Array.isArray(response?.data) ? response.data : [];
      } catch (error) {
        logger.error("Error al cargar sucursales:", error);
        return [];
      }
    },
    []
  );
  const branches = Array.isArray(branchesData) ? branchesData : [];

  const handleGenerate = async () => {
    try {
      await apiClient.generateStockAlerts();
      toast.success("Alertas generadas exitosamente");
      refetch();
    } catch (error) {
      toast.error(error.response?.data?.error || "Error al generar alertas");
    }
  };

  const handleAcknowledge = async (id) => {
    try {
      await apiClient.acknowledgeStockAlert(id);
      toast.success("Alerta reconocida");
      refetch();
    } catch (error) {
      toast.error(error.response?.data?.error || "Error al reconocer la alerta");
    }
  };

  const handleDismissClick = (id) => {
    setAlertToDismiss(id);
    setShowDismissModal(true);
  };

  const handleDismiss = async () => {
    if (!alertToDismiss) return;
    try {
      await apiClient.dismissStockAlert(alertToDismiss);
      toast.success("Alerta descartada");
      setShowDismissModal(false);
      setAlertToDismiss(null);
      refetch();
    } catch (error) {
      toast.error(error.response?.data?.error || "Error al descartar la alerta");
    }
  };

  const getAlertIcon = (type) => {
    const icons = {
      low_stock: TrendingDown,
      out_of_stock: AlertTriangle,
      overstock: TrendingUp,
      expiring_soon: AlertTriangle
    };
    return icons[type] || AlertTriangle;
  };

  const getAlertColor = (type) => {
    const colors = {
      low_stock: "text-amber-500",
      out_of_stock: "text-red-500",
      overstock: "text-blue-500",
      expiring_soon: "text-orange-500"
    };
    return colors[type] || "text-gray-500";
  };

  const getAlertLabel = (type) => {
    const labels = {
      low_stock: "Stock Bajo",
      out_of_stock: "Sin Stock",
      overstock: "Sobrestock",
      expiring_soon: "Por Vencer"
    };
    return labels[type] || type;
  };

  const activeAlerts = alerts.filter(a => a.status === 'active');
  const acknowledgedAlerts = alerts.filter(a => a.status === 'acknowledged');
  const resolvedAlerts = alerts.filter(a => a.status === 'resolved');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1 sm:mb-2">Alertas de Stock</h1>
          <p className="text-sm sm:text-base text-foreground-secondary">
            Monitorea el estado de tu inventario automáticamente
          </p>
        </div>
        <button
          onClick={handleGenerate}
          className="btn-primary flex items-center justify-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Generar Alertas</span>
        </button>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground-muted">Activas</p>
              <p className="text-2xl font-bold text-foreground">{activeAlerts.length}</p>
            </div>
            <AlertTriangle className="w-8 h-8 text-amber-500" />
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground-muted">Reconocidas</p>
              <p className="text-2xl font-bold text-foreground">{acknowledgedAlerts.length}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-blue-500" />
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground-muted">Resueltas</p>
              <p className="text-2xl font-bold text-foreground">{resolvedAlerts.length}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {branches.length > 1 && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
                Sucursal
              </label>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="input w-full"
              >
                <option value="">Todas las sucursales</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
              Estado
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input w-full"
            >
              <option value="active">Activas</option>
              <option value="acknowledged">Reconocidas</option>
              <option value="resolved">Resueltas</option>
              <option value="dismissed">Descartadas</option>
              <option value="">Todos</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
              Tipo de Alerta
            </label>
            <select
              value={alertTypeFilter}
              onChange={(e) => setAlertTypeFilter(e.target.value)}
              className="input w-full"
            >
              <option value="">Todos los tipos</option>
              <option value="low_stock">Stock Bajo</option>
              <option value="out_of_stock">Sin Stock</option>
              <option value="overstock">Sobrestock</option>
              <option value="expiring_soon">Por Vencer</option>
            </select>
          </div>
        </div>
      </div>

      {/* Lista de alertas */}
      {loading ? (
        <div className="card p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-foreground-secondary mt-4">Cargando alertas...</p>
        </div>
      ) : alerts.length === 0 ? (
        <div className="card p-12 text-center">
          <Package className="w-12 h-12 mx-auto mb-4 text-foreground-muted" />
          <p className="text-foreground-secondary">No hay alertas</p>
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => {
            const Icon = getAlertIcon(alert.alert_type);
            const color = getAlertColor(alert.alert_type);
            return (
              <div key={alert.id} className="card p-4 hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4 flex-1">
                    <div className={`p-3 rounded-lg ${color} bg-opacity-10`}>
                      <Icon className={`w-6 h-6 ${color}`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground">{alert.product_name}</h3>
                        <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                          {getAlertLabel(alert.alert_type)}
                        </span>
                      </div>
                      <div className="text-sm text-foreground-secondary space-y-1">
                        {alert.branch_name && (
                          <p>Sucursal: {alert.branch_name}</p>
                        )}
                        <p>
                          Stock actual: <span className="font-medium">{alert.current_quantity}</span> | 
                          Umbral: <span className="font-medium">{alert.threshold_quantity}</span>
                        </p>
                        <p className="text-xs text-foreground-muted">
                          Creada: {new Date(alert.created_at).toLocaleString('es-AR')}
                        </p>
                      </div>
                    </div>
                  </div>
                  {alert.status === 'active' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleAcknowledge(alert.id)}
                        className="p-2 rounded-lg text-foreground-secondary hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                        title="Reconocer alerta"
                      >
                        <CheckCircle className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => handleDismissClick(alert.id)}
                        className="p-2 rounded-lg text-foreground-secondary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title="Descartar alerta"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de confirmación para descartar alerta */}
      {showDismissModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 animate-fade-in"
          style={{
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)'
          }}
          onClick={() => setShowDismissModal(false)}
        >
          <div 
            className="bg-background rounded-2xl shadow-2xl max-w-md w-full animate-scale-in"
            style={{
              border: '1px solid rgb(var(--border))',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <X className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                </div>
                <h2 className="text-xl font-bold text-foreground">Descartar Alerta</h2>
              </div>
              <p className="text-foreground-secondary mb-6">
                ¿Descartar esta alerta?
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowDismissModal(false)}
                  className="px-4 py-2 rounded-lg font-medium text-foreground-secondary bg-background-secondary hover:bg-border transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDismiss}
                  className="px-4 py-2 rounded-lg font-medium text-white bg-amber-600 hover:bg-amber-700 transition-all"
                >
                  Descartar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

