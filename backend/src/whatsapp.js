// src/whatsapp.js - VERSIÓN MULTI-TOKEN
import { toSandboxAllowed } from "./helpers/numbers.js";
import { getTenantWhatsAppHub } from "./services/whatsappHub.js";
import { pool } from "./db.js";

const WA_API_VERSION = process.env.WHATSAPP_API_VERSION || "v24.0";
const DEBUG = String(process.env.WHATSAPP_DEBUG || "false").toLowerCase() === "true";

/**
 * ✅ Obtener nombre del tenant
 */
async function getTenantName(tenantId) {
  if (!tenantId) return "ARJA ERP";
  try {
    const [[tenant]] = await pool.query(
      "SELECT name FROM tenant WHERE id = ? LIMIT 1",
      [tenantId]
    );
    return tenant?.name || "ARJA ERP";
  } catch (error) {
    console.error(`[WA] Error obteniendo nombre del tenant ${tenantId}:`, error.message);
    return "ARJA ERP";
  }
}

/**
 * ✅ Obtener configuración de WhatsApp por tenant
 * Incluye token y phone_number_id específicos del tenant
 */
async function getWhatsAppConfigForTenant(tenantId) {
  const config = await getTenantWhatsAppHub(tenantId);
  
  // Permitir que funcione automáticamente si hay credenciales OAuth válidas
  // El bot se activa automáticamente cuando hay credenciales OAuth, no requiere activación manual
  const hasOAuthCredentials = config && config.accessToken && config.managedBy === "user_oauth";
  const isActiveOrAutoActivated = config?.isActive || hasOAuthCredentials;
  
  if (!config || !config.accessToken || !isActiveOrAutoActivated) {
    throw new Error(`WhatsApp no está configurado o está inactivo para el tenant ${tenantId}`);
  }
  
  // Si hay phone_number_id válido, usarlo
  let phoneNumberId = config.phoneNumberId && !config.phoneNumberId.startsWith("pending:") 
    ? config.phoneNumberId 
    : null;
  
  console.log(`[WA] Config para tenant ${tenantId}:`, {
    hasPhoneNumberId: !!config.phoneNumberId,
    phoneNumberId: config.phoneNumberId?.substring(0, 50),
    hasAccessToken: !!config.accessToken,
    managedBy: config.managedBy,
    isActive: config.isActive,
    willTryToFetch: !phoneNumberId && config.accessToken && config.managedBy === "user_oauth"
  });
  
  // Si no hay phone_number_id pero hay OAuth token, intentar obtenerlo
  if (!phoneNumberId && config.accessToken && config.managedBy === "user_oauth") {
    try {
      console.log(`[WA] Intentando obtener phone_number_id para tenant ${tenantId} desde API de Meta`);
      
      // Intentar método 1: /me/businesses
      let businessesResponse = await fetch(
        `https://graph.facebook.com/${WA_API_VERSION}/me/businesses?fields=id,name,whatsapp_business_accounts{id,display_phone_number,phone_number_id,verified_name}`,
        {
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
          },
        }
      );

      let responseText = await businessesResponse.text();
      console.log(`[WA] Respuesta /me/businesses para tenant ${tenantId}: status=${businessesResponse.status}, body=${responseText.substring(0, 500)}`);

      if (businessesResponse.ok) {
        const businessesData = JSON.parse(responseText);
        const businesses = businessesData.data || [];
        console.log(`[WA] Encontradas ${businesses.length} businesses para tenant ${tenantId}`);
        
        for (const business of businesses) {
          const wabaAccounts = business.whatsapp_business_accounts?.data || [];
          console.log(`[WA] Business ${business.id} tiene ${wabaAccounts.length} WABA accounts`);
          if (wabaAccounts.length > 0) {
            const waba = wabaAccounts[0];
            console.log(`[WA] WABA account:`, { id: waba.id, phone_number_id: waba.phone_number_id, display_phone_number: waba.display_phone_number });
            if (waba.phone_number_id) {
              phoneNumberId = waba.phone_number_id;
              console.log(`[WA] ✅ Phone_number_id obtenido para tenant ${tenantId}: ${phoneNumberId}`);
              
              // Actualizar en la base de datos para futuros usos
              const { upsertTenantWhatsAppCredentials } = await import("./services/whatsappHub.js");
              await upsertTenantWhatsAppCredentials(tenantId, {
                phoneNumberId: phoneNumberId,
                accessToken: config.accessToken,
                phoneDisplay: config.phoneDisplay,
                isActive: config.isActive,
                managedBy: "user_oauth",
                managedNotes: "Phone_number_id obtenido automáticamente al enviar mensaje",
              });
              break;
            }
          }
        }
      }
      
      // Si no se encontró con /me/businesses, intentar método 2: /me con whatsapp_business_accounts
      if (!phoneNumberId) {
        console.log(`[WA] Intentando método alternativo: /me con whatsapp_business_accounts`);
        const meResponse = await fetch(
          `https://graph.facebook.com/${WA_API_VERSION}/me?fields=whatsapp_business_accounts{id,display_phone_number,phone_number_id,verified_name}`,
          {
            headers: {
              Authorization: `Bearer ${config.accessToken}`,
            },
          }
        );
        
        const meResponseText = await meResponse.text();
        console.log(`[WA] Respuesta /me para tenant ${tenantId}: status=${meResponse.status}, body=${meResponseText.substring(0, 500)}`);
        
        if (meResponse.ok) {
          const meData = JSON.parse(meResponseText);
          const wabaAccounts = meData.whatsapp_business_accounts?.data || [];
          console.log(`[WA] Encontradas ${wabaAccounts.length} WABA accounts en /me`);
          
          if (wabaAccounts.length > 0) {
            const waba = wabaAccounts[0];
            console.log(`[WA] WABA account desde /me:`, { id: waba.id, phone_number_id: waba.phone_number_id, display_phone_number: waba.display_phone_number });
            if (waba.phone_number_id) {
              phoneNumberId = waba.phone_number_id;
              console.log(`[WA] ✅ Phone_number_id obtenido desde /me para tenant ${tenantId}: ${phoneNumberId}`);
              
              // Actualizar en la base de datos para futuros usos
              const { upsertTenantWhatsAppCredentials } = await import("./services/whatsappHub.js");
              await upsertTenantWhatsAppCredentials(tenantId, {
                phoneNumberId: phoneNumberId,
                accessToken: config.accessToken,
                phoneDisplay: config.phoneDisplay,
                isActive: config.isActive,
                managedBy: "user_oauth",
                managedNotes: "Phone_number_id obtenido automáticamente desde /me al enviar mensaje",
              });
            }
          }
        }
      }
      
      if (!phoneNumberId) {
        console.warn(`[WA] ⚠️ No se encontró phone_number_id en ninguna business para tenant ${tenantId}. La cuenta autorizada en OAuth no tiene un número de WhatsApp Business configurado.`);
      }
    } catch (err) {
      console.error(`[WA] Error obteniendo phone_number_id para tenant ${tenantId}:`, err.message, err.stack);
      // Continuar sin phone_number_id, el error se lanzará abajo
    }
  }
  
  if (!phoneNumberId) {
    // Proporcionar un mensaje más claro sobre qué hacer
    const hasOAuth = config && config.accessToken && config.managedBy === "user_oauth";
    if (hasOAuth) {
      throw new Error(`La cuenta autorizada en OAuth no tiene un número de WhatsApp Business configurado. Por favor, configurá un número de WhatsApp Business en Meta Business Manager con la misma cuenta que autorizaste, o autorizá OAuth con la cuenta que sí tiene el número configurado.`);
    }
    throw new Error(`WhatsApp no está configurado o está inactivo para el tenant ${tenantId}. Falta phone_number_id.`);
  }
  
  return {
    phone_number_id: phoneNumberId,
    whatsapp_token: config.accessToken,
    whatsapp_verify_token: config.verifyToken,
    phone_display: config.phoneDisplay,
  };
}

