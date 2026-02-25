import nodemailer from "nodemailer";
import { createConnection } from "net";
import { lookup } from "dns/promises";
import sgMail from "@sendgrid/mail";

let transporter = null;
let sendGridInitialized = false;

// Función para resetear el transporter (útil para reintentos)
export function resetTransporter() {
  transporter = null;
}

// Función para verificar conectividad de red (útil para diagnóstico en producción)
async function checkNetworkConnectivity(host, port, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout }, () => {
      socket.destroy();
      resolve({ success: true, error: null });
    });

    socket.on('error', (error) => {
      socket.destroy();
      resolve({ success: false, error: error.message });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ success: false, error: 'Connection timeout' });
    });
  });
}

// Función para verificar resolución DNS
async function checkDNSResolution(host) {
  try {
    const addresses = await lookup(host);
    return { success: true, addresses: [addresses.address], error: null };
  } catch (error) {
    return { success: false, addresses: [], error: error.message };
  }
}

async function getTransporter() {
  if (transporter) return transporter;

  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM,
  } = process.env;

  if (!SMTP_HOST) {
    console.warn("[email] SMTP_HOST no configurado. Los correos se loguearán en consola.");
    return null;
  }

  // Detectar si es SendGrid
  const isSendGrid = SMTP_HOST?.toLowerCase().includes('sendgrid.net');
  
  // Detectar si estamos en producción
  const isProduction = process.env.NODE_ENV === 'production' || 
                      process.env.VERCEL || 
                      process.env.RAILWAY_ENVIRONMENT ||
                      !process.env.SMTP_HOST?.includes('localhost');

  // Detectar si estamos en Railway
  const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_NAME;

  // Para SendGrid en Railway, probar puertos en orden: 465 (SSL) > 2525 (TLS) > 587 (TLS)
  // SendGrid ofrece: 587 (TLS), 2525 (TLS alternativo), 465 (SSL)
  // Railway a menudo bloquea 587 y 2525, pero 465 (SSL) suele funcionar
  let port = Number(SMTP_PORT);
  if (!port) {
    if (isSendGrid && isRailway) {
      port = 465; // Puerto SSL de SendGrid, más confiable en Railway (no bloqueado)
      console.log(`[email] 🚀 Usando puerto SSL 465 para SendGrid en Railway (más confiable)`);
    } else if (isSendGrid) {
      port = 587; // Puerto estándar de SendGrid
    } else {
      port = 587; // Puerto por defecto
    }
  }
  
  // Puerto 465 requiere SSL (secure: true), los demás usan STARTTLS
  const secure = port === 465;

  // Detectar si es Gmail (necesario antes de usarlo)
  const isGmail = SMTP_HOST?.toLowerCase().includes('gmail.com');

  // Timeouts más largos para servidores SMTP lentos o con alta latencia
  // En producción, usar timeouts aún más largos si hay problemas de red
  const connectionTimeout = Number(process.env.SMTP_CONNECTION_TIMEOUT || (isProduction ? 90000 : 60000)); // 90s en prod, 60s en local
  const greetingTimeout = Number(process.env.SMTP_GREETING_TIMEOUT || (isProduction ? 90000 : 60000)); // 90s en prod, 60s en local
  const socketTimeout = Number(process.env.SMTP_SOCKET_TIMEOUT || (isProduction ? 180000 : 120000)); // 180s en prod, 120s en local

  console.log(`[email] Configurando SMTP: ${SMTP_HOST}:${port} (${isProduction ? 'PRODUCCIÓN' : 'LOCAL'}${isRailway ? ' [RAILWAY]' : ''}, timeouts: ${connectionTimeout}ms/${greetingTimeout}ms/${socketTimeout}ms)`);
  
  // Advertencia para Railway en planes gratuitos
  if (isRailway && isGmail) {
    console.warn(`[email] ⚠️  ADVERTENCIA: Railway bloquea conexiones SMTP salientes en planes Free/Trial/Hobby.`);
    console.warn(`[email]    Si ves errores de timeout, considera:`);
    console.warn(`[email]    1. Actualizar a Railway Pro ($20/mes) para desbloquear SMTP`);
    console.warn(`[email]    2. Usar SendGrid SMTP (funciona en planes gratuitos)`);
    console.warn(`[email]    Ver: backend/DESBLOQUEAR_SMTP_RAILWAY.md`);
  }
  
  // Información específica para SendGrid
  if (isSendGrid && isRailway) {
    console.log(`[email] ℹ️  SendGrid en Railway: usando puerto ${port} (${secure ? 'SSL' : 'TLS'})`);
    if (port !== 465) {
      console.log(`[email]    ⚠️  Si este puerto falla, Railway puede estar bloqueándolo.`);
      console.log(`[email]    💡 Prueba con: SMTP_PORT=465 (SSL, más confiable en Railway)`);
    }
  }

  // Diagnóstico de conectividad en producción (solo si está habilitado)
  if (isProduction && process.env.SMTP_CHECK_CONNECTIVITY === 'true') {
    console.log(`[email] Verificando conectividad de red a ${SMTP_HOST}:${port}...`);
    
    // Verificar DNS
    const dnsCheck = await checkDNSResolution(SMTP_HOST);
    if (dnsCheck.success) {
      console.log(`[email] ✅ DNS resuelto: ${SMTP_HOST} -> ${dnsCheck.addresses.join(', ')}`);
    } else {
      console.error(`[email] ❌ Error de DNS: ${SMTP_HOST} - ${dnsCheck.error}`);
    }
    
    // Verificar conectividad TCP
    const connCheck = await checkNetworkConnectivity(SMTP_HOST, port, 10000);
    if (connCheck.success) {
      console.log(`[email] ✅ Conectividad TCP OK: ${SMTP_HOST}:${port}`);
    } else {
      console.error(`[email] ❌ Error de conectividad TCP: ${SMTP_HOST}:${port} - ${connCheck.error}`);
      console.error(`[email] ⚠️  Posibles causas:`);
      console.error(`[email]    - Firewall bloqueando el puerto ${port}`);
      console.error(`[email]    - El servidor SMTP requiere whitelist de IP`);
      console.error(`[email]    - Problemas de red/VPN`);
    }
  }

  // Limpiar espacios de la contraseña (las contraseñas de aplicación de Gmail vienen con espacios)
  const cleanPassword = SMTP_PASS ? String(SMTP_PASS).replace(/\s/g, '') : SMTP_PASS;
  
  // Log de configuración (sin mostrar la contraseña completa por seguridad)
  if (isSendGrid) {
    console.log(`[email] Configuración SendGrid:`);
    console.log(`[email]   SMTP_USER: ${SMTP_USER} ${SMTP_USER === 'apikey' ? '✅' : '❌ (debe ser "apikey")'}`);
    console.log(`[email]   SMTP_PASS: ${SMTP_PASS ? `${SMTP_PASS.substring(0, 10)}... (${SMTP_PASS.length} caracteres)` : '❌ faltante'}`);
    console.log(`[email]   SMTP_PORT: ${port} ${port === 465 ? '✅ (SSL, recomendado para Railway)' : port === 2525 ? '✅ (alternativo TLS)' : port === 587 ? '✅ (estándar TLS)' : '⚠️'}`);
    if (SMTP_PASS && !SMTP_PASS.startsWith('SG.')) {
      console.warn(`[email]   ⚠️  El API Key debería empezar con "SG."`);
    }
  }
  
  // Configuración base del transporter
  const transporterConfig = {
    auth: SMTP_USER
      ? {
          user: SMTP_USER,
          pass: cleanPassword, // Usar contraseña sin espacios
        }
      : undefined,
    // Configuración de timeouts aumentados
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
    // Pool deshabilitado temporalmente para evitar problemas de conexión persistente
    // Si el servidor SMTP es lento, el pool puede mantener conexiones muertas
    pool: process.env.SMTP_USE_POOL === 'true',
    maxConnections: process.env.SMTP_USE_POOL === 'true' ? 5 : 1,
    maxMessages: process.env.SMTP_USE_POOL === 'true' ? 100 : 1,
    // Opciones adicionales de conexión
    tls: {
      rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
      minVersion: 'TLSv1.2',
    },
    // Opciones de debug (solo si está habilitado)
    debug: process.env.SMTP_DEBUG === 'true',
    logger: process.env.SMTP_DEBUG === 'true',
  };
  
  // Para Gmail, usar 'service' en lugar de host/port (nodemailer lo maneja mejor)
  if (isGmail) {
    transporterConfig.service = 'gmail';
    transporterConfig.requireTLS = true;
  } else {
    // Para otros proveedores, usar host y port explícitos
    transporterConfig.host = SMTP_HOST;
    transporterConfig.port = port;
    transporterConfig.secure = secure;
  }
  
  transporter = nodemailer.createTransport(transporterConfig);

  // Verificar conexión al crear el transporter
  if (process.env.SMTP_VERIFY_ON_START === 'true') {
    transporter.verify((error, success) => {
      if (error) {
        console.error('[email] Error al verificar conexión SMTP:', error.message);
      } else {
        console.log('[email] ✅ Conexión SMTP verificada correctamente');
      }
    });
  }

  return transporter;
}

