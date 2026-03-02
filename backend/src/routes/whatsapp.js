// src/routes/whatsapp.js — MULTI-TENANT COMPLETO
// 
// ✅ CORREGIDO: Todos los llamados a funciones de mensajería incluyen tenantId

import { Router } from "express";
import { sendWhatsAppText, sendWhatsAppTemplate } from "../whatsapp.js";
import { toSandboxAllowed } from "../helpers/numbers.js";
import { getSession, setStep, reset, getAllSessions } from "../helpers/session.js";
import { sendList, sendButtons } from "../whatsapp-ui.js";
import { listServices, listInstructors } from "../routes/meta.js";
import { getFreeSlots } from "../routes/availability.js";
import { createAppointment } from "../routes/appointments.js";
import { parseDay } from "../helpers/parseDay.js";
import { listUpcomingAppointmentsByPhone } from "../routes/appointments.js";
import { getCustomerByPhone, upsertCustomerNameByPhone } from "../routes/customers.js";
import { validateAppointmentDate, isPastDateTime } from "../helpers/dateValidation.js";
import { addHours } from "date-fns";
import { pool } from "../db.js";
import { createDepositPaymentLink } from "../payments.js";
import { cfgNumber } from "../services/config.js";
import { getTenantFeatureFlags } from "../services/tenantFeatures.js";
import { createSubscriptionPreapproval } from "../services/subscriptions.js";
import { getTenantMpToken } from "../services/mercadoPago.js";
import fetch from "node-fetch";
import {
  enrollCustomerToClassSeries,
  enrollCustomerToClassSession,
  listCustomerClassEnrollments,
  listUpcomingClassSessions,
  listUpcomingClassSeriesWithSingles,
} from "../services/classesWhatsapp.js";
import { listTenantBranches } from "../services/branches.js";
import { getSection } from "../services/config.js";
import { listPlans, getPlanDefinition } from "../services/subscriptionPlans.js";
import { createNotification } from "./notifications.js";

export const whatsapp = Router();

// ============================================
// CONFIGURACIÓN
// ============================================
const TZ_OFFSET = -3; // Argentina UTC-3
const LEAD_MIN = Number(process.env.BOT_LEAD_MIN || 30);
const TIME_ZONE = process.env.TIME_ZONE || "America/Argentina/Buenos_Aires";

// ============================================
// Rastreo de mensajes de notificación para evitar activar bot en respuestas
// ============================================
// Map para rastrear message_id de mensajes de notificación
// Estructura: message_id -> { phone, tenantId, timestamp }
const notificationMessageIds = new Map();

// Map para rastrear notificaciones recientes por teléfono (fallback si no hay contexto)
// Estructura: phone_tenantId -> { timestamp, lastNotificationTime }
const recentNotificationsByPhone = new Map();

// Limpiar mensajes antiguos cada hora (más de 2 horas)
setInterval(() => {
  const now = Date.now();
  const twoHours = 2 * 60 * 60 * 1000;
  for (const [messageId, data] of notificationMessageIds.entries()) {
    if (now - data.timestamp > twoHours) {
      notificationMessageIds.delete(messageId);
    }
  }
  // Limpiar también el mapa de teléfonos
  for (const [key, data] of recentNotificationsByPhone.entries()) {
    if (now - data.lastNotificationTime > twoHours) {
      recentNotificationsByPhone.delete(key);
    }
  }
}, 60 * 60 * 1000); // Cada hora

// Función para registrar un message_id de notificación
export function registerNotificationMessageId(messageId, phone, tenantId) {
  if (messageId) {
    notificationMessageIds.set(messageId, {
      phone,
      tenantId,
      timestamp: Date.now()
    });
    console.log(`[WA] 📝 Registrado message_id de notificación: ${messageId} para ${phone} (tenant ${tenantId})`);
    
    // También registrar en el mapa de teléfonos para verificación temporal
    const phoneKey = `${phone.replace(/\D/g, "")}_${tenantId}`;
    recentNotificationsByPhone.set(phoneKey, {
      lastNotificationTime: Date.now(),
      messageId,
      phone,
      tenantId
    });
  }
}

// Función para limpiar los registros de notificaciones de un cliente
export function clearNotificationRecords(phone, tenantId) {
  const phoneKey = `${phone.replace(/\D/g, "")}_${tenantId}`;
  
  // Limpiar del mapa de teléfonos
  const phoneRecord = recentNotificationsByPhone.get(phoneKey);
  if (phoneRecord && phoneRecord.messageId) {
    notificationMessageIds.delete(phoneRecord.messageId);
  }
  recentNotificationsByPhone.delete(phoneKey);
  
  // Limpiar todos los message_ids asociados a este teléfono y tenant
  const normalizedPhone = phone.replace(/\D/g, "");
  for (const [messageId, notification] of notificationMessageIds.entries()) {
    if (notification.phone && notification.phone.replace(/\D/g, "") === normalizedPhone && notification.tenantId === tenantId) {
      notificationMessageIds.delete(messageId);
    }
  }
  
  console.log(`[WA] 🧹 Registros de notificación limpiados para ${phone} (tenant ${tenantId})`);
}

// Función para verificar si un message_id corresponde a una notificación
export function isNotificationResponse(contextMessageId, phone, tenantId) {
  // Verificar por message_id si hay contexto
  if (contextMessageId) {
    const notification = notificationMessageIds.get(contextMessageId);
    if (notification) {
      // Verificar que el teléfono y tenant coincidan
      const phoneMatch = notification.phone && phone && 
        (notification.phone.replace(/\D/g, "") === phone.replace(/\D/g, ""));
      const tenantMatch = notification.tenantId === tenantId;
      
      // Verificar que no haya pasado demasiado tiempo (2 horas)
      const twoHours = 2 * 60 * 60 * 1000;
      const isRecent = (Date.now() - notification.timestamp) < twoHours;
      
      if (phoneMatch && tenantMatch && isRecent) {
        console.log(`[WA] ✅ Mensaje identificado como respuesta a notificación (por message_id): ${contextMessageId}`);
        return true;
      }
    }
  }
  
  // Verificación temporal: si recibió una notificación recientemente (últimos 30 minutos), no activar bot
  const phoneKey = `${phone.replace(/\D/g, "")}_${tenantId}`;
  const recentNotification = recentNotificationsByPhone.get(phoneKey);
  if (recentNotification) {
    const thirtyMinutes = 30 * 60 * 1000;
    const timeSinceNotification = Date.now() - recentNotification.lastNotificationTime;
    
    if (timeSinceNotification < thirtyMinutes) {
      console.log(`[WA] ✅ Mensaje identificado como respuesta a notificación (por tiempo, hace ${Math.floor(timeSinceNotification / 1000 / 60)} min)`);
      return true;
    }
  }
  
  return false;
}

/**
 * ✅ Enviar mensaje al agente con fallback a plantilla si falla con 131047
 * IMPORTANTE: Si detecta error 131047, envía DIRECTAMENTE plantilla reabrir_chat (type: template)
 * NO intenta enviar mensajes de tipo "text" cuando hay 131047
 */
async function sendMessageToAgentWithFallback(agentPhone, message, tenantId, context = null) {
  try {
    // Intentar primero con mensaje libre
    const response = await sendWhatsAppText(agentPhone, message, tenantId, context);
    return { success: true, method: "free", messageId: response?.messages?.[0]?.id };
  } catch (error) {
    // Si falla con 131047, enviar DIRECTAMENTE plantilla (NO intentar más mensajes text)
    if (error.code === 131047) {
      console.log(`[WA Support] ⚠️ Ventana cerrada (131047). Solo se puede enviar plantilla. Enviando reabrir_chat...`);
      
      // Intentar con diferentes códigos de idioma para reabrir_chat
      // "Spanish (ARG)" en Meta puede ser es_AR, es, o es_419 (Latinoamérica)
      // Para "Spanish (ARG)" intentamos primero es_AR
      const languageCodes = ["es_AR", "es", "es_419", "es_MX", "es_ES"];
      let templateSent = false;
      let templateLanguage = null;
      let templateName = null;
      let templateMessageId = null;
      
      for (const lang of languageCodes) {
        try {
          // Enviar plantilla reabrir_chat con formato exacto requerido
          const templateResponse = await sendWhatsAppTemplate(
            agentPhone,
            "reabrir_chat",
            lang,
            [
              {
                type: "body",
                parameters: [
                  {
                    type: "text",
                    text: "Agente"
                  }
                ]
              }
            ],
            tenantId
          );
          
          console.log(`[WA Support] ✅ Plantilla reabrir_chat enviada al agente ${agentPhone} (idioma: ${lang})`);
          templateSent = true;
          templateLanguage = lang;
          templateName = "reabrir_chat";
          templateMessageId = templateResponse?.messages?.[0]?.id;
          break;
        } catch (templateError) {
          // Si este idioma no funciona, intentar el siguiente
          console.debug(`[WA Support] Plantilla reabrir_chat con idioma "${lang}" no disponible:`, templateError.message);
          continue;
        }
      }
      
      // Si reabrir_chat no funcionó con ningún idioma, intentar con hello_world como fallback
      if (!templateSent) {
        console.log(`[WA Support] ⚠️ reabrir_chat no disponible, intentando con hello_world como fallback...`);
        const fallbackLanguages = ["en_US", "es_AR", "es"];
        for (const lang of fallbackLanguages) {
          try {
            // hello_world en en_US no acepta parámetros, enviar sin parámetros
            const components = lang === "en_US" ? [] : [
              {
                type: "body",
                parameters: [
                  {
                    type: "text",
                    text: "Agente - Nuevo mensaje de cliente"
                  }
                ]
              }
            ];
            
            const fallbackResponse = await sendWhatsAppTemplate(
              agentPhone,
              "hello_world",
              lang,
              components,
              tenantId
            );
            
            console.log(`[WA Support] ✅ Plantilla hello_world enviada al agente ${agentPhone} (idioma: ${lang})`);
            templateSent = true;
            templateLanguage = lang;
            templateName = "hello_world";
            const templateMessageId = fallbackResponse?.messages?.[0]?.id;
            break;
          } catch (fallbackError) {
            console.debug(`[WA Support] Plantilla hello_world con idioma "${lang}" no disponible:`, fallbackError.message);
            continue;
          }
        }
      }
      
      if (templateSent) {
        // Si la plantilla se envió exitosamente, intentar enviar el mensaje del cliente después de un pequeño delay
        // La plantilla reabre la ventana de 24 horas, así que podemos intentar enviar el mensaje original
        console.log(`[WA Support] ⏳ Esperando 2 segundos antes de enviar el mensaje del cliente...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        try {
          // Usar el message_id de la plantilla como contexto
          const messageContext = templateMessageId ? { message_id: templateMessageId, from: agentPhone } : null;
          const messageResponse = await sendWhatsAppText(agentPhone, message, tenantId, messageContext);
          const finalMessageId = messageResponse?.messages?.[0]?.id || templateMessageId;
          console.log(`[WA Support] ✅ Mensaje del cliente enviado exitosamente después de la plantilla`);
          return { success: true, method: "template+message", templateName, language: templateLanguage, messageId: finalMessageId };
        } catch (messageError) {
          // Si el mensaje también falla, al menos la plantilla se envió
          console.error(`[WA Support] ⚠️ No se pudo enviar el mensaje del cliente después de la plantilla:`, messageError.message);
          console.log(`[WA Support] 💡 La plantilla se envió correctamente, pero el mensaje del cliente no pudo ser entregado.`);
          return { success: true, method: "template", templateName, language: templateLanguage, messageFailed: true, messageId: templateMessageId };
        }
      } else {
        // Si ninguna plantilla funcionó, NO intentar más
        console.error(`[WA Support] ❌ Ninguna plantilla disponible. No se reenvía más.`);
        console.log(`[WA Support] ⚠️ Ventana cerrada. Solo se puede enviar plantilla. No reenvío más.`);
        return { success: false, error: "reengagement", originalError: error, templateFailed: true };
      }
    }
    
    // Si es otro error, retornarlo
    return { success: false, error: "unknown", originalError: error };
  }
}

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
 * ✅ Notificar al administrador sobre error 131047 (Re-engagement message)
 */
async function notifyAdminAboutReengagementError(tenantId, supportAgentPhone, customerPhone, customerName) {
  try {
    // ⚠️ PREVENIR NOTIFICACIONES DUPLICADAS: Verificar si ya existe un error similar en las últimas 30 minutos
    try {
      const [recentErrors] = await pool.query(
        `SELECT id FROM whatsapp_reengagement_errors 
         WHERE tenant_id = ? 
           AND agent_phone = ? 
           AND customer_phone = ?
           AND created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
         LIMIT 1`,
        [tenantId, supportAgentPhone, customerPhone]
      );
      
      if (recentErrors.length > 0) {
        console.log(`[WA Support] ⚠️ Error 131047 ya notificado recientemente para este agente/cliente. Evitando notificación duplicada.`);
        return; // Ya se notificó recientemente, no enviar otra notificación
      }
    } catch (dbCheckError) {
      // Si la tabla no existe aún, continuar (se creará el error)
      if (dbCheckError.code !== 'ER_NO_SUCH_TABLE') {
        console.error(`[WA Support] ⚠️ Error verificando errores recientes:`, dbCheckError.message);
      }
    }

    // Obtener email del administrador
    const [[adminUser]] = await pool.query(
      `SELECT email FROM users 
       WHERE tenant_id = ? AND role = 'admin' 
       ORDER BY created_at ASC 
       LIMIT 1`,
      [tenantId]
    );

    if (!adminUser?.email) {
      console.warn(`[WA Support] ⚠️ No se encontró administrador para notificar sobre error 131047 (tenant ${tenantId})`);
      return;
    }

    // Obtener configuración de WhatsApp para el tenant
    const { getTenantWhatsAppHub } = await import("../services/whatsappHub.js");
    const waConfig = await getTenantWhatsAppHub(tenantId);
    const businessPhone = waConfig?.phoneDisplay || "número de WhatsApp Business";
    const tenantName = await getTenantName(tenantId);

    // Crear mensaje de notificación
    const notificationMessage = `🔔 *Notificación del Sistema*\n\n` +
      `⚠️ *Error de Re-engagement Detectado*\n\n` +
      `El sistema intentó reenviar un mensaje del cliente al agente de soporte, pero falló porque pasaron más de 24 horas desde la última respuesta del agente.\n\n` +
      `📋 *Detalles:*\n` +
      `• Cliente: ${customerName || "Sin nombre"}\n` +
      `• Teléfono cliente: ${customerPhone}\n` +
      `• Teléfono agente: ${supportAgentPhone}\n` +
      `• Tenant: ${tenantName}\n\n` +
      `💡 *Solución:*\n` +
      `El agente debe enviar un mensaje al número de WhatsApp Business (${businessPhone}) para iniciar la conversación y abrir la ventana de 24 horas.\n\n` +
      `Alternativamente, el agente puede responder directamente al cliente escribiendo a: ${customerPhone}\n\n` +
      `_Este es un mensaje automático del sistema._`;

    // Intentar enviar notificación por WhatsApp al agente (si está configurado)
    // Usar función con fallback a plantilla para evitar errores 131047
    if (supportAgentPhone) {
      const result = await sendMessageToAgentWithFallback(supportAgentPhone, notificationMessage, tenantId);
      if (result.success) {
        console.log(`[WA Support] ✅ Notificación enviada al agente ${supportAgentPhone} sobre error 131047 (método: ${result.method})`);
      } else {
        console.error(`[WA Support] ⚠️ No se pudo enviar notificación WhatsApp al agente:`, result.originalError?.message || "Error desconocido");
        // Continuar con el logging aunque falle el envío
      }
    }

    // Log detallado para que el administrador pueda verlo en los logs
    console.error(`[WA Support] 📧 NOTIFICACIÓN PARA ADMINISTRADOR (${adminUser.email}):`);
    console.error(`[WA Support]    Error 131047 - Re-engagement message`);
    console.error(`[WA Support]    Cliente: ${customerName || "Sin nombre"} (${customerPhone})`);
    console.error(`[WA Support]    Agente: ${supportAgentPhone}`);
    console.error(`[WA Support]    Solución: El agente debe enviar un mensaje a ${businessPhone} para iniciar la conversación`);

    // Enviar email al administrador
    try {
      const { sendEmail } = await import("../services/email.js");
      const emailSubject = `⚠️ Error de Re-engagement en WhatsApp - ${tenantName}`;
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #d32f2f;">⚠️ Error de Re-engagement Detectado</h2>
          <p>El sistema intentó reenviar un mensaje del cliente al agente de soporte, pero falló porque pasaron más de 24 horas desde la última respuesta del agente.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">📋 Detalles del Error</h3>
            <p><strong>Cliente:</strong> ${customerName || "Sin nombre"}</p>
            <p><strong>Teléfono Cliente:</strong> ${customerPhone}</p>
            <p><strong>Teléfono Agente:</strong> ${supportAgentPhone}</p>
            <p><strong>Tenant:</strong> ${tenantName}</p>
            <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-AR')}</p>
          </div>
          
          <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">💡 Solución</h3>
            <p>El agente debe enviar un mensaje al número de WhatsApp Business para iniciar la conversación y abrir la ventana de 24 horas:</p>
            <p style="font-size: 18px; font-weight: bold; color: #1976d2;">${businessPhone}</p>
            <p>Alternativamente, el agente puede responder directamente al cliente escribiendo a: <strong>${customerPhone}</strong></p>
          </div>
          
          <p style="color: #666; font-size: 12px; margin-top: 30px;">
            Este es un mensaje automático del sistema ARJA ERP.
          </p>
        </div>
      `;
      
      await sendEmail({
        to: adminUser.email,
        subject: emailSubject,
        html: emailHtml,
        text: `Error de Re-engagement en WhatsApp\n\nCliente: ${customerName || "Sin nombre"} (${customerPhone})\nAgente: ${supportAgentPhone}\nTenant: ${tenantName}\n\nSolución: El agente debe enviar un mensaje a ${businessPhone} para iniciar la conversación.`,
      });
      console.log(`[WA Support] ✅ Email de notificación enviado a ${adminUser.email}`);
    } catch (emailError) {
      console.error(`[WA Support] ⚠️ Error al enviar email de notificación:`, emailError.message);
      // Continuar aunque falle el email
    }

    // Guardar el error en la base de datos para el panel de administración
    try {
      await pool.query(
        `INSERT INTO whatsapp_reengagement_errors 
         (tenant_id, agent_phone, customer_phone, customer_name, business_phone, error_code, error_message, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          tenantId,
          supportAgentPhone,
          customerPhone,
          customerName || "Sin nombre",
          businessPhone,
          "131047",
          "Re-engagement message: más de 24 horas sin respuesta del agente",
        ]
      );
      console.log(`[WA Support] ✅ Error guardado en base de datos para panel de administración`);
    } catch (dbError) {
      // Si la tabla no existe, solo loguear el error (se creará con la migración)
      if (dbError.code === 'ER_NO_SUCH_TABLE') {
        console.warn(`[WA Support] ⚠️ Tabla whatsapp_reengagement_errors no existe aún. Ejecuta la migración 063.`);
      } else {
        console.error(`[WA Support] ⚠️ Error guardando error en BD:`, dbError.message);
      }
    }

  } catch (error) {
    console.error(`[WA Support] ❌ Error notificando al administrador sobre error 131047:`, error);
  }
}

/**
 * ✅ Obtener configuraciones personalizables del bot para el tenant
 */
async function getBotConfig(tenantId) {
  if (!tenantId) {
    return {
      greeting: "¡Hola! 👋",
      greetingWithName: (name) => `¡Hola ${name}! 👋`,
      welcomeMessage: "¿Qué querés hacer?",
      welcomeFullMessage: null,
      nameRequest: "Para personalizar tu experiencia, decime tu *nombre*.\nEjemplo: *Soy Ariel*",
    };
  }
  
  try {
    const botConfig = await getSection("bot", tenantId);
    
    return {
      greeting: botConfig.greeting || "¡Hola! 👋",
      greetingWithName: (name) => botConfig.greetingWithName?.replace("{name}", name) || `¡Hola ${name}! 👋`,
      welcomeMessage: botConfig.welcomeMessage || "¿Qué querés hacer?",
      welcomeFullMessage: botConfig.welcomeFullMessage || null,
      nameRequest: botConfig.nameRequest || "Para personalizar tu experiencia, decime tu *nombre*.\nEjemplo: *Soy Ariel*",
      branchSelectionMessage: botConfig.branchSelectionMessage || "Elegí la sucursal donde querés atendete:",
      serviceSelectionHeader: botConfig.serviceSelectionHeader || "Elegí un servicio",
      instructorSelectionBody: botConfig.instructorSelectionBody || "¿Con quién preferís?",
    };
  } catch (error) {
    console.error(`[WA] Error obteniendo config del bot para tenant ${tenantId}:`, error.message);
    return {
      greeting: "¡Hola! 👋",
      greetingWithName: (name) => `¡Hola ${name}! 👋`,
      welcomeMessage: "¿Qué querés hacer?",
      welcomeFullMessage: null,
      nameRequest: "Para personalizar tu experiencia, decime tu *nombre*.\nEjemplo: *Soy Ariel*",
      branchSelectionMessage: "Elegí la sucursal donde querés atendete:",
      serviceSelectionHeader: "Elegí un servicio",
      instructorSelectionBody: "¿Con quién preferís?",
    };
  }
}

/**
 * ✅ CRÍTICO: Resolver tenant desde phone_number_id del webhook de WhatsApp
 */
async function resolveTenantFromPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) {
    throw new Error("phone_number_id requerido para resolver tenant");
  }

  // Opción 1: Variable de entorno (desarrollo/single-tenant)
  if (process.env.BOT_TENANT_ID) {
    const tenantId = Number(process.env.BOT_TENANT_ID);
    console.log(`[WA] Usando tenant desde ENV: ${tenantId}`);
    return tenantId;
  }

  // Opción 2: Base de datos (producción multi-tenant) con reintentos
  const maxRetries = 3;
  const retryDelay = 500; // 500ms entre reintentos
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Normalizar phoneNumberId a string para la comparación (puede venir como número o string)
      const normalizedPhoneNumberId = String(phoneNumberId).trim();
      
      // Buscar primero por phone_number_id exacto
      let [[config]] = await pool.query(
        `SELECT tenant_id, phone_display, phone_number_id
         FROM tenant_whatsapp_config 
         WHERE CAST(phone_number_id AS CHAR) = ? AND is_active = TRUE
         LIMIT 1`,
        [normalizedPhoneNumberId]
      );
      
      // Si no se encuentra y el phone_number_id no es un placeholder, buscar registros con placeholder
      // para actualizarlos automáticamente
      if (!config && !normalizedPhoneNumberId.startsWith("pending:")) {
        const [[placeholderConfig]] = await pool.query(
          `SELECT tenant_id, phone_display, phone_number_id, whatsapp_token
           FROM tenant_whatsapp_config 
           WHERE (phone_number_id IS NULL OR phone_number_id = '' OR phone_number_id LIKE 'pending:%')
             AND whatsapp_token IS NOT NULL
             AND is_active = TRUE
           ORDER BY updated_at DESC
           LIMIT 1`,
        );
        
        if (placeholderConfig) {
          console.log(`[WA] 🔄 Encontrado registro con placeholder para tenant ${placeholderConfig.tenant_id}, actualizando con phone_number_id=${normalizedPhoneNumberId}`);
          
          // Actualizar el registro con el phone_number_id real
          const { upsertTenantWhatsAppCredentials } = await import("../services/whatsappHub.js");
          await upsertTenantWhatsAppCredentials(placeholderConfig.tenant_id, {
            phoneNumberId: normalizedPhoneNumberId,
            accessToken: placeholderConfig.whatsapp_token,
            phoneDisplay: placeholderConfig.phone_display || null,
            isActive: true,
            managedBy: "user_oauth",
            managedNotes: "Phone_number_id actualizado automáticamente desde webhook (reemplazó placeholder)",
          });
          
          // Usar el config actualizado
          config = {
            tenant_id: placeholderConfig.tenant_id,
            phone_display: placeholderConfig.phone_display,
          };
          
          console.log(`[WA] ✅ Placeholder reemplazado con phone_number_id=${normalizedPhoneNumberId} para tenant ${placeholderConfig.tenant_id}`);
        }
      }

      if (config) {
        console.log(`[WA] Tenant ${config.tenant_id} (${config.phone_display}) para phone_number_id=${phoneNumberId}`);
        return config.tenant_id;
      }
      
      // Si no hay config pero la consulta fue exitosa, salir del loop
      break;
    } catch (err) {
      const isConnectionError = err.code === 'ECONNREFUSED' || 
                                err.code === 'ECONNRESET' || 
                                err.code === 'ETIMEDOUT' ||
                                err.code === 'PROTOCOL_CONNECTION_LOST' ||
                                err.message?.includes('ECONNREFUSED') ||
                                err.message?.includes('connect');
      
      if (isConnectionError && attempt < maxRetries) {
        console.warn(`[WA] ⚠️ Error de conexión (intento ${attempt}/${maxRetries}), reintentando en ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt)); // backoff exponencial
        continue;
      }
      
      console.error(`[WA] Error consultando tenant_whatsapp_config después de ${attempt} intentos:`, err.message);
      
      // Si es un error de conexión y estamos en producción, usar fallback en lugar de fallar
      if (isConnectionError && process.env.NODE_ENV === "production") {
        console.error(`[WA] ⚠️ ERROR CRÍTICO: No se pudo conectar a la base de datos después de ${maxRetries} intentos`);
        // En producción, mejor usar un fallback configurado si existe
        if (process.env.FALLBACK_TENANT_ID) {
          console.warn(`[WA] ⚠️ Usando FALLBACK_TENANT_ID: ${process.env.FALLBACK_TENANT_ID}`);
          return Number(process.env.FALLBACK_TENANT_ID);
        }
      }
      
      // Si no es error de conexión, no reintentar
      if (!isConnectionError) {
        break;
      }
    }
  }

  // ⚠️ En producción, si no hay tenant configurado, lanzar error
  if (process.env.NODE_ENV === "production") {
    // Solo fallar si no es un error de conexión
    const lastError = await (async () => {
      try {
        await pool.query('SELECT 1');
        return null; // Conexión OK, es que no existe el tenant
      } catch (err) {
        return err;
      }
    })();
    
    if (!lastError) {
      throw new Error(`Tenant no configurado para phone_number_id=${phoneNumberId}`);
    } else {
      // Hay problema de conexión, usar fallback si existe
      if (process.env.FALLBACK_TENANT_ID) {
        console.warn(`[WA] ⚠️ Error de conexión persistente, usando FALLBACK_TENANT_ID: ${process.env.FALLBACK_TENANT_ID}`);
        return Number(process.env.FALLBACK_TENANT_ID);
      }
      throw new Error(`No se pudo conectar a la base de datos y no hay FALLBACK_TENANT_ID configurado`);
    }
  }

  // Fallback solo en desarrollo
  console.warn(`[WA] ⚠️ FALLBACK: usando tenant_id=1 para phone_number_id=${phoneNumberId}`);
  return 1;
}

// ============================================
// HELPERS DE PAGINACIÓN
// ============================================
function formatMyAppointments(list) {
  if (!list?.length) return "No tenés turnos próximos.";
  const lines = list.map((a) => {
    const d = new Date(a.starts_at);
    const fecha = d.toLocaleDateString("es-AR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      timeZone: TIME_ZONE
    });
    const hora = d.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: TIME_ZONE
    });
    return `• ${fecha} ${hora} — ${a.service_name} con ${a.instructor_name}`;
  });
  return `Estos son tus próximos turnos:\n${lines.join("\n")}`;
}

function buildAppointmentRows(appointments, offset = 0) {
  const page = appointments.slice(offset, offset + 9).map((a) => {
    const d = new Date(a.starts_at);
    const fecha = d.toLocaleDateString("es-AR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      timeZone: TIME_ZONE
    });
    const hora = d.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: TIME_ZONE
    });
    return {
      id: `apt_${a.id}`,
      title: `${fecha} ${hora}`,
      description: `${a.service_name} con ${a.instructor_name}`,
    };
  });
  if (offset + 9 < appointments.length) {
    page.push({ id: "apt_page_next", title: "Ver más…", description: "Más turnos" });
  }
  return page;
}

function buildServiceRows(services, offset = 0) {
  const page = services.slice(offset, offset + 9).map((s) => ({
    id: `svc_${s.id}`,
    title: s.name,
    description: `${s.duration_min} min`,
  }));
  if (offset + 9 < services.length) {
    page.push({ id: "svc_page_next", title: "Ver más…", description: "Más servicios" });
  }
  return page;
}

function buildBranchRows(branches, offset = 0) {
  const page = branches.slice(offset, offset + 9).map((b) => ({
    id: `branch_${b.id}`,
    title: b.name,
    description: b.is_primary === 1 ? "Sucursal principal" : "",
  }));
  if (offset + 9 < branches.length) {
    page.push({ id: "branch_page_next", title: "Ver más…", description: "Más sucursales" });
  }
  return page;
}