/**
 * ✅ Normaliza teléfono a E.164
 */
export function normalizeTo(num) {
  const DEFAULT_COUNTRY = (process.env.DEFAULT_COUNTRY_DIAL || "54").replace(/^\+/, "");
  const digits = String(num || "").replace(/\D/g, "");
  if (!digits) return "";

  const arFixed = toSandboxAllowed(digits);
  if (arFixed.startsWith(DEFAULT_COUNTRY)) return arFixed;
  return DEFAULT_COUNTRY + arFixed;
}

/**
 * ✅ Request genérico con token específico
 */
async function request(phoneNumberId, token, path, body) {
  if (!phoneNumberId || !token) {
    if (DEBUG) console.warn("[WA] Saltando envío (sin credenciales):", path);
    return { skipped: true };
  }

  const url = `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}${path}`;
  console.log(`[WA] Request URL: ${url}`);
  console.log(`[WA] Request body:`, JSON.stringify(body, null, 2));
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let text = "";
  try { text = await res.text(); } catch { }

  // Siempre loguear la respuesta para debugging
  console.log(`[WA] Response status: ${res.status}`);
  console.log(`[WA] Response body:`, text?.substring(0, 1000) || "(vacío)");

  if (DEBUG) {
    console.log(`[WA][${res.status}] ${path}`, {
      phoneNumberId,
      req: body,
      resRaw: text?.slice(0, 800),
    });
  }

  if (!res.ok) {
    try {
      const j = JSON.parse(text);
      const err = j?.error || {};
      
      // Manejar error específico: número no en lista de permitidos
      if (err.code === 131030) {
        const error = new Error(`[WA] ${body?.type || "request"} ${res.status}: ${err.message || ""}`);
        error.code = 131030;
        error.errorData = err.error_data || {};
        error.recipientNumber = body?.to || "unknown";
        throw error;
      }
      
      // Manejar error: phone_number_id no existe o no tiene permisos (código 100, subcode 33)
      if (err.code === 100 && err.error_subcode === 33) {
        const error = new Error(`[WA] ${body?.type || "request"} ${res.status}: ${err.message || ""}`);
        error.code = 100;
        error.error_subcode = 33;
        error.invalidPhoneNumberId = phoneNumberId;
        throw error;
      }
      
      // Manejar error: Account not registered (código 133010)
      if (err.code === 133010) {
        const recipientNumber = body?.to || "desconocido";
        const error = new Error(`La cuenta de WhatsApp Business está en modo Sandbox (prueba). En este modo, solo podés enviar mensajes a números agregados como "números de prueba" en Meta Business Manager.\n\nPara enviar a ${recipientNumber}, agregalo como número de prueba en Meta Business Manager:\n1. Ve a Meta Business Manager → Tu cuenta de WhatsApp\n2. Buscá "Números de prueba" o "Test Numbers"\n3. Agregá el número ${recipientNumber}\n4. Verificá el número con el código que Meta envía\n\nO esperá a que Meta apruebe tu cuenta para pasar a modo Producción, donde podrás enviar a cualquier número.`);
        error.code = 133010;
        error.originalMessage = err.message;
        error.phoneNumberId = phoneNumberId;
        error.recipientNumber = recipientNumber;
        error.isSandboxMode = true;
        throw error;
      }
      
      // Manejar error: Re-engagement message (código 131047)
      // Ocurre cuando han pasado más de 24 horas desde la última respuesta del destinatario
      if (err.code === 131047) {
        const recipientNumber = body?.to || "desconocido";
        const error = new Error(`No se puede enviar mensaje porque han pasado más de 24 horas desde la última respuesta del número ${recipientNumber}.`);
        error.code = 131047;
        error.originalMessage = err.message;
        error.errorData = err.error_data || {};
        error.recipientNumber = recipientNumber;
        error.isReEngagement = true;
        throw error;
      }
      
      // Manejar error: Template no existe (código 132001)
      // Ocurre cuando el template no está aprobado o no existe en el idioma especificado
      if (err.code === 132001) {
        const templateName = body?.template?.name || "desconocido";
        const language = body?.template?.language?.code || "desconocido";
        const error = new Error(`El template "${templateName}" no existe o no está aprobado en el idioma "${language}". Verificá en Meta Business Manager que el template esté completamente aprobado (no solo "calidad pendiente") y que el código de idioma coincida. Para "Spanish (ARG)" el código debe ser "es_AR".`);
        error.code = 132001;
        error.originalMessage = err.message;
        error.errorData = err.error_data || {};
        error.templateName = templateName;
        error.language = language;
        error.isTemplateNotFound = true;
        throw error;
      }
      
      // Manejar error: Rate limit (código 131056)
      // Ocurre cuando se envían demasiados mensajes en poco tiempo
      if (err.code === 131056) {
        const recipientNumber = body?.to || "desconocido";
        const error = new Error(`Se alcanzó el límite de velocidad de mensajes para el número ${recipientNumber}. Por favor, esperá unos minutos antes de intentar enviar más mensajes.`);
        error.code = 131056;
        error.originalMessage = err.message;
        error.errorData = err.error_data || {};
        error.recipientNumber = recipientNumber;
        error.isRateLimit = true;
        throw error;
      }
      
      const msg = `[WA] ${body?.type || "request"} ${res.status} code=${err.code} ${err.message || ""}`;
      throw new Error(msg);
    } catch (e) {
      // Si ya es nuestro error personalizado, relanzarlo
      if (e.code === 131030 || (e.code === 100 && e.error_subcode === 33) || e.code === 133010 || e.code === 131047 || e.code === 132001 || e.code === 131056) {
        throw e;
      }
      throw new Error(`[WA] ${body?.type || "request"} ${res.status}: ${text || "(sin cuerpo)"}`);
    }
  }

  // Si la respuesta es exitosa, loguear también
  try {
    const responseData = JSON.parse(text || "{}");
    console.log(`[WA] ✅ Mensaje enviado exitosamente:`, {
      messageId: responseData.messages?.[0]?.id,
      to: body?.to,
      status: responseData.messages?.[0]?.message_status,
    });
    return responseData;
  } catch (e) {
    console.log(`[WA] ⚠️ Respuesta exitosa pero no se pudo parsear JSON:`, text?.substring(0, 500));
    return {};
  }
}

