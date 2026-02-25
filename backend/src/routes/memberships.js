import express from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import { identifyTenant } from "../auth/tenant.js";
import { sendWhatsAppText } from "../whatsapp.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════
// FUNCIÓN PARA EXPIRAR SUSCRIPCIONES PENDIENTES
// ═══════════════════════════════════════════════════════════
/**
 * Marca como expiradas las suscripciones pendientes que tienen más de 30 días
 * sin ser pagadas. Esto se ejecuta automáticamente antes de consultar suscripciones.
 */
async function expirePendingSubscriptions() {
  try {
    // Expirar suscripciones pendientes que tienen más de 30 días sin pago
    const [result] = await pool.query(
      `UPDATE customer_subscription
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'pending'
         AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
         AND (last_payment_at IS NULL OR last_payment_at < DATE_SUB(NOW(), INTERVAL 30 DAY))`
    );
    
    if (result.affectedRows > 0) {
      console.log(`[expirePendingSubscriptions] ${result.affectedRows} suscripción(es) marcada(s) como expirada(s)`);
    }
  } catch (error) {
    console.error("[expirePendingSubscriptions] Error al expirar suscripciones:", error);
    // No lanzar error para no interrumpir el flujo
  }
}

// ═══════════════════════════════════════════════════════════
// LOG DE VERIFICACIÓN DE CARGA DEL MÓDULO
// ═══════════════════════════════════════════════════════════
console.log("════════════════════════════════════════════════════════════");
console.log("[MEMBERSHIPS ROUTER] Módulo cargado - VERSIÓN CON RUTAS PÚBLICAS");
console.log("[MEMBERSHIPS ROUTER] Timestamp:", new Date().toISOString());
console.log("════════════════════════════════════════════════════════════");

router.use(requireAuth);
router.use(identifyTenant);

// Log para verificar que las peticiones llegan al router
router.use((req, res, next) => {
  console.log(`[MEMBERSHIPS ROUTER] Petición recibida: ${req.method} ${req.path} (original: ${req.originalUrl})`);
  console.log(`[MEMBERSHIPS ROUTER] req.user:`, req.user ? { id: req.user.id, type: req.user.type, role: req.user.role } : 'null');
  console.log(`[MEMBERSHIPS ROUTER] req.tenant_id:`, req.tenant_id);
  next();
});

// ═══════════════════════════════════════════════════════════
// MIDDLEWARE PARA PERMITIR ACCESO DE CLIENTES A RUTAS PÚBLICAS
// ═══════════════════════════════════════════════════════════
// Este middleware verifica explícitamente si es un cliente intentando
// acceder a rutas públicas de membresías y permite el acceso
const allowCustomerAccess = (req, res, next) => {
  const path = req.path || "";
  const originalPath = req.originalUrl || "";
  const isPublicMembershipRoute = 
    (path === "/plans" || path === "/my" || path.startsWith("/subscriptions/") || path === "/subscribe" || path === "/preapproval") &&
    (req.method === "GET" || req.method === "POST" || req.method === "DELETE");
  
  console.log(`[allowCustomerAccess] Verificando: ${req.method} ${path} (original: ${originalPath})`);
  console.log(`[allowCustomerAccess] req.user:`, req.user ? { id: req.user.id, type: req.user.type, role: req.user.role } : 'null');
  console.log(`[allowCustomerAccess] isPublicMembershipRoute: ${isPublicMembershipRoute}, user.type: ${req.user?.type}`);
  
  if (isPublicMembershipRoute && req.user?.type === 'customer') {
    console.log(`[allowCustomerAccess] ✅ PERMITIENDO acceso a cliente en ruta: ${req.method} ${path}`);
    return next();
  }
  
  // Para todas las demás rutas, continuar con el flujo normal
  console.log(`[allowCustomerAccess] Continuando con flujo normal para: ${req.method} ${path}`);
  next();
};

router.use(allowCustomerAccess);

// ═══════════════════════════════════════════════════════════
// RUTAS PÚBLICAS PARA CLIENTES - DEBEN ESTAR ANTES DE requireRole
// ═══════════════════════════════════════════════════════════
// Estas rutas permiten acceso tanto a clientes como a admins
// IMPORTANTE: No pasan por requireRole("admin"), por eso están aquí

