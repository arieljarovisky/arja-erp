// src/routes/AppLayout.jsx
import React, { useState, useEffect, useMemo } from "react";
import { apiClient } from "../api/client";
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useTranslation } from "../i18n/useTranslation";
import ThemeToggle from "../components/ThemeToggle";
import LanguageSelector from "../components/LanguageSelector";
import Logo from "../components/Logo";
import BranchSelector from "../components/BranchSelector";
import TrialWarning from "../components/TrialWarning";
import TrialExpiredBlock from "../components/TrialExpiredBlock";
import { useQuery } from "../shared/useQuery";
import { useApp } from "../context/UseApp.js";
import { logger } from "../utils/logger.js";
import {
  LayoutDashboard,
  Users,
  Calendar,
  DollarSign,
  LogOut,
  Menu,
  X,
  Settings,
  Bell,
  UserRound,
  Building2,
  Package,
  FileText,
  GraduationCap,
  Shield,
  Receipt,
  BookOpen,
  ShoppingCart,
  PlugZap,
  Smartphone,
  Activity,
  Megaphone,
} from "lucide-react";

const DEFAULT_FEATURES_BY_BUSINESS = {
  salon: { classes: false, routines: false },
  gym: { classes: true, routines: true },
  pilates: { classes: true, routines: true },
  kinesiology: { classes: false, routines: true },
  spa: { classes: false, routines: false },
  other: { classes: false, routines: false },
};

// Mapeo de nombres según el tipo de negocio
const getNavigationLabels = (businessTypeCode) => {
  const labels = {
    salon: {
      appointments: "Turnos",
      classes: "Clases",
      professionals: "Instructores",
      customers: "Clientes",
      deposits: "Depósitos",
    },
    gym: {
      appointments: "Calendario",
      classes: "Clases",
      professionals: "Instructores",
      customers: "Socios",
      deposits: "Pagos",
    },
    kinesiology: {
      appointments: "Sesiones",
      classes: "Clases",
      professionals: "Kinesiólogos",
      customers: "Pacientes",
      deposits: "Pagos",
    },
    pilates: {
      appointments: "Calendario",
      classes: "Clases",
      professionals: "Instructores",
      customers: "Alumnos",
      deposits: "Pagos",
    },
    spa: {
      appointments: "Reservas",
      classes: "Clases",
      professionals: "Terapeutas",
      customers: "Clientes",
      deposits: "Señas",
    },
    other: {
      appointments: "Turnos",
      classes: "Clases",
      professionals: "Profesionales",
      customers: "Clientes",
      deposits: "Depósitos",
    },
  };

  return labels[businessTypeCode] || labels.other;
};

// Componente para refrescar el estado del tenant cuando está en trial
function TenantStatusRefresher() {
  const { tenant, refreshSession } = useAuth();
  
  useEffect(() => {
    // Solo refrescar si el tenant está en trial
    if (!tenant || tenant.status !== "trial") {
      return;
    }
    
    // Refrescar cada 30 segundos para detectar cuando cambia a "active"
    const interval = setInterval(async () => {
      try {
        await refreshSession();
      } catch (error) {
        // Silenciar errores de refresco
        console.debug("[TenantStatusRefresher] Error refrescando:", error);
      }
    }, 30000); // 30 segundos
    
    return () => clearInterval(interval);
  }, [tenant, refreshSession]);
  
  return null; // Componente invisible
}

