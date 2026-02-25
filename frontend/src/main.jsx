// src/main.jsx
import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import "./index.css";
import { logger } from "./utils/logger.js";
import "./styles/arja-theme.css";
import Skeleton from "./components/ui/Skeleton.jsx";

const LandingPage = React.lazy(() => import("./routes/LandingPage.jsx"));
const DocsPage = React.lazy(() => import("./routes/DocsPage.jsx"));
const AppLayout = React.lazy(() => import("./routes/AppLayout.jsx"));
const DashboardPage = React.lazy(() => import("./routes/DashboardPage.jsx"));
const CustomersPage = React.lazy(() => import("./routes/CustomersPage.jsx"));
const CustomerDetailPage = React.lazy(() => import("./routes/CustomerDetailPage.jsx"));
const CustomerMembershipHistoryPage = React.lazy(() => import("./routes/CustomerMembershipHistoryPage.jsx"));
const WorkoutRoutinesPage = React.lazy(() => import("./routes/WorkoutRoutinesPage.jsx"));
const WorkoutRoutineEditPage = React.lazy(() => import("./routes/WorkoutRoutineEditPage.jsx"));
const BookingPage = React.lazy(() => import("./routes/BookingPage.jsx"));
const DepositsPage = React.lazy(() => import("./routes/Depositspage.jsx"));
import LoginPage from "./routes/LoginPage.jsx";
const ClassesPage = React.lazy(() => import("./routes/ClassesPage.jsx"));

// Auth y contexto
import { AuthProvider } from "./context/AuthContext.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { LanguageProvider } from "./context/LanguageContext.jsx";
import PrivateRoute from "./components/PrivateRoute.jsx";
const PaymentSuccess = React.lazy(() => import("./routes/PaymentSuccess.jsx"));
const PaymentFailure = React.lazy(() => import("./routes/PaymentFailure.jsx"));

// Sistema de notificaciones
import { NotificationSystem } from "./components/notifications/NotificationSystem.jsx";
const DepositsConfig = React.lazy(() => import("./routes/Admin/DepositsConfig.jsx"));
const Commissions = React.lazy(() => import("./routes/Admin/Comissions.jsx"));
const InstructorStats = React.lazy(() => import("./routes/Admin/InstructorStats.jsx"));
const ConfigPage = React.lazy(() => import("./routes/Admin/ConfigPage.jsx"));
const NotificationsPage = React.lazy(() => import("./routes/NotificationPage.jsx"));
const ProductsPage = React.lazy(() => import("./routes/Stock/ProductsPage.jsx"));
const StockReservationsPage = React.lazy(() => import("./routes/Stock/StockReservationsPage.jsx"));
const StockTransfersPage = React.lazy(() => import("./routes/Stock/StockTransfersPage.jsx"));
const StockAlertsPage = React.lazy(() => import("./routes/Stock/StockAlertsPage.jsx"));
const StockValuationPage = React.lazy(() => import("./routes/Stock/StockValuationPage.jsx"));
const InvoicingPage = React.lazy(() => import("./routes/Invoicing/InvoicingPage.jsx"));
const EcommerceSalesPage = React.lazy(() => import("./routes/Invoicing/EcommerceSalesPage.jsx"));
const UsersPage = React.lazy(() => import("./routes/Users/UsersPage.jsx"));
const SuperAdminLayout = React.lazy(() => import("./routes/SuperAdmin/SuperAdminLayout.jsx"));
const SuperAdminTenantsPage = React.lazy(() => import("./routes/SuperAdmin/SuperAdminTenantsPage.jsx"));
const SuperAdminTenantDetail = React.lazy(() => import("./routes/SuperAdmin/SuperAdminTenantDetail.jsx"));
import SuperAdminRoute from "./components/SuperAdminRoute.jsx";
const OnboardingPage = React.lazy(() => import("./routes/Onboarding/OnboardingPage.jsx"));
const PaymentSetupPage = React.lazy(() => import("./routes/Onboarding/PaymentSetupPage.jsx"));
const PaymentCompletePage = React.lazy(() => import("./routes/Onboarding/PaymentCompletePage.jsx"));
const ActivationPendingPage = React.lazy(() => import("./routes/Onboarding/ActivationPendingPage.jsx"));
const InstructorsPage = React.lazy(() => import("./routes/Admin/InstructorsPage.jsx"));
const MembershipPlansPage = React.lazy(() => import("./routes/Admin/MembershipPlansPage.jsx"));
const BranchesPage = React.lazy(() => import("./routes/Admin/BranchesPage.jsx"));
import FeatureGate from "./components/FeatureGate.jsx";
import { AppProvider } from "./context/AppProvider.jsx";
const EnterpriseRequest = React.lazy(() => import("./routes/EnterpriseRequest.jsx"));
const ForgotPasswordPage = React.lazy(() => import("./routes/ForgotPasswordPage.jsx"));
const ResetPasswordPage = React.lazy(() => import("./routes/ResetPasswordPage.jsx"));
const ActivatePage = React.lazy(() => import("./routes/ActivatePage.jsx"));
const HelpPage = React.lazy(() => import("./routes/HelpPage.jsx"));
const ContactPage = React.lazy(() => import("./routes/ContactPage.jsx"));
const TermsPage = React.lazy(() => import("./routes/TermsPage.jsx"));
const PrivacyPage = React.lazy(() => import("./routes/PrivacyPage.jsx"));

