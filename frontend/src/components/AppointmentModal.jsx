import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../context/UseApp";
import { apiClient } from "../api/client";
import { toast } from "sonner";
import { logger } from "../utils/logger.js";
import {
  X,
  XCircle,
  Save,
  Trash2,
  MessageSquare,
  DollarSign,
  Calendar,
  Users,
  CalendarClock,
  RefreshCw,
  AlertTriangle,
  Repeat,
  ShieldAlert,
  Bell,
  FileText,
  Package,
  Plus,
  Minus,
  Search,
} from "lucide-react";

const CLASS_STATUS_STYLES = {
  reserved: "bg-indigo-500/15 text-indigo-200 border-indigo-500/30",
  attended: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  cancelled: "bg-red-500/15 text-red-200 border-red-500/30",
  noshow: "bg-amber-500/15 text-amber-200 border-amber-500/30",
};

function formatDateToLocalInput(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function parseLocalInputToDate(local) {
  if (!local) return null;
  const s = local.includes("T") ? local : local.replace(" ", "T");
  const [datePart, timePart = "00:00"] = s.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh = 0, mm = 0] = (timePart.split(":").map(Number) || []);
  return new Date(y, m - 1, d, hh, mm, 0);
}

function isoToLocalInput(isoOrLocal) {
  if (!isoOrLocal) return "";
  const s = String(isoOrLocal).trim();
  if (/[zZ]$|[+\-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return formatDateToLocalInput(d);
  }
  const maybeLocal = s.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(maybeLocal)) {
    const d = parseLocalInputToDate(maybeLocal);
    return formatDateToLocalInput(d);
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return formatDateToLocalInput(d);
  return "";
}

export default function AppointmentModal({ open, onClose, event }) {
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  // Seguir el tema global (clase 'dark' en <html>) para light/dark mode
  const [darkMode, setDarkMode] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false
  );

  const {
    services = [],
    instructors = [],
    branches = [],
    branchesLoading = false,
    updateAppointment,
    deleteAppointment,
    cancelAppointmentSeries,
  } = useApp();
  const a = event?.extendedProps || {};
  const eventType = a.eventType || "appointment";
  const isClassSession = eventType === "class_session";
  const classSessionId = useMemo(() => {
    if (!isClassSession) return null;
    const raw =
      a.session_id ??
      a.id ??
      (typeof event?.id === "string" && event.id.startsWith("class-")
        ? event.id.replace(/^class-/, "")
        : event?.id);
    const numeric = Number(raw);
    return Number.isNaN(numeric) ? null : numeric;
  }, [a, event, isClassSession]);

  const [form, setForm] = useState(() => {
    const _a = event?.extendedProps || {};
    return {
      customerName: _a.customer_name || "",
      customerPhone: _a.phone_e164 || _a.customer_phone || "",
      serviceId: _a.service_id || _a.serviceId || "",
      instructorId: _a.instructor_id || _a.instructorId || "",
      startsLocal: isoToLocalInput(event?.start || _a.starts_at || _a.startsAt),
      status: _a.status || "scheduled",
      branchId: _a.branch_id || _a.branchId ? String(_a.branch_id || _a.branchId) : "",
    };
  });

  const [saving, setSaving] = useState(false);
  const [payUI, setPayUI] = useState({ visible: false, method: null });
  const [confirmUI, setConfirmUI] = useState({
    open: false,
    title: "",
    message: "",
    confirmText: "Confirmar",
    cancelText: "Cancelar",
    onConfirm: null,
  });
  const [reprogUI, setReprogUI] = useState({ visible: false, customText: "", autoCancel: true });
  const [activeTab, setActiveTab] = useState("details");

  const [classDetail, setClassDetail] = useState(null);
  const [classLoading, setClassLoading] = useState(false);
  const [classError, setClassError] = useState("");

  // Facturación
  const [invoiceUI, setInvoiceUI] = useState({ visible: false });
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState({}); // { productId: { quantity, price } }
  const [productSearch, setProductSearch] = useState("");
  const [invoiceConstants, setInvoiceConstants] = useState(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [customers, setCustomers] = useState([]);

  const seriesId = a.series_id || a.seriesId || null;
  const isSeries = Boolean(seriesId);
  const [applySeries, setApplySeries] = useState(isSeries ? "future" : "none");

  const fetchClassDetail = useCallback(async () => {
    if (!classSessionId) return;
    try {
      setClassLoading(true);
      setClassError("");
      const detail = await apiClient.getClassSession(classSessionId);
      setClassDetail(detail);
    } catch (err) {
      logger.error("❌ [AppointmentModal] Error cargando clase:", err);
      setClassError(err?.message || "No se pudo cargar la clase seleccionada.");
    } finally {
      setClassLoading(false);
    }
  }, [classSessionId]);

  const openConfirm = (cfg) => setConfirmUI({ open: true, cancelText: "Cancelar", confirmText: "Confirmar", ...cfg });
  const closeConfirm = () => setConfirmUI((u) => ({ ...u, open: false, onConfirm: null }));

  useEffect(() => {
    if (!msg && !error) return;
    const t = setTimeout(() => {
      setMsg("");
      setError("");
    }, 3000);
    return () => clearTimeout(t);
  }, [msg, error]);

  // Escuchar cambios de tema (toggle agrega/remueve 'dark' en <html>)
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDarkMode(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === "class") {
          update();
          break;
        }
      }
    });
    observer.observe(root, { attributes: true });
    return () => observer.disconnect();
  }, []);

  // Bloquear scroll del body cuando la modal está abierta para evitar "saltos" al hacer hover fuera
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow || "";
    };
  }, [open]);
  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (isClassSession) return;
    const _a = event?.extendedProps || {};
    const localInput = isoToLocalInput(event?.start || _a.starts_at || _a.startsAt);

    setForm({
      customerName: _a.customer_name || "",
      customerPhone: _a.phone_e164 || _a.customer_phone || "",
      serviceId: _a.service_id || _a.serviceId || "",
      instructorId: _a.instructor_id || _a.instructorId || "",
      startsLocal: localInput,
      status: _a.status || "scheduled",
      branchId: _a.branch_id || _a.branchId ? String(_a.branch_id || _a.branchId) : "",
    });

    setApplySeries(seriesId ? "future" : "none");

    const name = _a.customer_name ? ` ${_a.customer_name}` : "";
    setReprogUI({
      visible: false,
      customText: `Hola${name} 💈\nNecesitamos *reprogramar tu turno*. ¿Podemos coordinar una nueva fecha por acá? 🙏`,
      autoCancel: true,
    });

    setMsg("");
    setError("");
    setSaving(false);
    setPayUI({ visible: false, method: null });
  }, [open, event, isClassSession]);

  useEffect(() => {
    if (!open) {
      setClassDetail(null);
      setClassError("");
      setInvoiceUI({ visible: false });
      setSelectedProducts({});
      setProductSearch("");
      return;
    }
    if (!isClassSession) return;
    fetchClassDetail();
  }, [open, isClassSession, fetchClassDetail]);

  // Cargar productos y constantes cuando se abre la UI de facturación
  useEffect(() => {
    if (!invoiceUI.visible || !open) return;
    
    const loadData = async () => {
      try {
        setProductsLoading(true);
        
        // Cargar productos
        const productsResponse = await apiClient.get("/api/stock/products");
        const productsData = productsResponse.data?.data || productsResponse.data || [];
        setProducts(productsData.filter(p => p.active !== false));
        
        // Cargar constantes de facturación
        const constantsResponse = await apiClient.get("/api/invoicing/constants");
        setInvoiceConstants(constantsResponse.data?.data || constantsResponse.data);
        
        // Cargar clientes (para obtener datos del cliente del turno)
        try {
          const customersResponse = await apiClient.get("/api/admin/customers");
          const customersData = customersResponse.data?.data || customersResponse.data || [];
          setCustomers(Array.isArray(customersData) ? customersData : []);
        } catch (err) {
          logger.warn("Error cargando clientes:", err);
        }
      } catch (error) {
        logger.error("Error cargando datos para facturación:", error);
        toast.error("Error al cargar datos para facturación");
      } finally {
        setProductsLoading(false);
      }
    };
    
    loadData();
  }, [invoiceUI.visible, open]);

  const onChange = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const selectedService = useMemo(
    () => (services || []).find((s) => String(s.id) === String(form.serviceId)),
    [services, form.serviceId]
  );

  const mpPaymentId = a.mp_payment_id || a.mp_paymentId || a.payment_id || null;
  const mpStatus = a.mp_payment_status || a.payment_status || null;
  const isDepositPaid = a.status === "deposit_paid" || a.status === "confirmed" || !!a.deposit_paid_at;

  const onSave = async () => {
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const startsAt = form.startsLocal;
      let endsAt = null;
      if (selectedService?.duration_min && form.startsLocal) {
        const d = parseLocalInputToDate(form.startsLocal);
        d.setMinutes(d.getMinutes() + Number(selectedService.duration_min));
        endsAt = `${formatDateToLocalInput(d)}:00`;
      }

      const result = await updateAppointment(a.id, {
        customerName: form.customerName || null,
        customerPhone: form.customerPhone || null,
        serviceId: Number(form.serviceId) || null,
        instructorId: Number(form.instructorId) || null,
        startsAt,
        endsAt,
        status: form.status,
        applySeries: seriesId ? applySeries : undefined,
        branchId: form.branchId ? Number(form.branchId) : null,
      });
      if (!result?.ok) {
        throw new Error(result?.error || "No se pudo guardar el turno");
      }

      toast.success("Turno actualizado correctamente", {
        description: `Cliente: ${form.customerName || "Sin nombre"}`,
      });
      setMsg("Turno actualizado correctamente.");
    } catch (err) {
      const errorMsg = err?.message || "Error al guardar.";
      toast.error("Error al actualizar turno", { description: errorMsg });
      setError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    setSaving(true);
    setError("");
    setMsg("");
    try {
      await deleteAppointment(a.id);
      toast.success("Turno eliminado", {
        description: "El turno ha sido borrado del sistema",
      });
      setMsg("Turno eliminado.");
      onClose?.();
    } catch (err) {
      const errorMsg = err?.message || "Error al eliminar.";
      toast.error("Error al eliminar turno", { description: errorMsg });
      setError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const askDelete = () =>
    openConfirm({
      title: "Eliminar turno",
      message: "¿Seguro que querés eliminar este turno? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      onConfirm: async () => {
        closeConfirm();
        await onDelete();
      },
    });

  const onReprogramOpen = () => setReprogUI((u) => ({ ...u, visible: true }));
  const onReprogramCancel = () => setReprogUI((u) => ({ ...u, visible: false }));

  const onReprogramSend = async () => {
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const { data: j } = await apiClient.post("/api/whatsapp/reprogram", {
        appointmentId: a.id,
        phone: a.phone_e164 || a.customer_phone || form.customerPhone,
        customText: reprogUI.customText || null,
        autoCancel: Boolean(reprogUI.autoCancel),
      });
      if (!j?.ok) throw new Error(j?.error || "No se pudo enviar el mensaje.");

      toast.success("Mensaje de reprogramación enviado", {
        description: j.cancelled ? "El turno fue cancelado automáticamente" : "WhatsApp enviado exitosamente",
      });
      setMsg(
        `Mensaje enviado por WhatsApp. ${j.cancelled ? "El turno fue cancelado para liberar el hueco." : ""}`
      );
      setReprogUI({ visible: false, customText: "", autoCancel: true });

      if (j.cancelled) {
        await updateAppointment(a.id, { status: "cancelled" });
        onClose?.();
      }
    } catch (err) {
      const errorMsg = err?.message || "Error al reprogramar por WhatsApp.";
      toast.error("Error al enviar WhatsApp", { description: errorMsg });
      setError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const onCancelAppointment = async () => {
    setSaving(true);
    setError("");
    setMsg("");
    try {
      await updateAppointment(a.id, { status: "cancelled" });
      toast.info("Turno cancelado", {
        description: "El horario ha sido liberado",
      });
      setMsg("Turno cancelado.");
      onClose?.();
    } catch (err) {
      const errorMsg = err?.message || "Error al cancelar el turno.";
      toast.error("Error al cancelar", { description: errorMsg });
      setError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const askCancel = () =>
    openConfirm({
      title: "Cancelar turno",
      message: "El turno quedará marcado como cancelado y se liberará el horario.",
      confirmText: "Cancelar turno",
      onConfirm: async () => {
        closeConfirm();
        await onCancelAppointment();
      },
    });

  const askCancelSeries = () => {
    if (!seriesId) return;
    openConfirm({
      title: "Cancelar serie completa",
      message:
        "¿Querés cancelar todos los turnos pendientes de esta serie? Los turnos futuros se marcarán como cancelados.",
      confirmText: "Cancelar serie",
      onConfirm: async () => {
        closeConfirm();
        setSaving(true);
        try {
          const result = await cancelAppointmentSeries(seriesId, { includePast: false, notify: true });
          if (!result?.ok) throw new Error(result?.error || "No se pudo cancelar la serie");
          toast.success("Serie cancelada", {
            description: "Los turnos futuros fueron cancelados y el cliente será notificado.",
          });
          setMsg("Serie cancelada correctamente.");
          onClose?.();
        } catch (err) {
          const message = err?.message || "Error al cancelar la serie.";
          toast.error("Error al cancelar la serie", { description: message });
          setError(message);
        } finally {
          setSaving(false);
        }
      },
    });
  };

  // Funciones de facturación
  const handleProductSelect = (product) => {
    setSelectedProducts(prev => {
      const current = prev[product.id] || { quantity: 1, price: parseFloat(product.sale_price || product.price || 0) };
      return {
        ...prev,
        [product.id]: current
      };
    });
  };

  const updateProductQuantity = (productId, delta) => {
    setSelectedProducts(prev => {
      const current = prev[productId];
      if (!current) return prev;
      const newQuantity = Math.max(1, (current.quantity || 1) + delta);
      return {
        ...prev,
        [productId]: { ...current, quantity: newQuantity }
      };
    });
  };

  const removeProduct = (productId) => {
    setSelectedProducts(prev => {
      const newState = { ...prev };
      delete newState[productId];
      return newState;
    });
  };

  const calculateInvoiceTotal = () => {
    let total = 0;
    
    // Precio del servicio
    if (selectedService?.price_decimal) {
      total += Number(selectedService.price_decimal);
    }
    
    // Productos adicionales
    total += Object.entries(selectedProducts).reduce((sum, [_, data]) => {
      return sum + (data.price * data.quantity);
    }, 0);
    
    return total;
  };

  const handleInvoice = async () => {
    if (!a.id) {
      toast.error("No se puede facturar un turno sin ID");
      return;
    }

    setInvoiceLoading(true);
    setError("");
    setMsg("");

    try {
      // Obtener datos del cliente
      const customerId = a.customer_id || a.customer?.id;
      const customer = customers.find(c => c.id === customerId) || {
        id: customerId,
        name: form.customerName || a.customer_name || "Consumidor Final",
        documento: "00000000"
      };

      // Items de la factura
      const items = [];

      // Item del servicio
      if (selectedService?.price_decimal && Number(selectedService.price_decimal) > 0) {
        items.push({
          descripcion: selectedService.name || "Servicio",
          cantidad: 1,
          precio_unitario: Number(selectedService.price_decimal),
          alicuota_iva: 21
        });
      }

      // Items de productos adicionales
      Object.entries(selectedProducts).forEach(([productId, data]) => {
        const product = products.find(p => p.id === parseInt(productId));
        if (product && data.quantity > 0 && data.price > 0) {
          items.push({
            descripcion: product.name || `Producto ${productId}`,
            cantidad: data.quantity,
            precio_unitario: data.price,
            alicuota_iva: 21,
            codigo: product.code || null,
            product_id: productId
          });
        }
      });

      if (items.length === 0) {
        toast.error("No hay items para facturar");
        return;
      }

      const importe_neto = items.reduce((sum, item) => sum + (item.precio_unitario * (item.cantidad || 1)), 0);
      const importe_iva = importe_neto * 0.21;
      const importe_total = importe_neto + importe_iva;

      // Llamar a la API para facturar
      const response = await apiClient.post("/api/invoicing/arca/generate", {
        tipo_comprobante: invoiceConstants?.COMPROBANTE_TIPOS?.FACTURA_B || 6,
        customer_id: customer.id,
        items: items,
        importe_neto: importe_neto,
        importe_iva: importe_iva,
        importe_total: importe_total,
        concepto: invoiceConstants?.CONCEPTOS?.SERVICIOS || 2,
        tipo_doc_cliente: customer.documento?.length === 11 ? 80 : 96,
        doc_cliente: customer.documento || "00000000",
        razon_social: customer.name || "Consumidor Final",
        condicion_iva: invoiceConstants?.CONDICIONES_IVA?.CONSUMIDOR_FINAL || 5,
        appointment_ids: [a.id],
        product_ids: Object.keys(selectedProducts).map(id => parseInt(id))
      });

      if (response.data?.ok) {
        toast.success("Turno facturado correctamente", {
          description: `Factura generada para ${customer.name}`,
        });
        setMsg("Turno facturado correctamente.");
        setInvoiceUI({ visible: false });
        setSelectedProducts({});
        setProductSearch("");
        onClose?.();
      } else {
        throw new Error(response.data?.error || "Error al facturar el turno");
      }
    } catch (err) {
      const errorMsg = err?.response?.data?.error || err?.message || "Error al facturar el turno";
      toast.error("Error al facturar", { description: errorMsg });
      setError(errorMsg);
    } finally {
      setInvoiceLoading(false);
    }
  };

  const renderClassContent = () => {
    const detail =
      classDetail || {
        id: classSessionId,
        activity_type: a.activity_type,
        instructor_name: a.instructor_name,
        starts_at: a.starts_at,
        ends_at: a.ends_at,
        notes: a.notes,
        status: a.status,
        price_decimal: a.price_decimal,
        capacity_max: a.capacity_max,
        enrollments: a.enrollments || [],
        enrolled_count: a.enrolled_count,
      };

    const modalBg = darkMode ? "bg-slate-900" : "bg-white";
    const borderColor = darkMode ? "border-slate-700" : "border-gray-200";
    const textColor = darkMode ? "text-slate-100" : "text-gray-900";

    const startLabel = detail.starts_at
      ? formatDateToLocalInput(detail.starts_at).replace("T", " ")
      : "—";
    const occupied =
      detail.enrolled_count != null
        ? detail.enrolled_count
        : (detail.enrollments || []).filter((e) => e.status === "reserved" || e.status === "attended").length;
    const capacity = detail.capacity_max ?? "∞";
    const price = new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(Number(detail.price_decimal || 0));

    return (
      <div
        className="arja-modal"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose?.();
        }}
      >
        <div
          className="arja-modal__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="class-modal-title"
          tabIndex="-1"
          ref={dialogRef}
        >
          <header className="arja-modal__header">
            <div>
              <p className="arja-modal__subtitle">Detalle de clase</p>
              <h2 id="class-modal-title" className="arja-modal__title">{detail.activity_type || "Clase grupal"}</h2>
              {detail.status === "cancelled" && (
                <div className="badge badge-danger">
                  <AlertTriangle />
                  Clase cancelada
                </div>
              )}
            </div>
            <div className="arja-modal__header-actions">
              <button
                type="button"
                onClick={fetchClassDetail}
                className="btn-secondary btn--compact"
                disabled={classLoading}
              >
                <RefreshCw className={classLoading ? "animate-spin" : ""} />
                Actualizar
              </button>
              <button type="button" onClick={() => onClose?.()} className="arja-modal__close">
                <X />
              </button>
            </div>
          </header>

          {classError && (
            <div className="arja-modal__alert arja-modal__alert--danger">{classError}</div>
          )}

          <div className="grid gap-6 overflow-y-auto px-6 py-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <section className="space-y-4">
              <div className="rounded-2xl border border-indigo-500/20 bg-slate-900/60 p-5 shadow-inner shadow-indigo-500/10 text-slate-200 space-y-4">
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-start gap-3">
                    <CalendarClock className="mt-1 h-5 w-5 text-indigo-300" />
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-indigo-200/80">Horario</dt>
                      <dd className="text-sm font-medium">{startLabel}</dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Users className="mt-1 h-5 w-5 text-indigo-300" />
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-indigo-200/80">Profesor</dt>
                      <dd className="text-sm font-medium">{detail.instructor_name || "Sin asignar"}</dd>
                      <dd className="text-xs text-slate-400">
                        Cupo {occupied}/{capacity}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <DollarSign className="mt-1 h-5 w-5 text-indigo-300" />
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-indigo-200/80">Precio</dt>
                      <dd className="text-sm font-medium">{price}</dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Calendar className="mt-1 h-5 w-5 text-indigo-300" />
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-indigo-200/80">Estado</dt>
                      <dd className="text-sm font-medium capitalize">{detail.status || "scheduled"}</dd>
                    </div>
                  </div>
                </dl>

                {detail.notes && (
                  <div className="rounded-xl border border-slate-700/40 bg-slate-900/80 p-4 text-sm text-slate-200">
                    <p className="font-semibold text-indigo-200">Notas</p>
                    <p className="mt-1 leading-relaxed whitespace-pre-line">{detail.notes}</p>
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-indigo-200">Inscriptos</h3>
                <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">
                  {occupied}/{capacity} lugares ocupados
                </span>
              </div>

              {classLoading ? (
                <div className="flex items-center gap-3 text-indigo-200 text-sm">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Cargando información…
                </div>
              ) : detail.enrollments?.length ? (
                <ul className="space-y-3">
                  {detail.enrollments.map((enrollment) => {
                    const badgeClass = CLASS_STATUS_STYLES[enrollment.status] || CLASS_STATUS_STYLES.reserved;
                    return (
                      <li
                        key={enrollment.id}
                        className="rounded-2xl border border-slate-700/40 bg-slate-900/80 p-4 text-sm text-slate-200"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-100">{enrollment.customer_name || "Cliente sin nombre"}</p>
                            <p className="text-xs text-slate-400">{enrollment.customer_phone || "Sin teléfono"}</p>
                          </div>
                          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${badgeClass}`}>
                            {enrollment.status || "reserved"}
                          </span>
                        </div>
                        {enrollment.notes && (
                          <p className="mt-2 text-xs text-slate-400 leading-relaxed whitespace-pre-line">{enrollment.notes}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="rounded-2xl border border-slate-700/40 bg-slate-900/80 p-6 text-center text-sm text-slate-300">
                  No hay alumnos inscriptos todavía.
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    );
  };

  if (!open) return null;
  if (isClassSession) return createPortal(renderClassContent(), document.body);

  const modalBg = darkMode ? "bg-slate-900" : "bg-white";
  const borderColor = darkMode ? "border-slate-700" : "border-gray-200";
  const textColor = darkMode ? "text-slate-100" : "text-gray-900";
  const subtextColor = darkMode ? "text-slate-400" : "text-gray-600";
  const inputBg = darkMode ? "bg-slate-800 border-slate-700 text-slate-100" : "bg-white border-gray-300 text-gray-900";
  const buttonPrimary = darkMode ? "bg-emerald-600 hover:bg-emerald-700" : "bg-black hover:bg-black/90";
  const buttonSecondary = darkMode ? "bg-slate-800 hover:bg-slate-700 border-slate-600" : "bg-white hover:bg-gray-50 border-gray-300";

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        zIndex: 9999,
        backdropFilter: "blur(4px)",
        pointerEvents: "auto",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className={`${modalBg} ${borderColor} border rounded-2xl shadow-2xl`}
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 680,
          maxWidth: "calc(100vw - 48px)",
          maxHeight: "calc(100vh - 48px)",
          overflow: "auto",
          padding: 24,
          willChange: "transform",
          pointerEvents: "auto",
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-modal-title"
        tabIndex="-1"
        ref={dialogRef}
      >
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 id="appointment-modal-title" className={`text-xl font-bold tracking-tight ${textColor} flex items-center gap-2`}>
              <Calendar className="w-5 h-5" />
              Editar turno
            </h3>
            <div className={`${subtextColor} text-sm mt-1`}>
              #{a?.id} • {a?.customer_name || "Cliente"} • {a?.service_name || "Servicio"}
            </div>
          </div>
          <button
            onClick={() => onClose?.()}
            className={`p-2 rounded-xl ${buttonSecondary} border transition-all`}
            title="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {isDepositPaid && (
            <span className="px-2 py-1 rounded-full text-xs bg-emerald-100 text-emerald-700 border border-emerald-200">
              ✓ Seña pagada
            </span>
          )}
          {mpPaymentId && (
            <span className="px-2 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20">
              MP ID: {mpPaymentId}
            </span>
          )}
          {mpStatus && (
            <span className="px-2 py-1 rounded-full text-xs bg-primary-light text-primary border border-primary/20">
              MP: {String(mpStatus).toUpperCase()}
            </span>
          )}
          {!isDepositPaid && (
            <span className="px-2 py-1 rounded-full text-xs bg-amber-100 text-amber-700 border border-amber-200">
              ⏳ Seña pendiente
            </span>
          )}
          {isSeries && (
            <span className="px-2 py-1 rounded-full text-xs bg-primary-light text-primary border border-primary/20 flex items-center gap-1">
              <Repeat className="w-3 h-3" />
              Serie semanal
            </span>
          )}
        </div>

        {/* Tabs de navegación */}
        <div className="flex gap-2 mb-4 border-b border-border">
          {[
            { id: "details", label: "Detalles", icon: Calendar },
            { id: "actions", label: "Acciones", icon: MessageSquare },
            { id: "invoice", label: "Facturación", icon: FileText },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                  activeTab === tab.id
                    ? `${textColor} border-primary-500`
                    : `${subtextColor} border-transparent hover:border-border`
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Contenido de tabs */}
        {activeTab === "details" && (
          <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className={`block text-sm font-medium mb-1 ${textColor}`}>Cliente</label>
            <input
              className={`w-full rounded-xl border px-3 py-2 text-sm ${inputBg}`}
              value={form.customerName}
              onChange={onChange("customerName")}
              placeholder="Nombre (opcional)"
            />
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1 ${textColor}`}>Teléfono</label>
            <input
              className={`w-full rounded-xl border px-3 py-2 text-sm ${inputBg}`}
              value={form.customerPhone}
              onChange={onChange("customerPhone")}
              placeholder="+54911..."
            />
          </div>

          <div>
            <label className={`block text-sm font-medium mb-1 ${textColor}`}>Servicio</label>
            <select className={`w-full rounded-xl border px-3 py-2 text-sm ${inputBg}`} value={form.serviceId} onChange={onChange("serviceId")}>
              <option value="">Seleccioná…</option>
              {(services || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1 ${textColor}`}>Instructor/a</label>
            <select className={`w-full rounded-xl border px-3 py-2 text-sm ${inputBg}`} value={form.instructorId} onChange={onChange("instructorId")}>
              <option value="">Seleccioná…</option>
              {(instructors || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {!isClassSession && (
            <div>
              <label className={`block text-sm font-medium mb-1 ${textColor}`}>Sucursal</label>
              <select
                className={`w-full rounded-xl border px-3 py-2 text-sm ${inputBg}`}
                value={form.branchId || ""}
                onChange={onChange("branchId")}
                disabled={branchesLoading || branches.length === 0}
              >
                {branchesLoading ? (
                  <option value="">Cargando sucursales...</option>
                ) : branches.length === 0 ? (
                  <option value="">No hay sucursales activas</option>
                ) : (
                  branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))
                )}
              </select>
            </div>
          )}

          <div>
            <label className={`block text-sm font-medium mb-1 ${textColor}`}>Fecha y hora</label>
            <input
              type="datetime-local"
              className={`w-full rounded-xl border px-3 py-2 text-sm ${inputBg}`}
              value={form.startsLocal}
              onChange={onChange("startsLocal")}
              step="300"
            />
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1 ${textColor}`}>Estado</label>
            <select className={`w-full rounded-xl border px-3 py-2 text-sm ${inputBg}`} value={form.status} onChange={onChange("status")}>
              <option value="scheduled">Programado</option>
              <option value="pending_deposit">Seña pendiente</option>
              <option value="deposit_paid">Seña pagada</option>
              <option value="confirmed">Confirmado</option>
              <option value="completed">Completado</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>

          {isSeries && (
            <div className="col-span-2">
              <label className={`block text-sm font-medium mb-1 ${textColor}`}>Aplicar cambios a</label>
              <select
                className={`w-full rounded-xl border px-3 py-2 text-sm ${inputBg}`}
                value={applySeries}
                onChange={(e) => setApplySeries(e.target.value)}
              >
                <option value="none">Solo este turno</option>
                <option value="future">Este y los siguientes</option>
                <option value="all">Todos los turnos de la serie</option>
              </select>
              <p className={`mt-2 text-xs ${subtextColor}`}>
                Elegí si querés modificar únicamente este turno o toda la serie recurrente.
              </p>
            </div>
          )}
          </div>
        )}

        {activeTab === "actions" && (
          <div className="mb-4 space-y-4">
            {/* Reprogramación */}
            <div className={`p-4 rounded-xl border ${borderColor}`}>
              <div className="flex justify-between items-center mb-3">
                <div className={`font-semibold flex items-center gap-2 ${textColor}`}>
                  <MessageSquare className="w-4 h-4" />
                  Reprogramar por WhatsApp
                </div>
                <button onClick={onReprogramOpen} className={`px-3 py-1.5 rounded-lg text-xs ${buttonSecondary} border`}>
                  {reprogUI.visible ? "Cerrar" : "Abrir"}
                </button>
              </div>
              {reprogUI.visible && (
                <div className={`p-3 rounded-lg ${darkMode ? "bg-slate-800/50" : "bg-gray-50"}`}>
                  <textarea
                    rows={4}
                    className={`w-full rounded-lg border px-3 py-2 text-sm ${inputBg}`}
                    value={reprogUI.customText}
                    onChange={(e) => setReprogUI((u) => ({ ...u, customText: e.target.value }))}
                    placeholder="Mensaje personalizado..."
                    disabled={saving}
                  />
                  <div className="flex items-center gap-2 mt-2 mb-3">
                    <input
                      id="autoCancel"
                      type="checkbox"
                      checked={reprogUI.autoCancel}
                      onChange={(e) => setReprogUI((u) => ({ ...u, autoCancel: e.target.checked }))}
                      disabled={saving}
                      className="rounded"
                    />
                    <label htmlFor="autoCancel" className={`text-xs ${subtextColor}`}>
                      Cancelar turno automáticamente
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={onReprogramCancel} className={`px-3 py-1.5 rounded-lg text-sm ${buttonSecondary} border flex-1`} disabled={saving}>
                      Cerrar
                    </button>
                    <button
                      onClick={onReprogramSend}
                      className={`px-3 py-1.5 rounded-lg text-sm ${buttonPrimary} text-white flex-1`}
                      disabled={saving}
                    >
                      {saving ? "Enviando…" : "Enviar"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Acciones rápidas */}
            <div className={`p-4 rounded-xl border ${borderColor}`}>
              <div className={`font-semibold flex items-center gap-2 mb-3 ${textColor}`}>
                <Bell className="w-4 h-4" />
                Acciones rápidas
              </div>
              <div className="grid grid-cols-2 gap-2">
                {!isClassSession && a.id && ["scheduled", "confirmed", "deposit_paid", "pending_deposit"].includes(a.status) && (
                  <button
                    onClick={async () => {
                      try {
                        setSaving(true);
                        const response = await apiClient.post(`/api/reminders/send/${a.id}`);
                        if (response.data?.ok) {
                          toast.success("Recordatorio enviado correctamente");
                        } else {
                          toast.error(response.data?.error || "Error al enviar recordatorio");
                        }
                      } catch (error) {
                        toast.error(error?.response?.data?.error || "Error al enviar recordatorio");
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving}
                    className={`px-3 py-2 rounded-lg text-sm ${buttonSecondary} border flex items-center justify-center gap-2`}
                  >
                    <Bell className="w-4 h-4" />
                    Recordatorio
                  </button>
                )}
                {isSeries && (
                  <button
                    onClick={askCancelSeries}
                    disabled={saving}
                    className="px-3 py-2 rounded-lg border border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 text-sm flex items-center justify-center gap-2"
                  >
                    <ShieldAlert className="w-4 h-4" />
                    Cancelar serie
                  </button>
                )}
                <button
                  onClick={askCancel}
                  disabled={saving}
                  className={`px-3 py-2 rounded-lg text-sm ${buttonSecondary} border flex items-center justify-center gap-2`}
                >
                  <XCircle className="w-4 h-4" />
                  Cancelar turno
                </button>
                <button
                  onClick={askDelete}
                  disabled={saving}
                  className="px-3 py-2 rounded-lg border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 text-sm flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "invoice" && (
          <div className={`mb-4 p-4 rounded-xl border ${borderColor}`}>
          <div className="flex justify-between items-center mb-3">
            <div className={`font-semibold flex items-center gap-2 ${textColor}`}>
              <FileText className="w-4 h-4" />
              Facturar turno
            </div>
            <button 
              onClick={() => setInvoiceUI({ visible: !invoiceUI.visible })} 
              className={`px-3 py-1.5 rounded-lg text-xs ${buttonSecondary} border`}
            >
              {invoiceUI.visible ? "Cerrar" : "Abrir"}
            </button>
          </div>
          {invoiceUI.visible && (
            <div className={`p-3 rounded-lg ${darkMode ? "bg-slate-800/50" : "bg-gray-50"}`}>
              {productsLoading ? (
                <div className={`text-center py-4 text-sm ${subtextColor}`}>
                  Cargando productos...
                </div>
              ) : (
                <>
                  {/* Buscar productos */}
                  <div className="mb-3">
                    <label className={`block text-xs font-medium mb-1 ${textColor}`}>
                      Agregar productos (opcional)
                    </label>
                    <div className="relative">
                      <Search className={`absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 ${subtextColor}`} />
                      <input
                        type="text"
                        className={`w-full rounded-lg border pl-8 pr-3 py-2 text-sm ${inputBg}`}
                        placeholder="Buscar producto por nombre o código..."
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && productSearch.trim()) {
                            const filtered = products.filter(p => 
                              p.name?.toLowerCase().includes(productSearch.toLowerCase()) ||
                              p.code?.toLowerCase().includes(productSearch.toLowerCase())
                            );
                            if (filtered.length > 0) {
                              const product = filtered[0];
                              handleProductSelect(product);
                              setProductSearch("");
                            }
                          }
                        }}
                      />
                    </div>
                    {productSearch && (
                      <div className="mt-1 max-h-32 overflow-y-auto border rounded-lg bg-background">
                        {products
                          .filter(p => 
                            p.name?.toLowerCase().includes(productSearch.toLowerCase()) ||
                            p.code?.toLowerCase().includes(productSearch.toLowerCase())
                          )
                          .slice(0, 5)
                          .map(product => (
                            <button
                              key={product.id}
                              type="button"
                              onClick={() => {
                                handleProductSelect(product);
                                setProductSearch("");
                              }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-background-secondary border-b last:border-b-0"
                            >
                              <div className="font-medium">{product.name}</div>
                              <div className={`text-xs ${subtextColor}`}>
                                {product.code ? `Código: ${product.code} • ` : ""}
                                ${parseFloat(product.sale_price || product.price || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                              </div>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Productos seleccionados */}
                  {Object.keys(selectedProducts).length > 0 && (
                    <div className="mb-3 space-y-2">
                      {Object.entries(selectedProducts).map(([productId, data]) => {
                        const product = products.find(p => p.id === parseInt(productId));
                        if (!product) return null;
                        return (
                          <div key={productId} className="flex items-center justify-between p-2 bg-background-secondary rounded-lg">
                            <div className="flex-1">
                              <div className={`text-sm font-medium ${textColor}`}>{product.name}</div>
                              <div className={`text-xs ${subtextColor}`}>
                                ${data.price.toLocaleString("es-AR", { minimumFractionDigits: 2 })} x {data.quantity}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => updateProductQuantity(productId, -1)}
                                className="p-1 rounded hover:bg-background"
                              >
                                <Minus className="w-4 h-4" />
                              </button>
                              <span className="text-sm w-8 text-center">{data.quantity}</span>
                              <button
                                type="button"
                                onClick={() => updateProductQuantity(productId, 1)}
                                className="p-1 rounded hover:bg-background"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeProduct(productId)}
                                className="p-1 rounded hover:bg-red-100 text-red-600"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Resumen */}
                  <div className="mb-3 pt-3 border-t border-border">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium">Servicio:</span>
                      <span className="text-sm">
                        ${selectedService?.price_decimal ? Number(selectedService.price_decimal).toLocaleString("es-AR", { minimumFractionDigits: 2 }) : "0.00"}
                      </span>
                    </div>
                    {Object.keys(selectedProducts).length > 0 && (
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium">Productos:</span>
                        <span className="text-sm">
                          ${Object.entries(selectedProducts).reduce((sum, [_, data]) => sum + (data.price * data.quantity), 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-2 border-t border-border">
                      <span className="font-semibold">Total:</span>
                      <span className="font-bold text-lg">
                        ${calculateInvoiceTotal().toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        setInvoiceUI({ visible: false });
                        setSelectedProducts({});
                        setProductSearch("");
                      }} 
                      className={`px-3 py-1.5 rounded-lg text-sm ${buttonSecondary} border flex-1`} 
                      disabled={invoiceLoading}
                    >
                      Cerrar
                    </button>
                    <button
                      onClick={handleInvoice}
                      className={`px-3 py-1.5 rounded-lg text-sm ${buttonPrimary} text-white flex-1`}
                      disabled={invoiceLoading || !a.id}
                    >
                      {invoiceLoading ? "Facturando…" : "Facturar"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          </div>
        )}

        {/* Mensajes - siempre visibles */}


        {/* Mensajes */}
        {msg && (
          <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 p-3 text-sm">
            {msg}
          </div>
        )}
        {error && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 text-red-700 p-3 text-sm">
            {error}
          </div>
        )}

        {/* Footer - siempre visible */}
        <div className="flex flex-wrap gap-2 pt-4 border-t" style={{ borderColor: darkMode ? "#165273" : "#e5e7eb" }}>
          <div className="flex-1" />
          <button onClick={() => onClose?.()} disabled={saving} className={`px-4 py-2 rounded-xl text-sm ${buttonSecondary} border`}>
            Cerrar
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className={`px-4 py-2 rounded-xl text-sm ${buttonPrimary} text-white flex items-center gap-2`}
          >
            <Save className="w-4 h-4" />
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {/* Confirm Dialog */}
      {confirmUI.open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.6)",
            zIndex: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(4px)",
          }}
        >
          <div className={`${modalBg} rounded-2xl shadow-2xl p-6`} style={{ width: 420, maxWidth: "90vw" }}>
            <div className={`font-bold text-lg mb-2 ${textColor}`}>{confirmUI.title}</div>
            <div className={`text-sm ${subtextColor} mb-4`}>{confirmUI.message}</div>
            <div className="flex justify-end gap-2">
              <button onClick={closeConfirm} className={`px-4 py-2 rounded-xl text-sm ${buttonSecondary} border`} disabled={saving}>
                {confirmUI.cancelText}
              </button>
              <button
                onClick={confirmUI.onConfirm}
                className={`px-4 py-2 rounded-xl text-sm ${buttonPrimary} text-white`}
                disabled={saving}
              >
                {saving ? "Procesando…" : confirmUI.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
