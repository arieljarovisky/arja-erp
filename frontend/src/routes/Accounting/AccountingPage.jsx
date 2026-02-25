import { useState, useEffect } from "react";
import { useQuery } from "../../shared/useQuery.js";
import { apiClient } from "../../api";
import {
  DollarSign,
  Receipt,
  CreditCard,
  Calendar,
  Search,
  Filter,
  RefreshCw,
  Eye,
  FileText,
  Package,
  Clock,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export default function AccountingPage() {
  const [search, setSearch] = useState("");
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date();
    date.setDate(1); // Primer día del mes
    return date.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [typeFilter, setTypeFilter] = useState("all"); // all, deposits, cash, invoices
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  // Cargar señas
  const { data: depositsData, loading: loadingDeposits, refetch: refetchDeposits } = useQuery(
    async () => {
      const params = {
        from: dateFrom,
        to: dateTo,
        status: "all",
        includeExpired: true,
        includePaid: true,
        includeCancelled: true,
      };
      const { data } = await apiClient.get("/api/admin/deposits/pending", { params });
      return data;
    },
    [dateFrom, dateTo]
  );

  // Cargar cierres de caja
  const { data: closuresData, loading: loadingClosures, refetch: refetchClosures } = useQuery(
    async () => {
      const params = {
        from: dateFrom,
        to: dateTo,
      };
      const { data } = await apiClient.get("/api/cash-register/closures", { params });
      return data;
    },
    [dateFrom, dateTo]
  );

  // Cargar facturas
  const { data: invoicesData, loading: loadingInvoices, refetch: refetchInvoices } = useQuery(
    async () => {
      const params = {
        from: dateFrom,
        to: dateTo,
      };
      const { data } = await apiClient.get("/api/invoicing/invoices", { params });
      return data;
    },
    [dateFrom, dateTo]
  );
  // Cargar pagos (Mercado Pago) para reflejar creación de links de seña
  const { data: paymentsData, loading: loadingPayments, refetch: refetchPayments } = useQuery(
    async () => {
      const params = {
        from: dateFrom,
        to: dateTo,
        method: "mercadopago",
      };
      const { data } = await apiClient.get("/api/payments", { params });
      return data;
    },
    [dateFrom, dateTo]
  );

  const deposits = depositsData?.data || [];
  const closures = closuresData?.data || [];
  const invoices = invoicesData?.data || [];
  const payments = paymentsData?.data || [];

  // Función auxiliar para validar y normalizar fechas
  const normalizeDate = (dateValue) => {
    if (!dateValue) return new Date().toISOString();
    const date = new Date(dateValue);
    return isNaN(date.getTime()) ? new Date().toISOString() : dateValue;
  };
  // Parse "YYYY-MM-DD HH:mm:ss" como hora local (Argentina) sin aplicar timezone implícito del navegador
  const parseMySQLLocalDate = (s) => {
    if (!s || typeof s !== "string") {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6] || 0);
    return new Date(year, month, day, hour, minute, second);
  };

  // Función auxiliar para obtener timestamp válido para ordenamiento
  const getDateTimestamp = (dateValue) => {
    if (!dateValue) return 0;
    const date = new Date(dateValue);
    return isNaN(date.getTime()) ? 0 : date.getTime();
  };

  // Combinar todos los registros
  const allRecords = [
    ...deposits.map(d => ({
      id: `deposit-${d.id}`,
      type: "deposit",
      typeLabel: "Seña",
      date: normalizeDate(d.created_at || d.createdAt),
      amount: parseFloat(d.deposit_decimal || d.amount || 0),
      customer: d.customer_name || d.customer?.name || "Sin cliente",
      description: `Seña para turno ${d.appointment_id || ""}`,
      status: (() => {
        const isPaid = Boolean(d.deposit_paid_at) || ["deposit_paid","confirmed","completed"].includes(String(d.status || "").toLowerCase());
        const isExpired = !isPaid && d.hold_until && parseMySQLLocalDate(d.hold_until) < new Date();
        if (String(d.status).toLowerCase() === "cancelled") return "cancelled";
        if (isPaid) return "paid";
        if (isExpired) return "expired";
        return "pending";
      })(),
      statusLabel: (() => {
        const isPaid = Boolean(d.deposit_paid_at) || ["deposit_paid","confirmed","completed"].includes(String(d.status || "").toLowerCase());
        const isExpired = !isPaid && d.hold_until && parseMySQLLocalDate(d.hold_until) < new Date();
        if (isPaid) return "Pagado";
        if (isExpired) return "Vencido";
        if (String(d.status).toLowerCase() === "cancelled") return "Cancelado";
        return "Pendiente";
      })(),
      paymentMethod: d.payment_method || "N/A",
      data: d,
    })),
    ...closures.flatMap(c => {
      const records = [];
      if (c.cash_total > 0) {
        records.push({
          id: `cash-${c.id}-cash`,
          type: "cash",
          typeLabel: "Efectivo",
          date: normalizeDate(c.closure_date || c.created_at),
          amount: parseFloat(c.cash_total || 0),
          customer: "Caja",
          description: `Cierre de caja - ${c.branch_name || ""}`,
          status: c.status || "closed",
          statusLabel: c.status === "closed" ? "Cerrado" : "Abierto",
          paymentMethod: "Efectivo",
          data: c,
        });
      }
      if (c.card_total > 0) {
        records.push({
          id: `cash-${c.id}-card`,
          type: "cash",
          typeLabel: "Tarjeta",
          date: normalizeDate(c.closure_date || c.created_at),
          amount: parseFloat(c.card_total || 0),
          customer: "Caja",
          description: `Cierre de caja - ${c.branch_name || ""}`,
          status: c.status || "closed",
          statusLabel: c.status === "closed" ? "Cerrado" : "Abierto",
          paymentMethod: "Tarjeta",
          data: c,
        });
      }
      return records;
    }),
    ...invoices.map(i => ({
      id: `invoice-${i.id}`,
      type: "invoice",
      typeLabel: "Factura",
      date: normalizeDate(i.fecha_emision || i.fecha || i.created_at),
      amount: parseFloat(i.importe_total || i.total || 0),
      customer: i.customer_name || i.customer?.name || i.razon_social || "Consumidor Final",
      description: `Factura ${i.numero_comprobante || i.numero || ""}`,
      status: i.status || "draft",
      statusLabel: i.status === "approved" ? "Aprobada" : i.status === "rejected" ? "Rechazada" : "Borrador",
      paymentMethod: "Facturación",
      data: i,
    })),
    // Pagos de Mercado Pago como señas (reflejan creación de link)
    ...payments.map(p => ({
      id: `payment-${p.id}`,
      type: "deposit",
      typeLabel: "Seña (MP)",
      date: normalizeDate(p.created_at),
      amount: Number(p.amount || p.amount_cents / 100 || 0),
      customer: p.customer_name || "Sin cliente",
      description: `Seña - ${p.service_name || "Servicio"}`,
      status: p.mp_payment_status || "pending",
      statusLabel: p.mp_payment_status === "approved" ? "Pagado" : p.mp_payment_status === "rejected" ? "Rechazado" : "Pendiente",
      paymentMethod: "Mercado Pago",
      data: p,
    })),
  ].sort((a, b) => getDateTimestamp(b.date) - getDateTimestamp(a.date));

  // Filtrar registros
  const filteredRecords = allRecords.filter(record => {
    const matchesSearch = !search || 
      record.customer.toLowerCase().includes(search.toLowerCase()) ||
      record.description.toLowerCase().includes(search.toLowerCase());
    
    const matchesType = typeFilter === "all" || record.type === typeFilter;
    
    const matchesStatus = statusFilter === "all" || 
      (statusFilter === "paid" && record.status === "paid") ||
      (statusFilter === "pending" && (record.status === "pending" || record.status === "open")) ||
      (statusFilter === "closed" && record.status === "closed") ||
      (statusFilter === "approved" && record.status === "approved") ||
      (statusFilter === "expired" && record.status === "expired") ||
      (statusFilter === "cancelled" && record.status === "cancelled");

    return matchesSearch && matchesType && matchesStatus;
  });

  // Paginación
  const totalPages = Math.ceil(filteredRecords.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedRecords = filteredRecords.slice(startIndex, endIndex);

  // Resetear página cuando cambian los filtros
  useEffect(() => {
    setCurrentPage(1);
  }, [search, typeFilter, statusFilter, dateFrom, dateTo]);

  // Calcular totales
  const totals = filteredRecords.reduce((acc, record) => {
    if (record.status !== "cancelled" && record.status !== "rejected") {
      acc.total += record.amount;
      if (record.type === "deposit") acc.deposits += record.amount;
      if (record.type === "cash") acc.cash += record.amount;
      if (record.type === "invoice") acc.invoices += record.amount;
    }
    return acc;
  }, { total: 0, deposits: 0, cash: 0, invoices: 0 });

  const loading = loadingDeposits || loadingClosures || loadingInvoices || loadingPayments;

  const handleRefresh = () => {
    refetchDeposits();
    refetchClosures();
    refetchInvoices();
    refetchPayments();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Registro Contable</h1>
          <p className="text-foreground-muted mt-1">
            Visualización unificada de señas, pagos en efectivo y facturas
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="btn-ghost btn--compact"
          disabled={loading}
          title="Actualizar"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Estadísticas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground-muted">Total General</p>
              <p className="text-2xl font-bold text-foreground mt-1">
                ${totals.total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
              </p>
            </div>
            <DollarSign className="w-8 h-8 text-primary" />
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground-muted">Señas</p>
              <p className="text-2xl font-bold text-foreground mt-1">
                ${totals.deposits.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
              </p>
            </div>
            <Clock className="w-8 h-8 text-amber-500" />
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground-muted">Efectivo/Tarjeta</p>
              <p className="text-2xl font-bold text-foreground mt-1">
                ${totals.cash.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
              </p>
            </div>
            <CreditCard className="w-8 h-8 text-green-500" />
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground-muted">Facturas</p>
              <p className="text-2xl font-bold text-foreground mt-1">
                ${totals.invoices.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
              </p>
            </div>
            <FileText className="w-8 h-8 text-blue-500" />
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-foreground mb-2">
              Buscar
            </label>
            <div className="input-group">
              <span className="input-group__icon">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cliente, descripción..."
                className="input input--with-icon"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Tipo
            </label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="input"
            >
              <option value="all">Todos</option>
              <option value="deposit">Señas</option>
              <option value="cash">Efectivo/Tarjeta</option>
              <option value="invoice">Facturas</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Estado
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input"
            >
              <option value="all">Todos</option>
              <option value="paid">Pagado</option>
              <option value="pending">Pendiente</option>
              <option value="closed">Cerrado</option>
              <option value="approved">Aprobado</option>
              <option value="expired">Vencido</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Desde
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Hasta
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="input"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tabla de registros */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-4 text-sm font-medium text-foreground">Fecha</th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Tipo</th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Cliente</th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Descripción</th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Método de Pago</th>
                <th className="text-right p-4 text-sm font-medium text-foreground">Monto</th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Estado</th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" className="p-8 text-center text-foreground-muted">
                    Cargando registros...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan="8" className="p-8 text-center text-foreground-muted">
                    No se encontraron registros para los filtros seleccionados
                  </td>
                </tr>
              ) : (
                paginatedRecords.map((record) => {
                  // Validar fecha antes de formatear
                  const recordDate = record.date ? new Date(record.date) : new Date();
                  const localRecordDate = parseMySQLLocalDate(record.date) || recordDate;
                  const isValidDate = !isNaN(localRecordDate.getTime());
                  
                  return (
                  <tr key={record.id} className="border-b border-border hover:bg-background-secondary">
                    <td className="p-4 text-sm text-foreground">
                      {isValidDate 
                        ? format(localRecordDate, "dd/MM/yyyy HH:mm", { locale: es })
                        : "Fecha inválida"}
                    </td>
                    <td className="p-4">
                      <span className={`badge ${
                        record.type === "deposit" ? "badge-warning" :
                        record.type === "cash" ? "badge-success" :
                        "badge-primary"
                      }`}>
                        {record.typeLabel}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-foreground">{record.customer}</td>
                    <td className="p-4 text-sm text-foreground">{record.description}</td>
                    <td className="p-4 text-sm text-foreground-muted">{record.paymentMethod}</td>
                    <td className="p-4 text-right text-sm font-medium text-foreground">
                      ${record.amount.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4">
                      <span className={`badge ${
                        record.status === "paid" || record.status === "approved" || record.status === "closed" 
                          ? "badge-success" 
                          : record.status === "cancelled" || record.status === "rejected" || record.status === "expired"
                          ? "badge-danger"
                          : "badge-warning"
                      }`}>
                        {record.statusLabel}
                      </span>
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => setSelectedRecord(record)}
                        className="btn-ghost btn--compact"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {filteredRecords.length > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-border">
            <div className="flex items-center gap-4">
              <span className="text-sm text-foreground-muted">
                Mostrando {startIndex + 1} - {Math.min(endIndex, filteredRecords.length)} de {filteredRecords.length} registros
              </span>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="input text-sm"
              >
                <option value={25}>25 por página</option>
                <option value={50}>50 por página</option>
                <option value={100}>100 por página</option>
                <option value={200}>200 por página</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="btn-ghost btn--compact disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                        currentPage === pageNum
                          ? "bg-primary text-white"
                          : "bg-background-secondary text-foreground hover:bg-border"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="btn-ghost btn--compact disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedRecord(null)} />
          <div className="relative bg-background rounded-xl border border-border shadow-xl w-full max-w-2xl">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4" />
                <span className="text-sm font-medium text-foreground">Detalles de la transacción</span>
              </div>
              <button className="btn-ghost btn--compact" onClick={() => setSelectedRecord(null)}>Cerrar</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-foreground-muted">Fecha</p>
                  <p className="text-sm text-foreground">
                    {selectedRecord.date && !isNaN(new Date(selectedRecord.date).getTime())
                      ? format(new Date(selectedRecord.date), "dd/MM/yyyy HH:mm", { locale: es })
                      : "Fecha inválida"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Tipo</p>
                  <p className="text-sm text-foreground">{selectedRecord.typeLabel}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Cliente</p>
                  <p className="text-sm text-foreground">{selectedRecord.customer}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Estado</p>
                  <p className="text-sm text-foreground">{selectedRecord.statusLabel}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Método de pago</p>
                  <p className="text-sm text-foreground">{selectedRecord.paymentMethod}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Monto</p>
                  <p className="text-sm text-foreground">
                    ${selectedRecord.amount.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Descripción</p>
                <p className="text-sm text-foreground">{selectedRecord.description}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-2">Detalles específicos</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(() => {
                    const d = selectedRecord.data || {};
                    const safeNum = (v) => Number(v || 0);
                    const safeDate = (v) => v ? format(new Date(v), "dd/MM/yyyy HH:mm", { locale: es }) : "—";
                    const items = [];
                    if (selectedRecord.type === "deposit") {
                      items.push({ k: "Turno", v: d.id ? `#${d.id}` : "—" });
                      items.push({ k: "Servicio", v: d.service_name || d.service || "—" });
                      items.push({ k: "Profesional", v: d.instructor_name || d.instructor || "—" });
                      items.push({ k: "Cliente", v: selectedRecord.customer || d.customer_name || "—" });
                      items.push({ k: "Teléfono", v: d.phone_e164 || "—" });
                      items.push({ k: "Seña", v: `$${safeNum(d.deposit_decimal).toLocaleString("es-AR", { minimumFractionDigits: 2 })}` });
                      items.push({ k: "Estado de seña", v: (d.status === "deposit_paid" || d.status === "confirmed") ? "Pagado" : (d.hold_until && new Date(d.hold_until) < new Date() ? "Vencido" : "Pendiente") });
                      items.push({ k: "Hold hasta", v: safeDate(d.hold_until) });
                      items.push({ k: "Seña pagada", v: safeDate(d.deposit_paid_at) });
                      items.push({ k: "Horario del turno", v: safeDate(d.starts_at) });
                    } else if (selectedRecord.type === "cash") {
                      items.push({ k: "Cierre", v: d.id ? `#${d.id}` : "—" });
                      items.push({ k: "Sucursal", v: d.branch_name || "—" });
                      items.push({ k: "Fecha cierre", v: safeDate(d.closure_date || d.created_at) });
                      items.push({ k: "Total efectivo", v: `$${safeNum(d.cash_total).toLocaleString("es-AR", { minimumFractionDigits: 2 })}` });
                      items.push({ k: "Total tarjeta", v: `$${safeNum(d.card_total).toLocaleString("es-AR", { minimumFractionDigits: 2 })}` });
                      items.push({ k: "Estado", v: d.status || "—" });
                    } else if (selectedRecord.type === "invoice") {
                      items.push({ k: "Comprobante", v: d.numero_comprobante || d.numero || "—" });
                      items.push({ k: "Fecha", v: safeDate(d.fecha_emision || d.fecha || d.created_at) });
                      items.push({ k: "Cliente", v: d.customer_name || d.razon_social || "Consumidor Final" });
                      items.push({ k: "CUIT/DNI", v: d.documento || d.cuit || "—" });
                      items.push({ k: "Total", v: `$${safeNum(d.importe_total || d.total).toLocaleString("es-AR", { minimumFractionDigits: 2 })}` });
                      items.push({ k: "Estado", v: d.status || "—" });
                      items.push({ k: "CAE", v: d.cae || "—" });
                    } else {
                      Object.keys(d).slice(0, 10).forEach((key) => {
                        const val = d[key];
                        items.push({ k: key, v: typeof val === "string" ? val : JSON.stringify(val) });
                      });
                    }
                    return items.map(({ k, v }) => (
                      <div key={k} className="flex items-center justify-between rounded-lg border border-border bg-background-secondary px-3 py-2">
                        <span className="text-xs text-foreground-muted">{k}</span>
                        <span className="text-sm text-foreground">{v}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-border flex justify-end">
              <button className="btn-primary" onClick={() => setSelectedRecord(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