export default function AppLayout() {
  const { pathname } = useLocation();
  const { tenantSlug } = useParams();
  const base = `/${tenantSlug || ""}`;
  const authContext = useAuth();
  const { theme } = useTheme();
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { features } = useApp();

  // Bloquear scroll del body cuando el sidebar está abierto en móviles
  useEffect(() => {
    if (sidebarOpen) {
      // Guardar el scroll actual
      const scrollY = window.scrollY;
      // Bloquear el scroll del body
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';
      
      return () => {
        // Restaurar el scroll cuando se cierra
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [sidebarOpen]);

  useEffect(() => {
    const el = document.getElementById("main-content");
    if (el) {
      el.focus();
    }
  }, [pathname]);

  // Obtener tipo de negocio - debe ejecutarse antes de cualquier return condicional
  const { data: businessTypeData } = useQuery(
    async () => {
      try {
        const response = await apiClient.get("/api/business-types/tenant/business-type");
        return response.data?.data || null;
      } catch (error) {
        logger.error("Error loading business type:", error);
        return null;
      }
    },
    []
  );

  // Extraer valores del contexto de forma segura
  const user = authContext?.user || null;
  const tenant = authContext?.tenant || null;
  const logout = authContext?.logout || (() => {});
  const authLoaded = authContext?.authLoaded || false;

  const businessTypeCode = businessTypeData?.code || "salon";
  const navLabels = language === "en" ? {} : getNavigationLabels(businessTypeCode);

  const rawFeatures = businessTypeData?.features_config ?? businessTypeData?.featuresConfig;
  const tenantFeatures = useMemo(() => {
    if (!rawFeatures) return {};
    if (typeof rawFeatures === "string") {
      try {
        return JSON.parse(rawFeatures);
      } catch {
        return {};
      }
    }
    return typeof rawFeatures === "object" && rawFeatures != null ? rawFeatures : {};
  }, [rawFeatures]);

  // Cargar contador de notificaciones - debe ejecutarse antes de cualquier return condicional
  useEffect(() => {
    if (!authLoaded || !authContext) return;
    
    const loadUnreadCount = async () => {
      try {
        const result = await apiClient.getUnreadCount();
        setUnreadCount(result?.count || 0);
      } catch (error) {
        logger.error("Error loading unread count:", error);
        setUnreadCount(0);
      }
    };
    loadUnreadCount();
    const interval = setInterval(loadUnreadCount, 60000); // Actualizar cada 60 segundos (reducido para evitar rate limiting)
    return () => clearInterval(interval);
  }, [authLoaded, authContext]);

  const featureFlags = useMemo(() => {
    const merged = {
      ...(DEFAULT_FEATURES_BY_BUSINESS[businessTypeCode] || {}),
      ...tenantFeatures,
      ...features,
    };

    return {
      ...merged,
      online_sales: merged.online_sales ?? false,
      ecommerce_integrations: merged.ecommerce_integrations ?? false,
    };
  }, [tenantFeatures, businessTypeCode, features]);

  const handleLogout = async () => {
    if (logout) {
      await logout();
      // Limpiar el historial: primero ir a /, luego a /login
      // Esto asegura que al presionar atrás desde login, vaya a la landing
      window.history.replaceState(null, "", "/");
      window.location.replace("/login");
    }
  };

  // Agrupar items del menú
  const mainNavItems = [
    { to: `${base}/dashboard`, label: t("navigation.dashboard"), icon: LayoutDashboard, active: pathname === `${base}/dashboard` },
    { to: `${base}/appointments`, label: navLabels.appointments || t("navigation.appointments"), icon: Calendar, active: pathname.startsWith(`${base}/appointments`) },
    { to: `${base}/classes`, label: navLabels.classes || t("navigation.classes"), icon: GraduationCap, active: pathname.startsWith(`${base}/classes`), featureKey: "classes" },
    { to: `${base}/workout-routines`, label: t("navigation.routines"), icon: Activity, active: pathname.startsWith(`${base}/workout-routines`), featureKey: "routines" },
    { to: `${base}/customers`, label: navLabels.customers || t("navigation.customers"), icon: Users, active: pathname.startsWith(`${base}/customers`) },
    { to: `${base}/deposits`, label: navLabels.deposits || t("navigation.deposits"), icon: DollarSign, active: pathname.startsWith(`${base}/deposits`) },
  ];

  const managementNavItems = [
    {
      to: `${base}/stock/products`,
      label: t("navigation.stock"),
      icon: Package,
      active: pathname.startsWith(`${base}/stock`),
      module: "stock",
      featureKey: "stock",
    },
    {
      to: `${base}/invoicing`,
      label: t("navigation.invoicing"),
      icon: FileText,
      active: pathname.startsWith(`${base}/invoicing`),
      module: "invoicing",
      featureKey: "invoicing",
    },
    {
      to: `${base}/ecommerce-sales`,
      label: t("navigation.onlineSales"),
      icon: ShoppingCart,
      active: pathname.startsWith(`${base}/ecommerce-sales`),
      module: "invoicing",
      featureKey: "online_sales",
    },
  ];

  const adminNavItems = [
    {
      to: `${base}/cash-register`,
      label: t("navigation.cashRegister"),
      icon: Receipt,
      active: pathname.startsWith(`${base}/cash-register`),
      adminOnly: true,
    },
    {
      to: `${base}/crm`,
      label: "CRM",
      icon: Megaphone,
      active: pathname.startsWith(`${base}/crm`),
      adminOnly: true,
    },
    {
      to: `${base}/accounting`,
      label: t("navigation.accounting"),
      icon: BookOpen,
      active: pathname.startsWith(`${base}/accounting`),
      adminOnly: true,
    },
    {
      to: `${base}/admin/integraciones`,
      label: t("navigation.integrations"),
      icon: PlugZap,
      active: pathname.startsWith(`${base}/admin/integraciones`),
      adminOnly: true,
      featureKey: "ecommerce_integrations",
    },
    {
      to: `${base}/admin/mobile-app`,
      label: t("navigation.mobileApp"),
      icon: Smartphone,
      active: pathname.startsWith(`${base}/admin/mobile-app`),
      adminOnly: true,
      featureKey: "mobile_app",
    },
  ];

  const configNavItems = [
    { to: `${base}/notifications`, label: t("navigation.notifications"), icon: Bell, active: pathname.startsWith(`${base}/notifications`), badge: unreadCount > 0 ? unreadCount : null },
    { to: `${base}/users`, label: t("navigation.users"), icon: Users, active: pathname.startsWith(`${base}/users`), adminOnly: true },
    { to: `${base}/admin/instructores`, label: navLabels.professionals || t("navigation.professionals"), icon: UserRound, active: pathname.startsWith(`${base}/admin/instructores`), adminOnly: true },
    { to: `${base}/admin/branches`, label: t("navigation.branches"), icon: Building2, active: pathname.startsWith(`${base}/admin/branches`), adminOnly: true },
    { to: `${base}/admin/config`, label: t("navigation.config"), icon: Settings, active: pathname.startsWith(`${base}/admin/config`), adminOnly: true },
  ];

  // Función para filtrar items
  const filterNavItems = (items) => {
    return items.filter(item => {
      if (item.adminOnly && user?.role !== "admin") return false;
      
      if (item.featureKey && featureFlags?.[item.featureKey] === false) {
        return false;
      }
      
      if (item.module) {
        const permissions = user?.permissions || {};
        const modulePerms = permissions[item.module] || [];
        if (user?.role !== "admin" && modulePerms.length === 0) {
          return false;
        }
      }
      
      return true;
    });
  };

  const filteredMainNav = filterNavItems(mainNavItems);
  const filteredManagementNav = filterNavItems(managementNavItems);
  const filteredAdminNav = filterNavItems(adminNavItems);
  const filteredConfigNav = filterNavItems(configNavItems);

  // Manejar el caso cuando el contexto de autenticación no está disponible
  if (!authContext) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-foreground-muted">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  // Esperar a que la autenticación se cargue
  if (!authLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-foreground-muted">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="arja-shell">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only fixed top-2 left-2 z-50 px-3 py-2 rounded-lg bg-background border border-border shadow text-foreground"
      >
        {t("common.skipToMain")}
      </a>
      {/* Overlay para mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`arja-sidebar arja-sidebar--contrast ${sidebarOpen ? "is-open" : ""} shadow-2xl`}
        style={{ maxHeight: '100vh', overflowY: 'auto' }}
      >
        {/* Logo Header */}
        <div className="arja-sidebar__section arja-sidebar__header">
          <Logo size="default" showText={true} />
          <button
            onClick={() => setSidebarOpen(false)}
            type="button"
            className="arja-sidebar__close"
            aria-label={t("common.closeMenu")}
          >
            <X />
          </button>
        </div>

        {/* Tenant Info */}
        {tenant && (
          <div className="arja-sidebar__section space-y-3">
            <div className="arja-tenant-card">
              <span className="arja-tenant-card__icon">
                <Building2 />
              </span>
              <div className="arja-tenant-card__body">
                <p className="arja-tenant-card__title">{t("tenant.business")}</p>
                <p className="arja-tenant-card__value">
                  {tenant.is_system ? t("tenant.globalPanel") : tenant.name || tenant.subdomain || `#${tenant.id}`}
                </p>
              </div>
            </div>
            {!tenant.is_system ? <BranchSelector /> : null}
          </div>
        )}

        {/* Navigation */}
        <nav className="arja-nav">
          {/* Sección Principal */}
          {filteredMainNav.length > 0 && (
            <>
              {filteredMainNav.map((item) => (
                <SidebarNavButton
                  key={item.to}
                  {...item}
                  onClick={() => setSidebarOpen(false)}
                />
              ))}
            </>
          )}

          {/* Sección Gestión */}
          {filteredManagementNav.length > 0 && (
            <>
              <div className="arja-nav-divider">
                <span>{t("navigation.management")}</span>
              </div>
              {filteredManagementNav.map((item) => (
                <SidebarNavButton
                  key={item.to}
                  {...item}
                  onClick={() => setSidebarOpen(false)}
                />
              ))}
            </>
          )}

          {/* Sección Administración */}
          {filteredAdminNav.length > 0 && (
            <>
              <div className="arja-nav-divider">
                <span>{t("navigation.administration")}</span>
              </div>
              {filteredAdminNav.map((item) => (
                <SidebarNavButton
                  key={item.to}
                  {...item}
                  onClick={() => setSidebarOpen(false)}
                />
              ))}
            </>
          )}

          {/* Sección Configuración */}
          {filteredConfigNav.length > 0 && (
            <>
              <div className="arja-nav-divider">
                <span>{t("navigation.settings")}</span>
              </div>
              {filteredConfigNav.map((item) => (
                <SidebarNavButton
                  key={item.to}
                  {...item}
                  onClick={() => setSidebarOpen(false)}
                />
              ))}
            </>
          )}
        </nav>

        {/* User Section */}
        <div className="arja-sidebar__footer">
          {/* Theme Toggle */}
          <div className="arja-sidebar__theme">
            <span>{t("navigation.theme")}</span>
            <ThemeToggle />
          </div>
          
          {/* Language Selector */}
          <div className="arja-sidebar__theme" style={{ marginTop: '8px' }}>
            <span>{t("language.selectLanguage")}</span>
            <LanguageSelector />
          </div>

          {user?.isSuperAdmin && (
            <Link
              to="/super-admin/tenants"
              className="arja-sidebar__superadmin"
            >
              <Shield />
              <span>{t("navigation.superAdmin")}</span>
            </Link>
          )}

          {/* User Info */}
          <div className="arja-user-card">
            <div className="arja-user-card__avatar">
              <span>
                {user?.email?.[0]?.toUpperCase() || "U"}
              </span>
            </div>
            <div className="arja-user-card__info">
              <p className="arja-user-card__name">
                {user?.full_name || user?.email?.split("@")[0]}
              </p>
              <p className="arja-user-card__role">{user?.role}</p>
            </div>
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="arja-sidebar__logout"
          >
            <LogOut />
            <span>{t("navigation.logout")}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="arja-main">
        {/* Trial Warning Banner */}
        <TrialWarning />
        {/* Auto-refresh tenant status when in trial */}
        <TenantStatusRefresher />

        {/* Mobile Header */}
        <header className="arja-main__header arja-main__header--mobile">
          <div className="arja-main__header-inner">
            <button
              onClick={() => setSidebarOpen(true)}
              type="button"
              className="arja-main__menu"
              aria-label={t("common.openMenu")}
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className="flex-1 flex justify-center">
              <Logo size="small" showText={true} />
            </div>
            <div className="w-[42px]" /> {/* Spacer para balancear el botón del menú */}
          </div>
        </header>

        {/* Main Content */}
        <main
          id="main-content"
          className="arja-main__content"
          tabIndex="-1"
          aria-label="Contenido principal"
        >
          <div className="arja-main__content-inner px-2 sm:px-0">
            <TrialExpiredBlock>
            <div className="animate-fade-in">
              <Outlet />
            </div>
            </TrialExpiredBlock>
          </div>
        </main>

        {/* Footer */}
        <footer className="arja-main__footer">
          © {new Date().getFullYear()} — ARJA ERP
          <small>
            {t("footer.product")} v2.0{" "}
            {tenant ? `• ${tenant.is_system ? t("tenant.globalPanel") : (tenant.name || tenant.subdomain)}` : ""}
          </small>
        </footer>
      </div>
    </div>
  );
}

function SidebarNavButton({ to, label, icon: Icon, active, onClick, badge, module }) {
  // Verificar permisos por módulo
  const authContext = useAuth();
  const user = authContext?.user || null;
  const permissions = user?.permissions || {};
  const modulePerms = permissions[module] || [];
  
  // Si tiene módulo y no es admin, verificar permisos
  if (module && user?.role !== "admin" && modulePerms.length === 0) {
    return null;
  }

  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={`arja-nav-link ${active ? "is-active" : ""}`}
    >
      <Icon />
      <span>{label}</span>
      {badge && (
        <span className="arja-nav-link__badge">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </NavLink>
  );
}
