import { useState } from "react";
import { useQuery } from "../../shared/useQuery.js";
import { apiClient } from "../../api";
import { ArrowRightLeft, CheckCircle, XCircle, Clock, Package, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { logger } from "../../utils/logger.js";

export default function StockTransfersPage() {
  const [showModal, setShowModal] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState(null);
  const [branchFilter, setBranchFilter] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [transferToConfirm, setTransferToConfirm] = useState(null);
  const [transferToCancel, setTransferToCancel] = useState(null);
  const [cancelNotes, setCancelNotes] = useState("");

  // Cargar transferencias
  const { data: transfersData, loading, refetch } = useQuery(
    async () => {
      try {
        const params = {};
        if (branchFilter) params.branch_id = branchFilter;
        const result = await apiClient.listStockTransfers(params);
        // listStockTransfers ya devuelve el array directamente
        return Array.isArray(result) ? result : [];
      } catch (error) {
        logger.error("Error al cargar transferencias:", error);
        return [];
      }
    },
    [branchFilter]
  );
  const transfers = Array.isArray(transfersData) ? transfersData : [];

  // Cargar productos y sucursales
  const { data: productsData } = useQuery(
    async () => {
      try {
        const response = await apiClient.get("/api/stock/products");
        return Array.isArray(response?.data?.data) ? response.data.data : [];
      } catch (error) {
        logger.error("Error al cargar productos:", error);
        return [];
      }
    },
    []
  );
  const products = Array.isArray(productsData) ? productsData : [];

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

  const handleConfirmClick = (id) => {
    setTransferToConfirm(id);
    setShowConfirmModal(true);
  };

  const handleConfirm = async () => {
    if (!transferToConfirm) return;
    try {
      await apiClient.confirmStockTransfer(transferToConfirm);
      toast.success("Transferencia confirmada");
      setShowConfirmModal(false);
      setTransferToConfirm(null);
      refetch();
    } catch (error) {
      toast.error(error.response?.data?.error || "Error al confirmar");
    }
  };

  const handleCancelClick = (id) => {
    setTransferToCancel(id);
    setCancelNotes("");
    setShowCancelModal(true);
  };

  const handleCancel = async () => {
    if (!transferToCancel) return;
    try {
      await apiClient.cancelStockTransfer(transferToCancel, cancelNotes || null);
      toast.success("Transferencia cancelada");
      setShowCancelModal(false);
      setTransferToCancel(null);
      setCancelNotes("");
      refetch();
    } catch (error) {
      toast.error(error.response?.data?.error || "Error al cancelar");
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-800 dark:text-yellow-200", icon: Clock, label: "Pendiente" },
      in_transit: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-800 dark:text-blue-200", icon: ArrowRightLeft, label: "En Tránsito" },
      received: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-800 dark:text-green-200", icon: CheckCircle, label: "Recibida" },
      cancelled: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-800 dark:text-red-200", icon: XCircle, label: "Cancelada" },
      rejected: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-800 dark:text-red-200", icon: XCircle, label: "Rechazada" }
    };
    const badge = badges[status] || badges.pending;
    const Icon = badge.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
        <Icon className="w-3 h-3" />
        {badge.label}
      </span>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1 sm:mb-2">Transferencias de Stock</h1>
          <p className="text-sm sm:text-base text-foreground-secondary">
            Gestiona transferencias entre sucursales con confirmación
          </p>
        </div>
        <button
          onClick={() => {
            setSelectedTransfer(null);
            setShowModal(true);
          }}
          className="btn-primary flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
          <span className="text-sm sm:text-base">Nueva Transferencia</span>
        </button>
      </div>

      {/* Filtros */}
      {branches.length > 1 && (
        <div className="card p-4">
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
                Filtrar por Sucursal
              </label>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="input w-full sm:w-60"
              >
                <option value="">Todas las sucursales</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Tabla de transferencias */}
      {loading ? (
        <div className="card p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-foreground-secondary mt-4">Cargando transferencias...</p>
        </div>
      ) : transfers.length === 0 ? (
        <div className="card p-12 text-center">
          <Package className="w-12 h-12 mx-auto mb-4 text-foreground-muted" />
          <p className="text-foreground-secondary">No hay transferencias</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-border bg-background-secondary">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Producto</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Desde</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Hacia</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">Cantidad</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Estado</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Solicitada</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Confirmada</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-foreground">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((transfer) => (
                  <tr key={transfer.id} className="border-b border-border hover:bg-background-secondary transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-foreground">{transfer.product_name}</div>
                      <div className="text-xs text-foreground-muted">{transfer.product_code}</div>
                    </td>
                    <td className="py-3 px-4 text-sm text-foreground-secondary">
                      {transfer.from_branch_name}
                    </td>
                    <td className="py-3 px-4 text-sm text-foreground-secondary">
                      {transfer.to_branch_name}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-foreground">
                      {transfer.quantity}
                    </td>
                    <td className="py-3 px-4">
                      {getStatusBadge(transfer.status)}
                    </td>
                    <td className="py-3 px-4 text-sm text-foreground-secondary">
                      {new Date(transfer.requested_at).toLocaleDateString('es-AR')}
                      <div className="text-xs text-foreground-muted">
                        {transfer.requested_by_name || "-"}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-foreground-secondary">
                      {transfer.confirmed_at ? (
                        <>
                          {new Date(transfer.confirmed_at).toLocaleDateString('es-AR')}
                          <div className="text-xs text-foreground-muted">
                            {transfer.confirmed_by_name || "-"}
                          </div>
                        </>
                      ) : "-"}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-2">
                        {transfer.status === 'in_transit' && (
                          <>
                            <button
                              onClick={() => handleConfirmClick(transfer.id)}
                              className="p-2 rounded-lg text-foreground-secondary hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
                              title="Confirmar recepción"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleCancelClick(transfer.id)}
                              className="p-2 rounded-lg text-foreground-secondary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              title="Cancelar"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {transfer.status === 'pending' && (
                          <button
                            onClick={() => handleCancelClick(transfer.id)}
                            className="p-2 rounded-lg text-foreground-secondary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            title="Cancelar"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de transferencia */}
      {showModal && (
        <TransferModal
          transfer={selectedTransfer}
          products={products}
          branches={branches}
          onClose={() => {
            setShowModal(false);
            setSelectedTransfer(null);
          }}
          onSave={() => {
            refetch();
            setShowModal(false);
            setSelectedTransfer(null);
          }}
        />
      )}

      {/* Modal de confirmación de recepción */}
      {showConfirmModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 animate-fade-in"
          style={{
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)'
          }}
          onClick={() => setShowConfirmModal(false)}
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
                <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                  <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <h2 className="text-xl font-bold text-foreground">Confirmar Recepción</h2>
              </div>
              <p className="text-foreground-secondary mb-6">
                ¿Confirmar la recepción de esta transferencia?
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="px-4 py-2 rounded-lg font-medium text-foreground-secondary bg-background-secondary hover:bg-border transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirm}
                  className="px-4 py-2 rounded-lg font-medium text-white bg-green-600 hover:bg-green-700 transition-all"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de cancelación */}
      {showCancelModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 animate-fade-in"
          style={{
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)'
          }}
          onClick={() => setShowCancelModal(false)}
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
                <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                  <XCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
                </div>
                <h2 className="text-xl font-bold text-foreground">Cancelar Transferencia</h2>
              </div>
              <p className="text-foreground-secondary mb-4">
                ¿Estás seguro de cancelar esta transferencia?
              </p>
              <div className="mb-4">
                <label className="block text-sm font-semibold text-foreground mb-2">
                  Motivo de cancelación (opcional)
                </label>
                <textarea
                  value={cancelNotes}
                  onChange={(e) => setCancelNotes(e.target.value)}
                  className="input w-full"
                  rows={3}
                  placeholder="Ingresá el motivo de cancelación..."
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowCancelModal(false);
                    setCancelNotes("");
                  }}
                  className="px-4 py-2 rounded-lg font-medium text-foreground-secondary bg-background-secondary hover:bg-border transition-all"
                >
                  No cancelar
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 transition-all"
                >
                  Cancelar Transferencia
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Modal para crear transferencia (reutilizar el existente pero con confirmación)
function TransferModal({ transfer, products, branches, onClose, onSave }) {
  const [formData, setFormData] = useState({
    product_id: transfer?.product_id || "",
    from_branch_id: transfer?.from_branch_id || "",
    to_branch_id: transfer?.to_branch_id || "",
    quantity: transfer?.quantity || "",
    notes: transfer?.notes || ""
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.product_id || !formData.from_branch_id || !formData.to_branch_id || !formData.quantity) {
      toast.error("Completá todos los campos requeridos");
      return;
    }

    if (formData.from_branch_id === formData.to_branch_id) {
      toast.error("Las sucursales origen y destino no pueden ser la misma");
      return;
    }

    setLoading(true);
    try {
      await apiClient.createStockTransfer({
        product_id: formData.product_id,
        from_branch_id: formData.from_branch_id,
        to_branch_id: formData.to_branch_id,
        quantity: Number(formData.quantity),
        notes: formData.notes || null
      });
      toast.success("Transferencia creada exitosamente");
      onSave();
    } catch (error) {
      toast.error(error.response?.data?.error || "Error al crear la transferencia");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-bold text-foreground">Nueva Transferencia</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-background-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">
              Producto <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.product_id}
              onChange={(e) => setFormData({ ...formData, product_id: e.target.value })}
              className="input w-full"
              required
            >
              <option value="">Seleccionar producto</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} {p.code ? `(${p.code})` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">
              Sucursal Origen <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.from_branch_id}
              onChange={(e) => setFormData({ ...formData, from_branch_id: e.target.value })}
              className="input w-full"
              required
            >
              <option value="">Seleccionar sucursal</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">
              Sucursal Destino <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.to_branch_id}
              onChange={(e) => setFormData({ ...formData, to_branch_id: e.target.value })}
              className="input w-full"
              required
            >
              <option value="">Seleccionar sucursal</option>
              {branches.filter(b => b.id !== Number(formData.from_branch_id)).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">
              Cantidad <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
              className="input w-full"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">Notas</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="input w-full"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary" disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Creando..." : "Crear Transferencia"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