// Función para inicializar SendGrid API (HTTPS, funciona en todos los planes de Railway)
function initSendGridAPI() {
  if (sendGridInitialized) return true;
  
  const { SMTP_PASS } = process.env;
  if (!SMTP_PASS) {
    console.warn('[email] ⚠️  SMTP_PASS no configurado. SendGrid API no disponible.');
    return false;
  }
  
  // Verificar que SMTP_PASS parece ser una API key de SendGrid (empieza con SG. o es una key válida)
  // Las API keys de SendGrid pueden empezar con SG. o tener otros formatos
  const looksLikeSendGridKey = SMTP_PASS.startsWith('SG.') || 
                                SMTP_PASS.startsWith('SG_') || 
                                SMTP_PASS.length > 50; // Las API keys suelen ser largas
  
  if (!looksLikeSendGridKey) {
    console.warn('[email] ⚠️  SMTP_PASS no parece ser una API key de SendGrid válida.');
    return false;
  }
  
  try {
    sgMail.setApiKey(SMTP_PASS);
    sendGridInitialized = true;
    console.log('[email] ✅ SendGrid API inicializada (HTTPS, funciona en Railway)');
    return true;
  } catch (error) {
    console.error('[email] ❌ Error inicializando SendGrid API:', error.message);
    return false;
  }
}

