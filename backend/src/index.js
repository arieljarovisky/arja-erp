// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

// Routers
import { health } from "./routes/health.js";
import { meta } from "./routes/meta.js";
import { appointments } from "./routes/appointments.js";
import { availability } from "./routes/availability.js";
import { waTest } from "./routes/wa-test.js";
import { whatsapp } from "./routes/whatsapp.js";
import { waTemplates } from "./routes/waTemplates.js";
import { customers } from "./routes/customers.js";
import { adminDashboard } from "./routes/adminDashboard.js";
import { customersAdmin } from "./routes/customersAdmin.js";
import { admin as adminRouter } from "./routes/admin.js";
import { mpWebhook } from "./routes/mpWebhook.js";
import { calendar } from "./routes/calendar.js";
import { payments } from "./routes/payments.js";
import { auth } from "./routes/auth.js";
import { config } from "./routes/config.js";
import { whatsappAgent } from "./routes/whatsappAgent.js";
import { instructorCommission } from "./routes/instructorCommission.js";
import { instructorStats } from "./routes/instructorStats.js";
import { notifications } from "./routes/notifications.js";
import { workingHours } from "./routes/workingHours.js";
import { depositsAdmin } from "./routes/depositsAdmin.js";
import { identifyTenant, requireTenant, requireActiveSubscription, requireSuperAdmin } from "./auth/tenant.js";
import { requireAuth, requireRole } from "./auth/middlewares.js";
import { daysOff } from "./routes/daysOff.js";
import invoicing from "./routes/invoicing.js";
import { mpOAuth } from "./routes/mpOAuth.js";
import { googleOAuth } from "./routes/googleOAuth.js";
import businessTypes from "./routes/businessTypes.js";
import stock from "./routes/stock.js";
import stockReservations from "./routes/stockReservations.js";
import stockTransfers from "./routes/stockTransfers.js";
import stockAlerts from "./routes/stockAlerts.js";
import stockValuation from "./routes/stockValuation.js";
import invoicingArca from "./routes/invoicingArca.js";
import users from "./routes/users.js";
import classesRouter from "./routes/classes.js";
import { setArcaPool } from "./services/arca.js";
import { pool } from "./db.js";
import onboardingPublic from "./routes/onboardingPublic.js";
import superAdminRouter from "./routes/superAdmin.js";
import subscriptions from "./routes/subscriptions.js";
import instructorsAdmin from "./routes/instructorsAdmin.js";
import memberships from "./routes/memberships.js";
import branchesRouter from "./routes/branches.js";
import enterpriseRequestRouter from "./routes/enterpriseRequest.js";
import { cashRegister } from "./routes/cashRegister.js";
import { reminders } from "./routes/reminders.js";
import { chat } from "./routes/chat.js";
import { ecommerce } from "./routes/ecommerce.js";
import ecommerceIntegrations from "./routes/ecommerceIntegrations.js";
import ecommerceIntegrationsPublic from "./routes/ecommerceIntegrationsPublic.js";
import { customerPublic } from "./routes/customerPublic.js";
import { customerOAuth } from "./routes/customerOAuth.js";
import { workoutRoutines } from "./routes/workoutRoutines.js";
import customerAppSettings from "./routes/customerAppSettings.js";
import testEmail from "./routes/testEmail.js";
import crm from "./routes/crm.js";
import fetch from "node-fetch";
import { upsertTenantWhatsAppCredentials } from "./services/whatsappHub.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { sendWhatsAppText, sendWhatsAppTemplate } from "./whatsapp.js";
dotenv.config();

// Inicializar pool de ARCA
setArcaPool(pool);

// Asegurar columnas necesarias en tablas críticas
async function ensureSchema() {
  try {
    await pool.query(`ALTER TABLE instructor ADD COLUMN phone_e164 VARCHAR(32) NULL`);
  } catch {}
  try {
    await pool.query(`ALTER TABLE appointment ADD COLUMN push_reminder_sent_at DATETIME NULL`);
  } catch {}
}

const app = express();

/* =========================
   Log global de requests con tiempos de respuesta
   OPTIMIZADO: Solo loguea en desarrollo o errores en producción
========================= */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ENABLE_REQUEST_LOGGING = process.env.ENABLE_REQUEST_LOGGING === 'true' || !IS_PRODUCTION;

app.use((req, res, next) => {
    const startTime = Date.now();
    
    // Interceptar el método end para medir el tiempo
    const originalEnd = res.end;
    res.end = function(...args) {
        const duration = Date.now() - startTime;
        
        // En producción: solo loggear errores o requests muy lentos (>2s)
        // En desarrollo: loggear todo
        if (ENABLE_REQUEST_LOGGING || res.statusCode >= 500 || duration > 2000) {
        const statusColor = res.statusCode >= 500 ? '🔴' : res.statusCode >= 400 ? '🟡' : '🟢';
            console.log(
                `${statusColor} [RES] ${req.method} ${req.originalUrl} ` +
                `→ ${res.statusCode} (${duration}ms)`
            );
        }
        
        originalEnd.apply(this, args);
    };
    
    next();
});

/* =========================
   Rate Limiting básico (sin dependencias externas)
   OPTIMIZADO: Protege contra requests excesivos que saturan CPU
========================= */
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const RATE_LIMIT_MAX_REQUESTS = 300; // 300 requests por minuto por IP (aumentado para soportar polling de múltiples componentes)

function rateLimitMiddleware(req, res, next) {
  // Saltar rate limiting para health checks, webhooks y rutas de autenticación
  if (
    req.path === '/api/health' || 
    req.path.startsWith('/api/mp-webhook') || 
    req.path.startsWith('/api/webhooks/') ||
    req.path.startsWith('/auth/google') ||
    req.path.startsWith('/auth/')
  ) {
    return next();
  }

  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  
  // Limpiar entradas antiguas
  if (rateLimitStore.size > 10000) {
    for (const [key, value] of rateLimitStore.entries()) {
      if (now - value.firstRequest > RATE_LIMIT_WINDOW) {
        rateLimitStore.delete(key);
      }
    }
  }

  const key = ip;
  const record = rateLimitStore.get(key);

  if (!record || now - record.firstRequest > RATE_LIMIT_WINDOW) {
    // Nueva ventana de tiempo
    rateLimitStore.set(key, {
      firstRequest: now,
      count: 1
    });
    return next();
  }

  record.count++;
  
  if (record.count > RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      ok: false,
      error: 'Demasiadas solicitudes. Por favor, intenta más tarde.'
    });
  }

  next();
}