// Componente de redirección para mantener compatibilidad con /privacy
const PrivacyRedirect = () => <Navigate to="/privacy.html" replace />;

const PlansPage = React.lazy(() => import("./routes/PlansPage.jsx"));
const SubscriptionSuccess = React.lazy(() => import("./routes/SubscriptionSuccess.jsx"));
const SubscriptionFailure = React.lazy(() => import("./routes/SubscriptionFailure.jsx"));
const CashRegisterPage = React.lazy(() => import("./routes/CashRegister/CashRegisterPage.jsx"));
const AccountingPage = React.lazy(() => import("./routes/Accounting/AccountingPage.jsx"));
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { logDiagnosis, startMonitoring } from "./utils/performanceMonitor.js";
const IntegrationsPage = React.lazy(() => import("./routes/Admin/IntegrationsPage.jsx"));
const FeatureRequestPage = React.lazy(() => import("./routes/FeatureRequestPage.jsx"));
const TwoFactorAuthPage = React.lazy(() => import("./routes/TwoFactorAuthPage.jsx"));
const GoogleOAuthCallback = React.lazy(() => import("./routes/GoogleOAuthCallback.jsx"));
const MobileAppPage = React.lazy(() => import("./routes/Admin/MobileAppPage.jsx"));
const CRMPage = React.lazy(() => import("./routes/CRM/CRMPage.jsx"));

