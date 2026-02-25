/**
 * Configuración del Widget de Chat
 * 
 * INSTRUCCIONES:
 * 1. Reemplaza whatsappNumber con tu número de WhatsApp (formato internacional sin + ni espacios)
 *    Ejemplo para Argentina: "5491123456789" (54 = código país, 9 = código móvil, resto = número)
 * 
 * 2. Reemplaza supportEmail con tu email de soporte
 * 
 * 3. Personaliza los mensajes del bot según tus necesidades
 * 
 * 4. (Opcional) Configura horarios de atención si quieres mostrar estado online/offline
 * 
 * 5. (Opcional) Integra un servicio de chat en vivo como Tawk.to o Intercom
 */

export const chatConfig = {
  // Número de WhatsApp (formato internacional sin + ni espacios)
  // Ejemplo: "5491123456789" para Argentina
  // ⚠️ IMPORTANTE: Reemplaza con tu número real
  whatsappNumber: "5491154616161",
  
  // Email de soporte
  // ⚠️ IMPORTANTE: Reemplaza con tu email real
  supportEmail: "soporte@arjaerp.com.ar",
  
  // Mensaje predefinido para WhatsApp
  whatsappMessage: "Hola, tengo una consulta sobre ARJA ERP",
  
  // Mensajes del bot
  botMessages: {
    greeting: "¡Hola! 👋 ¿En qué puedo ayudarte?",
    defaultResponse: "Gracias por tu mensaje. Te responderé pronto. Mientras tanto, puedes contactarnos directamente por WhatsApp.",
    offline: "Estamos fuera de horario. Déjanos tu mensaje y te responderemos pronto.",
  },
  
  // Horario de atención (opcional, para mostrar estado)
  businessHours: {
    enabled: false, // Cambiar a true para activar
    timezone: "America/Argentina/Buenos_Aires",
    schedule: {
      monday: { open: "09:00", close: "18:00" },
      tuesday: { open: "09:00", close: "18:00" },
      wednesday: { open: "09:00", close: "18:00" },
      thursday: { open: "09:00", close: "18:00" },
      friday: { open: "09:00", close: "18:00" },
      saturday: { open: "09:00", close: "13:00" },
      sunday: null, // Cerrado
    },
  },
  
  // Integración con servicios de chat en vivo (opcional)
  // Puedes integrar Tawk.to, Intercom, etc.
  liveChat: {
    enabled: false,
    provider: "tawk", // "tawk" | "intercom" | "custom"
    // Si usas Tawk.to, agrega tu script aquí
    tawkPropertyId: "",
    tawkWidgetId: "",
  },
};

