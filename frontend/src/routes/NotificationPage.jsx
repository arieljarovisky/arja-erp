// src/routes/NotificationsPage.jsx - Con paginado superior/inferior y botón de limpiar
import { useEffect, useState, useRef } from "react";
import { apiClient } from "../api/client";
import { toast } from "sonner";
import { logger } from "../utils/logger.js";
import {
  Bell,
  Check,
  CheckCheck,
  Trash2,
  RefreshCw,
  Calendar,
  DollarSign,
  AlertTriangle,
  Info,
  X,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eraser
} from "lucide-react";

// Configuración de iconos y colores por tipo de notificación
const NOTIFICATION_CONFIG = {
  new_appointment: {
    icon: Calendar,
    color: "from-primary-600/20 to-primary-600/5 border-primary-600/30",
    iconColor: "text-primary-400",
  },
  appointment_created: {
    icon: Calendar,
    color: "from-primary-600/20 to-primary-600/5 border-primary-600/30",
    iconColor: "text-primary-400",
  },
  appointment_reserved: {
    icon: Calendar,
    color: "from-primary-600/20 to-primary-600/5 border-primary-600/30",
    iconColor: "text-primary-400",
  },
  deposit_paid: {
    icon: DollarSign,
    color: "from-emerald-600/20 to-emerald-600/5 border-emerald-600/30",
    iconColor: "text-emerald-400",
  },
  appointment_cancelled: {
    icon: X,
    color: "from-red-600/20 to-red-600/5 border-red-600/30",
    iconColor: "text-red-400",
  },
  deposit_pending: {
    icon: AlertTriangle,
    color: "from-amber-600/20 to-amber-600/5 border-amber-600/30",
    iconColor: "text-amber-400",
  },
  deposit_expired: {
    icon: AlertTriangle,
    color: "from-amber-600/20 to-amber-600/5 border-amber-600/30",
    iconColor: "text-amber-400",
  },
  stock_movement: {
    icon: RefreshCw,
    color: "from-blue-600/20 to-blue-600/5 border-blue-600/30",
    iconColor: "text-blue-400",
  },
  stock_alert: {
    icon: AlertTriangle,
    color: "from-amber-600/20 to-amber-600/5 border-amber-600/30",
    iconColor: "text-amber-400",
  },
  default: {
    icon: Info,
    color: "from-slate-600/20 to-slate-600/5 border-slate-600/30",
    iconColor: "text-slate-400",
  },
};

function pickConfigForNotification(notification) {
  const typeKey = String(notification?.type || "").toLowerCase();
  let cfg = NOTIFICATION_CONFIG[typeKey] || NOTIFICATION_CONFIG.default;
  if (cfg === NOTIFICATION_CONFIG.default) {
    const title = String(notification?.title || "").toLowerCase();
    const msg = String(notification?.message || "").toLowerCase();
    const txt = `${title} ${msg}`;
    if (txt.includes("turno") || txt.includes("reserva") || txt.includes("reservado")) {
      cfg = NOTIFICATION_CONFIG.appointment_reserved;
    } else if (txt.includes("cancel")) {
      cfg = NOTIFICATION_CONFIG.appointment_cancelled;
    } else if (txt.includes("seña pag") || txt.includes("deposit") && txt.includes("paid")) {
      cfg = NOTIFICATION_CONFIG.deposit_paid;
    } else if (txt.includes("seña") || txt.includes("deposit") || txt.includes("pendiente")) {
      cfg = NOTIFICATION_CONFIG.deposit_pending;
    } else if (txt.includes("stock") && txt.includes("alert")) {
      cfg = NOTIFICATION_CONFIG.stock_alert;
    } else if (txt.includes("stock")) {
      cfg = NOTIFICATION_CONFIG.stock_movement;
    }
  }
  return cfg;
}