const router = createBrowserRouter([
  // Página principal de marketing/ventas
  { path: "/", element: <LandingPage /> },
  { path: "/docs", element: <DocsPage /> },
  { 
    path: "/login", 
    element: <LoginPage />,
    errorElement: <ErrorBoundary><div className="min-h-screen bg-background flex items-center justify-center p-4"><div className="text-center"><h1 className="text-2xl font-bold text-foreground mb-4">Error al cargar la página de ingreso</h1><p className="text-foreground-muted mb-4">Hubo un problema cargando el módulo. Por favor, recargá la página o intentá más tarde.</p><button onClick={() => window.location.reload()} className="btn-primary">Recargar</button></div></div></ErrorBoundary>
  },
  { path: "/auth/google/success", element: <GoogleOAuthCallback /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/activate", element: <Navigate to="/login" replace /> },
  { path: "/enterprise-request", element: <EnterpriseRequest /> },
  { path: "/help", element: <HelpPage /> },
  { path: "/contact", element: <ContactPage /> },
  { path: "/terms", element: <TermsPage /> },
  { path: "/privacy", element: <PrivacyRedirect /> },
  { path: "/privacy.html", element: <PrivacyPage /> },
  { path: "/onboarding", element: <OnboardingPage /> },
  { path: "/onboarding/payment", element: <PaymentSetupPage /> },
  { path: "/onboarding/payment/complete", element: <PaymentCompletePage /> },
  { path: "/onboarding/activation-pending", element: <Navigate to="/login" replace /> },

  // 👇 TODA la app del tenant cuelga de /:tenantSlug
  {
    path: "/:tenantSlug",
    element: (
      <AppProvider>
        <AppLayout />
      </AppProvider>
    ),
    errorElement: <ErrorBoundary><div className="min-h-screen bg-background flex items-center justify-center p-4"><div className="text-center"><h1 className="text-2xl font-bold text-foreground mb-4">Error al cargar la página</h1><p className="text-foreground-muted mb-4">Ocurrió un error al cargar esta sección. Por favor, recarga la página.</p><button onClick={() => window.location.reload()} className="btn-primary">Recargar página</button></div></div></ErrorBoundary>,
    children: [
      // Redirección del index a dashboard
      {
        index: true,
        element: <Navigate to="dashboard" replace />,
      },
      { path: "payment/success", element: <PaymentSuccess /> },
      { path: "payment/failure", element: <PaymentFailure /> },
      { path: "payment/pending", element: <PaymentSuccess /> },
      { path: "subscription/success", element: <SubscriptionSuccess /> },
      { path: "subscription/failure", element: <SubscriptionFailure /> },
      {
        path: "dashboard",
        element: (
          <PrivateRoute roles={["admin", "staff"]}>
            <DashboardPage />
          </PrivateRoute>
        ),
      },
      {
        path: "customers",
        element: (
          <PrivateRoute roles={["admin", "staff"]}>
            <CustomersPage />
          </PrivateRoute>
        ),
      },
      {
        path: "customers/:id",
        element: (
          <PrivateRoute roles={["admin", "staff"]}>
            <CustomerDetailPage />
          </PrivateRoute>
        ),
      },
      {
        path: "customers/:id/membership-history",
        element: (
          <PrivateRoute roles={["admin", "staff"]}>
            <CustomerMembershipHistoryPage />
          </PrivateRoute>
        ),
      },
      { path: "appointments", element: <BookingPage /> }, // público del tenant
      {
        path: "deposits",
        element: (
          <PrivateRoute roles={["admin", "staff"]}>
            <DepositsPage />
          </PrivateRoute>
        ),
      },
      {
        path: "workout-routines",
        element: (
          <PrivateRoute roles={["admin", "staff", "user"]}>
            <WorkoutRoutinesPage />
          </PrivateRoute>
        ),
      },
      {
        path: "workout-routines/:id/edit",
        element: (
          <PrivateRoute roles={["admin", "staff", "user"]}>
            <WorkoutRoutineEditPage />
          </PrivateRoute>
        ),
      },
      {
        path: "classes",
        element: (
          <PrivateRoute roles={["admin", "staff"]}>
            <ClassesPage />
          </PrivateRoute>
        ),
      },
      {
        path: "notifications",
        element: (
          <PrivateRoute roles={["admin", "staff"]}>
            <NotificationsPage />
          </PrivateRoute>
        ),
      },
      {
        path: "admin/config",
        element: (
          <PrivateRoute roles={["admin"]}>
            <ConfigPage />
          </PrivateRoute>
        ),
      },
      {
        path: "admin/2fa",
        element: (
          <PrivateRoute>
            <TwoFactorAuthPage />
          </PrivateRoute>
        ),
      },
      {
        path: "plans",
        element: (
          <PrivateRoute>
            <PlansPage />
          </PrivateRoute>
        ),
      },
      {
        path: "stock/products",
        element: (
          <PrivateRoute>
            <FeatureGate featureKey="stock">
              <ProductsPage />
            </FeatureGate>
          </PrivateRoute>
        ),
      },
      {
        path: "admin/mobile-app",
        element: (
          <PrivateRoute roles={["admin"]}>
            <FeatureGate featureKey="mobile_app">
              <MobileAppPage />
            </FeatureGate>
          </PrivateRoute>
        ),
      },
      {
        path: "stock/reservations",
        element: (
          <PrivateRoute>
            <FeatureGate featureKey="stock">
              <StockReservationsPage />
            </FeatureGate>
          </PrivateRoute>
        ),
      },
      {
        path: "stock/transfers",
        element: (
          <PrivateRoute>
            <FeatureGate featureKey="stock">
              <StockTransfersPage />
            </FeatureGate>
          </PrivateRoute>
        ),
      },
      {
        path: "stock/alerts",
        element: (
          <PrivateRoute>
            <FeatureGate featureKey="stock">
              <StockAlertsPage />
            </FeatureGate>
          </PrivateRoute>
        ),
      },
      {
        path: "stock/valuation",
        element: (
          <PrivateRoute>
            <FeatureGate featureKey="stock">
              <StockValuationPage />
            </FeatureGate>
          </PrivateRoute>
        ),
      },
      {
        path: "invoicing",
        element: (
          <PrivateRoute>
            <FeatureGate featureKey="invoicing">
              <InvoicingPage />
            </FeatureGate>
          </PrivateRoute>
        ),
      },
      {
        path: "ecommerce-sales",
        element: (
          <PrivateRoute roles={["admin", "staff"]}>
            <FeatureGate featureKey="online_sales">
              <EcommerceSalesPage />
            </FeatureGate>
          </PrivateRoute>
        ),
      },
      {
        path: "cash-register",
        element: (
          <PrivateRoute roles={["admin", "staff"]}>
            <CashRegisterPage />
          </PrivateRoute>
        ),
      },
      {
        path: "accounting",
        element: (
          <PrivateRoute roles={["admin", "staff"]}>
            <AccountingPage />
          </PrivateRoute>
        ),
      },
      {
        path: "crm",
        element: (
          <PrivateRoute roles={["admin", "staff"]}>
            <CRMPage />
          </PrivateRoute>
        ),
      },
      {
        path: "users",
        element: (
          <PrivateRoute roles={["admin"]}>
            <UsersPage />
          </PrivateRoute>
        ),
      },
      {
        path: "admin/comisiones",
        element: (
          <PrivateRoute roles={["admin"]}>
            <Commissions />
          </PrivateRoute>
        ),
      },
      {
        path: "admin/integraciones",
        element: (
          <PrivateRoute roles={["admin"]}>
            <FeatureGate featureKey="ecommerce_integrations">
              <IntegrationsPage />
            </FeatureGate>
          </PrivateRoute>
        ),
      },
      {
        path: "admin/instructores",
        element: (
          <PrivateRoute roles={["admin"]}>
            <InstructorsPage />
          </PrivateRoute>
        ),
      },
      {
        path: "admin/branches",
        element: (
          <PrivateRoute roles={["admin"]}>
            <BranchesPage />
          </PrivateRoute>
        ),
      },
      {
        path: "admin/instructores/estadisticas",
        element: (
          <PrivateRoute roles={["admin"]}>
            <InstructorStats />
          </PrivateRoute>
        ),
      },
      {
        path: "admin/membresias",
        element: (
          <PrivateRoute roles={["admin"]}>
            <MembershipPlansPage />
          </PrivateRoute>
        ),
      },
      {
        path: "feature-request",
        element: (
          <PrivateRoute roles={["admin"]}>
            <FeatureRequestPage />
          </PrivateRoute>
        ),
      },

    ],
  },

  // Panel dueño del sistema
  {
    path: "/super-admin",
    element: (
      <SuperAdminRoute>
        <SuperAdminLayout />
      </SuperAdminRoute>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="tenants" replace />,
      },
      {
        path: "tenants",
        element: <SuperAdminTenantsPage />,
      },
      {
        path: "tenants/:tenantId",
        element: <SuperAdminTenantDetail />,
      },
    ],
  },

  // Fallback: fuera de un tenant → a la landing page
  { path: "*", element: <Navigate to="/" replace /> },
], { basename: import.meta.env.BASE_URL });