/* =========================
   Middlewares base
========================= */
const ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:8081", // Expo dev server
    "http://localhost:19006", // Expo web dev server alternativo
     process.env.FRONTEND_URL,
     process.env.FRONTEND_URL_HTTPS
].filter(Boolean);

// Función para validar si un origen está permitido
function isOriginAllowed(origin) {
    if (!origin) return true; // Permitir requests sin origin (ej: Postman, curl)
    
    // Permitir localhost en desarrollo (cualquier puerto) - verificar primero
    if (origin.includes('localhost:') || origin.includes('127.0.0.1:')) {
        return true;
    }
    
    // Verificar si está en la lista de orígenes permitidos
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    
    // Permitir dominios de Vercel (cualquier subdominio de vercel.app)
    if (origin.includes('.vercel.app')) return true;
    
    // Permitir dominios personalizados comunes (puedes agregar más patrones aquí)
    const allowedPatterns = [
        /^https?:\/\/.*\.vercel\.app$/,
        /^https?:\/\/.*\.netlify\.app$/,
    ];
    
    return allowedPatterns.some(pattern => pattern.test(origin));
}

// Ejecutar aseguramiento de schema al iniciar
ensureSchema().catch(() => {});

app.use(
    cors({
        origin(origin, cb) {
            // Log para debugging en desarrollo
            if (!IS_PRODUCTION) {
                console.log(`[CORS] Request from origin: ${origin || 'no origin'}`);
            }
            
            if (isOriginAllowed(origin)) {
                if (!IS_PRODUCTION) {
                    console.log(`[CORS] Origin allowed: ${origin}`);
                }
                return cb(null, true);
            }
            
            if (!IS_PRODUCTION) {
                console.log(`[CORS] Origin blocked: ${origin}`);
            }
            return cb(new Error(`CORS blocked: ${origin}`));
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "X-Tenant-ID",
            "X-Client-Type",
            "ngrok-skip-browser-warning",
            "X-Branch-Mode",
        ],
        exposeHeaders: ["X-Total-Count"],
        preflightContinue: false,
        optionsSuccessStatus: 204,
    })
);
app.set("trust proxy", 1);

// Aumentar límite de body para permitir imágenes base64 (hasta 10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Middleware para verificar que la BD esté disponible (solo para rutas críticas)
let dbConnectionReady = false;

// Verificar conexión a BD al iniciar
async function verifyDatabaseConnection() {
  try {
    await pool.query("SELECT 1");
    dbConnectionReady = true;
    console.log("✅ [DB] Conexión a base de datos verificada");
  } catch (error) {
    console.warn("⚠️ [DB] Error verificando conexión:", error.message);
    dbConnectionReady = false;
    // Reintentar después de 2 segundos
    setTimeout(verifyDatabaseConnection, 2000);
  }
}

// Iniciar verificación
verifyDatabaseConnection();

// Middleware para rutas que requieren BD (excepto health check)
app.use((req, res, next) => {
  // Health check y webhooks no requieren verificación de BD
  if (req.path === '/api/health' || req.path.startsWith('/api/mp-webhook') || req.path.startsWith('/api/webhooks/')) {
    return next();
  }
  
  // Si la BD no está lista, devolver error 503
  if (!dbConnectionReady) {
    return res.status(503).json({
      ok: false,
      error: "Servicio temporalmente no disponible. Por favor, intenta nuevamente en unos segundos."
    });
  }
  
  next();
});

// Rate limiting (aplicar después de express.json pero antes de rutas)
app.use(rateLimitMiddleware);

/* =========================
   RUTAS PÚBLICAS (sin middleware de seguridad)
========================= */
app.use("/api/health", health);
app.use("/api/mp-webhook", mpWebhook);
app.use("/api/webhooks/mp", mpWebhook);
app.use("/", whatsapp);
app.use("/api/whatsapp", whatsapp);
app.use("/auth", auth);
app.use("/auth/google", googleOAuth);
// ✅ MP OAuth (maneja sus propios middlewares internamente)
app.use("/mp/oauth", mpOAuth);  // 👈 UNA SOLA VEZ
app.use("/public/onboarding", onboardingPublic);
app.use("/public", enterpriseRequestRouter);
app.use("/api/chat", chat); // Chat con IA (público para landing page)
app.use("/api/public/ecommerce", ecommerceIntegrationsPublic);
app.use("/api/public/customer", customerPublic); // Endpoints públicos para clientes (app móvil)
app.use("/api/public/customer/oauth", customerOAuth); // OAuth para clientes (app móvil)
app.use("/api/workout-routines", workoutRoutines); // Rutinas de ejercicios con IA
app.use("/api", customerAppSettings); // Configuración de app por cliente (tema, precios, horarios, notificaciones)
app.use("/api/test-email", testEmail); // Endpoint de prueba de email

