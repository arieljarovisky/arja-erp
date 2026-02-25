import { useState, useEffect } from "react";
import { apiClient } from "../../api";
import { XCircle, Clock, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { logger } from "../../utils/logger.js";

// Modal para facturar membresías
export function InvoiceMembershipsModal({ customers, constants, onClose, onSave }) {
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(true);

  // Cargar suscripciones/membresías disponibles
  useEffect(() => {
    const loadSubscriptions = async () => {
      try {
        setLoadingSubscriptions(true);
        const response = await apiClient.get("/api/subscriptions", {
          params: {
            status: "authorized"
          }
        });
        
        const subscriptionsData = Array.isArray(response.data?.data) ? response.data.data : 
                                 Array.isArray(response.data) ? response.data : [];
        
        setSubscriptions(subscriptionsData);
      } catch (error) {
        logger.error("Error cargando suscripciones:", error);
        toast.error("Error al cargar las membresías");
      } finally {
        setLoadingSubscriptions(false);
      }
    };
    
    loadSubscriptions();
  }, []);

  const formatDate = (date) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("es-AR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const handleInvoiceMembership = async (subscriptionId) => {
    if (!subscriptionId) return;

    try {
      setLoading(true);
      await apiClient.post(`/api/invoicing/membership/${subscriptionId}`);
      toast.success("Membresía facturada correctamente");
      onSave();
    } catch (error) {
      toast.error(error.response?.data?.error || "Error al facturar la membresía");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 animate-fade-in"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)'
      }}
      onClick={onClose}
    >
      <div 
        className="bg-background rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'rgb(var(--border))' }}>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground">Facturar Membresías</h2>
            <p className="text-sm text-foreground-secondary mt-1">
              Selecciona una membresía para facturarla
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-foreground-secondary hover:text-foreground hover:bg-background-secondary transition-colors"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loadingSubscriptions ? (
            <div className="text-center py-12">
              <Clock className="w-12 h-12 mx-auto mb-4 text-foreground-muted animate-spin" />
              <p className="text-foreground-secondary">Cargando membresías...</p>
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="text-center py-12">
              <CreditCard className="w-12 h-12 mx-auto mb-4 text-foreground-muted" />
              <p className="text-foreground-secondary">No hay membresías disponibles para facturar</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Lista de membresías */}
              {subscriptions.map((subscription) => {
                const customer = customers.find(c => c.id === subscription.customer_id);
                const membershipName = subscription.membership_plan_name || subscription.reason || "Membresía";
                const amount = Number(subscription.amount_decimal || 0);
                
                return (
                  <div
                    key={subscription.id}
                    className="border rounded-lg p-4 hover:bg-background-secondary transition-colors"
                    style={{ borderColor: 'rgb(var(--border))' }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground text-lg">
                          {membershipName}
                        </h3>
                        <div className="mt-2 space-y-1 text-sm text-foreground-secondary">
                          <p><strong>Cliente:</strong> {subscription.customer_name || customer?.name || "Cliente desconocido"}</p>
                          {subscription.customer_phone && (
                            <p><strong>Teléfono:</strong> {subscription.customer_phone}</p>
                          )}
                          {subscription.customer_email && (
                            <p><strong>Email:</strong> {subscription.customer_email}</p>
                          )}
                          <p><strong>Estado:</strong> {subscription.status}</p>
                          <p><strong>Fecha de creación:</strong> {formatDate(subscription.created_at)}</p>
                          {subscription.next_charge_at && (
                            <p><strong>Próximo cobro:</strong> {formatDate(subscription.next_charge_at)}</p>
                          )}
                          {subscription.last_payment_at && (
                            <p><strong>Último pago:</strong> {formatDate(subscription.last_payment_at)}</p>
                          )}
                          <p><strong>Monto:</strong> ${amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <CreditCard className="w-6 h-6 text-primary" />
                        <button
                          onClick={() => handleInvoiceMembership(subscription.id)}
                          disabled={loading}
                          className="btn-primary px-4 py-2 whitespace-nowrap"
                        >
                          {loading ? "Facturando..." : "Facturar"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t bg-background-secondary" style={{ borderColor: 'rgb(var(--border))' }}>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg font-medium text-foreground bg-background hover:bg-background-secondary border border-border transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