function normalizeDateInput(value) {
  if (!value) return null;
  const normalized = String(value).replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatClassEnrollments(list) {
  if (!list?.length) return "No tenés clases reservadas.";
  const lines = list.map((item) => {
    const d = normalizeDateInput(item.startsAt);
    const fecha = d
      ? d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" })
      : "";
    const hora = d ? d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "";
    const label = item.templateName || item.activityType || "Clase";
    const instructor = item.instructorName ? ` con ${item.instructorName}` : "";
    return `• ${fecha} ${hora} — ${label}${instructor}`;
  });
  return `Estas son tus próximas clases:\n${lines.join("\n")}`;
}

function computeAvailableCount(session) {
  if (session.availableCount != null) return Number(session.availableCount);
  const capacity = Number(session.capacityMax || session.capacity_max || 0);
  const enrolled = Number(session.enrolledCount || session.enrolled_count || 0);
  return Math.max(0, capacity - enrolled);
}

function buildClassRows(classes, offset = 0, { showBackToSeries = false } = {}) {
  const baseSlice = classes.slice(offset, offset + 8);
  const page = baseSlice.map((cls) => {
    const d = normalizeDateInput(cls.startsAt);
    const fecha = d
      ? d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" })
      : "";
    const hora = d ? d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "";
    const label = cls.templateName || cls.activityType || "Clase";
    const available = computeAvailableCount(cls);
    const descriptionParts = [
      label,
      cls.instructorName ? `Con ${cls.instructorName}` : null,
      `${available} cupos libres`,
    ].filter(Boolean);

    return {
      id: `cls_${cls.id}`,
      title: `${fecha} ${hora}`.trim() || label,
      description: descriptionParts.join(" • "),
    };
  });

  if (offset + baseSlice.length < classes.length) {
    page.push({ id: "cls_page_next", title: "Ver más…", description: "Más clases" });
  }

  if (showBackToSeries) {
    page.push({
      id: "series_back_detail",
      title: "Volver a la serie",
      description: "Regresar al resumen de la serie",
    });
  }

  page.push({ id: "class_back_menu", title: "Volver", description: "Regresar al menú de clases" });

  return page;
}

function buildSeriesRows(series, offset = 0) {
  const slice = series.slice(offset, offset + 8);
  const rows = slice.map((serie) => {
    const first = serie.sessions?.[0] || null;
    const d = first ? normalizeDateInput(first.startsAt) : null;
    const fecha = d
      ? d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" })
      : "";
    const hora = d ? d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "";
    const label = serie.templateName || serie.activityType || "Serie de clases";
    const descriptionParts = [
      label,
      serie.instructorName ? `Con ${serie.instructorName}` : null,
      `${serie.sessions?.length || 0} clases`,
    ].filter(Boolean);

    return {
      id: `ser_${serie.id}`,
      title: `${fecha} ${hora}`.trim() || label,
      description: descriptionParts.join(" • "),
    };
  });

  if (offset + slice.length < series.length) {
    rows.push({ id: "ser_page_next", title: "Ver más…", description: "Más series" });
  }

  rows.push({
    id: "ser_view_singles",
    title: "Ver clases individuales",
    description: "Mostrar calendario completo de clases",
  });

  rows.push({ id: "class_back_menu", title: "Volver", description: "Regresar al menú de clases" });

  return rows;
}

function describeClassSession(session) {
  const d = normalizeDateInput(session.startsAt);
  const fecha = d
    ? d.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit" })
    : "";
  const hora = d ? d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "";
  const label = session.templateName || session.activityType || "Clase";
  const available = computeAvailableCount(session);
  const lines = [
    `📌 *${label}*`,
    `🗓 ${fecha} ${hora}`.trim(),
  ];
  if (session.instructorName) {
    lines.push(`👩‍🏫 ${session.instructorName}`);
  }
  lines.push(`👥 Cupos disponibles: ${available}`);
  if (session.priceDecimal != null && !Number.isNaN(Number(session.priceDecimal))) {
    const price = Number(session.priceDecimal);
    lines.push(`💵 Precio: $${price.toFixed(2)}`);
  }
  if (session.notes) {
    lines.push(`📝 ${session.notes}`);
  }
  return lines.filter(Boolean).join("\n");
}

function describeSeriesSummary(serie) {
  const label = serie.templateName || serie.activityType || "Serie de clases";
  const firstSession = serie.sessions?.[0] || null;
  const lastSession = serie.sessions?.[serie.sessions.length - 1] || null;
  const lines = [`📌 *${label}*`];

  if (firstSession) {
    const d = normalizeDateInput(firstSession.startsAt);
    const fecha = d
      ? d.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit" })
      : "";
    const hora = d ? d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "";
    lines.push(`🗓 Primera clase: ${fecha} ${hora}`.trim());
  }

  if (lastSession && lastSession !== firstSession) {
    const d = normalizeDateInput(lastSession.startsAt);
    const fecha = d
      ? d.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit" })
      : "";
    lines.push(`📅 Última clase: ${fecha}`);
  }

  if (serie.instructorName) {
    lines.push(`👩‍🏫 ${serie.instructorName}`);
  }

  const scheduleMap = new Map();
  (serie.sessions || []).forEach((session) => {
    const start = normalizeDateInput(session.startsAt);
    if (!start) return;
    const end = session.endsAt ? normalizeDateInput(session.endsAt) : null;
    const day = start.toLocaleDateString("es-AR", { weekday: "long" });
    const normalizedDay = day.charAt(0).toUpperCase() + day.slice(1);
    const timeLabel = end
      ? `${start.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} – ${end.toLocaleTimeString(
          "es-AR",
          { hour: "2-digit", minute: "2-digit" }
        )}`
      : start.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    if (!scheduleMap.has(normalizedDay)) {
      scheduleMap.set(normalizedDay, new Set());
    }
    scheduleMap.get(normalizedDay).add(timeLabel);
  });

  if (scheduleMap.size) {
    const scheduleLines = Array.from(scheduleMap.entries())
      .map(([day, times]) => `• ${day}: ${Array.from(times).join(", ")}`)
      .join("\n");
    lines.push(`🕒 Horarios:\n${scheduleLines}`);
  }

  lines.push(`📚 Total de clases: ${serie.sessions?.length || 0}`);

  return lines.filter(Boolean).join("\n");
}

async function sendHomeMenu(user, tenantId, { name, features, header, body, branchId } = {}) {
  // Verificar si el botón de ayuda está habilitado para este tenant
  const { getTenantWhatsAppHub } = await import("../services/whatsappHub.js");
  const waConfig = await getTenantWhatsAppHub(tenantId).catch(() => null);
  const supportAgentEnabled = waConfig?.supportAgentEnabled ?? false;
  const botConfig = await getBotConfig(tenantId);
  // Clases eliminadas - se manejan desde la app móvil
  const options = [
    { id: "action_view", title: "Mis turnos" },
    { id: "action_new", title: "Reservar" },
  ];
  // Botón para hablar con asesor
  // Solo agregar el botón de ayuda si está habilitado
  if (supportAgentEnabled) {
    options.push({ id: "action_support", title: "Ayuda" });
  }
  // Botón para terminar conversación
  options.push({ id: "action_end", title: "Salir" });

  const headerText = header || (name ? botConfig.greetingWithName(name) : botConfig.greeting);
  
  // Si hay un mensaje completo de bienvenida configurado, usarlo primero
  let bodyText = body;
  if (!bodyText && botConfig.welcomeFullMessage) {
    // Reemplazar {name} si está presente
    bodyText = botConfig.welcomeFullMessage.replace(/{name}/g, name || "");
  }
  if (!bodyText) {
    bodyText = botConfig.welcomeMessage;
  }

  // Si hay más de 3 opciones, usar lista (permite hasta 10 opciones)
  // Si hay 3 o menos, usar botones (más visual)
  if (options.length > 3) {
    await sendList(
      user,
      {
        header: headerText,
        body: bodyText,
        buttonText: "Ver opciones",
        rows: options,
        title: "Menú principal",
      },
      tenantId
    );
  } else {
    await sendButtons(
      user,
      {
        header: headerText,
        body: bodyText,
        buttons: options,
      },
      tenantId
    );
  }
}

function buildInstructorRows(instructors, offset = 0) {
  const page = instructors.slice(offset, offset + 9).map((st) => ({
    id: `stf_${st.id}`,
    title: st.name,
  }));
  if (offset + 9 < instructors.length) {
    page.push({ id: "stf_page_next", title: "Ver más…", description: "Más profesionales" });
  }
  return page;
}

function buildSlotRows(slots, day, offset = 0) {
  const now = new Date();

  const validSlots = slots.filter((h) => {
    const slotLocal = new Date(`${day}T${h}:00`);
    const slotUtc = addHours(slotLocal, -TZ_OFFSET);
    const diffMin = (slotUtc.getTime() - now.getTime()) / 60000;
    return diffMin >= LEAD_MIN;
  });

  const page = validSlots.slice(offset, offset + 9).map((h) => ({
    id: `slot_${day}_${h}`,
    title: h,
  }));

  if (offset + 9 < validSlots.length) {
    page.push({ id: "slot_page_next", title: "Ver más…", description: "Más horarios" });
  }

  return page;
}

function extractNameFromText(txt) {
  let t = (txt || "").trim();
  t = t
    .replace(/^soy\s+/i, "")
    .replace(/^me llamo\s+/i, "")
    .replace(/^mi nombre es\s+/i, "");

  return t
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .slice(0, 80);
}

function formatCurrencyLabel(amount, currency = "ARS") {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return "";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: currency || "ARS",
    maximumFractionDigits: 0,
  }).format(numeric);
}

async function hasActiveMembershipPlans(tenantId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total FROM membership_plan WHERE tenant_id = ? AND is_active = 1`,
    [tenantId]
  );
  return Number(row?.total || 0) > 0;
}

async function listActiveMembershipPlans(tenantId) {
  const [rows] = await pool.query(
    `SELECT 
        id,
        name,
        description,
        price_decimal,
        duration_months,
        billing_day,
        grace_days,
        interest_type,
        interest_value
       FROM membership_plan
      WHERE tenant_id = ? AND is_active = 1
      ORDER BY price_decimal DESC, name ASC`,
    [tenantId]
  );
  return rows;
}

function buildMembershipPlanRows(plans, offset = 0) {
  const slice = plans.slice(offset, offset + 9);
  const rows = slice.map((plan) => {
    const price = plan.price_decimal != null ? formatCurrencyLabel(plan.price_decimal) : "";
    const duration = plan.duration_months > 1 ? `${plan.duration_months} meses` : "Mensual";
    const descriptionParts = [price, duration].filter(Boolean);
    return {
      id: `plan_${plan.id}`,
      title: plan.name,
      description: descriptionParts.join(" • ").slice(0, 64),
    };
  });

  if (offset + slice.length < plans.length) {
    rows.push({ id: "plan_page_next", title: "Ver más…", description: "Más planes disponibles" });
  }

  rows.push({ id: "plan_back_home", title: "Volver", description: "Regresar al menú principal" });
  return rows;
}

function describeMembershipPlan(plan) {
  const lines = [
    `📌 *${plan.name}*`,
    plan.description ? `📝 ${plan.description}` : null,
    plan.price_decimal != null ? `💵 ${formatCurrencyLabel(plan.price_decimal)}` : null,
    plan.duration_months ? `⏳ Duración: ${plan.duration_months} mes(es)` : null,
    plan.billing_day ? `📅 Vence cada día ${plan.billing_day}` : "📅 Vence según fecha de pago",
    plan.grace_days ? `⏱ Días de gracia: ${plan.grace_days}` : null,
  ];

  if (plan.interest_type && plan.interest_type !== "none") {
    const value =
      plan.interest_type === "percent"
        ? `${plan.interest_value ?? 0}%`
        : formatCurrencyLabel(plan.interest_value);
    lines.push(`⚠️ Interés por mora: ${value}`);
  }

  lines.push("Para continuar necesito tus datos personales y te envío el link de pago seguro.");
  return lines.filter(Boolean).join("\n");
}

async function ensureCustomerRecord(phone, tenantId) {
  let customer = await getCustomerByPhone(phone, tenantId);
  if (customer) return customer;

  const normalized = String(phone || "").replace(/\D/g, "");
  await pool.query(
    `INSERT INTO customer (tenant_id, phone_e164) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
    [tenantId, normalized]
  );
  customer = await getCustomerByPhone(phone, tenantId);
  return customer;
}

async function updateCustomerFields(customerId, tenantId, fields = {}) {
  const entries = Object.entries(fields).filter(
    ([, value]) => value !== undefined && value !== null
  );
  if (!entries.length) return;

  const sets = entries.map(([key]) => `${key} = ?`);
  const values = entries.map(([, value]) => value);
  values.push(customerId, tenantId);

  await pool.query(
    `UPDATE customer SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`,
    values
  );
}

async function promptMembershipPlanList(user, tenantId, plans, offset = 0) {
  const rows = buildMembershipPlanRows(plans, offset);
  await sendList(
    user,
    {
      header: "Planes de membresía",
      body: "Elegí el plan que más se ajuste a vos:",
      buttonText: "Ver planes",
      rows,
    },
    tenantId
  );
}

async function startMembershipDataCollection(user, tenantId, plan, sessionData = {}) {
  const customer = await ensureCustomerRecord(user, tenantId);
  const membership = {
    ...(sessionData.membership || {}),
    plan,
    planId: plan.id,
    tenantId,
    customerId: customer?.id || null,
  };

  setStep(user, "membership_collect_name", {
    ...sessionData,
    tenantId,
    membership,
  });

  await sendWhatsAppText(
    user,
    "Perfecto 🙌 Necesito que me confirmes tu *nombre y apellido completos* tal como figuran en tu DNI.",
    tenantId
  );
}

async function finalizeMembershipSubscriptionFlow(user, tenantId, sessionData = {}) {
  const membership = sessionData.membership || {};
  const plan = membership.plan;
  if (!plan || !membership.customerId || !membership.email) {
    await sendWhatsAppText(
      user,
      "No pude completar la suscripción porque faltan datos. Escribí *hola* para intentarlo de nuevo.",
      tenantId
    );
    reset(user);
    return;
  }

  try {
    const result = await createSubscriptionPreapproval({
      tenantId,
      customerId: membership.customerId,
      amount: plan.price_decimal,
      currency: "ARS",
      description: plan.name,
      frequency: Number(plan.duration_months) || 1,
      frequencyType: "months",
      payerEmail: membership.email,
      membershipPlanId: plan.id,
    });

    const link = result.init_point || result.sandbox_init_point;
    const lines = [
      `¡Listo! Generé tu suscripción al plan *${plan.name}*.`,
      link ? `Pagá de forma segura desde este link:\n${link}` : null,
      "Cuando Mercado Pago confirme el pago, tu membresía se activará automáticamente y te avisaremos por este medio.",
      "Si necesitás asistencia respondé a este chat.",
    ].filter(Boolean);

    await sendWhatsAppText(user, lines.join("\n\n"), tenantId);
  } catch (error) {
    console.error("[WA] Error creando suscripción:", error);
    await sendWhatsAppText(
      user,
      `No pude crear la suscripción: ${error.message || "Error inesperado"}. Escribí *hola* para volver a intentarlo.`,
      tenantId
    );
  } finally {
    const features = sessionData.features || {};
    const name = sessionData.customer_name || sessionData.customerName || membership.name || null;
    setStep(user, "home_menu", {
      ...sessionData,
      membership: null,
    });
    await sendHomeMenu(user, tenantId, { name, features, header: "¿Querés hacer algo más?" });
  }
}

