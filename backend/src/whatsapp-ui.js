// src/whatsapp-ui.js - VERSIÓN MULTI-TOKEN
import { getTenantWhatsAppHub } from "./services/whatsappHub.js";
import { pool } from "./db.js";

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
    console.error(`[WA-UI] Error obteniendo nombre del tenant ${tenantId}:`, error.message);
    return "ARJA ERP";
  }
}

/**
 * ✅ Obtener configuración de WhatsApp por tenant
 */
async function getWhatsAppConfigForTenant(tenantId) {
  const config = await getTenantWhatsAppHub(tenantId);
  
  // Permitir que funcione automáticamente si hay credenciales OAuth válidas
  // El bot se activa automáticamente cuando hay credenciales OAuth, no requiere activación manual
  const hasOAuthCredentials = config && config.accessToken && config.managedBy === "user_oauth";
  const isActiveOrAutoActivated = config?.isActive || hasOAuthCredentials;
  
  if (!config || !config.hasCredentials || !isActiveOrAutoActivated) {
    throw new Error(`WhatsApp no está configurado o está inactivo para el tenant ${tenantId}`);
  }
  return {
    phone_number_id: config.phoneNumberId,
    whatsapp_token: config.accessToken,
    phone_display: config.phoneDisplay,
  };
}

/**
 * Normaliza el número para la API de WhatsApp
 * IMPORTANTE: Quita el 9 móvil de números argentinos para que coincida con Meta Business Manager
 */
function normalizeTo(to) {
  if (!to) return "";
  
  // Eliminar todos los caracteres que no sean dígitos
  let digits = String(to).replace(/\D/g, "");
  
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
 * Corta strings con sufijo "…" si supera el límite
 */
function clamp(s, max) {
  const txt = String(s ?? "");
  return txt.length <= max ? txt : txt.slice(0, Math.max(0, max - 1)) + "…";
}

/**
 * ✅ Request genérico con tenant
 */
async function sendInteractive(payload, tenantId) {
  if (!tenantId) {
    throw new Error("tenantId requerido para sendInteractive");
  }

  const config = await getWhatsAppConfigForTenant(tenantId);
  const WA_API_VERSION = process.env.WHATSAPP_API_VERSION || "v24.0";

  const url = `https://graph.facebook.com/${WA_API_VERSION}/${config.phone_number_id}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[WA] interactive ${res.status}: ${text}`);
  }
}

/**
 * ✅ Enviar lista CON TENANT
 */
export async function sendList(
  to,
  { header, body, buttonText = "Ver", rows, title = "Opciones" },
  tenantId
) {
  if (!tenantId) {
    throw new Error("tenantId requerido para sendList");
  }

  const safeRows = (rows || [])
    .slice(0, 10)
    .map((r) => ({
      id: String(r.id),
      title: clamp(r.title ?? "", 24),
      ...(r.description ? { description: clamp(r.description, 72) } : {}),
    }));

  if (safeRows.length === 0) {
    return;
  }

  const tenantName = await getTenantName(tenantId);

  const payload = {
    messaging_product: "whatsapp",
    to: normalizeTo(to),
    type: "interactive",
    interactive: {
      type: "list",
      ...(header ? { header: { type: "text", text: clamp(header, 60) } } : {}),
      body: { text: clamp(body ?? "", 1024) },
      footer: { text: clamp(tenantName, 60) },
      action: {
        button: clamp(buttonText, 20),
        sections: [
          {
            title: clamp(title, 24),
            rows: safeRows,
          },
        ],
      },
    },
  };

  return sendInteractive(payload, tenantId);
}

/**
 * ✅ Enviar botones CON TENANT
 */
export async function sendButtons(to, { header, body, buttons = [] }, tenantId) {
  if (!tenantId) {
    throw new Error("tenantId requerido para sendButtons");
  }

  const safeButtons = (buttons || []).slice(0, 3).map((b) => ({
    type: "reply",
    reply: {
      id: String(b.id),
      title: clamp(b.title ?? "", 20),
    },
  }));

  const payload = {
    messaging_product: "whatsapp",
    to: normalizeTo(to),
    type: "interactive",
    interactive: {
      type: "button",
      ...(header ? { header: { type: "text", text: clamp(header, 60) } } : {}),
      body: { text: clamp(body ?? "", 1024) },
      action: { buttons: safeButtons },
    },
  };

  return sendInteractive(payload, tenantId);
}