function NotificationCard({ notification, onMarkRead, onDelete, onRefresh }) {
  const [loading, setLoading] = useState(false);
  const config = pickConfigForNotification(notification);
  const Icon = config.icon;

  const handleMarkRead = async () => {
    if (loading || notification.is_read) return;
    setLoading(true);
    try {
      await onMarkRead(notification.id);
      onRefresh();
      toast.success("Notificación marcada como leída");
    } catch (error) {
      toast.error(error.message || "Error al marcar notificación");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = () => {
    if (loading) return;
    onDelete(notification);
  };

  return (
    <div
      className={`
        card p-4 transition-all hover:shadow-dark-lg
        ${!notification.is_read ? 'ring-2 ring-primary-500/30' : ''}
      `}
    >
      <div className="flex gap-4">
        {/* Icono */}
        <div className={`
          rounded-xl bg-gradient-to-br ${config.color} border flex-shrink-0
          flex items-center justify-center w-12 h-12
        `}>
          <Icon className={`w-6 h-6 ${config.iconColor}`} />
        </div>

        {/* Contenido */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              {notification.title}
              {!notification.is_read && (
                <span className="inline-block w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              )}
            </h3>
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs text-foreground-muted whitespace-nowrap">
                {formatRelativeTime(notification.created_at)}
              </span>
              <button
                onClick={handleDelete}
                disabled={loading}
                className="p-2 rounded-lg border border-border hover:bg-background-secondary text-foreground-muted"
                title="Eliminar"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <p className="text-sm text-foreground-secondary mb-3">
            {notification.message}
          </p>

          {/* Datos adicionales */}
          {notification.data && (
            <div className="text-xs text-foreground-muted mb-3">
              {notification.data.appointmentId && (
                <span>Turno #{notification.data.appointmentId}</span>
              )}
              {notification.data.productId && (
                <div className="flex items-center gap-2 mt-1">
                  <span>Producto ID: {notification.data.productId}</span>
                  {notification.data.branchId && (
                    <span>• Sucursal ID: {notification.data.branchId}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Acciones */}
          <div className="flex items-center gap-2">
            {!notification.is_read && (
              <button
                onClick={handleMarkRead}
                disabled={loading}
                className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1"
              >
                <Check className="w-3 h-3" />
                Marcar leída
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Componente de Paginación (ahora con variant para distinguir posición)
function Pagination({ currentPage, totalPages, totalItems, itemsPerPage, onPageChange, variant = "bottom", isSticky = false }) {
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  // Generar array de números de página para mostrar
  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    
    if (totalPages <= maxVisible) {
      // Mostrar todas las páginas
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Mostrar páginas con ellipsis
      if (currentPage <= 3) {
        // Cerca del inicio
        for (let i = 1; i <= 4; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        // Cerca del final
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
      } else {
        // En el medio
        pages.push(1);
        pages.push('...');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      }
    }
    
    return pages;
  };

  if (totalPages <= 1) return null;

  const stickyClass = isSticky 
    ? "sticky top-[4.5rem] z-40 bg-background/95 backdrop-blur-xl border-y border-border/40 shadow-lg" 
    : variant === "top" 
      ? "border-b border-border/40" 
      : "border-t border-border/40";

  return (
    <div className={`flex flex-col sm:flex-row items-center justify-between gap-4 py-4 px-4 ${stickyClass}`}>
      {/* Info de items */}
      <div className="text-sm text-foreground-secondary">
        Mostrando <span className="font-medium text-foreground">{startItem}</span> a{" "}
        <span className="font-medium text-foreground">{endItem}</span> de{" "}
        <span className="font-medium text-foreground">{totalItems}</span> notificaciones
      </div>

      {/* Controles de paginación */}
      <div className="flex items-center gap-2">
        {/* Primera página */}
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="p-2 rounded-lg border border-border hover:bg-background-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          title="Primera página"
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>

        {/* Página anterior */}
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="p-2 rounded-lg border border-border hover:bg-background-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          title="Página anterior"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Números de página */}
        <div className="hidden sm:flex items-center gap-1">
          {getPageNumbers().map((page, idx) => (
            page === '...' ? (
              <span key={`ellipsis-${idx}`} className="px-3 py-2 text-foreground-muted">
                ...
              </span>
            ) : (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                className={`
                  px-3 py-2 rounded-lg text-sm font-medium transition-all
                  ${currentPage === page
                    ? 'bg-gradient-primary text-white shadow-glow'
                    : 'border border-border hover:bg-background-secondary text-foreground-secondary'
                  }
                `}
              >
                {page}
              </button>
            )
          ))}
        </div>

        {/* Indicador móvil */}
        <div className="sm:hidden px-3 py-2 rounded-lg border border-border text-sm font-medium">
          {currentPage} / {totalPages}
        </div>

        {/* Página siguiente */}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="p-2 rounded-lg border border-border hover:bg-background-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          title="Página siguiente"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        {/* Última página */}
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="p-2 rounded-lg border border-border hover:bg-background-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          title="Última página"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | unread
  const [refreshKey, setRefreshKey] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [notificationToDelete, setNotificationToDelete] = useState(null);
  const topPaginationRef = useRef(null);
  
  // Estados de paginación
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  // Detectar scroll para hacer sticky el paginador superior
  useEffect(() => {
    const handleScroll = () => {
      if (topPaginationRef.current) {
        const rect = topPaginationRef.current.getBoundingClientRect();
        setIsScrolled(rect.top <= 72); // 72px es aproximadamente la altura del header
      }
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll(); // Verificar estado inicial
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const params = filter === "unread" ? "?unreadOnly=true" : "";
      const res = await apiClient.get(`/api/notifications${params}`);
      setNotifications(res.data?.data || []);
      // Reset a página 1 cuando cambia el filtro
      setCurrentPage(1);
    } catch (error) {
      toast.error("Error al cargar notificaciones");
      logger.error(error);
    } finally {
      setLoading(false);
    }
  };

  const loadUnreadCount = async () => {
    try {
      const result = await apiClient.getUnreadCount();
      setUnreadCount(result?.count || 0);
    } catch (error) {
      logger.error(error);
      setUnreadCount(0);
    }
  };

  useEffect(() => {
    loadNotifications();
    loadUnreadCount();
  }, [filter, refreshKey]);

  // Nota: El polling del contador se maneja globalmente en AppLayout
  // para evitar llamadas duplicadas y problemas de rate limiting

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  const handleMarkRead = async (id) => {
    await apiClient.put(`/api/notifications/${id}/read`);
  };

  const handleMarkAllRead = async () => {
    try {
      await apiClient.put("/api/notifications/read-all");
      toast.success("Todas las notificaciones marcadas como leídas");
      handleRefresh();
    } catch (error) {
      toast.error("Error al marcar todas las notificaciones");
    }
  };

  const requestDelete = (notification) => {
    setNotificationToDelete(notification);
    setShowDeleteModal(true);
  };

  const confirmDeleteOne = async () => {
    const notification = notificationToDelete;
    setShowDeleteModal(false);
    if (!notification) return;
    try {
      await apiClient.delete(`/api/notifications/${notification.id}`);
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
      if (!notification.is_read) {
        setUnreadCount((c) => Math.max(0, c - 1));
      }
      setCurrentPage((p) => {
        const newTotal = (notifications.length - 1);
        const newTotalPages = Math.max(1, Math.ceil(newTotal / itemsPerPage));
        return Math.min(p, newTotalPages);
      });
      toast.success("Notificación eliminada");
    } catch (error) {
      toast.error("Error al eliminar notificación");
    } finally {
      setNotificationToDelete(null);
    }
  };

  const handleDeleteAll = async () => {
    setShowConfirmModal(true);
  };

  const confirmDeleteAll = async () => {
    setShowConfirmModal(false);
    setLoading(true);
    
    try {
      // Eliminar todas las notificaciones actuales
      const deletePromises = notifications.map(notif => 
        apiClient.delete(`/api/notifications/${notif.id}`)
      );
      
      await Promise.all(deletePromises);
      
      toast.success(`${notifications.length} notificaciones eliminadas correctamente`);
      handleRefresh();
    } catch (error) {
      toast.error("Error al eliminar las notificaciones");
      logger.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Cálculos de paginación
  const totalItems = notifications.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentNotifications = notifications.slice(startIndex, endIndex);

  const handlePageChange = (page) => {
    setCurrentPage(page);
    // Scroll suave al inicio de la lista
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Modal de Confirmación para Limpiar Todo */}
      {showConfirmModal && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setShowConfirmModal(false)}
        >
          {/* Backdrop con blur */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          
          {/* Modal */}
          <div 
            className="relative w-full max-w-md transform transition-all"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card overflow-hidden border-2 border-red-500/30 shadow-[0_0_50px_rgba(239,68,68,0.3)]">
              {/* Header con gradiente */}
              <div className="relative bg-gradient-to-r from-red-600/20 to-red-500/10 p-6 border-b border-red-500/20">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(239,68,68,0.15),transparent_70%)]" />
                <div className="relative flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/30">
                    <AlertTriangle className="w-8 h-8 text-red-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-red-100 mb-1">
                      ¿Eliminar todas las notificaciones?
                    </h3>
                    <p className="text-sm text-red-200/80">
                      Esta acción no se puede deshacer
                    </p>
                  </div>
                </div>
              </div>

              {/* Contenido */}
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-center py-6">
                  <div className="text-center space-y-3">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 border-2 border-red-500/30 mb-2">
                      <Trash2 className="w-8 h-8 text-red-400" />
                    </div>
                    <div className="text-6xl font-bold text-gradient bg-gradient-to-r from-red-400 to-red-600 bg-clip-text text-transparent">
                      {notifications.length}
                    </div>
                    <p className="text-dark-600 font-medium">
                      notificaciones serán eliminadas permanentemente
                    </p>
                  </div>
                </div>

                {/* Lista de consecuencias */}
                <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4 space-y-2">
                  <p className="text-sm text-dark-700 font-medium mb-2">Esto incluye:</p>
                  <div className="space-y-1.5 text-sm text-dark-600">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      <span>{unreadCount} notificaciones sin leer</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      <span>{notifications.length - unreadCount} notificaciones leídas</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      <span>Todo el historial de notificaciones</span>
                    </div>
                  </div>
                </div>

                {/* Warning adicional */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-200/90 leading-relaxed">
                    <strong className="font-semibold">Importante:</strong> Una vez eliminadas, 
                    no podrás recuperar estas notificaciones. Considera si realmente necesitás 
                    borrar todo el historial.
                  </p>
                </div>
              </div>

              {/* Footer con botones */}
              <div className="border-t border-dark-200/50 p-6 bg-dark-100/30">
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowConfirmModal(false)}
                    className="flex-1 px-4 py-3 rounded-xl border-2 border-dark-300 hover:border-dark-400 bg-dark-200/50 hover:bg-dark-200 text-dark-900 font-medium transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmDeleteAll}
                    disabled={loading}
                    className="flex-1 px-4 py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-600 text-white font-semibold shadow-lg shadow-red-500/25 hover:shadow-xl hover:shadow-red-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Eliminando...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        Sí, eliminar todo
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmación para Eliminar una */}
      {showDeleteModal && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setShowDeleteModal(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div 
            className="relative w-full max-w-md transform transition-all"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card overflow-hidden border-2 border-red-500/30 shadow-[0_0_40px_rgba(239,68,68,0.25)]">
              <div className="relative bg-gradient-to-r from-red-600/20 to-red-500/10 p-6 border-b border-red-500/20">
                <div className="relative flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/30">
                    <Trash2 className="w-6 h-6 text-red-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-red-100 mb-1">
                      ¿Eliminar esta notificación?
                    </h3>
                    <p className="text-sm text-red-200/80">
                      Esta acción no se puede deshacer
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4">
                  <p className="text-sm text-foreground-secondary">
                    {notificationToDelete?.title}
                  </p>
                  <p className="text-xs text-foreground-muted mt-1">
                    {notificationToDelete?.message}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteModal(false)}
                    className="flex-1 px-4 py-2 rounded-xl border border-border hover:bg-background-secondary text-foreground-secondary font-medium transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmDeleteOne}
                    className="flex-1 px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-white font-semibold shadow-lg shadow-red-500/25 hover:shadow-red-500/40 transition-all"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <Bell className="w-8 h-8 text-primary-400" />
            Notificaciones
          </h1>
          <p className="text-foreground-secondary mt-1">
            Mantente al día con las actualizaciones del sistema
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="btn-secondary flex items-center gap-2"
            >
              <CheckCheck className="w-4 h-4" />
              Marcar todas leídas
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={handleDeleteAll}
              disabled={loading}
              className="btn-danger flex items-center gap-2"
              title="Eliminar todas las notificaciones"
            >
              <Eraser className="w-4 h-4" />
              Limpiar todo
            </button>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="btn-primary flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary-600/10">
              <Bell className="w-5 h-5 text-primary-400" />
            </div>
            <div>
              <p className="text-sm text-foreground-secondary">Total</p>
              <p className="text-2xl font-bold text-foreground">
                {notifications.length}
              </p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-600/10">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-foreground-secondary">Sin leer</p>
              <p className="text-2xl font-bold text-foreground">
                {unreadCount}
              </p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-600/10">
              <CheckCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm text-foreground-secondary">Leídas</p>
              <p className="text-2xl font-bold text-foreground">
                {notifications.length - unreadCount}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-foreground-muted" />
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            filter === "all"
              ? "bg-gradient-primary text-white shadow-glow"
              : "text-foreground-secondary hover:text-foreground hover:bg-background-secondary"
          }`}
        >
          Todas
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            filter === "unread"
              ? "bg-gradient-primary text-white shadow-glow"
              : "text-foreground-secondary hover:text-foreground hover:bg-background-secondary"
          }`}
        >
          Sin leer ({unreadCount})
        </button>
      </div>

      {/* Paginación superior */}
      {totalPages > 1 && (
        <div ref={topPaginationRef}>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            onPageChange={handlePageChange}
            variant="top"
            isSticky={isScrolled}
          />
        </div>
      )}

      {/* Lista de notificaciones */}
      <div className="card p-6">
        <div className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin text-primary-500" />
            </div>
          ) : currentNotifications.length === 0 ? (
            <div className="py-12 text-center">
              <Bell className="w-12 h-12 mx-auto mb-3 text-foreground-muted" />
              <p className="text-foreground-secondary mb-2">
                {filter === "unread" 
                  ? "No tenés notificaciones sin leer" 
                  : "No tenés notificaciones"
                }
              </p>
              <p className="text-sm text-foreground-muted">
                Te avisaremos cuando haya novedades
              </p>
            </div>
          ) : (
            <>
              {currentNotifications.map((notification) => (
                <NotificationCard
                  key={notification.id}
                  notification={notification}
                  onMarkRead={handleMarkRead}
                  onDelete={requestDelete}
                  onRefresh={handleRefresh}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Paginación inferior */}
      {totalPages > 1 && !loading && currentNotifications.length > 0 && (
        <div className="card p-0">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            onPageChange={handlePageChange}
            variant="bottom"
          />
        </div>
      )}
    </div>
  );
}

// Helper para formatear tiempo relativo
function formatRelativeTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Ahora";
  if (diffMins < 60) return `Hace ${diffMins}min`;
  if (diffHours < 24) return `Hace ${diffHours}h`;
  if (diffDays < 7) return `Hace ${diffDays}d`;
  
  return date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
  });
}
