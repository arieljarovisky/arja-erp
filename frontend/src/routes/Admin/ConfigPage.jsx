// src/routes/Admin/ConfigPage.jsx - Con navegación oculta en mobile
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Settings,
  DollarSign,
  Bell,
  Percent,
  TrendingUp,
  Save,
  RefreshCw,
  Users,
  CreditCard,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  LogOut,
  AlertTriangle,
  Building2,
  Receipt,
  Shield,
  MessageCircle,
  Play,
  Info,
  Plus,
  Edit3,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
} from "lucide-react";
import { apiClient } from "../../api/client.js";
import { toast } from "sonner";
import BusinessTypeConfig from "./BusinessTypeConfig.jsx";
import { useAuth } from "../../context/AuthContext";
import { useApp } from "../../context/UseApp";
import Button from "../../components/ui/Button";
import { logger } from "../../utils/logger.js";
import { useTranslation } from "../../i18n/useTranslation.js";

function ConfigSection({ title, description, icon: Icon, children }) {
  return (
    <div className="card card--space-lg">
      <div className="flex items-start gap-4 mb-6">
        <div className="p-3 rounded-xl bg-gradient-to-br from-primary-600/20 to-primary-600/5 border border-primary-600/30">
          <Icon className="w-6 h-6 text-primary-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-foreground-secondary mt-1">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function FieldGroup({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-foreground-muted mt-1">{hint}</p>}
    </div>
  );
}

function SwitchField({ label, description, checked, onChange, disabled = false }) {
  return (
    <label className={`flex items-center gap-3 p-3 rounded-xl bg-background-secondary hover:bg-border transition-all border border-border ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="w-5 h-5 rounded border-border text-primary focus:ring-primary disabled:cursor-not-allowed"
      />
      <div className="flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <div className="text-xs text-foreground-secondary mt-0.5">{description}</div>
        )}
      </div>
    </label>
  );
}

export default function ConfigPage() {
  const navigate = useNavigate();
  const { tenantSlug } = useParams();
  const [searchParams] = useSearchParams();
  const { user, tenant } = useAuth();
  const { tenantInfo, refreshFeatures } = useApp();
  const { t, language } = useTranslation();
  const [active, setActive] = useState("general");
  
  // Debug: log cuando cambia el idioma
  useEffect(() => {
    console.log('[ConfigPage] Language changed to:', language);
  }, [language]);
  const barRef = useRef(null);
  const navScrollRef = useRef(null);
  const navAnchorRef = useRef(null);
  const [floating, setFloating] = useState(false);
  const [topOffset, setTopOffset] = useState(24);
  const [navHeight, setNavHeight] = useState(0);
  const [navOffset, setNavOffset] = useState(148);
  const [navBounds, setNavBounds] = useState({ width: null, left: null });
  const SCROLL_MARGIN = 48;

  const permissions = user?.permissions || {};
  const configPerms = permissions.config || [];
  const invoicesPerms = permissions.invoicing || [];
  const hasConfigAccess =
    user?.role === "admin" ||
    configPerms.length > 0 ||
    invoicesPerms.length > 0;

  if (!hasConfigAccess) {
    return (
      <div className="p-6">
        <div className="card card--space-lg text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">
            {t("config.noAccessTitle")}
          </h2>
          <p className="text-foreground-secondary text-sm">
            {t("config.noAccessDescription")}
          </p>
        </div>
      </div>
    );
  }

  const TABS = [
    { id: "general", label: t("config.general"), Icon: Settings },
    { id: "business-type", label: t("config.businessType"), Icon: Building2, adminOnly: true },
    { id: "working-hours", label: t("config.workingHours"), Icon: Clock },
    { id: "calendar", label: t("config.calendarHours"), Icon: Clock },
    { id: "whatsapp", label: "WhatsApp", Icon: MessageCircle },
    { id: "contact", label: t("config.arca"), Icon: Receipt },
    { id: "mercadopago", label: t("config.mercadopago"), Icon: CreditCard },
    { id: "commissions", label: t("config.commissions"), Icon: Percent },
    { id: "security", label: t("config.security"), Icon: Shield },
  ];

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) {
      // Verificar si la pestaña existe en TABS
      const tabIds = TABS.map(t => t.id);
      if (tabIds.includes(tab)) {
        setActive(tab);
        // Scroll automático a la sección
        setTimeout(() => {
          const el = document.getElementById(tab);
          if (el) {
            const adjustedOffset = Math.max(0, navOffset - SCROLL_MARGIN);
            const targetY = window.scrollY + el.getBoundingClientRect().top - adjustedOffset;
            window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
          }
        }, 100);
      }
    }
  }, [searchParams, navOffset]);

  // Estados
  const [general, setGeneral] = useState({
    businessName: "",
    timezone: "America/Argentina/Buenos_Aires",
    currency: "ARS",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
  });
  const [generalHydrated, setGeneralHydrated] = useState(false);

  // Sincronizar el nombre real del tenant al cargar la página (solo una vez)
  useEffect(() => {
    if (generalHydrated) return;
    const nameFromAuth =
      (tenant && !tenant.is_system && (tenant.name || tenant.subdomain)) || "";
    const nameFromInfo =
      tenantInfo?.tenant?.name ||
      tenantInfo?.tenant?.subdomain ||
      tenantInfo?.name ||
      tenantInfo?.subdomain ||
      "";
    const resolved = nameFromAuth || nameFromInfo;
    if (resolved) {
      setGeneral((prev) => ({
        ...prev,
        businessName: prev.businessName || resolved,
      }));
      setGeneralHydrated(true);
    }
  }, [tenant, tenantInfo, generalHydrated]);


  const [contact, setContact] = useState({
    arca: "",
    whatsapp: "",
    arca_api_key: "",
    arca_cuit: "",
    arca_punto_venta: "1",
    arca_api_url: "https://api.arca.com.ar/v1",
    arca_cert_content: "",
    arca_key_content: "",
    use_certificates: false,
  });

  const [whatsappConfig, setWhatsappConfig] = useState({
    phoneDisplay: "",
    hubConfigured: false,
    hubActive: false,
    status: "pending",
    supportMessage: null,
    useOAuth: false,
    oauthAvailable: false,
    hasOAuthToken: false,
    needsPhoneNumberId: false,
    phoneNumberId: null,
    createdAt: null,
    updatedAt: null,
    supportAgentEnabled: false,
    supportAgentPhone: "",
  });

  const [botConfig, setBotConfig] = useState({
    greeting: "",
    greetingWithName: "",
    welcomeMessage: "",
    welcomeFullMessage: "",
    nameRequest: "",
    branchSelectionMessage: "",
    serviceSelectionHeader: "",
    instructorSelectionBody: "",
  });

  const [savingBotConfig, setSavingBotConfig] = useState(false);

  const [savingWhatsApp, setSavingWhatsApp] = useState(false);
  const [connectingWhatsApp, setConnectingWhatsApp] = useState(false);
  const [originalPhoneDisplay, setOriginalPhoneDisplay] = useState(""); // Para rastrear si el número fue modificado

  const [notifications, setNotifications] = useState({
    expiringSoon: true,
    expired: true,
    paid: true,
    newAppointment: true,
    cancelled: false,
  });
  const [remindersConfig, setRemindersConfig] = useState({
    enabled: false,
    advance_hours: 24,
  });

  const [workingHours, setWorkingHours] = useState({});
  const [calendarConfig, setCalendarConfig] = useState({ minTime: "06:00:00", maxTime: "23:00:00" });
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  // Estado para colapsar/expandir días (por defecto todos colapsados)
  const [expandedDays, setExpandedDays] = useState({
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
  });
  const [allDaysExpanded, setAllDaysExpanded] = useState(false); // Estado para expandir/colapsar todos
  const [bulkHours, setBulkHours] = useState({ enabled: true, start: "09:00", end: "18:00" });
  const [bookingConfig, setBookingConfig] = useState({
    require_membership: false,
  });
  const [membershipPlans, setMembershipPlans] = useState([]);
  const [loadingMembershipPlans, setLoadingMembershipPlans] = useState(false);
  const [membershipError, setMembershipError] = useState("");
  const [showWhatsAppTutorial, setShowWhatsAppTutorial] = useState(false);
  const [refreshingPhoneId, setRefreshingPhoneId] = useState(false);

  const loadMembershipPlans = useCallback(async () => {
    try {
      setLoadingMembershipPlans(true);
      setMembershipError("");
      const plans = await apiClient.listMembershipPlans();
      setMembershipPlans(Array.isArray(plans) ? plans : []);
    } catch (error) {
      logger.error("Error cargando planes de membresía:", error);
      setMembershipError(error?.response?.data?.error || error?.message || "No se pudieron cargar las membresías");
      setMembershipPlans([]);
    } finally {
      setLoadingMembershipPlans(false);
    }
  }, []);

  const [commissions, setCommissions] = useState({
    defaultPercentage: 50,
    calculateOnDeposit: false,
    showInDashboard: true,
  });
  const planInfo = tenantInfo?.plan || null;
  const PLAN_STATUS_LABELS = {
    authorized: "Activo",
    manual: "Activo (manual)",
    pending: "Pendiente",
    cancelled: "Cancelado",
    paused: "Pausado",
    error: "Error",
  };
  const formatCurrency = (value, currency = "ARS") => {
    if (value == null) return "—";
    try {
      return new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(Number(value));
    } catch {
      return `${currency} ${value}`;
    }
  };
  const formatDateTime = (value) => {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString("es-AR", {
        dateStyle: "long",
        timeStyle: "short",
      });
    } catch {
      return value;
    }
  };

  // Estados de Mercado Pago
  const [mpConfig, setMpConfig] = useState({
    deposit_enabled: false,
    deposit_percentage: 20,
    deposit_amount_fixed: null,
    // opcionales por si luego agregás límites
    deposit_min: null,
    deposit_max: null,
  });

  const [mpStatus, setMpStatus] = useState({
    connected: false,
    userId: null,
    loading: true,
    expiresAt: null,
    isExpired: false,
    liveMode: undefined,
    accountInfo: null,
    accountStatus: null,
    accountError: null,
  });

  const [connectingMP, setConnectingMP] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingArca, setTestingArca] = useState(false);
  const [arcaTestResult, setArcaTestResult] = useState(null);
  const [arcaConnectionStatus, setArcaConnectionStatus] = useState(null);
  const [arcaStatusLoading, setArcaStatusLoading] = useState(false);
  const [showArcaTutorial, setShowArcaTutorial] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [initialConfig, setInitialConfig] = useState(null);
  const [initialWhatsappConfig, setInitialWhatsappConfig] = useState(null);

  // ============================================
  // 🔄 CARGAR CONFIGURACIÓN INICIAL
  // ============================================
  const loadData = useCallback(async () => {
      try {
        const [g, c, n, contactData, w, booking, reminders, bot, wh, calendarData] = await Promise.all([
          apiClient.getConfigSection("general"),
          apiClient.getConfigSection("commissions"),
          apiClient.getConfigSection("notifications"),
          apiClient.getConfigSection("contact").catch(() => ({})), // Si no existe, retornar objeto vacío
          apiClient.getWhatsAppConfig().catch(() => ({})),
          apiClient.getAppointmentsConfig().catch(() => ({})),
          apiClient.get("/api/reminders/config").then(r => r.data?.data || {}).catch(() => ({})),
          apiClient.getConfigSection("bot").catch(() => ({})), // Configuración del bot
          apiClient.getConfigSection("working-hours").catch(() => ({})), // Horarios laborales
          apiClient.getConfigSection("calendar").catch(() => ({ minTime: "06:00:00", maxTime: "23:00:00" })), // Configuración del calendario
        ]);

        // Prefiere siempre el nombre real del tenant si está disponible
        const tenantName =
          (tenant && !tenant.is_system && (tenant.name || tenant.subdomain)) ||
          (tenantInfo?.tenant?.name || tenantInfo?.tenant?.subdomain) ||
          null;

        setGeneral({
          businessName: tenantName ?? g.businessName ?? "Mi Negocio",
          timezone: g.timezone ?? "America/Argentina/Buenos_Aires",
          currency: g.currency ?? "ARS",
          dateFormat: g.dateFormat ?? "DD/MM/YYYY",
          timeFormat: g.timeFormat ?? "24h",
        });


        setCommissions({
          defaultPercentage: Number(c.defaultPercentage ?? 50),
          calculateOnDeposit: Boolean(c.calculateOnDeposit ?? false),
          showInDashboard: Boolean(c.showInDashboard ?? true),
        });

        setNotifications({
          expiringSoon: Boolean(n.expiringSoon ?? true),
          expired: Boolean(n.expired ?? true),
          paid: Boolean(n.paid ?? true),
          newAppointment: Boolean(n.newAppointment ?? true),
          cancelled: Boolean(n.cancelled ?? false),
        });

        setRemindersConfig({
          enabled: Boolean(reminders.enabled ?? false),
          advance_hours: Number(reminders.advance_hours ?? 24),
        });
        setBookingConfig({
          require_membership: Boolean(booking.require_membership),
        });

        setContact({
          arca: contactData.arca ?? "",
          whatsapp: contactData.whatsapp ?? "",
          arca_api_key: contactData.arca_api_key ?? "",
          arca_cuit: contactData.arca_cuit ?? "",
          arca_punto_venta: contactData.arca_punto_venta ?? "1",
          arca_api_url: contactData.arca_api_url ?? "https://api.arca.com.ar/v1",
          arca_cert_content: "",
          arca_key_content: "",
          use_certificates: !!(contactData.arca_cert_path && contactData.arca_key_path),
        });
        const resolvedPhone = w.phoneDisplay ?? contactData.whatsapp ?? "";
        // Calcular estado correctamente considerando OAuth
        const hasOAuthToken = w.hasOAuthToken ?? false;
        const hubConfigured = !!w.hubConfigured;
        const hubActive = !!w.hubActive;
        let calculatedStatus = w.status;
        if (!calculatedStatus) {
          if (hubConfigured) {
            calculatedStatus = hubActive ? "ready" : "disabled";
          } else if (hasOAuthToken) {
            calculatedStatus = hubActive ? "ready" : "oauth_pending";
          } else {
            calculatedStatus = "pending";
          }
        }
        
        setWhatsappConfig({
          phoneDisplay: resolvedPhone,
          hubConfigured: hubConfigured,
          hubActive: hubActive,
          status: calculatedStatus,
          supportMessage:
            w.supportMessage ??
            (hubConfigured
              ? null
              : hasOAuthToken
              ? t("whatsapp.oauthConnectedMessage")
              : t("whatsapp.connectOneClick")),
          useOAuth: w.useOAuth ?? false,
          oauthAvailable: w.oauthAvailable ?? false,
          hasOAuthToken: hasOAuthToken,
          needsPhoneNumberId: w.needsPhoneNumberId ?? false,
          phoneNumberId: w.phoneNumberId ?? null,
          createdAt: w.createdAt ?? null,
          updatedAt: w.updatedAt ?? null,
          supportAgentEnabled: w.supportAgentEnabled ?? false,
          supportAgentPhone: w.supportAgentPhone ?? "",
        });
        
        // Guardar el número original para comparar si fue modificado
        setOriginalPhoneDisplay(resolvedPhone);


        // Cargar configuración del bot con valores por defecto
        const loadedBotConfig = {
          greeting: bot.greeting || "¡Hola! 👋",
          greetingWithName: bot.greetingWithName || "¡Hola {name}! 👋",
          welcomeMessage: bot.welcomeMessage || "¿Qué querés hacer?",
          welcomeFullMessage: bot.welcomeFullMessage || "",
          nameRequest: bot.nameRequest || "Para personalizar tu experiencia, decime tu *nombre*.\nEjemplo: *Soy Ariel*",
          branchSelectionMessage: bot.branchSelectionMessage || "Elegí la sucursal donde querés atendete:",
          serviceSelectionHeader: bot.serviceSelectionHeader || "Elegí un servicio",
          instructorSelectionBody: bot.instructorSelectionBody || "¿Con quién preferís?",
        };
        setBotConfig(loadedBotConfig);

        // Guardar configuración inicial de WhatsApp para comparar cambios
        // Normalizar supportAgentPhone: null o undefined se convierte a ""
        const normalizedSupportPhone = (w.supportAgentPhone ?? null) || "";
        setInitialWhatsappConfig({
          phoneDisplay: resolvedPhone,
          phoneNumberId: w.phoneNumberId ?? null,
          supportAgentEnabled: w.supportAgentEnabled ?? false,
          supportAgentPhone: normalizedSupportPhone,
        });

        // Cargar sucursales primero
        let branchesList = [];
        try {
          setBranchesLoading(true);
          logger.log("[ConfigPage] Cargando sucursales...");
          const response = await apiClient.listBranches();
          logger.log("[ConfigPage] Respuesta de listBranches:", response);
          branchesList = Array.isArray(response) ? response : [];
          logger.log("[ConfigPage] Sucursales procesadas:", branchesList);
          setBranches(branchesList);
          // Seleccionar la primera sucursal por defecto si hay sucursales y no hay una seleccionada
          if (branchesList.length > 0 && !selectedBranchId) {
            logger.log("[ConfigPage] Seleccionando primera sucursal:", branchesList[0].id);
            setSelectedBranchId(branchesList[0].id);
          }
        } catch (e) {
          logger.error("[ConfigPage] Error cargando sucursales:", e);
          logger.error("[ConfigPage] Error details:", e.response?.data || e.message);
          setBranches([]);
        } finally {
          setBranchesLoading(false);
        }

        // Cargar horarios laborales por sucursal
        // wh puede ser un objeto con claves como "branch_1", "branch_2", etc., o un objeto plano (legacy)
        const defaultDayHours = { enabled: true, start: "09:00", end: "18:00" };
        const defaultWeekendHours = { enabled: false, start: "09:00", end: "13:00" };
        
        let loadedWorkingHours = {};
        
        if (wh && typeof wh === 'object' && Object.keys(wh).length > 0) {
          // Si wh tiene claves que empiezan con "branch_", es el nuevo formato
          const hasBranchKeys = Object.keys(wh).some(key => key.startsWith('branch_'));
          
          if (hasBranchKeys) {
            // Nuevo formato: por sucursal
            loadedWorkingHours = wh;
          } else {
            // Formato legacy: convertir a formato por sucursal
            if (branchesList.length > 0) {
              const branchKey = `branch_${branchesList[0].id}`;
              loadedWorkingHours[branchKey] = {
                monday: wh.monday || defaultDayHours,
                tuesday: wh.tuesday || defaultDayHours,
                wednesday: wh.wednesday || defaultDayHours,
                thursday: wh.thursday || defaultDayHours,
                friday: wh.friday || defaultDayHours,
                saturday: wh.saturday || defaultWeekendHours,
                sunday: wh.sunday || defaultWeekendHours,
              };
              // Si no hay sucursal seleccionada, seleccionar la primera
              if (!selectedBranchId) {
                setSelectedBranchId(branchesList[0].id);
              }
            }
          }
        }
        
        setWorkingHours(loadedWorkingHours);
        setCalendarConfig(calendarData || { minTime: "06:00:00", maxTime: "23:00:00" });
      } catch (e) {
        logger.error("Load config failed", e);
      }
    }, [tenant, tenantInfo]);

  // Llamar loadData al montar el componente
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Establecer configuración inicial después de que todos los estados estén cargados
  useEffect(() => {
    if (general.businessName && !initialConfig && contact.arca !== undefined && remindersConfig.advance_hours !== undefined) {
      // Solo establecer initialConfig una vez cuando todos los datos estén cargados
      // Usar una copia profunda para evitar referencias
      const configSnapshot = {
        general: JSON.parse(JSON.stringify(general)),
        contact: JSON.parse(JSON.stringify(contact)),
        commissions: JSON.parse(JSON.stringify(commissions)),
        notifications: JSON.parse(JSON.stringify(notifications)),
        bookingConfig: JSON.parse(JSON.stringify(bookingConfig)),
        remindersConfig: JSON.parse(JSON.stringify(remindersConfig)),
        botConfig: JSON.parse(JSON.stringify(botConfig)),
        workingHours: JSON.parse(JSON.stringify(workingHours)),
        calendarConfig: JSON.parse(JSON.stringify(calendarConfig)),
      };
      setInitialConfig(configSnapshot);
      setHasUnsavedChanges(false); // Asegurar que no haya cambios al inicio
    }
  }, [general.businessName, contact.arca, remindersConfig.advance_hours, initialConfig]);

  // === Cargar configuración de pagos/señas (payments.*) ===
  const loadPayments = async () => {
    try {
      const r = await apiClient.get("/api/config/payments");
      const d = r.data?.data || r.data || {};
      setMpConfig({
        deposit_enabled: !!d.require_deposit,
        deposit_percentage: Number(d.deposit_percent ?? 20),
        deposit_amount_fixed: d.deposit_fixed != null ? Number(d.deposit_fixed) : null,
        deposit_min: d.deposit_min ?? null,
        deposit_max: d.deposit_max ?? null,
      });
    } catch (e) {
      logger.error("Load payments failed", e);
    }
  };


  // ============================================
  // 💳 MERCADO PAGO - MANEJO DE OAUTH
  // ============================================

  // Verificar estado de conexión
  const checkMPStatus = async () => {
    try {
      setMpStatus(prev => ({ ...prev, loading: true }));
      const data = await apiClient.getMPStatus();
      setMpStatus({
        connected: data.connected || false,
        userId: data.userId || null,
        loading: false,
        expiresAt: data.expiresAt,
        isExpired: data.isExpired || false,
        liveMode: data.liveMode,
        accountInfo: data.accountInfo || null,
        accountStatus: data.accountStatus || null,
        accountError: data.accountError || null,
      });
    } catch (err) {
      logger.error('Error verificando estado MP:', err);
      setMpStatus({
        connected: false,
        userId: null,
        loading: false,
        expiresAt: null,
        isExpired: false,
        accountInfo: null,
        accountStatus: null,
        accountError: null,
      });
    }
  };


  // Cargar estado de MP al montar
  useEffect(() => {
    checkMPStatus();
    loadPayments();
    checkArcaConnection();
  }, []);

  useEffect(() => {
    if (bookingConfig.require_membership) {
      loadMembershipPlans();
    } else {
      setMembershipPlans([]);
    }
  }, [bookingConfig.require_membership, loadMembershipPlans]);

  // Verificar conexión con ARCA
  const checkArcaConnection = async () => {
    setArcaStatusLoading(true);
    try {
      const response = await apiClient.verifyArcaConnection();
      setArcaConnectionStatus(response);
    } catch (error) {
      logger.error("Error verificando ARCA:", error);
      setArcaConnectionStatus({
        ok: false,
        error: error.response?.data?.error || error.message,
        details: error.response?.data?.details,
      });
    } finally {
      setArcaStatusLoading(false);
    }
  };

  // Generar factura de prueba
  const testArcaInvoice = async () => {
    // Validar que el CUIT esté configurado (verificar tanto el estado local como el del backend)
    const cuitToCheck = contact.arca_cuit || arcaConnectionStatus?.tenantCUIT;

    if (!cuitToCheck || String(cuitToCheck).replace(/\D/g, '').length !== 11) {
      toast.error("Por favor, ingresá un CUIT válido de 11 dígitos y guardá los cambios antes de testear.");
      return;
    }

    if (!confirm("¿Generar una factura de prueba por $121 (incluye IVA)? Esta factura se emitirá a nombre de tu CUIT.")) {
      return;
    }

    setTestingArca(true);
    setArcaTestResult(null);

    try {
      const response = await apiClient.testArcaInvoice();
      setArcaTestResult({
        success: true,
        message: response.message || "Factura generada exitosamente",
        data: response.data
      });
      toast.success("✅ Factura de prueba generada exitosamente");
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.message;
      setArcaTestResult({
        success: false,
        error: errorMsg
      });
      toast.error(`❌ Error al generar factura: ${errorMsg}`);
    } finally {
      setTestingArca(false);
    }
  };

  // Manejar retorno de OAuth (success/error en URL)
  useEffect(() => {
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    const mp = searchParams.get('mp');
    const desc = searchParams.get('desc');
    if (success === 'true') {
      toast.success('¡Mercado Pago conectado exitosamente!', {
        description: 'Ya podés empezar a recibir pagos de señas'
      });
      checkMPStatus(); // Recargar estado
      // Limpiar URL
      navigate(`/${tenantSlug}/admin/config`, { replace: true });
    }

    if (error) {
      const errorMessages = {
        'cancelled': 'Conexión cancelada',
        'invalid': 'Error al conectar con Mercado Pago',
        'invalid_state': 'Error de autenticación',
        'auth_failed': 'No se pudo autorizar la conexión',
        'server_error': 'Error del servidor',
      };
      const extra = desc ? ` (${decodeURIComponent(desc)})` : mp ? ` (${decodeURIComponent(mp)})` : '';
      toast.error('Error al conectar', { description: (errorMessages[error] || 'Error desconocido') + extra });
      navigate(`/${tenantSlug}/admin/config`, { replace: true });
    }
  }, [searchParams, navigate, tenantSlug]);

  const handleConnectMP = async () => {
    try {
      setConnectingMP(true);
      setMessage('');

      logger.log('🔍 [Frontend] Solicitando URL de autorización...');
      const data = await apiClient.getMPAuthUrl({ fresh: true });
      logger.log('✅ [Frontend] URL recibida:', data);

      if (data.ok && data.authUrl) {
        logger.log('🔄 [Frontend] Redirigiendo a Mercado Pago...');
        // Redirigir a Mercado Pago
        window.location.href = data.authUrl;
      } else {
        toast.error('Error al generar URL de autorización');
        setConnectingMP(false);
      }
    } catch (err) {
      logger.error('❌ [Frontend] Error conectando MP:', err);
      toast.error('Error al conectar con Mercado Pago', {
        description: err.response?.data?.error || err.message
      });
      setConnectingMP(false);
    }
  };

  // Desconectar Mercado Pago
  const handleDisconnectMP = async () => {
    if (!confirm('¿Estás seguro de desconectar Mercado Pago? No podrás recibir pagos de señas hasta que vuelvas a conectar.')) return;

    try {
      const data = await apiClient.disconnectMP();
      if (data.ok) {
        setMpStatus({
          connected: false,
          userId: null,
          loading: false,
          expiresAt: null,
          isExpired: false,
          accountInfo: null,
          accountStatus: null,
          accountError: null,
        });
        toast.success('Mercado Pago desconectado');
      }
    } catch (err) {
      logger.error('Error desconectando MP:', err);
      toast.error('Error al desconectar');
    }
  };

  const handleSaveWhatsApp = async (showToast = true) => {
    // Actualizar el número original cuando se guarda
    const currentPhoneDisplay = String(whatsappConfig.phoneDisplay || "").trim();
    if (currentPhoneDisplay) {
      setOriginalPhoneDisplay(currentPhoneDisplay);
    }
    const phoneDisplay = String(whatsappConfig.phoneDisplay || "").trim();
    if (!phoneDisplay) {
      toast.error(t("whatsapp.invalidPhoneToast"));
      return;
    }

    setSavingWhatsApp(true);
    try {
      const payload = { phoneDisplay };
      // Incluir phoneNumberId si está configurado (ahora es manual)
      const phoneNumberId = String(whatsappConfig.phoneNumberId || "").trim();
      if (phoneNumberId) {
        payload.phoneNumberId = phoneNumberId;
      }
      // Incluir configuración del agente de soporte (siempre enviar, incluso si está vacío para poder limpiarlo)
      payload.supportAgentEnabled = whatsappConfig.supportAgentEnabled ?? false;
      // Asegurarse de que el número se envíe correctamente (trim y validar)
      // IMPORTANTE: Siempre enviar supportAgentPhone, incluso si está vacío, para que el backend pueda actualizarlo
      const phoneToSend = whatsappConfig.supportAgentPhone 
        ? String(whatsappConfig.supportAgentPhone).trim() 
        : "";
      payload.supportAgentPhone = phoneToSend;
      
      // Log detallado para debugging
      logger.log("[WhatsApp Config] Preparando payload:", {
        phoneDisplay,
        supportAgentEnabled: payload.supportAgentEnabled,
        supportAgentPhone: payload.supportAgentPhone,
        supportAgentPhoneOriginal: whatsappConfig.supportAgentPhone,
        supportAgentPhoneType: typeof whatsappConfig.supportAgentPhone,
        phoneToSend,
        phoneToSendType: typeof phoneToSend,
        phoneToSendLength: phoneToSend.length,
      });
      
      logger.log("[WhatsApp Config] Guardando número:", phoneDisplay);
      logger.log("[WhatsApp Config] Payload completo:", JSON.stringify(payload, null, 2));
      logger.log("[WhatsApp Config] Valores de agente:", {
        supportAgentEnabled: payload.supportAgentEnabled,
        supportAgentPhone: payload.supportAgentPhone,
        supportAgentPhoneOriginal: whatsappConfig.supportAgentPhone,
        tipo: typeof payload.supportAgentPhone,
        longitud: payload.supportAgentPhone?.length,
        isEmpty: !payload.supportAgentPhone || payload.supportAgentPhone.length === 0,
      });
      
      const response = await apiClient.saveWhatsAppConfig(payload);
      logger.log("[WhatsApp Config] Respuesta del servidor:", response);
      
      // Asegurarse de que tenemos los datos correctos
      const data = response?.data || response || {};
      
      const normalized = {
        phoneDisplay: data.phoneDisplay ?? phoneDisplay,
        hubConfigured: !!data.hubConfigured,
        hubActive: !!data.hubActive,
        status: data.status ?? (data.hubConfigured ? (data.hubActive ? "ready" : "disabled") : "pending"),
        supportMessage:
          data.supportMessage ??
          (data.hubConfigured
            ? null
            : t("whatsapp.connectOneClick")),
        useOAuth: data.useOAuth ?? whatsappConfig.useOAuth ?? false,
        oauthAvailable: data.oauthAvailable ?? whatsappConfig.oauthAvailable ?? false,
        hasOAuthToken: data.hasOAuthToken ?? false,
        needsPhoneNumberId: data.needsPhoneNumberId ?? false,
        phoneNumberId: data.phoneNumberId ?? (payload.phoneNumberId || whatsappConfig.phoneNumberId) ?? null, // ✅ Mantener el phoneNumberId enviado si no viene en la respuesta
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
        supportAgentEnabled: data.supportAgentEnabled ?? whatsappConfig.supportAgentEnabled ?? false,
        supportAgentPhone: (data.supportAgentPhone ?? whatsappConfig.supportAgentPhone ?? null) || "",
      };

      logger.log("[WhatsApp Config] Datos normalizados:", normalized);
      
      setWhatsappConfig(normalized);
      setContact((prev) => ({
        ...prev,
        whatsapp: normalized.phoneDisplay,
      }));

      // Recargar datos para asegurar consistencia
      await loadData();

      if (showToast) {
        toast.success(
          normalized.hubConfigured && normalized.hubActive
            ? t("whatsapp.statusTips.ready2")
            : t("common.saveChanges")
        );
      }
    } catch (error) {
      logger.error("[WhatsApp Config] Error al guardar:", error);
      const errorMessage = error?.response?.data?.error || error?.message || "Error desconocido";
      if (showToast) {
        toast.error("No se pudo guardar el número de WhatsApp", {
          description: errorMessage,
        });
      }
      throw error; // Re-lanzar para que handleSaveAll pueda manejarlo
    } finally {
      setSavingWhatsApp(false);
    }
  };

  const handleToggleWhatsAppActive = async (nextActive) => {
    setSavingWhatsApp(true);
    try {
      const data = await apiClient.saveWhatsAppConfig({ isActive: nextActive });
      const normalized = {
        phoneDisplay: data.phoneDisplay ?? whatsappConfig.phoneDisplay,
        hubConfigured: !!data.hubConfigured,
        hubActive: !!data.hubActive,
        status: data.status ?? (data.hubConfigured ? (data.hubActive ? "ready" : "disabled") : "pending"),
        supportMessage:
          data.supportMessage ??
          (data.hubConfigured
            ? null
            : t("whatsapp.connectOneClick")),
        useOAuth: data.useOAuth ?? whatsappConfig.useOAuth ?? false,
        oauthAvailable: data.oauthAvailable ?? whatsappConfig.oauthAvailable ?? false,
        hasOAuthToken: data.hasOAuthToken ?? whatsappConfig.hasOAuthToken ?? false,
        needsPhoneNumberId: data.needsPhoneNumberId ?? whatsappConfig.needsPhoneNumberId ?? false,
        phoneNumberId: data.phoneNumberId ?? whatsappConfig.phoneNumberId ?? null,
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
        supportAgentEnabled: data.supportAgentEnabled ?? whatsappConfig.supportAgentEnabled ?? false,
        supportAgentPhone: data.supportAgentPhone ?? whatsappConfig.supportAgentPhone ?? "",
      };
      setWhatsappConfig(normalized);
      toast.success(nextActive ? t("whatsapp.assistantActivated") : t("whatsapp.assistantDeactivated"));
    } catch (error) {
      const errorMessage = error?.response?.data?.error || error?.message || "Error desconocido";
      toast.error(t("whatsapp.cantUpdateAssistantStatus"), {
        description: errorMessage,
      });
    } finally {
      setSavingWhatsApp(false);
    }
  };

  // Manejar callback de OAuth cuando regresa de Meta
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    
    if (success === "connected") {
      toast.success(t("whatsapp.connectedSuccessTitle"), {
        description: t("whatsapp.connectedSuccessDescription"),
      });
      // Recargar configuración
      loadData();
      // Limpiar parámetros de URL
      const currentPath = window.location.pathname;
      navigate(currentPath + "?tab=whatsapp", { replace: true });
    } else if (error) {
      const errorMessages = {
        token_error: "Error al obtener el token de acceso. Verificá que tu cuenta de Meta esté correctamente configurada e intentá nuevamente.",
        business_error: "No se pudo obtener información de tu cuenta de WhatsApp Business. Esto puede ocurrir si tu Empresa no tiene una cuenta de WhatsApp Business configurada todavía. Podés configurarla después y el token OAuth quedará guardado.",
        no_phone_number: "No se encontró un número de WhatsApp Business configurado en tu cuenta de Meta. Configurá un número en Meta Business Manager y luego ingresalo manualmente aquí.",
        invalid_state: "La sesión expiró. Intentá conectar nuevamente.",
        no_tenant: "No se pudo identificar tu cuenta. Intentá nuevamente.",
      };
      
      // Si es business_error, mostrar un mensaje más útil
      if (error === "business_error") {
        toast.warning(t("whatsapp.oauthConnectedButNoBusinessTitle"), {
          description: t("whatsapp.oauthConnectedButNoBusinessDescription"),
          duration: 10000,
        });
      } else {
        toast.error(errorMessages[error] || t("whatsapp.cantStartConnection"), {
          description: "Please try again or contact support if the problem persists.",
        });
      }
      
      // Recargar configuración para ver el estado actual
      loadData();
      // Limpiar parámetros de URL
      navigate(window.location.pathname + "?tab=whatsapp", { replace: true });
    }
  }, [searchParams, navigate]);

  const handleConnectWhatsApp = async () => {
    try {
      setConnectingWhatsApp(true);
      const { authUrl } = await apiClient.getWhatsAppAuthUrl();
      
      if (!authUrl) {
        toast.error(t("whatsapp.cantGenerateAuthUrl"));
        return;
      }
      
      // Redirigir a Meta OAuth
      window.location.href = authUrl;
    } catch (error) {
      const errorMessage = error?.response?.data?.error || error?.message || "Unknown error";
      toast.error(t("whatsapp.cantStartConnection"), {
        description: errorMessage,
      });
      setConnectingWhatsApp(false);
    }
  };

  const handleDisconnectWhatsApp = async () => {
    if (!confirm(t("whatsapp.disconnectConfirm"))) {
      return;
    }

    try {
      setConnectingWhatsApp(true);
      const data = await apiClient.disconnectWhatsApp();
      
      if (data.ok) {
        // Recargar la configuración
        await loadData();
        toast.success(t("whatsapp.disconnectedSuccess"));
      } else {
        toast.error(t("whatsapp.disconnectError"), {
          description: data.error || "Error desconocido",
        });
      }
    } catch (error) {
      console.error("Error desconectando WhatsApp:", error);
      toast.error(t("whatsapp.disconnectError"), {
        description: error?.response?.data?.error || error?.message || "Error desconocido",
      });
    } finally {
      setConnectingWhatsApp(false);
    }
  };


  const handleSaveBotConfig = async () => {
    setSavingBotConfig(true);
    try {
      await apiClient.saveConfigSection("bot", botConfig);
      toast.success("Configuración del bot guardada correctamente");
    } catch (error) {
      const errorMessage = error?.response?.data?.error || error?.message || "Error desconocido";
      toast.error("No se pudo guardar la configuración del bot", {
        description: errorMessage,
      });
    } finally {
      setSavingBotConfig(false);
    }
  };

  const goToMembershipPlansPage = (planId = null) => {
    const basePath = tenantSlug ? `/${tenantSlug}/admin/membresias` : "/admin/membresias";
    if (planId) {
      navigate(`${basePath}?planId=${planId}`);
    } else {
      navigate(basePath);
    }
  };

  const handlePlanToggle = async (plan) => {
    try {
      await apiClient.updateMembershipPlan(plan.id, { is_active: !plan.is_active });
      toast.success(
        plan.is_active ? "Membresía desactivada" : "Membresía activada"
      );
      await loadMembershipPlans();
    } catch (error) {
      const errorMessage = error?.response?.data?.error || error?.message || "Error desconocido";
      toast.error(errorMessage);
    }
  };

  // ============================================
  // 💾 GUARDAR CONFIGURACIÓN
  // ============================================
  const savePayments = async () => {
    const payload = {
      require_deposit: !!mpConfig.deposit_enabled,
      deposit_mode: mpConfig.deposit_amount_fixed != null ? "fixed" : "percent",
      // sólo enviar el campo correspondiente según el modo
      ...(mpConfig.deposit_amount_fixed == null
        ? { deposit_percent: Number(mpConfig.deposit_percentage || 0) }
        : { deposit_fixed: Number(mpConfig.deposit_amount_fixed || 0) }),
      // opcionales si los usás
      ...(mpConfig.deposit_min != null ? { deposit_min: Number(mpConfig.deposit_min) } : {}),
      ...(mpConfig.deposit_max != null ? { deposit_max: Number(mpConfig.deposit_max) } : {}),
    };
    await apiClient.put("/api/config/payments", payload);
  };

  const handleSaveAll = async () => {
    setSaving(true);
    setSavingWhatsApp(true);
    setSavingBotConfig(true);
    try {
      // Log para debug
      logger.log("[handleSaveAll] Contact data a guardar:", contact);
      logger.log("[handleSaveAll] arca_cuit:", contact.arca_cuit);

      // Preparar promesas de guardado
      const savePromises = [
        apiClient.saveConfigSection("general", general),
        apiClient.saveConfigSection("contact", contact),
        apiClient.saveConfigSection("commissions", commissions),
        apiClient.saveConfigSection("notifications", notifications),
        apiClient.saveConfigSection("working-hours", workingHours),
        apiClient.saveConfigSection("calendar", calendarConfig),
        apiClient.saveAppointmentsConfig(bookingConfig),
        apiClient.put("/api/reminders/config", remindersConfig),
        apiClient.saveConfigSection("bot", botConfig), // Guardar configuración del bot
        savePayments(),
      ];

      // Guardar WhatsApp si hay cambios o si no se ha inicializado
      // Normalizar valores para comparación (null, undefined, "" se tratan como equivalentes)
      const normalizePhone = (phone) => {
        if (!phone) return "";
        return String(phone).trim();
      };
      
      const currentPhone = normalizePhone(whatsappConfig.supportAgentPhone);
      const initialPhone = initialWhatsappConfig ? normalizePhone(initialWhatsappConfig.supportAgentPhone) : "";
      
      const hasWhatsAppChanges = !initialWhatsappConfig || (
        whatsappConfig.phoneDisplay !== initialWhatsappConfig.phoneDisplay ||
        whatsappConfig.phoneNumberId !== initialWhatsappConfig.phoneNumberId ||
        whatsappConfig.supportAgentEnabled !== initialWhatsappConfig.supportAgentEnabled ||
        currentPhone !== initialPhone
      );
      
      // IMPORTANTE: Si hay un número de agente configurado, siempre guardar para asegurar que se persista
      const hasSupportAgentPhone = currentPhone && currentPhone.length > 0;
      const shouldSaveWhatsApp = hasWhatsAppChanges || (hasSupportAgentPhone && !initialWhatsappConfig);
      
      if (shouldSaveWhatsApp) {
        console.log("[handleSaveAll] Guardando configuración de WhatsApp:", {
          currentPhone,
          initialPhone,
          supportAgentEnabled: whatsappConfig.supportAgentEnabled,
          hasChanges: hasWhatsAppChanges,
          hasSupportAgentPhone,
          shouldSaveWhatsApp,
        });
        savePromises.push(handleSaveWhatsApp(false)); // false = no mostrar toast individual
      } else {
        console.log("[handleSaveAll] No se guardará configuración de WhatsApp:", {
          currentPhone,
          initialPhone,
          hasWhatsAppChanges,
          hasSupportAgentPhone,
          hasInitialConfig: !!initialWhatsappConfig,
        });
      }

      await Promise.all(savePromises);
      toast.success("Configuración guardada correctamente");
      setHasUnsavedChanges(false);

      // Actualizar configuración inicial después de guardar
      setInitialConfig({
        general,
        contact,
        commissions,
        notifications,
        bookingConfig,
        remindersConfig,
        botConfig,
        workingHours,
      });

      // Actualizar configuración inicial de WhatsApp después de guardar
      if (initialWhatsappConfig) {
        try {
          // Recargar datos de WhatsApp para obtener los valores guardados del servidor
          const whatsappData = await apiClient.getWhatsAppConfig();
          const w = whatsappData?.data || {};
          const normalizedSupportPhone = (w.supportAgentPhone ?? null) || "";
          setInitialWhatsappConfig({
            phoneDisplay: w.phoneDisplay ?? whatsappConfig.phoneDisplay,
            phoneNumberId: w.phoneNumberId ?? whatsappConfig.phoneNumberId,
            supportAgentEnabled: w.supportAgentEnabled ?? whatsappConfig.supportAgentEnabled,
            supportAgentPhone: normalizedSupportPhone,
          });
        } catch (e) {
          // Si falla, usar los valores actuales
          setInitialWhatsappConfig({
            phoneDisplay: whatsappConfig.phoneDisplay,
            phoneNumberId: whatsappConfig.phoneNumberId,
            supportAgentEnabled: whatsappConfig.supportAgentEnabled,
            supportAgentPhone: whatsappConfig.supportAgentPhone || "",
          });
        }
      }

      // Recargar configuración de contacto para asegurar que el estado esté actualizado
      try {
        const contactData = await apiClient.getConfigSection("contact");
        setContact({
          arca: contactData.arca ?? "",
          whatsapp: contactData.whatsapp ?? "",
          arca_api_key: contactData.arca_api_key ?? "",
          arca_cuit: contactData.arca_cuit ?? "",
          arca_punto_venta: contactData.arca_punto_venta ?? "1",
          arca_api_url: contactData.arca_api_url ?? "https://api.arca.com.ar/v1",
          arca_cert_content: "",
          arca_key_content: "",
          use_certificates: !!(contactData.arca_cert_path && contactData.arca_key_path),
        });
      } catch (e) {
        logger.error("Error recargando configuración de contacto:", e);
      }

      // Recargar conexión ARCA después de guardar
      checkArcaConnection();
    } catch (error) {
      logger.error(error);
      const errorMessage = error?.response?.data?.error || error?.message || "Error desconocido";
      toast.error(`❌ Error al guardar la configuración: ${errorMessage}`);
    } finally {
      setSaving(false);
      setSavingWhatsApp(false);
      setSavingBotConfig(false);
    }
  };

  // ============================================
  // 📍 SCROLL & NAVEGACIÓN
  // ============================================
  useEffect(() => {
    const calcMetrics = () => {
      const appbar =
        document.querySelector("[data-appbar]") ||
        document.querySelector("nav[role='navigation']") ||
        document.querySelector("header");
      const h = appbar ? Math.ceil(appbar.getBoundingClientRect().height) : 64;
      setTopOffset(h + 16);

      if (barRef.current) {
        const { height } = barRef.current.getBoundingClientRect();
        setNavHeight(Math.ceil(height));
      }
    };

    calcMetrics();
    window.addEventListener("resize", calcMetrics, { passive: true });
    return () => window.removeEventListener("resize", calcMetrics);
  }, []);

  useEffect(() => {
    setNavOffset(topOffset + navHeight + 16);
  }, [topOffset, navHeight]);

  useEffect(() => {
    const handleScroll = () => {
      if (!navAnchorRef.current) return;
      const anchorTop =
        window.scrollY + navAnchorRef.current.getBoundingClientRect().top;
      const shouldFloat = window.scrollY + topOffset >= anchorTop;

      if (shouldFloat) {
        if (barRef.current) {
          const rect = barRef.current.getBoundingClientRect();
          setNavBounds({ width: rect.width, left: rect.left });
        }
        setFloating(true);
      } else {
        setFloating(false);
        setNavBounds({ width: null, left: null });
      }
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [topOffset]);

  useEffect(() => {
    if (!barRef.current) return;
    const { height, width, left } = barRef.current.getBoundingClientRect();
    setNavHeight(Math.ceil(height));
    if (floating) {
      setNavBounds({ width, left });
    }
  }, [floating]);

  useEffect(() => {
    const handleResize = () => {
      if (!barRef.current) return;
      const { width, left } = barRef.current.getBoundingClientRect();
      if (floating) {
        setNavBounds({ width, left });
      }
    };

    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, [floating]);

  useEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;

    const handleWheel = (event) => {
      if (!el) return;
      const { deltaY, deltaX } = event;
      if (Math.abs(deltaY) <= Math.abs(deltaX)) {
        return;
      }

      const atStart = el.scrollLeft <= 0;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;

      if ((deltaY < 0 && atStart) || (deltaY > 0 && atEnd)) {
        return;
      }

      el.scrollLeft += deltaY;
      event.preventDefault();
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Filtrar tabs según permisos del usuario
  const visibleTabs = TABS.filter((t) => {
    if (t.external) return false;
    if (t.adminOnly && user?.role !== "admin") return false;
    return true;
  });

  useEffect(() => {
    const ids = visibleTabs.map((t) => t.id);

    const calcActive = () => {
      const refY = navOffset + SCROLL_MARGIN;
      const nearBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;

      if (nearBottom) {
        setActive(ids[ids.length - 1]);
        return;
      }

      let current = ids[0];
      let bestTop = -Infinity;
      let closestDown = { id: ids[0], dist: Infinity };

      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();

        if (rect.top <= refY && rect.top > bestTop) {
          bestTop = rect.top;
          current = id;
        }

        const distDown = rect.top - refY;
        if (distDown > 0 && distDown < closestDown.dist) {
          closestDown = { id, dist: distDown };
        }
      }

      if (bestTop === -Infinity && closestDown.id) {
        current = closestDown.id;
      }

      setActive(current);
    };

    let timeoutId = null;
    const onScroll = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(calcActive, 30);
      calcActive();
    };

    const onResize = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(calcActive, 30);
      calcActive();
    };

    calcActive();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });

    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [navOffset, visibleTabs]);


  const goTo = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const adjustedOffset = Math.max(0, navOffset - SCROLL_MARGIN);
    const targetY = window.scrollY + el.getBoundingClientRect().top - adjustedOffset;
    window.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
    setActive(id);
  };

  const depositType = mpConfig.deposit_amount_fixed ? "fixed" : "percentage";

  const whatsappStatusMeta = (() => {
    switch (whatsappConfig.status) {
      case "ready":
        return {
          label: t("whatsapp.statusPanel.readyLabel"),
          className: "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300",
          bulletClass: "bg-emerald-400",
          description: t("whatsapp.statusPanel.readyDesc"),
        };
      case "disabled":
        return {
          label: t("whatsapp.statusPanel.disabledLabel"),
          className: "bg-amber-500/10 border border-amber-500/30 text-amber-200",
          bulletClass: "bg-amber-300",
          description: t("whatsapp.statusPanel.disabledDesc"),
        };
      case "oauth_pending":
        return {
          label: t("whatsapp.statusPanel.oauthLabel"),
          className: "bg-blue-500/10 border border-blue-500/30 text-blue-300",
          bulletClass: "bg-blue-400",
          description: t("whatsapp.statusPanel.oauthDesc"),
        };
      default:
        return {
          label: t("whatsapp.statusPanel.pendingLabel"),
          className: "bg-slate-500/10 border border-slate-500/30 text-slate-200",
          bulletClass: "bg-slate-300",
          description:
            whatsappConfig.supportMessage ||
            t("whatsapp.statusPanel.pendingDesc"),
        };
    }
  })();

  const whatsappStatusTips = {
    ready: [t("whatsapp.statusTips.ready1"), t("whatsapp.statusTips.ready2")],
    disabled: [t("whatsapp.statusTips.disabled1"), t("whatsapp.statusTips.disabled2")],
    oauth_pending: [t("whatsapp.statusTips.oauth1"), t("whatsapp.statusTips.oauth2")],
    pending: [t("whatsapp.statusTips.pending1"), t("whatsapp.statusTips.pending2")],
  };

  const highlightedTips =
    whatsappStatusTips[whatsappConfig.status] || whatsappStatusTips.pending;

  const navZIndex = 70;

  const handleRefreshPhoneId = async () => {
    try {
      setRefreshingPhoneId(true);
      const res = await apiClient.refreshWhatsAppPhoneId();
      const data = res?.data || res || {};
      setWhatsappConfig((prev) => ({
        ...prev,
        phoneNumberId: data.phoneNumberId ?? prev.phoneNumberId,
        updatedAt: data.updatedAt ?? prev.updatedAt,
      }));
      toast.success("Phone Number ID actualizado");
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || t("whatsapp.cantRefreshPhoneId");
      toast.error(msg);
    } finally {
      setRefreshingPhoneId(false);
    }
  };

  // Detectar cambios sin guardar (solo si initialConfig ya está establecido)
  useEffect(() => {
    if (!initialConfig) {
      setHasUnsavedChanges(false);
      return;
    }

    // Verificar cambios en configuraciones generales
    const hasGeneralChanges = initialConfig && (
      JSON.stringify(general) !== JSON.stringify(initialConfig.general) ||
      JSON.stringify(contact) !== JSON.stringify(initialConfig.contact) ||
      JSON.stringify(commissions) !== JSON.stringify(initialConfig.commissions) ||
      JSON.stringify(notifications) !== JSON.stringify(initialConfig.notifications) ||
      JSON.stringify(bookingConfig) !== JSON.stringify(initialConfig.bookingConfig) ||
      JSON.stringify(remindersConfig) !== JSON.stringify(initialConfig.remindersConfig) ||
      JSON.stringify(botConfig) !== JSON.stringify(initialConfig.botConfig) ||
      JSON.stringify(workingHours) !== JSON.stringify(initialConfig.workingHours) ||
      JSON.stringify(calendarConfig) !== JSON.stringify(initialConfig.calendarConfig || {})
    );

    // Verificar cambios en WhatsApp
    const hasWhatsAppChanges = initialWhatsappConfig && (
      whatsappConfig.phoneDisplay !== initialWhatsappConfig.phoneDisplay ||
      whatsappConfig.phoneNumberId !== initialWhatsappConfig.phoneNumberId ||
      whatsappConfig.supportAgentEnabled !== initialWhatsappConfig.supportAgentEnabled ||
      whatsappConfig.supportAgentPhone !== initialWhatsappConfig.supportAgentPhone
    );

    setHasUnsavedChanges(hasGeneralChanges || hasWhatsAppChanges);
  }, [general, contact, commissions, notifications, bookingConfig, remindersConfig, botConfig, workingHours, calendarConfig, whatsappConfig, initialConfig, initialWhatsappConfig]);

  return (
    <div className="space-y-6">
      {/* Botón flotante para guardar cambios */}
      {hasUnsavedChanges && (
        <div 
          className="fixed right-6 animate-in slide-in-from-top-2"
          style={{ 
            top: floating ? `${topOffset + navHeight + 80}px` : '160px',
            zIndex: 100
          }}
        >
          <button
            onClick={handleSaveAll}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-primary text-white font-semibold shadow-lg hover:shadow-xl transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Guardar Cambios
              </>
            )}
          </button>
        </div>
      )}

      <div ref={navAnchorRef} />
      {floating && <div style={{ height: navHeight }} />}
      {/*  barra de navegación */}
      <div
        ref={barRef}
        className="w-full px-3"
        style={
          floating
            ? {
                position: "fixed",
                top: topOffset,
                left: navBounds.left != null ? `${navBounds.left}px` : 0,
                width: navBounds.width != null ? `${navBounds.width}px` : "100%",
                zIndex: navZIndex,
              }
            : { position: "relative", zIndex: navZIndex }
        }
      >
        <div className="mx-auto max-w-7xl w-full">
          <div className="rounded-2xl border border-primary/25 bg-[rgba(10,32,48,0.9)] shadow-md backdrop-blur-xl w-full">
            <nav
              ref={navScrollRef}
              className="flex items-center justify-center gap-1.5 flex-wrap w-full px-3 py-2.5"
            >
              {visibleTabs.map(({ id, label, Icon, external }) => {
                const isActive = active === id;
                const base = "group inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] sm:text-xs font-medium transition-all flex-shrink-0";
                const on = "bg-gradient-to-r from-[#13b5cf] to-[#0d7fd4] text-white shadow-md ring-1 ring-white/20";
                const off = "text-slate-200/70 hover:text-white hover:bg-white/5 ring-1 ring-transparent hover:ring-white/10";
                return (
                  <button 
                    type="button" 
                    key={id}
                    data-tab-id={id}
                    onClick={() => (external ? navigate(`/${tenantSlug}/admin/instructores`) : goTo(id))} 
                    className={`${base} ${isActive ? on : off}`}
                    title={label}
                  >
                    <Icon className="w-3.5 h-3.5 opacity-90 group-hover:opacity-100 transition-opacity flex-shrink-0" /> 
                    <span className="whitespace-nowrap">{label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="hidden">
              {visibleTabs.map(({ id, label, Icon, external }) => {
                const isActive = active === id;
                return <button type="button" key={id} onClick={() => (external ? navigate(`/${tenantSlug}/admin/instructores`) : goTo(id))} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-all ${isActive ? "bg-gradient-to-r from-[#13b5cf] to-[#0d7fd4] text-white shadow-lg ring-2 ring-white/10" : "text-slate-200/80 hover:text-white hover:bg-white/10 ring-1 ring-transparent"}`}><Icon className="w-4 h-4 opacity-80" /> <span>{label}</span></button>;
              })}
            </div>
          </div>
        </div>
      </div>

      {/* GENERAL */}
      <div id="general">
        <ConfigSection
          title={t("config.generalTitle")}
          description={t("config.generalDescription")}
          icon={Settings}
        >
          <div className="grid md:grid-cols-2 gap-4">
            <FieldGroup label={t("config.businessName")}>
              <input
                type="text"
                value={general.businessName}
                onChange={(e) => setGeneral({ ...general, businessName: e.target.value })}
                className="input w-full"
                disabled
                title={t("config.businessNameHint")}
              />
            </FieldGroup>

            <FieldGroup label={t("config.timezone")}>
              <select
                value={general.timezone}
                onChange={(e) => setGeneral({ ...general, timezone: e.target.value })}
                className="input w-full"
              >
                <option value="America/Argentina/Buenos_Aires">Buenos Aires (GMT-3)</option>
                <option value="America/Argentina/Cordoba">Córdoba (GMT-3)</option>
                <option value="America/New_York">Nueva York (GMT-5)</option>
                <option value="Europe/Madrid">Madrid (GMT+1)</option>
              </select>
            </FieldGroup>

            <FieldGroup label={t("config.currency")}>
              <select
                value={general.currency}
                onChange={(e) => setGeneral({ ...general, currency: e.target.value })}
                className="input w-full"
              >
                <option value="ARS">Peso Argentino (ARS)</option>
                <option value="USD">Dólar (USD)</option>
                <option value="EUR">Euro (EUR)</option>
              </select>
            </FieldGroup>

            <FieldGroup label={t("config.dateFormat")}>
              <select
                value={general.dateFormat}
                onChange={(e) => setGeneral({ ...general, dateFormat: e.target.value })}
                className="input w-full"
              >
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              </select>
            </FieldGroup>
          </div>
        </ConfigSection>
      </div>

      {/* BOOKING */}
      <div id="booking">
        <ConfigSection
          title={t("booking.title")}
          description={t("booking.description")}
          icon={Shield}
        >
          <div className="space-y-4">
            <SwitchField
              label={t("booking.requireLabel")}
              description={t("booking.requireDescription")}
              checked={bookingConfig.require_membership}
              onChange={(e) =>
                setBookingConfig((prev) => ({ ...prev, require_membership: e.target.checked }))
              }
            />
            <p className="text-xs text-foreground-muted">
              {t("booking.noteDisabled")}
            </p>
            {bookingConfig.require_membership && (
              <div className="rounded-2xl border border-border/60 bg-background-secondary/50 p-4 space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t("booking.membershipPlansTitle")}</p>
                    <p className="text-xs text-foreground-muted">
                      {t("booking.membershipPlansDescription")}
                    </p>
                  </div>
                  <Button
                    onClick={() => goToMembershipPlansPage()}
                    className="flex items-center gap-2 w-full sm:w-auto justify-center"
                  >
                    <Plus className="w-4 h-4" />
                    {t("booking.newPlanButton")}
                  </Button>
                </div>

                {membershipError ? (
                  <div className="py-6 text-sm text-red-400">
                    {membershipError}
                  </div>
                ) : loadingMembershipPlans ? (
                  <div className="py-10 flex flex-col items-center gap-2 text-foreground-muted">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t("booking.loadingPlans")}
                  </div>
                ) : membershipPlans.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-foreground-muted">
                    {t("membership.emptyMessage")}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-2xl border border-border/70">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead className="bg-background-secondary/70 text-foreground-muted text-xs uppercase tracking-wide">
                        <tr>
                          <th className="text-left px-4 py-3">{t("membership.name")}</th>
                          <th className="text-left px-4 py-3">{t("membership.price")}</th>
                          <th className="text-left px-4 py-3">{t("membership.duration")}</th>
                          <th className="text-left px-4 py-3">{t("membership.status")}</th>
                          <th className="text-right px-4 py-3">{t("membership.actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {membershipPlans.map((plan) => (
                          <tr key={plan.id} className="border-t border-border/60">
                            <td className="px-4 py-3">
                              <p className="font-medium text-foreground">{plan.name}</p>
                              {plan.description && (
                                <p className="text-xs text-foreground-muted">{plan.description}</p>
                              )}
                              {(plan.max_classes_per_week || plan.max_classes_per_month || plan.max_active_appointments) ? (
                                <p className="text-xs text-foreground-muted mt-1 space-x-2">
                                  {plan.max_classes_per_week ? (
                                    <span>{t("membership.weekly")}: {plan.max_classes_per_week}</span>
                                  ) : null}
                                  {plan.max_classes_per_month ? (
                                    <span>{t("membership.monthly")}: {plan.max_classes_per_month}</span>
                                  ) : null}
                                  {plan.max_active_appointments ? (
                                    <span>{t("membership.activeAppointments")}: {plan.max_active_appointments}</span>
                                  ) : null}
                                </p>
                              ) : null}
                              <p className="text-xs text-foreground-muted mt-1 space-x-2">
                                {plan.billing_day ? (
                                  <span>{t("membership.billingDay")} {plan.billing_day}</span>
                                ) : (
                                  <span>{t("membership.billingByPaymentDate")}</span>
                                )}
                                <span>{t("membership.graceDays")}: {plan.grace_days ?? 0}</span>
                                <span>
                                  {t("membership.interest")}:{" "}
                                  {plan.interest_type === "none"
                                    ? t("membership.noInterest")
                                    : plan.interest_type === "percent"
                                    ? `${plan.interest_value ?? 0}%`
                                    : `$${plan.interest_value ?? 0}`}
                                </span>
                                <span>
                                  {t("membership.blocks")}: {plan.auto_block ? t("common.yes") : t("common.no")}
                                </span>
                              </p>
                            </td>
                            <td className="px-4 py-3 text-foreground">
                              {formatCurrency(plan.price_decimal)}
                            </td>
                            <td className="px-4 py-3 text-foreground-secondary">
                              {plan.duration_months <= 1
                                ? t("membership.oneMonth")
                                : `${plan.duration_months} ${t("membership.months")}`}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium ${
                                  plan.is_active
                                    ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40"
                                    : "bg-slate-500/10 text-slate-300 border border-slate-500/40"
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    plan.is_active ? "bg-emerald-300" : "bg-slate-300"
                                  }`}
                                />
                                {plan.is_active ? t("membership.active") : t("membership.inactive")}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => goToMembershipPlansPage(plan.id)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-foreground-secondary hover:text-primary hover:bg-primary/10 transition-colors"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  {t("membership.edit")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePlanToggle(plan)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-foreground-secondary hover:text-foreground hover:bg-border transition-colors"
                                >
                                  {plan.is_active ? t("membership.deactivate") : t("membership.activate")}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </ConfigSection>
      </div>

      {/* BUSINESS TYPE */}
      <div id="business-type">
        <ConfigSection
          title={t("config.businessTypeTitle")}
          description={t("businessType.description")}
          icon={Building2}
        >
          <BusinessTypeConfig />
        </ConfigSection>
      </div>

      {/* WORKING HOURS */}
      <div id="working-hours">
        <ConfigSection
          title={t("config.workingHoursTitle")}
          description={t("workingHours.sectionDescription")}
          icon={Clock}
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-1">{t("workingHours.infoTitle")}</h4>
                  <p className="text-xs text-foreground-secondary leading-relaxed">
                    {t("workingHours.infoTextWorkHours")}
                  </p>
                </div>
              </div>
            </div>

            {/* Selector de sucursal */}
            {branchesLoading ? (
              <div className="p-4 rounded-lg border border-border bg-background-secondary text-center">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-foreground-muted" />
                <p className="text-sm text-foreground-muted mt-2">{t("workingHours.loadingBranches")}</p>
              </div>
            ) : branches.length === 0 ? (
              <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/10">
                <p className="text-sm text-amber-300">
                  {t("workingHours.noBranches")}
                </p>
              </div>
            ) : (
              <>
                <FieldGroup label={t("workingHours.branchLabel")}>
                  <select
                    value={selectedBranchId || ""}
                    onChange={(e) => {
                      const branchId = e.target.value ? Number(e.target.value) : null;
                      setSelectedBranchId(branchId);
                    }}
                    className="input w-full"
                  >
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </FieldGroup>

                {selectedBranchId && (
                  <div className="space-y-4">
                    {/* Botón para expandir/colapsar todos */}
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          const newExpanded = !allDaysExpanded;
                          setAllDaysExpanded(newExpanded);
                          const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
                          const newState = {};
                          days.forEach(day => {
                            newState[day] = newExpanded;
                          });
                          setExpandedDays(newState);
                        }}
                        className="flex items-center gap-2 text-xs"
                      >
                        {allDaysExpanded ? (
                          <>
                            <ChevronsDownUp className="w-4 h-4" />
                            {t("workingHours.collapseAll")}
                          </>
                        ) : (
                          <>
                            <ChevronsDownUp className="w-4 h-4" />
                            {t("workingHours.expandAll")}
                          </>
                        )}
                      </Button>
                    </div>

                    <div className="grid md:grid-cols-4 gap-3 items-end">
                      <FieldGroup label={t("workingHours.bulkEnabledLabel")}>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!!bulkHours.enabled}
                            onChange={(e) => setBulkHours((prev) => ({ ...prev, enabled: e.target.checked }))}
                            className="w-5 h-5 rounded border-border text-primary focus:ring-primary"
                          />
                          <span className="text-xs text-foreground-secondary">{t("workingHours.activeDays")}</span>
                        </label>
                      </FieldGroup>
                      <FieldGroup label={t("workingHours.startLabel")}>
                        <input
                          type="time"
                          value={bulkHours.start || "09:00"}
                          onChange={(e) => setBulkHours((prev) => ({ ...prev, start: e.target.value }))}
                          className="input w-full"
                        />
                      </FieldGroup>
                      <FieldGroup label={t("workingHours.endLabel")}>
                        <input
                          type="time"
                          value={bulkHours.end || "18:00"}
                          onChange={(e) => setBulkHours((prev) => ({ ...prev, end: e.target.value }))}
                          className="input w-full"
                        />
                      </FieldGroup>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          onClick={() => {
                            const branchKey = `branch_${selectedBranchId}`;
                            const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
                            setWorkingHours((prev) => {
                              const branchHours = prev[branchKey] || {};
                              const nextBranchHours = { ...branchHours };
                              days.forEach((day) => {
                                const existing = branchHours[day] || {};
                                nextBranchHours[day] = {
                                  ...existing,
                                  enabled: !!bulkHours.enabled,
                                  start: bulkHours.start || "09:00",
                                  end: bulkHours.end || "18:00",
                                };
                              });
                              return { ...prev, [branchKey]: nextBranchHours };
                            });
                          }}
                          className="w-full"
                        >
                          {t("workingHours.applyAll")}
                        </Button>
                      </div>
                    </div>

                    {[
                      { key: "monday", label: t("workingHours.dayNames.monday") },
                      { key: "tuesday", label: t("workingHours.dayNames.tuesday") },
                      { key: "wednesday", label: t("workingHours.dayNames.wednesday") },
                      { key: "thursday", label: t("workingHours.dayNames.thursday") },
                      { key: "friday", label: t("workingHours.dayNames.friday") },
                      { key: "saturday", label: t("workingHours.dayNames.saturday") },
                      { key: "sunday", label: t("workingHours.dayNames.sunday") },
                    ].map((day) => {
                      const branchKey = `branch_${selectedBranchId}`;
                      const branchHours = workingHours[branchKey] || {};
                      const dayConfig = branchHours[day.key] || { enabled: true, start: "09:00", end: "18:00" };
                      const isExpanded = expandedDays[day.key] === true; // Solo expandido si está explícitamente en true
                      
                      return (
                        <div
                          key={day.key}
                          className="rounded-lg border border-border bg-background-secondary overflow-hidden"
                        >
                          <div className="flex items-center justify-between p-4">
                            <label className="flex items-center gap-3 cursor-pointer flex-1">
                              <input
                                type="checkbox"
                                checked={dayConfig.enabled}
                                onChange={(e) =>
                                  setWorkingHours((prev) => {
                                    const branchKey = `branch_${selectedBranchId}`;
                                    const branchHours = prev[branchKey] || {};
                                    return {
                                      ...prev,
                                      [branchKey]: {
                                        ...branchHours,
                                        [day.key]: { ...branchHours[day.key], enabled: e.target.checked },
                                      },
                                    };
                                  })
                                }
                                className="w-5 h-5 rounded border-border text-primary focus:ring-primary"
                              />
                              <span className="text-sm font-semibold text-foreground">{day.label}</span>
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedDays(prev => ({
                                  ...prev,
                                  [day.key]: !isExpanded
                                }));
                                setAllDaysExpanded(false);
                              }}
                              className="p-1 rounded hover:bg-background transition-colors"
                              aria-label={isExpanded ? t("workingHours.collapse") : t("workingHours.expand")}
                            >
                              {isExpanded ? (
                                <ChevronUp className="w-5 h-5 text-foreground-secondary" />
                              ) : (
                                <ChevronDown className="w-5 h-5 text-foreground-secondary" />
                              )}
                            </button>
                          </div>

                          {dayConfig.enabled && isExpanded && (
                            <div className="px-4 pb-4 grid grid-cols-2 gap-4">
                              <FieldGroup label={t("workingHours.startTimeLabel")}>
                                <input
                                  type="time"
                                  value={dayConfig.start || "09:00"}
                                  onChange={(e) =>
                                    setWorkingHours((prev) => {
                                      const branchKey = `branch_${selectedBranchId}`;
                                      const branchHours = prev[branchKey] || {};
                                      return {
                                        ...prev,
                                        [branchKey]: {
                                          ...branchHours,
                                          [day.key]: { ...branchHours[day.key], start: e.target.value },
                                        },
                                      };
                                    })
                                  }
                                  className="input w-full"
                                />
                              </FieldGroup>
                              <FieldGroup label={t("workingHours.endTimeLabel")}>
                                <input
                                  type="time"
                                  value={dayConfig.end || "18:00"}
                                  onChange={(e) =>
                                    setWorkingHours((prev) => {
                                      const branchKey = `branch_${selectedBranchId}`;
                                      const branchHours = prev[branchKey] || {};
                                      return {
                                        ...prev,
                                        [branchKey]: {
                                          ...branchHours,
                                          [day.key]: { ...branchHours[day.key], end: e.target.value },
                                        },
                                      };
                                    })
                                  }
                                  className="input w-full"
                                />
                              </FieldGroup>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-300 mb-1">{t("workingHours.overtimeTitle")}</p>
                  <p className="text-xs text-amber-200/90 leading-relaxed">
                    {t("workingHours.overtimeDescription")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </ConfigSection>
      </div>

      {/* CALENDAR TIME RANGE */}
      <div id="calendar">
        <ConfigSection
          title={t("config.calendarHoursTitle")}
          description={t("calendar.description")}
          icon={Clock}
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-1">{t("calendar.infoTitle")}</h4>
                  <p className="text-xs text-foreground-secondary leading-relaxed">
                    {t("calendar.infoText")}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <FieldGroup label={t("calendar.startHourLabel")}>
                <input
                  type="time"
                  value={calendarConfig.minTime?.substring(0, 5) || "06:00"}
                  onChange={(e) => setCalendarConfig({ ...calendarConfig, minTime: `${e.target.value}:00` })}
                  className="input w-full"
                />
                <p className="text-xs text-foreground-muted mt-1">
                  {t("calendar.startHourHint")}
                </p>
              </FieldGroup>

              <FieldGroup label={t("calendar.endHourLabel")}>
                <input
                  type="time"
                  value={calendarConfig.maxTime?.substring(0, 5) || "23:00"}
                  onChange={(e) => setCalendarConfig({ ...calendarConfig, maxTime: `${e.target.value}:00` })}
                  className="input w-full"
                />
                <p className="text-xs text-foreground-muted mt-1">
                  {t("calendar.endHourHint")}
                </p>
              </FieldGroup>
            </div>
          </div>
        </ConfigSection>
      </div>

      {/* WHATSAPP */}
      <div id="whatsapp">
        <ConfigSection
          title={t("whatsapp.title")}
          description={t("whatsapp.description")}
          icon={MessageCircle}
        >
          <div className="space-y-8">
            <div className="rounded-2xl border-2 border-border/60 bg-background-secondary/40 p-6 shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                    <MessageCircle className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-bold text-foreground">{t("whatsapp.tutorialTitle")}</h3>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => setShowWhatsAppTutorial((v) => !v)}
                  className="text-xs"
                >
                  {showWhatsAppTutorial ? t("whatsapp.tutorialHide") : t("whatsapp.tutorialShow")}
                </Button>
              </div>
              {showWhatsAppTutorial && (
                <div className="space-y-3 text-sm text-foreground-secondary">
                  <div className="flex items-start gap-2">
                    <span className="text-primary mt-0.5">1</span>
                    <span>
                      {t("whatsapp.tutorial.step1")}
                      {" "}
                      <a
                        href="https://business.facebook.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        {t("whatsapp.tutorial.openMetaLink")}
                      </a>
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-primary mt-0.5">2</span>
                    <span>{t("whatsapp.tutorial.step2")}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-primary mt-0.5">3</span>
                    <span>{t("whatsapp.tutorial.step3")}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-primary mt-0.5">4</span>
                    <span>{t("whatsapp.tutorial.step4")}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-primary mt-0.5">5</span>
                    <span>{t("whatsapp.tutorial.step5")}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-primary mt-0.5">6</span>
                    <span>{t("whatsapp.tutorial.step6")}</span>
                  </div>
                </div>
              )}
            </div>
            {/* PASO 1: Conexión inicial */}
            {!whatsappConfig.hubConfigured && whatsappConfig.useOAuth && !whatsappConfig.hasOAuthToken ? (
              <div className="p-6 rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-2 border-primary/30 shadow-lg">
                <div className="flex items-start gap-5">
                  <div className="p-3 rounded-xl bg-primary/20 border-2 border-primary/40">
                    <MessageCircle className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-bold text-foreground mb-2">{t("whatsapp.connectTitle")}</h3>
                    <p className="text-sm text-foreground-secondary mb-6 leading-relaxed">
                      {t("whatsapp.connectDescription")}
                    </p>
                    {whatsappConfig.oauthAvailable ? (
                      <Button
                        onClick={handleConnectWhatsApp}
                        disabled={connectingWhatsApp}
                        size="lg"
                        className="flex items-center gap-2 shadow-lg hover:shadow-xl transition-all"
                      >
                        {connectingWhatsApp ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            {t("whatsapp.connecting")}
                          </>
                        ) : (
                          <>
                            <ExternalLink className="w-5 h-5" />
                            {t("whatsapp.connect")}
                          </>
                        )}
                      </Button>
                    ) : (
                      <div className="p-4 rounded-xl bg-amber-500/10 border-2 border-amber-500/30">
                        <p className="text-sm text-amber-200/90 leading-relaxed">
                          ⚠️ Las credenciales de Meta App no están configuradas en el servidor. Contactá a soporte para configurar META_APP_ID y META_APP_SECRET.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {/* PASO 2: Configuración cuando ya está conectado */}
            {(whatsappConfig.hasOAuthToken || whatsappConfig.hubConfigured) && (
              <>
                {/* Estado y Control Principal */}
                <div className="grid gap-6 lg:grid-cols-3">
                  {/* Estado del Asistente - Sidebar */}
                  <div className="lg:col-span-1">
                    <div className="lg:sticky lg:top-6 rounded-2xl border-2 border-border/60 bg-gradient-to-br from-background-secondary/90 to-background-secondary/50 backdrop-blur-sm p-6 shadow-lg lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-base font-bold text-foreground">{t("whatsapp.status")}</h3>
                        <span
                          className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-full ${whatsappStatusMeta.className} shadow-md`}
                        >
                          <span className={`inline-flex w-2 h-2 rounded-full ${whatsappStatusMeta.bulletClass} animate-pulse`} />
                          {whatsappStatusMeta.label}
                        </span>
                      </div>
                      <p className="text-xs text-foreground-muted mb-4 leading-relaxed">
                        {whatsappStatusMeta.description}
                      </p>
                      <div className="space-y-3 pt-4 border-t border-border/40">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-foreground">{t("whatsapp.assistantActive")}</span>
                          <SwitchField
                            label=""
                            checked={whatsappConfig.hubActive}
                            disabled={(!whatsappConfig.hubConfigured && !whatsappConfig.hasOAuthToken) || savingWhatsApp}
                            onChange={(event) => handleToggleWhatsAppActive(event.target.checked)}
                          />
                        </div>
                        {whatsappConfig.updatedAt && (
                          <p className="text-xs text-foreground-muted/70 pt-2 border-t border-border/30">
                            {t("whatsapp.lastUpdate")}<br />
                            <span className="font-medium">{new Date(whatsappConfig.updatedAt).toLocaleString(language === "en" ? "en-US" : "es-AR")}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Configuración Principal */}
                  <div className="lg:col-span-2 space-y-6">
                    {/* Número de WhatsApp */}
                    <div className="rounded-2xl border-2 border-border/60 bg-background-secondary/40 p-6 shadow-lg">
                      <div className="mb-4">
                        <h3 className="text-lg font-bold text-foreground mb-2">{t("whatsapp.phoneNumberLabel")}</h3>
                        <p className="text-sm text-foreground-secondary">{t("whatsapp.phoneNumberHint")}</p>
                      </div>
                      <FieldGroup
                        label=""
                        hint={t("whatsapp.phoneNumberHint")}
                      >
                        <input
                          type="text"
                          value={whatsappConfig.phoneDisplay}
                          onChange={(e) => {
                            const value = e.target.value;
                            setWhatsappConfig((prev) => ({ ...prev, phoneDisplay: value }));
                            setContact((prev) => ({ ...prev, whatsapp: value }));
                          }}
                          className="input w-full text-base font-medium tracking-wide"
                          placeholder="+5491123456789"
                        />
                      </FieldGroup>

                      {/* Phone Number ID - Campo manual requerido */}
                      {whatsappConfig.hasOAuthToken && (
                        <div className="mt-4">
                          <FieldGroup
                            label={t("whatsapp.phoneNumberIdLabel")}
                            hint={t("whatsapp.phoneNumberIdHint")}
                          >
                            <input
                              type="text"
                              value={whatsappConfig.phoneNumberId || ""}
                              onChange={(e) => {
                                setWhatsappConfig((prev) => ({ ...prev, phoneNumberId: e.target.value }));
                              }}
                              className="input w-full text-base font-medium tracking-wide font-mono"
                              placeholder="123456789012345"
                            />
                          </FieldGroup>
                          {!whatsappConfig.phoneNumberId && (
                            <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                              <span>⚠️</span>
                              {t("whatsapp.phoneNumberIdRequired")}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Botón de Desconectar */}
                      <div className="mt-6 pt-4 border-t border-border/40">
                        <Button 
                          onClick={handleDisconnectWhatsApp} 
                          disabled={connectingWhatsApp || savingWhatsApp || saving} 
                          variant="secondary"
                          className="flex items-center gap-2 border-red-500/30 hover:border-red-500/50 text-red-400 hover:text-red-300"
                        >
                          {connectingWhatsApp ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              {t("whatsapp.disconnect")}
                            </>
                          ) : (
                            <>
                              <LogOut className="w-4 h-4" />
                              {t("whatsapp.disconnect")}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Agente de Soporte */}
                    <div className="rounded-2xl border-2 border-border/60 bg-background-secondary/40 p-6 shadow-lg">
                      <div className="flex items-start gap-4 mb-4">
                        <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                          <MessageCircle className="w-5 h-5 text-primary-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-bold text-foreground mb-1">{t("whatsapp.supportAgent")}</h3>
                          <p className="text-sm text-foreground-secondary">
                            {t("whatsapp.supportAgentDescription")}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 rounded-xl bg-background-secondary/60 border border-border/40">
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-foreground mb-1">Habilitar botón de ayuda</p>
                            <p className="text-xs text-foreground-muted">
                              Los clientes podrán solicitar hablar con un agente humano
                            </p>
                          </div>
                          <SwitchField
                            label=""
                            checked={whatsappConfig.supportAgentEnabled}
                            onChange={(event) => {
                              setWhatsappConfig((prev) => ({
                                ...prev,
                                supportAgentEnabled: event.target.checked,
                              }));
                            }}
                          />
                        </div>
                        {whatsappConfig.supportAgentEnabled && (
                          <FieldGroup
                            label="Número del agente de soporte"
                            hint={t("whatsapp.supportAgentPhoneHint")}
                          >
                            <input
                              type="text"
                              value={whatsappConfig.supportAgentPhone}
                              onChange={(e) => {
                                setWhatsappConfig((prev) => ({
                                  ...prev,
                                  supportAgentPhone: e.target.value,
                                }));
                              }}
                              className="input w-full text-base font-medium tracking-wide"
                              placeholder="5491170590570"
                            />
                          </FieldGroup>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Personalización del Bot - Solo visible si el bot está activo */}
            {whatsappConfig.hubActive && (
              <div className="rounded-2xl border-2 border-border/60 bg-background-secondary/40 p-6 shadow-lg">
                <div className="mb-6">
                  <h3 className="text-lg font-bold text-foreground mb-2">
                    {t("whatsapp.botPersonalization")}
                  </h3>
                  <p className="text-sm text-foreground-secondary">
                    {t("whatsapp.botPersonalizationDescription")}
                  </p>
                </div>

              <div className="space-y-4">
                <FieldGroup
                  label={t("whatsapp.greeting")}
                  hint={t("whatsapp.greetingHint")}
                >
                  <input
                    type="text"
                    value={botConfig.greeting}
                    onChange={(e) => setBotConfig({ ...botConfig, greeting: e.target.value })}
                    className="input w-full"
                    placeholder="¡Hola! 👋"
                  />
                </FieldGroup>

                <FieldGroup
                  label={t("whatsapp.greetingWithName")}
                  hint={t("whatsapp.greetingWithNameHint")}
                >
                  <input
                    type="text"
                    value={botConfig.greetingWithName}
                    onChange={(e) => setBotConfig({ ...botConfig, greetingWithName: e.target.value })}
                    className="input w-full"
                    placeholder="¡Hola {name}! 👋"
                  />
                </FieldGroup>

                <FieldGroup
                  label={t("whatsapp.welcomeMessage")}
                  hint={t("whatsapp.welcomeMessageHint")}
                >
                  <input
                    type="text"
                    value={botConfig.welcomeMessage}
                    onChange={(e) => setBotConfig({ ...botConfig, welcomeMessage: e.target.value })}
                    className="input w-full"
                    placeholder="¿Qué querés hacer?"
                  />
                </FieldGroup>

                <FieldGroup
                  label={t("whatsapp.welcomeFullMessage")}
                  hint={t("whatsapp.welcomeFullMessageHint")}
                >
                  <textarea
                    value={botConfig.welcomeFullMessage || ""}
                    onChange={(e) => setBotConfig({ ...botConfig, welcomeFullMessage: e.target.value })}
                    className="input w-full min-h-[120px]"
                    placeholder="¡Bienvenido a nuestro salón! {name} 👋\n\nEstamos acá para ayudarte a reservar tu turno, ver tus citas y mucho más. ¿Qué te gustaría hacer hoy?"
                  />
                </FieldGroup>

                <FieldGroup
                  label={t("whatsapp.nameRequest")}
                  hint={t("whatsapp.nameRequestHint")}
                >
                  <textarea
                    value={botConfig.nameRequest}
                    onChange={(e) => setBotConfig({ ...botConfig, nameRequest: e.target.value })}
                    className="input w-full min-h-[80px]"
                    placeholder="Para personalizar tu experiencia, decime tu *nombre*.\nEjemplo: *Soy Ariel*"
                  />
                </FieldGroup>

                <FieldGroup
                  label={t("whatsapp.branchSelection")}
                  hint={t("whatsapp.branchSelectionHint")}
                >
                  <input
                    type="text"
                    value={botConfig.branchSelectionMessage}
                    onChange={(e) => setBotConfig({ ...botConfig, branchSelectionMessage: e.target.value })}
                    className="input w-full"
                    placeholder="Elegí la sucursal donde querés atendete:"
                  />
                </FieldGroup>

                <FieldGroup
                  label={t("whatsapp.serviceSelectionHeader")}
                  hint={t("whatsapp.serviceSelectionHeaderHint")}
                >
                  <input
                    type="text"
                    value={botConfig.serviceSelectionHeader}
                    onChange={(e) => setBotConfig({ ...botConfig, serviceSelectionHeader: e.target.value })}
                    className="input w-full"
                    placeholder="Elegí un servicio"
                  />
                </FieldGroup>

                <FieldGroup
                  label={t("whatsapp.instructorSelectionBody")}
                  hint={t("whatsapp.instructorSelectionBodyHint")}
                >
                  <input
                    type="text"
                    value={botConfig.instructorSelectionBody}
                    onChange={(e) => setBotConfig({ ...botConfig, instructorSelectionBody: e.target.value })}
                    className="input w-full"
                    placeholder="¿Con quién preferís?"
                  />
                </FieldGroup>

                <div className="pt-6 mt-6 border-t-2 border-border/60">
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/10">
                    <Info className="w-4 h-4 text-primary-400" />
                    <p className="text-sm text-foreground-muted">
                      {t("whatsapp.saveChangesNote")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            )}
          </div>
        </ConfigSection>
      </div>

      {/* CONTACT */}
      <div id="contact">
        <ConfigSection
          title={t("config.arcaTitle")}
          description={t("config.arcaDescription")}
          icon={Receipt}
        >
          <div className="space-y-6">
            <div className="border-t border-border pt-6">
              <h4 className="text-sm font-semibold text-foreground mb-4">{t("arca.sectionTitle")}</h4>

              <div className="mb-4 p-4 rounded-xl bg-green-500/10 border border-green-500/30">
                <p className="text-sm text-foreground mb-2">
                  <strong className="text-green-400">{t("arca.centralizedLabel")}</strong>
                </p>
                <p className="text-xs text-foreground-secondary">
                  {t("arca.centralizedDescription")}
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <FieldGroup
                  label={t("arca.cuitLabel")}
                  hint={t("arca.cuitHint")}
                >
                  <input
                    type="text"
                    value={contact.arca_cuit}
                    onChange={(e) => setContact({ ...contact, arca_cuit: e.target.value.replace(/\D/g, '') })}
                    className="input w-full"
                    placeholder="20123456789"
                    maxLength={11}
                  />
                </FieldGroup>

                <FieldGroup
                  label={t("arca.puntoVentaLabel")}
                  hint={t("arca.puntoVentaHint")}
                >
                  <input
                    type="text"
                    value={contact.arca_punto_venta}
                    onChange={(e) => setContact({ ...contact, arca_punto_venta: e.target.value })}
                    className="input w-full"
                    placeholder="1"
                  />
                </FieldGroup>
              </div>

              {/* Estado de conexión y test */}
              <div className="space-y-4 mt-6">
                {/* Estado de conexión */}
                {arcaStatusLoading && (
                  <div className="p-4 rounded-xl border bg-background-secondary/60 border-border/60 flex items-center gap-3">
                    <Loader2 className="w-4 h-4 animate-spin text-primary-300" />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {t("config.arcaChecking")}
                      </p>
                      <p className="text-xs text-foreground-muted">
                        {t("arca.checkingNote")}
                      </p>
                    </div>
                  </div>
                )}

                {arcaConnectionStatus && !arcaStatusLoading && (
                  <div className={`p-4 rounded-xl border ${arcaConnectionStatus.ok
                    ? arcaConnectionStatus.isProduction === false
                      ? "bg-amber-500/10 border-amber-500/30"
                      : "bg-green-500/10 border-green-500/30"
                    : "bg-red-500/10 border-red-500/30"
                    }`}>
                    <div className="flex items-start gap-3">
                      {arcaConnectionStatus.ok ? (
                        arcaConnectionStatus.isProduction === false ? (
                          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                        ) : (
                          <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                        )
                      ) : (
                        <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${arcaConnectionStatus.ok 
                          ? arcaConnectionStatus.isProduction === false 
                            ? "text-amber-400" 
                            : "text-green-400" 
                          : "text-red-400"
                          }`}>
                          {arcaConnectionStatus.ok 
                            ? arcaConnectionStatus.isProduction === false 
                              ? "⚠️ Modo HOMOLOGACIÓN (pruebas)" 
                              : t("arca.connectionOk")
                            : t("arca.connectionError")}
                        </p>
                        <p className="text-xs text-foreground-secondary mt-1">
                          {arcaConnectionStatus.message || arcaConnectionStatus.error}
                        </p>
                        {arcaConnectionStatus.ok && arcaConnectionStatus.isProduction === false && (
                          <div className="mt-3 p-3 rounded-lg bg-amber-500/20 border border-amber-500/40">
                            <p className="text-xs font-semibold text-amber-300 mb-2">
                              ⚠️ ATENCIÓN: Las facturas generadas NO son válidas fiscalmente
                            </p>
                            <p className="text-xs text-amber-200/80 mb-2">
                              Estás conectado al ambiente de <strong>HOMOLOGACIÓN</strong> de AFIP. 
                              Las facturas que generes son solo de prueba y no tienen validez legal.
                            </p>
                            <p className="text-xs text-foreground-secondary">
                              Para facturar en <strong>PRODUCCIÓN</strong>, configurá en el archivo <code className="bg-background-secondary px-1 rounded">.env</code> del servidor:
                            </p>
                            <ul className="text-xs text-foreground-secondary mt-2 space-y-1 list-disc list-inside ml-2">
                              <li><code>ARCA_ENVIRONMENT=produccion</code></li>
                              <li>Certificados de producción de AFIP (no los de homologación)</li>
                              <li>Reiniciar el servidor backend</li>
                            </ul>
                          </div>
                        )}
                        {!arcaConnectionStatus.ok && arcaConnectionStatus.tenantCUIT && (
                          <p className="text-xs text-amber-400 mt-2">
                            {t("arca.cuitConfigured")}: <strong>{arcaConnectionStatus.tenantCUIT}</strong>
                            <span className="block mt-1 text-red-400">
                              {t("arca.credentialsMissing")}
                            </span>
                          </p>
                        )}
                        {!arcaConnectionStatus.ok && arcaConnectionStatus.details && (
                          <p className="text-xs text-foreground-muted mt-2">
                            {arcaConnectionStatus.details}
                          </p>
                        )}
                        {!arcaConnectionStatus.ok && (
                          <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                            <p className="text-xs font-medium text-amber-400 mb-2">
                              {t("arca.serverConfigNeeded")}
                            </p>
                            <p className="text-xs text-foreground-secondary mb-2">
                              {t("arca.envSetupIntro")} <code className="bg-background-secondary px-1 rounded">.env</code> {t("arca.onServer")}
                            </p>
                            <div className="space-y-2">
                              <div className="p-2 rounded bg-background-secondary">
                                <p className="text-xs font-medium text-foreground mb-1">{t("arca.optionA")}</p>
                                <ul className="text-xs text-foreground-secondary space-y-1 list-disc list-inside ml-2">
                                  <li><code>ARCA_API_KEY</code> - {t("arca.apiKey")}</li>
                                  <li><code>ARCA_CUIT</code> - {t("arca.cuit")}</li>
                                  <li><code>ARCA_PUNTO_VENTA</code> - {t("arca.puntoVenta")}</li>
                                  <li><code>ARCA_API_URL</code> - {t("arca.apiUrl")}</li>
                                </ul>
                              </div>
                              <div className="p-2 rounded bg-background-secondary">
                                <p className="text-xs font-medium text-foreground mb-1">{t("arca.optionB")}</p>
                                <p className="text-xs text-foreground-secondary mb-2">
                                  <strong>{t("arca.configureInFile")}</strong> <code className="bg-background px-1 rounded">.env</code> {t("arca.onServerFolder")} <code className="bg-background px-1 rounded">backend/</code>:
                                </p>
                                <ul className="text-xs text-foreground-secondary space-y-1 list-disc list-inside ml-2">
                                  <li><code>ARCA_CUIT</code> - {t("arca.cuitRequired")}</li>
                                  <li><code>ARCA_PUNTO_VENTA</code> - {t("arca.puntoVentaRequired")}</li>
                                  <li><code>P12_PATH</code> - {t("arca.p12PathRequired")}</li>
                                  <li><code>P12_PASS</code> - {t("arca.p12PassRequired")}</li>
                                  <li><code>SERVICE</code> - <span className="text-foreground-muted">{t("common.optional")}</span> {t("arca.wsaaService")}</li>
                                  <li><code>WSAA_URL</code> - <span className="text-foreground-muted">{t("common.optional")}</span> {t("arca.wsaaUrl")}</li>
                                  <li><code>WSFE_URL</code> - <span className="text-foreground-muted">{t("common.optional")}</span> {t("arca.wsfeUrl")}</li>
                                </ul>
                                <p className="text-xs text-foreground-muted mt-2 italic">
                                  <strong>{t("arca.alternative")}</strong> {t("arca.alternativeText")} <code className="bg-background px-1 rounded">backend/src/arca/</code> {t("arca.andConfigure")} <code>ARCA_CERT_PATH</code> {t("arca.and")} <code>ARCA_KEY_PATH</code> ({t("common.optional")}).
                                </p>
                              </div>
                            </div>
                            <p className="text-xs text-foreground-muted mt-2">
                              <strong>Nota:</strong> Si usás certificados, los usuarios deben delegar el servicio de facturación a tu empresa en AFIP.
                            </p>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={checkArcaConnection}
                        className="p-2 rounded-lg bg-background-secondary hover:bg-border transition-colors"
                        title={t("arca.verifyConnection")}
                      >
                        <RefreshCw className={`w-4 h-4 text-foreground-secondary`} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Botón de test */}
                <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/30">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground mb-1">
                        {t("arca.testTitle")}
                      </p>
                      <p className="text-xs text-foreground-secondary">
                        {t("arca.testDescription")}
                      </p>
                    </div>
                    <button
                      onClick={testArcaInvoice}
                      disabled={testingArca || !contact.arca_cuit || !arcaConnectionStatus?.ok}
                      className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {testingArca ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {t("arca.testGenerating")}
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" />
                          {t("arca.testCTA")}
                        </>
                      )}
                    </button>
                  </div>

                  {/* Resultado del test */}
                  {arcaTestResult && (
                    <div className={`mt-4 p-3 rounded-lg border ${arcaTestResult.success
                      ? "bg-green-500/10 border-green-500/30"
                      : "bg-red-500/10 border-red-500/30"
                      }`}>
                      {arcaTestResult.success ? (
                        <div>
                          <p className="text-sm font-medium text-green-400 mb-2">
                            ✅ {arcaTestResult.message}
                          </p>
                          {arcaTestResult.data && (
                            <div className="text-xs text-foreground-secondary space-y-1">
                              {arcaTestResult.data.cae && (
                                <p><strong>CAE:</strong> {arcaTestResult.data.cae}</p>
                              )}
                              {arcaTestResult.data.numero && (
                                <p><strong>{t("arca.testLabels.number")}:</strong> {arcaTestResult.data.numero}</p>
                              )}
                              {arcaTestResult.data.punto_venta && (
                                <p><strong>{t("arca.testLabels.pointOfSale")}:</strong> {arcaTestResult.data.punto_venta}</p>
                              )}
                              {arcaTestResult.data.fecha_emision && (
                                <p><strong>{t("arca.testLabels.date")}:</strong> {new Date(arcaTestResult.data.fecha_emision).toLocaleString(language === "en" ? "en-US" : "es-AR")}</p>
                              )}
                              {arcaTestResult.data.pdf_url && (
                                <a
                                  href={arcaTestResult.data.pdf_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline inline-flex items-center gap-1 mt-2"
                                >
                                  {t("arca.testLabels.downloadPdf")}
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-red-400">
                          ❌ {arcaTestResult.error}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 p-4 rounded-xl border border-border/60 bg-background-secondary/60 space-y-3">
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-primary-400" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {t("arca.howTitle")}
                    </p>
                    <p className="text-xs text-foreground-muted">
                      {t("arca.howDescription")}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowArcaTutorial((prev) => !prev)}
                  className="flex items-center gap-2 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  <Info className="w-4 h-4" />
                  {showArcaTutorial ? t("arca.tutorialHide") : t("arca.tutorialShow")}
                </button>

                {showArcaTutorial && (
                  <div className="p-3 rounded-lg bg-background/80 border border-border/40 text-xs text-foreground-secondary space-y-2">
                    <p className="font-semibold text-foreground">{t("arca.tutorialQuickTitle")}</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>
                        <strong>Ingresá a AFIP</strong> con clave fiscal y abrí el <em>Administrador de Relaciones</em>.
                      </li>
                      <li>
                        Elegí <strong>Delegar servicio</strong> &rarr; Buscá “Facturación Electrónica” y delegalo a la CUIT del proveedor que administra ARCA para tu estudio (<code className="bg-background px-1 rounded text-foreground">20-41834523-4</code> - ARJA ERP).
                      </li>
                      <li>
                        Volvé a esta pantalla, ingresá tu CUIT y tocá <strong>Guardar configuración</strong>.
                      </li>
                      <li>
                        Presioná <strong>Verificar conexión</strong>. Si todo está OK vas a ver el mensaje en verde.
                      </li>
                      <li>
                        Finalmente, generá la <strong>Factura de prueba</strong> para confirmar que AFIP responde correctamente.
                      </li>
                    </ol>
                    <p>
                      <strong>¿Usás tus propios certificados?</strong> Además de subir el archivo <code className="bg-background px-1 rounded text-foreground">.p12</code> (o <code className="bg-background px-1 rounded text-foreground">.crt</code>/<code className="bg-background px-1 rounded text-foreground">.key</code>), asegurate de tener habilitado el servicio WSFE/WSAA en AFIP para tu CUIT. En ese caso no necesitás delegar.
                    </p>
                  </div>
                )}

                <div className="grid md:grid-cols-3 gap-3 text-xs text-foreground-secondary">
                  <div className="p-3 rounded-lg bg-background/80 border border-border/40">
                    <p className="font-semibold text-foreground mb-1">{t("arca.steps.saveCuitTitle")}</p>
                    <p>{t("arca.steps.saveCuitText")}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-background/80 border border-border/40">
                    <p className="font-semibold text-foreground mb-1">{t("arca.steps.verifyTitle")}</p>
                    <p>{t("arca.steps.verifyText")}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-background/80 border border-border/40">
                    <p className="font-semibold text-foreground mb-1">{t("arca.steps.emitTestTitle")}</p>
                    <p>{t("arca.steps.emitTestText")}</p>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-background/60 border border-border/30 text-xs text-foreground-muted">
                  <p className="font-medium text-foreground mb-1">{t("arca.ownCertsTitle")}</p>
                  <p>
                    {t("arca.ownCertsDescription")}{" "}
                    <code className="bg-background px-1 mx-1 rounded text-foreground">.p12</code>{" "}
                    <span className="mx-1" />
                    <code className="bg-background px-1 mx-1 rounded text-foreground">.crt</code>{" "}
                    {t("common.and")}{" "}
                    <code className="bg-background px-1 mx-1 rounded text-foreground">.key</code>.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 rounded-xl bg-primary-500/10 backdrop-blur-xl border border-primary-500/30">
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="p-2 bg-primary-500/20 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-primary-400" />
                  </div>
                </div>
                <div className="text-sm text-foreground-secondary">
                  <p className="font-semibold text-foreground mb-2">{t("configGeneralInfo.title")}</p>
                  <ul className="space-y-1 list-disc list-inside ml-2">
                    <li>{t("configGeneralInfo.whatsappNumberHint")}</li>
                    <li>{t("configGeneralInfo.cuitRequiredHint")}</li>
                    <li>{t("configGeneralInfo.dataUseHint")}</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </ConfigSection>
      </div>

      {/* MERCADO PAGO */}
      <div id="mercadopago">
        <ConfigSection
          title="Mercado Pago"
          description={t("mp.sectionDescription")}
          icon={CreditCard}
        >
          {/* Estado de Conexión */}
          {mpStatus.loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 text-primary-400 animate-spin" />
            </div>
          ) : mpStatus.connected ? (
            // ✅ Conectado
            <>
              <div className="flex items-center gap-4 p-4 bg-green-500/10 border border-green-500/30 rounded-xl mb-6">
                <CheckCircle className="w-6 h-6 text-green-400 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-white font-medium">{t("mp.connectedTitle")}</p>
                  
                  {/* Información de la cuenta */}
                  {mpStatus.accountInfo ? (
                    <div className="mt-2 space-y-1">
                      {mpStatus.accountInfo.email && (
                        <p className="text-sm text-gray-300 font-medium">
                          📧 {mpStatus.accountInfo.email}
                        </p>
                      )}
                      {mpStatus.accountInfo.firstName && mpStatus.accountInfo.lastName && (
                        <p className="text-xs text-gray-400">
                          👤 {mpStatus.accountInfo.firstName} {mpStatus.accountInfo.lastName}
                        </p>
                      )}
                      {mpStatus.accountInfo.nickname && !mpStatus.accountInfo.email && (
                        <p className="text-sm text-gray-400">
                          @{mpStatus.accountInfo.nickname}
                        </p>
                      )}
                      {mpStatus.userId && (
                        <p className="text-xs text-gray-500 mt-1">
                          {t("mp.userIdLabel")}: {mpStatus.userId}
                        </p>
                      )}
                      {mpStatus.accountInfo.countryId && (
                        <p className="text-xs text-gray-500">
                          🌍 {t("mp.countryLabel")}: {mpStatus.accountInfo.countryId === 'AR' ? 'Argentina' : mpStatus.accountInfo.countryId}
                        </p>
                      )}
                    </div>
                  ) : mpStatus.userId ? (
                    <div className="mt-2">
                      <p className="text-sm text-gray-400">MP User: {mpStatus.userId}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        ⚠️ {t("mp.noAccountInfo")}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 mt-2">{t("mp.noUserIdentified")}</p>
                  )}

                  {/* Estado y modo */}
                  {mpStatus.accountStatus && (
                    <div className="mt-3 pt-3 border-t border-gray-700 space-y-1">
                      <p className={`text-xs font-medium ${
                        mpStatus.accountStatus.status === 'ready' 
                          ? 'text-green-400' 
                          : 'text-amber-400'
                      }`}>
                        {mpStatus.accountStatus.mode}
                      </p>
                      <p className="text-xs text-gray-400">
                        {mpStatus.accountStatus.message}
                      </p>
                    </div>
                  )}
                  
                  {/* Información adicional si no hay accountStatus */}
                  {!mpStatus.accountStatus && (
                    <div className="mt-2 space-y-1">
                      {mpStatus.expiresAt && (
                        <p className="text-xs text-gray-500">
                          {t("mp.tokenExpires")}: {new Date(mpStatus.expiresAt).toLocaleString(language === 'es' ? 'es-AR' : 'en-US')}
                        </p>
                      )}
                      {mpStatus.liveMode !== undefined && (
                        <p className="text-xs text-gray-500">
                          {t("mp.modeLabel")}: {mpStatus.liveMode ? t("mp.modeProduction") : t("mp.modeTesting")}
                        </p>
                      )}
                    </div>
                  )}

                  {mpStatus.accountError && (
                    <p className="text-xs text-red-400 mt-2">
                      ⚠️ {mpStatus.accountError}
                    </p>
                  )}
                </div>
                <button
                  onClick={handleDisconnectMP}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Disconnect
                </button>
              </div>

              {/* Información adicional de estado de la cuenta */}
              {mpStatus.accountStatus && mpStatus.accountStatus.status !== 'ready' && (
                <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl mb-6">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-amber-300 font-medium mb-1">Account requires attention</p>
                    <p className="text-sm text-amber-200/80 mb-2">
                      {mpStatus.accountStatus.message}
                    </p>
                    {!mpStatus.accountStatus.verified && (
                      <p className="text-xs text-amber-200/70 mb-1">
                        • {t("mp.checkCanReceive")}
                      </p>
                    )}
                    {!mpStatus.accountStatus.canReceivePayments && mpStatus.liveMode && (
                      <p className="text-xs text-amber-200/70 mb-1">
                        {t("mp.checkCanReceive")}
                      </p>
                    )}
                    {!mpStatus.liveMode && (
                      <p className="text-xs text-amber-200/70 mb-1">
                        {t("mp.inTestingMode")}
                      </p>
                    )}
                    <a
                      href="https://www.mercadopago.com.ar/home"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-amber-300 hover:text-amber-200 underline inline-flex items-center gap-1 mt-2"
                    >
                      {t("mp.viewAccount")} →
                    </a>
                  </div>
                </div>
              )}

              {mpStatus.isExpired && (
                <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl mb-6">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-amber-300 font-medium mb-1">{t("mp.tokenExpiredTitle")}</p>
                    <p className="text-sm text-amber-200/80">
                      {t("mp.tokenExpiredDesc")}
                    </p>
                  </div>
                </div>
              )}

              {/* Configuración de señas (solo si está conectado y no expirado) */}
              {!mpStatus.isExpired && (
                <div className="space-y-6">
                  {/* Toggle Activar/Desactivar Señas */}
                  <div className="p-6 border-b border-border">
                    <label className="flex items-center justify-between cursor-pointer group">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-gradient-to-br from-primary to-accent rounded-xl group-hover:scale-110 transition-transform">
                          <DollarSign className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-foreground">{t("mp.deposit.requireTitle")}</h3>
                          <p className="text-sm text-foreground-muted">{t("mp.deposit.requireDesc")}</p>
                        </div>
                      </div>
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={mpConfig.deposit_enabled}
                          onChange={e => setMpConfig({ ...mpConfig, deposit_enabled: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-14 h-7 bg-background-secondary peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-primary"></div>
                      </div>
                    </label>
                  </div>

                  {/* Tipo de Seña */}
                  {mpConfig.deposit_enabled && (
                    <div className="space-y-6">
                      {/* Cards de selección */}
                      <div className="grid md:grid-cols-2 gap-4">
                        {/* Porcentaje */}
                        <button
                          onClick={() => setMpConfig({ ...mpConfig, deposit_amount_fixed: null })}
                          className={`p-6 rounded-xl border-2 transition-all text-left group ${depositType === 'percentage'
                            ? 'border-primary bg-primary-light dark:bg-primary/20'
                            : 'border-border bg-background-secondary hover:border-border-hover'
                            }`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className={`p-2 rounded-lg ${depositType === 'percentage'
                              ? 'bg-primary-light dark:bg-primary/20'
                              : 'bg-background-secondary group-hover:bg-border'
                              }`}>
                              <Percent className={`w-5 h-5 ${depositType === 'percentage' ? 'text-primary-400' : 'text-dark-400'
                                }`} />
                            </div>
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${depositType === 'percentage'
                              ? 'border-primary bg-primary'
                              : 'border-border'
                              }`}>
                              {depositType === 'percentage' && (
                                <div className="w-2 h-2 bg-white rounded-full"></div>
                              )}
                            </div>
                          </div>
                          <h4 className="font-semibold text-foreground mb-1">{t("mp.deposit.percentageTitle")}</h4>
                          <p className="text-sm text-foreground-muted">{t("mp.deposit.percentageDesc")}</p>
                        </button>

                        {/* Monto Fijo */}
                        <button
                          onClick={() => setMpConfig({ ...mpConfig, deposit_amount_fixed: 1000 })}
                          className={`p-6 rounded-xl border-2 transition-all text-left group ${depositType === 'fixed'
                            ? 'border-accent-500 bg-accent-500/10'
                            : 'border-dark-700 bg-dark-900/30 hover:border-dark-600'
                            }`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className={`p-2 rounded-lg ${depositType === 'fixed'
                              ? 'bg-accent-500/20'
                              : 'bg-dark-700/50 group-hover:bg-dark-700'
                              }`}>
                              <DollarSign className={`w-5 h-5 ${depositType === 'fixed' ? 'text-accent-400' : 'text-dark-400'
                                }`} />
                            </div>
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${depositType === 'fixed'
                              ? 'border-accent-500 bg-accent-500'
                              : 'border-dark-600'
                              }`}>
                              {depositType === 'fixed' && (
                                <div className="w-2 h-2 bg-white rounded-full"></div>
                              )}
                            </div>
                          </div>
                          <h4 className="font-semibold text-foreground mb-1">{t("mp.deposit.fixedTitle")}</h4>
                          <p className="text-sm text-foreground-muted">{t("mp.deposit.fixedDesc")}</p>
                        </button>
                      </div>

                      {/* Input de valor */}
                      <div className="space-y-2">
                        {depositType === 'percentage' ? (
                          <>
                            <label className="flex items-center gap-2 text-sm font-medium text-foreground-secondary">
                              <Percent className="w-4 h-4" />
                              {t("mp.deposit.percentageLabel")}
                            </label>
                            <div className="relative">
                              <input
                                type="number"
                                value={mpConfig.deposit_percentage || 20}
                                onChange={(e) => setMpConfig({ ...mpConfig, deposit_percentage: parseFloat(e.target.value) })}
                                className="input pr-12"
                                placeholder="20"
                                min="1"
                                max="100"
                              />
                              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground-muted font-medium">%</span>
                            </div>
                            <p className="text-sm text-foreground-muted">
                              {t("mp.deposit.percentageExample")} ${((5000 * (mpConfig.deposit_percentage || 20)) / 100).toFixed(0)}
                            </p>
                          </>
                        ) : (
                          <>
                            <label className="flex items-center gap-2 text-sm font-medium text-foreground-secondary">
                              <DollarSign className="w-4 h-4" />
                              {t("mp.deposit.fixedAmountLabel")}
                            </label>
                            <div className="relative">
                              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted font-medium">$</span>
                              <input
                                type="number"
                                value={mpConfig.deposit_amount_fixed || ''}
                                onChange={(e) => setMpConfig({ ...mpConfig, deposit_amount_fixed: parseFloat(e.target.value) || null })}
                                className="input pl-10"
                                placeholder="1000"
                                min="0"
                                step="100"
                              />
                            </div>
                            <p className="text-sm text-foreground-muted">
                              {t("mp.depositFixedInfo", { amount: mpConfig.deposit_amount_fixed || 1000 })}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Info Card */}
                  <div className="mt-6 bg-primary-500/10 backdrop-blur-xl rounded-xl border border-primary-500/30 p-6">
                    <div className="flex gap-4">
                      <div className="flex-shrink-0">
                        <div className="p-2 bg-primary-500/20 rounded-lg">
                          <AlertCircle className="w-5 h-5 text-primary-400" />
                        </div>
                      </div>
                      <div className="space-y-3">
                        <h3 className="font-semibold text-primary-400">{t("mp.infoImportantTitle")}</h3>
                        <ul className="space-y-2 text-sm text-dark-300">
                          <li className="flex items-start gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary-400 mt-2 flex-shrink-0"></div>
                            <span>The connection is secure and we do not share your credentials</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary-400 mt-2 flex-shrink-0"></div>
                            <span>You can disconnect your account at any time</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary-400 mt-2 flex-shrink-0"></div>
                            <span>MP charges a transaction fee (~4-5%)</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary-400 mt-2 flex-shrink-0"></div>
                            <span>Los pagos se acreditan en 24-48hs hábiles</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary-400 mt-2 flex-shrink-0"></div>
                            <span>You get paid directly into your MP account</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            // ❌ No conectado
            <div className="space-y-4">
              <div className="p-4 bg-primary-500/10 border border-primary-500/30 rounded-xl">
                <p className="text-dark-300 mb-4">
                  Connect your Mercado Pago account to start securely receiving deposit payments.
                </p>
                <button
                  onClick={handleConnectMP}
                  disabled={connectingMP}
                  className="w-full flex items-center justify-center gap-3 py-3 px-6 bg-gradient-to-r from-primary-500 to-primary-600 text-white font-semibold rounded-xl hover:from-primary-600 hover:to-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-primary-500/30"
                >
                  {connectingMP ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {t("mp.connecting")}
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                      </svg>
                      {t("mp.connectCTA")}
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-start gap-3 p-4 bg-background-secondary rounded-xl border border-border">
                <AlertCircle className="w-5 h-5 text-foreground-muted mt-0.5 flex-shrink-0" />
                <div className="text-sm text-foreground-muted">
                  <p className="mb-2">{t("mp.authPrompt")}</p>
                  <ul className="space-y-1 list-disc list-inside ml-2 mb-3">
                    <li>{t("mp.authItems.createPreferences")}</li>
                    <li>{t("mp.authItems.receiveNotifications")}</li>
                    <li>{t("mp.authItems.accessTransactions")}</li>
                  </ul>
                  <p className="text-xs text-foreground-muted/80 mt-2 pt-2 border-t border-border">
                    <strong>Nota:</strong> Si aparece un error de "aplicación no preparada", verifica que el redirect_uri esté configurado en tu aplicación de Mercado Pago. 
                    El redirect_uri debe ser: <code className="text-xs bg-background px-1 py-0.5 rounded">{window.location.origin}/mp/oauth/callback</code>
                  </p>
                </div>
              </div>
            </div>
          )}
        </ConfigSection>
      </div>

      {/* COMMISSIONS */}
      <div id="commissions">
        <ConfigSection
          title={t("commissionsConfig.title")}
          description={t("commissionsConfig.description")}
          icon={Percent}
        >
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <FieldGroup label={t("commissionsConfig.defaultPercentageLabel")} hint={t("commissionsConfig.defaultPercentageHint")}>
              <input
                type="number"
                min="0"
                max="100"
                step="5"
                value={commissions.defaultPercentage}
                onChange={(e) => setCommissions({ ...commissions, defaultPercentage: Number(e.target.value) })}
                className="input w-full"
              />
            </FieldGroup>
          </div>

          <div className="space-y-2">
            <SwitchField
              label={t("commissionsConfig.calculateOnDepositLabel")}
              description={t("commissionsConfig.calculateOnDepositDesc")}
              checked={commissions.calculateOnDeposit}
              onChange={(e) => setCommissions({ ...commissions, calculateOnDeposit: e.target.checked })}
            />

            <SwitchField
              label={t("commissionsConfig.showInDashboardLabel")}
              description={t("commissionsConfig.showInDashboardDesc")}
              checked={commissions.showInDashboard}
              onChange={(e) => setCommissions({ ...commissions, showInDashboard: e.target.checked })}
            />
          </div>

          <div className="mt-6 p-4 rounded-xl bg-primary-600/10 border border-primary-600/20">
            <p className="text-sm text-primary-300 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <span>
                {t("commissionsConfig.configureIndividualsPrefix")}{" "}
                <button
                  onClick={() => navigate(`/${tenantSlug}/admin/comisiones`)}
                  className="underline font-medium hover:text-primary-200"
                >
                  {t("commissionsConfig.clickHere")}
                </button>
              </span>
            </p>
          </div>
        </ConfigSection>
      </div>

      {/* RECORDATORIOS DE TURNOS */}
      <div id="reminders" className="mt-12">
        <ConfigSection
          title={t("reminders.title")}
          description={t("reminders.description")}
          icon={Bell}
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
              <div className="flex items-start gap-3">
                <Bell className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-1">{t("reminders.whatAreTitle")}</h4>
                  <p className="text-xs text-foreground-secondary leading-relaxed">
                    {t("reminders.whatAreDescription")}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <SwitchField
                label={t("reminders.enableLabel")}
                description={t("reminders.enableDesc")}
                checked={remindersConfig.enabled}
                onChange={(checked) => setRemindersConfig(prev => ({ ...prev, enabled: checked }))}
              />

              {remindersConfig.enabled && (
                <div className="space-y-3">
                  <FieldGroup
                    label={t("reminders.whenLabel")}
                    hint={t("reminders.whenHint")}
                  >
                    <div className="flex items-baseline gap-3">
                      <input
                        type="number"
                        min="0"
                        max="168"
                        value={remindersConfig.advance_hours}
                        onChange={(e) => {
                          const value = Math.max(0, Math.min(168, Number(e.target.value) || 24));
                          setRemindersConfig(prev => ({ ...prev, advance_hours: value }));
                        }}
                        className="input w-24 text-base font-semibold text-center"
                      />
                      <span className="text-sm font-medium text-foreground">
                        {remindersConfig.advance_hours === 0
                          ? t("reminders.immediate")
                          : remindersConfig.advance_hours === 1 
                          ? t("reminders.oneHour") 
                          : remindersConfig.advance_hours === 24
                          ? t("reminders.oneDay")
                          : remindersConfig.advance_hours > 24 && remindersConfig.advance_hours % 24 === 0
                          ? t("reminders.daysBefore", { hours: remindersConfig.advance_hours })
                          : t("reminders.hoursBefore")}
                      </span>
                    </div>
                    <div className="mt-3 p-3 rounded-lg bg-background-secondary border border-border/50">
                      <p className="text-xs font-medium text-foreground-secondary mb-2">{t("reminders.examplesTitle")}</p>
                      <ul className="text-xs text-foreground-muted space-y-1">
                        <li>{t("reminders.examples.oneDay")}</li>
                        <li>{t("reminders.examples.twoDays")}</li>
                        <li>{t("reminders.examples.twoHours")}</li>
                        <li>{t("reminders.examples.twelveHours")}</li>
                      </ul>
                    </div>
                  </FieldGroup>
                </div>
              )}

              {remindersConfig.enabled && (
                <>
                  <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <div className="flex items-start gap-3">
                      <Info className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-2">
                        <p className="text-sm font-semibold text-amber-300">{t("reminders.importantTitle")}</p>
                        <div className="space-y-2 text-xs text-amber-200/90">
                          <div className="flex items-start gap-2">
                            <span className="text-amber-400 mt-0.5">•</span>
                            <span>{t("reminders.importantItems.auto")}</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-amber-400 mt-0.5">•</span>
                            <span>{t("reminders.importantItems.statuses")}</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-amber-400 mt-0.5">•</span>
                            <span>{t("reminders.importantItems.once")}</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-amber-400 mt-0.5">•</span>
                            <span>{t("reminders.importantItems.interval")}</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-amber-400 mt-0.5">•</span>
                            <span>{t("reminders.importantItems.requirement")}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg border border-border bg-background-secondary">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <Button
                        onClick={async () => {
                          try {
                            const response = await apiClient.post("/api/reminders/send");
                            const data = response.data || response;
                            if (data.ok) {
                              toast.success(
                                data.sent > 0
                                  ? `Se enviaron ${data.sent} recordatorios`
                                  : "No hay turnos que requieran recordatorio en este momento"
                              );
                            } else {
                              toast.error(data.error || "Error al enviar recordatorios");
                            }
                          } catch (error) {
                            toast.error(error?.response?.data?.error || "Error al enviar recordatorios");
                          }
                        }}
                        className="flex items-center gap-2 w-full sm:w-auto"
                      >
                        <Bell className="w-4 h-4" />
                        Enviar recordatorios ahora
                      </Button>
                      <p className="text-xs text-foreground-secondary flex-1">
                        Envía recordatorios manualmente para turnos que están dentro de la ventana de tiempo configurada. Útil para probar o enviar recordatorios inmediatamente.
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </ConfigSection>
      </div>

      {/* NOTIFICATIONS — sección temporalmente deshabilitada a pedido */}

      {/* SECURITY */}
      <div id="security">
        <ConfigSection
          title={t("config.securityTitle")}
          description={t("security.description")}
          icon={Shield}
        >
          <div className="space-y-4">
            <div className="p-4 rounded-lg border border-border bg-background-secondary">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-1">
                    {t("security.twoFactorTitle")}
                  </h4>
                  <p className="text-xs text-foreground-muted">
                    {t("security.twoFactorDescription")}
                  </p>
                </div>
                <button
                  onClick={() => navigate(`/${tenantSlug}/admin/2fa`)}
                  className="btn-primary flex items-center gap-2"
                >
                  <Shield className="w-4 h-4" />
                  {t("security.setup2fa")}
                </button>
              </div>
            </div>
          </div>
        </ConfigSection>
      </div>

      {/* Footer */}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div className="text-sm text-dark-600">
            {t("config.changesApplyImmediately")}
          </div>
          <button
            onClick={handleSaveAll}
            disabled={saving}
            className="btn-primary flex items-center gap-2"
          >
            {saving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                {t("config.saving")}
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {t("config.saveChanges")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Legacy MembershipPlanModal (reemplazado por la página /admin/membresias)
function MembershipPlanModal({ form, onClose, onChange, onSubmit, saving }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 bg-black/60 backdrop-blur-sm">
      <div className="card w-full max-w-lg relative border border-border/70 p-6 sm:p-7">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-foreground-secondary hover:text-foreground"
          aria-label="Cerrar"
        >
          <X className="w-5 h-5" />
        </button>
        <h3 className="text-xl font-semibold text-foreground mb-4">
          {form?.id ? "Editar plan de membresía" : "Nuevo plan de membresía"}
        </h3>
        <div className="space-y-4">
          <FieldGroup label="Nombre">
            <input
              type="text"
              value={form?.name ?? ""}
              onChange={(e) => onChange("name", e.target.value)}
              className="input w-full"
              placeholder="Ej: Mensual Clásica"
            />
          </FieldGroup>
          <FieldGroup label="Precio mensual">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form?.price_decimal ?? 0}
              onChange={(e) => onChange("price_decimal", e.target.value)}
              className="input w-full"
            />
          </FieldGroup>
          <FieldGroup label="Duración (meses)">
            <input
              type="number"
              min="1"
              value={form?.duration_months ?? 1}
              onChange={(e) => onChange("duration_months", e.target.value)}
              className="input w-full"
            />
          </FieldGroup>
          <div>
            <p className="text-xs uppercase text-foreground-muted tracking-wide mb-2">
              Límites (dejá vacío para ilimitado)
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldGroup label="Clases por semana">
                <input
                  type="number"
                  min="0"
                  value={form?.max_classes_per_week ?? ""}
                  onChange={(e) => onChange("max_classes_per_week", e.target.value)}
                  className="input w-full"
                  placeholder="ej. 3"
                />
              </FieldGroup>
              <FieldGroup label="Clases por mes">
                <input
                  type="number"
                  min="0"
                  value={form?.max_classes_per_month ?? ""}
                  onChange={(e) => onChange("max_classes_per_month", e.target.value)}
                  className="input w-full"
                  placeholder="ej. 10"
                />
              </FieldGroup>
              <FieldGroup label="Turnos activos simultáneos">
                <input
                  type="number"
                  min="0"
                  value={form?.max_active_appointments ?? ""}
                  onChange={(e) => onChange("max_active_appointments", e.target.value)}
                  className="input w-full"
                  placeholder="ej. 4"
                />
              </FieldGroup>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldGroup label="Día de vencimiento">
              <input
                type="number"
                min="1"
                max="31"
                value={form?.billing_day ?? ""}
                onChange={(e) => onChange("billing_day", e.target.value)}
                className="input w-full"
                placeholder="Ej: 10"
              />
              <p className="text-xs text-foreground-muted mt-1">
                Dejalo vacío para que se calcule desde la fecha de pago.
              </p>
            </FieldGroup>
            <FieldGroup label="Días de gracia">
              <input
                type="number"
                min="0"
                value={form?.grace_days ?? ""}
                onChange={(e) => onChange("grace_days", e.target.value)}
                className="input w-full"
              />
            </FieldGroup>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldGroup label="Interés por mora">
              <select
                value={form?.interest_type ?? "none"}
                onChange={(e) => onChange("interest_type", e.target.value)}
                className="input w-full"
              >
                <option value="none">Sin interés</option>
                <option value="fixed">Monto fijo</option>
                <option value="percent">Porcentaje</option>
              </select>
            </FieldGroup>
            {form?.interest_type !== "none" && (
              <FieldGroup label={form?.interest_type === "percent" ? "Porcentaje" : "Monto fijo"}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form?.interest_value ?? 0}
                  onChange={(e) => onChange("interest_value", e.target.value)}
                  className="input w-full"
                  placeholder={form?.interest_type === "percent" ? "Ej: 5" : "Ej: 1500"}
                />
              </FieldGroup>
            )}
          </div>
          <div className="border border-border rounded-xl p-3">
            <SwitchField
              label="Bloquear automáticamente al vencer"
              description="Si está activo, los clientes con deuda no podrán reservar cuando pase el vencimiento + gracia."
              checked={form?.auto_block ?? true}
              onChange={(e) => onChange("auto_block", e.target.checked)}
            />
          </div>
          <FieldGroup label="Descripción (opcional)">
            <textarea
              value={form?.description ?? ""}
              onChange={(e) => onChange("description", e.target.value)}
              className="input w-full min-h-[90px]"
            />
          </FieldGroup>
          <div className="border border-border rounded-xl p-3">
            <SwitchField
              label="Plan activo"
              description={
                form?.id
                  ? "Podés pausar temporalmente la venta de este plan."
                  : "Los planes nuevos se crean activos."
              }
              checked={form?.is_active ?? true}
              disabled={!form?.id}
              onChange={(e) => onChange("is_active", e.target.checked)}
            />
          </div>
          <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onSubmit}
              className="btn-primary"
              disabled={saving}
            >
              {saving ? "Guardando..." : form?.id ? "Guardar cambios" : "Crear plan"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
*/