// Callback público de OAuth de WhatsApp (llamado por Meta sin token)
// IMPORTANTE: Debe estar ANTES de los middlewares de autenticación
app.get("/api/config/whatsapp/callback", async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    // Función helper para construir URL de redirección con slug si está disponible
    const buildRedirectUrl = async (error = null, tenantIdFromState = null) => {
      let tenantSlug = "";
      
      // Intentar obtener slug del state si está disponible
      if (state) {
        try {
          const fromBase64Url = (s) => {
            if (!s) return "";
            s = String(s).replace(/-/g, "+").replace(/_/g, "/");
            while (s.length % 4 !== 0) s += "=";
            return Buffer.from(s, "base64").toString();
          };
          const stateData = JSON.parse(fromBase64Url(state));
          tenantSlug = stateData?.tenantSlug || "";
          
          // Si no hay slug en el state pero hay tenantId, obtenerlo de la BD
          if (!tenantSlug && (tenantIdFromState || stateData?.tenantId)) {
            const tid = tenantIdFromState || stateData?.tenantId;
            try {
              const [[tenant]] = await pool.query("SELECT subdomain FROM tenant WHERE id = ? LIMIT 1", [tid]);
              tenantSlug = tenant?.subdomain || "";
            } catch (err) {
              // Ignorar error
            }
          }
        } catch (err) {
          // Si falla parsear el state, continuar sin slug
        }
      }
      
      const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      const path = tenantSlug ? `/${tenantSlug}/admin/config` : `/admin/config`;
      const params = error 
        ? `?tab=whatsapp&error=${encodeURIComponent(error)}`
        : `?tab=whatsapp&success=connected`;
      
      return `${baseUrl}${path}${params}`;
    };

    if (oauthError) {
      console.error("[WA OAuth] Error en callback:", oauthError);
      const redirectUrl = await buildRedirectUrl(oauthError);
      return res.redirect(redirectUrl);
    }

    if (!code || !state) {
      const redirectUrl = await buildRedirectUrl("missing_params");
      return res.redirect(redirectUrl);
    }

    // Decodificar state
    const fromBase64Url = (s) => {
      if (!s) return "";
      s = String(s).replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4 !== 0) s += "=";
      return Buffer.from(s, "base64").toString();
    };

    let stateData;
    try {
      stateData = JSON.parse(fromBase64Url(state));
    } catch (e) {
      console.error("[WA OAuth] State inválido:", e);
      const redirectUrl = await buildRedirectUrl("invalid_state");
      return res.redirect(redirectUrl);
    }

    let tenantId = stateData?.tenantId;
    
    // Si no hay tenantId en el state, intentar obtenerlo del state almacenado
    if (!tenantId) {
      const storedState = global.waOAuthStates?.get(state);
      tenantId = storedState?.tenantId;
    }
    
    if (!tenantId) {
      const redirectUrl = await buildRedirectUrl("no_tenant");
      return res.redirect(redirectUrl);
    }
    
    // Función helper para obtener slug y construir URL de redirección (usa tenantId ya validado)
    const getRedirectUrl = async (error = null) => {
      let tenantSlug = stateData?.tenantSlug;
      if (!tenantSlug) {
        try {
          const [[tenant]] = await pool.query("SELECT subdomain FROM tenant WHERE id = ? LIMIT 1", [tenantId]);
          tenantSlug = tenant?.subdomain || "";
        } catch (err) {
          console.error("[WA OAuth] Error obteniendo slug:", err);
        }
      }
      
      const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      const path = tenantSlug ? `/${tenantSlug}/admin/config` : `/admin/config`;
      const params = error 
        ? `?tab=whatsapp&error=${encodeURIComponent(error)}`
        : `?tab=whatsapp&success=connected`;
      
      return `${baseUrl}${path}${params}`;
    };

    // Verificar state (limpiar expirados)
    if (global.waOAuthStates) {
      for (const [key, value] of global.waOAuthStates.entries()) {
        if (value.expAt < Date.now()) {
          global.waOAuthStates.delete(key);
        }
      }
    }

    const storedState = global.waOAuthStates?.get(state);
    if (!storedState || storedState.tenantId !== tenantId) {
      const redirectUrl = await getRedirectUrl("invalid_state");
      return res.redirect(redirectUrl);
    }

    // Limpiar state usado
    global.waOAuthStates.delete(state);

    // Intercambiar código por access_token
    const baseUrlFromReq = (req) => {
      const envBase =
        process.env.API_URL ||
        process.env.BACKEND_URL ||
        process.env.SERVER_URL ||
        process.env.BASE_URL;
      if (envBase) return String(envBase).replace(/\/+$/, "");
      const proto =
        (req.headers["x-forwarded-proto"] &&
          String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
        req.protocol ||
        "https";
      const host = req.headers["x-forwarded-host"] || req.get("host");
      return `${proto}://${host}`;
    };
    const redirectUri = `${baseUrlFromReq(req)}/api/config/whatsapp/callback`;
    
    const tokenResponse = await fetch("https://graph.facebook.com/v21.0/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        redirect_uri: redirectUri,
        code: code,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}));
      console.error("[WA OAuth] Error obteniendo token:", errorData);
      const redirectUrl = await getRedirectUrl("token_error");
      return res.redirect(redirectUrl);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      const redirectUrl = await getRedirectUrl("no_token");
      return res.redirect(redirectUrl);
    }

    // Obtener phone_number_id desde WhatsApp Business Accounts
    // Meta no permite anidar whatsapp_business_accounts en /me/businesses, así que usamos una estrategia diferente
    let phoneNumberId = null;
    let phoneDisplay = null;
    const WA_API_VERSION = process.env.WHATSAPP_API_VERSION || "v24.0";

    try {
      // Método 1: Intentar obtener directamente desde /me (el más directo)
      const wabaResponse = await fetch(
        `https://graph.facebook.com/${WA_API_VERSION}/me?fields=whatsapp_business_accounts{id,display_phone_number,phone_number_id,verified_name}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (wabaResponse.ok) {
        const wabaData = await wabaResponse.json();
        const wabaAccounts = wabaData.whatsapp_business_accounts?.data || [];
        
        if (wabaAccounts.length > 0) {
          const waba = wabaAccounts[0];
          phoneNumberId = waba.phone_number_id;
          phoneDisplay = waba.display_phone_number || waba.verified_name || null;
          console.log(`[WA OAuth] ✅ Phone_number_id obtenido desde /me: ${phoneNumberId}`);
        }
      }
    } catch (err) {
      console.log(`[WA OAuth] ⚠️ Error obteniendo desde /me:`, err.message);
    }

    // Método 2: Si no funcionó, obtener businesses y luego sus WABAs por separado
    if (!phoneNumberId) {
      try {
        const businessResponse = await fetch(
          `https://graph.facebook.com/${WA_API_VERSION}/me/businesses?fields=id,name`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (businessResponse.ok) {
          const businessData = await businessResponse.json();
          const businesses = businessData.data || [];

          // Para cada business, intentar obtener sus WhatsApp Business Accounts
          for (const business of businesses) {
            try {
              const wabaResponse = await fetch(
                `https://graph.facebook.com/${WA_API_VERSION}/${business.id}/owned_whatsapp_business_accounts?fields=id,display_phone_number,phone_number_id,verified_name`,
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                }
              );

              if (wabaResponse.ok) {
                const wabaData = await wabaResponse.json();
                const wabaAccounts = wabaData.data || [];
                
                if (wabaAccounts.length > 0) {
                  const waba = wabaAccounts[0];
                  phoneNumberId = waba.phone_number_id;
                  phoneDisplay = waba.display_phone_number || waba.verified_name || null;
                  console.log(`[WA OAuth] ✅ Phone_number_id obtenido desde business ${business.id}: ${phoneNumberId}`);
                  break;
                }
              }
            } catch (err) {
              // Continuar con el siguiente business
              console.log(`[WA OAuth] ⚠️ Error obteniendo WABA de business ${business.id}:`, err.message);
            }
          }
        }
      } catch (err) {
        console.log(`[WA OAuth] ⚠️ Error obteniendo businesses:`, err.message);
      }
    }

    // Método 3: Si no se encontró, intentar obtenerlo desde los números de teléfono del sistema
    if (!phoneNumberId) {
      try {
        const phoneNumbersResponse = await fetch(
          `https://graph.facebook.com/${WA_API_VERSION}/me/phone_numbers?fields=id,display_phone_number,verified_name`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (phoneNumbersResponse.ok) {
          const phoneNumbersData = await phoneNumbersResponse.json();
          const phoneNumbers = phoneNumbersData.data || [];
          if (phoneNumbers.length > 0) {
            // Usar el primer número disponible
            const phone = phoneNumbers[0];
            // Intentar obtener el phone_number_id desde el número
            const wabaFromPhoneResponse = await fetch(
              `https://graph.facebook.com/${WA_API_VERSION}/${phone.id}?fields=whatsapp_business_accounts{phone_number_id}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );
            
            if (wabaFromPhoneResponse.ok) {
              const wabaFromPhoneData = await wabaFromPhoneResponse.json();
              if (wabaFromPhoneData.whatsapp_business_accounts?.data?.[0]?.phone_number_id) {
                phoneNumberId = wabaFromPhoneData.whatsapp_business_accounts.data[0].phone_number_id;
                phoneDisplay = phone.display_phone_number || phone.verified_name || null;
                console.log(`[WA OAuth] ✅ Phone_number_id obtenido desde phone_numbers: ${phoneNumberId}`);
              }
            }
          }
        }
      } catch (err) {
        console.log(`[WA OAuth] ⚠️ Error obteniendo números de teléfono:`, err.message);
      }
    }

    // Si aún no hay phone_number_id, guardar las credenciales de todas formas
    // El usuario puede ingresar el número manualmente y el phone_number_id se obtendrá después
    if (!phoneNumberId) {
      console.warn("[WA OAuth] No se encontró phone_number_id, pero guardando credenciales. Intentando obtener automáticamente...");
      
      // Usar un placeholder temporal para phoneNumberId (se actualizará cuando se obtenga)
      const placeholderPhoneNumberId = `pending:${tenantId}:${Date.now()}`;
      
      // Guardar accessToken con placeholder para phoneNumberId
      // Aunque falta phone_number_id, activamos el bot para que esté listo cuando el usuario ingrese el número
      await upsertTenantWhatsAppCredentials(tenantId, {
        phoneNumberId: placeholderPhoneNumberId, // Placeholder temporal
        accessToken: accessToken,
        phoneDisplay: null,
        isActive: true, // Activar automáticamente incluso sin phone_number_id (se obtendrá después)
        managedBy: "user_oauth",
        managedNotes: "Credenciales OAuth obtenidas. Phone_number_id pendiente. Bot activado automáticamente.",
      });

      console.log(`[WA OAuth] ✅ Credenciales guardadas (sin phone_number_id) y bot activado para tenant ${tenantId}. Intentando obtener phone_number_id automáticamente...`);

      // ✅ Intentar obtener phone_number_id automáticamente en background (sin bloquear la respuesta)
      // Esto se ejecutará después de que el usuario guarde el número
      // Por ahora, solo guardamos el placeholder y el usuario puede guardar el número después

      // Redirigir con mensaje indicando que debe ingresar el número
      const returnUrl = await getRedirectUrl();
      console.log(`[WA OAuth] Redirigiendo a: ${returnUrl}`);
      return res.redirect(returnUrl);
    }

    // Guardar credenciales OAuth y activar automáticamente el bot
    // El bot se activa automáticamente cuando hay credenciales OAuth válidas
    await upsertTenantWhatsAppCredentials(tenantId, {
      phoneNumberId: phoneNumberId,
      accessToken: accessToken,
      phoneDisplay: phoneDisplay || null,
      isActive: true, // Activar automáticamente cuando hay credenciales OAuth válidas
      managedBy: "user_oauth", // Indica que fue configurado por OAuth del usuario
      managedNotes: "Credenciales obtenidas mediante OAuth de Meta. Bot activado automáticamente.",
    });

    console.log(`[WA OAuth] ✅ Credenciales de WhatsApp Business guardadas y bot activado automáticamente para tenant ${tenantId}.`);

    // Verificar automáticamente si las plantillas necesarias existen
    // Esto se hace en background para no bloquear la redirección
    (async () => {
      try {
        const WA_API_VERSION = process.env.WHATSAPP_API_VERSION || "v24.0";
        const requiredTemplates = ["confirmacion_turno", "reabrir_chat"];
        const languageCodes = ["es_AR", "es", "es_419", "es_MX", "es_ES"];
        
        // Obtener WABA ID para verificar plantillas
        let wabaId = null;
        try {
          const wabaResponse = await fetch(
            `https://graph.facebook.com/${WA_API_VERSION}/me?fields=whatsapp_business_accounts{id}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          );
          
          if (wabaResponse.ok) {
            const wabaData = await wabaResponse.json();
            wabaId = wabaData.whatsapp_business_accounts?.data?.[0]?.id;
          }
        } catch (err) {
          console.log(`[WA OAuth] No se pudo obtener WABA ID para verificar plantillas:`, err.message);
        }
        
        if (wabaId) {
          // Verificar cada plantilla requerida
          const missingTemplates = [];
          for (const templateName of requiredTemplates) {
            let templateExists = false;
            for (const lang of languageCodes) {
              try {
                const templateResponse = await fetch(
                  `https://graph.facebook.com/${WA_API_VERSION}/${wabaId}/message_templates?name=${templateName}&language=${lang}`,
                  {
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                    },
                  }
                );
                
                if (templateResponse.ok) {
                  const templateData = await templateResponse.json();
                  if (templateData.data && templateData.data.length > 0) {
                    templateExists = true;
                    break;
                  }
                }
              } catch (err) {
                // Continuar con el siguiente idioma
              }
            }
            
            if (!templateExists) {
              missingTemplates.push(templateName);
            }
          }
          
          if (missingTemplates.length > 0) {
            console.log(`[WA OAuth] ⚠️ Plantillas faltantes para tenant ${tenantId}:`, missingTemplates);
            // Guardar información sobre plantillas faltantes (podría usarse para mostrar un asistente en el frontend)
            // Por ahora solo lo logueamos, pero el sistema funcionará con fallback a texto
          } else {
            console.log(`[WA OAuth] ✅ Todas las plantillas necesarias existen para tenant ${tenantId}`);
          }
        }
      } catch (err) {
        // No bloquear el flujo si falla la verificación
        console.log(`[WA OAuth] ⚠️ Error verificando plantillas (no crítico):`, err.message);
      }
    })();

    // Redirigir a la página de configuración con el slug del tenant
    const returnUrl = await getRedirectUrl();
    console.log(`[WA OAuth] Redirigiendo a: ${returnUrl}`);

    return res.redirect(returnUrl);
  } catch (e) {
    console.error("[GET /api/config/whatsapp/callback] error:", e);
    // Intentar obtener tenantId para construir URL correcta incluso en caso de error
    let errorRedirectUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/admin/config?tab=whatsapp&error=${encodeURIComponent(e.message)}`;
    
    try {
      const stateData = req.query.state ? JSON.parse(Buffer.from(String(req.query.state).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()) : null;
      const tenantId = stateData?.tenantId;
      if (tenantId) {
        const [[tenant]] = await pool.query("SELECT subdomain FROM tenant WHERE id = ? LIMIT 1", [tenantId]);
        const tenantSlug = tenant?.subdomain || "";
        if (tenantSlug) {
          errorRedirectUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/${tenantSlug}/admin/config?tab=whatsapp&error=${encodeURIComponent(e.message)}`;
        }
      }
    } catch (err) {
      // Si falla, usar URL sin slug
    }
    
    return res.redirect(errorRedirectUrl);
  }
});