// Función para enviar email usando SendGrid API (HTTPS)
async function sendEmailViaSendGridAPI({ to, subject, text, html, from }) {
  if (!initSendGridAPI()) {
    throw new Error('SendGrid API no inicializada');
  }
  
  const fromEmail = from || process.env.SMTP_FROM || "no-reply@arjaerp.com.ar";
  
  // Validar que el email del remitente esté configurado
  if (!fromEmail || !fromEmail.includes('@')) {
    throw new Error('SMTP_FROM no está configurado correctamente. Debe ser un email válido.');
  }
  
  const msg = {
    to,
    from: fromEmail,
    subject,
    text: text || (html ? html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : ''),
    html: html || text,
  };
  
  try {
    await sgMail.send(msg);
    return true;
  } catch (error) {
    console.error('[email] ❌ Error enviando con SendGrid API:', error.message);
    if (error.response) {
      console.error('[email]   Response body:', JSON.stringify(error.response.body, null, 2));
      console.error('[email]   Response status:', error.response.statusCode);
      
      // Mensajes de error específicos de SendGrid
      if (error.response.body?.errors) {
        error.response.body.errors.forEach((err, idx) => {
          console.error(`[email]   Error ${idx + 1}:`, err.message);
          if (err.field) {
            console.error(`[email]     Campo: ${err.field}`);
          }
        });
      }
    }
    throw error;
  }
}