/**
 * ✅ Normalizar número para enviar a WhatsApp API (formato E.164 sin espacios/guiones)
 * Meta espera números en formato: 5491154616161 (sin +, sin espacios, sin guiones)
 * 
 * IMPORTANTE: Meta Business Manager puede tener números en la lista de permitidos
 * SIN el 9 móvil (ej: +54 11 5461-6161 = 541154616161) aunque el número real sea móvil.
 * Por lo tanto, si recibimos un número con el 9 móvil (549...), lo normalizamos
 * quitando el 9 para que coincida con el formato de Meta.
 */
function normalizeForWhatsAppApi(num) {
  if (!num) return "";
  
  // Eliminar todos los caracteres que no sean dígitos
  let digits = String(num).replace(/\D/g, "");
  
  // Si empieza con +, quitarlo
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }
  
  // Para números argentinos móviles (549...), quitar el 9 móvil para que coincida
  // con el formato que Meta Business Manager espera (5411...)
  // Ejemplo: 5491154616161 -> 541154616161
  if (digits.startsWith("549") && digits.length === 13) {
    // Número móvil argentino: quitar el 9 después de 54
    return "54" + digits.slice(3); // Quita el 9 móvil
  }
  
  // Si ya está sin el 9 (5411...), mantenerlo
  return digits;
}

