import { NavLink, Outlet, useLocation, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import ThemeToggle from "../../components/ThemeToggle.jsx";
import Logo from "../../components/Logo.jsx";
import { LogOut, Building2, LayoutDashboard } from "lucide-react";

export default function SuperAdminLayout() {
  const { pathname } = useLocation();
  const { user, tenant, logout } = useAuth();

  const navItems = [
    {
      to: "/super-admin/tenants",
      label: "Tenants",
      icon: Building2,
      active: pathname.startsWith("/super-admin/tenants"),
    },
  ];

  const tenantSlug = tenant?.is_system ? null : tenant?.slug || tenant?.subdomain;
  const tenantDashboard = tenantSlug ? `/${tenantSlug}/dashboard` : null;

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      window.location.href = "/login";
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background-secondary/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-6">
            <Logo size="small" showText />
            <nav className="flex items-center gap-3">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      [
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                        isActive
                          ? "bg-primary text-white shadow-md"
                          : "text-foreground-secondary hover:text-foreground hover:bg-background",
                      ].join(" ")
                    }
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </NavLink>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {tenantDashboard && (
              <Link
                to={tenantDashboard}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-background"
              >
                <LayoutDashboard className="w-4 h-4" />
                Ir al tenant
              </Link>
            )}
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-all"
            >
              <LogOut className="w-4 h-4" />
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold">Panel del dueño</h1>
          <p className="text-sm text-foreground-secondary">
            {user?.email ? `Sesión iniciada como ${user.email}` : "Gestión global del sistema"}
          </p>
        </div>
        <div className="space-y-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

