import { cfgString } from "./services/config.js"; // ojo a la ruta real
import { MercadoPagoConfig, Preference } from "mercadopago";
import { pool } from "./db.js";
import { getTenantMpToken } from "./services/mercadoPago.js";

export async function createDepositPaymentLink({
  tenantId,
  appointmentId,
  amount,
  title,
  holdMinutes = 30,
}) {
  if (!tenantId) throw new Error("tenantId requerido");
  if (!appointmentId) throw new Error("appointmentId requerido");

  // MP del tenant - usar getTenantMpToken para renovar automáticamente si está expirado
  const accessToken = await getTenantMpToken(tenantId);
  if (!accessToken) throw new Error("MP no conectado para este negocio");

  // Obtener información adicional del tenant (modo LIVE/SANDBOX)
  const [[mpCfg]] = await pool.query(
    `SELECT mp_user_id, mp_live_mode
       FROM tenant_payment_config
      WHERE tenant_id=? AND is_active=1
      LIMIT 1`,
    [tenantId]
  );

  console.log(`[createDepositPaymentLink] 🔐 Credenciales MP utilizadas:`, {
    tenantId,
    userId: mpCfg?.mp_user_id || 'N/A',
    liveMode: mpCfg?.mp_live_mode === 1 ? 'LIVE (Producción)' : 'SANDBOX (Pruebas)',
    accessToken: accessToken ? `${accessToken.substring(0, 20)}...` : 'NO DISPONIBLE',
    tokenLength: accessToken?.length || 0,
  });

  // Validar estado de la cuenta de Mercado Pago (solo en modo LIVE)
  const isLiveMode = mpCfg?.mp_live_mode === 1 || mpCfg?.mp_live_mode === true;
  if (isLiveMode) {
    try {
      const fetch = (await import("node-fetch")).default;
      const accountResp = await fetch("https://api.mercadopago.com/users/me", {
        headers: { 
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
      
      if (accountResp.ok) {
        const accountData = await accountResp.json();
        const siteId = accountData.site_id;
        const countryId = accountData.country_id;
        const isVerified = siteId === "MLA" || countryId === "AR";
        
        console.log(`[createDepositPaymentLink] 📊 Estado de cuenta MP:`, {
          siteId,
          countryId,
          isVerified,
          email: accountData.email,
          firstName: accountData.first_name,
          lastName: accountData.last_name,
        });

        if (!isVerified) {
          console.warn(`[createDepositPaymentLink] ⚠️ ADVERTENCIA: Cuenta MP no verificada (site_id: ${siteId}, country_id: ${countryId})`);
          console.warn(`[createDepositPaymentLink] ⚠️ Esto puede causar el error CPT01 al intentar pagar`);
        }
      } else {
        console.warn(`[createDepositPaymentLink] ⚠️ No se pudo verificar estado de cuenta MP (status: ${accountResp.status})`);
      }
    } catch (accountErr) {
      console.warn(`[createDepositPaymentLink] ⚠️ Error al verificar cuenta MP:`, accountErr.message);
      // No fallar la creación de la preferencia por esto, solo advertir
    }
  }

  // Validar monto
  const amountNum = Number(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    throw new Error(`Monto inválido: ${amount}. Debe ser un número positivo.`);
  }

  // Mercado Pago tiene un monto mínimo (generalmente $1 ARS)
  // Asegurar que el monto sea al menos 1
  if (amountNum < 1) {
    throw new Error(`Monto demasiado bajo: $${amountNum}. El monto mínimo es $1 ARS.`);
  }

  // Redondear a 2 decimales máximo (MP no acepta más decimales)
  // IMPORTANTE: MP requiere que unit_price sea un número válido, sin más de 2 decimales
  const roundedAmount = Math.round(amountNum * 100) / 100;
  
  // Asegurar que el monto sea exactamente un número (no string, no NaN, no Infinity)
  if (!isFinite(roundedAmount) || roundedAmount <= 0) {
    throw new Error(`Monto inválido después de redondear: ${roundedAmount}`);
  }
  
  console.log(`[createDepositPaymentLink] Monto procesado: ${amount} → ${amountNum} → ${roundedAmount} (tipo: ${typeof roundedAmount})`);

  // URLs por tenant (con fallback a variables de entorno)
  const defaultFront = process.env.FRONTEND_URL || "http://localhost:5173";
  const defaultApi = process.env.API_URL || process.env.BACKEND_URL || "http://localhost:3000";
  
  const FRONT = await cfgString("frontend.url", defaultFront, tenantId);
  const API   = await cfgString("api.url", defaultApi, tenantId);

  console.log(`[createDepositPaymentLink] Raw config - FRONT="${FRONT}", API="${API}"`);

  // Validar que las URLs no sean null o undefined
  if (!FRONT || FRONT === 'null' || FRONT === 'undefined' || FRONT === null || FRONT === undefined) {
    throw new Error(`URL de frontend inválida: FRONT=${FRONT}. Configura FRONTEND_URL en .env o frontend.url en system_config`);
  }
  
  if (!API || API === 'null' || API === 'undefined' || API === null || API === undefined) {
    throw new Error(`URL de API inválida: API=${API}. Configura API_URL en .env o api.url en system_config`);
  }

  // Remover barra final si existe y espacios
  const frontUrl = String(FRONT).trim().replace(/\/$/, '');
  const apiUrl = String(API).trim().replace(/\/$/, '');

  // Validar formato de URL
  try {
    new URL(frontUrl);
    new URL(apiUrl);
  } catch (e) {
    throw new Error(`URLs inválidas. FRONT=${frontUrl}, API=${apiUrl}. Error: ${e.message}`);
  }

  // Verificar si las URLs son localhost (no públicas) - MP no acepta localhost con auto_return
  const isLocalhost = frontUrl.includes('localhost') || frontUrl.includes('127.0.0.1') || frontUrl.includes('0.0.0.0');

  const client = new MercadoPagoConfig({ accessToken });
  const pref = new Preference(client);

  // Construir URLs de callback - siempre usar frontend (NO redirigir a WhatsApp)
  const successUrl = `${frontUrl}/payment/success?ref=${tenantId}:${appointmentId}`;
  const failureUrl = `${frontUrl}/payment/failure?ref=${tenantId}:${appointmentId}`;
  const pendingUrl = `${frontUrl}/payment/pending?ref=${tenantId}:${appointmentId}`;
  const notificationUrl = `${apiUrl}/api/mp-webhook`;

  // Validar que todas las URLs sean válidas antes de enviarlas a MP
  if (!successUrl || !failureUrl || !pendingUrl) {
    throw new Error(`URLs de callback inválidas: success=${successUrl}, failure=${failureUrl}, pending=${pendingUrl}`);
  }

  console.log(`[createDepositPaymentLink] URLs construidas:`, {
    success: successUrl,
    failure: failureUrl,
    pending: pendingUrl,
    notification: notificationUrl
  });

  // Construir back_urls asegurando que todas las propiedades estén definidas
  const backUrls = {
    success: successUrl,
    failure: failureUrl,
    pending: pendingUrl,
  };

  // Validar que back_urls tenga todas las propiedades requeridas
  if (!backUrls.success || !backUrls.failure || !backUrls.pending) {
    throw new Error(`back_urls inválido: ${JSON.stringify(backUrls)}`);
  }

  // Configurar fecha de expiración (máximo 60 minutos)
  const safeHold = Math.min(30, Math.max(1, Number(holdMinutes || 30)));
  const expirationDate = new Date(Date.now() + safeHold * 60 * 1000);
  const minExpiration = new Date(Date.now() + 60 * 1000); // Mínimo 1 minuto
  if (expirationDate < minExpiration) {
    expirationDate.setTime(minExpiration.getTime());
  }
  if (isNaN(expirationDate.getTime())) {
    throw new Error(`Fecha de expiración inválida: ${expirationDate}`);
  }
  const expirationDateISO = expirationDate.toISOString().replace(/\.\d{3}Z$/, "Z");

  // Construir body de forma más segura y validada
  // IMPORTANTE: MP requiere tipos específicos y formatos exactos
  const itemId = String(`seña-${appointmentId}`).substring(0, 256);
  const itemTitle = String(title || "Seña").substring(0, 127);
  const finalUnitPrice = parseFloat(roundedAmount.toFixed(2)); // Asegurar máximo 2 decimales
  
  console.log(`[createDepositPaymentLink] Construyendo body:`, {
    itemId,
    itemTitle,
    finalUnitPrice,
    finalUnitPriceType: typeof finalUnitPrice,
    isFinite: isFinite(finalUnitPrice)
  });

  const body = {
    items: [{
      id: itemId,
      title: itemTitle,
      quantity: 1,
      currency_id: "ARS",
      unit_price: finalUnitPrice, // Número válido con máximo 2 decimales
    }],
    back_urls: {
      success: String(successUrl),
      failure: String(failureUrl),
      pending: String(pendingUrl),
    },
    notification_url: String(notificationUrl),
    external_reference: String(`${tenantId}:${appointmentId}`).substring(0, 256),
    expires: true,
    expiration_date_to: expirationDateISO,
    // Configuraciones adicionales para evitar errores CPT01
    payment_methods: {
      excluded_payment_methods: [],
      excluded_payment_types: [],
      installments: 12, // Permitir hasta 12 cuotas
      default_installments: 1, // Por defecto 1 cuota
    },
    // Configurar para Argentina específicamente (máximo 22 caracteres)
    statement_descriptor: "ARJA ERP".substring(0, 22),
    metadata: {
      tenant_id: String(tenantId),
      appointment_id: String(appointmentId),
      type: "deposit",
    },
  };

  // Validaciones adicionales antes de enviar
  if (!body.items || body.items.length === 0) {
    throw new Error("La preferencia debe tener al menos un ítem");
  }

  const item = body.items[0];
  
  // Validar unit_price con más detalle
  if (!item.unit_price || item.unit_price <= 0 || isNaN(item.unit_price) || !isFinite(item.unit_price)) {
    throw new Error(`Precio unitario inválido: ${item.unit_price} (tipo: ${typeof item.unit_price}, isFinite: ${isFinite(item.unit_price)})`);
  }

  if (item.unit_price < 1) {
    throw new Error(`El precio unitario debe ser al menos $1 ARS. Valor actual: $${item.unit_price}`);
  }

  // Asegurar que unit_price tenga máximo 2 decimales
  const priceStr = item.unit_price.toString();
  const decimalPlaces = priceStr.includes('.') ? priceStr.split('.')[1].length : 0;
  if (decimalPlaces > 2) {
    // Forzar a 2 decimales
    item.unit_price = parseFloat(item.unit_price.toFixed(2));
    console.log(`[createDepositPaymentLink] Ajustado unit_price a 2 decimales: ${item.unit_price}`);
  }

  // Asegurar que todos los campos requeridos estén presentes y sean del tipo correcto
  if (!item.currency_id || item.currency_id !== "ARS") {
    throw new Error(`Currency inválido: ${item.currency_id}`);
  }

  if (!item.quantity || item.quantity !== 1) {
    throw new Error(`Quantity debe ser 1. Valor actual: ${item.quantity}`);
  }

  // Validar que el título no esté vacío
  if (!item.title || item.title.trim().length === 0) {
    throw new Error(`El título del ítem no puede estar vacío`);
  }

  // Validar que el id no esté vacío
  if (!item.id || item.id.trim().length === 0) {
    throw new Error(`El ID del ítem no puede estar vacío`);
  }

  console.log(`[createDepositPaymentLink] Body validado:`, {
    items_count: body.items.length,
    unit_price: body.items[0].unit_price,
    currency: body.items[0].currency_id,
    expires: body.expires,
    expiration_date: body.expiration_date_to
  });

  // Solo agregar auto_return si NO es localhost (MP requiere URLs públicas para auto_return)
  // IMPORTANTE: Si usamos auto_return, back_urls.success DEBE estar definido y ser válido
  // En modo LIVE, las URLs de localhost pueden causar problemas, pero no incluimos auto_return
  if (!isLocalhost && body.back_urls?.success) {
    body.auto_return = "approved";
    console.log(`[createDepositPaymentLink] auto_return agregado (URLs públicas)`);
  } else {
    console.log(`[createDepositPaymentLink] WARNING: URLs son localhost (${frontUrl}). No se usará auto_return para evitar errores.`);
    // No incluir auto_return para evitar errores
    // Esto es correcto para desarrollo local, pero en producción deberías usar URLs públicas
    delete body.auto_return;
  }

  // Advertencia si estamos en modo LIVE pero con URLs localhost
  if (isLiveMode && isLocalhost) {
    console.warn(`[createDepositPaymentLink] ⚠️ ADVERTENCIA: Modo LIVE con URLs localhost. Mercado Pago puede rechazar pagos.`);
    console.warn(`[createDepositPaymentLink] ⚠️ Para producción, configura URLs públicas en FRONTEND_URL y API_URL del .env`);
  }

  // Validar estructura final antes de enviar
  if (!body.back_urls || !body.back_urls.success) {
    console.error(`[createDepositPaymentLink] ERROR: back_urls.success no está definido antes de enviar!`);
    throw new Error(`back_urls.success es requerido para crear la preferencia`);
  }

  // Limpiar campos undefined/null antes de enviar (Mercado Pago puede rechazar campos undefined)
  const cleanBody = JSON.parse(JSON.stringify(body, (key, value) => {
    // Eliminar campos undefined o null innecesarios
    if (value === undefined || value === null) {
      return undefined; // JSON.stringify eliminará estos campos
    }
    // Si es un objeto vacío, mantenerlo solo si es necesario
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
      // Mantener objetos vacíos si son importantes (como payment_methods)
      return value;
    }
    return value;
  }));

  console.log(`[createDepositPaymentLink] Preference body (final):`, JSON.stringify(cleanBody, null, 2));

  try {
    // Validar una última vez antes de enviar
    console.log(`[createDepositPaymentLink] Enviando a MP con body:`, JSON.stringify(cleanBody, null, 2));
    console.log(`[createDepositPaymentLink] Validaciones finales:`, {
      unit_price: cleanBody.items[0].unit_price,
      unit_price_type: typeof cleanBody.items[0].unit_price,
      currency_id: cleanBody.items[0].currency_id,
      has_back_urls: !!cleanBody.back_urls,
      back_urls_success: cleanBody.back_urls?.success,
      expiration_date_to: cleanBody.expiration_date_to,
      expires: cleanBody.expires
    });

    const prefResult = await pref.create({ body: cleanBody });
    
    console.log(`[createDepositPaymentLink] MP Response recibida:`, {
      has_init_point: !!prefResult?.init_point,
      has_sandbox_init_point: !!prefResult?.sandbox_init_point,
      preference_id: prefResult?.id,
      mode: mpCfg.mp_live_mode ? 'LIVE' : 'SANDBOX',
      status: prefResult?.status,
      response_keys: Object.keys(prefResult || {})
    });
    
    if (!prefResult || (!prefResult.init_point && !prefResult.sandbox_init_point)) {
      console.error(`[createDepositPaymentLink] MP response error completo:`, JSON.stringify(prefResult, null, 2));
      throw new Error(`Mercado Pago no devolvió un link válido. Respuesta: ${JSON.stringify(prefResult)}`);
    }
    
    // En modo LIVE usar init_point, en SANDBOX usar sandbox_init_point (o init_point como fallback)
    let link;
    if (isLiveMode) {
      link = prefResult?.init_point;
      console.log(`[createDepositPaymentLink] Using LIVE link (init_point)`);
    } else {
      link = prefResult?.sandbox_init_point || prefResult?.init_point;
      console.log(`[createDepositPaymentLink] Using SANDBOX link: ${prefResult?.sandbox_init_point ? 'sandbox_init_point' : 'init_point (fallback)'}`);
    }

    // Registrar creación de preferencia en tabla payment (estado pending)
    try {
      const amountCents = Math.round(finalUnitPrice * 100);
      await pool.query(
        `INSERT INTO payment 
           (tenant_id, appointment_id, method, mp_preference_id, amount_cents, currency, mp_payment_status, created_at)
         VALUES (?,?,?,?,?,'ARS','pending', NOW())`,
        [tenantId, appointmentId, 'mercadopago', prefResult?.id, amountCents]
      );
      console.log(`[createDepositPaymentLink] Payment registrado (pending). preference_id=${prefResult?.id}, amount_cents=${amountCents}`);
      await pool.query(
        `UPDATE appointment a
           JOIN (
             SELECT created_at 
             FROM payment 
             WHERE tenant_id = ? AND appointment_id = ? AND method = 'mercadopago'
             ORDER BY created_at DESC 
             LIMIT 1
           ) p
           SET 
             a.status = CASE WHEN a.status = 'scheduled' THEN 'pending_deposit' ELSE a.status END,
             a.deposit_decimal = ?,
             a.hold_until = DATE_ADD(p.created_at, INTERVAL ? MINUTE)
         WHERE a.id = ? AND a.tenant_id = ?`,
        [tenantId, appointmentId, finalUnitPrice, safeHold, appointmentId, tenantId]
      );
    } catch (dbErr) {
      console.warn(`[createDepositPaymentLink] No se pudo registrar payment pending:`, dbErr.message);
    }
    
    if (!link) {
      console.error(`[createDepositPaymentLink] No link found in response completo:`, JSON.stringify(prefResult, null, 2));
      throw new Error("MP no devolvió link");
    }
    
    console.log(`[createDepositPaymentLink] ✅ Success! Link generado (${isLiveMode ? 'LIVE' : 'SANDBOX'}): ${link.substring(0, 80)}...`);
    return link;
  } catch (error) {
    console.error(`[createDepositPaymentLink] ❌ Error completo:`, error);
    console.error(`[createDepositPaymentLink] Error name:`, error.name);
    console.error(`[createDepositPaymentLink] Error message:`, error.message);
    console.error(`[createDepositPaymentLink] Error stack:`, error.stack);
    
    // Si es un error de la SDK de MP, extraer información detallada
    if (error.cause) {
      console.error(`[createDepositPaymentLink] Error cause:`, JSON.stringify(error.cause, null, 2));
    }
    
    if (error.response) {
      console.error(`[createDepositPaymentLink] Error response:`, JSON.stringify(error.response, null, 2));
    }
    
    if (error.data) {
      console.error(`[createDepositPaymentLink] Error data:`, JSON.stringify(error.data, null, 2));
    }

    // Extraer información del error de Mercado Pago de diferentes posibles ubicaciones
    const errorBody = error.cause?.body || error.response?.data || error.data || error.cause || {};
    const errorStatus = error.cause?.status || error.response?.status || error.statusCode || error.status;
    
    console.error(`[createDepositPaymentLink] 📋 Detalles del error MP:`, {
      status: errorStatus,
      errorBody: JSON.stringify(errorBody, null, 2),
      errorKeys: Object.keys(errorBody),
    });

    // Detectar error CPT01 en diferentes formatos
    const cpt01Detected = 
      error.message?.includes("CPT01") ||
      error.cause?.message?.includes("CPT01") ||
      errorBody.message?.includes("CPT01") ||
      errorBody.error?.includes("CPT01") ||
      JSON.stringify(errorBody).includes("CPT01");

    if (cpt01Detected) {
      console.error(`[createDepositPaymentLink] ❌ Error CPT01 detectado`);
      console.error(`[createDepositPaymentLink]   - Error completo:`, JSON.stringify(errorBody, null, 2));
      console.error(`[createDepositPaymentLink]   - Status:`, errorStatus);
      
      // Mensaje más específico basado en lo que sabemos sobre CPT01
      let detailedMessage = `Error CPT01 de Mercado Pago: La cuenta no está habilitada para recibir pagos online.\n\n`;
      detailedMessage += `⚠️ Este error aparece cuando el usuario intenta pagar, no cuando se crea el link.\n\n`;
      detailedMessage += `📋 Pasos para resolver:\n\n`;
      detailedMessage += `1. Verifica tu cuenta en Mercado Pago:\n`;
      detailedMessage += `   → https://www.mercadopago.com.ar/home\n`;
      detailedMessage += `   → Inicia sesión con la cuenta conectada a la aplicación\n\n`;
      detailedMessage += `2. Verifica el estado de la cuenta:\n`;
      detailedMessage += `   → Ve a "Tu negocio" → "Configuración" → "Aceptar pagos"\n`;
      detailedMessage += `   → Asegúrate de que esté habilitada para recibir pagos online\n`;
      detailedMessage += `   → Completa la verificación de identidad si está pendiente\n\n`;
      detailedMessage += `3. Verifica los permisos:\n`;
      detailedMessage += `   → La cuenta debe ser Administrador (no Colaborador)\n`;
      detailedMessage += `   → Debe tener permisos para recibir pagos\n\n`;
      detailedMessage += `4. Verifica el país:\n`;
      detailedMessage += `   → La cuenta debe estar registrada en Argentina (MLA)\n`;
      detailedMessage += `   → El país_id debe ser "AR"\n\n`;
      detailedMessage += `5. Si estás en modo SANDBOX:\n`;
      detailedMessage += `   → El error CPT01 puede aparecer en SANDBOX si la cuenta no está configurada\n`;
      detailedMessage += `   → Considera cambiar a modo LIVE si ya verificaste la cuenta\n\n`;
      detailedMessage += `📊 Revisa los logs del servidor para ver el estado actual de la cuenta conectada.`;
      
      if (errorBody.cause?.length > 0) {
        detailedMessage += `\n\nErrores específicos de MP:\n`;
        errorBody.cause.forEach((c, idx) => {
          detailedMessage += `${idx + 1}. ${c.message || c}\n`;
          if (c.code) detailedMessage += `   Código: ${c.code}\n`;
          if (c.data) detailedMessage += `   Data: ${JSON.stringify(c.data)}\n`;
        });
      }
      
      throw new Error(detailedMessage);
    }
    
    // Extraer mensaje de error más específico
    let errorMessage = error.message || "Error desconocido";
    
    if (error.cause?.message) {
      errorMessage = error.cause.message;
    } else if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    } else if (error.data?.message) {
      errorMessage = error.data.message;
    } else if (errorBody.message) {
      errorMessage = errorBody.message;
    }
    
    throw new Error(`Error al crear preferencia de pago: ${errorMessage}`);
  }
}

/**
 * Crear link de pago genérico (no asociado a un appointment)
 */
export async function createGenericPaymentLink({
  tenantId,
  amount,
  title,
  description = null,
  customerId = null,
  expiresInDays = 7,
}) {
  if (!tenantId) throw new Error("tenantId requerido");
  if (!amount || amount <= 0) throw new Error("amount debe ser un número positivo");

  // MP del tenant
  const accessToken = await getTenantMpToken(tenantId);
  if (!accessToken) throw new Error("MP no conectado para este negocio");

  // Obtener información adicional del tenant
  const [[mpCfg]] = await pool.query(
    `SELECT mp_user_id, mp_live_mode
       FROM tenant_payment_config
      WHERE tenant_id=? AND is_active=1
      LIMIT 1`,
    [tenantId]
  );

  const isLiveMode = mpCfg?.mp_live_mode === 1 || mpCfg?.mp_live_mode === true;

  // Validar y redondear monto
  const amountNum = Number(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    throw new Error(`Monto inválido: ${amount}`);
  }
  if (amountNum < 1) {
    throw new Error(`Monto demasiado bajo: $${amountNum}. El monto mínimo es $1 ARS.`);
  }
  const roundedAmount = Math.round(amountNum * 100) / 100;

  // URLs por tenant (con fallback a variables de entorno)
  const defaultFront = process.env.FRONTEND_URL || "http://localhost:5173";
  const defaultApi = process.env.API_URL || process.env.BACKEND_URL || "http://localhost:3000";
  
  const FRONT = await cfgString("frontend.url", defaultFront, tenantId);
  const API   = await cfgString("api.url", defaultApi, tenantId);

  // Validar que las URLs no sean null o undefined
  if (!FRONT || FRONT === 'null' || FRONT === 'undefined' || FRONT === null || FRONT === undefined) {
    throw new Error(`URL de frontend inválida: FRONT=${FRONT}. Configura FRONTEND_URL en .env o frontend.url en system_config`);
  }
  
  if (!API || API === 'null' || API === 'undefined' || API === null || API === undefined) {
    throw new Error(`URL de API inválida: API=${API}. Configura API_URL en .env o api.url en system_config`);
  }

  // Remover barra final si existe y espacios
  const frontUrl = String(FRONT).trim().replace(/\/$/, '');
  const apiUrl = String(API).trim().replace(/\/$/, '');

  // Validar formato de URL
  try {
    new URL(frontUrl);
    new URL(apiUrl);
  } catch (e) {
    throw new Error(`URLs inválidas. FRONT=${frontUrl}, API=${apiUrl}. Error: ${e.message}`);
  }

  const isLocalhost = frontUrl.includes("localhost") || frontUrl.includes("127.0.0.1");

  const successUrl = `${frontUrl}/payment/success`;
  const failureUrl = `${frontUrl}/payment/failure`;
  const pendingUrl = `${frontUrl}/payment/pending`;
  const notificationUrl = `${apiUrl}/api/payments/webhook`;

  // Fecha de expiración
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + (expiresInDays || 7));
  const expirationDateISO = expirationDate.toISOString();

  // Crear preferencia
  const mpConfig = new MercadoPagoConfig({ accessToken });
  const pref = new Preference(mpConfig);

  const itemId = customerId ? `customer-${customerId}-${Date.now()}` : `payment-${Date.now()}`;
  const itemTitle = title || "Pago";

  const body = {
    items: [{
      id: itemId,
      title: itemTitle,
      description: description || itemTitle,
      quantity: 1,
      currency_id: "ARS",
      unit_price: roundedAmount,
    }],
    back_urls: {
      success: String(successUrl),
      failure: String(failureUrl),
      pending: String(pendingUrl),
    },
    notification_url: String(notificationUrl),
    external_reference: customerId ? `${tenantId}:customer:${customerId}` : `${tenantId}:payment:${Date.now()}`,
    expires: true,
    expiration_date_to: expirationDateISO,
    payment_methods: {
      excluded_payment_methods: [],
      excluded_payment_types: [],
      installments: 12,
      default_installments: 1,
    },
    statement_descriptor: "ARJA ERP".substring(0, 22),
    metadata: {
      tenant_id: String(tenantId),
      customer_id: customerId ? String(customerId) : null,
      type: "generic_payment",
    },
  };

  // Limpiar campos undefined/null
  const cleanBody = JSON.parse(JSON.stringify(body, (key, value) => {
    if (value === undefined || value === null) return undefined;
    return value;
  }));

  if (!isLocalhost && cleanBody.back_urls?.success) {
    cleanBody.auto_return = "approved";
  }

  try {
    const prefResult = await pref.create({ body: cleanBody });
    
    let link;
    if (isLiveMode) {
      link = prefResult?.init_point;
    } else {
      link = prefResult?.sandbox_init_point || prefResult?.init_point;
    }

    if (!link) {
      throw new Error(`Mercado Pago no devolvió un link válido`);
    }

    return link;
  } catch (error) {
    console.error(`[createGenericPaymentLink] Error:`, error);
    throw error;
  }
}