// ============================================
// FUNCIÓN: Enviar aviso de turno al negocio
// ============================================
async function sendAppointmentAlert({
  user,
  tenantId,
  appointment,
  customerId,
  customerName,
  alertType,
  message,
  delayMinutes,
}) {
  try {
    // Formatear fecha del turno
    const d = new Date(appointment.starts_at);
    const fecha = d.toLocaleDateString("es-AR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      timeZone: TIME_ZONE,
    });
    const hora = d.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: TIME_ZONE,
    });

    // Etiquetas para tipos de aviso
    const alertTypeLabels = {
      late: "⏰ Llegada tarde",
      cannot_attend: "❌ No puede asistir",
      other: "📝 Otro motivo",
    };
    const alertTypeLabel = alertTypeLabels[alertType] || "Aviso";

    // Construir mensaje para WhatsApp
    const alertMessage = `⚠️ *Aviso de Cliente*\n\n` +
      `📱 Cliente: ${customerName || "Sin nombre"}\n` +
      `📞 Teléfono: ${user}\n` +
      `📅 Turno: ${appointment.service_name || "Servicio"} - ${fecha} ${hora}\n` +
      `👤 Profesional: ${appointment.instructor_name || "Sin asignar"}\n\n` +
      `📋 Tipo: ${alertTypeLabel}\n` +
      (delayMinutes ? `⏱️ Demora estimada: ${delayMinutes} minutos\n` : "") +
      `💬 Mensaje: ${message}\n\n` +
      `_Aviso recibido automáticamente_`;

    // Obtener configuración de WhatsApp del tenant
    const { getTenantWhatsAppHub } = await import("../services/whatsappHub.js");
    const waConfig = await getTenantWhatsAppHub(tenantId).catch(() => null);
    const supportAgentPhone = waConfig?.supportAgentPhone ||
                             process.env.SUPPORT_AGENT_PHONE ||
                             process.env.WHATSAPP_SUPPORT_PHONE;

    // Enviar mensaje al agente/negocio por WhatsApp
    let notifiedAt = null;
    if (supportAgentPhone) {
      try {
        const result = await sendMessageToAgentWithFallback(supportAgentPhone, alertMessage, tenantId);
        if (result.success) {
          notifiedAt = new Date();
          console.log(`[WA Alert] ✅ Aviso enviado al agente ${supportAgentPhone} (método: ${result.method})`);
        } else {
          console.warn(`[WA Alert] ⚠️ No se pudo enviar aviso al agente: ${result.originalError?.message || "Error desconocido"}`);
        }
      } catch (waError) {
        console.error(`[WA Alert] ❌ Error enviando aviso por WhatsApp:`, waError.message);
      }
    } else {
      console.warn(`[WA Alert] ⚠️ No hay número de agente configurado para tenant ${tenantId}`);
    }

    // Guardar aviso en la base de datos
    try {
      await pool.query(
        `INSERT INTO customer_appointment_alert 
         (tenant_id, appointment_id, customer_id, alert_type, message, delay_minutes, notified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          appointment.id,
          customerId,
          alertType,
          message,
          delayMinutes,
          notifiedAt,
        ]
      );
      console.log(`[WA Alert] ✅ Aviso guardado en BD para turno ${appointment.id}`);
    } catch (dbError) {
      console.error(`[WA Alert] ❌ Error guardando aviso en BD:`, dbError.message);
    }

    // Crear notificación en el sistema para el instructor
    try {
      // Obtener el user_id del instructor (si existe)
      const [[instructor]] = await pool.query(
        `SELECT user_id FROM instructor WHERE id = ? AND tenant_id = ?`,
        [appointment.instructor_id, tenantId]
      );

      if (instructor?.user_id) {
        await createNotification({
          tenantId,
          userId: instructor.user_id,
          type: "appointment_alert",
          title: `Aviso de ${customerName || "cliente"}`,
          message: `${alertTypeLabel}: ${message}`,
          data: JSON.stringify({
            appointmentId: appointment.id,
            alertType,
            delayMinutes,
            customerPhone: user,
          }),
        });
        console.log(`[WA Alert] ✅ Notificación creada para instructor ${instructor.user_id}`);
      }

      // También notificar a los admins del tenant
      const [admins] = await pool.query(
        `SELECT id FROM user WHERE tenant_id = ? AND role IN ('admin', 'owner') LIMIT 5`,
        [tenantId]
      );

      for (const admin of admins) {
        if (admin.id !== instructor?.user_id) {
          await createNotification({
            tenantId,
            userId: admin.id,
            type: "appointment_alert",
            title: `Aviso de ${customerName || "cliente"}`,
            message: `${alertTypeLabel}: ${message}`,
            data: JSON.stringify({
              appointmentId: appointment.id,
              alertType,
              delayMinutes,
              customerPhone: user,
            }),
          });
        }
      }
      console.log(`[WA Alert] ✅ Notificaciones creadas para ${admins.length} admin(s)`);
    } catch (notifError) {
      console.error(`[WA Alert] ❌ Error creando notificaciones:`, notifError.message);
    }

    return { success: true };
  } catch (error) {
    console.error(`[WA Alert] ❌ Error general en sendAppointmentAlert:`, error);
    return { success: false, error: error.message };
  }
}

// ============================================
// GET /webhooks/whatsapp - Verificación (Meta Developer Console)
// También atendido como GET /whatsapp cuando el router se monta en /api/webhooks
// ============================================
async function handleWebhookVerify(req, res) {
  const certificateCheck = req.headers["x-hub-signature-256"];
  const clientCert = req.socket.getPeerCertificate?.();

  if (certificateCheck) {
    if (!clientCert || !Object.keys(clientCert).length) {
      console.warn("[WA] ❌ Meta envió cabecera TLS pero el request llegó sin certificado");
      return res.sendStatus(403);
    }
    console.log("[WA] ✅ Certificado cliente recibido para verificación");
  }

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (!mode || !token) {
    console.warn("⚠️ [WA] Falta hub.mode o hub.verify_token");
    return res.sendStatus(400);
  }

  if (mode !== "subscribe") {
    console.warn(`⚠️ [WA] Modo inválido: ${mode}`);
    return res.sendStatus(400);
  }

  try {
    // ✅ PRIORIDAD 1: Verificar token global (para todos los tenants)
    const globalVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN || process.env.WA_VERIFY_TOKEN;

    if (globalVerifyToken && token === globalVerifyToken) {
      console.log(`✅ [WA] Webhook verificado con token global (compartido para todos los tenants)`);
      return res.status(200).send(challenge);
    }

    // ✅ PRIORIDAD 2: Buscar token específico por tenant (compatibilidad hacia atrás)
    const [[row]] = await pool.query(
      `SELECT tenant_id, phone_display
         FROM tenant_whatsapp_config
        WHERE whatsapp_verify_token = ?
          AND is_active = 1
        LIMIT 1`,
      [token]
    );

    if (row) {
      console.log(`✅ [WA] Webhook verificado para tenant ${row.tenant_id} (${row.phone_display}) con token específico`);
      return res.status(200).send(challenge);
    }

    // Token no coincide con ninguno
    console.warn("❌ [WA] Token de verificación inválido");
    if (globalVerifyToken) {
      console.warn(`[WA] Token recibido: ${token.substring(0, 4)}... (esperado: ${globalVerifyToken.substring(0, 4)}...)`);
    } else {
      console.warn("[WA] No hay token global configurado (WHATSAPP_VERIFY_TOKEN) y no se encontró token específico por tenant");
    }
    return res.sendStatus(403);

  } catch (err) {
    console.error("❌ [WA] Error verificando webhook:", err.message);
    console.error("[WA] Stack:", err.stack);
    return res.sendStatus(500);
  }
}

whatsapp.get("/webhooks/whatsapp", handleWebhookVerify);
whatsapp.get("/whatsapp", handleWebhookVerify);

// ============================================
// POST /webhooks/whatsapp - Mensajes entrantes
// También atendido como POST /whatsapp cuando el router se monta en /api/webhooks
// ============================================
const handleWebhookPost = async (req, res) => {
  try {
    // Log corto para confirmar que Meta está llegando al servidor (diagnóstico)
    console.log("[WA] 📩 POST webhook recibido", req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ? `(phone_number_id: ${req.body.entry[0].changes[0].value.metadata.phone_number_id})` : "");
    console.log("[WA] ↘️ Recibimos webhook:", JSON.stringify(req.body, null, 2));
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) {
      // Procesar status updates (especialmente errores)
      const statuses = req.body?.entry?.[0]?.changes?.[0]?.value?.statuses;
      const phoneNumberId = req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      
      if (statuses && Array.isArray(statuses)) {
        for (const status of statuses) {
          if (status.status === "failed" && status.errors && Array.isArray(status.errors)) {
            for (const error of status.errors) {
              if (error.code === 131047) {
                const recipientId = status.recipient_id;
                const messageId = status.id;
                console.error(`[WA] ❌ Error 131047 (Re-engagement message) detectado en status update:`);
                console.error(`[WA]   - Message ID: ${messageId}`);
                console.error(`[WA]   - Recipient: ${recipientId}`);
                console.error(`[WA]   - Error: ${error.message || error.title || "Re-engagement message"}`);
                console.error(`[WA]   - Details: ${error.error_data?.details || "No details available"}`);
                console.error(`[WA] ⚠️ El mensaje no se pudo entregar porque pasaron más de 24 horas desde la última respuesta del destinatario.`);
                
                // Intentar enviar template "confirmacion_turno" si hay un turno pendiente con seña
                console.log(`[WA] 🔍 Buscando turno para enviar template. Recipient: ${recipientId}`);
                try {
                  const { pool } = await import("../db.js");
                  const { sendWhatsAppTemplate } = await import("../whatsapp.js");
                  const { createDepositPaymentLink } = await import("../payments.js");
                  
                  // Normalizar el número de teléfono (recipientId viene sin el +)
                  // Puede venir como "5491154616161" o "541154616161"
                  let phoneE164 = recipientId;
                  if (!phoneE164.startsWith("+")) {
                    phoneE164 = `+${phoneE164}`;
                  }
                  // También buscar sin el + para la consulta
                  const phoneForQuery = phoneE164.replace("+", "");
                  console.log(`[WA] 🔍 Buscando turno con números: ${phoneE164}, ${phoneForQuery}, ${recipientId}`);
                  const [rows] = await pool.query(
                    `SELECT a.id, a.tenant_id, a.starts_at, a.status, a.deposit_decimal,
                            c.name as customer_name, c.phone_e164,
                            s.name as service_name,
                            i.name as instructor_name,
                            (SELECT config_value FROM system_config 
                             WHERE tenant_id = a.tenant_id AND config_key = 'deposit.holdMinutes' LIMIT 1) as hold_minutes
                     FROM appointment a
                     JOIN customer c ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
                     LEFT JOIN service s ON a.service_id = s.id AND a.tenant_id = s.tenant_id
                     LEFT JOIN instructor i ON a.instructor_id = i.id AND a.tenant_id = i.tenant_id
                     WHERE (c.phone_e164 = ? OR c.phone_e164 = ? OR REPLACE(c.phone_e164, '+', '') = ?)
                       AND a.status IN ('pending_deposit', 'scheduled')
                       AND a.deposit_decimal > 0
                     ORDER BY a.starts_at DESC
                     LIMIT 1`,
                    [phoneE164, phoneForQuery, recipientId]
                  );
                  
                  console.log(`[WA] 🔍 Turnos encontrados: ${rows.length}`);
                  if (rows.length > 0) {
                    console.log(`[WA] 🔍 Turno encontrado: ID=${rows[0].id}, status=${rows[0].status}, deposit=${rows[0].deposit_decimal}`);
                    const row = rows[0];
                    const startDate = new Date(row.starts_at);
                    const fecha = startDate.toLocaleDateString("es-AR", {
                      weekday: "short",
                      day: "2-digit",
                      month: "2-digit",
                      timeZone: TIME_ZONE
                    });
                    const hora = startDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });
                    const depositAmount = Number(row.deposit_decimal || 0);
                    const depositText = depositAmount > 0 ? depositAmount.toLocaleString("es-AR", {
                      style: "currency",
                      currency: "ARS",
                      maximumFractionDigits: 0,
                    }) : "";
                    const holdMinutes = Number(row.hold_minutes || 30);
                    
                    // Regenerar el link de pago
                    let payLink = null;
                    try {
                      payLink = await createDepositPaymentLink({
                        tenantId: row.tenant_id,
                        appointmentId: row.id,
                        amount: depositAmount,
                        title: `Seña - ${row.service_name || "Servicio"}`,
                        holdMinutes,
                      });
                    } catch (payErr) {
                      console.error(`[WA] ⚠️ No se pudo regenerar link de pago para turno ${row.id}:`, payErr?.message || payErr);
                    }
                    
                    if (payLink) {
                      console.log(`[WA] ℹ️ Intentando enviar template "confirmacion_turno" para turno ${row.id}...`);
                      // Intentar con diferentes códigos de idioma para confirmacion_turno
                      // "Spanish" en Meta puede ser es, es_AR, es_419, es_MX, es_ES
                      // Para "Spanish (ARG)" intentamos primero es_AR
                      const languageCodes = ["es_AR", "es", "es_419", "es_MX", "es_ES"];
                      console.log(`[WA] 🔄 Intentando template con idiomas: ${languageCodes.join(", ")}`);
                      let templateSent = false;
                      let templateError = null;
                      
                      for (const lang of languageCodes) {
                        console.log(`[WA] 🔄 Intentando idioma "${lang}"...`);
                        try {
                          await sendWhatsAppTemplate(
                            phoneE164,
                            "confirmacion_turno",
                            lang,
                            [
                              {
                                type: "body",
                                parameters: [
                                  { type: "text", text: row.customer_name || "Cliente" },
                                  { type: "text", text: row.service_name || "Servicio" },
                                  { type: "text", text: row.instructor_name || "Nuestro equipo" },
                                  { type: "text", text: fecha },
                                  { type: "text", text: hora },
                                  { type: "text", text: depositText },
                                  { type: "text", text: payLink },
                                  { type: "text", text: String(holdMinutes) }
                                ]
                              }
                            ],
                            row.tenant_id
                          );
                          console.log(`[WA] ✅ Template "confirmacion_turno" enviado exitosamente a ${phoneE164} (idioma: ${lang})`);
                          templateSent = true;
                          break;
                        } catch (error) {
                          // Si este idioma no funciona, intentar el siguiente
                          console.log(`[WA] ⚠️ Template "confirmacion_turno" con idioma "${lang}" no disponible (${error.code || 'error'}):`, error.message?.substring(0, 200));
                          templateError = error;
                          // Si es rate limit, no tiene sentido seguir intentando idiomas
                          if (error.code === 131056) {
                            console.warn(`[WA] ⚠️ Rate limit detectado (131056). Deteniendo intentos de template.`);
                            break; // Salir del bucle de idiomas
                          }
                          continue;
                        }
                      }
                      
                      // Si ningún idioma funcionó, NO usar fallback a mensaje de texto
                      // Estamos en contexto de re-engagement (error 131047), y los mensajes de texto
                      // también fallarán con el mismo error, creando un bucle infinito
                      if (!templateSent) {
                        // Si el template no existe (error 132001), solo registrar el error
                        // NO intentar mensaje de texto porque también fallará con 131047
                        if (templateError && templateError.code === 132001) {
                          console.warn(`[WA] ⚠️ Template "confirmacion_turno" no existe en ningún idioma. No se puede re-engagarse porque los mensajes de texto también fallarán con error 131047.`);
                          console.warn(`[WA] 💡 Solución: Creá y aprobá el template "confirmacion_turno" en Meta Business Manager para poder re-engagarse con clientes.`);
                          // No intentar mensaje de texto, simplemente salir
                          return;
                        } else if (templateError && templateError.code === 131047) {
                          // Si el template también falla con 131047, no tiene sentido seguir
                          console.warn(`[WA] ⚠️ Template "confirmacion_turno" también falla con error 131047. No se puede re-engagarse.`);
                          return;
                        } else if (templateError && templateError.code === 131056) {
                          // Si es rate limit, no relanzar el error (ya se intentó demasiado)
                          console.error(`[WA] ❌ Rate limit alcanzado. No se puede enviar template a ${phoneE164}. Esperá unos minutos.`);
                          return; // Salir sin error para evitar más intentos
                        } else {
                          // Si es otro error, solo registrar (no relanzar para evitar bucles)
                          console.error(`[WA] ❌ Error enviando template "confirmacion_turno" con todos los idiomas:`, templateError?.message || templateError);
                          return; // Salir sin error para evitar bucles
                        }
                      }
                    } else {
                      console.log(`[WA] ℹ️ No se pudo generar link de pago para turno ${row.id}. No se enviará template.`);
                    }
                  } else {
                    console.log(`[WA] ℹ️ No se encontró turno pendiente con seña para ${phoneE164}. Intentando enviar template genérico para reabrir conversación...`);
                    
                    // Intentar búsqueda más amplia primero
                    console.log(`[WA] 🔍 Intentando búsqueda alternativa sin filtro de deposit_decimal...`);
                    const [altRows] = await pool.query(
                      `SELECT a.id, a.tenant_id, a.starts_at, a.status, a.deposit_decimal,
                              c.name as customer_name, c.phone_e164,
                              s.name as service_name,
                              i.name as instructor_name
                       FROM appointment a
                       JOIN customer c ON a.customer_id = c.id AND a.tenant_id = c.tenant_id
                       LEFT JOIN service s ON a.service_id = s.id AND a.tenant_id = s.tenant_id
                       LEFT JOIN instructor i ON a.instructor_id = i.id AND a.tenant_id = i.tenant_id
                       WHERE (c.phone_e164 = ? OR c.phone_e164 = ? OR REPLACE(c.phone_e164, '+', '') = ?)
                         AND a.status IN ('pending_deposit', 'scheduled')
                       ORDER BY a.starts_at DESC
                       LIMIT 1`,
                      [phoneE164, phoneForQuery, recipientId]
                    );
                    console.log(`[WA] 🔍 Búsqueda alternativa: ${altRows.length} turnos encontrados`);
                    
                    // Si se encontró un turno en la búsqueda alternativa, intentar enviar template con sus datos
                    if (altRows.length > 0) {
                      const altRow = altRows[0];
                      const startDate = new Date(altRow.starts_at);
                      const fecha = startDate.toLocaleDateString("es-AR", {
                        weekday: "short",
                        day: "2-digit",
                        month: "2-digit",
                        timeZone: TIME_ZONE
                      });
                      const hora = startDate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });
                      
                      console.log(`[WA] ℹ️ Turno encontrado en búsqueda alternativa. Intentando enviar template "confirmacion_turno"...`);
                      // Intentar con diferentes códigos de idioma
                      // Para "Spanish (ARG)" intentamos primero es_AR
                      const languageCodes = ["es_AR", "es", "es_419", "es_MX", "es_ES"];
                      let templateSent = false;
                      let altTemplateError = null;
                      
                      for (const lang of languageCodes) {
                        try {
                          await sendWhatsAppTemplate(
                            phoneE164,
                            "confirmacion_turno",
                            lang,
                            [
                              {
                                type: "body",
                                parameters: [
                                  { type: "text", text: altRow.customer_name || "Cliente" },
                                  { type: "text", text: altRow.service_name || "Servicio" },
                                  { type: "text", text: altRow.instructor_name || "Nuestro equipo" },
                                  { type: "text", text: fecha },
                                  { type: "text", text: hora }
                                ]
                              }
                            ],
                            altRow.tenant_id
                          );
                          console.log(`[WA] ✅ Template "confirmacion_turno" enviado exitosamente a ${phoneE164} (turno alternativo, idioma: ${lang})`);
                          templateSent = true;
                          break;
                        } catch (error) {
                          console.log(`[WA] ⚠️ Template "confirmacion_turno" con idioma "${lang}" no disponible (${error.code || 'error'}):`, error.message?.substring(0, 200));
                          altTemplateError = error;
                          // Si es rate limit, no tiene sentido seguir intentando idiomas
                          if (error.code === 131056) {
                            console.warn(`[WA] ⚠️ Rate limit detectado (131056). Deteniendo intentos de template.`);
                            break; // Salir del bucle de idiomas
                          }
                          continue;
                        }
                      }
                      
                      // Si ningún idioma funcionó, NO usar fallback a mensaje de texto
                      // Estamos en contexto de re-engagement (error 131047), y los mensajes de texto
                      // también fallarán con el mismo error, creando un bucle infinito
                      if (!templateSent) {
                        // Si el template no existe (error 132001), solo registrar el error
                        // NO intentar mensaje de texto porque también fallará con 131047
                        if (altTemplateError && altTemplateError.code === 132001) {
                          console.warn(`[WA] ⚠️ Template "confirmacion_turno" no existe en ningún idioma. No se puede re-engagarse porque los mensajes de texto también fallarán con error 131047.`);
                          console.warn(`[WA] 💡 Solución: Creá y aprobá el template "confirmacion_turno" en Meta Business Manager para poder re-engagarse con clientes.`);
                          // No intentar mensaje de texto, simplemente salir
                          return;
                        } else if (altTemplateError && altTemplateError.code === 131047) {
                          // Si el template también falla con 131047, no tiene sentido seguir
                          console.warn(`[WA] ⚠️ Template "confirmacion_turno" también falla con error 131047. No se puede re-engagarse.`);
                          return;
                        } else if (altTemplateError && altTemplateError.code === 131056) {
                          // Si es rate limit, no relanzar el error (ya se intentó demasiado)
                          console.error(`[WA] ❌ Rate limit alcanzado. No se puede enviar template a ${phoneE164}. Esperá unos minutos.`);
                          return; // Salir sin error para evitar más intentos
                        } else {
                          // Si es otro error, solo registrar (no relanzar para evitar bucles)
                          console.error(`[WA] ❌ Error enviando template "confirmacion_turno":`, altTemplateError?.message || altTemplateError);
                          return; // Salir sin error para evitar bucles
                        }
                      }
                    } else {
                      // Si no hay turno, intentar obtener el tenant_id del cliente para enviar template genérico
                      console.log(`[WA] 🔍 No se encontró turno. Buscando cliente para obtener tenant_id...`);
                      const [customerRows] = await pool.query(
                        `SELECT tenant_id, name FROM customer 
                         WHERE phone_e164 = ? OR phone_e164 = ? OR REPLACE(phone_e164, '+', '') = ?
                         ORDER BY id DESC LIMIT 1`,
                        [phoneE164, phoneForQuery, recipientId]
                      );
                      
                      if (customerRows.length > 0) {
                        const customer = customerRows[0];
                        const tenantId = customer.tenant_id;
                        const customerName = customer.name || "Cliente";
                        
                        console.log(`[WA] ✅ Cliente encontrado. Intentando enviar template "confirmacion_turno" genérico para reabrir conversación...`);
                        
                        // Intentar enviar template genérico para reabrir la conversación
                        // Intentar con diferentes códigos de idioma
                        // Para "Spanish (ARG)" intentamos primero es_AR
                        const languageCodes = ["es_AR", "es", "es_419", "es_MX", "es_ES"];
                        let genericTemplateSent = false;
                        let genericTemplateError = null;
                        
                        for (const lang of languageCodes) {
                          try {
                            await sendWhatsAppTemplate(
                              phoneE164,
                              "confirmacion_turno",
                              lang,
                              [
                                {
                                  type: "body",
                                  parameters: [
                                    { type: "text", text: customerName },
                                    { type: "text", text: "Servicio" },
                                    { type: "text", text: "Nuestro equipo" },
                                    { type: "text", text: "Próximamente" },
                                    { type: "text", text: "Te contactaremos" }
                                  ]
                                }
                              ],
                              tenantId
                            );
                            console.log(`[WA] ✅ Template "confirmacion_turno" genérico enviado exitosamente a ${phoneE164} para reabrir conversación (idioma: ${lang})`);
                            genericTemplateSent = true;
                            break;
                          } catch (error) {
                            console.log(`[WA] ⚠️ Template "confirmacion_turno" genérico con idioma "${lang}" no disponible (${error.code || 'error'}):`, error.message?.substring(0, 200));
                            genericTemplateError = error;
                            // Si es rate limit, no tiene sentido seguir intentando idiomas
                            if (error.code === 131056) {
                              console.warn(`[WA] ⚠️ Rate limit detectado (131056). Deteniendo intentos de template.`);
                              break; // Salir del bucle de idiomas
                            }
                            continue;
                          }
                        }
                        
                        // Si ningún idioma funcionó, intentar con otros templates genéricos
                        if (!genericTemplateSent) {
                          // Si el template no existe o falla, intentar con otros templates genéricos
                          if (genericTemplateError && genericTemplateError.code === 132001) {
                            console.warn(`[WA] ⚠️ Template "confirmacion_turno" no existe. Intentando con template "reabrir_chat"...`);
                            try {
                              // Para "Spanish (ARG)" intentamos primero es_AR
                              const languageCodes = ["es_AR", "es", "es_419", "es_MX", "es_ES"];
                              let templateSent = false;
                              
                              for (const lang of languageCodes) {
                                try {
                                  await sendWhatsAppTemplate(
                                    phoneE164,
                                    "reabrir_chat",
                                    lang,
                                    [
                                      {
                                        type: "body",
                                        parameters: [
                                          { type: "text", text: customerName || "Cliente" }
                                        ]
                                      }
                                    ],
                                    tenantId
                                  );
                                  console.log(`[WA] ✅ Template "reabrir_chat" enviado exitosamente a ${phoneE164} (idioma: ${lang})`);
                                  templateSent = true;
                                  break;
                                } catch (reabrirError) {
                                  console.log(`[WA] ⚠️ Template "reabrir_chat" con idioma "${lang}" no disponible (${reabrirError.code || 'error'}):`, reabrirError.message?.substring(0, 200));
                                  // Si es rate limit, no tiene sentido seguir intentando idiomas
                                  if (reabrirError.code === 131056) {
                                    console.warn(`[WA] ⚠️ Rate limit detectado (131056). Deteniendo intentos de template.`);
                                    break; // Salir del bucle de idiomas
                                  }
                                  continue;
                                }
                              }
                              
                              if (!templateSent) {
                                console.error(`[WA] ❌ No se pudo enviar ningún template para reabrir la conversación con ${phoneE164}`);
                              }
                            } catch (reabrirError) {
                              console.error(`[WA] ❌ Error intentando enviar template "reabrir_chat":`, reabrirError.message || reabrirError);
                            }
                          } else {
                            console.error(`[WA] ❌ Error enviando template genérico:`, genericTemplateError.message || genericTemplateError);
                          }
                        }
                      } else {
                        console.log(`[WA] ⚠️ No se encontró cliente para ${phoneE164}. No se puede determinar el tenant_id para enviar template.`);
                      }
                    }
                  }
                } catch (templateError) {
                  console.error(`[WA] ⚠️ Error intentando enviar template desde webhook:`, templateError.message || templateError);
                  console.error(`[WA] ⚠️ Stack trace:`, templateError.stack);
                }
              } else {
                console.error(`[WA] ❌ Error en status update:`, {
                  messageId: status.id,
                  recipientId: status.recipient_id,
                  status: status.status,
                  errorCode: error.code,
                  errorTitle: error.title,
                  errorMessage: error.message,
                });
              }
            }
          }
        }
      }
      console.log("[WA] ⚠️ Webhook sin mensaje en payload (probablemente status update).");
      return res.sendStatus(200);
    }

    // ✅ CRÍTICO: Extraer phone_number_id del webhook para resolver tenant
    // Intentar múltiples ubicaciones en el payload
    const changes = req.body?.entry?.[0]?.changes?.[0];
    const value = changes?.value;
    
    let phoneNumberId = value?.metadata?.phone_number_id;
    
    // Si no se encuentra en metadata, buscar en otras ubicaciones
    if (!phoneNumberId) {
      phoneNumberId = changes?.value?.phone_number_id;
    }
    if (!phoneNumberId) {
      phoneNumberId = changes?.value?.from; // A veces viene aquí
    }
    if (!phoneNumberId) {
      // Intentar obtener desde el contexto si existe
      phoneNumberId = value?.context?.from;
    }

    if (!phoneNumberId) {
      console.error("[WA] ❌ No se pudo extraer phone_number_id del webhook");
      console.error("[WA] Estructura del webhook recibida:", {
        hasEntry: !!req.body?.entry,
        hasChanges: !!req.body?.entry?.[0]?.changes,
        hasValue: !!req.body?.entry?.[0]?.changes?.[0]?.value,
        hasMetadata: !!req.body?.entry?.[0]?.changes?.[0]?.value?.metadata,
        metadataKeys: req.body?.entry?.[0]?.changes?.[0]?.value?.metadata ? Object.keys(req.body.entry[0].changes[0].value.metadata) : [],
        valueKeys: req.body?.entry?.[0]?.changes?.[0]?.value ? Object.keys(req.body.entry[0].changes[0].value) : [],
      });
      return res.sendStatus(200);
    }

    // ✅ Verificar si es un webhook de prueba de Meta ANTES de procesar
    const isTestWebhook = phoneNumberId === "123456123" || 
                         phoneNumberId.startsWith("test_") ||
                         (phoneNumberId.length < 10 && !phoneNumberId.match(/^\d{15,}$/));
    
    if (isTestWebhook) {
      console.log(`[WA] ℹ️ Webhook de prueba de Meta recibido (phone_number_id=${phoneNumberId}). Ignorando silenciosamente.`);
      return res.sendStatus(200);
    }

    console.log(
      `[WA] ✅ Mensaje entrante para phone_number_id=${phoneNumberId}: from=${msg.from} type=${msg.type}`
    );

    // ✅ Resolver tenant dinámicamente
    let tenantId;
    try {
      tenantId = await resolveTenantFromPhoneNumberId(phoneNumberId);
      if (!tenantId) {
        console.warn(`[WA] ⚠️ No se encontró tenant para phone_number_id=${phoneNumberId}. Intentando actualizar automáticamente...`);
        
        // Intentar encontrar un tenant con OAuth configurado pero sin phone_number_id
        try {
          const { upsertTenantWhatsAppCredentials } = await import("../services/whatsappHub.js");
          
          // Buscar tenants con OAuth pero sin phone_number_id
          const [tenantsWithoutPhoneId] = await pool.query(
            `SELECT tenant_id, whatsapp_token, phone_display 
             FROM tenant_whatsapp_config 
             WHERE whatsapp_token IS NOT NULL 
               AND (phone_number_id IS NULL OR phone_number_id = '' OR phone_number_id LIKE 'pending:%')
               AND is_active = TRUE
             ORDER BY updated_at DESC
             LIMIT 1`,
          );
          
          if (tenantsWithoutPhoneId.length > 0) {
            const tenant = tenantsWithoutPhoneId[0];
            console.log(`[WA] 🔄 Actualizando phone_number_id=${phoneNumberId} para tenant ${tenant.tenant_id}`);
            
            // Actualizar el phone_number_id
            await upsertTenantWhatsAppCredentials(tenant.tenant_id, {
              phoneNumberId: phoneNumberId,
              accessToken: tenant.whatsapp_token,
              phoneDisplay: tenant.phone_display || value?.metadata?.display_phone_number || null,
              isActive: true,
              managedBy: "user_oauth",
              managedNotes: "Phone_number_id actualizado automáticamente desde webhook",
            });
            
            console.log(`[WA] ✅ Phone_number_id=${phoneNumberId} guardado para tenant ${tenant.tenant_id}`);
            tenantId = tenant.tenant_id;
          } else {
            console.error(`[WA] ❌ No se pudo resolver tenant para phone_number_id=${phoneNumberId}`);
            console.error("[WA] Verificar que el phone_number_id esté configurado en tenant_whatsapp_config");
            return res.sendStatus(200);
          }
        } catch (updateError) {
          console.error(`[WA] ❌ Error actualizando phone_number_id automáticamente:`, updateError.message);
          console.error("[WA] Verificar que el phone_number_id esté configurado en tenant_whatsapp_config");
          return res.sendStatus(200);
        }
      }
    } catch (error) {
      console.error(`[WA] ❌ Error resolviendo tenant para phone_number_id=${phoneNumberId}:`, error.message);
      console.error("[WA] Stack:", error.stack);
      return res.sendStatus(200);
    }

    console.log(`[WA] 📱 Mensaje recibido - tenant_id=${tenantId}, from=${msg.from}, type=${msg.type}`);

    // Normalizar número del cliente
    const user = process.env.NODE_ENV === "development"
      ? toSandboxAllowed(msg.from)
      : msg.from;

    // ============================================
    // VERIFICAR SI ES RESPUESTA A NOTIFICACIÓN DE REPROGRAMACIÓN (ANTES DE TODO)
    // ============================================
    // Si el mensaje está respondiendo a una notificación de reprogramación,
    // no activar el bot, simplemente ignorar o responder apropiadamente
    const messageContext = msg.context;
    const contextMessageId = messageContext?.message_id || messageContext?.id;
    
    console.log(`[WA] 🔍 Verificando si es respuesta a notificación:`, {
      hasContext: !!messageContext,
      contextMessageId,
      user,
      tenantId
    });
    
    // Obtener la sesión antes de usarla (necesaria para verificar comandos y estado)
    const currentSession = getSession(user);
    
    // Verificar si es un comando especial ANTES de procesar cualquier otra lógica
    const isTextMessage = msg.type === "text";
    const messageText = isTextMessage ? (msg.text?.body || "").trim().toLowerCase() : "";
    const isTerminarCommand = messageText === "terminar" || messageText === "terminar conversación" || 
                              messageText === "chau" || messageText === "adiós" || messageText === "hasta luego";
    const isHolaCommand = messageText === "hola" || messageText === "hola!" || messageText === "hola 👋";
    
    // Si es comando "terminar" y está en modo waiting_for_agent, procesarlo inmediatamente
    // Esto evita que se procese como respuesta a notificación
    if (isTerminarCommand && currentSession.step === "waiting_for_agent") {
      const supportAgentPhone = currentSession.data?.supportAgentPhone;
      const customerName = currentSession.data?.customerName || "Cliente";
      
      // Notificar al agente que el cliente terminó la conversación
      if (supportAgentPhone) {
        try {
          await sendWhatsAppText(
            supportAgentPhone,
            `👋 *Conversación finalizada*\n\n` +
            `El cliente ${customerName} (${user}) ha terminado la conversación.\n\n` +
            `Ya no recibirás más mensajes de este cliente.`,
            tenantId
          );
        } catch (error) {
          console.error(`[WA Support] Error notificando al agente sobre finalización:`, error);
        }
      }
      
      // Limpiar registros de notificaciones para este cliente para evitar reactivar modo agente
      clearNotificationRecords(user, tenantId);
      
      // Resetear la sesión ANTES de enviar el menú de bienvenida
      reset(user);
      
      // Obtener información del cliente para el menú de bienvenida
      const customer = await getCustomerByPhone(user, tenantId);
      const features = await getTenantFeatureFlags(tenantId);
      if (await hasActiveMembershipPlans(tenantId)) {
        features.memberships = true;
      }
      const branches = await listTenantBranches(tenantId, { activeOnly: true });
      const hasMultipleBranches = branches && branches.length > 1;
      const branchId = hasMultipleBranches && branches.length === 1 ? branches[0].id : null;
      
      // Crear nueva sesión para el menú principal
      const sessionData = {
        hasApts: true,
        tenantId,
        customerId: customer?.id,
        customer_name: customer?.name,
        customer_dni: customer?.documento,
        features,
        branch_id: branchId,
      };
      setStep(user, "home_menu", sessionData);
      
      // Enviar menú de bienvenida (igual que cuando escriben "hola")
      await sendHomeMenu(user, tenantId, { 
        name: customer?.name, 
        features, 
        branchId,
        header: "¡Gracias por contactarnos! 👋",
        body: "¿En qué más te puedo ayudar?"
      });
      
      console.log(`[WA] ✅ Sesión de agente terminada para ${user}, registros limpiados, menú principal enviado`);
      return res.sendStatus(200);
    }
    
    // NO activar modo agente automáticamente si:
    // 1. Es un comando especial (terminar, hola)
    // 2. La sesión está en idle o home_menu (el cliente ya terminó la conversación anteriormente)
    const isCommand = isTerminarCommand || isHolaCommand;
    const isInNormalMenu = currentSession.step === "idle" || currentSession.step === "home_menu";
    
    // Verificar por message_id (si hay contexto) o por tiempo (si no hay contexto pero recibió notificación reciente)
    // Solo activar modo agente si:
    // - Es respuesta a notificación Y
    // - NO es un comando especial Y
    // - NO está en menú normal (idle o home_menu) Y
    // - NO está ya en modo waiting_for_agent (para evitar duplicados)
    if (isNotificationResponse(contextMessageId, user, tenantId) && 
        !isCommand && 
        !isInNormalMenu && 
        currentSession.step !== "waiting_for_agent") {
      console.log(`[WA] ⏭️ Mensaje identificado como respuesta a notificación de reprogramación`);
      
      // Verificar si ya existe una sesión en modo "waiting_for_agent" para este cliente
      // Si no existe, crearla para que los mensajes se reenvíen al agente
      if (currentSession.step !== "waiting_for_agent") {
        try {
          const { getTenantWhatsAppHub } = await import("../services/whatsappHub.js");
          const waConfig = await getTenantWhatsAppHub(tenantId).catch(() => null);
          const supportAgentPhone = waConfig?.supportAgentEnabled && waConfig?.supportAgentPhone 
            ? waConfig.supportAgentPhone 
            : null;
          
          if (supportAgentPhone) {
            // Obtener información del cliente
            const { getCustomerByPhone } = await import("./customers.js");
            const customer = await getCustomerByPhone(user, tenantId).catch(() => null);
            const customerName = customer?.name || "Cliente";
            
            // Crear sesión en modo "waiting_for_agent"
            setStep(user, "waiting_for_agent", {
              ...currentSession.data,
              tenantId: tenantId,
              supportAgentPhone: supportAgentPhone,
              customerName: customerName,
              notificationType: "reprogramation",
              lastMessageTime: Date.now()
            });
            
            console.log(`[WA] ✅ Sesión creada en modo "waiting_for_agent" para respuesta a notificación de reprogramación`);
            
            // Reenviar el mensaje del cliente al agente
            const originalMessage = msg.text?.body || "";
            const forwardedMessage = `💬 *Mensaje de cliente (respuesta a reprogramación)*\n\n` +
              `📱 Cliente: ${customerName}\n` +
              `📞 Teléfono: ${user}\n\n` +
              `💬 Mensaje:\n${originalMessage}\n\n` +
              `_Responde directamente escribiendo al número: ${user}_`;
            
            const agentContext = contextMessageId ? { message_id: contextMessageId } : null;
            const result = await sendMessageToAgentWithFallback(supportAgentPhone, forwardedMessage, tenantId, agentContext);
            
            if (result.success && result.messageId) {
              const updatedSession = getSession(user);
              setStep(user, "waiting_for_agent", {
                ...updatedSession.data,
                tenantId: tenantId,
                supportAgentPhone: supportAgentPhone,
                customerName: customerName,
                notificationType: "reprogramation",
                lastMessageIdToAgent: result.messageId,
                lastMessageTime: Date.now()
              });
            }
            
            console.log(`[WA] ✅ Mensaje reenviado al agente ${supportAgentPhone} desde cliente ${user} (método: ${result.method})`);
            
            // Retornar inmediatamente para evitar que el flujo normal reenvíe el mensaje de nuevo
            return res.sendStatus(200);
          }
        } catch (error) {
          console.error(`[WA] ⚠️ Error creando sesión para respuesta a notificación:`, error);
        }
      } else {
        // Si ya está en modo "waiting_for_agent", dejar que el flujo normal maneje el mensaje
        // El flujo normal reenviará los mensajes normales y procesará los comandos como "terminar"
        console.log(`[WA] ✅ Cliente ya está en modo "waiting_for_agent", el flujo normal manejará el mensaje`);
      }
    } else {
      // No es respuesta a notificación, continuar con el flujo normal
      console.log(`[WA] ✅ Mensaje NO es respuesta a notificación, continuando con flujo normal del bot`);
    }

    // ============================================
    // VERIFICAR SI EL MENSAJE VIENE DEL AGENTE DE SOPORTE
    // ============================================
    // Si el mensaje viene del agente, reenviarlo al cliente correspondiente
    try {
      const { getTenantWhatsAppHub } = await import("../services/whatsappHub.js");
      const waConfig = await getTenantWhatsAppHub(tenantId);
      const supportAgentPhone = waConfig?.supportAgentPhone || 
                               process.env.SUPPORT_AGENT_PHONE || 
                               process.env.WHATSAPP_SUPPORT_PHONE;
      
      // Normalizar números para comparación (sin espacios, sin +, solo dígitos)
      const normalizePhone = (phone) => String(phone || "").replace(/\D/g, "");
      const normalizedUser = normalizePhone(user);
      const normalizedAgentPhone = normalizePhone(supportAgentPhone);
      
      if (supportAgentPhone && normalizedUser === normalizedAgentPhone) {
        // Este mensaje viene del agente, buscar cliente en estado "waiting_for_agent"
        console.log(`[WA Support] 📨 Mensaje recibido del agente ${user}`);
        
        // Buscar todas las sesiones activas en estado "waiting_for_agent" con este agente
        const allSessions = getAllSessions();
        const waitingClients = [];
        
        for (const [phone, session] of Object.entries(allSessions)) {
          if (session.step === "waiting_for_agent" && 
              session.data?.supportAgentPhone &&
              normalizePhone(session.data.supportAgentPhone) === normalizedAgentPhone &&
              session.data?.tenantId === tenantId) {
            waitingClients.push({
              phone,
              session,
              customerName: session.data?.customerName || "Sin nombre",
              lastMessageTime: session.data?.lastMessageTime || 0
            });
          }
        }
        
        // Verificar si el mensaje del agente tiene contexto (message_id)
        // Esto indica que es una respuesta a un mensaje específico de un cliente
        const messageContext = msg.context;
        let targetClient = null;
        
        // Extraer el mensaje del agente para uso posterior
        const agentMessage = msg.type === "text" 
          ? (msg.text?.body || "")
          : msg.type === "image" 
          ? "📷 [Imagen]"
          : msg.type === "document"
          ? "📄 [Documento]"
          : msg.type === "audio"
          ? "🎵 [Audio]"
          : msg.type === "video"
          ? "🎥 [Video]"
          : msg.type === "interactive"
          ? (msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "[Interactivo]")
          : "[Mensaje]";
        
        // Verificar si el agente quiere terminar una conversación
        const agentMessageLower = agentMessage.trim().toLowerCase();
        const isTerminateCommand = agentMessageLower === "/terminar" || 
                                   agentMessageLower === "/terminar chat" ||
                                   agentMessageLower === "/cerrar" ||
                                   agentMessageLower === "/cerrar chat" ||
                                   agentMessageLower.startsWith("/terminar ") ||
                                   agentMessageLower.startsWith("/cerrar ");
        
        if (isTerminateCommand) {
          // El agente quiere terminar una conversación
          console.log(`[WA Support] 🔚 El agente ${user} solicitó terminar una conversación`);
          
          // Usar la lista de clientes esperando que ya se buscó arriba
          if (waitingClients.length === 0) {
            await sendWhatsAppText(
              user,
              `ℹ️ No hay clientes en conversación activa para terminar.`,
              tenantId
            );
            return res.sendStatus(200);
          }
          
          // Si el comando tiene un número, terminar esa conversación específica
          const phoneInCommand = agentMessage.match(/\d{10,15}/g);
          let clientsToTerminate = [];
          
          if (phoneInCommand && phoneInCommand.length > 0) {
            // El agente especificó un número, terminar solo esa conversación
            const mentionedPhone = normalizePhone(phoneInCommand[0]);
            const specificClient = waitingClients.find(c => normalizePhone(c.phone) === mentionedPhone);
            if (specificClient) {
              clientsToTerminate = [specificClient];
            } else {
              await sendWhatsAppText(
                user,
                `⚠️ No se encontró un cliente en conversación con el número ${phoneInCommand[0]}.`,
                tenantId
              );
              return res.sendStatus(200);
            }
          } else if (waitingClients.length === 1) {
            // Solo hay un cliente, terminar esa conversación
            clientsToTerminate = waitingClients;
          } else {
            // Hay múltiples clientes, listarlos y pedir especificar
            const clientsList = waitingClients
              .slice(0, 5)
              .map((c, idx) => {
                const timeAgo = c.lastMessageTime 
                  ? Math.floor((Date.now() - c.lastMessageTime) / 1000 / 60) 
                  : null;
                const timeLabel = timeAgo !== null 
                  ? (timeAgo < 1 ? "ahora" : `hace ${timeAgo} min`)
                  : "desconocido";
                return `${idx + 1}. ${c.customerName} (${c.phone}) - ${timeLabel}`;
              })
              .join("\n");
            
            const moreClients = waitingClients.length > 5 
              ? `\n... y ${waitingClients.length - 5} cliente(s) más.`
              : "";
            
            await sendWhatsAppText(
              user,
              `⚠️ *Hay ${waitingClients.length} cliente(s) en conversación:*\n\n${clientsList}${moreClients}\n\n` +
              `💡 *Para terminar una conversación específica, escribí:*\n` +
              `"/terminar" seguido del número del cliente.\n\n` +
              `📝 *Ejemplo:* "/terminar 541112345678"`,
              tenantId
            );
            return res.sendStatus(200);
          }
          
          // Terminar las conversaciones de los clientes seleccionados
          for (const client of clientsToTerminate) {
            const clientPhone = client.phone;
            const customerName = client.customerName;
            
            // Limpiar registros de notificaciones
            clearNotificationRecords(clientPhone, tenantId);
            
            // Resetear la sesión del cliente
            reset(clientPhone);
            
            // Obtener información del cliente para el menú de bienvenida
            const { getCustomerByPhone } = await import("./customers.js");
            const customer = await getCustomerByPhone(clientPhone, tenantId);
            const features = await getTenantFeatureFlags(tenantId);
            if (await hasActiveMembershipPlans(tenantId)) {
              features.memberships = true;
            }
            const branches = await listTenantBranches(tenantId, { activeOnly: true });
            const hasMultipleBranches = branches && branches.length > 1;
            const branchId = hasMultipleBranches && branches.length === 1 ? branches[0].id : null;
            
            // Crear nueva sesión para el menú principal del cliente
            const sessionData = {
              hasApts: true,
              tenantId,
              customerId: customer?.id,
              customer_name: customer?.name,
              customer_dni: customer?.documento,
              features,
              branch_id: branchId,
            };
            setStep(clientPhone, "home_menu", sessionData);
            
            // Notificar al cliente que la conversación terminó
            const tenantName = await getTenantName(tenantId);
            await sendWhatsAppText(
              clientPhone,
              `👋 *Conversación finalizada*\n\n` +
              `El agente ha finalizado la conversación. Si necesitás algo más, escribí *hola* y te ayudaremos.\n\n` +
              `¡Que tengas un excelente día! 😊\n\n` +
              `_${tenantName}_`,
              tenantId
            );
            
            // Enviar menú de bienvenida al cliente
            await sendHomeMenu(clientPhone, tenantId, { 
              name: customer?.name, 
              features, 
              branchId,
              header: "¡Gracias por contactarnos! 👋",
              body: "¿En qué más te puedo ayudar?"
            });
            
            console.log(`[WA Support] ✅ Conversación terminada para cliente ${clientPhone} (${customerName}) por agente ${user}`);
          }
          
          // Confirmar al agente que la(s) conversación(es) terminaron
          const clientsList = clientsToTerminate.map(c => `${c.customerName} (${c.phone})`).join("\n");
          await sendWhatsAppText(
            user,
            `✅ *Conversación(es) finalizada(s)*\n\n` +
            `Se ha terminado la conversación con:\n${clientsList}\n\n` +
            `Los clientes recibieron un mensaje de despedida y volvieron al menú principal.`,
            tenantId
          );
          
          return res.sendStatus(200);
        }
        
        // WhatsApp envía el contexto en msg.context.message_id
        const contextMessageId = messageContext?.message_id || messageContext?.id;
        if (contextMessageId) {
          // El mensaje tiene contexto, buscar el cliente que tiene este message_id guardado
          console.log(`[WA Support] 🔍 Buscando cliente por contexto message_id: ${contextMessageId}`);
          for (const client of waitingClients) {
            if (client.session.data?.lastMessageIdToAgent === contextMessageId) {
              targetClient = client;
              console.log(`[WA Support] 📎 Mensaje del agente con contexto, respondiendo a cliente ${client.phone} (${client.customerName})`);
              break;
            }
          }
          if (!targetClient) {
            console.log(`[WA Support] ⚠️ No se encontró cliente con message_id ${contextMessageId}, usando lógica de fallback`);
          }
        }
        
        if (waitingClients.length === 0) {
          // No hay cliente esperando, informar al agente
          console.log(`[WA Support] ⚠️ El agente ${user} envió un mensaje pero no hay cliente en espera.`);
          await sendWhatsAppText(
            user,
            `ℹ️ No hay clientes esperando respuesta en este momento.\n\nCuando un cliente solicite ayuda, recibirás sus mensajes aquí y podrás responder directamente.`,
            tenantId
          );
          return res.sendStatus(200);
        }
        
        // Si no se encontró por contexto, buscar por número mencionado o por mensaje más reciente
        if (!targetClient) {
          const phoneInMessage = agentMessage.match(/\d{10,15}/g);
          
          if (phoneInMessage && phoneInMessage.length > 0) {
            // El agente mencionó un número, buscar ese cliente específico
            const mentionedPhone = normalizePhone(phoneInMessage[0]);
            targetClient = waitingClients.find(c => normalizePhone(c.phone) === mentionedPhone);
          }
          
          // Si no se encontró por número mencionado, usar el cliente con el mensaje más reciente
          if (!targetClient) {
            // Ordenar por último mensaje (más reciente primero)
            waitingClients.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
            targetClient = waitingClients[0];
          }
        }
        
        // Si hay múltiples clientes y no se especificó uno, informar al agente
        const phoneInMessage = agentMessage.match(/\d{10,15}/g);
        if (waitingClients.length > 1 && !phoneInMessage && !contextMessageId) {
          const clientsList = waitingClients
            .slice(0, 5) // Máximo 5 clientes en la lista
            .map((c, idx) => {
              const timeAgo = c.lastMessageTime 
                ? Math.floor((Date.now() - c.lastMessageTime) / 1000 / 60) 
                : null;
              const timeLabel = timeAgo !== null 
                ? (timeAgo < 1 ? "ahora" : `hace ${timeAgo} min`)
                : "desconocido";
              return `${idx + 1}. ${c.customerName} (${c.phone}) - ${timeLabel}`;
            })
            .join("\n");
          
          const moreClients = waitingClients.length > 5 
            ? `\n... y ${waitingClients.length - 5} cliente(s) más.`
            : "";
          
          await sendWhatsAppText(
            user,
            `⚠️ *Hay ${waitingClients.length} cliente(s) esperando respuesta:*\n\n${clientsList}${moreClients}\n\n` +
            `💡 *Para responder a un cliente específico, mencioná su número de teléfono en tu mensaje.*\n\n` +
            `📝 *Ejemplo:* "Hola, te ayudo con tu consulta" seguido del número del cliente.\n\n` +
            `🔄 *O simplemente responde normalmente y se enviará al cliente que escribió más recientemente.*`,
            tenantId
          );
          
          // Aún así, enviar al cliente más reciente para no bloquear
          targetClient = waitingClients[0];
        }
        
        if (targetClient) {
          // Reenviar mensaje del agente al cliente seleccionado
          if (msg.type === "text") {
            // Reenviar mensaje de texto del agente al cliente tal cual, sin modificaciones
            // Usar el ID del mensaje del agente como contexto para mantener el hilo
            const clientContext = msg.id ? { message_id: msg.id } : null;
            await sendWhatsAppText(
              targetClient.phone,
              agentMessage,
              tenantId,
              clientContext
            );
            console.log(`[WA Support] ✅ Mensaje del agente reenviado al cliente ${targetClient.phone} (${targetClient.customerName})`);
          } else if (msg.type === "interactive") {
            // Para mensajes interactivos, extraer el texto del botón o lista seleccionado
            const interactiveText = msg.interactive?.button_reply?.title || 
                                   msg.interactive?.list_reply?.title || 
                                   "[Interactivo]";
            const clientContext = msg.id ? { message_id: msg.id } : null;
            await sendWhatsAppText(
              targetClient.phone,
              interactiveText,
              tenantId,
              clientContext
            );
            console.log(`[WA Support] ✅ Respuesta interactiva del agente reenviada al cliente ${targetClient.phone} (${targetClient.customerName})`);
          } else {
            // Para otros tipos de mensajes (imagen, documento, audio, video), informar al cliente
            const clientContext = msg.id ? { message_id: msg.id } : null;
            await sendWhatsAppText(
              targetClient.phone,
              agentMessage,
              tenantId,
              clientContext
            );
            console.log(`[WA Support] ✅ Mensaje de tipo ${msg.type} del agente reenviado al cliente ${targetClient.phone} (${targetClient.customerName})`);
          }
          
          return res.sendStatus(200);
        }
      }
    } catch (agentError) {
      // Si hay error verificando si es agente, continuar con el flujo normal
      console.debug(`[WA Support] Error verificando si es agente:`, agentError.message);
    }

    const session = getSession(user);

    // ============================================
    // VERIFICACIÓN DE IDENTIFICACIÓN OBLIGATORIA (ANTES DE TODO)
    // ============================================
    // Esta verificación se hace ANTES de procesar cualquier mensaje (texto o interactivo)
    // Un usuario está completamente identificado si tiene: nombre Y (documento O teléfono registrado)
    
    // Lista de pasos que NO requieren identificación (son parte del flujo de identificación)
    const identificationSteps = ["identify_choice", "identify_phone", "identify_dni", "collect_dni", "collect_name", "picking_branch"];
    const isInIdentificationFlow = identificationSteps.includes(session.step);
    
    // Si NO está en el flujo de identificación y NO tiene customerId en la sesión, verificar identificación
    if (!isInIdentificationFlow && !session.data?.customerId) {
      // Verificar si el usuario está completamente identificado en la base de datos
      const existing = await getCustomerByPhone(user, tenantId);
      // Usuario completamente identificado = tiene nombre Y (documento O teléfono registrado)
      const isFullyIdentified = existing && existing.name && existing.name.trim() && (existing.documento || existing.phone_e164);
      
      if (!isFullyIdentified) {
        const botConfig = await getBotConfig(tenantId);
        setStep(user, "collect_name", { tenantId, identifyMethod: "phone" });
        await sendWhatsAppText(
          user,
          `Perfecto, te identifico por tu teléfono. ${botConfig.nameRequest || "Ahora decime tu nombre completo."}`,
          tenantId
        );
        return res.sendStatus(200);
      }
      
      // Usuario está completamente identificado, guardar en sesión
      const features = await getTenantFeatureFlags(tenantId);
      if (await hasActiveMembershipPlans(tenantId)) {
        features.memberships = true;
      }
      
      const branches = await listTenantBranches(tenantId, { activeOnly: true });
      const hasMultipleBranches = branches && branches.length > 1;
      const branchId = hasMultipleBranches && branches.length === 1 ? branches[0].id : (session.data?.branch_id || null);
      
      const sessionData = {
        hasApts: true,
        tenantId,
        customerId: existing.id,
        customer_name: existing.name,
        customer_dni: existing.documento,
        features,
        branch_id: branchId,
      };
      setStep(user, "home_menu", sessionData);
    }

    // ============================================
    // MANEJO DE MENSAJES DE TEXTO
    // ============================================
    if (msg.type === "text") {
      const text = (msg.text?.body || "").trim().toLowerCase();

      // ======= COMANDO: CANCELAR =======
      if (text === "cancelar" || text === "cancelar operación" || text === "cancel") {
        reset(user);
        const tenantName = await getTenantName(tenantId);
        await sendWhatsAppText(
          user,
          `Operación cancelada 👍\n\n` +
          `Si necesitás algo más, escribí *hola* y te ayudo.\n\n` +
          `_${tenantName}_`,
          tenantId
        );
        return res.sendStatus(200);
      }

      // ======= COMANDO: TERMINAR (cuando NO está en modo agente) =======
      // Nota: El caso cuando está en modo waiting_for_agent ya se maneja al principio del código
      if (text === "terminar" || text === "terminar conversación" || text === "chau" || text === "adiós" || text === "hasta luego") {
        // Limpiar registros de notificaciones para evitar reactivar modo agente
        clearNotificationRecords(user, tenantId);
        
        reset(user);
        
        // Obtener información del cliente para el menú de bienvenida
        const customer = await getCustomerByPhone(user, tenantId);
        const features = await getTenantFeatureFlags(tenantId);
        if (await hasActiveMembershipPlans(tenantId)) {
          features.memberships = true;
        }
        const branches = await listTenantBranches(tenantId, { activeOnly: true });
        const hasMultipleBranches = branches && branches.length > 1;
        const branchId = hasMultipleBranches && branches.length === 1 ? branches[0].id : null;
        
        // Crear nueva sesión para el menú principal
        const sessionData = {
          hasApts: true,
          tenantId,
          customerId: customer?.id,
          customer_name: customer?.name,
          customer_dni: customer?.documento,
          features,
          branch_id: branchId,
        };
        setStep(user, "home_menu", sessionData);
        
        // Enviar menú de bienvenida
        await sendHomeMenu(user, tenantId, { 
          name: customer?.name, 
          features, 
          branchId,
          header: "¡Gracias por contactarnos! 👋",
          body: "¿En qué más te puedo ayudar?"
        });
        
        return res.sendStatus(200);
      }

      // ======= MODO AGENTE: Reenviar mensajes al agente =======
      if (session.step === "waiting_for_agent") {
        const supportAgentPhone = session.data?.supportAgentPhone;
        const customerName = session.data?.customerName || "Sin nombre";
        const originalMessage = msg.text?.body || "";
        
        // Guardar timestamp del último mensaje del cliente para priorizar respuestas
        session.data.lastMessageTime = Date.now();
        session.data.lastMessageFrom = user;
        
        if (supportAgentPhone) {
          // Reenviar mensaje al agente usando función con fallback a plantilla
          const forwardedMessage = `💬 *Mensaje de cliente*\n\n` +
            `📱 Cliente: ${customerName}\n` +
            `📞 Teléfono: ${user}\n\n` +
            `💬 Mensaje:\n${originalMessage}\n\n` +
            `_Responde directamente escribiendo al número: ${user}_`;
          
          // Obtener el último message_id enviado a este agente para este cliente (si existe)
          // Esto permite mantener chats separados por cliente
          const lastMessageId = session.data?.lastMessageIdToAgent;
          const context = lastMessageId ? { message_id: lastMessageId } : null;
          
          // Usar función con fallback a plantilla para manejar error 131047 automáticamente
          const result = await sendMessageToAgentWithFallback(supportAgentPhone, forwardedMessage, tenantId, context);
          
          if (result.success) {
            // Guardar el message_id para mantener el contexto en futuros mensajes
            if (result.messageId) {
              // Actualizar la sesión con el nuevo message_id para mantener el contexto
              setStep(user, "waiting_for_agent", {
                ...session.data,
                lastMessageIdToAgent: result.messageId,
              });
            }
            
            console.log(`[WA Support] ✅ Mensaje reenviado al agente ${supportAgentPhone} desde cliente ${user} (método: ${result.method})`);
            // Si se usó plantilla, informar al cliente
            if (result.method === "template") {
              try {
                await sendWhatsAppText(
                  user,
                  `✅ Tu mensaje fue recibido y el agente fue notificado.\n\n` +
                  `El agente te responderá pronto. Si necesitás algo urgente, podés escribir *terminar* para volver al menú principal.`,
                  tenantId
                );
              } catch (e) {
                console.debug(`[WA Support] No se pudo enviar confirmación al cliente:`, e.message);
              }
            }
          } else {
            // Si falló, verificar el tipo de error
            if (result.error === "reengagement") {
              // Error 131047: La plantilla también falló, NO intentar más
              console.log(`[WA Support] ⚠️ Ventana cerrada. Solo se puede enviar plantilla. No reenvío más.`);
              // Notificar al administrador pero NO reenviar más
              await notifyAdminAboutReengagementError(tenantId, supportAgentPhone, user, customerName);
              // Informar al cliente
              await sendWhatsAppText(
                user,
                `⚠️ No pudimos conectar con nuestro agente en este momento.\n\n` +
                `El agente puede contactarte directamente escribiendo a tu número: ${user}\n\n` +
                `O podés escribir *terminar* para volver al menú principal.`,
                tenantId
              );
            } else if (result.originalError?.code === 131030) {
              // Error 131030 = número no autorizado (común en modo sandbox)
              console.error(`[WA Support] ❌ El número del agente ${supportAgentPhone} no está autorizado.`);
              console.error(`[WA Support] 💡 Agrega el número ${supportAgentPhone} a la lista de destinatarios en Meta Business Suite.`);
              await sendWhatsAppText(
                user,
                `⚠️ El agente no está disponible en este momento. Por favor, intentá más tarde o escribí *terminar* para volver al menú principal.`,
                tenantId
              );
            } else {
              // Otro tipo de error
              console.error(`[WA Support] ❌ Error reenviando mensaje al agente:`, result.originalError?.message || "Error desconocido");
              await sendWhatsAppText(
                user,
                `⚠️ Hubo un problema al conectar con nuestro equipo. Por favor, intentá nuevamente en un momento.`,
                tenantId
              );
            }
          }
        } else {
          // No hay agente configurado, informar al cliente
          await sendWhatsAppText(
            user,
            `⚠️ No hay un agente disponible en este momento. Por favor, intentá más tarde o escribí *terminar* para volver al menú principal.`,
            tenantId
          );
        }
        
        return res.sendStatus(200);
      }

      // ======= SALUDO / INICIO =======
      if (text === "hola" || session.step === "idle") {
        // Verificar si el usuario está completamente identificado
        const existing = await getCustomerByPhone(user, tenantId);
        const isFullyIdentified = existing && existing.name && existing.name.trim() && (existing.documento || existing.phone_e164);
        
        if (!isFullyIdentified) {
          const botConfig = await getBotConfig(tenantId);
          setStep(user, "collect_name", { tenantId, identifyMethod: "phone" });
          await sendWhatsAppText(
            user,
            `Perfecto, te identifico por tu teléfono. ${botConfig.nameRequest || "Ahora decime tu nombre completo."}`,
            tenantId
          );
          return res.sendStatus(200);
        }
        
        // Usuario está completamente identificado, mostrar menú
        const features = await getTenantFeatureFlags(tenantId);
        if (await hasActiveMembershipPlans(tenantId)) {
          features.memberships = true;
        }
        
        const branches = await listTenantBranches(tenantId, { activeOnly: true });
        const hasMultipleBranches = branches && branches.length > 1;
        const branchId = hasMultipleBranches && branches.length === 1 ? branches[0].id : (session.data?.branch_id || null);
        
        const sessionData = {
          hasApts: true,
          tenantId,
          customerId: existing.id,
          customer_name: existing.name,
          customer_dni: existing.documento,
          features,
          branch_id: branchId,
        };
        setStep(user, "home_menu", sessionData);
        await sendHomeMenu(user, tenantId, { name: existing.name, features, branchId });
        return res.sendStatus(200);
      }

      // ======= ELECCIÓN DE MÉTODO DE IDENTIFICACIÓN =======
      if (session.step === "identify_choice") {
        // Solo verificar id si el mensaje es interactivo
        const isInteractive = msg.type === "interactive";
        const interactiveId = isInteractive ? (msg.interactive?.list_reply || msg.interactive?.button_reply)?.id : null;
        const isTextMsg = msg.type === "text";
        const textNormalized = isTextMsg ? (msg.text?.body || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
        
        if (interactiveId === "identify_by_phone" || ["telefono","tel","phone"].includes(textNormalized)) {
          // Intentar identificar por teléfono (ya lo tenemos)
          const existing = await getCustomerByPhone(user, tenantId);
          
          if (existing && existing.name) {
            // Cliente encontrado por teléfono
            const features = await getTenantFeatureFlags(tenantId);
            if (await hasActiveMembershipPlans(tenantId)) {
              features.memberships = true;
            }
            
            const branches = await listTenantBranches(tenantId, { activeOnly: true });
            const hasMultipleBranches = branches && branches.length > 1;
            const branchId = hasMultipleBranches && branches.length === 1 ? branches[0].id : (session.data?.branch_id || null);
            
            const sessionData = {
              hasApts: true,
              tenantId,
              customerId: existing.id,
              customer_name: existing.name,
              customer_dni: existing.documento,
              features,
              branch_id: branchId,
            };
            setStep(user, "home_menu", sessionData);
            await sendHomeMenu(user, tenantId, { name: existing.name, features, branchId });
            return res.sendStatus(200);
          }
          
          // Cliente no encontrado por teléfono, pedir nombre para crear nuevo
          setStep(user, "collect_name", { tenantId, identifyMethod: "phone" });
          const botConfig = await getBotConfig(tenantId);
          await sendWhatsAppText(
            user,
            `Perfecto, te identifico por tu teléfono. ${botConfig.nameRequest || "Ahora decime tu nombre completo."}`,
            tenantId
          );
          return res.sendStatus(200);
        }
        
        if (interactiveId === "identify_by_dni" || ["dni","documento"].includes(textNormalized)) {
          setStep(user, "collect_dni", { tenantId, identifyMethod: "dni" });
          await sendWhatsAppText(
            user,
            `Perfecto, vamos a identificarte por tu DNI.\n\n` +
            `Por favor, enviame tu *DNI* (solo números).\n` +
            `Ejemplo: *30123456*`,
            tenantId
          );
          return res.sendStatus(200);
        }
      }

      // ======= IDENTIFICACIÓN POR TELÉFONO (legacy, mantener para compatibilidad) =======
      // Solo verificar id si el mensaje es interactivo
      const isInteractive = msg.type === "interactive";
      const interactiveId = isInteractive ? (msg.interactive?.list_reply || msg.interactive?.button_reply)?.id : null;
      
      if (session.step === "identify_phone" || interactiveId === "identify_by_phone") {
        // El teléfono ya lo tenemos (user), solo necesitamos verificar si existe o pedir nombre
        const existing = await getCustomerByPhone(user, tenantId);
        
        if (existing && existing.name) {
          // Cliente existente identificado
          const features = await getTenantFeatureFlags(tenantId);
          if (await hasActiveMembershipPlans(tenantId)) {
            features.memberships = true;
          }
          
          const branches = await listTenantBranches(tenantId, { activeOnly: true });
          const hasMultipleBranches = branches && branches.length > 1;
          const branchId = hasMultipleBranches && branches.length === 1 ? branches[0].id : (session.data?.branch_id || null);
          
          const sessionData = {
            hasApts: true,
            tenantId,
            customerId: existing.id,
            customer_name: existing.name,
            customer_dni: existing.documento,
            features,
            branch_id: branchId,
          };
          setStep(user, "home_menu", sessionData);
          await sendHomeMenu(user, tenantId, { name: existing.name, features, branchId });
          return res.sendStatus(200);
        }
        
        // Cliente nuevo o sin nombre, pedir nombre
        setStep(user, "collect_name", { tenantId, identifyMethod: "phone" });
        const botConfig = await getBotConfig(tenantId);
        await sendWhatsAppText(
          user,
          `Perfecto, te identifico por tu teléfono. ${botConfig.nameRequest || "Ahora decime tu nombre completo."}`,
          tenantId
        );
        return res.sendStatus(200);
      }

      // ======= IDENTIFICACIÓN POR DNI =======
      // Solo verificar id si el mensaje es interactivo
      const isInteractiveForDni = msg.type === "interactive";
      const interactiveIdForDni = isInteractiveForDni ? (msg.interactive?.list_reply || msg.interactive?.button_reply)?.id : null;
      
      if (session.step === "identify_dni" || interactiveIdForDni === "identify_by_dni") {
        setStep(user, "collect_dni", { tenantId, identifyMethod: "dni" });
        await sendWhatsAppText(
          user,
          `Perfecto, vamos a identificarte por tu DNI.\n\n` +
          `Por favor, enviame tu *DNI* (solo números).\n` +
          `Ejemplo: *30123456*`,
          tenantId
        );
        return res.sendStatus(200);
      }

      // ======= RECOLECCIÓN DE DNI =======
      if (session.step === "collect_dni") {
        const dni = text.replace(/\D/g, "");
        if (!dni || dni.length < 6) {
          await sendWhatsAppText(
            user,
            "Necesito tu *DNI* en números (mínimo 6 dígitos).\nEjemplo: *30123456*.",
            tenantId
          );
          return res.sendStatus(200);
        }

        // Buscar cliente por DNI
        const [[customerByDni]] = await pool.query(
          `SELECT id, name, phone_e164, documento, email 
           FROM customer 
           WHERE tenant_id = ? AND documento = ? 
           LIMIT 1`,
          [tenantId, dni]
        );

        if (customerByDni) {
          // Cliente encontrado por DNI
          // Vincular automáticamente el teléfono para futuras interacciones
          if (!customerByDni.phone_e164 || customerByDni.phone_e164 !== user) {
            await pool.query(
              `UPDATE customer SET phone_e164 = ? WHERE id = ? AND tenant_id = ?`,
              [user, customerByDni.id, tenantId]
            );
            console.log(`[WA] Teléfono ${user} vinculado automáticamente al cliente ${customerByDni.id} identificado por DNI ${dni}`);
          }

          const features = await getTenantFeatureFlags(tenantId);
          if (await hasActiveMembershipPlans(tenantId)) {
            features.memberships = true;
          }
          
          const branches = await listTenantBranches(tenantId, { activeOnly: true });
          const hasMultipleBranches = branches && branches.length > 1;
          const branchId = hasMultipleBranches && branches.length === 1 ? branches[0].id : (session.data?.branch_id || null);
          
          const sessionData = {
            hasApts: true,
            tenantId,
            customerId: customerByDni.id,
            customer_name: customerByDni.name,
            customer_dni: customerByDni.documento,
            features,
            branch_id: branchId,
          };
          setStep(user, "home_menu", sessionData);
          await sendWhatsAppText(
            user,
            `¡Perfecto! Te identifiqué por tu DNI. La próxima vez que escribas desde este número, te reconoceré automáticamente. 😊`,
            tenantId
          );
          await sendHomeMenu(user, tenantId, { name: customerByDni.name, features, branchId });
          return res.sendStatus(200);
        }

        // Cliente no encontrado, pedir nombre para crear nuevo
        setStep(user, "collect_name", { tenantId, identifyMethod: "dni", dni });
        await sendWhatsAppText(
          user,
          `No encontré un cliente con ese DNI. Vamos a crear tu perfil.\n\n` +
          `Decime tu *nombre y apellido completos* tal como figuran en tu DNI.`,
          tenantId
        );
        return res.sendStatus(200);
      }

      // ======= RECOLECCIÓN DEL NOMBRE =======
      if (session.step === "collect_name") {
        const name = extractNameFromText(text);
        if (!name || name.length < 2) {
          const botConfig = await getBotConfig(tenantId);
          await sendWhatsAppText(user, `No me quedó claro 😅. ${botConfig.nameRequest}`, tenantId);
          return res.sendStatus(200);
        }

        const storedTenantId = session.data.tenantId || tenantId;
        const features = await getTenantFeatureFlags(storedTenantId);
        if (await hasActiveMembershipPlans(storedTenantId)) {
          features.memberships = true;
        }
        const dni = session.data.dni || null;
        const identifyMethod = session.data.identifyMethod || "phone";
        
        let customerId = null;
        let customerDni = null;
        
        if (identifyMethod === "dni" && dni) {
          // Crear o actualizar cliente con DNI
          const [[customer]] = await pool.query(
            `SELECT id FROM customer WHERE tenant_id = ? AND documento = ? LIMIT 1`,
            [storedTenantId, dni]
          );
          
          if (customer) {
            // Actualizar cliente existente con nombre y teléfono
            await pool.query(
              `UPDATE customer SET name = ?, phone_e164 = ? WHERE id = ? AND tenant_id = ?`,
              [name, user, customer.id, storedTenantId]
            );
            customerId = customer.id;
            customerDni = dni;
          } else {
            // Crear nuevo cliente con DNI y teléfono
            const [result] = await pool.query(
              `INSERT INTO customer (tenant_id, name, phone_e164, documento, tipo_documento) 
               VALUES (?, ?, ?, ?, '96')`,
              [storedTenantId, name, user, dni]
            );
            customerId = result.insertId;
            customerDni = dni;
          }
        } else {
          // Identificación por teléfono - asegurar que tenga nombre
          await upsertCustomerNameByPhone(user, name, storedTenantId);
          const customer = await getCustomerByPhone(user, storedTenantId);
          customerId = customer?.id || null;
          customerDni = customer?.documento || null;
          
          // Si no tiene DNI, es válido porque tiene teléfono registrado
          // El cliente está identificado si tiene nombre Y (documento O teléfono)
        }

        // Verificar si necesita seleccionar sucursal
        const branches = await listTenantBranches(storedTenantId, { activeOnly: true });
        const hasMultipleBranches = branches && branches.length > 1;

        if (hasMultipleBranches && !session.data?.branch_id) {
          setStep(user, "picking_branch", {
            tenantId: storedTenantId,
            features,
            customer_name: name,
            customerId,
            customer_dni: customerDni,
          });
          const botConfig = await getBotConfig(storedTenantId);
          const rows = buildBranchRows(branches, 0);
          await sendList(user, {
            header: `¡Gracias, ${name}! 🙌`,
            body: botConfig.branchSelectionMessage || "Elegí la sucursal donde querés atendete:",
            buttonText: "Ver sucursales",
            rows,
          }, storedTenantId);
          return res.sendStatus(200);
        }

        // No hay múltiples sucursales o ya tiene una seleccionada
        const branchId = hasMultipleBranches && branches.length === 1 ? branches[0].id : (session.data?.branch_id || null);
        const botConfig = await getBotConfig(storedTenantId);
        
        const sessionData = {
          hasApts: true,
          customer_name: name,
          customerId,
          customer_dni: customerDni,
          tenantId: storedTenantId,
          features,
          branch_id: branchId,
        };
        setStep(user, "home_menu", sessionData);
        
        await sendHomeMenu(user, storedTenantId, {
          name,
          features,
          header: `¡Gracias, ${name}! 🙌`,
          body: "¿Qué te gustaría hacer?",
          branchId,
        });
        return res.sendStatus(200);
      }

      // Redirigir todos los pasos de membresía y clases al menú principal (eliminadas - se manejan desde app móvil)
      if (session.step && (session.step.startsWith("membership_") || session.step.startsWith("class_"))) {
        const features = session.data?.features || {};
        const customerName = session.data?.customer_name || null;
        const messageType = session.step.startsWith("membership_") ? "membresías" : "clases";
        await sendWhatsAppText(
          user,
          `ℹ️ Las ${messageType} ahora se gestionan desde la app móvil. Si necesitás ayuda, escribí *hola* y pedí hablar con un asesor.`,
          tenantId
        );
        setStep(user, "home_menu", {
          hasApts: true,
          tenantId,
          customerId: session.data?.customerId,
          customer_name: customerName,
          customer_dni: session.data?.customer_dni,
          features,
          branch_id: session.data?.branch_id,
        });
        await sendHomeMenu(user, tenantId, { name: customerName, features });
        return res.sendStatus(200);
      }

      if (session.step === "membership_collect_name_OLD") {
        const storedTenantId = session.data?.membership?.tenantId || tenantId;
        const name = extractNameFromText(text);
        if (!name || name.length < 3) {
          await sendWhatsAppText(
            user,
            "Necesito tu *nombre y apellido completos*. Ejemplo: *Juan Pérez*.",
            storedTenantId
          );
          return res.sendStatus(200);
        }

        await upsertCustomerNameByPhone(user, name, storedTenantId);
        const customer = await ensureCustomerRecord(user, storedTenantId);

        setStep(user, "membership_collect_dni", {
          ...session.data,
          membership: {
            ...(session.data?.membership || {}),
            name,
            customerId: customer?.id || session.data?.membership?.customerId,
          },
        });

        await sendWhatsAppText(
          user,
          "Genial. Ahora decime tu *DNI* (solo números).",
          storedTenantId
        );
        return res.sendStatus(200);
      }

      if (session.step === "membership_collect_dni") {
        const storedTenantId = session.data?.membership?.tenantId || tenantId;
        const customerId = session.data?.membership?.customerId;
        const dni = text.replace(/\D/g, "");
        if (!dni || dni.length < 6) {
          await sendWhatsAppText(
            user,
            "Necesito tu *DNI* en números. Ejemplo: *30123456*.",
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (!customerId) {
          await sendWhatsAppText(
            user,
            "No pude vincular tus datos. Escribí *hola* para empezar de nuevo.",
            storedTenantId
          );
          reset(user);
          return res.sendStatus(200);
        }

        await updateCustomerFields(customerId, storedTenantId, {
          documento: dni,
          tipo_documento: "96",
        });

        setStep(user, "membership_collect_address", {
          ...session.data,
          membership: {
            ...(session.data?.membership || {}),
            documento: dni,
          },
        });

        await sendWhatsAppText(
          user,
          "Gracias. ¿Cuál es tu *dirección completa* (calle, número y localidad)?",
          storedTenantId
        );
        return res.sendStatus(200);
      }

      if (session.step === "membership_collect_address") {
        const storedTenantId = session.data?.membership?.tenantId || tenantId;
        const customerId = session.data?.membership?.customerId;
        const address = (msg.text?.body || "").trim();
        if (!address || address.length < 4) {
          await sendWhatsAppText(
            user,
            "Necesito la dirección completa. Ejemplo: *Av. Siempre Viva 742, CABA*.",
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (customerId) {
          await updateCustomerFields(customerId, storedTenantId, { domicilio: address });
        }

        setStep(user, "membership_collect_email", {
          ...session.data,
          membership: {
            ...(session.data?.membership || {}),
            address,
          },
        });

        await sendWhatsAppText(
          user,
          "Por último necesito tu *email* para enviarte la suscripción de Mercado Pago.\n\n" +
          "⚠️ *Importante:* Debe ser el mismo email que tenés registrado en tu cuenta de Mercado Pago.",
          storedTenantId
        );
        return res.sendStatus(200);
      }

      if (session.step === "membership_collect_email") {
        const storedTenantId = session.data?.membership?.tenantId || tenantId;
        const customerId = session.data?.membership?.customerId;
        const rawEmail = (msg.text?.body || "").trim();
        const email = rawEmail.toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
          await sendWhatsAppText(
            user,
            "El email no parece válido. Probá nuevamente (ej: *usuario@mail.com*).",
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (!customerId) {
          await sendWhatsAppText(
            user,
            "No pude vincular tus datos. Escribí *hola* para comenzar otra vez.",
            storedTenantId
          );
          reset(user);
          return res.sendStatus(200);
        }

        await updateCustomerFields(customerId, storedTenantId, { email });
        const nextData = {
          ...session.data,
          membership: {
            ...(session.data?.membership || {}),
            email,
          },
        };

        await finalizeMembershipSubscriptionFlow(user, storedTenantId, nextData);
        return res.sendStatus(200);
      }

      // ======= ENTRADA DE FECHA =======
      if (session.step === "picking_date") {
        const day = parseDay(text);
        if (!day) {
          await sendWhatsAppText(
            user,
            "No entendí la fecha 🤔. Probá con *hoy*, *mañana* o *DD/MM*.\nEjemplo: *15/12* o *mañana*",
            tenantId // ✅ Agregado tenantId
          );
          return res.sendStatus(200);
        }

        const storedTenantId = session.data.tenantId || tenantId;

        // Validación: no más de 90 días
        const parsedDate = new Date(`${day}T00:00:00`);
        const maxDate = new Date();
        maxDate.setDate(maxDate.getDate() + 90);

        if (parsedDate > maxDate) {
          await sendWhatsAppText(
            user,
            "⚠️ Solo podés reservar turnos hasta 90 días desde hoy.\nIntentá con otra fecha.",
            storedTenantId // ✅ Agregado tenantId
          );
          return res.sendStatus(200);
        }

        const instructorId = session.data.instructor_id;
        const serviceId = session.data.service_id;

        // ✅ Obtener slots del tenant correcto
        const slots = await _getSlots(instructorId, serviceId, day, storedTenantId);

        if (!slots.length) {
          await sendWhatsAppText(
            user,
            `No hay horarios disponibles el *${day}*. Probá con otra fecha.`,
            storedTenantId // ✅ Agregado tenantId
          );
          return res.sendStatus(200);
        }

        setStep(user, "picking_slot", {
          ...session.data,
          day,
          slots,
          slotOffset: 0,
          tenantId: storedTenantId
        });

        const rows = buildSlotRows(slots, day, 0);
        await sendList(user, {
          header: `Horarios el ${day}`,
          body: "Elegí una hora:",
          buttonText: "Ver horarios",
          rows,
        }, storedTenantId); // ✅ Agregado tenantId
        return res.sendStatus(200);
      }

      // ======= FALLBACK =======
      // Antes de enviar el mensaje de activación del bot, verificar si es respuesta a notificación
      const messageContextFallback = msg.context;
      const contextMessageIdFallback = messageContextFallback?.message_id || messageContextFallback?.id;
      
      if (isNotificationResponse(contextMessageIdFallback, user, tenantId)) {
        console.log(`[WA] ⏭️ FALLBACK: Mensaje identificado como respuesta a notificación, NO enviando mensaje de activación`);
        return res.sendStatus(200);
      }
      
      await sendWhatsAppText(user, "Escribí *hola* para empezar o *cancelar* para salir.", tenantId); // ✅ Agregado tenantId
      return res.sendStatus(200);
    }

    // ============================================
    // MANEJO DE MENSAJES INTERACTIVOS
    // ============================================
    // MANEJO DE MENSAJES INTERACTIVOS (botones/listas)
    // ============================================
    if (msg.type === "interactive") {
      const sel = msg.interactive?.list_reply || msg.interactive?.button_reply;
      const id = sel?.id || "";
      const storedTenantId = session.data?.tenantId || tenantId;

      if (!storedTenantId) {
        console.error("[WA] ❌ No hay tenantId en sesión ni en metadata");
        await sendWhatsAppText(user, "Error: sesión inválida. Escribí *hola* para empezar de nuevo.", tenantId);
        reset(user);
        return res.sendStatus(200);
      }

      // Verificar identificación también para mensajes interactivos (excepto si está en flujo de identificación)
      const identificationSteps = ["identify_choice", "identify_phone", "identify_dni", "collect_dni", "collect_name", "picking_branch"];
      const isInIdentificationFlow = identificationSteps.includes(session.step);
      
      if (!isInIdentificationFlow && !session.data?.customerId) {
        const existing = await getCustomerByPhone(user, storedTenantId);
        const isFullyIdentified = existing && existing.name && existing.name.trim() && (existing.documento || existing.phone_e164);
        
        if (!isFullyIdentified) {
          const botConfig = await getBotConfig(storedTenantId);
          setStep(user, "collect_name", { tenantId: storedTenantId, identifyMethod: "phone" });
          await sendWhatsAppText(
            user,
            `Perfecto, te identifico por tu teléfono. ${botConfig.nameRequest || "Ahora decime tu nombre completo."}`,
            storedTenantId
          );
          return res.sendStatus(200);
        }
        
        // Usuario identificado, guardar en sesión
        const features = await getTenantFeatureFlags(storedTenantId);
        if (await hasActiveMembershipPlans(storedTenantId)) {
          features.memberships = true;
        }
        
        const branches = await listTenantBranches(storedTenantId, { activeOnly: true });
        const hasMultipleBranches = branches && branches.length > 1;
        const branchId = hasMultipleBranches && branches.length === 1 ? branches[0].id : (session.data?.branch_id || null);
        
        const sessionData = {
          hasApts: true,
          tenantId: storedTenantId,
          customerId: existing.id,
          customer_name: existing.name,
          customer_dni: existing.documento,
          features,
          branch_id: branchId,
        };
        setStep(user, "home_menu", sessionData);
      }

      // ====== SELECCIÓN DE SUCURSAL ======
      if (session.step === "picking_branch") {
        if (id === "branch_page_next") {
          const newOffset = (session.data.branchOffset || 0) + 9;
          setStep(user, "picking_branch", {
            ...session.data,
            branchOffset: newOffset
          });

          const branches = await listTenantBranches(storedTenantId, { activeOnly: true });
          const rows = buildBranchRows(branches, newOffset);
          const botConfig = await getBotConfig(storedTenantId);
          await sendList(user, {
            header: "Más sucursales",
            body: botConfig.branchSelectionMessage || "Elegí la sucursal donde querés atendete:",
            buttonText: "Ver sucursales",
            rows,
          }, storedTenantId);
          return res.sendStatus(200);
        }

        if (id.startsWith("branch_")) {
          const branchId = Number(id.slice(7));
          const branches = await listTenantBranches(storedTenantId, { activeOnly: true });
          const selectedBranch = branches.find(b => b.id === branchId);

          if (!selectedBranch) {
            await sendWhatsAppText(user, "Sucursal no encontrada. Escribí *hola* para empezar de nuevo.", storedTenantId);
            reset(user);
            return res.sendStatus(200);
          }

          const features = session.data.features || {};
          const customerName = session.data.customer_name;

          // Si necesita seleccionar servicio después de elegir sucursal
          if (session.data.needServiceSelection) {
            const services = await listServices(storedTenantId);
            if (!services.length) {
              const tenantName = await getTenantName(storedTenantId);
              await sendWhatsAppText(user, `No hay servicios activos por ahora. Contactá a ${tenantName}.`, storedTenantId);
              return res.sendStatus(200);
            }

            setStep(user, "picking_service", {
              services,
              svcOffset: 0,
              tenantId: storedTenantId,
              branch_id: branchId,
              customer_name: customerName,
              features,
            });

            const botConfig = await getBotConfig(storedTenantId);
            const rows = buildServiceRows(services, 0);
            await sendList(user, {
              header: botConfig.serviceSelectionHeader || "Elegí un servicio",
              body: "Servicios disponibles:",
              buttonText: "Ver servicios",
              rows,
            }, storedTenantId);
            return res.sendStatus(200);
          }

          // Si necesita recolectar el nombre, hacerlo ahora
          if (session.data.needName && !customerName) {
            setStep(user, "collect_name", { tenantId: storedTenantId, features, branch_id: branchId });
            const botConfig = await getBotConfig(storedTenantId);
            await sendWhatsAppText(user, botConfig.nameRequest, storedTenantId);
            return res.sendStatus(200);
          }

          // Guardar sucursal seleccionada y mostrar menú principal
          const sessionData = {
            hasApts: true,
            tenantId: storedTenantId,
            customer_name: customerName,
            features,
            branch_id: branchId,
          };
          setStep(user, "home_menu", sessionData);
          await sendHomeMenu(user, storedTenantId, { name: customerName, features, branchId });
          return res.sendStatus(200);
        }
      }

      // ====== MENÚ PRINCIPAL ======
      if (session.step === "home_menu") {
        const features = session.data?.features || {};
        const hasClasses = Boolean(features.classes);
        const customerName = session.data?.customer_name || session.data?.customerName || null;
        const messageText = msg.type === "text" ? (msg.text?.body || "") : "";
        const textCmd = messageText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        let cmdId = id;
        if (!cmdId) {
          if (textCmd.includes("reservar") || (textCmd.includes("turno") && (textCmd.includes("nuevo") || textCmd.includes("sacar") || textCmd.includes("pedir")))) {
            cmdId = "action_new";
          } else if (textCmd.includes("mis turnos") || textCmd.includes("ver turnos")) {
            cmdId = "action_view";
          } else if (textCmd.includes("ayuda")) {
            cmdId = "action_support";
          } else if (textCmd.includes("salir") || textCmd.includes("terminar")) {
            cmdId = "action_end";
          }
        }

        if (cmdId === "action_view") {
          const myApts = await listUpcomingAppointmentsByPhone(user, {
            limit: 10,
            tenantId: storedTenantId
          });

          if (!myApts.length) {
            await sendWhatsAppText(
              user,
              `📅 No tenés turnos próximos programados.\n\n` +
              `¿Querés reservar uno ahora? 😊`,
              storedTenantId
            );
            await sendHomeMenu(user, storedTenantId, {
              name: customerName,
              features,
              header: "¿Qué te gustaría hacer?",
              body: "Podés reservar un nuevo turno, ver clases disponibles o explorar otras opciones.",
            });
            return res.sendStatus(200);
          }

          // Mostrar turnos como lista interactiva
          setStep(user, "viewing_appointments", {
            appointments: myApts,
            aptOffset: 0,
            tenantId: storedTenantId,
            customer_name: customerName,
            features,
          });

          const rows = buildAppointmentRows(myApts, 0);
          await sendList(user, {
            header: "Tus próximos turnos",
            body: "Elegí un turno para ver opciones:",
            buttonText: "Ver turnos",
            rows,
          }, storedTenantId);

          if (hasClasses) {
            const myClasses = await listCustomerClassEnrollments({
              tenantId: storedTenantId,
              phone: user,
              limit: 5,
            });
            if (myClasses.length) {
              await sendWhatsAppText(user, "\n" + formatClassEnrollments(myClasses), storedTenantId);
            }
          }

          return res.sendStatus(200);
        }

        if (cmdId === "action_new") {
          // Verificar si necesita seleccionar sucursal
          const branches = await listTenantBranches(storedTenantId, { activeOnly: true });
          const hasMultipleBranches = branches && branches.length > 1;

          if (hasMultipleBranches && !session.data?.branch_id) {
            setStep(user, "picking_branch", {
              ...session.data,
              tenantId: storedTenantId,
              needServiceSelection: true,
            });
            const botConfig = await getBotConfig(storedTenantId);
            const rows = buildBranchRows(branches, 0);
            await sendList(user, {
              header: botConfig.serviceSelectionHeader || "Elegí un servicio",
              body: botConfig.branchSelectionMessage || "Primero elegí la sucursal:",
              buttonText: "Ver sucursales",
              rows,
            }, storedTenantId);
            return res.sendStatus(200);
          }

          const services = await listServices(storedTenantId);
          if (!services.length) {
            const tenantName = await getTenantName(storedTenantId);
            await sendWhatsAppText(
              user,
              `⚠️ No hay servicios activos por ahora.\n\n` +
              `Contactá directamente a *${tenantName}* o pedí hablar con un asesor desde el menú principal.`,
              storedTenantId
            );
            await sendHomeMenu(user, storedTenantId, {
              name: customerName,
              features,
              header: "¿Necesitás ayuda?",
              body: "Podés hablar con un asesor o explorar otras opciones.",
            });
            return res.sendStatus(200);
          }

          const branchId = hasMultipleBranches && branches.length === 1 ? branches[0].id : (session.data?.branch_id || null);
          setStep(user, "picking_service", {
            services,
            svcOffset: 0,
            tenantId: storedTenantId,
            branch_id: branchId,
          });

          const botConfig = await getBotConfig(storedTenantId);
          const rows = buildServiceRows(services, 0);
          await sendList(user, {
            header: botConfig.serviceSelectionHeader || "Elegí un servicio",
            body: "Servicios disponibles:",
            buttonText: "Ver servicios",
            rows,
          }, storedTenantId);
          return res.sendStatus(200);
        }

        // Membresías y Clases eliminadas - se manejan desde la app móvil

        if (cmdId === "action_support") {
          // Obtener información del tenant y admin para soporte
          const tenantName = await getTenantName(storedTenantId);
          
          // Obtener número del agente de soporte desde la configuración del tenant
          // Prioridad: 1) Configuración del tenant en BD, 2) Variable de entorno global (fallback)
          const { getTenantWhatsAppHub } = await import("../services/whatsappHub.js");
          const waConfig = await getTenantWhatsAppHub(storedTenantId);
          const supportAgentPhone = waConfig?.supportAgentPhone || 
                                   process.env.SUPPORT_AGENT_PHONE || 
                                   process.env.WHATSAPP_SUPPORT_PHONE;
          
          // Obtener información del cliente
          const customer = await getCustomerByPhone(user, storedTenantId);
          const customerName = customer?.name || "Sin nombre";
          
          // Cambiar estado a "waiting_for_agent" para que los mensajes se reenvíen al agente
          setStep(user, "waiting_for_agent", {
            ...session.data,
            tenantId: storedTenantId,
            supportAgentPhone: supportAgentPhone,
            customerName: customerName,
          });

          // Enviar mensaje al cliente indicando que está conectado con un agente
          await sendWhatsAppText(
            user,
            `¡Perfecto! 👨‍💼\n\n` +
            `Te he conectado con nuestro equipo de atención. Escribí tu consulta y un asesor te responderá en breve.\n\n` +
            `Podés escribir *terminar* cuando quieras finalizar la conversación con el agente.`,
            storedTenantId
          );

          // Si hay un número de agente configurado, notificarle
          if (supportAgentPhone) {
            const tenantName = await getTenantName(storedTenantId);
            const notificationMessage = `👨‍💼 *Nueva solicitud de atención*\n\n` +
              `Un cliente se ha conectado para hablar con un asesor.\n\n` +
              `📱 Cliente: ${customerName}\n` +
              `📞 Teléfono: ${user}\n` +
              `🏢 Negocio: ${tenantName}\n\n` +
              `El cliente está esperando tu respuesta. Podés responderle directamente desde este número de WhatsApp escribiendo al número: ${user}\n\n` +
              `_Los mensajes del cliente se reenviarán automáticamente a este número._`;
            
            // Usar función con fallback a plantilla
            const result = await sendMessageToAgentWithFallback(supportAgentPhone, notificationMessage, storedTenantId);
            if (result.success) {
              // Guardar el message_id para mantener el contexto en futuros mensajes
              if (result.messageId) {
                // Actualizar la sesión con el message_id para que el primer mensaje pueda usarlo como contexto
                setStep(user, "waiting_for_agent", {
                  ...session.data,
                  lastMessageIdToAgent: result.messageId,
                });
              }
              console.log(`[WA Support] ✅ Notificación enviada al agente ${supportAgentPhone} para cliente ${user} (método: ${result.method})`);
            } else {
              // Error 131030 = número no autorizado (común en modo sandbox)
              if (result.originalError?.code === 131030) {
                console.error(`[WA Support] ❌ El número del agente ${supportAgentPhone} no está autorizado para recibir mensajes.`);
                console.error(`[WA Support] 💡 Solución: Agrega el número ${supportAgentPhone} a la lista de destinatarios permitidos en Meta Business Suite.`);
                console.error(`[WA Support] 💡 En modo sandbox, solo puedes enviar a números previamente autorizados.`);
              } 
              // Error 131047 = Re-engagement message (más de 24 horas sin respuesta)
              else if (result.error === "reengagement") {
                console.error(`[WA Support] ❌ No se puede notificar al agente ${supportAgentPhone}: han pasado más de 24 horas desde su última respuesta.`);
                console.error(`[WA Support] 💡 El agente debe enviar un mensaje primero al número de WhatsApp Business para iniciar la conversación.`);
              } else {
                console.error(`[WA Support] ❌ Error enviando notificación al agente:`, result.originalError?.message || "Error desconocido");
              }
            }
          } else {
            console.log(`[WA Support] ⚠️ No hay número de agente configurado (SUPPORT_AGENT_PHONE). El cliente ${user} está en modo espera de agente.`);
          }

          console.log(`[WA Support] Cliente ${user} (${customerName}) conectado con agente. Tenant: ${storedTenantId}`);
          
          return res.sendStatus(200);
        }

        if (cmdId === "action_end") {
          // Terminar conversación
          reset(user);
          const tenantName = await getTenantName(storedTenantId);
          await sendWhatsAppText(
            user,
            `¡Gracias por contactarnos! 👋\n\n` +
            `Fue un placer ayudarte. Si necesitás algo más, escribí *hola* y volveremos a estar en contacto.\n\n` +
            `¡Que tengas un excelente día! 😊\n\n` +
            `_${tenantName}_`,
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (id === "action_plans") {
          // Verificar si el usuario es dueño del sistema (admin del tenant)
          // Por ahora, permitimos a todos ver los planes, pero la suscripción requiere email
          const plans = listPlans();
          
          setStep(user, "platform_plans_menu", {
            ...session.data,
            tenantId: storedTenantId,
            platformPlans: plans,
            platformPlanOffset: 0,
          });

          // Mapear códigos de planes a precios reales
          const planPrices = {
            esencial: 14900,
            crecimiento: 24900,
            escala: 44900,
            pro: null, // Plan personalizado
          };
          
          const rows = plans.slice(0, 9).map((plan) => {
            const price = planPrices[plan.code] || plan.amount;
            const priceLabel = price ? `${formatCurrencyLabel(price, plan.currency)}/mes` : "Consultar precio";
            return {
              id: `platform_plan_${plan.code}`,
              title: plan.label,
              description: `${priceLabel} • ${plan.description}`,
            };
          });

          await sendList(
            user,
            {
              header: "Planes mensuales",
              body: "Elegí el plan que mejor se adapte a tu negocio:",
              buttonText: "Ver planes",
              rows,
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }
      }

      // Membresías eliminadas - se manejan desde la app móvil
      // Redirigir cualquier intento de acceder a membresías al menú principal
      if (session.step === "membership_menu" || 
          session.step === "membership_no_active" ||
          session.step === "membership_active_menu" ||
          session.step === "membership_confirm_plan" ||
          session.step === "membership_collect_name" ||
          session.step === "membership_collect_dni" ||
          session.step === "membership_collect_address" ||
          session.step === "membership_collect_email") {
        const features = session.data?.features || {};
        const customerName = session.data?.customer_name || null;
        await sendWhatsAppText(
          user,
          `ℹ️ Las membresías ahora se gestionan desde la app móvil. Si necesitás ayuda, escribí *hola* y pedí hablar con un asesor.`,
          storedTenantId
        );
        setStep(user, "home_menu", {
          ...session.data,
          tenantId: storedTenantId,
        });
        await sendHomeMenu(user, storedTenantId, { name: customerName, features });
        return res.sendStatus(200);
      }
      
      if (session.step === "membership_menu_OLD") {
        const plans = session.data?.membershipPlans || [];
        let offset = session.data?.membershipPlanOffset || 0;
        const features = session.data?.features || {};
        const customerName = session.data?.customer_name || null;

        if (id === "plan_page_next") {
          offset = offset + 9 >= plans.length ? 0 : offset + 9;
          setStep(user, "membership_menu", {
            ...session.data,
            membershipPlanOffset: offset,
          });
          await promptMembershipPlanList(user, storedTenantId, plans, offset);
          return res.sendStatus(200);
        }

        if (id === "plan_back_home") {
          setStep(user, "home_menu", {
            ...session.data,
            membershipPlans: plans,
            membershipPlanOffset: 0,
          });
          await sendHomeMenu(user, storedTenantId, { name: customerName, features });
          return res.sendStatus(200);
        }

        if (id.startsWith("plan_")) {
          const planId = Number(id.replace("plan_", ""));
          const plan = plans.find((p) => Number(p.id) === planId);
          if (!plan) {
            await sendWhatsAppText(
              user,
              "No pude encontrar ese plan. Probá nuevamente.",
              storedTenantId
            );
            await promptMembershipPlanList(user, storedTenantId, plans, offset);
            return res.sendStatus(200);
          }

          setStep(user, "membership_confirm_plan", {
            ...session.data,
            membership: {
              ...(session.data?.membership || {}),
              plan,
              tenantId: storedTenantId,
            },
          });

          await sendWhatsAppText(user, describeMembershipPlan(plan), storedTenantId);
          await sendButtons(
            user,
            {
              header: plan.name,
              body: "¿Querés suscribirte a este plan?",
              buttons: [
                { id: "membership_plan_confirm", title: "Suscribirme" },
                { id: "membership_plan_back", title: "Otros planes" },
                { id: "membership_plan_cancel", title: "Cancelar" },
              ],
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        await promptMembershipPlanList(user, storedTenantId, plans, offset);
        return res.sendStatus(200);
      }

      // ====== MENÚ SIN MEMBRESÍA ACTIVA ======
      if (session.step === "membership_no_active") {
        const plans = session.data?.membershipPlans || [];
        const customerName = session.data?.customer_name || null;
        const features = session.data?.features || {};

        if (id === "membership_contract") {
          // Mostrar planes disponibles para contratar
          setStep(user, "membership_menu", {
            ...session.data,
            membershipPlanOffset: 0,
          });
          await promptMembershipPlanList(user, storedTenantId, plans, 0);
          return res.sendStatus(200);
        }

        if (id === "membership_support") {
          // Usar la misma funcionalidad de derivación a agente que action_support
          const tenantName = await getTenantName(storedTenantId);
          // Obtener número del agente desde la configuración del tenant
          const { getTenantWhatsAppHub } = await import("../services/whatsappHub.js");
          const waConfig = await getTenantWhatsAppHub(storedTenantId);
          const supportAgentPhone = waConfig?.supportAgentPhone || 
                                   process.env.SUPPORT_AGENT_PHONE || 
                                   process.env.WHATSAPP_SUPPORT_PHONE;
          const customer = await getCustomerByPhone(user, storedTenantId);
          const customerNameForSupport = customer?.name || customerName || "Sin nombre";
          
          setStep(user, "waiting_for_agent", {
            ...session.data,
            tenantId: storedTenantId,
            supportAgentPhone: supportAgentPhone,
            customerName: customerNameForSupport,
          });

          await sendWhatsAppText(
            user,
            `¡Perfecto! 👨‍💼\n\n` +
            `Te he conectado con nuestro equipo de atención para ayudarte con tu consulta sobre membresías. Escribí tu consulta y un asesor te responderá en breve.\n\n` +
            `Podés escribir *terminar* cuando quieras finalizar la conversación con el agente.`,
            storedTenantId
          );

          if (supportAgentPhone) {
            const notificationMessage = `👨‍💼 *Nueva solicitud de atención - Membresías*\n\n` +
              `Un cliente se ha conectado para consultar sobre membresías.\n\n` +
              `📱 Cliente: ${customerNameForSupport}\n` +
              `📞 Teléfono: ${user}\n` +
              `🏢 Negocio: ${tenantName}\n` +
              `📋 Consulta: Membresías\n\n` +
              `El cliente está esperando tu respuesta. Podés responderle directamente desde este número de WhatsApp escribiendo al número: ${user}\n\n` +
              `_Los mensajes del cliente se reenviarán automáticamente a este número._`;
            
            // Usar función con fallback a plantilla
            const result = await sendMessageToAgentWithFallback(supportAgentPhone, notificationMessage, storedTenantId);
            if (result.success) {
              // Guardar el message_id para mantener el contexto en futuros mensajes
              if (result.messageId) {
                session.data.lastMessageIdToAgent = result.messageId;
              }
              console.log(`[WA Support] Notificación enviada al agente ${supportAgentPhone} para cliente ${user} (membresías) (método: ${result.method})`);
            } else {
              console.error(`[WA Support] Error enviando notificación al agente:`, result.originalError?.message || "Error desconocido");
            }
          }
          
          console.log(`[WA Membership Support] Cliente ${user} (${customerNameForSupport}) conectado con agente. Tenant: ${storedTenantId}`);
          return res.sendStatus(200);
        }

        if (id === "membership_back_home") {
          setStep(user, "home_menu", {
            ...session.data,
            membershipPlans: null,
          });
          await sendHomeMenu(user, storedTenantId, { name: customerName, features });
          return res.sendStatus(200);
        }

        // Si no coincide con ningún ID, mostrar menú de nuevo
        await sendButtons(
          user,
          {
            header: "Membresías",
            body: `No tenés una membresía activa.\n\n` +
                  `Tenemos ${plans.length} plan${plans.length > 1 ? 'es' : ''} disponible${plans.length > 1 ? 's' : ''} para vos. ¿Querés verlos y contratar uno?`,
            buttons: [
              { id: "membership_contract", title: "Contratar" },
              { id: "membership_support", title: "Ayuda" },
              { id: "membership_back_home", title: "Volver" },
            ],
          },
          storedTenantId
        );
        return res.sendStatus(200);
      }

      if (session.step === "platform_plans_menu") {
        const plans = session.data?.platformPlans || [];
        const customerName = session.data?.customer_name || null;
        const features = session.data?.features || {};

        if (id === "plan_back_home" || id === "action_back") {
          setStep(user, "home_menu", {
            ...session.data,
            platformPlans: plans,
            platformPlanOffset: 0,
          });
          await sendHomeMenu(user, storedTenantId, { name: customerName, features });
          return res.sendStatus(200);
        }

        if (id.startsWith("platform_plan_")) {
          const planCode = id.replace("platform_plan_", "");
          const plan = plans.find((p) => p.code === planCode);
          if (!plan) {
            await sendWhatsAppText(
              user,
              "No pude encontrar ese plan. Probá nuevamente.",
              storedTenantId
            );
            // Mapear códigos de planes a precios reales
            const planPrices = {
              esencial: 14900,
              crecimiento: 24900,
              escala: 44900,
              pro: null, // Plan personalizado
            };
            
            const rows = plans.slice(0, 9).map((p) => {
              const price = planPrices[p.code] || p.amount;
              const priceLabel = price ? `${formatCurrencyLabel(price, p.currency)}/mes` : "Consultar precio";
              return {
                id: `platform_plan_${p.code}`,
                title: p.label,
                description: `${priceLabel} • ${p.description}`,
              };
            });
            await sendList(
              user,
              {
                header: "Planes mensuales",
                body: "Elegí el plan que mejor se adapte a tu negocio:",
                buttonText: "Ver planes",
                rows,
              },
              storedTenantId
            );
            return res.sendStatus(200);
          }

          // Mapear códigos de planes a precios reales
          const planPrices = {
            esencial: 14900,
            crecimiento: 24900,
            escala: 44900,
            pro: null, // Plan personalizado
          };
          const price = planPrices[plan.code] || plan.amount;
          const priceLabel = price ? `${formatCurrencyLabel(price, plan.currency)}/mes` : "Consultar precio";
          
          // Mostrar detalles del plan
          const planDetails = [
            `📌 *${plan.label}*`,
            `📝 ${plan.description}`,
            `💵 Precio: ${priceLabel}`,
            ``,
            `*Características:*`,
            plan.features.appointments ? `✅ Agenda de turnos` : null,
            plan.features.stock ? `✅ Control de stock` : null,
            plan.features.invoicing ? `✅ Facturación` : null,
            plan.features.classes ? `✅ Clases grupales` : null,
            plan.features.multiBranch ? `✅ Múltiples sucursales` : null,
            plan.features.maxBranches ? `📍 Hasta ${plan.features.maxBranches} sucursal${plan.features.maxBranches > 1 ? 'es' : ''}` : null,
          ].filter(Boolean).join("\n");

          await sendWhatsAppText(user, planDetails, storedTenantId);
          
          // Verificar si ya tiene una suscripción activa
          const [[activeSubscription]] = await pool.query(
            `SELECT id, plan_code, plan_label, status, mp_status, activated_at
             FROM platform_subscription
             WHERE tenant_id = ? AND status = 'authorized'
             ORDER BY activated_at DESC
             LIMIT 1`,
            [storedTenantId]
          );

          if (activeSubscription) {
            await sendWhatsAppText(
              user,
              `Ya tenés una suscripción activa al plan "${activeSubscription.plan_label}". Para cambiar de plan, contactá a nuestro equipo de ventas.`,
              storedTenantId
            );
            await sendHomeMenu(user, storedTenantId, { name: customerName, features });
            return res.sendStatus(200);
          }

          setStep(user, "platform_plan_confirm", {
            ...session.data,
            selectedPlan: plan,
          });

          await sendButtons(
            user,
            {
              header: `💳 ${plan.label}`,
              body: `¿Querés suscribirte a este plan?\n\n` +
                    `Te enviaré un link de pago seguro de Mercado Pago. El pago se procesará de forma automática cada mes.\n\n` +
                    `¿Continuamos?`,
              buttons: [
                { id: "platform_plan_subscribe", title: "Sí, suscribirme" },
                { id: "platform_plan_back", title: "Otros planes" },
                { id: "platform_plan_cancel", title: "Cancelar" },
              ],
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        // Si no coincide con ningún ID conocido, mostrar la lista de nuevo
        // Mapear códigos de planes a precios reales
        const planPrices = {
          esencial: 14900,
          crecimiento: 24900,
          escala: 44900,
          pro: null, // Plan personalizado
        };
        
        const rows = plans.slice(0, 9).map((plan) => {
          const price = planPrices[plan.code] || plan.amount;
          const priceLabel = price ? `${formatCurrencyLabel(price, plan.currency)}/mes` : "Consultar precio";
          return {
            id: `platform_plan_${plan.code}`,
            title: plan.label,
            description: `${priceLabel} • ${plan.description}`,
          };
        });
        await sendList(
          user,
          {
            header: "Planes mensuales",
            body: "Elegí el plan que mejor se adapte a tu negocio:",
            buttonText: "Ver planes",
            rows,
          },
          storedTenantId
        );
        return res.sendStatus(200);
      }

      if (session.step === "platform_plan_confirm") {
        const plan = session.data?.selectedPlan;
        const customerName = session.data?.customer_name || null;
        const features = session.data?.features || {};

        if (id === "platform_plan_back") {
          setStep(user, "platform_plans_menu", {
            ...session.data,
            selectedPlan: null,
          });
          const plans = session.data?.platformPlans || [];
          // Mapear códigos de planes a precios reales
          const planPrices = {
            esencial: 14900,
            crecimiento: 24900,
            escala: 44900,
            pro: null, // Plan personalizado
          };
          
          const rows = plans.slice(0, 9).map((p) => {
            const price = planPrices[p.code] || p.amount;
            const priceLabel = price ? `${formatCurrencyLabel(price, p.currency)}/mes` : "Consultar precio";
            return {
              id: `platform_plan_${p.code}`,
              title: p.label,
              description: `${priceLabel} • ${p.description}`,
            };
          });
          await sendList(
            user,
            {
              header: "Planes mensuales",
              body: "Elegí el plan que mejor se adapte a tu negocio:",
              buttonText: "Ver planes",
              rows,
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (id === "platform_plan_cancel") {
          await sendWhatsAppText(
            user,
            `Operación cancelada 👍\n\n` +
            `Si cambias de opinión, siempre podés volver a ver los planes desde el menú principal.`,
            storedTenantId
          );
          await sendHomeMenu(user, storedTenantId, { name: customerName, features });
          return res.sendStatus(200);
        }

        if (id === "platform_plan_subscribe") {
          if (!plan) {
            await sendWhatsAppText(
              user,
              "No pude encontrar el plan seleccionado. Escribí *hola* para empezar de nuevo.",
              storedTenantId
            );
            reset(user);
            return res.sendStatus(200);
          }

          // Obtener el email del dueño del tenant (admin)
          const [[adminUser]] = await pool.query(
            `SELECT email FROM users 
             WHERE tenant_id = ? AND role = 'admin' 
             ORDER BY created_at ASC 
             LIMIT 1`,
            [storedTenantId]
          );

          if (!adminUser?.email) {
            await sendWhatsAppText(
              user,
              "No se pudo obtener el email para la suscripción. Por favor, contactá a nuestro equipo de soporte.",
              storedTenantId
            );
            await sendHomeMenu(user, storedTenantId, { name: customerName, features });
            return res.sendStatus(200);
          }

          try {
            // Crear la suscripción usando el endpoint existente
            const FRONTEND_BASE = process.env.FRONTEND_BASE || process.env.FRONTEND_URL || "https://pelu-turnos.vercel.app";
            const [[tenant]] = await pool.query("SELECT slug FROM tenant WHERE id = ? LIMIT 1", [storedTenantId]);
            const tenantSlug = tenant?.slug || storedTenantId;

            const response = await fetch(`${FRONTEND_BASE.replace(/\/$/, "")}/api/config/platform-subscription/create`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                // Necesitamos autenticación, pero desde WhatsApp no tenemos token
                // Por ahora, crearemos la suscripción directamente
              },
              body: JSON.stringify({
                plan: plan.code,
                payerEmail: adminUser.email,
              }),
            });

            // En lugar de usar el endpoint HTTP, crearemos la suscripción directamente
            // usando la misma lógica que el endpoint
            const planDef = getPlanDefinition(plan.code);
            const PLATFORM_MP_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.PLATFORM_MP_TOKEN || "";
            
            if (!PLATFORM_MP_TOKEN) {
              await sendWhatsAppText(
                user,
                "Lo siento, el sistema de pagos no está configurado. Por favor, contactá a nuestro equipo de soporte.",
                storedTenantId
              );
              await sendHomeMenu(user, storedTenantId, { name: customerName, features });
              return res.sendStatus(200);
            }

            // Verificar si ya existe una suscripción activa
            const [[existingSubscription]] = await pool.query(
              `SELECT id, plan_code, plan_label, status, mp_status, activated_at
               FROM platform_subscription
               WHERE tenant_id = ? AND status = 'authorized'
               ORDER BY activated_at DESC
               LIMIT 1`,
              [storedTenantId]
            );

            if (existingSubscription) {
              await sendWhatsAppText(
                user,
                `Ya tenés una suscripción activa al plan "${existingSubscription.plan_label}". Para cambiar de plan, contactá a nuestro equipo de ventas.`,
                storedTenantId
              );
              await sendHomeMenu(user, storedTenantId, { name: customerName, features });
              return res.sendStatus(200);
            }

            // Mapear códigos de planes a precios reales
            const planPrices = {
              esencial: 14900,
              crecimiento: 24900,
              escala: 44900,
              pro: null, // Plan personalizado
            };
            const actualPrice = planPrices[plan.code] || planDef.amount;
            
            if (!actualPrice) {
              await sendWhatsAppText(
                user,
                "Este plan requiere contacto con nuestro equipo de ventas. Por favor, escribinos a ventas@arjaerp.com",
                storedTenantId
              );
              await sendHomeMenu(user, storedTenantId, { name: customerName, features });
              return res.sendStatus(200);
            }
            
            // Crear preapproval en Mercado Pago
            // Usar mañana como fecha de inicio para evitar errores de fecha pasada
            const startDate = (() => {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              tomorrow.setHours(0, 0, 0, 0); // Inicio del día
              return tomorrow.toISOString();
            })();
            
            const mpPayload = {
              reason: planDef.label,
              auto_recurring: {
                frequency: 1,
                frequency_type: "months",
                transaction_amount: Number(actualPrice),
                currency_id: planDef.currency || "ARS",
                start_date: startDate,
              },
              payer_email: adminUser.email,
              external_reference: `tenant:${storedTenantId}:plan:${planDef.code}`,
              back_url: `${FRONTEND_BASE}/${tenantSlug}/subscription/success`,
            };

            const mpResponse = await fetch("https://api.mercadopago.com/preapproval", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${PLATFORM_MP_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(mpPayload),
            });

            const mpData = await mpResponse.json();

            if (!mpResponse.ok) {
              console.error("[WA] Error creando suscripción en Mercado Pago:", mpData);
              await sendWhatsAppText(
                user,
                "Hubo un error al crear la suscripción. Por favor, intentá más tarde o contactá a nuestro equipo de soporte.",
                storedTenantId
              );
              await sendHomeMenu(user, storedTenantId, { name: customerName, features });
              return res.sendStatus(200);
            }

            // Guardar la suscripción en la base de datos
            const nextCharge = mpData.auto_recurring?.next_payment_date
              ? new Date(mpData.auto_recurring.next_payment_date)
              : null;
            const lastPayment = mpData.auto_recurring?.last_payment_date
              ? new Date(mpData.auto_recurring.last_payment_date)
              : null;

            await pool.query(
              `INSERT INTO platform_subscription
               (tenant_id, plan_code, plan_label, currency, amount,
                mp_preapproval_id, mp_init_point, mp_status, status, payer_email, created_at, updated_at, activated_at, last_payment_at, next_charge_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?)`,
              [
                storedTenantId,
                planDef.code,
                planDef.label,
                planDef.currency || "ARS",
                actualPrice,
                mpData.id,
                mpData.init_point,
                mpData.status,
                mpData.status === "authorized" ? "authorized" : "pending",
                adminUser.email,
                mpData.status === "authorized" ? new Date() : null,
                lastPayment,
                nextCharge,
              ]
            );

            // Enviar link de pago con mensaje mejorado
            await sendWhatsAppText(
              user,
              `¡Excelente! 🎉\n\n` +
              `He preparado tu suscripción al plan *${planDef.label}*.\n\n` +
              `📱 *Link de pago seguro:*\n${mpData.init_point}\n\n` +
              `💡 *Importante:*\n` +
              `• El pago se procesará automáticamente cada mes\n` +
              `• Podés cancelar cuando quieras\n` +
              `• Una vez que completes el pago, tu suscripción se activará inmediatamente\n\n` +
              `Si tenés alguna duda, escribí *hola* y pedí hablar con un asesor. 😊`,
              storedTenantId
            );

            reset(user);
            return res.sendStatus(200);
          } catch (error) {
            console.error("[WA] Error en suscripción desde WhatsApp:", error);
            await sendWhatsAppText(
              user,
              "Hubo un error al procesar tu solicitud. Por favor, intentá más tarde o contactá a nuestro equipo de soporte.",
              storedTenantId
            );
            await sendHomeMenu(user, storedTenantId, { name: customerName, features });
            return res.sendStatus(200);
          }
        }

        await sendHomeMenu(user, storedTenantId, { name: customerName, features });
        return res.sendStatus(200);
      }

      // ====== MENÚ DE MEMBRESÍA ACTIVA ======
      if (session.step === "membership_active_menu") {
        const subscription = session.data?.activeSubscription;
        const customerName = session.data?.customer_name || null;
        const features = session.data?.features || {};

        if (id === "membership_view_details") {
          if (!subscription) {
            await sendWhatsAppText(user, "No pude encontrar los detalles de tu membresía.", storedTenantId);
            await sendHomeMenu(user, storedTenantId, { name: customerName, features });
            return res.sendStatus(200);
          }

          const nextCharge = subscription.next_charge_at ? new Date(subscription.next_charge_at) : null;
          const lastPayment = subscription.last_payment_at ? new Date(subscription.last_payment_at) : null;
          
          let details = `📋 *Detalles de tu Membresía*\n\n`;
          details += `📌 Plan: *${subscription.plan_name || subscription.reason || 'Membresía'}*\n`;
          if (subscription.plan_description) {
            details += `📝 Descripción: ${subscription.plan_description}\n`;
          }
          details += `💵 Monto: ${formatCurrencyLabel(subscription.amount_decimal, subscription.currency || 'ARS')}\n`;
          details += `🔄 Frecuencia: ${subscription.frequency || 1} ${subscription.frequency_type === 'months' ? 'mes(es)' : 'día(s)'}\n`;
          details += `✅ Estado: ${subscription.status === 'authorized' ? 'Activa' : subscription.status}\n\n`;
          
          if (nextCharge) {
            const fechaVencimiento = nextCharge.toLocaleDateString("es-AR", {
              weekday: "long",
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            });
            const diasRestantes = Math.ceil((nextCharge.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
            details += `📅 *Próximo pago:*\n`;
            details += `   Fecha: ${fechaVencimiento}\n`;
            details += `   Días restantes: ${diasRestantes > 0 ? diasRestantes : 0}\n\n`;
          }
          
          if (lastPayment) {
            const fechaUltimoPago = lastPayment.toLocaleDateString("es-AR", {
              weekday: "long",
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            });
            details += `💰 Último pago: ${fechaUltimoPago}\n`;
          }

          await sendWhatsAppText(user, details, storedTenantId);
          
          await sendButtons(
            user,
            {
              header: "Membresía",
              body: "¿Qué más querés hacer?",
              buttons: [
                { id: "membership_pay", title: "Pagar" },
                { id: "membership_browse_plans", title: "Otros planes" },
                { id: "membership_support", title: "Ayuda" },
                { id: "membership_back_home", title: "Volver" },
              ],
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (id === "membership_pay") {
          if (!subscription || !subscription.mp_init_point) {
            await sendWhatsAppText(
              user,
              "No hay un link de pago disponible para tu membresía. Por favor, contactá a un asesor.",
              storedTenantId
            );
            await sendButtons(
              user,
              {
                header: "Membresía",
                body: "¿Qué querés hacer?",
                buttons: [
                  { id: "membership_view_details", title: "Detalles" },
                  { id: "membership_browse_plans", title: "Otros planes" },
                  { id: "membership_support", title: "Ayuda" },
                  { id: "membership_back_home", title: "Volver" },
                ],
              },
              storedTenantId
            );
            return res.sendStatus(200);
          }

          await sendWhatsAppText(
            user,
            `💳 *Link de pago*\n\n` +
            `Hacé clic en el siguiente link para pagar tu membresía:\n\n` +
            `${subscription.mp_init_point}\n\n` +
            `Una vez que completes el pago, tu membresía se renovará automáticamente.`,
            storedTenantId
          );
          
          await sendButtons(
            user,
            {
              header: "Membresía",
              body: "¿Necesitás algo más?",
              buttons: [
                { id: "membership_view_details", title: "Detalles" },
                { id: "membership_browse_plans", title: "Otros planes" },
                { id: "membership_support", title: "Ayuda" },
                { id: "membership_back_home", title: "Volver" },
              ],
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (id === "membership_browse_plans") {
          const plans = await listActiveMembershipPlans(storedTenantId);
          if (!plans.length) {
            await sendWhatsAppText(
              user,
              `📋 Por el momento no hay otros planes disponibles.\n\n` +
              `Si tenés alguna consulta, podés hablar con un asesor.`,
              storedTenantId
            );
            await sendButtons(
              user,
              {
                header: "Membresía",
                body: "¿Qué querés hacer?",
                buttons: [
                  { id: "membership_view_details", title: "Detalles" },
                  { id: "membership_pay", title: "Pagar" },
                  { id: "membership_support", title: "Ayuda" },
                  { id: "membership_back_home", title: "Volver" },
                ],
              },
              storedTenantId
            );
            return res.sendStatus(200);
          }

          setStep(user, "membership_menu", {
            ...session.data,
            membershipPlans: plans,
            membershipPlanOffset: 0,
            activeSubscription: null,
          });
          await promptMembershipPlanList(user, storedTenantId, plans, 0);
          return res.sendStatus(200);
        }

        if (id === "membership_support") {
          // Usar la misma funcionalidad de derivación a agente que action_support
          const tenantName = await getTenantName(storedTenantId);
          // Obtener número del agente desde la configuración del tenant
          const { getTenantWhatsAppHub } = await import("../services/whatsappHub.js");
          const waConfig = await getTenantWhatsAppHub(storedTenantId);
          const supportAgentPhone = waConfig?.supportAgentPhone || 
                                   process.env.SUPPORT_AGENT_PHONE || 
                                   process.env.WHATSAPP_SUPPORT_PHONE;
          const customer = await getCustomerByPhone(user, storedTenantId);
          const customerNameForSupport = customer?.name || customerName || "Sin nombre";
          const planName = subscription?.plan_name || subscription?.reason || "N/A";
          
          setStep(user, "waiting_for_agent", {
            ...session.data,
            tenantId: storedTenantId,
            supportAgentPhone: supportAgentPhone,
            customerName: customerNameForSupport,
          });

          await sendWhatsAppText(
            user,
            `¡Perfecto! 👨‍💼\n\n` +
            `Te he conectado con nuestro equipo de atención para ayudarte con tu consulta sobre tu membresía "${planName}". Escribí tu consulta y un asesor te responderá en breve.\n\n` +
            `Podés escribir *terminar* cuando quieras finalizar la conversación con el agente.`,
            storedTenantId
          );

          if (supportAgentPhone) {
            const notificationMessage = `👨‍💼 *Nueva solicitud de atención - Membresía*\n\n` +
              `Un cliente se ha conectado para consultar sobre su membresía.\n\n` +
              `📱 Cliente: ${customerNameForSupport}\n` +
              `📞 Teléfono: ${user}\n` +
              `🏢 Negocio: ${tenantName}\n` +
              `📋 Membresía: ${planName}\n\n` +
              `El cliente está esperando tu respuesta. Podés responderle directamente desde este número de WhatsApp escribiendo al número: ${user}\n\n` +
              `_Los mensajes del cliente se reenviarán automáticamente a este número._`;
            
            // Usar función con fallback a plantilla
            const result = await sendMessageToAgentWithFallback(supportAgentPhone, notificationMessage, storedTenantId);
            if (result.success) {
              // Guardar el message_id para mantener el contexto en futuros mensajes
              if (result.messageId) {
                session.data.lastMessageIdToAgent = result.messageId;
              }
              console.log(`[WA Support] Notificación enviada al agente ${supportAgentPhone} para cliente ${user} (membresía: ${planName}) (método: ${result.method})`);
            } else {
              console.error(`[WA Support] Error enviando notificación al agente:`, result.originalError?.message || "Error desconocido");
            }
          }
          
          console.log(`[WA Membership Support] Cliente ${user} (${customerNameForSupport}) conectado con agente. Membresía: ${planName}, Tenant: ${storedTenantId}`);
          return res.sendStatus(200);
        }

        if (id === "membership_back_home") {
          setStep(user, "home_menu", {
            ...session.data,
            activeSubscription: null,
          });
          await sendHomeMenu(user, storedTenantId, { name: customerName, features });
          return res.sendStatus(200);
        }

        // Si no coincide con ningún ID, mostrar menú de nuevo
        await sendButtons(
          user,
          {
            header: "Membresía",
            body: "¿Qué querés hacer con tu membresía?",
              buttons: [
                { id: "membership_view_details", title: "Detalles" },
                { id: "membership_pay", title: "Pagar" },
                { id: "membership_browse_plans", title: "Otros planes" },
                { id: "membership_support", title: "Ayuda" },
                { id: "membership_back_home", title: "Volver" },
              ],
          },
          storedTenantId
        );
        return res.sendStatus(200);
      }

      if (session.step === "membership_confirm_plan") {
        const plan = session.data?.membership?.plan;
        const features = session.data?.features || {};
        const customerName = session.data?.customer_name || null;

        if (id === "membership_plan_back") {
          setStep(user, "membership_menu", {
            ...session.data,
            membershipPlanOffset: session.data?.membershipPlanOffset || 0,
          });
          await promptMembershipPlanList(
            user,
            storedTenantId,
            session.data?.membershipPlans || [],
            session.data?.membershipPlanOffset || 0
          );
          return res.sendStatus(200);
        }

        if (id === "membership_plan_cancel") {
          setStep(user, "home_menu", {
            ...session.data,
            membership: null,
          });
          await sendHomeMenu(user, storedTenantId, { name: customerName, features });
          return res.sendStatus(200);
        }

        if (id === "membership_plan_confirm") {
          if (!plan) {
            await sendWhatsAppText(
              user,
              "No pude identificar el plan seleccionado. Probemos de nuevo.",
              storedTenantId
            );
            setStep(user, "membership_menu", {
              ...session.data,
              membership: null,
            });
            await promptMembershipPlanList(
              user,
              storedTenantId,
              session.data?.membershipPlans || [],
              session.data?.membershipPlanOffset || 0
            );
            return res.sendStatus(200);
          }

          await startMembershipDataCollection(user, storedTenantId, plan, session.data);
          return res.sendStatus(200);
        }

        await sendButtons(
          user,
          {
            header: plan?.name || "Plan de membresía",
            body: "¿Querés continuar con este plan?",
            buttons: [
              { id: "membership_plan_confirm", title: "Suscribirme" },
              { id: "membership_plan_back", title: "Otros planes" },
              { id: "membership_plan_cancel", title: "Cancelar" },
            ],
          },
          storedTenantId
        );
        return res.sendStatus(200);
      }

      // ====== MENÚ DE CLASES ======
      if (session.step === "class_menu") {
        const features = session.data?.features || {};
        const hasClasses = Boolean(features.classes);
        const customerName = session.data?.customer_name || session.data?.customerName || null;

        const classMenuButtons = [
          { id: "class_browse", title: "Buscar" },
          { id: "class_my", title: "Mis clases" },
          { id: "class_back_home", title: "Volver" },
        ];

        if (!hasClasses) {
          await sendWhatsAppText(
            user,
            "Las clases no están disponibles para este negocio.",
            storedTenantId
          );
          await sendHomeMenu(user, storedTenantId, { name: customerName, features });
          setStep(user, "home_menu", { tenantId: storedTenantId, features });
          return res.sendStatus(200);
        }

        if (id === "class_back_home") {
          setStep(user, "home_menu", {
            ...session.data,
            tenantId: storedTenantId,
            classes: [],
            classOffset: 0,
            selectedClass: null,
          });
          await sendHomeMenu(user, storedTenantId, { name: customerName, features });
          return res.sendStatus(200);
        }

        if (id === "class_my") {
          const enrollments = await listCustomerClassEnrollments({
            tenantId: storedTenantId,
            phone: user,
            limit: 6,
          });

          const msgText = enrollments.length
            ? formatClassEnrollments(enrollments)
            : "Todavía no estás inscripto en ninguna clase.";

          await sendWhatsAppText(user, msgText, storedTenantId);
          await sendButtons(
            user,
            {
              header: "Clases grupales",
              body: "¿Qué querés hacer?",
              buttons: classMenuButtons,
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (id === "class_browse") {
          const { series, singles } = await listUpcomingClassSeriesWithSingles({
            tenantId: storedTenantId,
            limitSeries: 18,
            maxSessionsPerSeries: 12,
          });

          if (!series.length && !singles.length) {
            await sendWhatsAppText(
              user,
              "No encontramos clases disponibles en los próximos días.",
              storedTenantId
            );
            await sendButtons(
              user,
              {
                header: "Clases grupales",
                body: "¿Querés intentar más tarde?",
                buttons: classMenuButtons,
              },
              storedTenantId
            );
            return res.sendStatus(200);
          }

          if (series.length) {
            setStep(user, "picking_series", {
              ...session.data,
              classOffset: 0,
              seriesOffset: 0,
              seriesList: series,
              singles,
            });

            const rows = buildSeriesRows(series, 0);
            await sendList(
              user,
              {
                header: "Series de clases",
                body: "Elegí una serie o mirá las clases individuales:",
                buttonText: "Ver series",
                rows,
              },
              storedTenantId
            );
            return res.sendStatus(200);
          }

          // Fallback: no hay series, mostrar clases individuales
          setStep(user, "picking_class", {
            ...session.data,
            classes: singles,
            classOffset: 0,
            seriesList: [],
            singles,
          });

          const rows = buildClassRows(singles, 0);
          await sendList(
            user,
            {
              header: "Clases disponibles",
              body: "Elegí una opción:",
              buttonText: "Ver clases",
              rows,
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        await sendButtons(
          user,
          {
            header: "Clases grupales",
            body: "Usá las opciones del menú 👇",
            buttons: classMenuButtons,
          },
          storedTenantId
        );
        return res.sendStatus(200);
      }

      // ====== LISTA DE SERIES ======
      if (session.step === "picking_series") {
        if (id === "ser_page_next") {
          const currentOffset = session.data.seriesOffset || 0;
          const newOffset = currentOffset + 8;
          setStep(user, "picking_series", {
            ...session.data,
            seriesOffset: newOffset,
          });

          const rows = buildSeriesRows(session.data.seriesList || [], newOffset);
          await sendList(
            user,
            {
              header: "Series de clases",
              body: "Elegí una serie o mirá las clases individuales:",
              buttonText: "Ver series",
              rows,
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (id === "ser_view_singles") {
          const singles = session.data.singles || [];
          if (!singles.length) {
            await sendWhatsAppText(
              user,
              "Por ahora todas las clases pertenecen a una serie. Elegí una serie para continuar 👍",
              storedTenantId
            );
            const rows = buildSeriesRows(session.data.seriesList || [], session.data.seriesOffset || 0);
            await sendList(
              user,
              {
                header: "Series de clases",
                body: "Elegí una serie:",
                buttonText: "Ver series",
                rows,
              },
              storedTenantId
            );
            return res.sendStatus(200);
          }

          setStep(user, "picking_class", {
            ...session.data,
            classes: singles,
            classOffset: 0,
            selectedSeries: null,
            fromSeriesList: true,
          });

          const rows = buildClassRows(singles, 0);
          await sendList(
            user,
            {
              header: "Clases individuales",
              body: "Elegí una opción:",
              buttonText: "Ver clases",
              rows,
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (id === "class_back_menu") {
          setStep(user, "class_menu", {
            ...session.data,
            selectedSeries: null,
          });
          await sendButtons(
            user,
            {
              header: "Clases grupales",
              body: "Elegí una opción:",
              buttons: [
                { id: "class_browse", title: "Buscar" },
                { id: "class_my", title: "Mis clases" },
                { id: "class_back_home", title: "Volver" },
              ],
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (id.startsWith("ser_")) {
          const seriesId = id.slice(4);
          const seriesList = session.data.seriesList || [];
          const selectedSeries = seriesList.find((s) => String(s.id) === seriesId);

          if (!selectedSeries) {
            await sendWhatsAppText(
              user,
              "No pude identificar esa serie. Probá nuevamente.",
              storedTenantId
            );
            return res.sendStatus(200);
          }

          setStep(user, "confirming_series", {
            ...session.data,
            selectedSeries,
          });

          const detail = describeSeriesSummary(selectedSeries);
          await sendButtons(
            user,
            {
              header: "Serie seleccionada",
              body: `${detail}\n\n¿Cómo querés reservar?`,
              buttons: [
                { id: "series_enroll", title: "Anotarme a toda la serie" },
                { id: "series_view_classes", title: "Ver clases sueltas" },
                { id: "series_back_list", title: "Ver otras series" },
                { id: "class_back_menu", title: "Menú clases" },
              ],
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }
      }

      // ====== SELECCIÓN DE CLASE ======
      if (session.step === "picking_class") {
        if (id === "cls_page_next") {
          const currentOffset = session.data.classOffset || 0;
          const newOffset = currentOffset + 8;
          setStep(user, "picking_class", {
            ...session.data,
            classOffset: newOffset,
          });

          const rows = buildClassRows(session.data.classes || [], newOffset, {
            showBackToSeries: Boolean(session.data.selectedSeries),
          });
          await sendList(
            user,
            {
              header: "Más clases",
              body: "Elegí una opción:",
              buttonText: "Ver clases",
              rows,
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (id === "class_back_menu") {
          setStep(user, "class_menu", {
            ...session.data,
            selectedClass: null,
          });
          await sendButtons(
            user,
            {
              header: "Clases grupales",
              body: "Elegí una opción:",
              buttons: [
                { id: "class_browse", title: "Buscar" },
                { id: "class_my", title: "Mis clases" },
                { id: "class_back_home", title: "Volver" },
              ],
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (id === "series_back_detail") {
          const selectedSeries = session.data.selectedSeries;
          if (selectedSeries) {
            setStep(user, "confirming_series", {
              ...session.data,
              selectedSeries,
              classes: session.data.classes,
            });

            const detail = describeSeriesSummary(selectedSeries);
            await sendButtons(
              user,
              {
                header: "Serie seleccionada",
                body: `${detail}\n\n¿Cómo querés reservar?`,
                buttons: [
                  { id: "series_enroll", title: "Anotarme a toda la serie" },
                  { id: "series_view_classes", title: "Ver clases sueltas" },
                  { id: "series_back_list", title: "Ver otras series" },
                  { id: "class_back_menu", title: "Menú clases" },
                ],
              },
              storedTenantId
            );
            return res.sendStatus(200);
          }
        }

        if (id.startsWith("cls_")) {
          const classId = Number(id.slice(4));
          const classes = session.data.classes || [];
          const selected = classes.find((c) => c.id === classId);

          if (!selected) {
            await sendWhatsAppText(
              user,
              "No pude identificar esa clase. Probá de nuevo.",
              storedTenantId
            );
            return res.sendStatus(200);
          }

          setStep(user, "confirming_class", {
            ...session.data,
            selectedClass: selected,
          });

          const detail = describeClassSession(selected);
          const confirmButtons = [
            { id: "class_confirm_single", title: "Reservar esta clase" },
          ];
          if (selected.seriesId) {
            confirmButtons.push({ id: "class_confirm_series", title: "Reservar toda la serie" });
          }
          confirmButtons.push(
            { id: "class_back_list", title: "Ver otras" },
            { id: "class_back_menu", title: "Menú clases" }
          );

          await sendButtons(
            user,
            {
              header: "Confirmar clase",
              body: `${detail}\n\n¿Reservamos tu lugar?`,
              buttons: confirmButtons,
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }
      }

      // ====== CONFIRMACIÓN DE SERIE ======
      if (session.step === "confirming_series") {
        const selectedSeries = session.data.selectedSeries || null;
        const customerName = session.data?.customer_name || session.data?.customerName || null;
        const features = session.data?.features || {};

        if (id === "series_back_list") {
          setStep(user, "picking_series", {
            ...session.data,
            selectedSeries: null,
          });

          const rows = buildSeriesRows(session.data.seriesList || [], session.data.seriesOffset || 0);
          await sendList(
            user,
            {
              header: "Series de clases",
              body: "Elegí una serie:",
              buttonText: "Ver series",
              rows,
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (id === "series_view_classes") {
          const classes = selectedSeries?.sessions || [];
          if (!classes.length) {
            await sendWhatsAppText(
              user,
              "No encontré clases próximas para esta serie. Probá con otra.",
              storedTenantId
            );
            return res.sendStatus(200);
          }

          setStep(user, "picking_class", {
            ...session.data,
            classes,
            classOffset: 0,
            selectedSeries,
          });

          const rows = buildClassRows(classes, 0, { showBackToSeries: true });
          await sendList(
            user,
            {
              header: "Clases individuales",
              body: "Elegí una opción:",
              buttonText: "Ver clases",
              rows,
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (id === "series_enroll") {
          if (!selectedSeries?.id) {
            await sendWhatsAppText(
              user,
              "No pude identificar la serie. Probá nuevamente.",
              storedTenantId
            );
            return res.sendStatus(200);
          }

          const enroll = await enrollCustomerToClassSeries({
            tenantId: storedTenantId,
            seriesId: selectedSeries.id,
            startingSessionId: selectedSeries.sessions?.[0]?.id || null,
            phone: user,
            name: customerName,
          });

          if (!enroll.ok) {
            await sendWhatsAppText(
              user,
              `❌ No pudimos inscribirte en la serie: ${enroll.error}`,
              storedTenantId
            );
            const rows = buildSeriesRows(session.data.seriesList || [], session.data.seriesOffset || 0);
            await sendList(
              user,
              {
                header: "Series de clases",
                body: "Elegí otra serie:",
                buttonText: "Ver series",
                rows,
              },
              storedTenantId
            );
            return res.sendStatus(200);
          }

          const label = selectedSeries.templateName || selectedSeries.activityType || "Serie";
          const summaryLines = [
            `✅ *Serie reservada*`,
            ``,
            `Clase: ${label}`,
            `Total de clases: ${enroll.enrollments.length}`,
          ];

          const scheduleLines = enroll.enrollments
            .map((item) => {
              const d = item.startsAt ? new Date(item.startsAt) : null;
              if (!d || Number.isNaN(d.getTime())) return null;
              const fecha = d.toLocaleDateString("es-AR", {
                weekday: "short",
                day: "2-digit",
                month: "2-digit",
              });
              const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
              return `• ${fecha} ${hora}`;
            })
            .filter(Boolean);

          if (scheduleLines.length) {
            summaryLines.push(...scheduleLines);
          }
          summaryLines.push("", "¡Te esperamos! 💪");

          await sendWhatsAppText(user, summaryLines.filter(Boolean).join("\n"), storedTenantId);

          setStep(user, "home_menu", {
            ...session.data,
            selectedSeries: null,
            classes: [],
            seriesList: session.data.seriesList,
          });

          await sendHomeMenu(user, storedTenantId, { name: customerName, features });
          return res.sendStatus(200);
        }

        if (id === "class_back_menu") {
          setStep(user, "class_menu", {
            ...session.data,
            selectedSeries: null,
          });
          await sendButtons(
            user,
            {
              header: "Clases grupales",
              body: "¿Qué querés hacer?",
              buttons: [
                { id: "class_browse", title: "Buscar" },
                { id: "class_my", title: "Mis clases" },
                { id: "class_back_home", title: "Volver" },
              ],
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }
      }

      // ====== CONFIRMACIÓN DE CLASE ======
      if (session.step === "confirming_class") {
        const selected = session.data.selectedClass || null;
        const features = session.data?.features || {};
        const customerName = session.data?.customer_name || session.data?.customerName || null;

        if (id === "class_back_list") {
          setStep(user, "picking_class", {
            ...session.data,
            selectedClass: null,
          });

          const rows = buildClassRows(session.data.classes || [], session.data.classOffset || 0, {
            showBackToSeries: Boolean(session.data.selectedSeries),
          });
          await sendList(
            user,
            {
              header: "Clases disponibles",
              body: "Elegí una opción:",
              buttonText: "Ver clases",
              rows,
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (id === "class_back_menu") {
          setStep(user, "class_menu", {
            ...session.data,
            selectedClass: null,
          });
          await sendButtons(
            user,
            {
              header: "Clases grupales",
              body: "¿Qué querés hacer?",
              buttons: [
                { id: "class_browse", title: "Buscar" },
                { id: "class_my", title: "Mis clases" },
                { id: "class_back_home", title: "Volver" },
              ],
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        if (id === "class_confirm_single") {
          if (!selected?.id) {
            await sendWhatsAppText(
              user,
              "No pude validar la clase seleccionada. Intentá nuevamente.",
              storedTenantId
            );
            return res.sendStatus(200);
          }

          const enroll = await enrollCustomerToClassSession({
            tenantId: storedTenantId,
            sessionId: selected.id,
            phone: user,
            name: customerName,
          });

          if (!enroll.ok) {
            await sendWhatsAppText(
              user,
              `❌ No pudimos inscribirte: ${enroll.error}`,
              storedTenantId
            );
            const rows = buildClassRows(session.data.classes || [], session.data.classOffset || 0, {
              showBackToSeries: Boolean(session.data.selectedSeries),
            });
            await sendList(
              user,
              {
                header: "Clases disponibles",
                body: "Elegí otra opción:",
                buttonText: "Ver clases",
                rows,
              },
              storedTenantId
            );
            return res.sendStatus(200);
          }

          const detail = describeClassSession(selected);
          await sendWhatsAppText(
            user,
            `✅ *Reserva confirmada*\n\n${detail}\n\n¡Te esperamos! 💪`,
            storedTenantId
          );

          setStep(user, "home_menu", {
            ...session.data,
            selectedClass: null,
            classes: [],
            classOffset: 0,
          });

          await sendHomeMenu(user, storedTenantId, { name: customerName, features });
          return res.sendStatus(200);
        }

        if (id === "class_confirm_series") {
          if (!selected?.seriesId || !selected?.id) {
            await sendWhatsAppText(
              user,
              "No pude identificar la serie seleccionada. Probá nuevamente.",
              storedTenantId
            );
            return res.sendStatus(200);
          }

          const enroll = await enrollCustomerToClassSeries({
            tenantId: storedTenantId,
            seriesId: selected.seriesId,
            startingSessionId: selected.id,
            phone: user,
            name: customerName,
          });

          if (!enroll.ok) {
            await sendWhatsAppText(
              user,
              `❌ No pudimos inscribirte en la serie: ${enroll.error}`,
              storedTenantId
            );
            const rows = buildClassRows(session.data.classes || [], session.data.classOffset || 0, {
              showBackToSeries: Boolean(session.data.selectedSeries),
            });
            await sendList(
              user,
              {
                header: "Clases disponibles",
                body: "Elegí una opción:",
                buttonText: "Ver clases",
                rows,
              },
              storedTenantId
            );
            return res.sendStatus(200);
          }

          const label = selected.templateName || selected.activityType || "Serie";
          const lines = enroll.enrollments
            .map((item) => {
              const d = item.startsAt ? new Date(item.startsAt) : null;
              if (!d || Number.isNaN(d.getTime())) return null;
              const fecha = d.toLocaleDateString("es-AR", {
                weekday: "short",
                day: "2-digit",
                month: "2-digit",
              });
              const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
              return `• ${fecha} ${hora}`;
            })
            .filter(Boolean)
            .join("\n");

          const summaryLines = [
            `✅ *Serie reservada*`,
            ``,
            `Clase: ${label}`,
            `Total de clases: ${enroll.enrollments.length}`,
            lines,
            ``,
            `¡Te esperamos! 💪`,
          ];

          await sendWhatsAppText(user, summaryLines.filter(Boolean).join("\n"), storedTenantId);

          setStep(user, "home_menu", {
            ...session.data,
            selectedClass: null,
            classes: [],
            classOffset: 0,
          });

          await sendHomeMenu(user, storedTenantId, { name: customerName, features });
          return res.sendStatus(200);
        }
      }

      // ====== SELECCIÓN DE SERVICIO ======
      if (session.step === "picking_service") {
        if (id === "svc_page_next") {
          const newOffset = (session.data.svcOffset || 0) + 9;
          setStep(user, "picking_service", {
            ...session.data,
            svcOffset: newOffset
          });

          const rows = buildServiceRows(session.data.services, newOffset);
          await sendList(user, {
            header: "Más servicios",
            body: "Elegí uno:",
            buttonText: "Ver servicios",
            rows,
          }, storedTenantId); // ✅ Agregado tenantId
          return res.sendStatus(200);
        }

        if (id.startsWith("svc_")) {
          const serviceId = Number(id.slice(4));
          const service = session.data.services.find((s) => s.id === serviceId);

          if (!service) {
            await sendWhatsAppText(user, "Servicio no encontrado. Escribí *hola* para empezar de nuevo.", storedTenantId); // ✅ Agregado tenantId
            reset(user);
            return res.sendStatus(200);
          }

          const instructors = await listInstructors(storedTenantId);
          if (!instructors.length) {
            const tenantName = await getTenantName(storedTenantId);
            await sendWhatsAppText(user, `No hay profesionales disponibles. Contactá a ${tenantName}.`, storedTenantId);
            return res.sendStatus(200);
          }

          setStep(user, "picking_instructor", {
            service_id: serviceId,
            service_name: service.name,
            price: service.price_decimal,
            instructors,
            stfOffset: 0,
            tenantId: storedTenantId,
            branch_id: session.data?.branch_id || null,
          });

          const botConfig = await getBotConfig(storedTenantId);
          const rows = buildInstructorRows(instructors, 0);
          await sendList(user, {
            header: `${service.name} - Elegí tu profesional`,
            body: botConfig.instructorSelectionBody || "¿Con quién preferís?",
            buttonText: "Ver profesionales",
            rows,
          }, storedTenantId);
          return res.sendStatus(200);
        }
      }

      // ====== SELECCIÓN DE ESTILISTA ======
      if (session.step === "picking_instructor") {
        if (id === "stf_page_next") {
          const newOffset = (session.data.stfOffset || 0) + 9;
          setStep(user, "picking_instructor", {
            ...session.data,
            stfOffset: newOffset
          });

          const rows = buildInstructorRows(session.data.instructors, newOffset);
          await sendList(user, {
            header: "Más profesionales",
            body: "¿Con quién preferís?",
            buttonText: "Ver profesionales",
            rows,
          }, storedTenantId); // ✅ Agregado tenantId
          return res.sendStatus(200);
        }

        if (id.startsWith("stf_")) {
          const instructorId = Number(id.slice(4));
          const instructor = session.data.instructors.find((s) => s.id === instructorId);

          if (!instructor) {
            await sendWhatsAppText(user, "Profesional no encontrado/a. Escribí *hola* para empezar de nuevo.", storedTenantId); // ✅ Agregado tenantId
            reset(user);
            return res.sendStatus(200);
          }

          setStep(user, "picking_date", {
            ...session.data,
            instructor_id: instructorId,
            instructor_name: instructor.name,
          });

          await sendWhatsAppText(
            user,
            `Perfecto! Elegiste *${session.data.service_name}* con *${instructor.name}*.\n\n` +
            `Ahora decime *qué día* querés el turno:\n` +
            `• *hoy*\n` +
            `• *mañana*\n` +
            `• o escribí la fecha (ej: *15/12*)`,
            storedTenantId // ✅ Agregado tenantId
          );
          return res.sendStatus(200);
        }
      }

      // ====== SELECCIÓN DE HORARIO ======
      if (session.step === "picking_slot") {
        if (id === "slot_page_next") {
          const newOffset = (session.data.slotOffset || 0) + 9;
          setStep(user, "picking_slot", {
            ...session.data,
            slotOffset: newOffset
          });

          const rows = buildSlotRows(session.data.slots, session.data.day, newOffset);
          await sendList(user, {
            header: "Más horarios",
            body: `Elegí una hora el ${session.data.day}:`,
            buttonText: "Ver horarios",
            rows,
          }, storedTenantId); // ✅ Agregado tenantId
          return res.sendStatus(200);
        }

        if (id.startsWith("slot_")) {
          const [, day, hhmm] = id.match(/slot_(.+?)_(.+)/) || [];
          if (!hhmm) {
            await sendWhatsAppText(user, "Horario inválido. Probá de nuevo.", storedTenantId); // ✅ Agregado tenantId
            return res.sendStatus(200);
          }

          const startsAtLocal = `${day} ${hhmm}:00`;

          // Validación de fecha/hora
          try {
            validateAppointmentDate(startsAtLocal);
          } catch (err) {
            await sendWhatsAppText(user, `⚠️ ${err.message}\nElegí otro horario.`, storedTenantId); // ✅ Agregado tenantId
            return res.sendStatus(200);
          }

          // ✅ Reservar turno con tenant correcto
          try {
            // Verificar si el cliente está exento de seña
            const [[customerRow]] = await pool.query(`
              SELECT exempt_deposit 
              FROM customer 
              WHERE tenant_id = ? AND phone_e164 = ?
              LIMIT 1
            `, [storedTenantId, user]);
            
            const isExemptDeposit = customerRow?.exempt_deposit === 1 || customerRow?.exempt_deposit === true;
            
            // Obtener configuración de seña (payments.*)
            const [[requireDepositRow]] = await pool.query(`
              SELECT config_value 
              FROM system_config 
              WHERE tenant_id = ? AND config_key = 'payments.require_deposit'
            `, [storedTenantId]);
            
            const requireDeposit = requireDepositRow?.config_value === '1' || requireDepositRow?.config_value === 'true';
            
            const price = Number(session.data.price || 0);
            let depositAmount = 0;
            let depositPct = null; // ✅ Declarar fuera del bloque para que esté disponible más abajo
            
            if (requireDeposit && !isExemptDeposit) {
              const [[modeRow]] = await pool.query(`
                SELECT config_value 
                FROM system_config 
                WHERE tenant_id = ? AND config_key = 'payments.deposit_mode'
              `, [storedTenantId]);
              const depositMode = modeRow?.config_value || 'percent';
              
              if (depositMode === 'fixed') {
                const [[fixedRow]] = await pool.query(`
                  SELECT config_value 
                  FROM system_config 
                  WHERE tenant_id = ? AND config_key = 'payments.deposit_fixed'
                `, [storedTenantId]);
                depositAmount = Number(fixedRow?.config_value || 0);
              } else {
                depositPct = await cfgNumber("payments.deposit_percent", 20, storedTenantId);
                depositAmount = Math.round((price * depositPct) / 100);
              }
            }

            const result = await _bookWithDeposit(
              user,
              session.data.instructor_id,
              session.data.service_id,
              startsAtLocal,
              depositAmount,
              storedTenantId,
              session.data?.branch_id || null // Pasar branchId de la sesión
            );

            if (!result.ok) {
              throw new Error(result.error || "Error al reservar");
            }

            const appointmentId = result.id;
            const requiresDeposit = result.deposit?.required;

            // Mensaje de confirmación
            const d = new Date(startsAtLocal.replace(" ", "T"));
            const fecha = d.toLocaleDateString("es-AR", {
              weekday: "short",
              day: "2-digit",
              month: "2-digit"
            });
            const hora = d.toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit"
            });

            let msg = `✅ *Turno reservado*\n\n` +
              `• Servicio: *${session.data.service_name}*\n` +
              `• Profesional: *${session.data.instructor_name}*\n` +
              `• Fecha: *${fecha} ${hora}*\n` +
              `• Precio: *$${price.toFixed(2)}*\n\n`;

            if (requiresDeposit) {
              const holdMin = await cfgNumber("deposit.holdMinutes", 30, storedTenantId);

              try {
                const payLink = await createDepositPaymentLink({
                  tenantId: storedTenantId,          // <- obligatorio
                  appointmentId,
                  amount: depositAmount,
                  title: `Seña - ${session.data.service_name}`,
                  holdMinutes: holdMin,
                });

                // Construir mensaje: mostrar porcentaje solo si está disponible (modo percent)
                const depositInfo = depositPct != null 
                  ? `⚠️ *Seña requerida: $${depositAmount.toFixed(2)}* (${depositPct}% del servicio)\n`
                  : `⚠️ *Seña requerida: $${depositAmount.toFixed(2)}*\n`;
                
                // Sanitizar el link para evitar espacios o saltos de línea
                const payLinkClean = String(payLink).trim().replace(/\s+/g, "");
                msg += depositInfo +
                  `El turno queda *reservado por ${holdMin} minutos*.\n\n` +
                  `*Pagá acá:* ${payLinkClean}\n\n` +
                  `Una vez acreditado el pago, tu turno queda confirmado 💪`;
              } catch (payErr) {
                console.error("[WA] Error generando link de pago:", payErr);
                const tenantName = await getTenantName(storedTenantId);
                msg += `⚠️ *Seña requerida: $${depositAmount.toFixed(2)}*\n` +
                  `Contactá a ${tenantName} para confirmar el pago.`;
              }
            } else {
              msg += `Tu turno está *confirmado* ✨\n¡Te esperamos! 💈`;
            }

            await sendWhatsAppText(user, msg, storedTenantId); // ✅ Agregado tenantId
            
            // Si estaba en modo waiting_for_agent, notificar al agente que la conversación terminó
            const currentSession = getSession(user);
            if (currentSession.step === "waiting_for_agent" && currentSession.data?.supportAgentPhone) {
              const supportAgentPhone = currentSession.data.supportAgentPhone;
              const customerName = currentSession.data?.customerName || "Cliente";
              try {
                await sendWhatsAppText(
                  supportAgentPhone,
                  `✅ *Turno confirmado - Conversación finalizada*\n\n` +
                  `El cliente ${customerName} (${user}) ha confirmado un turno y la conversación ha finalizado.\n\n` +
                  `Ya no recibirás más mensajes de este cliente.`,
                  storedTenantId
                );
              } catch (error) {
                console.error(`[WA Support] Error notificando al agente sobre confirmación de turno:`, error);
              }
              
              // Limpiar registros de notificaciones para evitar reactivar modo agente
              clearNotificationRecords(user, storedTenantId);
            }
            
            reset(user);
            return res.sendStatus(200);

          } catch (bookErr) {
            console.error("[WA] Error al reservar:", bookErr);
            await sendWhatsAppText(
              user,
              `❌ No se pudo reservar: ${bookErr.message}\n\nProbá con otro horario o escribí *hola* para empezar de nuevo.`,
              storedTenantId // ✅ Agregado tenantId
            );
            return res.sendStatus(200);
          }
        }
      }

      // ====== VER TURNOS / CANCELAR TURNO ======
      if (session.step === "viewing_appointments") {
        if (id === "apt_page_next") {
          const newOffset = (session.data.aptOffset || 0) + 9;
          setStep(user, "viewing_appointments", {
            ...session.data,
            aptOffset: newOffset
          });

          const rows = buildAppointmentRows(session.data.appointments, newOffset);
          await sendList(user, {
            header: "Más turnos",
            body: "Elegí un turno:",
            buttonText: "Ver turnos",
            rows,
          }, storedTenantId);
          return res.sendStatus(200);
        }

        if (id.startsWith("apt_")) {
          const appointmentId = Number(id.slice(4));
          const appointment = session.data.appointments.find((a) => a.id === appointmentId);

          if (!appointment) {
            await sendWhatsAppText(user, "Turno no encontrado. Escribí *hola* para empezar de nuevo.", storedTenantId);
            reset(user);
            return res.sendStatus(200);
          }

          // Verificar que el turno no esté cancelado o en el pasado
          const aptDate = new Date(appointment.starts_at);
          const now = new Date();
          if (aptDate < now) {
            await sendWhatsAppText(user, "No podés cancelar un turno que ya pasó.", storedTenantId);
            await sendHomeMenu(user, storedTenantId, {
              name: session.data.customer_name,
              features: session.data.features,
            });
            reset(user);
            return res.sendStatus(200);
          }

          if (appointment.status === "cancelled") {
            await sendWhatsAppText(user, "Este turno ya está cancelado.", storedTenantId);
            await sendHomeMenu(user, storedTenantId, {
              name: session.data.customer_name,
              features: session.data.features,
            });
            reset(user);
            return res.sendStatus(200);
          }

          // Guardar turno seleccionado y mostrar menú de opciones
          setStep(user, "appointment_options", {
            appointment_id: appointmentId,
            appointment: appointment,
            tenantId: storedTenantId,
            customer_name: session.data.customer_name,
            customerId: session.data.customerId,
            features: session.data.features,
          });

          const d = new Date(appointment.starts_at);
          const fecha = d.toLocaleDateString("es-AR", {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            timeZone: TIME_ZONE,
          });
          const hora = d.toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: TIME_ZONE,
          });

          await sendWhatsAppText(
            user,
            `Turno seleccionado:\n\n` +
            `• Servicio: ${appointment.service_name}\n` +
            `• Profesional: ${appointment.instructor_name}\n` +
            `• Fecha: ${fecha}\n` +
            `• Hora: ${hora}\n\n` +
            `¿Qué querés hacer con este turno?`,
            storedTenantId
          );

          await sendButtons(
            user,
            {
              header: "Opciones del turno",
              body: "Elegí una opción:",
              buttons: [
                { id: "apt_alert", title: "Avisar inconveniente" },
                { id: "apt_cancel", title: "Cancelar turno" },
                { id: "apt_back", title: "Volver" },
              ],
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }
      }

      // ====== MENÚ DE OPCIONES DEL TURNO ======
      if (session.step === "appointment_options") {
        const storedTenantId = session.data.tenantId || tenantId;
        const appointment = session.data.appointment;

        // Volver a la lista de turnos
        if (id === "apt_back") {
          const myApts = await listUpcomingAppointmentsByPhone(user, {
            limit: 10,
            tenantId: storedTenantId
          });

          if (myApts.length) {
            setStep(user, "viewing_appointments", {
              appointments: myApts,
              aptOffset: 0,
              tenantId: storedTenantId,
              customer_name: session.data.customer_name,
              customerId: session.data.customerId,
              features: session.data.features,
            });

            const rows = buildAppointmentRows(myApts, 0);
            await sendList(user, {
              header: "Tus próximos turnos",
              body: "Elegí un turno para ver opciones:",
              buttonText: "Ver turnos",
              rows,
            }, storedTenantId);
          } else {
            await sendWhatsAppText(user, "No tenés turnos próximos.", storedTenantId);
            await sendHomeMenu(user, storedTenantId, {
              name: session.data.customer_name,
              features: session.data.features,
            });
            reset(user);
          }
          return res.sendStatus(200);
        }

        // Cancelar turno - ir al flujo de cancelación
        if (id === "apt_cancel") {
          setStep(user, "canceling_appointment", {
            appointment_id: session.data.appointment_id,
            appointment: appointment,
            tenantId: storedTenantId,
            customer_name: session.data.customer_name,
            customerId: session.data.customerId,
            features: session.data.features,
          });

          await sendButtons(
            user,
            {
              header: "Cancelar turno",
              body: "¿Confirmás que querés cancelar este turno?",
              buttons: [
                { id: "cancel_confirm", title: "Sí, cancelar" },
                { id: "cancel_back", title: "Volver" },
              ],
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        // Avisar inconveniente - mostrar tipos de aviso
        if (id === "apt_alert") {
          setStep(user, "appointment_alert_type", {
            appointment_id: session.data.appointment_id,
            appointment: appointment,
            tenantId: storedTenantId,
            customer_name: session.data.customer_name,
            customerId: session.data.customerId,
            features: session.data.features,
          });

          await sendList(user, {
            header: "Tipo de aviso",
            body: "¿Qué querés avisar sobre tu turno?",
            buttonText: "Ver opciones",
            rows: [
              { id: "alert_late", title: "Voy a llegar tarde", description: "Indicar minutos de demora" },
              { id: "alert_cannot", title: "No puedo asistir", description: "Avisar que no podés ir" },
              { id: "alert_other", title: "Otro motivo", description: "Escribir un mensaje" },
              { id: "alert_back", title: "Volver", description: "Volver al menú anterior" },
            ],
          }, storedTenantId);
          return res.sendStatus(200);
        }
      }

      // ====== TIPO DE AVISO DEL TURNO ======
      if (session.step === "appointment_alert_type") {
        const storedTenantId = session.data.tenantId || tenantId;
        const appointment = session.data.appointment;

        // Volver al menú de opciones del turno
        if (id === "alert_back") {
          setStep(user, "appointment_options", {
            appointment_id: session.data.appointment_id,
            appointment: appointment,
            tenantId: storedTenantId,
            customer_name: session.data.customer_name,
            customerId: session.data.customerId,
            features: session.data.features,
          });

          const d = new Date(appointment.starts_at);
          const fecha = d.toLocaleDateString("es-AR", {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            timeZone: TIME_ZONE,
          });
          const hora = d.toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: TIME_ZONE,
          });

          await sendWhatsAppText(
            user,
            `Turno seleccionado:\n\n` +
            `• Servicio: ${appointment.service_name}\n` +
            `• Profesional: ${appointment.instructor_name}\n` +
            `• Fecha: ${fecha}\n` +
            `• Hora: ${hora}\n\n` +
            `¿Qué querés hacer con este turno?`,
            storedTenantId
          );

          await sendButtons(
            user,
            {
              header: "Opciones del turno",
              body: "Elegí una opción:",
              buttons: [
                { id: "apt_alert", title: "Avisar inconveniente" },
                { id: "apt_cancel", title: "Cancelar turno" },
                { id: "apt_back", title: "Volver" },
              ],
            },
            storedTenantId
          );
          return res.sendStatus(200);
        }

        // Llegada tarde - pedir minutos de demora
        if (id === "alert_late") {
          setStep(user, "appointment_alert_late", {
            appointment_id: session.data.appointment_id,
            appointment: appointment,
            tenantId: storedTenantId,
            customer_name: session.data.customer_name,
            customerId: session.data.customerId,
            features: session.data.features,
            alert_type: "late",
          });

          await sendWhatsAppText(
            user,
            `⏰ *Llegada tarde*\n\n` +
            `¿Cuántos minutos de demora estimás?\n\n` +
            `Escribí solo el número (ej: 15, 30, 45)`,
            storedTenantId
          );
          return res.sendStatus(200);
        }

        // No puede asistir
        if (id === "alert_cannot") {
          setStep(user, "appointment_alert_cannot", {
            appointment_id: session.data.appointment_id,
            appointment: appointment,
            tenantId: storedTenantId,
            customer_name: session.data.customer_name,
            customerId: session.data.customerId,
            features: session.data.features,
            alert_type: "cannot_attend",
          });

          await sendWhatsAppText(
            user,
            `😔 *No podés asistir*\n\n` +
            `Lamentamos que no puedas venir. ¿Querés dejar un mensaje o motivo? (opcional)\n\n` +
            `Escribí tu mensaje o escribí *enviar* para avisar sin mensaje.`,
            storedTenantId
          );
          return res.sendStatus(200);
        }

        // Otro motivo
        if (id === "alert_other") {
          setStep(user, "appointment_alert_other", {
            appointment_id: session.data.appointment_id,
            appointment: appointment,
            tenantId: storedTenantId,
            customer_name: session.data.customer_name,
            customerId: session.data.customerId,
            features: session.data.features,
            alert_type: "other",
          });

          await sendWhatsAppText(
            user,
            `📝 *Otro motivo*\n\n` +
            `Escribí el mensaje que querés enviar al negocio sobre tu turno:`,
            storedTenantId
          );
          return res.sendStatus(200);
        }
      }

      // ====== CAPTURA DE MINUTOS DE DEMORA ======
      if (session.step === "appointment_alert_late" && msg.type === "text") {
        const storedTenantId = session.data.tenantId || tenantId;
        const appointment = session.data.appointment;
        const text = (msg.text?.body || "").trim();
        
        // Extraer número de minutos
        const minutes = parseInt(text.replace(/\D/g, ""), 10);
        
        if (isNaN(minutes) || minutes <= 0 || minutes > 180) {
          await sendWhatsAppText(
            user,
            `Por favor, ingresá un número válido de minutos (entre 1 y 180).\n\nEjemplo: 15`,
            storedTenantId
          );
          return res.sendStatus(200);
        }

        // Enviar aviso al negocio
        await sendAppointmentAlert({
          user,
          tenantId: storedTenantId,
          appointment,
          customerId: session.data.customerId,
          customerName: session.data.customer_name,
          alertType: "late",
          message: `Voy a llegar ${minutes} minutos tarde`,
          delayMinutes: minutes,
        });

        await sendWhatsAppText(
          user,
          `✅ *Aviso enviado*\n\n` +
          `Le avisamos al negocio que vas a llegar ${minutes} minutos tarde.\n\n` +
          `¡Gracias por avisar! Te esperamos.`,
          storedTenantId
        );

        // Volver al menú principal
        await sendHomeMenu(user, storedTenantId, {
          name: session.data.customer_name,
          features: session.data.features,
        });
        reset(user);
        return res.sendStatus(200);
      }

      // ====== CAPTURA DE MENSAJE "NO PUEDO ASISTIR" ======
      if (session.step === "appointment_alert_cannot" && msg.type === "text") {
        const storedTenantId = session.data.tenantId || tenantId;
        const appointment = session.data.appointment;
        const text = (msg.text?.body || "").trim();
        
        const message = text.toLowerCase() === "enviar" ? "" : text;

        // Enviar aviso al negocio
        await sendAppointmentAlert({
          user,
          tenantId: storedTenantId,
          appointment,
          customerId: session.data.customerId,
          customerName: session.data.customer_name,
          alertType: "cannot_attend",
          message: message || "No puedo asistir al turno",
          delayMinutes: null,
        });

        await sendWhatsAppText(
          user,
          `✅ *Aviso enviado*\n\n` +
          `Le avisamos al negocio que no podés asistir a tu turno.\n\n` +
          `Si querés reprogramar, podés reservar un nuevo turno desde el menú principal.`,
          storedTenantId
        );

        // Volver al menú principal
        await sendHomeMenu(user, storedTenantId, {
          name: session.data.customer_name,
          features: session.data.features,
        });
        reset(user);
        return res.sendStatus(200);
      }

      // ====== CAPTURA DE MENSAJE "OTRO MOTIVO" ======
      if (session.step === "appointment_alert_other" && msg.type === "text") {
        const storedTenantId = session.data.tenantId || tenantId;
        const appointment = session.data.appointment;
        const text = (msg.text?.body || "").trim();
        
        if (!text || text.length < 3) {
          await sendWhatsAppText(
            user,
            `Por favor, escribí un mensaje más detallado (mínimo 3 caracteres).`,
            storedTenantId
          );
          return res.sendStatus(200);
        }

        // Enviar aviso al negocio
        await sendAppointmentAlert({
          user,
          tenantId: storedTenantId,
          appointment,
          customerId: session.data.customerId,
          customerName: session.data.customer_name,
          alertType: "other",
          message: text,
          delayMinutes: null,
        });

        await sendWhatsAppText(
          user,
          `✅ *Aviso enviado*\n\n` +
          `Tu mensaje fue enviado al negocio.\n\n` +
          `¡Gracias por comunicarte!`,
          storedTenantId
        );

        // Volver al menú principal
        await sendHomeMenu(user, storedTenantId, {
          name: session.data.customer_name,
          features: session.data.features,
        });
        reset(user);
        return res.sendStatus(200);
      }

      // ====== CONFIRMACIÓN DE CANCELACIÓN ======
      if (session.step === "canceling_appointment") {
        if (id === "cancel_back") {
          // Volver a la lista de turnos
          setStep(user, "viewing_appointments", {
            appointments: session.data.appointment ? [session.data.appointment] : [],
            aptOffset: 0,
            tenantId: session.data.tenantId,
            customer_name: session.data.customer_name,
            features: session.data.features,
          });

          // Recargar lista de turnos
          const myApts = await listUpcomingAppointmentsByPhone(user, {
            limit: 10,
            tenantId: session.data.tenantId
          });

          if (myApts.length) {
            setStep(user, "viewing_appointments", {
              appointments: myApts,
              aptOffset: 0,
              tenantId: session.data.tenantId,
              customer_name: session.data.customer_name,
              features: session.data.features,
            });

            const rows = buildAppointmentRows(myApts, 0);
            await sendList(user, {
              header: "Tus próximos turnos",
              body: "Elegí un turno para ver opciones:",
              buttonText: "Ver turnos",
              rows,
            }, session.data.tenantId);
          } else {
            await sendWhatsAppText(user, "No tenés turnos próximos.", session.data.tenantId);
            await sendHomeMenu(user, session.data.tenantId, {
              name: session.data.customer_name,
              features: session.data.features,
            });
            reset(user);
          }
          return res.sendStatus(200);
        }

        if (id === "cancel_confirm") {
          const appointmentId = session.data.appointment_id;
          const storedTenantId = session.data.tenantId || tenantId;

          try {
            // Obtener información completa del turno y pago
            const [[appointment]] = await pool.query(
              `SELECT 
                a.id, 
                a.status, 
                a.starts_at, 
                a.customer_id,
                a.deposit_decimal,
                a.deposit_paid_at
               FROM appointment a
               WHERE a.id = ? AND a.tenant_id = ?`,
              [appointmentId, storedTenantId]
            );

            if (!appointment) {
              throw new Error("Turno no encontrado");
            }

            if (appointment.status === "cancelled") {
              await sendWhatsAppText(user, "Este turno ya está cancelado.", storedTenantId);
              await sendHomeMenu(user, storedTenantId, {
                name: session.data.customer_name,
                features: session.data.features,
              });
              reset(user);
              return res.sendStatus(200);
            }

            // Verificar si hay pago de seña
            // Primero intentar con mp_payment_status, si falla usar alternativa
            let payment = null;
            try {
              const [[paymentRow]] = await pool.query(
                `SELECT 
                  mp_payment_id, 
                  amount_cents, 
                  mp_payment_status
                 FROM payment 
                 WHERE appointment_id = ? 
                   AND tenant_id = ? 
                   AND method = 'mercadopago'
                   AND mp_payment_status = 'approved'
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [appointmentId, storedTenantId]
              );
              payment = paymentRow;
            } catch (statusError) {
              // Si la columna mp_payment_status no existe, intentar sin esa condición
              if (statusError.message && statusError.message.includes('mp_payment_status')) {
                console.warn("[WA] Columna mp_payment_status no encontrada, usando consulta alternativa");
                const [[paymentRow]] = await pool.query(
                  `SELECT 
                    mp_payment_id, 
                    amount_cents
                   FROM payment 
                   WHERE appointment_id = ? 
                     AND tenant_id = ? 
                     AND method = 'mercadopago'
                   ORDER BY created_at DESC
                   LIMIT 1`,
                  [appointmentId, storedTenantId]
                );
                payment = paymentRow;
                // Asumir que si existe el pago y hay deposit_paid_at, está aprobado
                if (payment && appointment.deposit_paid_at) {
                  payment.mp_payment_status = 'approved';
                }
              } else {
                throw statusError;
              }
            }

            const hasPaidDeposit = payment && appointment.deposit_paid_at;
            let refundProcessed = false;
            let refundMessage = "";

            // Calcular tiempo hasta el turno
            const appointmentDate = new Date(appointment.starts_at);
            const now = new Date();
            const hoursUntilAppointment = (appointmentDate.getTime() - now.getTime()) / (1000 * 60 * 60);

            // Si hay seña pagada y pasaron más de 24 horas, procesar reembolso
            if (hasPaidDeposit && hoursUntilAppointment >= 24) {
              try {
                const depositAmount = Number(appointment.deposit_decimal || 0);
                if (depositAmount > 0 && payment.mp_payment_id) {
                  await refundPayment(payment.mp_payment_id, storedTenantId, depositAmount);
                  refundProcessed = true;
                  refundMessage = `\n💰 *Seña reembolsada:* Se devolvió $${depositAmount.toFixed(2)} a tu cuenta porque cancelaste con más de 24 horas de anticipación.`;
                  
                  // Actualizar estado del pago (si la columna existe)
                  try {
                    await pool.query(
                      `UPDATE payment 
                       SET mp_payment_status = 'refunded', updated_at = NOW()
                       WHERE mp_payment_id = ? AND tenant_id = ?`,
                      [payment.mp_payment_id, storedTenantId]
                    );
                  } catch (updateError) {
                    // Si la columna no existe, solo actualizar updated_at
                    if (updateError.message && updateError.message.includes('mp_payment_status')) {
                      await pool.query(
                        `UPDATE payment 
                         SET updated_at = NOW()
                         WHERE mp_payment_id = ? AND tenant_id = ?`,
                        [payment.mp_payment_id, storedTenantId]
                      );
                    } else {
                      throw updateError;
                    }
                  }
                }
              } catch (refundError) {
                console.error("[WA] Error procesando reembolso:", refundError);
                refundMessage = `\n⚠️ No se pudo procesar el reembolso automático. Contactá al negocio para gestionar la devolución de la seña.`;
              }
            } else if (hasPaidDeposit && hoursUntilAppointment < 24) {
              // Cancelación con menos de 24 horas: se retiene la seña
              refundMessage = `\n💰 *Seña retenida:* Como cancelaste con menos de 24 horas de anticipación, la seña de $${Number(appointment.deposit_decimal || 0).toFixed(2)} se retiene según nuestra política de cancelación.`;
            }

            // Actualizar status a cancelled
            await pool.query(
              `UPDATE appointment 
               SET status = 'cancelled', hold_until = NULL 
               WHERE id = ? AND tenant_id = ?`,
              [appointmentId, storedTenantId]
            );

            const d = new Date(appointment.starts_at);
            const fecha = d.toLocaleDateString("es-AR", {
              weekday: "short",
              day: "2-digit",
              month: "2-digit",
              timeZone: TIME_ZONE,
            });
            const hora = d.toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: TIME_ZONE,
            });

            await sendWhatsAppText(
              user,
              `✅ Turno cancelado correctamente\n\n` +
              `El turno del ${fecha} a las ${hora} ha sido cancelado.${refundMessage}\n\n` +
              `Si querés reservar otro horario, escribí *hola* para empezar.`,
              storedTenantId
            );

            // Establecer estado a home_menu en lugar de resetear, para que el usuario pueda continuar
            setStep(user, "home_menu", {
              hasApts: true,
              customer_name: session.data.customer_name,
              tenantId: storedTenantId,
              features: session.data.features || {},
            });

            await sendHomeMenu(user, storedTenantId, {
              name: session.data.customer_name,
              features: session.data.features || {},
              header: "Turno cancelado",
              body: "¿Querés hacer algo más?",
            });

            return res.sendStatus(200);
          } catch (error) {
            console.error("[WA] Error cancelando turno:", error);
            await sendWhatsAppText(
              user,
              `❌ No se pudo cancelar el turno: ${error.message}\n\nEscribí *hola* para empezar de nuevo.`,
              storedTenantId
            );
            reset(user);
            return res.sendStatus(200);
          }
        }
      }

      // Fallback
      await sendWhatsAppText(user, "No entendí esa opción. Escribí *hola* para empezar.", storedTenantId); // ✅ Agregado tenantId
      return res.sendStatus(200);
    }

    // Tipo de mensaje no soportado
    console.log(`[WA] Tipo de mensaje no soportado: ${msg.type}`);
    await sendWhatsAppText(user, "Mandame texto o usá las opciones del menú 😉", tenantId); // ✅ Agregado tenantId
    return res.sendStatus(200);

  } catch (e) {
    // Manejar error específico: número no en lista de permitidos (modo desarrollo)
    if (e.message && e.message.includes("131030") || e.code === 131030) {
      const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      const phoneNumber = msg?.from || "unknown";
      
      console.error("[WA webhook] ⚠️ Error 131030: Número no en lista de permitidos:", {
        phoneNumber,
        errorCode: 131030,
        message: "El número del destinatario no está en la lista de permitidos en Meta Business Manager.",
        solution: "Agregá el número a la lista de destinatarios permitidos en Meta Business Manager (modo desarrollo).",
      });
      
      // No es un error crítico del sistema, solo una limitación del modo desarrollo
      // Retornar 200 para que WhatsApp no reintente
      return res.sendStatus(200);
    }
    
    console.error("[WA webhook] ❌ Error:", e);
    console.error("[WA webhook] ❌ Error message:", e.message);
    console.error("[WA webhook] ❌ Error stack:", e.stack);
    
    // Intentar loguear información adicional del webhook si está disponible
    try {
      const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (msg) {
        console.error("[WA webhook] ❌ Mensaje que causó el error:", {
          from: msg.from,
          type: msg.type,
          id: msg.id,
        });
      }
    } catch (logError) {
      console.error("[WA webhook] ❌ Error al intentar loguear detalles:", logError.message);
    }
    
    // Siempre retornar 200 para que WhatsApp no reintente
    return res.sendStatus(200);
  }
};

