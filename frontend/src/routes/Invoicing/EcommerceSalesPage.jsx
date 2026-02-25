import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "../../shared/useQuery.js";
import { apiClient } from "../../api/client.js";
import { ShoppingCart, PlusCircle, RefreshCcw, Receipt, X, Loader2 } from "lucide-react";
import { format } from "date-fns";

const CHANNEL_LABELS = {
  tienda_nube: "Tienda Nube",
  mercado_libre: "Mercado Libre",
  manual: "Manual",
};

export default function EcommerceSalesPage() {
  const [statusFilter, setStatusFilter] = useState("pending");
  const [channelFilter, setChannelFilter] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [saleToInvoice, setSaleToInvoice] = useState(null);

  const { data: constants } = useQuery(
    async () => {
      const response = await apiClient.get("/api/invoicing/constants");
      return response.data?.data || {};
    },
    []
  );

  const {
    data: sales = [],
    loading,
    error,
    refetch,
  } = useQuery(
    async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.append("status", statusFilter);
      if (channelFilter) params.append("channel", channelFilter);
      const response = await apiClient.get(`/api/ecommerce/sales?${params.toString()}`);
      return response.data?.data || [];
    },
    [statusFilter, channelFilter]
  );

  const openInvoiceModal = (sale) => {
    setSaleToInvoice(sale);
  };

  const closeInvoiceModal = () => {
    setSaleToInvoice(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-foreground-muted mb-1">Integraciones</p>
          <h1 className="text-3xl font-semibold text-foreground">Ventas Online</h1>
          <p className="text-foreground-secondary text-sm">
            Importá ventas de Tienda Nube o Mercado Libre y facturalas en un solo lugar.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCcw className="w-4 h-4" />
            Actualizar
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <PlusCircle className="w-4 h-4" />
            Nueva venta
          </button>
        </div>
      </header>

      <section className="card p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-foreground-muted mb-1 block">Estado</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input w-full"
            >
              <option value="pending">Pendientes</option>
              <option value="invoiced">Facturadas</option>
              <option value="">Todas</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-foreground-muted mb-1 block">Canal</label>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="input w-full"
            >
              <option value="">Todos</option>
              <option value="tienda_nube">Tienda Nube</option>
              <option value="mercado_libre">Mercado Libre</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div className="flex items-end">
            <p className="text-sm text-foreground-secondary">
              {sales.length} ventas encontradas
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-background-secondary text-foreground-secondary">
              <tr>
                <th className="px-4 py-3 text-left">Canal</th>
                <th className="px-4 py-3 text-left">Pedido</th>
                <th className="px-4 py-3 text-left">Cliente</th>
                <th className="px-4 py-3 text-left">Total</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-foreground-muted">
                    Cargando ventas...
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-red-400">
                    No pudimos cargar las ventas. Intentá nuevamente.
                  </td>
                </tr>
              )}
              {!loading && !error && sales.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-foreground-muted">
                    No hay ventas con los filtros seleccionados.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                sales.map((sale) => (
                  <tr key={sale.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                        <ShoppingCart className="w-4 h-4" />
                        {CHANNEL_LABELS[sale.channel] || sale.channel}
                      </span>
                      {sale.order_number && (
                        <p className="text-xs text-foreground-muted">#{sale.order_number}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {sale.source_order_id || "—"}
                      <p className="text-xs text-foreground-muted">
                        {format(new Date(sale.created_at), "dd/MM/yyyy HH:mm")}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{sale.customer_name}</p>
                      <p className="text-xs text-foreground-muted">
                        {sale.customer_email || sale.customer_phone || "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground">
                      $
                      {Number(sale.total_amount || 0).toLocaleString("es-AR", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs ${
                          sale.status === "pending"
                            ? "bg-amber-500/20 text-amber-400"
                            : "bg-emerald-500/20 text-emerald-400"
                        }`}
                      >
                        {sale.status === "pending" ? "Pendiente" : "Facturada"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {sale.status === "pending" ? (
                          <button
                            onClick={() => openInvoiceModal(sale)}
                            className="btn-primary btn--compact flex items-center gap-1"
                          >
                            <Receipt className="w-4 h-4" />
                            Facturar
                          </button>
                        ) : (
                          <span className="text-xs text-foreground-muted">Facturada</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {showCreateModal && (
        <CreateSaleModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            refetch();
          }}
        />
      )}

      {saleToInvoice && (
        <InvoiceSaleModal
          sale={saleToInvoice}
          constants={constants}
          onClose={closeInvoiceModal}
          onInvoiced={() => {
            closeInvoiceModal();
            refetch();
          }}
        />
      )}
    </div>
  );
}

function CreateSaleModal({ onClose, onCreated }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    channel: "tienda_nube",
    source_order_id: "",
    order_number: "",
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    customer_document: "",
    currency: "ARS",
  });
  const [items, setItems] = useState([
    { product_name: "", sku: "", quantity: 1, unit_price: 0 },
  ]);

  const total = useMemo(() => {
    return items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0);
  }, [items]);

  const updateItem = (index, field, value) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const addItem = () => {
    setItems((prev) => [...prev, { product_name: "", sku: "", quantity: 1, unit_price: 0 }]);
  };

  const removeItem = (index) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer_name.trim()) {
      toast.error("Completá el nombre del cliente");
      return;
    }
    if (!items.length || !items[0].product_name.trim()) {
      toast.error("Agregá al menos un producto");
      return;
    }
    try {
      setSaving(true);
      await apiClient.post("/api/ecommerce/sales", {
        ...form,
        items: items.map((item) => ({
          ...item,
          quantity: Number(item.quantity) || 1,
          unit_price: Number(item.unit_price) || 0,
        })),
      });
      toast.success("Venta registrada");
      onCreated?.();
    } catch (error) {
      const message = error.response?.data?.error || "No se pudo guardar la venta";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Nueva venta</h2>
            <p className="text-sm text-foreground-muted">Carga manual para Tienda Nube o Mercado Libre.</p>
          </div>
          <button className="btn-ghost btn--compact" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-foreground-muted mb-1 block">Canal</label>
              <select
                value={form.channel}
                onChange={(e) => setForm((prev) => ({ ...prev, channel: e.target.value }))}
                className="input w-full"
              >
                <option value="tienda_nube">Tienda Nube</option>
                <option value="mercado_libre">Mercado Libre</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-foreground-muted mb-1 block">N° pedido</label>
              <input
                type="text"
                className="input w-full"
                value={form.order_number}
                onChange={(e) => setForm((prev) => ({ ...prev, order_number: e.target.value }))}
                placeholder="#1234"
              />
            </div>
            <div>
              <label className="text-xs text-foreground-muted mb-1 block">ID externo</label>
              <input
                type="text"
                className="input w-full"
                value={form.source_order_id}
                onChange={(e) => setForm((prev) => ({ ...prev, source_order_id: e.target.value }))}
                placeholder="ID de Tienda Nube / ML"
              />
            </div>
            <div>
              <label className="text-xs text-foreground-muted mb-1 block">Documento</label>
              <input
                type="text"
                className="input w-full"
                value={form.customer_document}
                onChange={(e) => setForm((prev) => ({ ...prev, customer_document: e.target.value }))}
                placeholder="DNI o CUIT"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-foreground-muted mb-1 block">Nombre del cliente</label>
              <input
                type="text"
                className="input w-full"
                value={form.customer_name}
                onChange={(e) => setForm((prev) => ({ ...prev, customer_name: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="text-xs text-foreground-muted mb-1 block">Email</label>
              <input
                type="email"
                className="input w-full"
                value={form.customer_email}
                onChange={(e) => setForm((prev) => ({ ...prev, customer_email: e.target.value }))}
                placeholder="cliente@ejemplo.com"
              />
            </div>
            <div>
              <label className="text-xs text-foreground-muted mb-1 block">Teléfono</label>
              <input
                type="text"
                className="input w-full"
                value={form.customer_phone}
                onChange={(e) => setForm((prev) => ({ ...prev, customer_phone: e.target.value }))}
                placeholder="+54..."
              />
            </div>
            <div>
              <label className="text-xs text-foreground-muted mb-1 block">Moneda</label>
              <input
                type="text"
                className="input w-full"
                value={form.currency}
                onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">Productos</p>
              <button type="button" onClick={addItem} className="text-primary text-sm flex items-center gap-1">
                <PlusCircle className="w-4 h-4" /> Agregar ítem
              </button>
            </div>
            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-1 md:grid-cols-5 gap-2 border rounded-lg p-3">
                <input
                  type="text"
                  placeholder="Producto"
                  className="input md:col-span-2"
                  value={item.product_name}
                  onChange={(e) => updateItem(index, "product_name", e.target.value)}
                />
                <input
                  type="text"
                  placeholder="SKU"
                  className="input"
                  value={item.sku}
                  onChange={(e) => updateItem(index, "sku", e.target.value)}
                />
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Cantidad"
                  className="input"
                  value={item.quantity}
                  onChange={(e) => updateItem(index, "quantity", e.target.value)}
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Precio"
                    className="input flex-1"
                    value={item.unit_price}
                    onChange={(e) => updateItem(index, "unit_price", e.target.value)}
                  />
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeItem(index)} className="btn-ghost btn--compact text-red-400">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div>
              <p className="text-xs text-foreground-muted">Total estimado</p>
              <p className="text-xl font-semibold text-foreground">
                $
                {total.toLocaleString("es-AR", {
                  minimumFractionDigits: 2,
                })}
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Guardando...
                  </span>
                ) : (
                  "Guardar venta"
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function InvoiceSaleModal({ sale, constants, onClose, onInvoiced }) {
  const [tipoComprobante, setTipoComprobante] = useState(
    constants?.COMPROBANTE_TIPOS?.FACTURA_B || 6
  );
  const [loading, setLoading] = useState(false);

  const neto = useMemo(() => {
    return (sale.items || []).reduce(
      (sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 1),
      0
    );
  }, [sale]);

  const iva = neto * 0.21;
  const total = neto + iva;

  const handleInvoice = async () => {
    try {
      setLoading(true);
      const doc = (sale.customer_document || "").replace(/\D/g, "");
      const isCUIT = doc.length === 11;

      const itemsPayload = (sale.items || []).map((item, index) => ({
        descripcion: item.product_name || `Producto ${index + 1}`,
        cantidad: Number(item.quantity || 1),
        precio_unitario: Number(item.unit_price || 0),
        alicuota_iva: 21,
        codigo: item.sku || null,
      }));

      const response = await apiClient.post("/api/invoicing/arca/generate", {
        tipo_comprobante: tipoComprobante,
        concepto: constants?.CONCEPTOS?.PRODUCTOS || 1,
        tipo_doc_cliente: isCUIT ? 80 : 96,
        doc_cliente: doc || "00000000",
        razon_social: sale.customer_name || "Consumidor Final",
        condicion_iva: isCUIT
          ? constants?.CONDICIONES_IVA?.RESPONSABLE_INSCRIPTO || 1
          : constants?.CONDICIONES_IVA?.CONSUMIDOR_FINAL || 5,
        items: itemsPayload,
        importe_neto: neto,
        importe_iva: iva,
        importe_total: total,
        referencia_interna: `ECOM-${sale.id}`,
        observaciones: `Venta ${CHANNEL_LABELS[sale.channel] || sale.channel} #${sale.order_number || sale.source_order_id || sale.id}`,
      });

      const invoiceData = response.data?.data || response.data || {};

      await apiClient.post(`/api/ecommerce/sales/${sale.id}/mark-invoiced`, {
        invoice_id: invoiceData.id || response.data?.invoice_id || null,
        invoice_number:
          invoiceData.numero_comprobante ||
          invoiceData.numero ||
          response.data?.numero_comprobante ||
          null,
        cae: invoiceData.cae || response.data?.cae || null,
      });

      toast.success("Venta facturada");
      onInvoiced?.();
    } catch (error) {
      const message = error.response?.data?.error || "No se pudo generar la factura";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Facturar venta</h2>
            <p className="text-sm text-foreground-muted">
              {CHANNEL_LABELS[sale.channel] || sale.channel} • #{sale.order_number || sale.source_order_id || sale.id}
            </p>
          </div>
          <button className="btn-ghost btn--compact" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-foreground-muted mb-1 block">Cliente</label>
              <p className="font-medium text-foreground">{sale.customer_name}</p>
              <p className="text-xs text-foreground-muted">{sale.customer_email || sale.customer_phone || "—"}</p>
            </div>
            <div>
              <label className="text-xs text-foreground-muted mb-1 block">Tipo de comprobante</label>
              <select
                value={tipoComprobante}
                onChange={(e) => setTipoComprobante(Number(e.target.value))}
                className="input w-full"
              >
                <option value={constants?.COMPROBANTE_TIPOS?.FACTURA_B || 6}>Factura B</option>
                <option value={constants?.COMPROBANTE_TIPOS?.FACTURA_A || 1}>Factura A</option>
                <option value={constants?.COMPROBANTE_TIPOS?.FACTURA_C || 11}>Factura C</option>
              </select>
            </div>
          </div>

          <div className="border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-background-secondary text-foreground-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">Producto</th>
                  <th className="px-3 py-2 text-right">Cantidad</th>
                  <th className="px-3 py-2 text-right">Precio</th>
                  <th className="px-3 py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {(sale.items || []).map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground">{item.product_name}</td>
                    <td className="px-3 py-2 text-right">{Number(item.quantity || 1)}</td>
                    <td className="px-3 py-2 text-right">
                      ${Number(item.unit_price || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-foreground">
                      $
                      {(Number(item.unit_price || 0) * Number(item.quantity || 1)).toLocaleString("es-AR", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-4 text-sm">
            <div className="text-right">
              <p className="text-foreground-muted">Neto</p>
              <p className="text-lg font-semibold text-foreground">
                ${neto.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-foreground-muted">IVA (21%)</p>
              <p className="text-lg font-semibold text-foreground">
                ${iva.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-foreground-muted">Total</p>
              <p className="text-2xl font-bold text-foreground">
                ${total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
          <button className="btn-ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={handleInvoice} disabled={loading}>
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Facturando...
              </span>
            ) : (
              "Generar factura"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