export async function sendEmail({ to, subject, text, html, retries = 3, from }) {
  const fromEmail = from || process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@arjaerp.com.ar";
  
  // Detectar si estamos en Railway con SendGrid
  const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_NAME;
  const isSendGrid = process.env.SMTP_HOST?.toLowerCase().includes('sendgrid.net');
  const useSendGridAPI = process.env.USE_SENDGRID_API === 'true' || (isRailway && isSendGrid);
  
  // Si estamos en Railway con SendGrid, intentar usar API primero
  if (useSendGridAPI) {
    // Intentar inicializar SendGrid API
    const sendGridAvailable = initSendGridAPI();
    
    if (sendGridAvailable) {
      console.log('[email] 🚀 Usando SendGrid API (HTTPS) en lugar de SMTP');
      let lastError = null;
      const startTime = Date.now();
      
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          console.log(`[email] Intentando enviar email a ${to} via SendGrid API (intento ${attempt}/${retries})...`);
          await sendEmailViaSendGridAPI({ to, subject, text, html, from: fromEmail });
          const duration = Date.now() - startTime;
          console.log(`[email] ✅ Email enviado exitosamente a ${to} via SendGrid API en ${duration}ms`);
          return;
        } catch (error) {
          lastError = error;
          const duration = Date.now() - startTime;
          console.error(`[email] ❌ Error al enviar email via SendGrid API (intento ${attempt}/${retries}, ${duration}ms):`, {
            code: error.code,
            message: error.message,
            response: error.response?.body,
          });
          
          // Si es error de inicialización, no reintentar, usar SMTP directamente
          if (error.message === 'SendGrid API no inicializada') {
            console.warn('[email] ⚠️  SendGrid API no inicializada, usando SMTP tradicional...');
            break;
          }
          
          if (attempt < retries && (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET')) {
            const delay = Math.min(2000 * Math.pow(2, attempt - 1), 15000);
            console.warn(`[email] Error de conexión (intento ${attempt}/${retries}), reintentando en ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else if (attempt === retries) {
            // Si falla SendGrid API después de todos los intentos, intentar con SMTP tradicional como fallback
            console.warn('[email] ⚠️  SendGrid API falló después de todos los intentos, intentando con SMTP tradicional como fallback...');
            break; // Salir del loop para intentar SMTP
          }
        }
      }
    } else {
      console.warn('[email] ⚠️  SendGrid API no disponible (SMTP_PASS no configurado o inválido), usando SMTP tradicional...');
    }
  }
  
  // Si no usamos SendGrid API, usar SMTP tradicional
  const transport = await getTransporter();

  if (!transport) {
    console.log("[email] Simulación de envío de correo:", {
      from: fromEmail,
      to,
      subject,
      text,
    });
    return;
  }

  let lastError = null;
  const startTime = Date.now();
  
  // Reintentos con backoff exponencial
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[email] Intentando enviar email a ${to} (intento ${attempt}/${retries})...`);
      
      // Crear un nuevo transporter para cada intento si el pool está deshabilitado
      // Esto evita usar conexiones muertas del pool
      const transportToUse = process.env.SMTP_USE_POOL === 'true' 
        ? transport 
        : await getTransporter();
      
      await transportToUse.sendMail({
        from: fromEmail,
        to,
        subject,
        text,
        html: html || text,
      });
      
      const duration = Date.now() - startTime;
      console.log(`[email] ✅ Email enviado exitosamente a ${to} en ${duration}ms`);
      
      // Éxito, salir del loop
      return;
    } catch (error) {
      lastError = error;
      const duration = Date.now() - startTime;
      
      // Log detallado del error con información de diagnóstico
      const isProduction = process.env.NODE_ENV === 'production' || 
                          process.env.VERCEL || 
                          process.env.RAILWAY_ENVIRONMENT;
      
      const isGmail = process.env.SMTP_HOST?.toLowerCase().includes('gmail.com');
      
      const errorInfo = {
        code: error.code,
        command: error.command,
        message: error.message,
        response: error.response,
        responseCode: error.responseCode,
        stack: error.stack,
      };
      
      // Agregar información de diagnóstico adicional en producción
      if (isProduction && error.code === 'ETIMEDOUT') {
        const isSendGridError = process.env.SMTP_HOST?.toLowerCase().includes('sendgrid.net');
        const currentPort = Number(process.env.SMTP_PORT) || 587;
        
        const causes = [
          'Firewall bloqueando el puerto SMTP',
          'El servidor SMTP requiere whitelist de IP del servidor de producción',
          'Problemas de red entre el servidor y el SMTP',
          'El servidor SMTP está caído o no responde',
          'Variables de entorno SMTP incorrectas en producción',
        ];
        
        const suggestions = [
          'Verificar que el puerto SMTP esté abierto en el firewall',
          'Agregar la IP del servidor de producción a la whitelist del SMTP',
          'Verificar las variables de entorno SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS',
          'Probar conectividad manual: telnet SMTP_HOST SMTP_PORT',
          'Considerar usar un servicio de email externo (SendGrid, Mailgun, etc.)',
        ];
        
        // Agregar causas y sugerencias específicas para SendGrid
        if (isSendGridError) {
          causes.unshift('Railway puede estar bloqueando los puertos SMTP salientes');
          causes.unshift('El puerto SMTP puede estar bloqueado por el proveedor cloud');
          if (currentPort === 465) {
            suggestions.unshift(`⚠️  El puerto 465 también está bloqueado. Verifica el plan de Railway (Free/Trial bloquea SMTP)`);
            suggestions.unshift(`💡 Considera actualizar a Railway Pro ($20/mes) o usar SendGrid API en lugar de SMTP`);
          } else {
            suggestions.unshift(`💡 Prueba con puerto SSL: SMTP_PORT=465 (más confiable en Railway)`);
            suggestions.unshift(`⚠️  Los puertos 587 y 2525 pueden estar bloqueados. Usa SMTP_PORT=465`);
          }
        }
        
        // Agregar causas específicas para Gmail
        if (isGmail) {
          causes.unshift('Gmail requiere Contraseña de aplicación (no contraseña normal)');
          causes.unshift('La Contraseña de aplicación puede estar incorrecta o expirada');
          suggestions.unshift('Verificar que estés usando una Contraseña de aplicación válida');
          suggestions.unshift('Regenerar la Contraseña de aplicación en: https://myaccount.google.com/apppasswords');
        }
        
        errorInfo.diagnosis = {
          possibleCauses: causes,
          suggestions,
        };
      }
      
      // Errores de autenticación específicos
      if (error.responseCode === 535 || error.code === 'EAUTH') {
        console.error(`[email] ❌ Error de autenticación SMTP`);
        
        const isSendGrid = process.env.SMTP_HOST?.toLowerCase().includes('sendgrid.net');
        
        if (isSendGrid) {
          console.error(`[email] ⚠️  Para SendGrid, verifica:`);
          console.error(`[email]    1. SMTP_USER debe ser exactamente: "apikey" (en minúsculas)`);
          console.error(`[email]    2. SMTP_PASS debe ser tu API Key completo (empieza con SG.)`);
          console.error(`[email]    3. El API Key debe estar activo en SendGrid`);
          console.error(`[email]    4. El API Key debe tener permisos "Mail Send"`);
          console.error(`[email]    5. El email del remitente debe estar verificado en SendGrid`);
          console.error(`[email]    Verificar API Key: https://app.sendgrid.com/settings/api_keys`);
          console.error(`[email]    Verificar remitente: https://app.sendgrid.com/settings/sender_auth`);
        } else if (isGmail) {
          console.error(`[email] ⚠️  Para Gmail, asegúrate de:`);
          console.error(`[email]    1. Usar una Contraseña de aplicación (no tu contraseña normal)`);
          console.error(`[email]    2. Tener Verificación en 2 pasos activada`);
          console.error(`[email]    3. La contraseña debe tener 16 caracteres (sin espacios)`);
          console.error(`[email]    Generar nueva: https://myaccount.google.com/apppasswords`);
        } else {
          console.error(`[email] ⚠️  Verifica que las credenciales SMTP sean correctas:`);
          console.error(`[email]    - SMTP_USER: ${process.env.SMTP_USER ? '✅ configurado' : '❌ faltante'}`);
          console.error(`[email]    - SMTP_PASS: ${process.env.SMTP_PASS ? '✅ configurado' : '❌ faltante'}`);
          console.error(`[email]    - Verifica que no haya espacios en las credenciales`);
        }
      }
      
      console.error(`[email] ❌ Error al enviar email (intento ${attempt}/${retries}, ${duration}ms):`, errorInfo);
      
      // Si es el último intento, lanzar el error
      if (attempt === retries) {
        throw error;
      }
      
      // Si es un error de timeout o conexión, esperar antes de reintentar
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.code === 'ESOCKETTIMEDOUT') {
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 15000); // Backoff exponencial: 2s, 4s, 8s (max 15s)
        console.warn(`[email] Error de conexión (intento ${attempt}/${retries}), reintentando en ${delay}ms...`);
        
        // Si el pool está deshabilitado, recrear el transporter para el siguiente intento
        if (process.env.SMTP_USE_POOL !== 'true') {
          resetTransporter(); // Forzar recreación del transporter
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Para otros errores, no reintentar
        console.error(`[email] Error no recuperable (${error.code}), abortando envío`);
        throw error;
      }
    }
  }
  
  // Si llegamos aquí, todos los intentos fallaron
  throw lastError || new Error('Error desconocido al enviar email');
}