/* MIDDLEWARE DE TENANT para /api/* */
app.use("/api", identifyTenant);

/* =========================
   SUPER ADMIN (sin requerir tenant)
========================= */
app.use("/api/super-admin", requireAuth);
app.use("/api/super-admin", requireSuperAdmin, superAdminRouter);


/* =========================
   RUTAS /API PÚBLICAS CON TENANT (sin requireAuth)
========================= */
app.use("/api/availability", availability);

/* =========================
   MIDDLEWARE DE SEGURIDAD (solo para rutas protegidas)
========================= */
app.use("/api", requireAuth);
app.use("/api", requireTenant);

// ═══════════════════════════════════════════════════════════
// RUTAS PÚBLICAS PARA CLIENTES (ANTES DE requireActiveSubscription)
// ═══════════════════════════════════════════════════════════
// Las rutas de membresías deben estar ANTES de requireActiveSubscription
// para permitir que los clientes accedan sin verificar suscripción del tenant
app.use("/api/memberships", memberships);

/* =========================
   MIDDLEWARE DE SUSCRIPCIÓN ACTIVA
========================= */
// Aplicar requireActiveSubscription solo a rutas administrativas
// (las rutas de membresías ya están arriba, así que no se verán afectadas)
app.use("/api", requireActiveSubscription);