router.get("/plans", async (req, res) => {
  try {
    console.log("═══════════════════════════════════════════");
    console.log("[GET /api/memberships/plans] Request recibido");
    console.log("[GET /api/memberships/plans] req.user:", req.user ? { id: req.user.id, type: req.user.type, role: req.user.role } : null);
    console.log("[GET /api/memberships/plans] req.tenant_id:", req.tenant_id);
    console.log("═══════════════════════════════════════════");
    
    const tenantId = req.tenant_id;
    if (!tenantId) {
      console.error("[GET /api/memberships/plans] Error: Tenant no identificado");
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    // Si es admin, mostrar todos los planes (activos e inactivos)
    // Si es cliente, mostrar solo los activos
    const isAdmin = req.user?.role === 'admin' || req.user?.is_super_admin;
    
    let query = `
      SELECT id, name, description, price_decimal, duration_months,
              max_classes_per_week, max_classes_per_month, max_active_appointments,
              billing_day, grace_days, interest_type, interest_value, auto_block,
              is_active, mp_plan_id, created_at, updated_at
         FROM membership_plan
       WHERE tenant_id = ?`;
    
    const params = [tenantId];
    
    if (!isAdmin) {
      query += ' AND is_active = 1';
    }
    
    query += isAdmin 
      ? ' ORDER BY is_active DESC, created_at DESC'
      : ' ORDER BY created_at DESC';

    const [rows] = await pool.query(query, params);

    res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("[GET /api/memberships/plans] error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.get("/my", async (req, res) => {
  try {
    console.log("═══════════════════════════════════════════");
    console.log("[GET /api/memberships/my] Request recibido");
    console.log("[GET /api/memberships/my] req.user:", req.user ? { id: req.user.id, type: req.user.type, role: req.user.role } : null);
    console.log("[GET /api/memberships/my] req.tenant_id:", req.tenant_id);
    console.log("═══════════════════════════════════════════");
    
    const tenantId = req.tenant_id;
    const customerId = req.user?.type === 'customer' ? req.user.id : req.query.customer_id;
    
    if (!tenantId) {
      console.error("[GET /api/memberships/my] Error: Tenant no identificado");
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    
    if (!customerId) {
      console.error("[GET /api/memberships/my] Error: Customer ID requerido");
      return res.status(400).json({ ok: false, error: "Customer ID requerido" });
    }

    // Expirar suscripciones pendientes automáticamente antes de consultar
    await expirePendingSubscriptions();

    // Buscar membresía activa o pendiente del cliente usando customer_subscription
    // Priorizar 'authorized' pero también mostrar 'pending' si no hay autorizada
    // Excluir 'expired' y 'cancelled'
    const [rows] = await pool.query(
      `SELECT cs.id, cs.customer_id, cs.membership_plan_id, cs.status,
              cs.next_charge_at, cs.last_payment_at, cs.amount_decimal, cs.currency,
              cs.mp_init_point, cs.mp_sandbox_init_point,
              mp.name as plan_name, mp.description as plan_description,
              mp.price_decimal as plan_price, mp.duration_months
         FROM customer_subscription cs
         INNER JOIN membership_plan mp ON cs.membership_plan_id = mp.id
        WHERE cs.customer_id = ? AND cs.tenant_id = ? AND cs.status IN ('authorized', 'pending')
        ORDER BY 
          CASE cs.status 
            WHEN 'authorized' THEN 1 
            WHEN 'pending' THEN 2 
            ELSE 3 
          END,
          cs.created_at DESC
        LIMIT 1`,
      [customerId, tenantId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: "No se encontró membresía activa" });
    }

    const subscription = rows[0];
    // Agregar mp_init_point si está disponible
    if (subscription.mp_init_point || subscription.mp_sandbox_init_point) {
      subscription.mp_init_point = subscription.mp_init_point || subscription.mp_sandbox_init_point;
    }
    
    res.json({ ok: true, data: subscription });
  } catch (error) {
    console.error("[GET /api/memberships/my] error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════
// ENDPOINT PARA CREAR PREAPPROVAL DINÁMICO
// ═══════════════════════════════════════════════════════════
// Crea un preapproval dinámico en Mercado Pago sin necesidad de un plan fijo
router.post("/preapproval", async (req, res) => {
  try {
    console.log("[POST /api/memberships/preapproval] Request recibido");
    console.log("[POST /api/memberships/preapproval] req.body:", req.body);
    
    const tenantId = req.tenant_id;
    const customerId = req.user?.type === 'customer' ? req.user.id : req.body.customer_id;
    
    // Parámetros dinámicos del request
    const {
      reason, // Nombre/descripción de la suscripción
      transaction_amount, // Monto a cobrar
      frequency, // Frecuencia (ej: 1, 2, etc.)
      frequency_type, // Tipo: "days" o "months"
      currency_id = "ARS", // Moneda, por defecto ARS
    } = req.body;
    
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    if (!customerId) {
      return res.status(400).json({ ok: false, error: "Customer ID requerido" });
    }
    
    if (!reason) {
      return res.status(400).json({ ok: false, error: "El campo 'reason' (nombre/descripción) es requerido" });
    }
    
    if (!transaction_amount || transaction_amount <= 0) {
      return res.status(400).json({ ok: false, error: "El campo 'transaction_amount' (monto) es requerido y debe ser mayor a 0" });
    }
    
    if (!frequency || frequency <= 0) {
      return res.status(400).json({ ok: false, error: "El campo 'frequency' (frecuencia) es requerido y debe ser mayor a 0" });
    }
    
    if (!frequency_type || !['days', 'months'].includes(frequency_type)) {
      return res.status(400).json({ ok: false, error: "El campo 'frequency_type' debe ser 'days' o 'months'" });
    }
    
    // Expirar suscripciones pendientes antes de crear una nueva
    await expirePendingSubscriptions();
    
    // Verificar si el cliente ya tiene una suscripción activa
    const [existingSubs] = await pool.query(
      `SELECT id, status, created_at, last_payment_at
       FROM customer_subscription
       WHERE customer_id = ? AND tenant_id = ? AND status IN ('authorized', 'pending')
       ORDER BY created_at DESC
       LIMIT 1`,
      [customerId, tenantId]
    );
    
    if (existingSubs.length > 0) {
      const existingSub = existingSubs[0];
      
      // Si la suscripción está autorizada (pagada), no permitir crear otra
      if (existingSub.status === 'authorized') {
        return res.status(400).json({ 
          ok: false, 
          error: "Ya tenés una suscripción activa. Cancelá la actual antes de crear otra." 
        });
      }
      
      // Si la suscripción está pendiente (no pagada), cancelarla automáticamente
      if (existingSub.status === 'pending') {
        console.log(`[POST /api/memberships/preapproval] Cancelando suscripción pendiente anterior (ID: ${existingSub.id})`);
        
        if (existingSub.mp_preapproval_id) {
          try {
            const { getTenantMpToken } = await import("../services/mercadoPago.js");
            const mpToken = await getTenantMpToken(tenantId);
            
            if (mpToken) {
              await fetch(`https://api.mercadopago.com/preapproval/${existingSub.mp_preapproval_id}`, {
                method: "PUT",
                headers: {
                  Authorization: `Bearer ${mpToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ status: "cancelled" }),
              });
            }
          } catch (mpError) {
            console.error("[POST /api/memberships/preapproval] Error cancelando suscripción anterior en MP:", mpError);
          }
        }
        
        await pool.query(
          `UPDATE customer_subscription
           SET status = 'cancelled', canceled_at = NOW(), updated_at = NOW()
           WHERE id = ?`,
          [existingSub.id]
        );
      }
    }
    
    // Obtener token de Mercado Pago del tenant
    const { getTenantMpToken } = await import("../services/mercadoPago.js");
    const mpToken = await getTenantMpToken(tenantId);
    
    if (!mpToken) {
      return res.status(503).json({ 
        ok: false, 
        error: "El sistema de pagos no está configurado para este negocio. Contactá al administrador." 
      });
    }
    
    // Calcular fecha de inicio (mañana)
    const startDate = (() => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      return tomorrow.toISOString();
    })();
    
    // NO incluimos payer_email para permitir que cualquier usuario pague con cualquier cuenta
    // Si incluimos payer_email, Mercado Pago validará que el email del pagador coincida con ese email
    // Sin payer_email, cualquier usuario puede pagar sin restricción de email
    
    // Crear payload para Mercado Pago siguiendo la estructura de la documentación oficial
    const mpPayload = {
      reason: reason,
      external_reference: `tenant:${tenantId}:customer:${customerId}:dynamic:${Date.now()}`,
      // NO incluimos payer_email - esto permite pagos con cualquier cuenta de email
      auto_recurring: {
        frequency: frequency,
        frequency_type: frequency_type,
        transaction_amount: Number(transaction_amount),
        currency_id: currency_id,
        start_date: startDate,
      },
      back_url: process.env.FRONTEND_BASE_URL || 'arja-erp://payment-success',
      status: "pending", // Estado pendiente para que el usuario complete el pago
    };
    
    console.log("[POST /api/memberships/preapproval] Creando preapproval SIN payer_email para permitir pagos con cualquier cuenta");
    console.log("[POST /api/memberships/preapproval] Payload:", JSON.stringify(mpPayload, null, 2));
    
    const mpResponse = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(mpPayload),
    });
    
    const mpData = await mpResponse.json();
    
    if (!mpResponse.ok) {
      console.error("[POST /api/memberships/preapproval] Error creando preapproval en Mercado Pago:", mpData);
      const errorMessage = mpData.message || mpData.cause?.[0]?.description || JSON.stringify(mpData);
      return res.status(500).json({ 
        ok: false, 
        error: errorMessage || "Error al crear la suscripción en Mercado Pago" 
      });
    }
    
    // Calcular fechas
    const nextCharge = mpData.auto_recurring?.next_payment_date
      ? new Date(mpData.auto_recurring.next_payment_date)
      : null;
    const lastPayment = mpData.auto_recurring?.last_payment_date
      ? new Date(mpData.auto_recurring.last_payment_date)
      : null;
    
    // Guardar la suscripción en la base de datos (sin membership_plan_id)
    const [insertResult] = await pool.query(
      `INSERT INTO customer_subscription
       (tenant_id, customer_id, membership_plan_id, reason, amount_decimal, currency,
        frequency, frequency_type, status, mp_preapproval_id, mp_init_point,
        mp_sandbox_init_point, next_charge_at, last_payment_at,
        external_reference, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        tenantId,
        customerId,
        null, // membership_plan_id es null para suscripciones dinámicas
        reason,
        Number(transaction_amount),
        currency_id,
        frequency,
        frequency_type,
        mpData.status || 'pending',
        mpData.id,
        mpData.init_point || null,
        mpData.sandbox_init_point || null,
        nextCharge,
        lastPayment,
        mpPayload.external_reference,
      ]
    );
    
    // Recuperar la suscripción creada
    const [newSubRows] = await pool.query(
      `SELECT cs.id, cs.customer_id, cs.membership_plan_id, cs.status,
              cs.next_charge_at, cs.last_payment_at, cs.amount_decimal, cs.currency,
              cs.mp_init_point, cs.mp_sandbox_init_point, cs.reason
       FROM customer_subscription cs
       WHERE cs.id = ?
       LIMIT 1`,
      [insertResult.insertId]
    );
    
    if (newSubRows.length === 0) {
      console.error("[POST /api/memberships/preapproval] Error: No se pudo recuperar la suscripción creada");
      return res.status(500).json({ 
        ok: false, 
        error: "Error al recuperar la suscripción creada" 
      });
    }
    
    const subscription = newSubRows[0];
    const mpInitPoint = subscription.mp_init_point || subscription.mp_sandbox_init_point;
    
    const responseData = {
      id: subscription.id,
      customer_id: subscription.customer_id,
      membership_plan_id: subscription.membership_plan_id,
      status: subscription.status,
      next_charge_at: subscription.next_charge_at,
      last_payment_at: subscription.last_payment_at,
      amount_decimal: subscription.amount_decimal,
      currency: subscription.currency,
      reason: subscription.reason,
      mp_init_point: mpInitPoint,
    };
    
    console.log("[POST /api/memberships/preapproval] Preapproval creado exitosamente:", {
      id: subscription.id,
      status: subscription.status,
      mp_init_point: mpInitPoint ? 'presente' : 'ausente',
    });
    
    res.json({ ok: true, data: responseData });
  } catch (error) {
    console.error("[POST /api/memberships/preapproval] error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Ruta para que los clientes se suscriban a un plan
// Esta ruta convierte el plan fijo en un preapproval dinámico
router.post("/subscribe", async (req, res) => {
  try {
    console.log("[POST /api/memberships/subscribe] Request recibido");
    console.log("[POST /api/memberships/subscribe] req.user:", req.user ? { id: req.user.id, type: req.user.type } : null);
    console.log("[POST /api/memberships/subscribe] req.body:", req.body);
    
    const tenantId = req.tenant_id;
    const customerId = req.user?.type === 'customer' ? req.user.id : req.body.customer_id;
    const { membership_plan_id } = req.body;
    
    if (!tenantId) {
      console.error("[POST /api/memberships/subscribe] Error: Tenant no identificado");
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    
    if (!customerId) {
      console.error("[POST /api/memberships/subscribe] Error: Customer ID requerido");
      return res.status(400).json({ ok: false, error: "Customer ID requerido" });
    }
    
    if (!membership_plan_id) {
      return res.status(400).json({ ok: false, error: "Membership plan ID requerido" });
    }
    
    // Verificar que el plan existe y está activo
    const [planRows] = await pool.query(
      `SELECT id, name, description, price_decimal, duration_months, mp_plan_id
         FROM membership_plan
       WHERE id = ? AND tenant_id = ? AND is_active = 1
       LIMIT 1`,
      [membership_plan_id, tenantId]
    );
    
    if (planRows.length === 0) {
      return res.status(404).json({ ok: false, error: "Plan de membresía no encontrado o inactivo" });
    }
    
    const plan = planRows[0];
    
    // Expirar suscripciones pendientes antes de crear una nueva
    await expirePendingSubscriptions();
    
    // Verificar si el cliente ya tiene una suscripción activa
    const [existingSubs] = await pool.query(
      `SELECT id, status, created_at, last_payment_at
       FROM customer_subscription
       WHERE customer_id = ? AND tenant_id = ? AND status IN ('authorized', 'pending')
       ORDER BY created_at DESC
       LIMIT 1`,
      [customerId, tenantId]
    );
    
    if (existingSubs.length > 0) {
      const existingSub = existingSubs[0];
      
      // Si la suscripción está autorizada (pagada), no permitir crear otra
      if (existingSub.status === 'authorized') {
        return res.status(400).json({ 
          ok: false, 
          error: "Ya tenés una suscripción activa. Cancelá la actual antes de suscribirte a otra." 
        });
      }
      
      // Si la suscripción está pendiente (no pagada), cancelarla automáticamente
      // y permitir crear una nueva
      if (existingSub.status === 'pending') {
        console.log(`[POST /api/memberships/subscribe] Cancelando suscripción pendiente anterior (ID: ${existingSub.id})`);
        
        // Cancelar en Mercado Pago si tiene preapproval_id
        if (existingSub.mp_preapproval_id) {
          try {
            const { getTenantMpToken } = await import("../services/mercadoPago.js");
            const mpToken = await getTenantMpToken(tenantId);
            
            if (mpToken) {
              await fetch(`https://api.mercadopago.com/preapproval/${existingSub.mp_preapproval_id}`, {
                method: "PUT",
                headers: {
                  Authorization: `Bearer ${mpToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ status: "cancelled" }),
              });
            }
          } catch (mpError) {
            console.error("[POST /api/memberships/subscribe] Error cancelando suscripción anterior en MP:", mpError);
            // Continuar aunque falle, cancelamos en nuestra BD
          }
        }
        
        // Cancelar en la base de datos
        await pool.query(
          `UPDATE customer_subscription
           SET status = 'cancelled', canceled_at = NOW(), updated_at = NOW()
           WHERE id = ?`,
          [existingSub.id]
        );
        
        console.log(`[POST /api/memberships/subscribe] Suscripción pendiente anterior cancelada`);
      }
    }
    
    // Obtener token de Mercado Pago del tenant
    const { getTenantMpToken } = await import("../services/mercadoPago.js");
    const mpToken = await getTenantMpToken(tenantId);
    
    if (!mpToken) {
      return res.status(503).json({ 
        ok: false, 
        error: "El sistema de pagos no está configurado para este negocio. Contactá al administrador." 
      });
    }
    
    // Obtener el email del cliente solo para guardarlo en nuestra BD (opcional)
    let customerEmail = null;
    try {
      if (req.user?.email) {
        customerEmail = req.user.email;
        console.log("[POST /api/memberships/subscribe] Email obtenido de req.user:", customerEmail);
      } else {
        console.log("[POST /api/memberships/subscribe] Obteniendo email de la BD para customer_id:", customerId);
        const [customerRows] = await pool.query(
          `SELECT email FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
          [customerId, tenantId]
        );
        if (customerRows.length > 0 && customerRows[0].email) {
          customerEmail = customerRows[0].email;
          console.log("[POST /api/memberships/subscribe] Email obtenido de BD:", customerEmail);
        }
      }
    } catch (emailError) {
      console.warn("[POST /api/memberships/subscribe] No se pudo obtener el email del cliente (no crítico):", emailError.message);
    }

    // Crear preferencia de pago único usando /checkout/preferences
    // Esto permite que el usuario ingrese cualquier email durante el pago
    // Las renovaciones se manejarán a través de webhooks creando nuevos pagos
    const frontendUrl = process.env.FRONTEND_BASE_URL;
    
    // Detectar si la solicitud viene de la app móvil
    const isMobileApp = req.headers['x-client-type'] === 'mobile-app' || 
                        req.headers['user-agent']?.includes('ReactNative') ||
                        req.body?.is_mobile_app === true;
    
    // Configurar URLs de redirección según el tipo de cliente
    let backUrls;
    if (isMobileApp || !frontendUrl) {
      // Usar deep links para la app móvil o si no hay frontend web configurado
      backUrls = {
        success: `arja-erp://payment-success?status=approved&subscription_id=${customerId}`,
        failure: `arja-erp://payment-failure`,
        pending: `arja-erp://payment-success?status=pending&subscription_id=${customerId}`
      };
      console.log("[POST /api/memberships/subscribe] Usando deep links (app móvil o sin frontend web):", backUrls);
    } else {
      // Usar URLs web para navegador solo si hay frontend configurado
      backUrls = {
        success: `${frontendUrl}/subscription/success?status=approved`,
        failure: `${frontendUrl}/subscription/failure`,
        pending: `${frontendUrl}/subscription/success?status=pending`
      };
      console.log("[POST /api/memberships/subscribe] Cliente web - usando URLs web:", backUrls);
    }
    
    const preferencePayload = {
      items: [
        {
          title: plan.name,
          description: plan.description || `Suscripción ${plan.name}`,
          quantity: 1,
          unit_price: Number(plan.price_decimal),
          currency_id: "ARS",
        }
      ],
      external_reference: `tenant:${tenantId}:customer:${customerId}:plan:${membership_plan_id}:subscription`,
      back_urls: backUrls,
      auto_return: "approved",
      notification_url: `${process.env.API_URL || process.env.API_URL || 'https://backend-production-1042.up.railway.app'}/api/mp-webhook`,
      statement_descriptor: plan.name.substring(0, 22), // Máximo 22 caracteres
      metadata: {
        tenant_id: tenantId,
        customer_id: customerId,
        membership_plan_id: membership_plan_id,
        subscription_type: "membership"
      }
    };
    
    console.log("[POST /api/memberships/subscribe] Creando preferencia de pago único (checkout/preferences)");
    console.log("[POST /api/memberships/subscribe] Payload:", JSON.stringify(preferencePayload, null, 2));
    
    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(preferencePayload),
    });
    
    const mpData = await mpResponse.json();
    
    if (!mpResponse.ok) {
      console.error("[POST /api/memberships/subscribe] Error creando preferencia en Mercado Pago:", mpData);
      const errorMessage = mpData.message || mpData.cause?.[0]?.description || JSON.stringify(mpData);
      console.error("[POST /api/memberships/subscribe] Detalles del error de MP:", errorMessage);
      return res.status(500).json({ 
        ok: false, 
        error: errorMessage || "Error al crear la preferencia de pago en Mercado Pago" 
      });
    }
    
    // Calcular fechas para la suscripción
    // next_charge_at será calculado después del primer pago exitoso
    const nextCharge = null; // Se calculará cuando se reciba el webhook del pago aprobado
    const lastPayment = null; // Se actualizará cuando se reciba el webhook
    
    // Guardar la suscripción en la base de datos como "pending"
    // Se activará cuando el webhook reciba el pago aprobado
    console.log("[POST /api/memberships/subscribe] Guardando suscripción en BD...");
    console.log("[POST /api/memberships/subscribe] mpData:", {
      id: mpData.id,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point,
    });
    
    // Calcular fecha de próxima renovación (después del primer pago)
    const nextChargeDate = (() => {
      const date = new Date();
      date.setMonth(date.getMonth() + (plan.duration_months || 1));
      return date;
    })();
    
    const [insertResult] = await pool.query(
      `INSERT INTO customer_subscription
       (tenant_id, customer_id, membership_plan_id, reason, amount_decimal, currency,
        frequency, frequency_type, status, mp_preapproval_id, mp_init_point,
        mp_sandbox_init_point, payer_email, next_charge_at, last_payment_at,
        external_reference, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        tenantId,
        customerId,
        membership_plan_id,
        plan.name,
        plan.price_decimal,
        "ARS",
        plan.duration_months || 1,
        "months",
        "pending", // Estado pendiente hasta que se reciba el webhook del pago
        null, // No hay preapproval_id, usamos preferencia de pago único
        mpData.init_point,
        mpData.sandbox_init_point || null,
        customerEmail,
        nextChargeDate, // Fecha estimada de próxima renovación
        null, // last_payment_at se actualizará cuando se reciba el webhook
        preferencePayload.external_reference,
      ]
    );
    
    console.log("[POST /api/memberships/subscribe] Suscripción guardada con ID:", insertResult.insertId);
    
    // Obtener la suscripción creada
    const [newSubRows] = await pool.query(
      `SELECT cs.id, cs.customer_id, cs.membership_plan_id, cs.status,
              cs.next_charge_at, cs.last_payment_at, cs.amount_decimal, cs.currency,
              cs.mp_init_point, cs.mp_sandbox_init_point,
              mp.name as plan_name, mp.description as plan_description,
              mp.price_decimal as plan_price, mp.duration_months
       FROM customer_subscription cs
       INNER JOIN membership_plan mp ON cs.membership_plan_id = mp.id
       WHERE cs.id = ?`,
      [insertResult.insertId]
    );
    
    if (newSubRows.length === 0) {
      console.error("[POST /api/memberships/subscribe] Error: No se pudo recuperar la suscripción creada");
      return res.status(500).json({ 
        ok: false, 
        error: "Error al recuperar la suscripción creada" 
      });
    }
    
    const subscription = newSubRows[0];
    const mpInitPoint = subscription.mp_init_point || subscription.mp_sandbox_init_point;
    
    console.log("[POST /api/memberships/subscribe] Suscripción recuperada:", {
      id: subscription.id,
      status: subscription.status,
      mp_init_point: mpInitPoint ? 'presente' : 'ausente',
    });
    
    const responseData = {
      id: subscription.id,
      customer_id: subscription.customer_id,
      membership_plan_id: subscription.membership_plan_id,
      status: subscription.status,
      next_charge_at: subscription.next_charge_at,
      last_payment_at: subscription.last_payment_at,
      amount_decimal: subscription.amount_decimal,
      currency: subscription.currency,
      mp_init_point: mpInitPoint,
      plan_name: subscription.plan_name,
      plan_description: subscription.plan_description,
      plan_price: subscription.plan_price,
      duration_months: subscription.duration_months,
    };
    
    console.log("[POST /api/memberships/subscribe] Enviando respuesta:", {
      ok: true,
      has_data: !!responseData,
      has_mp_init_point: !!responseData.mp_init_point,
    });
    
    res.json({ 
      ok: true, 
      data: responseData
    });
  } catch (error) {
    console.error("[POST /api/memberships/subscribe] error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Endpoint para obtener o regenerar link de pago de una suscripción
router.get("/subscriptions/:id/payment-link", async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const customerId = req.user?.type === 'customer' ? req.user.id : req.query.customer_id;
    const { id } = req.params;
    const regenerate = req.query.regenerate === 'true';
    
    if (!tenantId || !customerId) {
      return res.status(403).json({ ok: false, error: "Tenant o Customer ID requerido" });
    }
    
    // Verificar que la suscripción pertenece al cliente
    const [subRows] = await pool.query(
      `SELECT cs.id, cs.mp_init_point, cs.mp_sandbox_init_point, cs.status, 
              cs.mp_preapproval_id, cs.membership_plan_id
       FROM customer_subscription cs
       WHERE cs.id = ? AND cs.customer_id = ? AND cs.tenant_id = ?
       LIMIT 1`,
      [id, customerId, tenantId]
    );
    
    if (subRows.length === 0) {
      return res.status(404).json({ ok: false, error: "Suscripción no encontrada" });
    }
    
    const subscription = subRows[0];
    let paymentLink = subscription.mp_init_point || subscription.mp_sandbox_init_point;
    
    // Si no hay link o se solicita regenerar, obtenerlo de Mercado Pago
    if (!paymentLink || regenerate) {
      if (!subscription.mp_preapproval_id) {
        return res.status(400).json({ 
          ok: false, 
          error: "No se puede regenerar el link: falta el ID de suscripción de Mercado Pago" 
        });
      }
      
      console.log(`[GET /api/memberships/subscriptions/:id/payment-link] Regenerando link para preapproval_id: ${subscription.mp_preapproval_id}`);
      
      try {
        const { getTenantMpToken } = await import("../services/mercadoPago.js");
        const mpToken = await getTenantMpToken(tenantId);
        
        if (!mpToken) {
          return res.status(503).json({ 
            ok: false, 
            error: "El sistema de pagos no está configurado para este negocio" 
          });
        }
        
        // Obtener información de la suscripción desde Mercado Pago
        const mpResponse = await fetch(`https://api.mercadopago.com/preapproval/${subscription.mp_preapproval_id}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${mpToken}`,
            "Content-Type": "application/json",
          },
        });
        
        if (!mpResponse.ok) {
          const mpError = await mpResponse.json();
          console.error("[GET /api/memberships/subscriptions/:id/payment-link] Error obteniendo suscripción de MP:", mpError);
          return res.status(500).json({ 
            ok: false, 
            error: "No se pudo obtener el link de pago desde Mercado Pago" 
          });
        }
        
        const mpData = await mpResponse.json();
        paymentLink = mpData.init_point || mpData.sandbox_init_point;
        
        if (!paymentLink) {
          return res.status(400).json({ 
            ok: false, 
            error: "Mercado Pago no proporcionó un link de pago para esta suscripción" 
          });
        }
        
        // Actualizar el link en la base de datos
        await pool.query(
          `UPDATE customer_subscription
           SET mp_init_point = ?,
               mp_sandbox_init_point = ?,
               updated_at = NOW()
           WHERE id = ?`,
          [
            mpData.init_point || null,
            mpData.sandbox_init_point || null,
            id
          ]
        );
        
        console.log(`[GET /api/memberships/subscriptions/:id/payment-link] Link regenerado exitosamente`);
      } catch (mpError) {
        console.error("[GET /api/memberships/subscriptions/:id/payment-link] Error regenerando link:", mpError);
        return res.status(500).json({ 
          ok: false, 
          error: "Error al regenerar el link de pago desde Mercado Pago" 
        });
      }
    }
    
    if (!paymentLink) {
      return res.status(400).json({ ok: false, error: "No hay link de pago disponible para esta suscripción" });
    }
    
    res.json({ ok: true, data: { payment_link: paymentLink } });
  } catch (error) {
    console.error("[GET /api/memberships/subscriptions/:id/payment-link] error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Endpoint para cancelar una suscripción
router.delete("/subscriptions/:id", async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const customerId = req.user?.type === 'customer' ? req.user.id : req.query.customer_id;
    const { id } = req.params;
    
    if (!tenantId || !customerId) {
      return res.status(403).json({ ok: false, error: "Tenant o Customer ID requerido" });
    }
    
    // Verificar que la suscripción pertenece al cliente
    const [subRows] = await pool.query(
      `SELECT cs.id, cs.mp_preapproval_id, cs.status
       FROM customer_subscription cs
       WHERE cs.id = ? AND cs.customer_id = ? AND cs.tenant_id = ?
       LIMIT 1`,
      [id, customerId, tenantId]
    );
    
    if (subRows.length === 0) {
      return res.status(404).json({ ok: false, error: "Suscripción no encontrada" });
    }
    
    const subscription = subRows[0];
    
    // Si tiene preapproval_id, cancelar en Mercado Pago también
    if (subscription.mp_preapproval_id && subscription.status !== 'cancelled') {
      try {
        const { getTenantMpToken } = await import("../services/mercadoPago.js");
        const mpToken = await getTenantMpToken(tenantId);
        
        if (mpToken) {
          await fetch(`https://api.mercadopago.com/preapproval/${subscription.mp_preapproval_id}`, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${mpToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ status: "cancelled" }),
          });
        }
      } catch (mpError) {
        console.error("[DELETE /api/memberships/subscriptions/:id] Error cancelando en MP:", mpError);
        // Continuar aunque falle en MP, actualizamos en nuestra BD
      }
    }
    
    // Actualizar estado en la base de datos
    await pool.query(
      `UPDATE customer_subscription
       SET status = 'cancelled', canceled_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [id]
    );
    
    res.json({ ok: true, message: "Suscripción cancelada exitosamente" });
  } catch (error) {
    console.error("[DELETE /api/memberships/subscriptions/:id] error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Cambiar de plan (upgrade/downgrade)
// POST /api/memberships/subscriptions/:id/change-plan
router.post("/subscriptions/:id/change-plan", allowCustomerAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenant_id;
    const customerId = req.user?.type === 'customer' ? req.user.id : req.body.customer_id;
    const { membership_plan_id } = req.body;
    
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    
    if (!customerId) {
      return res.status(400).json({ ok: false, error: "Customer ID requerido" });
    }
    
    if (!membership_plan_id) {
      return res.status(400).json({ ok: false, error: "membership_plan_id es requerido" });
    }
    
    // Verificar que la suscripción existe y pertenece al cliente
    const [subRows] = await pool.query(
      `SELECT cs.*, mp.price_decimal as current_plan_price, mp.duration_months as current_duration
       FROM customer_subscription cs
       INNER JOIN membership_plan mp ON cs.membership_plan_id = mp.id
       WHERE cs.id = ? AND cs.customer_id = ? AND cs.tenant_id = ?
       LIMIT 1`,
      [id, customerId, tenantId]
    );
    
    if (subRows.length === 0) {
      return res.status(404).json({ ok: false, error: "Suscripción no encontrada" });
    }
    
    const subscription = subRows[0];
    
    // Verificar que el plan destino existe
    const [planRows] = await pool.query(
      `SELECT * FROM membership_plan WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1`,
      [membership_plan_id, tenantId]
    );
    
    if (planRows.length === 0) {
      return res.status(404).json({ ok: false, error: "Plan no encontrado o inactivo" });
    }
    
    const newPlan = planRows[0];
    
    // Verificar si es upgrade o downgrade
    const isUpgrade = Number(newPlan.price_decimal) > Number(subscription.current_plan_price);
    const isDowngrade = Number(newPlan.price_decimal) < Number(subscription.current_plan_price);
    
    // Si es downgrade, no permitir (debe contactar administración)
    if (isDowngrade) {
      return res.status(403).json({ 
        ok: false, 
        error: "Para bajar de plan, por favor contactá a administración",
        requires_admin: true 
      });
    }
    
    // Si es el mismo plan, no hacer nada
    if (newPlan.id === subscription.membership_plan_id) {
      return res.status(400).json({ ok: false, error: "Ya estás suscrito a este plan" });
    }
    
    // Si es upgrade, actualizar el plan
    // Cancelar la suscripción actual y crear una nueva con el nuevo plan
    await pool.query(
      `UPDATE customer_subscription
       SET status = 'cancelled', canceled_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [id]
    );
    
    // Crear nueva suscripción con el nuevo plan
    // Usar el mismo flujo que /subscribe pero sin crear preferencia de pago aún
    // El usuario deberá pagar la diferencia o el nuevo monto
    const nextChargeDate = new Date();
    nextChargeDate.setMonth(nextChargeDate.getMonth() + (newPlan.duration_months || 1));
    
    const [insertResult] = await pool.query(
      `INSERT INTO customer_subscription
       (tenant_id, customer_id, membership_plan_id, reason, amount_decimal, currency,
        frequency, frequency_type, status, created_at, updated_at, next_charge_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)`,
      [
        tenantId,
        customerId,
        membership_plan_id,
        newPlan.name,
        newPlan.price_decimal,
        "ARS",
        newPlan.duration_months || 1,
        "months",
        "pending", // Pendiente hasta que se pague
        nextChargeDate,
      ]
    );
    
    // Crear preferencia de pago para el nuevo plan
    const { getTenantMpToken } = await import("../services/mercadoPago.js");
    const mpToken = await getTenantMpToken(tenantId);
    
    if (!mpToken) {
      return res.status(503).json({ 
        ok: false, 
        error: "El sistema de pagos no está configurado para este negocio." 
      });
    }
    
    const frontendUrl = process.env.FRONTEND_BASE_URL;
    const isMobileApp = req.headers['x-client-type'] === 'mobile-app' || 
                        req.headers['user-agent']?.includes('ReactNative') ||
                        req.body?.is_mobile_app === true;
    
    const backUrls = isMobileApp || !frontendUrl ? {
      success: `arja-erp://payment-success?status=approved&subscription_id=${customerId}`,
      failure: `arja-erp://payment-failure`,
      pending: `arja-erp://payment-success?status=pending&subscription_id=${customerId}`
    } : {
      success: `${frontendUrl}/subscription/success?status=approved`,
      failure: `${frontendUrl}/subscription/failure`,
      pending: `${frontendUrl}/subscription/success?status=pending`
    };
    
    const preferencePayload = {
      items: [
        {
          title: newPlan.name,
          description: `Cambio de plan a ${newPlan.name}`,
          quantity: 1,
          unit_price: Number(newPlan.price_decimal),
          currency_id: "ARS",
        }
      ],
      external_reference: `tenant:${tenantId}:customer:${customerId}:plan:${membership_plan_id}:subscription:upgrade:${insertResult.insertId}`,
      back_urls: backUrls,
      auto_return: "approved",
      notification_url: `${process.env.API_URL || 'https://backend-production-1042.up.railway.app'}/api/mp-webhook`,
      statement_descriptor: newPlan.name.substring(0, 22),
      metadata: {
        tenant_id: tenantId,
        customer_id: customerId,
        membership_plan_id: membership_plan_id,
        subscription_id: insertResult.insertId,
        subscription_type: "membership_upgrade",
        previous_subscription_id: id
      }
    };
    
    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(preferencePayload),
    });
    
    const mpData = await mpResponse.json();
    
    if (!mpResponse.ok) {
      // Si falla la creación de la preferencia, eliminar la suscripción creada
      await pool.query(`DELETE FROM customer_subscription WHERE id = ?`, [insertResult.insertId]);
      return res.status(500).json({ 
        ok: false, 
        error: mpData.message || "Error al crear la preferencia de pago" 
      });
    }
    
    // Actualizar la suscripción con el link de pago
    await pool.query(
      `UPDATE customer_subscription
       SET mp_init_point = ?, mp_sandbox_init_point = ?, external_reference = ?
       WHERE id = ?`,
      [
        mpData.init_point || null,
        mpData.sandbox_init_point || null,
        preferencePayload.external_reference,
        insertResult.insertId,
      ]
    );
    
    res.json({ 
      ok: true, 
      data: {
        subscription_id: insertResult.insertId,
        mp_init_point: mpData.init_point || mpData.sandbox_init_point,
        message: "Plan actualizado. Por favor, completá el pago para activar el nuevo plan."
      }
    });
  } catch (error) {
    console.error("[POST /api/memberships/subscriptions/:id/change-plan] error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Rutas protegidas que requieren rol admin
// IMPORTANTE: Estas rutas solo son accesibles para admins
// Aplicamos requireRole individualmente a cada ruta en lugar de usar router.use()
// para evitar conflictos con las rutas públicas definidas arriba

router.post("/plans", requireRole("admin"), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const {
      name,
      description,
      price_decimal,
      duration_months,
      max_classes_per_week,
      max_classes_per_month,
      max_active_appointments,
      billing_day,
      grace_days,
      interest_type,
      interest_value,
      auto_block,
      // Campos opcionales para Mercado Pago
      repetitions,
      free_trial_frequency,
      free_trial_frequency_type,
      payment_methods_allowed,
    } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ ok: false, error: "El nombre es requerido" });
    }

    const price = Number(price_decimal ?? 0);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ ok: false, error: "Precio inválido" });
    }

    const duration = Math.max(1, parseInt(duration_months, 10) || 1);

    const weeklyLimit =
      max_classes_per_week != null && max_classes_per_week !== ""
        ? Math.max(0, parseInt(max_classes_per_week, 10) || 0)
        : null;
    const monthlyLimit =
      max_classes_per_month != null && max_classes_per_month !== ""
        ? Math.max(0, parseInt(max_classes_per_month, 10) || 0)
        : null;
    const activeAppointmentsLimit =
      max_active_appointments != null && max_active_appointments !== ""
        ? Math.max(0, parseInt(max_active_appointments, 10) || 0)
        : null;

    const billingDay =
      billing_day != null && billing_day !== ""
        ? Math.min(31, Math.max(1, parseInt(billing_day, 10) || 1))
        : null;

    const graceDays = Math.max(0, parseInt(grace_days, 10) || 0);

    const interestType =
      ["none", "fixed", "percent"].includes(String(interest_type || "").toLowerCase())
        ? String(interest_type).toLowerCase()
        : "none";
    const interestValue =
      interestType === "none" ? 0 : Math.max(0, Number(interest_value) || 0);

    const autoBlock = auto_block !== undefined ? Boolean(auto_block) : true;

    // Crear el plan en Mercado Pago usando /preapproval_plan
    let mpPlanId = null;
    try {
      const { getTenantMpToken } = await import("../services/mercadoPago.js");
      const mpToken = await getTenantMpToken(tenantId);

      if (mpToken) {
        // Preparar payload para Mercado Pago según la documentación
        const mpPayload = {
          reason: String(name).trim(),
          auto_recurring: {
            frequency: duration,
            frequency_type: "months",
            transaction_amount: price,
            currency_id: "ARS",
          },
        };

        // Agregar repetitions si está definido
        if (repetitions != null && repetitions !== "") {
          mpPayload.auto_recurring.repetitions = Math.max(1, parseInt(repetitions, 10) || 1);
        }

        // Agregar billing_day si está definido
        if (billingDay) {
          mpPayload.auto_recurring.billing_day = billingDay;
          mpPayload.auto_recurring.billing_day_proportional = false;
        }

        // Agregar free_trial si está definido
        if (free_trial_frequency && free_trial_frequency_type) {
          mpPayload.auto_recurring.free_trial = {
            frequency: parseInt(free_trial_frequency, 10) || 1,
            frequency_type: free_trial_frequency_type || "months",
          };
        }

        // Agregar payment_methods_allowed si está definido
        if (payment_methods_allowed && typeof payment_methods_allowed === 'object') {
          mpPayload.payment_methods_allowed = payment_methods_allowed;
        }

        // Agregar back_url si está disponible
        const backUrl = process.env.FRONTEND_BASE_URL || 'arja-erp://payment-success';
        if (backUrl) {
          mpPayload.back_url = backUrl;
        }

        console.log("[POST /api/memberships/plans] Creando plan en Mercado Pago:", JSON.stringify(mpPayload, null, 2));

        const mpResponse = await fetch("https://api.mercadopago.com/preapproval_plan", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${mpToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(mpPayload),
        });

        const mpData = await mpResponse.json();

        if (mpResponse.ok && mpData.id) {
          mpPlanId = mpData.id;
          console.log("[POST /api/memberships/plans] Plan creado en Mercado Pago con ID:", mpPlanId);
        } else {
          console.error("[POST /api/memberships/plans] Error creando plan en Mercado Pago:", mpData);
          // Continuar creando el plan local aunque falle Mercado Pago
        }
      } else {
        console.warn("[POST /api/memberships/plans] No se encontró token de Mercado Pago para el tenant");
      }
    } catch (mpError) {
      console.error("[POST /api/memberships/plans] Error al crear plan en Mercado Pago:", mpError);
      // Continuar creando el plan local aunque falle Mercado Pago
    }

    // Guardar el plan en la base de datos (con o sin mp_plan_id)
    const [result] = await pool.query(
      `INSERT INTO membership_plan
        (tenant_id, name, description, price_decimal, duration_months,
         max_classes_per_week, max_classes_per_month, max_active_appointments,
         billing_day, grace_days, interest_type, interest_value, auto_block, mp_plan_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        String(name).trim(),
        description || null,
        price,
        duration,
        weeklyLimit || null,
        monthlyLimit || null,
        activeAppointmentsLimit || null,
        billingDay,
        graceDays,
        interestType,
        interestValue,
        autoBlock ? 1 : 0,
        mpPlanId,
      ]
    );

    res.status(201).json({ 
      ok: true, 
      data: { 
        id: result.insertId,
        mp_plan_id: mpPlanId 
      } 
    });
  } catch (error) {
    console.error("[POST /api/memberships/plans] error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.put("/plans/:id", requireRole("admin"), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const { id } = req.params;
    const {
      name,
      description,
      price_decimal,
      duration_months,
      is_active,
      max_classes_per_week,
      max_classes_per_month,
      max_active_appointments,
      billing_day,
      grace_days,
      interest_type,
      interest_value,
      auto_block,
    } = req.body || {};

    const fields = [];
    const values = [];

    if (name !== undefined) {
      if (!String(name).trim()) {
        return res.status(400).json({ ok: false, error: "El nombre no puede estar vacío" });
      }
      fields.push("name = ?");
      values.push(String(name).trim());
    }

    if (description !== undefined) {
      fields.push("description = ?");
      values.push(description || null);
    }

    if (price_decimal !== undefined) {
      const price = Number(price_decimal);
      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({ ok: false, error: "Precio inválido" });
      }
      fields.push("price_decimal = ?");
      values.push(price);
    }

    if (duration_months !== undefined) {
      const duration = Math.max(1, parseInt(duration_months, 10) || 1);
      fields.push("duration_months = ?");
      values.push(duration);
    }

    if (max_classes_per_week !== undefined) {
      const val =
        max_classes_per_week === "" || max_classes_per_week === null
          ? null
          : Math.max(0, parseInt(max_classes_per_week, 10) || 0);
      fields.push("max_classes_per_week = ?");
      values.push(val);
    }

    if (max_classes_per_month !== undefined) {
      const val =
        max_classes_per_month === "" || max_classes_per_month === null
          ? null
          : Math.max(0, parseInt(max_classes_per_month, 10) || 0);
      fields.push("max_classes_per_month = ?");
      values.push(val);
    }

    if (max_active_appointments !== undefined) {
      const val =
        max_active_appointments === "" || max_active_appointments === null
          ? null
          : Math.max(0, parseInt(max_active_appointments, 10) || 0);
      fields.push("max_active_appointments = ?");
      values.push(val);
    }

    if (billing_day !== undefined) {
      const val =
        billing_day === "" || billing_day == null
          ? null
          : Math.min(31, Math.max(1, parseInt(billing_day, 10) || 1));
      fields.push("billing_day = ?");
      values.push(val);
    }

    if (grace_days !== undefined) {
      fields.push("grace_days = ?");
      values.push(Math.max(0, parseInt(grace_days, 10) || 0));
    }

    if (interest_type !== undefined) {
      const type =
        ["none", "fixed", "percent"].includes(String(interest_type || "").toLowerCase())
          ? String(interest_type).toLowerCase()
          : "none";
      fields.push("interest_type = ?");
      values.push(type);

      if (interest_value !== undefined) {
        const val = type === "none" ? 0 : Math.max(0, Number(interest_value) || 0);
        fields.push("interest_value = ?");
        values.push(val);
      }
    } else if (interest_value !== undefined) {
      const val = Math.max(0, Number(interest_value) || 0);
      fields.push("interest_value = ?");
      values.push(val);
    }

    if (auto_block !== undefined) {
      fields.push("auto_block = ?");
      values.push(auto_block ? 1 : 0);
    }

    if (is_active !== undefined) {
      fields.push("is_active = ?");
      values.push(is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      return res.status(400).json({ ok: false, error: "No hay campos para actualizar" });
    }

    values.push(id, tenantId);

    const [result] = await pool.query(
      `UPDATE membership_plan
          SET ${fields.join(", ")}
        WHERE id = ? AND tenant_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Plan no encontrado" });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("[PUT /api/memberships/plans/:id] error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.delete("/plans/:id", requireRole("admin"), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }
    const { id } = req.params;

    const [result] = await pool.query(
      `UPDATE membership_plan
          SET is_active = 0
        WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Plan no encontrado" });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/memberships/plans/:id] error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════
// ENDPOINT PARA RENOVACIÓN AUTOMÁTICA DE SUSCRIPCIONES
// ═══════════════════════════════════════════════════════════
// Este endpoint puede ser llamado por un cron job externo
// para renovar suscripciones automáticamente
router.post("/renew-subscriptions", async (req, res) => {
  try {
    // Verificar autenticación (opcional, puede requerir un token especial)
    const cronToken = req.headers['x-cron-token'] || req.query.token;
    const expectedToken = process.env.CRON_SECRET_TOKEN;
    
    if (expectedToken && cronToken !== expectedToken) {
      return res.status(401).json({ 
        ok: false, 
        error: "Token de autorización inválido" 
      });
    }
    
    console.log("[POST /api/memberships/renew-subscriptions] Iniciando proceso de renovación");
    
    const API_URL = process.env.API_URL || process.env.RAILWAY_PUBLIC_DOMAIN || 'https://backend-production-1042.up.railway.app';
    const FRONTEND_URL = process.env.FRONTEND_BASE_URL; // Solo usar si está configurado
    
    // Buscar suscripciones activas que necesitan renovación
    const [subscriptions] = await pool.query(
      `SELECT cs.*, mp.name as plan_name, mp.description as plan_description,
              mp.price_decimal, mp.duration_months
       FROM customer_subscription cs
       INNER JOIN membership_plan mp ON cs.membership_plan_id = mp.id
       WHERE cs.status = 'authorized'
         AND cs.next_charge_at IS NOT NULL
         AND cs.next_charge_at <= NOW()
         AND cs.next_charge_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       ORDER BY cs.next_charge_at ASC
       LIMIT 100`
    );

    if (subscriptions.length === 0) {
      return res.json({ 
        ok: true, 
        message: "No hay suscripciones que necesiten renovación",
        renewed: 0,
        errors: 0
      });
    }

    console.log(`[POST /api/memberships/renew-subscriptions] Encontradas ${subscriptions.length} suscripción(es) para renovar`);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const subscription of subscriptions) {
      try {
        console.log(`[POST /api/memberships/renew-subscriptions] Procesando suscripción ID: ${subscription.id}`);

        // Obtener token de Mercado Pago del tenant
        const { getTenantMpToken } = await import("../services/mercadoPago.js");
        const mpToken = await getTenantMpToken(subscription.tenant_id);
        
        if (!mpToken) {
          console.error(`[POST /api/memberships/renew-subscriptions] ❌ No se encontró token de MP para tenant ${subscription.tenant_id}`);
          errorCount++;
          errors.push({ subscription_id: subscription.id, error: "Token de MP no encontrado" });
          continue;
        }

        // Crear nueva preferencia de pago para la renovación
        const preferencePayload = {
          items: [
            {
              title: subscription.plan_name,
              description: subscription.plan_description || `Renovación ${subscription.plan_name}`,
              quantity: 1,
              unit_price: Number(subscription.price_decimal),
              currency_id: "ARS",
            }
          ],
          external_reference: `tenant:${subscription.tenant_id}:customer:${subscription.customer_id}:plan:${subscription.membership_plan_id}:subscription:renewal:${Date.now()}`,
          back_urls: FRONTEND_URL ? {
            success: `${FRONTEND_URL}/subscription/success?status=approved`,
            failure: `${FRONTEND_URL}/subscription/failure`,
            pending: `${FRONTEND_URL}/subscription/success?status=pending`
          } : {
            success: `arja-erp://payment-success?status=approved&subscription_id=${subscription.customer_id}`,
            failure: `arja-erp://payment-failure`,
            pending: `arja-erp://payment-success?status=pending&subscription_id=${subscription.customer_id}`
          },
          auto_return: "approved",
          notification_url: `${API_URL}/api/mp-webhook`,
          statement_descriptor: subscription.plan_name.substring(0, 22),
          metadata: {
            tenant_id: subscription.tenant_id,
            customer_id: subscription.customer_id,
            membership_plan_id: subscription.membership_plan_id,
            subscription_id: subscription.id,
            subscription_type: "membership_renewal"
          }
        };

        const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${mpToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(preferencePayload),
        });

        const mpData = await mpResponse.json();

        if (!mpResponse.ok) {
          console.error(`[POST /api/memberships/renew-subscriptions] ❌ Error creando preferencia:`, mpData);
          errorCount++;
          errors.push({ subscription_id: subscription.id, error: mpData.message || "Error creando preferencia" });
          continue;
        }

        // Actualizar la suscripción con el nuevo link de pago y marcar como pendiente de renovación
        await pool.query(
          `UPDATE customer_subscription
           SET mp_init_point = ?,
               mp_sandbox_init_point = ?,
               status = 'pending',
               updated_at = NOW()
           WHERE id = ?`,
          [
            mpData.init_point,
            mpData.sandbox_init_point || null,
            subscription.id
          ]
        );

        console.log(`[POST /api/memberships/renew-subscriptions] ✅ Suscripción ${subscription.id} actualizada con nuevo link de pago`);
        successCount++;

        // Enviar notificación al cliente
        try {
          const paymentLink = mpData.init_point || mpData.sandbox_init_point;
          await sendRenewalNotification(subscription, paymentLink);
        } catch (notifError) {
          console.warn(`[POST /api/memberships/renew-subscriptions] ⚠️ Error enviando notificación:`, notifError.message);
          // No fallar el proceso si la notificación falla
        }

      } catch (error) {
        console.error(`[POST /api/memberships/renew-subscriptions] ❌ Error procesando suscripción ${subscription.id}:`, error.message);
        errorCount++;
        errors.push({ subscription_id: subscription.id, error: error.message });
      }
    }

    return res.json({
      ok: true,
      message: `Proceso completado: ${successCount} renovadas, ${errorCount} errores`,
      renewed: successCount,
      errors: errorCount,
      error_details: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error("[POST /api/memberships/renew-subscriptions] ❌ Error fatal:", error);
    return res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ═══════════════════════════════════════════════════════════
// FUNCIÓN HELPER PARA ENVIAR NOTIFICACIONES DE RENOVACIÓN
// ═══════════════════════════════════════════════════════════
async function sendRenewalNotification(subscription, paymentLink) {
  try {
    // Obtener información del cliente
    const [customerRows] = await pool.query(
      `SELECT name, phone_e164, email FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [subscription.customer_id, subscription.tenant_id]
    );

    if (customerRows.length === 0) {
      console.warn(`[RENEWAL NOTIFICATION] No se encontró cliente ${subscription.customer_id}`);
      return;
    }

    const customer = customerRows[0];
    
    // Obtener nombre del tenant
    const [[tenant]] = await pool.query("SELECT name FROM tenant WHERE id = ? LIMIT 1", [subscription.tenant_id]);
    const tenantName = tenant?.name || "ARJA ERP";
    
    const amountFormatted = Number(subscription.amount_decimal).toLocaleString("es-AR", {
      style: "currency",
      currency: subscription.currency || "ARS",
    });

    // Enviar WhatsApp si tiene teléfono
    if (customer.phone_e164) {
      const message = 
        `🔄 *Renovación de Suscripción*\n\n` +
        `Hola ${customer.name || 'Cliente'}!\n\n` +
        `Tu suscripción *${subscription.plan_name || subscription.reason}* necesita renovarse.\n\n` +
        `• Plan: ${subscription.plan_name || subscription.reason}\n` +
        `• Monto: ${amountFormatted}\n` +
        `• Duración: ${subscription.frequency || 1} ${subscription.frequency_type === 'months' ? 'mes(es)' : 'día(s)'}\n\n` +
        `Para renovar, hacé clic en el siguiente link:\n${paymentLink}\n\n` +
        `Si tenés alguna consulta, no dudes en contactarnos.`;

      const sendResult = await sendWhatsAppText(customer.phone_e164, message, subscription.tenant_id);
      
      if (sendResult?.skipped) {
        console.warn(`[RENEWAL NOTIFICATION] WhatsApp saltado (sin credenciales) para ${customer.phone_e164}`);
      } else if (sendResult?.error) {
        console.error(`[RENEWAL NOTIFICATION] Error enviando WhatsApp:`, sendResult.error);
      } else {
        console.log(`[RENEWAL NOTIFICATION] ✅ Notificación enviada por WhatsApp a ${customer.phone_e164}`);
      }
    } else {
      console.warn(`[RENEWAL NOTIFICATION] Cliente ${subscription.customer_id} no tiene teléfono configurado`);
    }

    // TODO: Enviar email si está implementado
    if (customer.email) {
      console.log(`[RENEWAL NOTIFICATION] Email no implementado aún para ${customer.email}`);
    }

  } catch (error) {
    console.error(`[RENEWAL NOTIFICATION] Error enviando notificación:`, error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════
// ENDPOINT PARA ENVIAR RECORDATORIOS DE RENOVACIÓN
// ═══════════════════════════════════════════════════════════
// Este endpoint envía recordatorios a clientes cuyas suscripciones
// están próximas a vencer (dentro de X días)
router.post("/send-renewal-reminders", async (req, res) => {
  try {
    // Verificar autenticación
    const cronToken = req.headers['x-cron-token'] || req.query.token;
    const expectedToken = process.env.CRON_SECRET_TOKEN;
    
    if (expectedToken && cronToken !== expectedToken) {
      return res.status(401).json({ 
        ok: false, 
        error: "Token de autorización inválido" 
      });
    }
    
    const daysBefore = parseInt(req.query.days || req.body.days || 3, 10); // Por defecto 3 días antes
    
    console.log(`[POST /api/memberships/send-renewal-reminders] Enviando recordatorios (${daysBefore} días antes)`);
    
    // Buscar suscripciones que vencen en los próximos X días
    const [subscriptions] = await pool.query(
      `SELECT cs.*, mp.name as plan_name, mp.description as plan_description,
              mp.price_decimal, mp.duration_months
       FROM customer_subscription cs
       INNER JOIN membership_plan mp ON cs.membership_plan_id = mp.id
       WHERE cs.status = 'authorized'
         AND cs.next_charge_at IS NOT NULL
         AND cs.next_charge_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? DAY)
         AND (cs.last_payment_at IS NULL OR cs.last_payment_at < DATE_SUB(cs.next_charge_at, INTERVAL ? DAY))
       ORDER BY cs.next_charge_at ASC
       LIMIT 100`,
      [daysBefore, daysBefore]
    );

    if (subscriptions.length === 0) {
      return res.json({ 
        ok: true, 
        message: `No hay suscripciones que necesiten recordatorio (${daysBefore} días antes)`,
        reminders_sent: 0,
        errors: 0
      });
    }

    console.log(`[POST /api/memberships/send-renewal-reminders] Encontradas ${subscriptions.length} suscripción(es) para recordatorio`);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const subscription of subscriptions) {
      try {
        // Obtener información del cliente
        const [customerRows] = await pool.query(
          `SELECT name, phone_e164, email FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
          [subscription.customer_id, subscription.tenant_id]
        );

        if (customerRows.length === 0 || !customerRows[0].phone_e164) {
          console.warn(`[POST /api/memberships/send-renewal-reminders] Cliente ${subscription.customer_id} sin teléfono`);
          continue;
        }

        const customer = customerRows[0];
        
        // Obtener nombre del tenant
        const [[tenant]] = await pool.query("SELECT name FROM tenant WHERE id = ? LIMIT 1", [subscription.tenant_id]);
        const tenantName = tenant?.name || "ARJA ERP";
        
        const amountFormatted = Number(subscription.price_decimal).toLocaleString("es-AR", {
          style: "currency",
          currency: subscription.currency || "ARS",
        });

        // Calcular días restantes
        const daysRemaining = Math.ceil((new Date(subscription.next_charge_at) - new Date()) / (1000 * 60 * 60 * 24));
        const renewalDate = new Date(subscription.next_charge_at).toLocaleDateString("es-AR", {
          day: "numeric",
          month: "long",
          year: "numeric"
        });

        // Obtener link de pago si existe, o crear uno nuevo
        let paymentLink = subscription.mp_init_point || subscription.mp_sandbox_init_point;
        
        if (!paymentLink) {
          // Si no hay link, crear uno nuevo
          const { getTenantMpToken } = await import("../services/mercadoPago.js");
          const mpToken = await getTenantMpToken(subscription.tenant_id);
          
          if (mpToken) {
            const FRONTEND_URL = process.env.FRONTEND_BASE_URL;
            const API_URL = process.env.API_URL || process.env.RAILWAY_PUBLIC_DOMAIN || 'https://backend-production-1042.up.railway.app';
            
            const preferencePayload = {
              items: [{
                title: subscription.plan_name,
                description: subscription.plan_description || `Renovación ${subscription.plan_name}`,
                quantity: 1,
                unit_price: Number(subscription.price_decimal),
                currency_id: "ARS",
              }],
              external_reference: `tenant:${subscription.tenant_id}:customer:${subscription.customer_id}:plan:${subscription.membership_plan_id}:subscription:renewal:${Date.now()}`,
              back_urls: FRONTEND_URL ? {
                success: `${FRONTEND_URL}/memberships/success`,
                failure: `${FRONTEND_URL}/memberships/failure`,
                pending: `${FRONTEND_URL}/memberships/pending`
              } : {
                success: `arja-erp://payment-success?status=approved&subscription_id=${subscription.customer_id}`,
                failure: `arja-erp://payment-failure`,
                pending: `arja-erp://payment-success?status=pending&subscription_id=${subscription.customer_id}`
              },
              auto_return: "approved",
              notification_url: `${API_URL}/api/mp-webhook`,
              statement_descriptor: subscription.plan_name.substring(0, 22),
              metadata: {
                tenant_id: subscription.tenant_id,
                customer_id: subscription.customer_id,
                membership_plan_id: subscription.membership_plan_id,
                subscription_id: subscription.id,
                subscription_type: "membership_renewal"
              }
            };

            const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${mpToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(preferencePayload),
            });

            const mpData = await mpResponse.json();
            if (mpResponse.ok) {
              paymentLink = mpData.init_point || mpData.sandbox_init_point;
              
              // Actualizar la suscripción con el nuevo link
              await pool.query(
                `UPDATE customer_subscription
                 SET mp_init_point = ?,
                     mp_sandbox_init_point = ?,
                     updated_at = NOW()
                 WHERE id = ?`,
                [mpData.init_point, mpData.sandbox_init_point || null, subscription.id]
              );
            }
          }
        }

        const message = 
          `⏰ *Recordatorio de Renovación*\n\n` +
          `Hola ${customer.name || 'Cliente'}!\n\n` +
          `Te recordamos que tu suscripción *${subscription.plan_name}* vence en ${daysRemaining} día(s).\n\n` +
          `• Plan: ${subscription.plan_name}\n` +
          `• Monto: ${amountFormatted}\n` +
          `• Fecha de renovación: ${renewalDate}\n\n` +
          (paymentLink ? `Para renovar ahora, hacé clic aquí:\n${paymentLink}\n\n` : '') +
          `Si tenés alguna consulta, no dudes en contactarnos.`;

        const sendResult = await sendWhatsAppText(customer.phone_e164, message, subscription.tenant_id);
        
        if (sendResult?.skipped) {
          console.warn(`[POST /api/memberships/send-renewal-reminders] WhatsApp saltado para ${customer.phone_e164}`);
        } else if (sendResult?.error) {
          console.error(`[POST /api/memberships/send-renewal-reminders] Error enviando WhatsApp:`, sendResult.error);
          errorCount++;
          errors.push({ subscription_id: subscription.id, error: sendResult.error });
        } else {
          // El recordatorio se marca implícitamente al verificar last_payment_at
          // No necesitamos una columna separada ya que verificamos que no se haya pagado recientemente
          
          console.log(`[POST /api/memberships/send-renewal-reminders] ✅ Recordatorio enviado a ${customer.phone_e164}`);
          successCount++;
        }

      } catch (error) {
        console.error(`[POST /api/memberships/send-renewal-reminders] ❌ Error procesando suscripción ${subscription.id}:`, error.message);
        errorCount++;
        errors.push({ subscription_id: subscription.id, error: error.message });
      }
    }

    return res.json({
      ok: true,
      message: `Proceso completado: ${successCount} recordatorios enviados, ${errorCount} errores`,
      reminders_sent: successCount,
      errors: errorCount,
      error_details: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error("[POST /api/memberships/send-renewal-reminders] ❌ Error fatal:", error);
    return res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

export default router;