whatsapp.post("/webhooks/whatsapp", handleWebhookPost);
whatsapp.post("/whatsapp", handleWebhookPost);

// ============================================
// GET /api/whatsapp/diagnostic - Diagnóstico del webhook
// ============================================
// POST /api/whatsapp/reprogram - Enviar mensaje de reprogramación
whatsapp.post("/reprogram", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    console.log("[WhatsApp Reprogram] Iniciando envío de mensaje de reprogramación");
    
    const tenantId = req.tenant?.id;
    const { appointmentId, phone, customText, autoCancel = false } = req.body;

    console.log("[WhatsApp Reprogram] Datos recibidos:", { appointmentId, phone, tenantId, hasCustomText: !!customText, autoCancel });

    if (!appointmentId || !phone) {
      console.error("[WhatsApp Reprogram] Faltan parámetros requeridos");
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: "appointmentId y phone son requeridos"
      });
    }

    if (!tenantId) {
      console.error("[WhatsApp Reprogram] No se pudo identificar el tenant");
      await conn.rollback();
      return res.status(401).json({
        ok: false,
        error: "No se pudo identificar el tenant"
      });
    }

    // Obtener información del turno
    const [aptRows] = await conn.query(
      `SELECT a.id, a.starts_at, a.ends_at, a.status, 
              c.name AS customer_name, s.name AS service_name
       FROM appointment a
       LEFT JOIN customer c ON a.customer_id = c.id
       LEFT JOIN service s ON a.service_id = s.id
       WHERE a.id = ? AND a.tenant_id = ?`,
      [appointmentId, tenantId]
    );

    if (aptRows.length === 0) {
      console.error("[WhatsApp Reprogram] Turno no encontrado:", appointmentId);
      await conn.rollback();
      return res.status(404).json({
        ok: false,
        error: "Turno no encontrado"
      });
    }

    const appointment = aptRows[0];
    console.log("[WhatsApp Reprogram] Turno encontrado:", { id: appointment.id, customer: appointment.customer_name, service: appointment.service_name });
    
    let cancelled = false;

    // Si autoCancel está activado, cancelar el turno
    if (autoCancel && appointment.status !== 'cancelled') {
      await conn.query(
        `UPDATE appointment SET status = 'cancelled' WHERE id = ? AND tenant_id = ?`,
        [appointmentId, tenantId]
      );
      cancelled = true;
      console.log("[WhatsApp Reprogram] Turno cancelado automáticamente");
    }

    // Enviar mensaje de WhatsApp
    const message = customText || 
      `Hola ${appointment.customer_name || 'Cliente'} 💈\n` +
      `Necesitamos *reprogramar tu turno* de ${appointment.service_name || 'servicio'}. ` +
      `¿Te viene bien este nuevo horario? 🙏`;

    const phoneE164 = phone.startsWith('+') ? phone : `+${phone}`;
    console.log("[WhatsApp Reprogram] Enviando mensaje a:", phoneE164);
    console.log("[WhatsApp Reprogram] Mensaje:", message);
    
    try {
      const result = await sendWhatsAppText(phoneE164, message, tenantId, {
        type: 'reprogram',
        appointmentId: appointmentId
      });
      
      console.log("[WhatsApp Reprogram] Mensaje enviado exitosamente:", result);
      await conn.commit();
      
      return res.json({
        ok: true,
        cancelled,
        message: "Mensaje enviado exitosamente"
      });
    } catch (whatsappError) {
      console.error("[WhatsApp Reprogram] Error enviando WhatsApp:", whatsappError);
      // Si falla el envío, aún así retornar éxito si se canceló
      if (cancelled) {
        await conn.commit();
        return res.json({
          ok: true,
          cancelled: true,
          error: "Turno cancelado pero no se pudo enviar el mensaje",
          whatsappError: whatsappError.message
        });
      }
      await conn.rollback();
      throw whatsappError;
    }
  } catch (error) {
    console.error("[WhatsApp Reprogram] Error general:", error);
    await conn.rollback();
    return res.status(500).json({
      ok: false,
      error: error.message || "Error al enviar mensaje de reprogramación"
    });
  } finally {
    conn.release();
  }
});

