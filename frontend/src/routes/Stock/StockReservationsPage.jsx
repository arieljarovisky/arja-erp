import { useState, useRef, useEffect } from "react";
import { useQuery } from "../../shared/useQuery.js";
import { apiClient } from "../../api";
import { useAuth } from "../../context/AuthContext";
import { Package, Plus, Calendar, X, CheckCircle, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { logger } from "../../utils/logger.js";

export default function StockReservationsPage() {
  const [showModal, setShowModal] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState(null);
  const { user } = useAuth();
  const [branchFilter, setBranchFilter] = useState("");
  const [showConfirmFulfillModal, setShowConfirmFulfillModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [reservationToFulfill, setReservationToFulfill] = useState(null);
  const [reservationToCancel, setReservationToCancel] = useState(null);

  // Cargar reservas
  const { data: reservationsData, loading, refetch } = useQuery(
    async () => {
      try {
        const params = {};
        if (branchFilter) params.branch_id = branchFilter;
        const result = await apiClient.listStockReservations(params);
        // listStockReservations ya devuelve el array directamente
        return Array.isArray(result) ? result : [];
      } catch (error) {
        logger.error("Error al cargar reservas:", error);
        return [];
      }
    },
    [branchFilter]
  );
  const reservations = Array.isArray(reservationsData) ? reservationsData : [];

  // Cargar productos y sucursales
  const { data: productsData } = useQuery(
    async () => {
      const response = await apiClient.get("/api/stock/products");
      return Array.isArray(response?.data?.data) ? response.data.data : [];
    },
    []
  );
  const products = Array.isArray(productsData) ? productsData : [];

  const { data: branchesData } = useQuery(
    async () => {
      const response = await apiClient.listActiveBranches();
      return Array.isArray(response?.data) ? response.data : [];
    },
    []
  );
  const branches = Array.isArray(branchesData) ? branchesData : [];

  const handleCancelClick = (id) => {
    setReservationToCancel(id);
    setShowCancelModal(true);
  };

  const handleCancel = async () => {
    if (!reservationToCancel) return;
    try {
      await apiClient.cancelStockReservation(reservationToCancel);
      toast.success("Reserva cancelada");
      setShowCancelModal(false);
      setReservationToCancel(null);
      refetch();
    } catch (error) {
      toast.error(error.response?.data?.error || "Error al cancelar");
    }
  };

  const handleFulfillClick = (id) => {
    setReservationToFulfill(id);
    setShowConfirmFulfillModal(true);
  };

  const handleFulfill = async () => {
    if (!reservationToFulfill) return;
    try {
      await apiClient.fulfillStockReservation(reservationToFulfill);
      toast.success("Reserva cumplida");
      setShowConfirmFulfillModal(false);
      setReservationToFulfill(null);
      refetch();
    } catch (error) {
      toast.error(error.response?.data?.error || "Error al cumplir la reserva");
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      active: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-800 dark:text-blue-200", icon: Clock, label: "Activa" },
      confirmed: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-800 dark:text-green-200", icon: CheckCircle, label: "Confirmada" },
      cancelled: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-800 dark:text-red-200", icon: XCircle, label: "Cancelada" },
      expired: { bg: "bg-gray-100 dark:bg-gray-900/30", text: "text-gray-800 dark:text-gray-200", icon: XCircle, label: "Expirada" },
      fulfilled: { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-800 dark:text-emerald-200", icon: CheckCircle, label: "Cumplida" }
    };
    const badge = badges[status] || badges.active;
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
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1 sm:mb-2">Reservas de Stock</h1>
          <p className="text-sm sm:text-base text-foreground-secondary">
            Gestiona las reservas de productos para turnos y pedidos
          </p>
        </div>
        <button
          onClick={() => {
            setSelectedReservation(null);
            setShowModal(true);
          }}
          className="btn-primary flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
          <span className="text-sm sm:text-base">Nueva Reserva</span>
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

      {/* Tabla de reservas */}
      {loading ? (
        <div className="card p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-foreground-secondary mt-4">Cargando reservas...</p>
        </div>
      ) : reservations.length === 0 ? (
        <div className="card p-12 text-center">
          <Package className="w-12 h-12 mx-auto mb-4 text-foreground-muted" />
          <p className="text-foreground-secondary">No hay reservas</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-border bg-background-secondary">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Producto</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Sucursal</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">Cantidad</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Tipo</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Referencia</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Estado</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Fecha</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-foreground">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((reservation) => (
                  <tr key={reservation.id} className="border-b border-border hover:bg-background-secondary transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-foreground">{reservation.product_name}</div>
                      <div className="text-xs text-foreground-muted">{reservation.product_code}</div>
                    </td>
                    <td className="py-3 px-4 text-sm text-foreground-secondary">
                      {reservation.branch_name || "Sin asignar"}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-foreground">
                      {reservation.quantity}
                    </td>
                    <td className="py-3 px-4 text-sm text-foreground-secondary capitalize">
                      {reservation.reservation_type || "manual"}
                    </td>
                    <td className="py-3 px-4 text-sm text-foreground-secondary">
                      {reservation.reference_type && reservation.reference_id 
                        ? `${reservation.reference_type} #${reservation.reference_id}`
                        : "-"}
                    </td>
                    <td className="py-3 px-4">
                      {getStatusBadge(reservation.status)}
                    </td>
                    <td className="py-3 px-4 text-sm text-foreground-secondary">
                      {new Date(reservation.created_at).toLocaleDateString('es-AR')}
                      {reservation.expires_at && (
                        <div className="text-xs text-foreground-muted">
                          Expira: {new Date(reservation.expires_at).toLocaleDateString('es-AR')}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-2">
                        {reservation.status === 'active' && (
                          <>
                            <button
                              onClick={() => handleFulfillClick(reservation.id)}
                              className="p-2 rounded-lg text-foreground-secondary hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
                              title="Cumplir reserva"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleCancelClick(reservation.id)}
                              className="p-2 rounded-lg text-foreground-secondary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              title="Cancelar reserva"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
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

      {/* Modal de reserva */}
      {showModal && (
        <ReservationModal
          reservation={selectedReservation}
          products={products}
          branches={branches}
          onClose={() => {
            setShowModal(false);
            setSelectedReservation(null);
          }}
          onSave={() => {
            refetch();
            setShowModal(false);
            setSelectedReservation(null);
          }}
        />
      )}

      {/* Modal de confirmación de cumplimiento */}
      {showConfirmFulfillModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 animate-fade-in"
          style={{
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)'
          }}
          onClick={() => setShowConfirmFulfillModal(false)}
        >
          <div 
            className="bg-background rounded-2xl shadow-2xl max-w-md w-full animate-scale-in"
            style={{
              border: '1px solid rgb(var(--border))',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)'
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fulfill-modal-title"
            tabIndex="-1"
          >
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                  <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <h2 id="fulfill-modal-title" className="text-xl font-bold text-foreground">Confirmar Cumplimiento</h2>
              </div>
              <p className="text-foreground-secondary mb-6">
                ¿Confirmar cumplimiento de esta reserva? El stock se descontará.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowConfirmFulfillModal(false)}
                  className="px-4 py-2 rounded-lg font-medium text-foreground-secondary bg-background-secondary hover:bg-border transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleFulfill}
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-modal-title"
            tabIndex="-1"
          >
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                  <XCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
                </div>
                <h2 id="cancel-modal-title" className="text-xl font-bold text-foreground">Cancelar Reserva</h2>
              </div>
              <p className="text-foreground-secondary mb-6">
                ¿Estás seguro de cancelar esta reserva?
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowCancelModal(false)}
                  className="px-4 py-2 rounded-lg font-medium text-foreground-secondary bg-background-secondary hover:bg-border transition-all"
                >
                  No cancelar
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 transition-all"
                >
                  Cancelar Reserva
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Modal para crear/editar reserva
function ReservationModal({ reservation, products, branches, onClose, onSave }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  const [formData, setFormData] = useState({
    product_id: reservation?.product_id || "",
    branch_id: reservation?.branch_id || "",
    quantity: reservation?.quantity || "",
    reservation_type: reservation?.reservation_type || "manual",
    reference_type: reservation?.reference_type || "",
    reference_id: reservation?.reference_id || "",
    expires_at: reservation?.expires_at ? new Date(reservation.expires_at).toISOString().slice(0, 16) : "",
    notes: reservation?.notes || ""
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.product_id || !formData.branch_id || !formData.quantity) {
      toast.error("Completá todos los campos requeridos");
      return;
    }

    setLoading(true);
    try {
      if (reservation) {
        // TODO: Implementar actualización de reserva
        toast.error("La actualización de reservas aún no está implementada");
      } else {
        await apiClient.createStockReservation({
          product_id: formData.product_id,
          branch_id: formData.branch_id,
          quantity: Number(formData.quantity),
          reservation_type: formData.reservation_type,
          reference_type: formData.reference_type || null,
          reference_id: formData.reference_id || null,
          expires_at: formData.expires_at || null,
          notes: formData.notes || null
        });
        toast.success("Reserva creada exitosamente");
      }
      onSave();
    } catch (error) {
      toast.error(error.response?.data?.error || "Error al guardar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-background rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reservation-modal-title"
        tabIndex="-1"
        ref={dialogRef}
      >
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 id="reservation-modal-title" className="text-xl font-bold text-foreground">
            {reservation ? "Editar Reserva" : "Nueva Reserva"}
          </h2>
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
              Sucursal <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.branch_id}
              onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
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
            <label className="block text-sm font-semibold text-foreground mb-2">Tipo de Reserva</label>
            <select
              value={formData.reservation_type}
              onChange={(e) => setFormData({ ...formData, reservation_type: e.target.value })}
              className="input w-full"
            >
              <option value="manual">Manual</option>
              <option value="appointment">Turno</option>
              <option value="order">Pedido</option>
              <option value="transfer">Transferencia</option>
              <option value="other">Otro</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">Tipo de Referencia</label>
              <input
                type="text"
                value={formData.reference_type}
                onChange={(e) => setFormData({ ...formData, reference_type: e.target.value })}
                className="input w-full"
                placeholder="Ej: appointment"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">ID de Referencia</label>
              <input
                type="number"
                value={formData.reference_id}
                onChange={(e) => setFormData({ ...formData, reference_id: e.target.value })}
                className="input w-full"
                placeholder="Ej: 123"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">Fecha de Expiración</label>
            <input
              type="datetime-local"
              value={formData.expires_at}
              onChange={(e) => setFormData({ ...formData, expires_at: e.target.value })}
              className="input w-full"
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
              {loading ? "Guardando..." : reservation ? "Actualizar" : "Crear"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