/**
 * ✅ Enviar texto simple CON TENANT
 * @param {string} toE164 - Número de destino en formato E.164
 * @param {string} text - Texto del mensaje
 * @param {number} tenantId - ID del tenant
 * @param {object} context - Contexto opcional para mantener conversaciones separadas
 * @param {string} context.message_id - ID del mensaje anterior para mantener el hilo
 * @param {string} context.from - Número del remitente del mensaje anterior
 */
export async function sendWhatsAppText(toE164, text, tenantId = null, context = null) {
  // Si no hay tenantId, intentar obtenerlo desde variables de entorno (backward compatibility)
  if (!tenantId && process.env.BOT_TENANT_ID) {
    tenantId = Number(process.env.BOT_TENANT_ID);
  }

  if (!tenantId) {
    throw new Error("tenantId requerido para enviar mensaje de WhatsApp");
  }

  // Obtener configuración del tenant
  const config = await getWhatsAppConfigForTenant(tenantId);

  console.log(`[WA] Enviando mensaje - tenant: ${tenantId}, phone_number_id: ${config.phone_number_id}, to: ${toE164}${context ? `, context: ${context.message_id}` : ""}`);

  // Normalizar el número para que coincida con el formato de Meta Business Manager
  // Meta espera el número en formato E.164 sin espacios/guiones
  // Si el número viene con el 9 móvil (549...) pero en Meta está sin el 9 (5411...),
  // necesitamos quitarlo para que coincida
  let normalizedTo = normalizeForWhatsAppApi(toE164);
  
  if (!normalizedTo) {
    throw new Error("Número de teléfono inválido");
  }

  const payload = {
    messaging_product: "whatsapp",
    to: normalizedTo,
    type: "text",
    text: { body: text },
  };

  // Agregar contexto si se proporciona (para mantener chats separados)
  // WhatsApp solo acepta message_id en el contexto, NO acepta "from"
  if (context && context.message_id) {
    payload.context = {
      message_id: context.message_id,
    };
  }

  try {
    return await request(config.phone_number_id, config.whatsapp_token, "/messages", payload);
  } catch (error) {
    // Si el error es que el phone_number_id no existe o no tiene permisos, limpiarlo y obtenerlo nuevamente
    if (error.code === 100 && error.error_subcode === 33 && error.invalidPhoneNumberId) {
      console.warn(`[WA] ⚠️ Phone_number_id inválido detectado: ${error.invalidPhoneNumberId}. Limpiando y obteniendo uno nuevo...`);
      
      // Limpiar el phone_number_id inválido
      const { upsertTenantWhatsAppCredentials } = await import("./services/whatsappHub.js");
      await upsertTenantWhatsAppCredentials(tenantId, {
        phoneNumberId: null, // Limpiar el phone_number_id inválido
        accessToken: config.whatsapp_token,
        phoneDisplay: config.phone_display,
        isActive: true,
        managedBy: "user_oauth",
        managedNotes: "Phone_number_id inválido detectado, limpiado para obtener uno nuevo",
      });
      
      // Intentar obtener un nuevo phone_number_id desde Meta
      try {
        const newConfig = await getWhatsAppConfigForTenant(tenantId);
        console.log(`[WA] ✅ Nuevo phone_number_id obtenido: ${newConfig.phone_number_id}`);
        
        // Reintentar el envío con el nuevo phone_number_id
        return await request(newConfig.phone_number_id, newConfig.whatsapp_token, "/messages", payload);
      } catch (retryError) {
        console.error(`[WA] ❌ Error obteniendo nuevo phone_number_id:`, retryError.message);
        throw new Error(`El phone_number_id anterior era inválido (pertenece a otra cuenta). La cuenta autorizada en OAuth no tiene un número de WhatsApp Business configurado. Por favor, configurá un número de WhatsApp Business en Meta Business Manager con la misma cuenta que autorizaste, o autorizá OAuth con la cuenta que sí tiene el número configurado.`);
      }
    }
    
    // Si no es el error de phone_number_id inválido, relanzar el error original
    throw error;
  }
}