whatsapp.get("/diagnostic", async (req, res) => {
  try {
    const tenantId = req.query.tenant_id ? Number(req.query.tenant_id) : null;
    
    if (!tenantId && !process.env.BOT_TENANT_ID) {
      return res.status(400).json({
        ok: false,
        error: "Se requiere tenant_id como parámetro o BOT_TENANT_ID en variables de entorno",
      });
    }
    
    const targetTenantId = tenantId || Number(process.env.BOT_TENANT_ID);
    
    // Obtener configuración de WhatsApp
    const [[config]] = await pool.query(
      `SELECT 
        tenant_id,
        phone_number_id,
        phone_display,
        is_active,
        managed_by,
        whatsapp_verify_token IS NOT NULL as has_verify_token,
        whatsapp_token IS NOT NULL as has_access_token,
        created_at,
        updated_at
      FROM tenant_whatsapp_config
      WHERE tenant_id = ?
      ORDER BY is_active DESC, updated_at DESC
      LIMIT 1`,
      [targetTenantId]
    );
    
    if (!config) {
      return res.status(404).json({
        ok: false,
        error: `No se encontró configuración de WhatsApp para tenant_id=${targetTenantId}`,
        tenant_id: targetTenantId,
      });
    }
    
    // Verificar si phone_number_id es válido
    const hasValidPhoneNumberId = config.phone_number_id && 
                                   !config.phone_number_id.startsWith("pending:");
    
    // Construir respuesta de diagnóstico
    const diagnostic = {
      ok: true,
      tenant_id: targetTenantId,
      config: {
        phone_number_id: config.phone_number_id || null,
        phone_display: config.phone_display || null,
        is_active: !!config.is_active,
        managed_by: config.managed_by || null,
        has_verify_token: !!config.has_verify_token,
        has_access_token: !!config.has_access_token,
        has_valid_phone_number_id: hasValidPhoneNumberId,
        created_at: config.created_at,
        updated_at: config.updated_at,
      },
      webhook: {
        url: `${process.env.API_URL || "https://backend-production-1042.up.railway.app"}/webhooks/whatsapp`,
        url_alternativa: `${process.env.API_URL || "https://backend-production-1042.up.railway.app"}/api/webhooks/whatsapp`,
        verify_endpoint: "GET /webhooks/whatsapp o GET /api/webhooks/whatsapp",
        message_endpoint: "POST /webhooks/whatsapp o POST /api/webhooks/whatsapp",
      },
      status: {
        can_send_messages: !!config.has_access_token && hasValidPhoneNumberId && config.is_active,
        can_receive_messages: hasValidPhoneNumberId && config.is_active,
        issues: [],
      },
    };
    
    // Detectar problemas
    if (!config.is_active) {
      diagnostic.status.issues.push("⚠️ WhatsApp está inactivo (is_active = 0)");
    }
    
    if (!hasValidPhoneNumberId) {
      diagnostic.status.issues.push("❌ phone_number_id no está configurado o es inválido");
    }
    
    if (!config.has_access_token) {
      diagnostic.status.issues.push("❌ No hay access_token configurado");
    }
    
    if (!config.has_verify_token) {
      diagnostic.status.issues.push("⚠️ No hay verify_token configurado (puede causar problemas con la suscripción del webhook)");
    }
    
    if (diagnostic.status.issues.length === 0) {
      diagnostic.status.issues.push("✅ Todo parece estar configurado correctamente");
    }
    
    return res.json(diagnostic);
    
  } catch (error) {
    console.error("[WA Diagnostic] Error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// ============================================
// HELPERS INTERNOS
// ============================================

/**
 * Procesa el reembolso de un pago de Mercado Pago
 */
async function refundPayment(mpPaymentId, tenantId, amount) {
  try {
    const accessToken = await getTenantMpToken(tenantId);
    if (!accessToken) {
      throw new Error("No hay token de Mercado Pago configurado");
    }

    const response = await fetch(
      `https://api.mercadopago.com/v1/payments/${mpPaymentId}/refunds`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: amount, // Monto a reembolsar (opcional, si no se envía se reembolsa todo)
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Refund] Error en respuesta de MP:`, errorText);
      throw new Error(`Error al procesar reembolso: ${response.status}`);
    }

    const refundData = await response.json();
    console.log(`✅ [Refund] Reembolso procesado:`, {
      paymentId: mpPaymentId,
      refundId: refundData.id,
      amount: refundData.amount,
      status: refundData.status,
    });

    return refundData;
  } catch (error) {
    console.error(`❌ [Refund] Error procesando reembolso:`, error);
    throw error;
  }
}

async function _getSlots(instructorId, serviceId, date, tenantId) {
  if (!tenantId) throw new Error("tenantId requerido en _getSlots");

  const res = await getFreeSlots({
    tenantId,
    instructorId: Number(instructorId),
    serviceId: Number(serviceId),
    date
  });

  let baseSlots = Array.isArray(res) ? res : (res?.slots ?? res?.data?.slots ?? []);
  baseSlots = baseSlots.map((s) => String(s).slice(0, 5));

  const [[svc]] = await pool.query(
    "SELECT duration_min FROM service WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1",
    [Number(serviceId), tenantId]
  );

  const durMin = Number(svc?.duration_min || 0);
  if (!durMin) {
    console.warn(`[WA] Servicio ${serviceId} no encontrado o sin duración`);
    return [];
  }

  const [aptRows] = await pool.query(
    `SELECT TIME(starts_at) AS s, TIME(ends_at) AS e
     FROM appointment
     WHERE instructor_id=? AND tenant_id=?
       AND DATE(starts_at)=?
       AND status IN ('scheduled','confirmed','deposit_paid','pending_deposit')`,
    [Number(instructorId), tenantId, date]
  );

  const appts = aptRows.map((r) => ({
    start: new Date(`${date}T${String(r.s).slice(0, 5)}:00`),
    end: new Date(`${date}T${String(r.e).slice(0, 5)}:00`),
  }));

  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);

  const [offRows] = await pool.query(
    `SELECT starts_at AS s, ends_at AS e
     FROM time_off
     WHERE instructor_id=? AND tenant_id=?
       AND starts_at < ?
       AND ends_at   > ?`,
    [Number(instructorId), tenantId, dayEnd, dayStart]
  );

  const offs = offRows.map((r) => {
    const s = new Date(r.s);
    const e = new Date(r.e);
    const start = s < dayStart ? dayStart : s;
    const end = e > dayEnd ? dayEnd : e;
    return { start, end };
  });

  const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;
  const free = [];

  for (const hhmm of baseSlots) {
    const start = new Date(`${date}T${hhmm}:00`);
    const end = new Date(start.getTime() + durMin * 60000);

    const busyAppt = appts.some(({ start: s, end: e }) => overlaps(start, end, s, e));
    if (busyAppt) continue;

    const busyOff = offs.some(({ start: s, end: e }) => overlaps(start, end, s, e));
    if (busyOff) continue;

    free.push(hhmm);
  }

  return free;
}

async function _bookWithDeposit(customerPhoneE164, instructorId, serviceId, startsAtLocal, depositDecimal, tenantId, branchId = null) {
  if (!tenantId) throw new Error("tenantId requerido en _bookWithDeposit");

  return createAppointment({
    customerPhone: customerPhoneE164,
    instructorId,
    serviceId,
    startsAt: startsAtLocal,
    depositDecimal: Number(depositDecimal || 0),
    status: "pending_deposit",
    markDepositAsPaid: false,
    tenantId,
    branchId: branchId || null, // Usar branchId de la sesión si está disponible
  });
}