/* =========================
   RUTAS PROTEGIDAS
========================= */
// Core
app.use("/api/appointments", appointments);
app.use("/api/calendar", calendar);
app.use("/api/customers", identifyTenant, requireRole("admin", "staff", "user"), customers);
app.use("/api/payments", payments);
app.use("/api/config", config);
app.use("/api/whatsapp/agent", identifyTenant, whatsappAgent);
app.use("/api/commissions", instructorCommission);
app.use("/api/working-hours", workingHours);
app.use("/api/days-off", daysOff);
app.use("/api/invoicing", requireRole("admin", "staff", "user"), invoicing);
app.use("/api/cash-register", cashRegister);
app.use("/api/stats", requireRole("admin", "staff", "user"), instructorStats);

// Meta (servicios, instructores, etc.)
app.use("/api/meta", meta);

// Notificaciones
app.use("/api", notifications);

// Recordatorios
app.use("/api/reminders", reminders);
app.use("/api/crm", requireRole("admin", "staff"), crm);

// Nuevos módulos multi-industria - Stock debe ir ANTES de los middlewares globales de admin
// para que checkStockPermission pueda verificar los permisos específicos
app.use("/api/business-types", businessTypes);
app.use("/api/stock", stock);
app.use("/api/stock", stockReservations);
app.use("/api/stock", stockTransfers);
app.use("/api/stock", stockAlerts);
app.use("/api/stock", stockValuation);

// Admin
app.use("/api/admin", requireRole("admin", "staff", "user"), depositsAdmin);
app.use("/api/admin/customers", requireRole("admin", "staff", "user"), customersAdmin);
app.use("/api/admin", requireRole("admin", "staff", "user"), adminRouter);
app.use("/api", requireRole("admin", "staff", "user"), adminDashboard); // Dashboard en /api/dashboard
app.use("/api/admin", requireRole("admin", "staff", "user"), instructorsAdmin);
// invoicingArca debe ir ANTES de invoicing para que las rutas /arca/* tengan prioridad
app.use("/api/invoicing", invoicingArca);
app.use("/api/ecommerce", ecommerce);
app.use("/api/ecommerce", ecommerceIntegrations);
app.use("/api/users", users);
app.use("/api/classes", classesRouter);
app.use("/api/subscriptions", subscriptions);
app.use("/api/branches", branchesRouter);

/* =========================
   Job automático de recordatorios
   OPTIMIZADO: Procesa tenants en lotes con delays para evitar saturación
========================= */
let isRemindersJobRunning = false;