/**
 * ✅ Enviar template CON TENANT
 */
export async function sendWhatsAppTemplate(toE164, templateName, lang = "es", components = [], tenantId = null) {
  if (!tenantId && process.env.BOT_TENANT_ID) {
    tenantId = Number(process.env.BOT_TENANT_ID);
  }

  if (!tenantId) {
    throw new Error("tenantId requerido para enviar template");
  }

  const config = await getWhatsAppConfigForTenant(tenantId);
  
  // Normalizar el número para que coincida con el formato de Meta
  const normalizedTo = normalizeForWhatsAppApi(toE164);
  if (!normalizedTo) {
    throw new Error("Número de teléfono inválido");
  }

  const payload = {
    messaging_product: "whatsapp",
    to: normalizedTo,
    type: "template",
    template: {
      name: templateName,
      language: { code: lang },
      components,
    },
  };

  return request(config.phone_number_id, config.whatsapp_token, "/messages", payload);
}

/**
 * ✅ Enviar lista interactiva CON TENANT
 */
export async function sendWhatsAppList(to, { header, body, buttonText, sections }, tenantId = null) {
  if (!tenantId && process.env.BOT_TENANT_ID) {
    tenantId = Number(process.env.BOT_TENANT_ID);
  }

  if (!tenantId) {
    throw new Error("tenantId requerido para enviar lista");
  }

  const config = await getWhatsAppConfigForTenant(tenantId);
  const tenantName = await getTenantName(tenantId);
  
  // Normalizar el número para que coincida con el formato de Meta
  const normalizedTo = normalizeForWhatsAppApi(to);
  if (!normalizedTo) {
    throw new Error("Número de teléfono inválido");
  }

  const payload = {
    messaging_product: "whatsapp",
    to: normalizedTo,
    type: "interactive",
    interactive: {
      type: "list",
      header: header ? { type: "text", text: String(header) } : undefined,
      body: { text: String(body || "") },
      footer: { text: tenantName },
      action: { button: String(buttonText || "Elegir"), sections: sections || [] },
    },
  };

  return request(config.phone_number_id, config.whatsapp_token, "/messages", payload);
}

