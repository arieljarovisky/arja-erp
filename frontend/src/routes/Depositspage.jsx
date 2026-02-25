// src/routes/DepositsPage.jsx - Versión corregida
import React, { useEffect, useState } from "react";
import { useQuery } from "../shared/useQuery.js";
import { apiClient } from "../api/client";
import {
  DollarSign,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  Users,
  Calendar,
  RefreshCw,
  Eye,
  EyeOff,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ============================================
// COMPONENTES DE UI
// ============================================

function StatCard({ icon: Icon, title, value, subtitle, trend, color = "primary" }) {
  const colorClasses = {
    primary: "from-primary-600/20 to-primary-600/5 border-primary-600/30",
    success: "from-emerald-600/20 to-emerald-600/5 border-emerald-600/30",
    warning: "from-amber-600/20 to-amber-600/5 border-amber-600/30",
    danger: "from-red-600/20 to-red-600/5 border-red-600/30",
  };

  const iconColorClasses = {
    primary: "text-primary-400",
    success: "text-emerald-400",
    warning: "text-amber-400",
    danger: "text-red-400",
  };

  return (
    <div className="card p-6 hover:scale-[1.02] transition-transform">
      <div className="flex items-start justify-between mb-4">
        <div className={`p-3 rounded-xl bg-gradient-to-br ${colorClasses[color]} border`}>
          <Icon className={`w-6 h-6 ${iconColorClasses[color]}`} />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-medium ${
            trend > 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            <TrendingUp className={`w-3 h-3 ${trend < 0 ? 'rotate-180' : ''}`} />
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div>
        <p className="text-sm text-foreground-secondary mb-1">{title}</p>
        <p className="text-3xl font-bold text-foreground">{value}</p>
        {subtitle && <p className="text-xs text-foreground-muted mt-2">{subtitle}</p>}
      </div>
    </div>
  );
}

function UrgencyBadge({ urgency }) {
  const configs = {
    expired: { label: "Vencido", className: "badge-danger" },
    expiring: { label: "Por vencer", className: "badge-warning" },
    active: { label: "Activo", className: "badge-success" },
    paid: { label: "Pagado", className: "badge-success" },
  };

  const config = configs[urgency] || configs.active;
  return <span className={`badge ${config.className}`}>{config.label}</span>;
}

function DepositRow({ deposit, onAction, onRefresh }) {
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleAction = async (action) => {
    if (loading) return;

    const confirmations = {
      markPaid: "¿Marcar esta seña como paga?",
      cancel: "¿Cancelar este turno?",
      extend: "¿Extender el tiempo de hold por 30 minutos?",
    };

    if (confirmations[action] && !confirm(confirmations[action])) return;

    setLoading(true);
    try {
      await onAction(deposit.id, action);
      onRefresh();
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card p-4 mb-3 transition-all">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground truncate">
            {deposit.customer_name || "Sin nombre"}
          </div>
          <div className="text-xs text-foreground-muted flex items-center gap-2 mt-1">
            <Users className="w-3 h-3" />
            {deposit.phone_e164}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm text-foreground">{deposit.service_name || deposit.service}</div>
          <div className="text-xs text-foreground-muted flex items-center gap-2 mt-1">
            <Users className="w-3 h-3" />
            {deposit.instructor_name || deposit.instructor}
          </div>
        </div>

        <div className="w-32">
          <div className="text-sm font-bold text-emerald-400">
            ${Number(deposit.deposit_decimal || 0).toFixed(2)}
          </div>
          <div className="text-xs text-foreground-muted flex items-center gap-1 mt-1">
            <Calendar className="w-3 h-3" />
            {new Date(deposit.starts_at).toLocaleDateString("es-AR")}
          </div>
        </div>

        <div className="w-24">
          <UrgencyBadge urgency={deposit.urgency} />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-2 rounded-xl bg-background-secondary hover:bg-border/40 transition-all"
            title={expanded ? "Ocultar detalles" : "Ver detalles"}
          >
            {expanded ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>

          {deposit.urgency !== "expired" && deposit.status !== 'deposit_paid' && deposit.status !== 'confirmed' && (
            <>
              <button
                onClick={() => handleAction("markPaid")}
                disabled={loading}
                className="btn-success text-xs px-3 py-2 disabled:opacity-50"
                title="Marcar como paga"
              >
                <CheckCircle2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleAction("extend")}
                disabled={loading}
                className="btn-secondary text-xs px-3 py-2 disabled:opacity-50"
                title="Extender tiempo"
              >
                <Clock className="w-4 h-4" />
              </button>
            </>
          )}
          
          <button
            onClick={() => handleAction("cancel")}
            disabled={loading}
            className="btn-danger text-xs px-3 py-2 disabled:opacity-50"
            title="Cancelar turno"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-border/40 grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-foreground-secondary mb-1">Hora del turno</div>
            <div className="text-foreground font-medium">
              {new Date(deposit.starts_at).toLocaleTimeString("es-AR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
          <div>
            <div className="text-foreground-secondary mb-1">Estado del pago</div>
            <div className="text-foreground font-medium">
              {deposit.status === 'deposit_paid' || deposit.status === 'confirmed' 
                ? 'Pagado' 
                : deposit.urgency === 'expired' 
                ? 'Vencido' 
                : 'Pendiente'}
              {deposit.deposit_paid_at && (
                <div className="text-xs text-foreground-muted mt-1">
                  {new Date(deposit.deposit_paid_at).toLocaleString("es-AR")}
                </div>
              )}
            </div>
          </div>
          <div>
            <div className="text-foreground-secondary mb-1">ID del turno</div>
            <div className="text-foreground font-medium font-mono text-xs">#{deposit.id}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// COMPONENTE PRINCIPAL
// ============================================

export default function DepositsPage() {
  const [includeExpired, setIncludeExpired] = useState(true); // Mostrar pendientes incluyendo vencidas
  const [refreshKey, setRefresh] = useState(0);
  
  // Filtros y paginado
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // "all", "active", "expired", "paid"
  const [includePaid, setIncludePaid] = useState(false); // Incluir depósitos pagados
  const [serviceId, setServiceId] = useState("");
  const [instructorId, setInstructorId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Cargar servicios y estilistas para los filtros
  const { data: services } = useQuery(
    async () => {
      const { data } = await apiClient.get("/api/meta/services");
      return data.data || [];
    },
    []
  );

  const { data: instructors } = useQuery(
    async () => {
      const { data } = await apiClient.get("/api/meta/instructors");
      return data.data || [];
    },
    []
  );

  const { data: dashboard, loading: loadingDash } = useQuery(
    async () => {
      const { data } = await apiClient.get("/api/admin/deposits/dashboard");
      return data?.data || data || {};
    },
    [refreshKey]
  );

  const { data: depositsData, loading: loadingDeposits } = useQuery(
    async () => {
      const params = {
        includeExpired: includeExpired ? "true" : "false",
        includePaid: includePaid ? "true" : "false",
        page: page.toString(),
        limit: limit.toString(),
        status: statusFilter,
        ...(search && { search }),
        ...(serviceId && { serviceId }),
        ...(instructorId && { instructorId }),
        ...(fromDate && { fromDate }),
        ...(toDate && { toDate }),
      };
      
      const { data } = await apiClient.get("/api/admin/deposits/pending", { params });
      return data;
    },
    [includeExpired, includePaid, refreshKey, page, limit, search, statusFilter, serviceId, instructorId, fromDate, toDate]
  );

  const deposits = depositsData?.data || [];
  const pagination = depositsData?.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 };

  const handleAction = async (depositId, action) => {
    const endpoints = {
      markPaid: `/api/admin/deposits/${depositId}/confirm`,
      cancel: `/api/admin/deposits/${depositId}/cancel`,
      extend: `/api/admin/deposits/${depositId}/extend`,
      remind: `/api/admin/deposits/${depositId}/remind`,
    };

    await apiClient.post(endpoints[action]);
    // Refrescar inmediatamente después de la acción
    handleRefresh();
  };

  const handleRefresh = () => {
    setRefresh((k) => k + 1);
  };

  useEffect(() => {
    const interval = setInterval(handleRefresh, 30000);
    return () => clearInterval(interval);
  }, []);

  const stats = dashboard || {};

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Gestión de Señas</h1>
          <p className="text-foreground-secondary mt-1">
            Monitoreo en tiempo real de pagos del sistema
          </p>
        </div>
        <button onClick={handleRefresh} className="btn-primary">
          <RefreshCw className={`w-4 h-4 ${loadingDash ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          icon={Clock}
          title="Pendientes activas"
          value={stats.pending_count - (stats.expired_holds || 0) || 0}
          subtitle="En tiempo"
          color="success"
        />
        <StatCard
          icon={AlertTriangle}
          title="Vencidas"
          value={stats.expired_holds || 0}
          subtitle="Sin pagar"
          color="danger"
        />
        <StatCard
          icon={DollarSign}
          title="Dinero retenido"
          value={`$${(deposits || []).reduce((sum, d) => sum + Number(d.deposit_decimal || 0), 0).toFixed(0)}`}
          subtitle="En espera"
          color="warning"
        />
        <StatCard
          icon={CheckCircle2}
          title="Pagadas hoy"
          value={stats.today_paid || 0}
          subtitle="Últimas 24hs"
          color="primary"
        />
        <StatCard
          icon={XCircle}
          title="Total pagadas"
          value={stats.paid_count || 0}
          subtitle="Historial"
          color="primary"
        />
      </div>

      {/* Expiring Soon Alert */}
      {dashboard?.expiringSoon?.length > 0 && (
        <div className="card p-4 border-2 border-amber-600/30 bg-amber-600/10">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-amber-300 mb-2">
                ¡{dashboard.expiringSoon.length} turno(s) próximos a vencer!
              </div>
              <div className="text-sm text-amber-200 space-y-1">
                {dashboard.expiringSoon.map((appt) => (
                  <div key={appt.id}>
                    • {appt.customer_name} - {appt.service_name} (vence en{" "}
                    {appt.minutes_left} min)
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Payments */}
      {dashboard?.recentPayments?.length > 0 && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            Pagos recientes (24hs)
          </h2>
          <div className="space-y-2 text-sm">
            {dashboard.recentPayments.map((payment) => (
              <div
                key={payment.id}
                className="flex justify-between py-2 border-b border-border/40 last:border-0"
              >
                <div>
                  <span className="font-medium text-foreground">
                    {payment.customer_name}
                  </span>
                  {" • "}
                  <span className="text-foreground-secondary">{payment.service_name}</span>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-emerald-400">
                    ${Number(payment.deposit_decimal || 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-foreground-muted">
                    {new Date(payment.deposit_paid_at).toLocaleTimeString(
                      "es-AR",
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                      }
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending Deposits */}
        <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">
            {statusFilter === "paid" 
              ? `Señas pagadas (${pagination.total || 0})`
              : includePaid || statusFilter === "all"
              ? `Señas (${pagination.total || 0})`
              : `Señas pendientes (${pagination.total || 0})`}
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                const ok = confirm("¿Limpiar turnos cancelados y pendientes vencidos?");
                if (!ok) return;
                try {
                  await apiClient.post("/api/admin/deposits/cleanup");
                  handleRefresh();
                } catch (e) {
                  alert(e.response?.data?.error || e.message);
                }
              }}
              className="btn-danger text-xs px-3 py-2"
            >
              Limpiar cancelados/vencidos
            </button>
            <label className="flex items-center gap-2 text-sm text-foreground-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={includeExpired}
                onChange={(e) => {
                  setIncludeExpired(e.target.checked);
                  setPage(1);
                }}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
              />
              Incluir vencidas
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={includePaid}
                onChange={(e) => {
                  setIncludePaid(e.target.checked);
                  setPage(1);
                }}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
              />
              Incluir pagadas
            </label>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="btn-secondary text-xs px-3 py-2 flex items-center gap-2"
            >
              <Filter className="w-4 h-4" />
              Filtros
            </button>
          </div>
        </div>

        {/* Filtros */}
        {showFilters && (
          <div className="mb-6 p-6 rounded-xl border border-border bg-background-secondary space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Búsqueda */}
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-foreground-secondary mb-2">
                  Búsqueda
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Cliente, teléfono, servicio..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-background border border-border text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-200"
                  />
                </div>
              </div>

              {/* Estado */}
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-2">
                  Estado
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  className="w-full px-4 py-2.5 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-200 text-sm sm:text-base appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 9L1 4h10z'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 1rem center',
                    paddingRight: '2.5rem'
                  }}
                >
                  <option value="all">Todos</option>
                  <option value="active">Activas</option>
                  <option value="expired">Vencidas</option>
                  <option value="paid">Pagadas</option>
                </select>
              </div>

              {/* Items por página */}
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-2">
                  Por página
                </label>
                <select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                  className="w-full px-4 py-2.5 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-200 text-sm sm:text-base appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 9L1 4h10z'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 1rem center',
                    paddingRight: '2.5rem'
                  }}
                >
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>

              {/* Servicio */}
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-2">
                  Servicio
                </label>
                <select
                  value={serviceId}
                  onChange={(e) => {
                    setServiceId(e.target.value);
                    setPage(1);
                  }}
                  className="w-full px-4 py-2.5 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-200 text-sm sm:text-base appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 9L1 4h10z'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 1rem center',
                    paddingRight: '2.5rem'
                  }}
                >
                  <option value="">Todos</option>
                  {services?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Estilista */}
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-2">
                  Estilista
                </label>
                <select
                  value={instructorId}
                  onChange={(e) => {
                    setInstructorId(e.target.value);
                    setPage(1);
                  }}
                  className="w-full px-4 py-2.5 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-200 text-sm sm:text-base appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 9L1 4h10z'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 1rem center',
                    paddingRight: '2.5rem'
                  }}
                >
                  <option value="">Todos</option>
                  {instructors?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Fecha desde */}
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-2">
                  Desde
                </label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setPage(1);
                  }}
                  className="w-full px-4 py-2.5 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-200"
                />
              </div>

              {/* Fecha hasta */}
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-2">
                  Hasta
                </label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setPage(1);
                  }}
                  className="w-full px-4 py-2.5 rounded-lg bg-background-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-200"
                />
              </div>
            </div>

            {/* Botón limpiar filtros */}
            <div className="flex justify-end pt-2 border-t border-border">
              <button
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setServiceId("");
                  setInstructorId("");
                  setFromDate("");
                  setToDate("");
                  setPage(1);
                }}
                className="text-sm text-foreground-muted hover:text-foreground transition-colors duration-200 font-medium"
              >
                Limpiar filtros
              </button>
            </div>
          </div>
        )}

        {loadingDeposits ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : !deposits || deposits.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-emerald-400" />
            <p className="text-foreground-secondary">✅ No hay señas pendientes</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {deposits.map((deposit) => (
                <DepositRow
                  key={deposit.id}
                  deposit={deposit}
                  onAction={handleAction}
                  onRefresh={handleRefresh}
                />
              ))}
            </div>

            {/* Paginado */}
            {pagination.totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between">
                <div className="text-sm text-foreground-secondary">
                  Mostrando {(page - 1) * limit + 1} - {Math.min(page * limit, pagination.total)} de {pagination.total}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-2 rounded-lg bg-background-secondary hover:bg-border/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                      let pageNum;
                      if (pagination.totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (page <= 3) {
                        pageNum = i + 1;
                      } else if (page >= pagination.totalPages - 2) {
                        pageNum = pagination.totalPages - 4 + i;
                      } else {
                        pageNum = page - 2 + i;
                      }
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setPage(pageNum)}
                          className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                            page === pageNum
                              ? "bg-primary text-white"
                              : "bg-background-secondary hover:bg-border/40 text-foreground-secondary"
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  
                  <button
                    onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                    disabled={page === pagination.totalPages}
                    className="p-2 rounded-lg bg-background-secondary hover:bg-border/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