async function runRemindersJob() {
  // Prevenir ejecuciones concurrentes
  if (isRemindersJobRunning) {
    console.log(`⏭️ [Reminders Job] Job ya en ejecución, saltando...`);
    return;
  }

  isRemindersJobRunning = true;
  const jobStartTime = Date.now();

  try {
    // Obtener todos los tenants activos (limitado a 50 por ejecución para evitar saturación)
    const [tenants] = await pool.query(
      `SELECT id FROM tenant WHERE is_active = 1 LIMIT 50`
    );

    if (tenants.length === 0) {
      return;
    }

    console.log(`🔄 [Reminders Job] Procesando ${tenants.length} tenants...`);

    // Procesar tenants con delay entre cada uno para evitar saturación
    for (let i = 0; i < tenants.length; i++) {
      const tenant = tenants[i];
      
      // Delay progresivo: más delay si hay muchos tenants
      if (i > 0 && i % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 segundo cada 5 tenants
      }

      try {
        // Verificar si los recordatorios están habilitados para este tenant
        const [[enabledRow]] = await pool.query(
          `SELECT config_value FROM system_config 
           WHERE tenant_id = ? AND config_key = 'reminders.enabled'`,
          [tenant.id]
        );
        
        const enabled = enabledRow?.config_value === "1" || enabledRow?.config_value === "true";
        if (!enabled) continue;

        const [[hoursRow]] = await pool.query(
          `SELECT config_value FROM system_config 
           WHERE tenant_id = ? AND config_key = 'reminders.advance_hours'`,
          [tenant.id]
        );
        const advanceHours = Number(hoursRow?.config_value) || 24;

        // Calcular ventana de tiempo para recordatorios
        const now = new Date();
        const reminderWindowStart = new Date(now.getTime() + advanceHours * 60 * 60 * 1000);
        const reminderWindowEnd = new Date(reminderWindowStart.getTime() + 60 * 60 * 1000); // Ventana de 1 hora

        // Buscar turnos que necesitan recordatorio (query optimizada con LIMIT)
        const [appointments] = await pool.query(
          `SELECT 
            a.id,
            a.starts_at,
            a.status,
            a.deposit_decimal,
            c.name AS customer_name,
            c.phone_e164,
            s.name AS service_name,
            s.price_decimal,
            i.name AS instructor_name
          FROM appointment a
          JOIN customer c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
          JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
          JOIN instructor i ON i.id = a.instructor_id AND i.tenant_id = a.tenant_id
          WHERE a.tenant_id = ?
            AND a.status IN ('scheduled', 'confirmed', 'deposit_paid', 'pending_deposit')
            AND a.starts_at >= ?
            AND a.starts_at <= ?
            AND (a.reminder_sent_at IS NULL OR a.reminder_sent_at < DATE_SUB(a.starts_at, INTERVAL ? HOUR))
            AND c.phone_e164 IS NOT NULL
            AND c.phone_e164 != ''
          ORDER BY a.starts_at ASC
          LIMIT 20`,
          [tenant.id, reminderWindowStart, reminderWindowEnd, advanceHours]
        );

        if (!appointments.length) continue;

        // Importar sendWhatsAppText dinámicamente
        const { sendWhatsAppText } = await import("./whatsapp.js");
        if (!sendWhatsAppText) continue;

        // Helper para obtener nombre del tenant (cachear si es posible)
        const [[tenantRow]] = await pool.query(
          "SELECT name FROM tenant WHERE id = ? LIMIT 1",
          [tenant.id]
        );
        const tenantName = tenantRow?.name || "ARJA ERP";

        let sentCount = 0;
        // Procesar turnos con delay pequeño entre cada uno
        for (const apt of appointments) {
          try {
            const startDate = new Date(apt.starts_at);
            const fecha = startDate.toLocaleDateString("es-AR", {
              weekday: "long",
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            });
            const hora = startDate.toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
            });

            let msg =
              `Hola ${apt.customer_name || "cliente"}! 👋\n\n` +
              `📅 *Recordatorio de tu turno*\n\n` +
              `Tenés un turno programado:\n` +
              `• Servicio: ${apt.service_name}\n` +
              `• Profesional: ${apt.instructor_name}\n` +
              `• Fecha: ${fecha}\n` +
              `• Hora: ${hora}\n`;

            // Si tiene seña pendiente, agregar información
            if (apt.status === "pending_deposit" && apt.deposit_decimal > 0) {
              msg += `\n⚠️ *Recordá que tenés una seña pendiente de $${Number(apt.deposit_decimal).toFixed(2)}*\n`;
            }

            msg += `\n¡Te esperamos en *${tenantName}*! 💈\n\n` +
              `Si necesitás cambiar o cancelar, avisanos con anticipación.`;

            await sendWhatsAppText(apt.phone_e164, msg, tenant.id);

            // Marcar como enviado
            await pool.query(
              `UPDATE appointment 
               SET reminder_sent_at = NOW() 
               WHERE id = ? AND tenant_id = ?`,
              [apt.id, tenant.id]
            );

            sentCount++;
            
            // Delay pequeño entre mensajes para evitar saturación de WhatsApp API
            if (sentCount < appointments.length) {
              await new Promise(resolve => setTimeout(resolve, 200)); // 200ms entre mensajes
            }
          } catch (error) {
            console.error(`❌ [Reminders Job] Error enviando recordatorio para turno ${apt.id}:`, error.message);
          }
        }

        if (sentCount > 0) {
          console.log(`✅ [Reminders Job] Tenant ${tenant.id}: ${sentCount} recordatorios enviados`);
        }
      } catch (error) {
        console.error(`❌ [Reminders Job] Error procesando tenant ${tenant.id}:`, error.message);
      }
    }

    const jobDuration = Date.now() - jobStartTime;
    console.log(`✅ [Reminders Job] Completado en ${jobDuration}ms`);
  } catch (error) {
    console.error("❌ [Reminders Job] Error general:", error.message);
  } finally {
    isRemindersJobRunning = false;
  }
}

// Ejecutar job cada 15 minutos (aumentado a 20 minutos para reducir carga)
const REMINDERS_JOB_INTERVAL = 20 * 60 * 1000; // 20 minutos
setInterval(runRemindersJob, REMINDERS_JOB_INTERVAL);
console.log(`✅ [Reminders Job] Job de recordatorios iniciado (cada ${REMINDERS_JOB_INTERVAL / 60000} minutos)`);

// Ejecutar inmediatamente al iniciar (opcional, comentado para evitar spam al iniciar)
// runRemindersJob();

/* =========================
   Job automático de recordatorios PUSH
   Envía notificaciones push ~N minutos antes del turno
========================= */
let isPushRemindersJobRunning = false;

async function runPushRemindersJob() {
  if (isPushRemindersJobRunning) return;
  isPushRemindersJobRunning = true;
  try {
    const [tenants] = await pool.query(`SELECT id FROM tenant WHERE is_active = 1 LIMIT 50`);
    if (!tenants.length) return;
    for (const tenant of tenants) {
      try {
        const [[enabledRow]] = await pool.query(
          `SELECT config_value FROM system_config WHERE tenant_id = ? AND config_key = 'push_reminders.enabled'`,
          [tenant.id]
        );
        const enabled = enabledRow?.config_value === "1" || enabledRow?.config_value === "true" || enabledRow?.config_value == null;
        if (!enabled) continue;
        const [[advRow]] = await pool.query(
          `SELECT config_value FROM system_config WHERE tenant_id = ? AND config_key = 'push_reminders.advance_minutes'`,
          [tenant.id]
        );
        const [[winRow]] = await pool.query(
          `SELECT config_value FROM system_config WHERE tenant_id = ? AND config_key = 'push_reminders.window_minutes'`,
          [tenant.id]
        );
        const advanceMinutes = Number(advRow?.config_value) || 30;
        const windowMinutes = Number(winRow?.config_value) || 10;
        const now = new Date();
        const targetStart = new Date(now.getTime() + advanceMinutes * 60 * 1000);
        const targetEnd = new Date(targetStart.getTime() + windowMinutes * 60 * 1000);
        try {
          await pool.query(`ALTER TABLE appointment ADD COLUMN push_reminder_sent_at DATETIME NULL`);
        } catch {}
        const [appointments] = await pool.query(
          `SELECT 
            a.id,
            a.starts_at,
            a.status,
            c.id AS customer_id,
            c.name AS customer_name,
            s.name AS service_name,
            i.name AS instructor_name
          FROM appointment a
          JOIN customer c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
          JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
          JOIN instructor i ON i.id = a.instructor_id AND i.tenant_id = a.tenant_id
          WHERE a.tenant_id = ?
            AND a.status IN ('scheduled', 'confirmed', 'deposit_paid', 'pending_deposit')
            AND a.starts_at BETWEEN ? AND ?
            AND (a.push_reminder_sent_at IS NULL OR a.push_reminder_sent_at < DATE_SUB(a.starts_at, INTERVAL ? MINUTE))
          ORDER BY a.starts_at ASC
          LIMIT 20`,
          [tenant.id, targetStart, targetEnd, advanceMinutes]
        );
        if (!appointments.length) continue;
        const { sendNotificationToCustomer } = await import("./services/pushNotifications.js");
        for (const apt of appointments) {
          try {
            const startDate = new Date(apt.starts_at);
            const fecha = startDate.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit" });
            const hora = startDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
            await sendNotificationToCustomer(tenant.id, apt.customer_id, {
              title: "Recordatorio de tu turno",
              body: `${apt.service_name} con ${apt.instructor_name} — ${fecha} ${hora}`,
              data: { type: "appointment_reminder", appointmentId: apt.id, startsAt: apt.starts_at },
            });
            await pool.query(`UPDATE appointment SET push_reminder_sent_at = NOW() WHERE id = ? AND tenant_id = ?`, [apt.id, tenant.id]);
          } catch {}
        }
      } catch {}
    }
  } catch {}
  isPushRemindersJobRunning = false;
}