// Exponer función de diagnóstico en la consola para debugging
if (typeof window !== 'undefined') {
  window.checkServerPerformance = logDiagnosis;
  window.startPerformanceMonitoring = startMonitoring;
  
  // Iniciar monitoreo automático en desarrollo
  if (import.meta.env.DEV) {
    startMonitoring(60000); // Cada minuto
    logger.log('💡 Tip: Usa window.checkServerPerformance() en la consola para ver el diagnóstico');
  }
  
  // Protección global contra errores de DOM durante traducciones automáticas
  const isPageTranslated = () => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('translated-ltr') ||
           document.documentElement.classList.contains('translated-rtl') ||
           document.body.classList.contains('translated-ltr') ||
           document.body.classList.contains('translated-rtl') ||
           document.querySelector('[data-google-translate]') !== null ||
           document.querySelector('script[src*="translate.googleapis.com"]') !== null;
  };
  
  const isRemoveChildError = (message, error) => {
    const msg = String(message || '');
    const errMsg = error?.message ? String(error.message) : '';
    return (msg.includes('removeChild') || errMsg.includes('removeChild')) &&
           (error?.name === 'NotFoundError' || error?.name === 'DOMException');
  };
  
  const isInsertBeforeError = (message, error) => {
    const msg = String(message || '');
    const errMsg = error?.message ? String(error.message) : '';
    return (msg.includes('insertBefore') || errMsg.includes('insertBefore')) &&
           (error?.name === 'NotFoundError' || error?.name === 'DOMException');
  };
  
  const originalErrorHandler = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    // Verificar si es un error de removeChild o insertBefore durante traducción
    if ((isRemoveChildError(message, error) || isInsertBeforeError(message, error)) && isPageTranslated()) {
      // Silenciar el error durante traducciones
      if (import.meta.env.DEV) {
        logger.warn('Error de DOM durante traducción automática (ignorado):', { message, error });
      }
      return true; // Prevenir que el error se propague
    }
    
    // Llamar al manejador original si existe
    if (originalErrorHandler) {
      return originalErrorHandler(message, source, lineno, colno, error);
    }
    return false;
  };
  
  // También capturar errores no manejados en promesas
  window.addEventListener('unhandledrejection', (event) => {
    if ((isRemoveChildError(event.reason?.message, event.reason) || isInsertBeforeError(event.reason?.message, event.reason)) && isPageTranslated()) {
      // Silenciar el error durante traducciones
      if (import.meta.env.DEV) {
        logger.warn('Error de DOM durante traducción automática (ignorado):', event.reason);
      }
      event.preventDefault(); // Prevenir que el error se propague
    }
  });
  
  // Interceptar removeChild a nivel de Node.prototype para prevenir errores
  // Esto se hace aquí como respaldo, pero el script inline en HTML debería ejecutarse primero
  if (typeof Node !== 'undefined' && Node.prototype.removeChild) {
    // Solo interceptar si no fue ya interceptado por el script inline
    if (!Node.prototype.removeChild._translationProtected) {
      const originalRemoveChild = Node.prototype.removeChild;
      Node.prototype.removeChild = function(child) {
        try {
          // Verificar si el nodo es realmente hijo antes de remover
          // Usar múltiples métodos de verificación para mayor robustez
          let isChild = false;
          if (child && this) {
            try {
              // Método 1: contains
              if (this.contains) {
                isChild = this.contains(child);
              }
              // Método 2: comparar parentNode
              if (!isChild && child.parentNode === this) {
                isChild = true;
              }
              // Método 3: verificar en childNodes
              if (!isChild && this.childNodes) {
                isChild = Array.from(this.childNodes).includes(child);
              }
            } catch (e) {
              // Si cualquier verificación falla, asumir que no es hijo
              isChild = false;
            }
          }
          
          if (!isChild) {
            // Si la página está siendo traducida, simplemente retornar sin error
            if (isPageTranslated()) {
              if (import.meta.env.DEV) {
                logger.warn('Intento de remover nodo que no es hijo (ignorado durante traducción)');
              }
              return child;
            }
            // Si no está siendo traducida, lanzar el error normalmente
            throw new DOMException('Failed to execute \'removeChild\' on \'Node\': The node to be removed is not a child of this node.', 'NotFoundError');
          }
          return originalRemoveChild.call(this, child);
        } catch (error) {
          // Si es un error de removeChild durante traducción, ignorarlo
          if (isPageTranslated() && isRemoveChildError(error.message, error)) {
            if (import.meta.env.DEV) {
              logger.warn('Error de removeChild durante traducción (ignorado):', error);
            }
            return child;
          }
          throw error;
        }
      };
      Node.prototype.removeChild._translationProtected = true;
    }
  }
  
  // Interceptar insertBefore a nivel de Node.prototype para prevenir errores
  if (typeof Node !== 'undefined' && Node.prototype.insertBefore) {
    // Solo interceptar si no fue ya interceptado por el script inline
    if (!Node.prototype.insertBefore._translationProtected) {
      const originalInsertBefore = Node.prototype.insertBefore;
      Node.prototype.insertBefore = function(newNode, referenceNode) {
        try {
          // Verificar si el nodo de referencia es realmente hijo
          let isReferenceChild = false;
          if (referenceNode && this) {
            try {
              // Método 1: contains
              if (this.contains) {
                isReferenceChild = this.contains(referenceNode);
              }
              // Método 2: comparar parentNode
              if (!isReferenceChild && referenceNode.parentNode === this) {
                isReferenceChild = true;
              }
              // Método 3: verificar en childNodes
              if (!isReferenceChild && this.childNodes) {
                isReferenceChild = Array.from(this.childNodes).includes(referenceNode);
              }
            } catch (e) {
              // Si cualquier verificación falla, asumir que no es hijo
              isReferenceChild = false;
            }
          }
          
          // Si referenceNode es null, insertBefore funciona como appendChild
          if (referenceNode === null) {
            return originalInsertBefore.call(this, newNode, referenceNode);
          }
          
          if (!isReferenceChild) {
            // Si la página está siendo traducida, intentar appendChild como fallback
            if (isPageTranslated()) {
              if (import.meta.env.DEV) {
                logger.warn('Intento de insertar nodo antes de uno que no es hijo (ignorado durante traducción)');
              }
              try {
                return this.appendChild(newNode);
              } catch (e) {
                return newNode;
              }
            }
            // Si no está siendo traducida, lanzar el error normalmente
            throw new DOMException('Failed to execute \'insertBefore\' on \'Node\': The node before which the new node is to be inserted is not a child of this node.', 'NotFoundError');
          }
          return originalInsertBefore.call(this, newNode, referenceNode);
        } catch (error) {
          // Si es un error de insertBefore durante traducción, ignorarlo
          if (isPageTranslated() && isInsertBeforeError(error.message, error)) {
            if (import.meta.env.DEV) {
              logger.warn('Error de insertBefore durante traducción (ignorado):', error);
            }
            try {
              return this.appendChild(newNode);
            } catch (e) {
              return newNode;
            }
          }
          throw error;
        }
      };
      Node.prototype.insertBefore._translationProtected = true;
    }
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <ThemeProvider>
          <AuthProvider>
            <NotificationSystem />
            <Suspense fallback={<div className="p-4"><Skeleton className="h-6 mb-2" /><Skeleton className="h-6 mb-2" /><Skeleton className="h-6" /></div>}>
              <RouterProvider router={router} />
            </Suspense>
          </AuthProvider>
        </ThemeProvider>
      </LanguageProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