/**
 * ✅ Enviar imagen por URL CON TENANT
 */
export async function sendWhatsAppImageUrl(to, imageUrl, caption = "", tenantId = null) {
  if (!tenantId && process.env.BOT_TENANT_ID) {
    tenantId = Number(process.env.BOT_TENANT_ID);
  }

  if (!tenantId) {
    throw new Error("tenantId requerido para enviar imagen");
  }

  const config = await getWhatsAppConfigForTenant(tenantId);
  
  // Normalizar el número para que coincida con el formato de Meta
  const normalizedTo = normalizeForWhatsAppApi(to);
  if (!normalizedTo) {
    throw new Error("Número de teléfono inválido");
  }

  const payload = {
    messaging_product: "whatsapp",
    to: normalizedTo,
    type: "image",
    image: { link: String(imageUrl), caption: String(caption || "") },
  };

  return request(config.phone_number_id, config.whatsapp_token, "/messages", payload);
}

/**
 * ✅ Mensaje de confirmación de turno CON TENANT
 */
export async function sendBookingConfirmation({ to, customerName, serviceName, instructorName, startsAt, tenantId }) {
  if (!tenantId) {
    throw new Error("tenantId requerido para enviar confirmación");
  }

  const d = new Date(startsAt);
  const fecha = d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  
  const tenantName = await getTenantName(tenantId);

  const msg =
    `¡Hola ${customerName || ""}! 👋\n` +
    `✅ Confirmamos tu turno:\n` +
    `• Servicio: *${serviceName}*\n` +
    `• Profesional: *${instructorName}*\n` +
    `• Fecha: *${fecha} ${hora}*\n\n` +
    `Si necesitás reprogramar, escribinos a ${tenantName} por acá.`;

  return sendWhatsAppText(to, msg, tenantId);
}