const PUSH_REMINDERS_JOB_INTERVAL = 5 * 60 * 1000; // 5 minutos
setInterval(runPushRemindersJob, PUSH_REMINDERS_JOB_INTERVAL);
console.log(`✅ [Push Reminders Job] Iniciado (cada ${PUSH_REMINDERS_JOB_INTERVAL / 60000} minutos)`);

let isCampaignsSchedulerRunning = false;

async function runCampaignsScheduler() {
  if (isCampaignsSchedulerRunning) return;
  isCampaignsSchedulerRunning = true;
  try {
    const [tenants] = await pool.query(`SELECT id FROM tenant WHERE is_active = 1 LIMIT 50`);
    const now = new Date();
    for (const tenant of tenants) {
      try {
        const [[row]] = await pool.query(
          `SELECT config_value FROM system_config WHERE tenant_id = ? AND config_key = 'crm.schedules' LIMIT 1`,
          [tenant.id]
        );
        let schedules = [];
        if (row?.config_value) {
          try {
            const parsed = JSON.parse(row.config_value);
            schedules = Array.isArray(parsed) ? parsed : [];
          } catch {}
        }
        const due = schedules.filter((s) => {
          const sendAt = new Date(String(s.sendAt));
          return sendAt <= now;
        });
        if (due.length === 0) continue;
        for (const job of due) {
          try {
            const segmentCode = String(job.segmentCode || "");
            const message = String(job.message || "");
            const max = Math.min(500, Number(job.max) || 50);
            let segRows = [];
            if (segmentCode === "inactive_60_days") {
              const [r] = await pool.query(
                `
                SELECT c.id, c.name, c.phone_e164 AS phone,
                       MAX(a.starts_at) AS last_appointment_at
                  FROM customer c
                  LEFT JOIN appointment a
                    ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
                 WHERE c.tenant_id = ?
                 GROUP BY c.id, c.name, c.phone_e164
                HAVING (last_appointment_at IS NULL OR last_appointment_at < DATE_SUB(NOW(), INTERVAL 60 DAY))
                 ORDER BY last_appointment_at IS NULL DESC, last_appointment_at ASC
                 LIMIT ?
                `,
                [tenant.id, max]
              );
              segRows = r;
            } else if (segmentCode === "renewal_7_days") {
              const [r] = await pool.query(
                `
                SELECT c.id, c.name, c.phone_e164 AS phone, cs.next_charge_at
                  FROM customer c
                  JOIN customer_subscription cs
                    ON cs.customer_id = c.id AND cs.tenant_id = c.tenant_id
                 WHERE c.tenant_id = ?
                   AND cs.status = 'authorized'
                   AND cs.next_charge_at IS NOT NULL
                   AND cs.next_charge_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)
                 ORDER BY cs.next_charge_at ASC
                 LIMIT ?
                `,
                [tenant.id, max]
              );
              segRows = r;
            } else if (segmentCode === "deposit_pending_recent") {
              const [r] = await pool.query(
                `
                SELECT 
                  c.id, 
                  c.name, 
                  c.phone_e164 AS phone,
                  MAX(a.starts_at) AS last_starts_at
                  FROM customer c
                  JOIN appointment a
                    ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
                 WHERE c.tenant_id = ?
                   AND a.status = 'pending_deposit'
                   AND a.starts_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
                 GROUP BY c.id, c.name, c.phone_e164
                 ORDER BY last_starts_at DESC
                 LIMIT ?
                `,
                [tenant.id, max]
              );
              segRows = r;
            } else if (segmentCode === "deposit_expired_recent") {
              const [r] = await pool.query(
                `
                SELECT 
                  c.id, 
                  c.name, 
                  c.phone_e164 AS phone,
                  MAX(a.hold_until) AS last_hold_until
                  FROM customer c
                  JOIN appointment a
                    ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
                 WHERE c.tenant_id = ?
                   AND a.status = 'pending_deposit'
                   AND a.deposit_paid_at IS NULL
                   AND a.hold_until IS NOT NULL
                   AND a.hold_until < NOW()
                   AND a.hold_until >= DATE_SUB(NOW(), INTERVAL 14 DAY)
                 GROUP BY c.id, c.name, c.phone_e164
                 ORDER BY last_hold_until DESC
                 LIMIT ?
                `,
                [tenant.id, max]
              );
              segRows = r;
            } else {
              const [[csRow]] = await pool.query(
                `SELECT config_value FROM system_config WHERE tenant_id = ? AND config_key = 'crm.custom_segments' LIMIT 1`,
                [tenant.id]
              );
              let custom = [];
              if (csRow?.config_value) {
                try {
                  const parsed = JSON.parse(csRow.config_value);
                  custom = Array.isArray(parsed) ? parsed : [];
                } catch {}
              }
              const seg = custom.find((s) => String(s.code) === String(segmentCode));
              if (!seg) continue;
              const type = String(seg.type || "");
              const days = Number(seg?.params?.days || seg?.days || 14);
              if (type === "inactive_x_days") {
                const [r] = await pool.query(
                  `
                  SELECT c.id, c.name, c.phone_e164 AS phone,
                         MAX(a.starts_at) AS last_appointment_at
                    FROM customer c
                    LEFT JOIN appointment a
                      ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
                   WHERE c.tenant_id = ?
                   GROUP BY c.id, c.name, c.phone_e164
                  HAVING (last_appointment_at IS NULL OR last_appointment_at < DATE_SUB(NOW(), INTERVAL ? DAY))
                   ORDER BY last_appointment_at IS NULL DESC, last_appointment_at ASC
                   LIMIT ?
                  `,
                  [tenant.id, days, max]
                );
                segRows = r;
              } else if (type === "renewal_in_days") {
                const [r] = await pool.query(
                  `
                  SELECT c.id, c.name, c.phone_e164 AS phone, cs.next_charge_at
                    FROM customer c
                    JOIN customer_subscription cs
                      ON cs.customer_id = c.id AND cs.tenant_id = c.tenant_id
                   WHERE c.tenant_id = ?
                     AND cs.status = 'authorized'
                     AND cs.next_charge_at IS NOT NULL
                     AND cs.next_charge_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? DAY)
                   ORDER BY cs.next_charge_at ASC
                   LIMIT ?
                  `,
                  [tenant.id, days, max]
                );
                segRows = r;
              } else if (type === "deposit_pending_recent_days") {
                const [r] = await pool.query(
                  `
                  SELECT 
                    c.id, 
                    c.name, 
                    c.phone_e164 AS phone,
                    MAX(a.starts_at) AS last_starts_at
                    FROM customer c
                    JOIN appointment a
                      ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
                   WHERE c.tenant_id = ?
                     AND a.status = 'pending_deposit'
                     AND a.starts_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                   GROUP BY c.id, c.name, c.phone_e164
                   ORDER BY last_starts_at DESC
                   LIMIT ?
                  `,
                  [tenant.id, days, max]
                );
                segRows = r;
              } else if (type === "deposit_expired_recent_days") {
                const [r] = await pool.query(
                  `
                  SELECT 
                    c.id, 
                    c.name, 
                    c.phone_e164 AS phone,
                    MAX(a.hold_until) AS last_hold_until
                    FROM customer c
                    JOIN appointment a
                      ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
                   WHERE c.tenant_id = ?
                     AND a.status = 'pending_deposit'
                     AND a.deposit_paid_at IS NULL
                     AND a.hold_until IS NOT NULL
                     AND a.hold_until < NOW()
                     AND a.hold_until >= DATE_SUB(NOW(), INTERVAL ? DAY)
                   GROUP BY c.id, c.name, c.phone_e164
                   ORDER BY last_hold_until DESC
                   LIMIT ?
                  `,
                  [tenant.id, days, max]
                );
                segRows = r;
              } else {
                continue;
              }
            }
            const recipients = segRows
              .map((r) => ({ id: r.id, name: r.name, phone: String(r.phone || "").replace(/\s+/g, "").replace(/-/g, "") }))
              .filter((x) => x.phone);
            let sent = 0;
            for (const r of recipients) {
              const text = message.replace("{nombre}", r.name || "Cliente");
              try {
                await sendWhatsAppText(r.phone, text, tenant.id, null);
                sent++;
                await new Promise((resolve) => setTimeout(resolve, 200));
              } catch (err) {
                if (String(err?.code) === "131047") {
                  let templateOk = false;
                  let langs = ["es_AR", "es", "es_419", "es_MX", "es_ES"];
                  for (const lang of langs) {
                    try {
                      await sendWhatsAppTemplate(
                        r.phone,
                        "reabrir_chat",
                        lang,
                        [
                          {
                            type: "body",
                            parameters: [
                              { type: "text", text: r.name || "Cliente" }
                            ]
                          }
                        ],
                        tenant.id
                      );
                      templateOk = true;
                      break;
                    } catch {}
                  }
                  if (templateOk) {
                    try {
                      await sendWhatsAppText(r.phone, text, tenant.id, null);
                      sent++;
                    } catch {}
                  }
                }
              }
            }
            const total = recipients.length;
            const [[hRow]] = await pool.query(
              `SELECT config_value FROM system_config WHERE tenant_id = ? AND config_key = 'crm.history' LIMIT 1`,
              [tenant.id]
            );
            let history = [];
            if (hRow?.config_value) {
              try {
                const parsed = JSON.parse(hRow.config_value);
                history = Array.isArray(parsed) ? parsed : [];
              } catch {}
            }
            const entry = {
              id: Date.now(),
              segmentCode,
              sent,
              total,
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
              preview: false,
            };
            const nextHist = [entry, ...history].slice(0, 200);
            const histVal = JSON.stringify(nextHist);
            await pool.query(
              `INSERT INTO system_config (tenant_id, config_key, config_value)
               VALUES (?, 'crm.history', ?)
               ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
              [tenant.id, histVal]
            );
          } catch {}
        }
        const remaining = schedules.filter((s) => {
          const sendAt = new Date(String(s.sendAt));
          return sendAt > now;
        });
        const value = JSON.stringify(remaining);
        await pool.query(
          `INSERT INTO system_config (tenant_id, config_key, config_value)
           VALUES (?, 'crm.schedules', ?)
           ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
          [tenant.id, value]
        );
      } catch {}
    }
  } catch {}
  isCampaignsSchedulerRunning = false;
}

const CAMPAIGNS_JOB_INTERVAL = 5 * 60 * 1000;
setInterval(runCampaignsScheduler, CAMPAIGNS_JOB_INTERVAL);
console.log(`✅ [CRM Campaigns] Scheduler iniciado (cada ${CAMPAIGNS_JOB_INTERVAL / 60000} minutos)`);
/* =========================
   Arranque del servidor
   OPTIMIZADO: Verificar conexión a BD antes de aceptar requests
========================= */
const port = process.env.PORT || 4000;

// Verificar conexión a BD antes de iniciar el servidor
async function startServer() {
  try {
    // Verificar conexión a BD
    console.log("🔄 [Startup] Verificando conexión a base de datos...");
    await pool.query("SELECT 1");
    console.log("✅ [Startup] Conexión a base de datos verificada");
    
    // Iniciar servidor
app.listen(port, () => {
    console.log(`✅ API segura lista en http://localhost:${port}`);
      console.log(`✅ [Startup] Servidor completamente inicializado`);
    });
  } catch (error) {
    console.error("❌ [Startup] Error conectando a base de datos:", error.message);
    console.error("❌ [Startup] El servidor no se iniciará hasta que la BD esté disponible");
    
    // Reintentar después de 5 segundos
    setTimeout(startServer, 5000);
  }
}

// Iniciar servidor
startServer();
