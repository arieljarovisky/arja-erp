// src/services/arca.js
/**
 * ═══════════════════════════════════════════════════════════
 * INTEGRACIÓN ARCA - FACTURACIÓN ELECTRÓNICA ARGENTINA
 * ═══════════════════════════════════════════════════════════
 * 
 * Este servicio permite que los usuarios facturen solo con su CUIT.
 * El sistema usa certificados centralizados para facturar en nombre de los tenants.
 * 
 * IMPORTANTE SOBRE ARCA/AFIP:
 * - ARCA/AFIP NO ofrece API Keys directamente
 * - Usa certificados digitales y Web Services SOAP (WSAA/WSFE)
 * - Para facturar por terceros, necesitás:
 *   1. Servicio intermediario que ofrezca API REST (ej: Facture.ar, Billar)
 *   2. O certificados del sistema + delegación de servicios en AFIP
 * 
 * CONFIGURACIÓN:
 * - Opción 1: Servicio Intermediario → Configurar ARCA_API_KEY en .env
 * - Opción 2: Certificados → Configurar ARCA_CERT_PATH y ARCA_KEY_PATH en .env
 * 
 * MODOS DE OPERACIÓN:
 * 1. Centralizado: Sistema usa certificados/API Key propios, factura por CUIT del tenant
 * 2. Delegado: Cada tenant tiene su certificado (requiere delegación en AFIP)
 * 
 * NOTA: Los usuarios solo necesitan registrar su CUIT. El sistema factura en su nombre.
 */

import crypto from "crypto";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseString } from "xml2js";
import { execSync } from "child_process";
import { promisify } from "util";
import forge from "node-forge";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// --- TA cache helpers ---
const TA_CACHE_DIR = path.join(__dirname, "../../temp/ta-cache");
if (!fs.existsSync(TA_CACHE_DIR)) fs.mkdirSync(TA_CACHE_DIR, { recursive: true });

function taCacheKey(credentials, service, env) {
  const id =
    (credentials.p12Path ? `p12:${credentials.p12Path}` :
      `${credentials.certPath || ''}|${credentials.keyPath || ''}`) + `|${service}|${env}`;
  return crypto.createHash("sha1").update(id).digest("hex");
}

function taCachePath(key) {
  return path.join(TA_CACHE_DIR, `${key}.json`);
}

function loadCachedTA(key) {
  try {
    const p = taCachePath(key);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { return null; }
}

function saveCachedTA(key, ta) {
  try {
    fs.writeFileSync(taCachePath(key), JSON.stringify(ta), "utf8");
  } catch { }
}

function isTAValid(ta) {
  if (!ta?.token || !ta?.sign || !ta?.expirationTime) return false;
  // margen de seguridad de 5 minutos
  const marginMs = 5 * 60 * 1000;
  return new Date(ta.expirationTime).getTime() - marginMs > Date.now();
}

function yyyymmddToDate(s) {
  if (!s || typeof s !== 'string' || s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// ============================================
// CONFIGURACIÓN - Leer desde .env o BD
// ============================================
// Por defecto, usar certificados locales si existen
const DEFAULT_CERT_PATH = path.join(__dirname, "../arca/Agendly-api-facturacion_48501bca728222ca.crt");
const DEFAULT_KEY_PATH = path.join(__dirname, "../arca/privada.key");
const DEFAULT_P12_PATH = path.join(__dirname, "../arca/certificado.p12");

const ARCA_API_URL = process.env.ARCA_API_URL || "https://api.arca.com.ar/v1";
const ARCA_API_KEY = process.env.ARCA_API_KEY || "";
const ARCA_CUIT = process.env.ARCA_CUIT || "20418345234"; // CUIT del sistema
const ARCA_PUNTO_VENTA = process.env.ARCA_PUNTO_VENTA || "1";
const ARCA_TIMEOUT_MS = Number(process.env.ARCA_TIMEOUT_MS || 15000);
const ARCA_ENVIRONMENT = process.env.ARCA_ENVIRONMENT || "homologacion"; // "homologacion" o "produccion"

// URLs de Web Services AFIP - Si están definidas en .env, usarlas; sino usar las predeterminadas
const WSAA_URL = process.env.WSAA_URL || null;
const WSFE_URL = process.env.WSFE_URL || null;

const WSAA_URLS = {
  homologacion: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  produccion: "https://wsaa.afip.gov.ar/ws/services/LoginCms"
};

const WSFE_URLS = {
  homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx"
};

const ARCA_CERT_PATH = process.env.ARCA_CERT_PATH || (fs.existsSync(DEFAULT_CERT_PATH) ? DEFAULT_CERT_PATH : null);
const ARCA_KEY_PATH = process.env.ARCA_KEY_PATH || (fs.existsSync(DEFAULT_KEY_PATH) ? DEFAULT_KEY_PATH : null);
// Usar P12_PATH y P12_PASS del .env si están definidas
const ARCA_P12_PATH = process.env.P12_PATH || process.env.ARCA_P12_PATH || (fs.existsSync(DEFAULT_P12_PATH) ? DEFAULT_P12_PATH : null);
const ARCA_P12_PASSWORD = process.env.P12_PASS || process.env.ARCA_P12_PASSWORD || "";

// Log para debugging (solo en desarrollo)
if (process.env.NODE_ENV !== 'production') {
}

// Servicio para WSAA (por defecto "wsfe" si no se especifica)
const ARCA_SERVICE = process.env.SERVICE || "wsfe";

// Importar pool para leer credenciales desde BD
let pool = null;
export function setArcaPool(dbPool) {
  pool = dbPool;
}

/**
 * Obtiene credenciales de ARCA desde la BD para un tenant específico
 * @param {number} tenantId 
 * @returns {Promise<{apiKey: string, cuit: string, puntoVenta: string, apiUrl: string}>}
 */
/**
 * Obtiene credenciales del SISTEMA (centralizadas) para facturar
 * Estas credenciales son compartidas por todos los tenants
 */
async function getSystemCredentials() {
  // Buscar credenciales del sistema (tenant_id = 0 o una clave especial)
  const hasCertificates = !!(ARCA_CERT_PATH && ARCA_KEY_PATH && fs.existsSync(ARCA_CERT_PATH) && fs.existsSync(ARCA_KEY_PATH));
  // Verificar si existe el archivo P12 (puede tener contraseña vacía)
  const hasP12File = !!(ARCA_P12_PATH && fs.existsSync(ARCA_P12_PATH));
  // P12 está configurado si tiene archivo (la contraseña puede ser vacía)
  const hasP12Complete = hasP12File;

  if (!pool) {
    return {
      apiKey: ARCA_API_KEY,
      cuit: ARCA_CUIT,
      puntoVenta: ARCA_PUNTO_VENTA,
      apiUrl: ARCA_API_URL,
      // Usar certificados si hay certificados separados O P12 (incluso si falta contraseña)
      useCertificates: hasCertificates || hasP12File,
      certPath: ARCA_CERT_PATH,
      keyPath: ARCA_KEY_PATH,
      p12Path: ARCA_P12_PATH,
      p12Password: ARCA_P12_PASSWORD,
    };
  }

  try {
    // Buscar credenciales del sistema en system_config con tenant_id especial o en .env
    // Por ahora usamos .env como fuente principal
    const hasP12File = !!(ARCA_P12_PATH && fs.existsSync(ARCA_P12_PATH));
    return {
      apiKey: ARCA_API_KEY,
      cuit: ARCA_CUIT,
      puntoVenta: ARCA_PUNTO_VENTA,
      apiUrl: ARCA_API_URL,
      useCertificates: hasCertificates || hasP12File,
      certPath: ARCA_CERT_PATH,
      keyPath: ARCA_KEY_PATH,
      p12Path: ARCA_P12_PATH,
      p12Password: ARCA_P12_PASSWORD,
    };
  } catch (err) {
    console.error("[ARCA] Error obteniendo credenciales del sistema:", err);
    const hasP12File = !!(ARCA_P12_PATH && fs.existsSync(ARCA_P12_PATH));
    return {
      apiKey: ARCA_API_KEY,
      cuit: ARCA_CUIT,
      puntoVenta: ARCA_PUNTO_VENTA,
      apiUrl: ARCA_API_URL,
      useCertificates: hasCertificates || hasP12File,
      certPath: ARCA_CERT_PATH,
      keyPath: ARCA_KEY_PATH,
      p12Path: ARCA_P12_PATH,
      p12Password: ARCA_P12_PASSWORD,
    };
  }
}

/**
 * Obtiene el CUIT del tenant para facturar en su nombre
 */
async function getTenantCUIT(tenantId) {
  if (!pool || !tenantId) return null;

  try {
    const [rows] = await pool.query(
      `SELECT config_value FROM system_config 
       WHERE tenant_id = ? AND config_key = 'contact.arca_cuit'`,
      [tenantId]
    );

    if (rows.length > 0 && rows[0].config_value) {
      const cuit = rows[0].config_value.replace(/\D/g, '');
      return cuit.length === 11 ? cuit : null;
    }

    return null;
  } catch (err) {
    console.error("[ARCA] Error obteniendo CUIT del tenant:", err);
    return null;
  }
}

async function getArcaCredentials(tenantId) {
  // Obtener credenciales del SISTEMA (para autenticación)
  const systemCreds = await getSystemCredentials();

  // Obtener CUIT del tenant (para facturar en su nombre)
  const tenantCUIT = tenantId ? await getTenantCUIT(tenantId) : null;

  // Usar CUIT del tenant si está disponible, sino usar CUIT del sistema
  return {
    ...systemCreds,
    // El CUIT para facturar es el del tenant, pero las credenciales son del sistema
    facturarCUIT: tenantCUIT || systemCreds.cuit,
  };
}

// Tipos de comprobante AFIP
export const COMPROBANTE_TIPOS = {
  FACTURA_A: 1,
  FACTURA_B: 6,
  FACTURA_C: 11,
  NOTA_CREDITO_A: 3,
  NOTA_CREDITO_B: 8,
  NOTA_CREDITO_C: 13,
  RECIBO: 4,
  NOTA_DEBITO_A: 2,
  NOTA_DEBITO_B: 7,
  NOTA_DEBITO_C: 12,
};

// Tipos de documento
export const DOCUMENTO_TIPOS = {
  DNI: 96,
  CUIT: 80,
  CUIL: 86,
  PASAPORTE: 94,
  CONSUMIDOR_FINAL: 99,
};

// Conceptos
export const CONCEPTOS = {
  PRODUCTOS: 1,
  SERVICIOS: 2,
  PRODUCTOS_Y_SERVICIOS: 3,
};

// Condiciones IVA
export const CONDICIONES_IVA = {
  RESPONSABLE_INSCRIPTO: 1,
  MONOTRIBUTISTA: 6,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
};

// ============================================
// HELPERS SOAP/AFIP
// ============================================

/**
 * Escapa caracteres XML
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Extrae certificado y clave privada de un archivo P12
 * @param {string} p12Path - Ruta al archivo P12
 * @param {string} password - Contraseña del P12 (puede ser vacía "")
 * @returns {Object} { certPem, keyPem }
 */
function extractP12Certificates(p12Path, password = "") {
  try {
    const p12Buffer = fs.readFileSync(p12Path);
    const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));

    // Intentar abrir el P12 con la contraseña proporcionada (puede ser vacía)
    let p12;
    try {
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    } catch (err) {
      // Si falla y la contraseña no estaba vacía, intentar con contraseña vacía
      if (password && password !== "") {
        try {
          p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, "");
        } catch (err2) {
          throw new Error(`No se pudo abrir el P12. Verificá la contraseña. Error: ${err.message}`);
        }
      } else {
        throw new Error(`No se pudo abrir el P12. Error: ${err.message}`);
      }
    }

    // Buscar el certificado y la clave privada
    let certPem = null;
    let keyPem = null;

    // Buscar en los bags de certificados y claves privadas
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });

    if (certBags[forge.pki.oids.certBag] && certBags[forge.pki.oids.certBag].length > 0) {
      const cert = certBags[forge.pki.oids.certBag][0].cert;
      certPem = forge.pki.certificateToPem(cert);
    }

    if (keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] && keyBags[forge.pki.oids.pkcs8ShroudedKeyBag].length > 0) {
      const key = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;
      keyPem = forge.pki.privateKeyToPem(key);
    }

    if (!certPem || !keyPem) {
      throw new Error('No se pudieron extraer el certificado y/o la clave privada del P12');
    }

    return { certPem, keyPem };
  } catch (err) {
    throw new Error(`Error extrayendo certificados del P12: ${err.message}`);
  }
}

/**
 * Firma un mensaje usando PKCS#7/CMS con el certificado
 * Soporta tanto certificados separados (.crt/.key) como P12
 * Primero intenta usar OpenSSL, si no está disponible usa node-forge
 */
function signCMS(message, certPath, keyPath, p12Path = null, p12Password = null) {
  try {
    let certPem, keyPem;

    // Si hay P12, extraer certificado y clave (la contraseña puede ser vacía)
    if (p12Path) {
      const extracted = extractP12Certificates(p12Path, p12Password);
      certPem = extracted.certPem;
      keyPem = extracted.keyPem;

      // Crear archivos temporales para usar con OpenSSL si está disponible
      const tempDir = path.join(__dirname, "../../temp");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempCert = path.join(tempDir, `temp_cert_${Date.now()}.crt`);
      const tempKey = path.join(tempDir, `temp_key_${Date.now()}.key`);

      try {
        fs.writeFileSync(tempCert, certPem);
        fs.writeFileSync(tempKey, keyPem);

        // Intentar primero con OpenSSL
        try {
          const result = signCMSWithOpenSSL(message, tempCert, tempKey);
          // Limpiar archivos temporales
          fs.unlinkSync(tempCert);
          fs.unlinkSync(tempKey);
          return result;
        } catch (opensslErr) {
          // Limpiar archivos temporales
          fs.unlinkSync(tempCert);
          fs.unlinkSync(tempKey);
          // Usar node-forge directamente con los PEMs
          return signCMSWithNodeForgeFromPEM(message, certPem, keyPem);
        }
      } catch (err) {
        // Limpiar archivos temporales en caso de error
        if (fs.existsSync(tempCert)) fs.unlinkSync(tempCert);
        if (fs.existsSync(tempKey)) fs.unlinkSync(tempKey);
        throw err;
      }
    } else {
      // Usar certificados separados
      if (!certPath || !keyPath) {
        throw new Error('Se requiere certPath y keyPath, o p12Path y p12Password');
      }

      // Intentar primero con OpenSSL (más rápido si está disponible)
      try {
        return signCMSWithOpenSSL(message, certPath, keyPath);
      } catch (opensslErr) {
        // Si OpenSSL falla, usar node-forge
        return signCMSWithNodeForge(message, certPath, keyPath);
      }
    }
  } catch (err) {
    throw new Error(`Error firmando mensaje: ${err.message}`);
  }
}

/**
 * Firma usando OpenSSL (método preferido)
 */
function signCMSWithOpenSSL(message, certPath, keyPath) {
  // Crear archivo temporal para el mensaje
  const tempDir = path.join(__dirname, "../../temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempInput = path.join(tempDir, `tra_${Date.now()}.xml`);
  const tempOutput = path.join(tempDir, `tra_firmado_${Date.now()}.p7m`);

  try {
    // Escribir mensaje a archivo temporal
    fs.writeFileSync(tempInput, message, 'utf8');

    // Firmar con OpenSSL usando PKCS#7
    const opensslCmd = `openssl cms -sign -in "${tempInput}" -out "${tempOutput}" -signer "${certPath}" -inkey "${keyPath}" -outform DER -nodetach 2>&1`;

    execSync(opensslCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

    // Verificar que el archivo se creó
    if (!fs.existsSync(tempOutput)) {
      throw new Error('OpenSSL no generó el archivo de salida');
    }

    // Leer el archivo firmado
    const signed = fs.readFileSync(tempOutput);

    if (signed.length === 0) {
      throw new Error('El archivo firmado está vacío');
    }

    // Convertir a base64 para enviar en el SOAP
    const signedBase64 = signed.toString('base64');

    // Limpiar archivos temporales
    fs.unlinkSync(tempInput);
    fs.unlinkSync(tempOutput);

    return signedBase64;
  } catch (err) {
    // Limpiar archivos temporales en caso de error
    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
    throw err;
  }
}

/**
 * Firma usando node-forge (método alternativo) con archivos
 */
function signCMSWithNodeForge(message, certPath, keyPath) {
  try {
    // Leer certificado y clave privada
    const certPem = fs.readFileSync(certPath, 'utf8');
    const keyPem = fs.readFileSync(keyPath, 'utf8');

    return signCMSWithNodeForgeFromPEM(message, certPem, keyPem);
  } catch (err) {
    throw new Error(`Error firmando con node-forge: ${err.message}`);
  }
}

/**
 * Firma usando node-forge directamente con PEMs
 */
function signCMSWithNodeForgeFromPEM(message, certPem, keyPem) {
  try {
    // Parsear certificado y clave privada
    const cert = forge.pki.certificateFromPem(certPem);
    const privateKey = forge.pki.privateKeyFromPem(keyPem);

    // Crear objeto PKCS#7
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(message, 'utf8');
    p7.addCertificate(cert);

    // Agregar signer
    p7.addSigner({
      key: privateKey,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        {
          type: forge.pki.oids.contentType,
          value: forge.pki.oids.data
        },
        {
          type: forge.pki.oids.messageDigest
        },
        {
          type: forge.pki.oids.signingTime,
          value: new Date()
        }
      ]
    });

    // Firmar
    p7.sign({ detached: false });

    // Convertir a DER y luego a base64
    const derBuffer = forge.asn1.toDer(p7.toAsn1()).getBytes();
    const signedBase64 = Buffer.from(derBuffer, 'binary').toString('base64');

    return signedBase64;
  } catch (err) {
    throw new Error(`Error firmando con node-forge: ${err.message}`);
  }
}

/**
 * Obtiene un Ticket de Acceso (TA) del WSAA de AFIP
 * @param {string} service - Servicio para el que se solicita el ticket (ej: "wsfe")
 * @param {Object} credentials - Credenciales con certificados
 */
async function obtenerTicketWSAA(service = null, credentials) {
  // Usar SERVICE del .env si no se especifica, o "wsfe" por defecto
  const serviceToUse = service || ARCA_SERVICE;

  // Determinar URL de WSAA: usar WSAA_URL si está definido, sino usar la del environment
  const wsaaUrl = WSAA_URL || WSAA_URLS[ARCA_ENVIRONMENT] || WSAA_URLS.homologacion;
  const url = new URL(wsaaUrl);

  // Verificar cache de TA antes de hacer request
  const cacheKey = taCacheKey(credentials, serviceToUse, ARCA_ENVIRONMENT);
  const cached = loadCachedTA(cacheKey);
  if (isTAValid(cached)) {
    return { token: cached.token, sign: cached.sign, expirationTime: cached.expirationTime };
  }

  try {
    // =========================
    // TRA (Ticket de Requerimiento de Acceso)
    // =========================
    // uniqueId en segundos (epoch)
    const uniqueId = Math.floor(Date.now() / 1000);

    // --- NUEVO: Ventana ±10 min y formateo -03:00 sin depender del TZ del SO ---
    // AFIP/WSAA suele rechazar si la hora está "en el futuro" por desvíos de reloj.
    const now = Date.now();
    const genUTC = new Date(now - 10 * 60 * 1000); // ahora -10 min
    const expUTC = new Date(now + 10 * 60 * 1000); // ahora +10 min

    // Formatea YYYY-MM-DDTHH:mm:ss-03:00 sin depender del timezone del sistema.
    const formatDateAFIP = (dateUTC) => {
      // Ajustar a hora de Argentina (UTC-3) aritméticamente
      const argentinaTs = dateUTC.getTime() - (3 * 60 * 60 * 1000);
      const d = new Date(argentinaTs);

      const pad = (n) => String(n).padStart(2, "0");
      const s = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
        + `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}-03:00`;
      return s;
    };

    let generationTime = formatDateAFIP(genUTC);
    const expirationTime = formatDateAFIP(expUTC);

    // Sanity check: evitar "futuro" por drift de reloj local
    try {
      const genCheck = new Date(generationTime.replace("-03:00", "Z"));
      if (genCheck.getTime() > Date.now() + 60 * 1000) {
        const fallback = new Date(Date.now() - 20 * 60 * 1000);
        console.warn("[ARCA] Ajustando generationTime por drift de reloj (>60s).");
        generationTime = formatDateAFIP(fallback);
      }
    } catch (_) {
      // si por algún motivo falla el parse, seguimos con generationTime calculado
    }

    // Logs de diagnóstico
    const nowISO = new Date().toISOString();
    const nowLocal = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    console.log(`[ARCA] TRA - Hora actual UTC (ISO): ${nowISO}`);
    console.log(`[ARCA] TRA - Hora actual Argentina: ${nowLocal}`);
    console.log(`[ARCA] TRA - generationTime: ${generationTime}`);
    console.log(`[ARCA] TRA - expirationTime: ${expirationTime}`);
    console.log(`[ARCA] TRA - uniqueId: ${uniqueId}`);

    // TRA según schema v1.0: header(uniqueId, generationTime, expirationTime) + service
    const traXml = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${generationTime}</generationTime>
    <expirationTime>${expirationTime}</expirationTime>
  </header>
  <service>${serviceToUse}</service>
</loginTicketRequest>`;

    // Firmar el TRA con PKCS#7 (P12 o cert/key)
    const traFirmado = signCMS(
      traXml,
      credentials.certPath,
      credentials.keyPath,
      credentials.p12Path,
      credentials.p12Password
    );

    // Construir el SOAP para WSAA (namespace http y CMS en una sola línea)
    const soapNamespace = ARCA_ENVIRONMENT === 'produccion'
      ? 'http://wsaa.afip.gov.ar/ws/services/LoginCms'
      : 'http://wsaahomo.afip.gov.ar/ws/services/LoginCms';

    const traFirmadoSinSaltos = traFirmado.replace(/\s+/g, '');

    const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="${soapNamespace}">
  <soap:Header/>
  <soap:Body>
    <wsaa:loginCms>
      <wsaa:in0>${traFirmadoSinSaltos}</wsaa:in0>
    </wsaa:loginCms>
  </soap:Body>
</soap:Envelope>`;

    // HTTPS con client cert
    let cert, key;
    if (credentials.p12Path) {
      const extracted = extractP12Certificates(credentials.p12Path, credentials.p12Password);
      cert = Buffer.from(extracted.certPem, 'utf8');
      key = Buffer.from(extracted.keyPem, 'utf8');
    } else {
      cert = fs.readFileSync(credentials.certPath);
      key = fs.readFileSync(credentials.keyPath);
    }

    const httpsAgent = new https.Agent({
      cert: cert,
      key: key,
      rejectUnauthorized: true,
    });

    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        agent: httpsAgent,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': `"${soapNamespace}#loginCms"`,
          'Content-Length': Buffer.byteLength(soapRequest, 'utf8'),
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
      });

      req.on('error', reject);
      req.write(soapRequest);
      req.end();

      setTimeout(() => {
        req.destroy();
        reject(new Error('Timeout en request a WSAA'));
      }, ARCA_TIMEOUT_MS);
    });

    if (response.status !== 200) {
      console.error("[ARCA] Error en WSAA:", response.status, response.data?.substring(0, 200));
      throw new Error(`WSAA respondió con status ${response.status}: ${response.data?.substring(0, 500) || 'Sin detalles'}`);
    }

    // Parsear respuesta XML
    return new Promise((resolve, reject) => {
      parseString(response.data, {
        explicitArray: false,
        ignoreAttrs: false,
        mergeAttrs: true
      }, (err, result) => {
        if (err) {
          console.error("[ARCA] Error parseando respuesta de WSAA");
          reject(err);
          return;
        }

        try {
          const envelope = result['soap:Envelope'] || result['soapenv:Envelope'] || result['Envelope'];
          const body = envelope?.['soap:Body'] || envelope?.['soapenv:Body'] || envelope?.['Body'];
          const loginCmsResponse = body?.['loginCmsResponse'] || body?.['wsaa:loginCmsResponse'];
          const loginCmsReturn = loginCmsResponse?.['loginCmsReturn'] || loginCmsResponse?.['wsaa:loginCmsReturn'];

          const ticketXml = typeof loginCmsReturn === 'string'
            ? loginCmsReturn
            : (Array.isArray(loginCmsReturn) ? loginCmsReturn[0] : loginCmsReturn);

          if (!ticketXml) {
            throw new Error('Respuesta de WSAA no válida - no se encontró loginCmsReturn');
          }

          // Parsear TA (Ticket de Acceso)
          parseString(ticketXml, {
            explicitArray: false,
            ignoreAttrs: false,
            mergeAttrs: true
          }, (err2, taResult) => {
            if (err2) {
              console.error("[ARCA] Error parseando ticket de acceso");
              reject(err2);
              return;
            }

            const ta = taResult.loginTicketResponse;
            const token = ta?.credentials?.token || ta?.credentials?.[0]?.token?.[0];
            const sign = ta?.credentials?.sign || ta?.credentials?.[0]?.sign?.[0];

            if (!token || !sign) {
              throw new Error('Faltan datos de autenticación: token o sign');
            }
            if (!credentials.cuit) {
              throw new Error('Falta CUIT en las credenciales');
            }
            const tokenClean = String(token || "").trim();
            const signClean = String(sign || "").trim();
            const cuitClean = String(credentials.cuit || "").trim();


            const taData = {
              token,
              sign,
              expirationTime: ta?.header?.expirationTime || ta?.header?.[0]?.expirationTime?.[0]
            };

            // Guardar en cache
            saveCachedTA(cacheKey, taData);

            resolve(taData);
          });
        } catch (parseErr) {
          reject(parseErr);
        }
      });
    });
  } catch (err) {
    // Si AFIP dice que ya hay un TA válido, intentar cache
    const msg = String(err?.message || "");
    if (msg.includes("coe.alreadyAuthenticated")) {
      const again = loadCachedTA(cacheKey);
      if (isTAValid(again)) {
        return { token: again.token, sign: again.sign, expirationTime: again.expirationTime };
      }
      throw new Error("AFIP indicó TA vigente pero no hay cache local. Reintentá en unos minutos o eliminá el TA en uso.");
    }
    console.error("[ARCA] Error obteniendo ticket de acceso:", err.message);
    throw new Error(`Error obteniendo ticket de WSAA: ${err.message}`);
  }
}

/**
 * Obtiene el próximo número de comprobante desde WSFE
 * @param {Object} credentials - Credenciales con certificados
 * @param {string} token - Token del WSAA
 * @param {string} sign - Sign del WSAA
 * @param {number} tipoComprobante - Tipo de comprobante
 * @param {number} puntoVenta - Punto de venta
 */
async function obtenerProximoNumeroWSFE(credentials, token, sign, tipoComprobante, puntoVenta) {
  try {
    // Determinar URL de WSFE: usar WSFE_URL si está definido, sino usar la del environment
    const wsfeUrl = WSFE_URL || WSFE_URLS[ARCA_ENVIRONMENT] || WSFE_URLS.homologacion;

    if (!wsfeUrl) {
      throw new Error(`WSFE_URL no está configurada. ARCA_ENVIRONMENT="${ARCA_ENVIRONMENT}". Configurá WSFE_URL en .env o ARCA_ENVIRONMENT.`);
    }

    const url = new URL(wsfeUrl);
    const tokenClean = String(token || "").trim();
    const signClean = String(sign || "").trim();
    const cuitClean = String(credentials?.cuit || "").trim();

    if (!tokenClean || !signClean) {
      throw new Error("Faltan credenciales WSAA: token o sign");
    }
    if (!cuitClean) {
      throw new Error("Falta CUIT en las credenciales");
    }
    // Construir SOAP request para obtener último número autorizado
    const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
      <soap:Body>
        <ar:FECompUltimoAutorizado>
          <ar:Auth>
            <ar:Token>${escapeXml(tokenClean)}</ar:Token>
            <ar:Sign>${escapeXml(signClean)}</ar:Sign>
            <ar:Cuit>${escapeXml(cuitClean)}</ar:Cuit>
          </ar:Auth>
          <ar:PtoVta>${puntoVenta}</ar:PtoVta>
          <ar:CbteTipo>${tipoComprobante}</ar:CbteTipo>
        </ar:FECompUltimoAutorizado>
      </soap:Body>
    </soap:Envelope>`;

    // Preparar certificados para HTTPS
    // Si hay P12, extraer certificado y clave (la contraseña puede ser vacía)
    let cert, key;
    if (credentials.p12Path) {
      const extracted = extractP12Certificates(credentials.p12Path, credentials.p12Password || "");
      cert = Buffer.from(extracted.certPem, 'utf8');
      key = Buffer.from(extracted.keyPem, 'utf8');
    } else {
      if (!credentials.certPath || !credentials.keyPath) {
        throw new Error('Se requiere certificados (P12 o .crt/.key) para autenticarse con WSFE');
      }
      cert = fs.readFileSync(credentials.certPath);
      key = fs.readFileSync(credentials.keyPath);
    }

    const httpsAgent = new https.Agent({
      cert: cert,
      key: key,
      rejectUnauthorized: true,
    });

    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        agent: httpsAgent,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': '"http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado"',
          'Content-Length': Buffer.byteLength(soapRequest, 'utf8'),
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({ status: res.statusCode, data });
        });
      });

      req.on('error', reject);
      req.write(soapRequest);
      req.end();

      setTimeout(() => {
        req.destroy();
        reject(new Error('Timeout en request a WSFE'));
      }, ARCA_TIMEOUT_MS);
    });

    if (response.status !== 200) {
      console.error("[ARCA] Error en WSFE:", response.status, response.data?.substring(0, 300));
      throw new Error(`WSFE respondió con status ${response.status}: ${response.data?.substring(0, 500) || 'Sin detalles'}`);
    }

    // Parsear respuesta XML
    return new Promise((resolve, reject) => {
      parseString(response.data, {
        explicitArray: false,
        ignoreAttrs: false,
        mergeAttrs: true
      }, (err, result) => {
        if (err) {
          console.error("[ARCA] Error parseando respuesta de WSFE");
          reject(err);
          return;
        }

        try {
          const envelope = result['soap:Envelope'] || result['soapenv:Envelope'] || result['Envelope'];
          const body = envelope?.['soap:Body'] || envelope?.['soapenv:Body'] || envelope?.['Body'];
          const fecaerResponse = body?.['FECompUltimoAutorizadoResponse'] || body?.[`ar:FECompUltimoAutorizadoResponse`];
          const fecaerResult = fecaerResponse?.['FECompUltimoAutorizadoResult'] || fecaerResponse?.[`ar:FECompUltimoAutorizadoResult`];

          const resultData = typeof fecaerResult === 'string' ? fecaerResult :
            (Array.isArray(fecaerResult) ? fecaerResult[0] : fecaerResult);

          if (!resultData) {
            throw new Error('Respuesta de WSFE no válida - no se encontró FECompUltimoAutorizadoResult');
          }

          // Si resultData es un objeto, parsearlo
          const responseObj = typeof resultData === 'string' ?
            (() => {
              try {
                const parsed = {};
                parseString(resultData, { explicitArray: false, mergeAttrs: true }, (e, r) => {
                  if (!e) Object.assign(parsed, r);
                });
                return parsed;
              } catch {
                return { _text: resultData };
              }
            })() : resultData;

          const cbteNro = responseObj.CbteNro || responseObj.CbteNro?.[0];
          const errors = responseObj.Errors || responseObj.Errors?.[0];

          if (errors) {
            const errorMsg = errors.Err?.[0]?.Msg || errors.Err?.Msg || errors.Msg || 'Error desconocido de AFIP';
            throw new Error(`Error de AFIP: ${errorMsg}`);
          }

          if (cbteNro === undefined || cbteNro === null) {
            throw new Error('No se encontró CbteNro en la respuesta de WSFE');
          }

          // El próximo número es el último + 1
          const proximoNumero = Number(cbteNro) + 1;
          resolve(proximoNumero);
        } catch (parseErr) {
          reject(parseErr);
        }
      });
    });
  } catch (err) {
    console.error("[ARCA] Error obteniendo próximo número:", err.message);
    throw new Error(`Error obteniendo próximo número de WSFE: ${err.message}`);
  }
}

/**
 * Autoriza una factura usando WSFE de AFIP
 * @param {Object} facturaData - Datos de la factura
 * @param {Object} credentials - Credenciales con certificados
 * @param {string} token - Token del WSAA
 * @param {string} sign - Sign del WSAA
 */
async function autorizarFacturaWSFE(facturaData, credentials, token, sign) {
  try {
    const wsfeUrl = WSFE_URL || WSFE_URLS[ARCA_ENVIRONMENT] || WSFE_URLS.homologacion;
    if (!wsfeUrl) {
      throw new Error('WSFE_URL no está configurada. Configurá WSFE_URL en .env o ARCA_ENVIRONMENT.');
    }

    const url = new URL(wsfeUrl);

    const tokenClean = String(token || "").trim();
    const signClean = String(sign || "").trim();
    const cuitClean = String(credentials?.cuit || "").trim();

    if (!tokenClean || !signClean) {
      throw new Error("Faltan credenciales WSAA: token o sign");
    }
    if (!cuitClean) {
      throw new Error("Falta CUIT en las credenciales");
    }

    // --- RG 5616: Condición IVA del receptor ---
    const requiere = requiereIvaCond(facturaData.tipo_comprobante);
    const condIvaValor = mapCondicionIvaReceptor(facturaData.cliente.condicion_iva);
    if (requiere && !condIvaValor) {
      throw new Error("RG 5616: Falta o inválida la condición IVA del receptor (CondicionIVAReceptorId) para comprobante B/C.");
    }

    // === Totales coherentes ===
    let impNetoNum = Number(facturaData.importe_neto || 0);
    let impIVANum = Number(facturaData.importe_iva || 0);
    let impTotConcNum = 0;
    let impOpExNum = 0;
    let impTribNum = 0;
    let impTotalNum = Number(
      facturaData.importe_total ||
      (impNetoNum + impIVANum + impOpExNum + impTotConcNum + impTribNum)
    );

    const tipoComprobanteNum = Number(facturaData.tipo_comprobante || 0);
    const esComprobanteTipoC = [
      COMPROBANTE_TIPOS.FACTURA_C,
      COMPROBANTE_TIPOS.NOTA_CREDITO_C,
      COMPROBANTE_TIPOS.NOTA_DEBITO_C,
    ].includes(tipoComprobanteNum);

    if (esComprobanteTipoC) {
      impIVANum = 0;
      impTotalNum = impNetoNum + impTribNum + impOpExNum + impTotConcNum;
    }

    if (
      Math.abs(
        impTotalNum -
          (impNetoNum + impIVANum + impOpExNum + impTotConcNum + impTribNum)
      ) > 0.001
    ) {
      impTotalNum =
        impNetoNum + impIVANum + impOpExNum + impTotConcNum + impTribNum;
    }

    const impTotal = impTotalNum.toFixed(2);
    const impNeto = impNetoNum.toFixed(2);
    const impIVA = impIVANum.toFixed(2);

    // --- DocTipo/DocNro defensivo ---
    let docTipo = Number(facturaData.cliente.tipo_documento || 96); // DNI
    let docNro = facturaData.cliente.documento || "0";
    let docNroNum = Number(docNro);

    if (facturaData.tipo_comprobante === 6 && docNroNum === 0 && docTipo !== 99) {
      // Factura B a consumidor final
      docTipo = 99;
      docNro = "0";
      docNroNum = 0;
    }

    // === IVA (alícuota) ===
    let ivaSection = "";
    let idAlicuota = 5; // 21% por defecto
    if (impIVANum > 0 && impNetoNum > 0) {
      const alicuotaPct = (impIVANum / impNetoNum) * 100;
      if (Math.abs(alicuotaPct - 21) < 0.1) idAlicuota = 5;
      else if (Math.abs(alicuotaPct - 10.5) < 0.1) idAlicuota = 4;
      else if (Math.abs(alicuotaPct - 27) < 0.1) idAlicuota = 6;

      ivaSection =
        `<ar:Iva>` +
        `<ar:AlicIva>` +
        `<ar:Id>${idAlicuota}</ar:Id>` +
        `<ar:BaseImp>${impNeto}</ar:BaseImp>` +
        `<ar:Importe>${impIVA}</ar:Importe>` +
        `</ar:AlicIva>` +
        `</ar:Iva>`;
    }
    const ivaSectionLog = ivaSection
      ? ivaSection.replace(/<ar:/g, "<").replace(/<\/ar:/g, "</")
      : "";

    const condIvaTagSoap =
      requiere && condIvaValor
        ? `<ar:CondicionIVAReceptorId>${condIvaValor}</ar:CondicionIVAReceptorId>`
        : "";
    const condIvaTagLog =
      requiere && condIvaValor
        ? `<CondicionIVAReceptorId>${condIvaValor}</CondicionIVAReceptorId>`
        : "";

    const fecha = new Date();
    const fechaStr = fecha.toISOString().split("T")[0].replace(/-/g, "");

    // === CbtesAsoc (Notas de crédito / débito) ===
    let cbteAsocSection = "";
    let cbteAsocSectionLog = "";

    if (Array.isArray(facturaData.cbtesAsoc) && facturaData.cbtesAsoc.length > 0) {
      const a = facturaData.cbtesAsoc[0];

      const tipoAsoc = Number(a.Tipo || a.tipo || a.CbteTipo || facturaData.tipo_comprobante_original || 0);
      const ptoVtaAsoc = Number(a.PtoVta || a.punto_venta || a.PtoVta || facturaData.punto_venta_original || 0);
      const nroAsoc = Number(a.Nro || a.numero || a.CbteNro || facturaData.numero_original || 0);

      if (tipoAsoc && ptoVtaAsoc && nroAsoc) {
        cbteAsocSection = `
            <ar:CbtesAsoc>
              <ar:CbteAsoc>
                <ar:Tipo>${tipoAsoc}</ar:Tipo>
                <ar:PtoVta>${ptoVtaAsoc}</ar:PtoVta>
                <ar:Nro>${nroAsoc}</ar:Nro>
              </ar:CbteAsoc>
            </ar:CbtesAsoc>`;

        cbteAsocSectionLog = cbteAsocSection
          .replace(/<ar:/g, "<")
          .replace(/<\/ar:/g, "</");
      }
    }

    // XML "log" (sin namespaces ar:) para debug
    const facturaXml =
      `<FECAERequest>` +
      `<FeCabReq>` +
      `<CantReg>1</CantReg>` +
      `<PtoVta>${Number(facturaData.punto_venta)}</PtoVta>` +
      `<CbteTipo>${Number(facturaData.tipo_comprobante)}</CbteTipo>` +
      `</FeCabReq>` +
      `<FeDetReq>` +
      `<FECAEDetRequest>` +
      `<Concepto>${Number(facturaData.concepto)}</Concepto>` +
      `<DocTipo>${docTipo}</DocTipo>` +
      `<DocNro>${docNroNum}</DocNro>` +
      `<CbteDesde>${Number(facturaData.numero)}</CbteDesde>` +
      `<CbteHasta>${Number(facturaData.numero)}</CbteHasta>` +
      `<CbteFch>${fechaStr}</CbteFch>` +
      cbteAsocSectionLog +
      `<ImpTotal>${impTotal}</ImpTotal>` +
      `<ImpTotConc>0.00</ImpTotConc>` +
      `<ImpNeto>${impNeto}</ImpNeto>` +
      `<ImpOpEx>0.00</ImpOpEx>` +
      `<ImpTrib>0.00</ImpTrib>` +
      `<ImpIVA>${impIVA}</ImpIVA>` +
      (Number(facturaData.concepto) === 2
        ? `<FchServDesde>${fechaStr}</FchServDesde><FchServHasta>${fechaStr}</FchServHasta><FchVtoPago>${fechaStr}</FchVtoPago>`
        : ``) +
      `<MonId>PES</MonId>` +
      `<MonCotiz>1</MonCotiz>` +
      condIvaTagLog +
      ivaSectionLog +
      `</FECAEDetRequest>` +
      `</FeDetReq>` +
      `</FECAERequest>`;

    // XML real con namespaces (lo que se envía a AFIP)
    const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body>
    <ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token>${escapeXml(tokenClean)}</ar:Token>
        <ar:Sign>${escapeXml(signClean)}</ar:Sign>
        <ar:Cuit>${escapeXml(cuitClean)}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${Number(facturaData.punto_venta)}</ar:PtoVta>
          <ar:CbteTipo>${Number(facturaData.tipo_comprobante)}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>${Number(facturaData.concepto)}</ar:Concepto>
            <ar:DocTipo>${docTipo}</ar:DocTipo>
            <ar:DocNro>${docNroNum}</ar:DocNro>
            <ar:CbteDesde>${Number(facturaData.numero)}</ar:CbteDesde>
            <ar:CbteHasta>${Number(facturaData.numero)}</ar:CbteHasta>
            <ar:CbteFch>${fechaStr}</ar:CbteFch>
            ${cbteAsocSection}
            <ar:ImpTotal>${impTotal}</ar:ImpTotal>
            <ar:ImpTotConc>0.00</ar:ImpTotConc>
            <ar:ImpNeto>${impNeto}</ar:ImpNeto>
            <ar:ImpOpEx>0.00</ar:ImpOpEx>
            <ar:ImpTrib>0.00</ar:ImpTrib>
            <ar:ImpIVA>${impIVA}</ar:ImpIVA>
            ${Number(facturaData.concepto) === 2 ? `
            <ar:FchServDesde>${fechaStr}</ar:FchServDesde>
            <ar:FchServHasta>${fechaStr}</ar:FchServHasta>
            <ar:FchVtoPago>${fechaStr}</ar:FchVtoPago>` : ``}
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            ${condIvaTagSoap}
            ${ivaSection}
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soap:Body>
</soap:Envelope>`;

    console.log("[ARCA] Auth - Token length:", tokenClean.length, "Sign length:", signClean.length, "Cuit:", cuitClean);
    console.log("[ARCA] Factura XML (primeros 500 chars):", facturaXml.substring(0, 500));
    console.log("[ARCA] Verificando CondicionIVAReceptorId en facturaXml:", facturaXml.includes('<CondicionIVAReceptorId>'));
    console.log("[ARCA] Verificando CondicionIVAReceptorId en soapRequest:", soapRequest.includes('<ar:CondicionIVAReceptorId>'));
    console.log("[ARCA] POS-CHK CondIVA→Iva:", soapRequest.includes('</ar:CondicionIVAReceptorId><ar:Iva>') || !soapRequest.includes('<ar:Iva>'));

    // Certificados HTTPS
    let cert, key;
    if (credentials.p12Path) {
      const extracted = extractP12Certificates(credentials.p12Path, credentials.p12Password || "");
      cert = Buffer.from(extracted.certPem, "utf8");
      key = Buffer.from(extracted.keyPem, "utf8");
    } else {
      if (!credentials.certPath || !credentials.keyPath) {
        throw new Error("Se requiere certificados (P12 o .crt/.key) para autenticarse con WSFE");
      }
      cert = fs.readFileSync(credentials.certPath);
      key = fs.readFileSync(credentials.keyPath);
    }

    const httpsAgent = new https.Agent({
      cert,
      key,
      rejectUnauthorized: true,
    });

    const response = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          port: 443,
          path: url.pathname,
          method: "POST",
          agent: httpsAgent,
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            SOAPAction: '"http://ar.gov.afip.dif.FEV1/FECAESolicitar"',
            "Content-Length": Buffer.byteLength(soapRequest, "utf8"),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve({ status: res.statusCode, data }));
        }
      );

      req.on("error", reject);
      req.write(soapRequest);
      req.end();

      setTimeout(() => {
        req.destroy();
        reject(new Error("Timeout en request a WSFE"));
      }, ARCA_TIMEOUT_MS);
    });

    if (response.status !== 200) {
      // manejo de fault (lo dejo igual que ya tenías)
      try {
        const faultData = response.data?.toString() || "";
        return new Promise((resolve, reject) => {
          parseString(
            faultData,
            { explicitArray: false, ignoreAttrs: false, mergeAttrs: true },
            (err, faultResult) => {
              if (err) {
                const faultMatch = faultData.match(
                  /<faultstring[^>]*>(.*?)<\/faultstring>/s
                );
                const errorMsg =
                  (faultMatch && faultMatch[1] && faultMatch[1].trim()) ||
                  "Error desconocido de AFIP";
                console.error("[ARCA] Error en WSFE:", response.status);
                console.error("[ARCA] Mensaje de error:", errorMsg);
                return reject(
                  new Error(
                    `WSFE respondió con status ${response.status}: ${errorMsg}`
                  )
                );
              }

              try {
                const envelope =
                  faultResult["soap:Envelope"] ||
                  faultResult["soapenv:Envelope"] ||
                  faultResult["Envelope"];
                const body =
                  envelope?.["soap:Body"] ||
                  envelope?.["soapenv:Body"] ||
                  envelope?.["Body"];
                const fault =
                  body?.["soap:Fault"] ||
                  body?.["soapenv:Fault"] ||
                  body?.["Fault"];

                const faultString =
                  fault?.faultstring ||
                  fault?.faultstring?.[0] ||
                  "Error desconocido de AFIP";
                const faultCode =
                  fault?.faultcode || fault?.faultcode?.[0] || "";
                const detail = fault?.detail || fault?.detail?.[0] || "";

                let errorMsg =
                  typeof faultString === "string"
                    ? faultString
                    : faultString._text || "Error desconocido";

                console.error("[ARCA] Error en WSFE:", response.status);
                console.error("[ARCA] Fault code:", faultCode);
                console.error("[ARCA] Mensaje de error:", errorMsg);

                if (detail) {
                  const detailStr =
                    typeof detail === "string"
                      ? detail
                      : JSON.stringify(detail);
                  console.error(
                    "[ARCA] Detalle del error:",
                    detailStr.substring(0, 500)
                  );
                }

                return reject(
                  new Error(
                    `WSFE respondió con status ${response.status}: ${errorMsg}`
                  )
                );
              } catch (parseErr) {
                console.error("[ARCA] Error parseando fault:", parseErr);
                return reject(
                  new Error(
                    `WSFE respondió con status ${response.status}: Error parseando respuesta`
                  )
                );
              }
            }
          );
        });
      } catch (parseErr) {
        console.error(
          "[ARCA] Error en WSFE:",
          response.status,
          response.data?.substring(0, 500)
        );
        throw new Error(
          `WSFE respondió con status ${response.status}: ${
            parseErr.message || "Sin detalles"
          }`
        );
      }
    }

    // Parsear respuesta exitosa
    return new Promise((resolve, reject) => {
      parseString(
        response.data,
        { explicitArray: false, ignoreAttrs: false, mergeAttrs: true },
        (err, result) => {
          if (err) {
            console.error(
              "[ARCA] Error parseando respuesta de WSFE:",
              err.message
            );
            return reject(err);
          }

          try {
            const envelope =
              result["soap:Envelope"] ||
              result["soapenv:Envelope"] ||
              result["Envelope"];
            const body =
              envelope?.["soap:Body"] ||
              envelope?.["soapenv:Body"] ||
              envelope?.["Body"];
            const fecaerResponse =
              body?.["FECAESolicitarResponse"] ||
              body?.["ar:FECAESolicitarResponse"];
            const fecaerResult =
              fecaerResponse?.["FECAESolicitarResult"] ||
              fecaerResponse?.["ar:FECAESolicitarResult"];

            const resultData =
              typeof fecaerResult === "string"
                ? fecaerResult
                : Array.isArray(fecaerResult)
                ? fecaerResult[0]
                : fecaerResult;

            if (!resultData) {
              console.error(
                "[ARCA] Estructura de respuesta inesperada:",
                JSON.stringify(result, null, 2).substring(0, 500)
              );
              throw new Error(
                "Respuesta de WSFE no válida - no se encontró FECAESolicitarResult"
              );
            }

            const responseObj =
              typeof resultData === "string"
                ? (() => {
                    try {
                      const parsed = {};
                      parseString(
                        resultData,
                        {
                          explicitArray: false,
                          mergeAttrs: true,
                        },
                        (e, r) => {
                          if (!e) Object.assign(parsed, r);
                        }
                      );
                      return parsed;
                    } catch {
                      return { _text: resultData };
                    }
                  })()
                : resultData;

            const detalle =
              responseObj.FeDetResp?.FECAEDetResponse ||
              responseObj.FeDetResp?.[0]?.FECAEDetResponse ||
              responseObj.FECAEDetResponse;

            const detalleData = Array.isArray(detalle)
              ? detalle[0]
              : detalle;

            if (!detalleData) {
              const errors =
                responseObj.Errors?.Err ||
                responseObj.Errors ||
                responseObj.Errors?.[0]?.Err;
              const errorData = Array.isArray(errors)
                ? errors[0]
                : errors;
              const errorMsg =
                errorData?.Msg ||
                errorData?.Msg?.[0] ||
                "Error desconocido de AFIP";
              console.error("[ARCA] Error de AFIP:", errorMsg);
              throw new Error(`Error de AFIP: ${errorMsg}`);
            }

            if (detalleData.Resultado === "R") {
              const obs = detalleData.Observaciones?.Obs;
              const obsArray = Array.isArray(obs)
                ? obs
                : obs
                ? [obs]
                : [];

              const normalizeObservation = (entry) => {
                if (!entry) return "";
                if (typeof entry === "string") return entry.trim();
                const code =
                  entry.Code ??
                  entry.code ??
                  entry.Codigo ??
                  entry.codigo ??
                  "";
                const msg =
                  entry.Msg ??
                  entry.msg ??
                  entry.Mensaje ??
                  entry.mensaje ??
                  entry.detail ??
                  entry.Detalle ??
                  "";
                const base = [code, msg].filter(Boolean).join(": ").trim();
                if (base) return base;
                try {
                  return JSON.stringify(entry);
                } catch {
                  return String(entry);
                }
              };

              const normalizedMessages = obsArray
                .map((entry) => normalizeObservation(entry))
                .filter((value) => value && value.length > 0);

              let obsMsg =
                normalizedMessages.length > 0
                  ? normalizedMessages.join("; ")
                  : obsArray.length > 0
                    ? (() => {
                      try {
                        return JSON.stringify(obsArray);
                      } catch {
                        return "sin detalle";
                      }
                    })()
                    : "sin detalle";

              if (!obsMsg || obsMsg === "sin detalle") {
                const fallbackParts = [];
                try {
                  fallbackParts.push(JSON.stringify(detalleData));
                } catch { /* ignore */ }
                try {
                  if (responseObj?.Errors) {
                    fallbackParts.push(JSON.stringify(responseObj.Errors));
                  }
                } catch { /* ignore */ }
                const fallbackMsg = fallbackParts
                  .map((part) => (part || "").slice(0, 500))
                  .filter(Boolean)
                  .join(" | ");
                if (fallbackMsg) {
                  obsMsg = fallbackMsg;
                }
              }

              console.error("[ARCA] Detalle rechazo AFIP:", JSON.stringify(detalleData, null, 2).slice(0, 1000));

              throw new Error(`AFIP rechazó la factura: ${obsMsg}`);
            }

            const extractValue = (obj, keys) => {
              for (const k of keys) {
                if (
                  obj[k] !== undefined &&
                  obj[k] !== null
                ) {
                  return Array.isArray(obj[k])
                    ? obj[k][0]
                    : obj[k];
                }
              }
              return undefined;
            };

            const cae = extractValue(detalleData, ["CAE", "cae"]);
            const vto_cae = extractValue(detalleData, [
              "CAEFchVto",
              "vto_cae",
            ]);
            const numero = extractValue(detalleData, [
              "CbteDesde",
              "CbteHasta",
              "numero",
            ]);
            const punto_venta = extractValue(detalleData, [
              "PtoVta",
              "punto_venta",
            ]);
            const fecha_emision = extractValue(detalleData, [
              "CbteFch",
              "fecha_emision",
            ]);

            console.log(
              "[ARCA] Detalle parseado:",
              JSON.stringify(detalleData, null, 2).substring(0, 500)
            );

            resolve({
              cae: cae || undefined,
              vto_cae: vto_cae || undefined,
              numero: numero || undefined,
              punto_venta: punto_venta || undefined,
              fecha_emision: fecha_emision || undefined,
            });
          } catch (parseErr) {
            reject(parseErr);
          }
        }
      );
    });
  } catch (err) {
    console.error("[ARCA] Error autorizando factura:", err.message);
    throw new Error(`Error autorizando factura en WSFE: ${err.message}`);
  }
}


// ============================================
// HELPERS
// ============================================

/**
 * Realiza un request a la API de Arca
 * @param {string} endpoint 
 * @param {string} method 
 * @param {object} body 
 * @param {number} tenantId - Opcional: para obtener credenciales desde BD
 */
async function arcaRequest(endpoint, method = "POST", body = null, tenantId = null) {
  // Obtener credenciales (desde BD si hay tenantId, sino desde env)
  let credentials;
  if (tenantId) {
    credentials = await getArcaCredentials(tenantId);
    // Si el tenant no tiene certificados propios, usar los del sistema
    if (!credentials.useCertificates && !credentials.apiKey) {
      const systemCreds = await getSystemCredentials();
      credentials.useCertificates = systemCreds.useCertificates;
      credentials.certPath = systemCreds.certPath;
      credentials.keyPath = systemCreds.keyPath;
      credentials.p12Path = systemCreds.p12Path;
      credentials.p12Password = systemCreds.p12Password;
      credentials.apiKey = systemCreds.apiKey;
      credentials.cuit = systemCreds.cuit;
      credentials.puntoVenta = credentials.puntoVenta || systemCreds.puntoVenta;
      credentials.apiUrl = systemCreds.apiUrl;
    }
  } else {
    credentials = await getSystemCredentials();
  }

  if (!credentials.cuit) {
    throw new Error("Falta CUIT de Arca. Configurá las credenciales en Configuración > Contacto");
  }

  // Si usa certificados, validar que existan
  if (credentials.useCertificates) {
    if (!credentials.certPath || !credentials.keyPath) {
      throw new Error("Certificados configurados pero no se encontraron archivos. Verificá la configuración.");
    }
    if (!fs.existsSync(credentials.certPath) || !fs.existsSync(credentials.keyPath)) {
      throw new Error("Los archivos de certificado no existen en las rutas configuradas.");
    }
  } else {
    // Validar API Key si no usa certificados
    if (!credentials.apiKey) {
      throw new Error("Falta API Key de Arca. Configurá las credenciales en Configuración > Contacto");
    }
  }

  const url = new URL(`${credentials.apiUrl}${endpoint}`);

  // Configurar opciones según el tipo de autenticación
  // Usar CUIT del sistema para autenticación, pero CUIT del tenant para facturar
  const headers = {
    "Content-Type": "application/json",
    "X-CUIT": credentials.cuit, // CUIT del sistema para autenticación
    ...(credentials.facturarCUIT && credentials.facturarCUIT !== credentials.cuit
      ? { "X-Tenant-CUIT": credentials.facturarCUIT } // CUIT del tenant para facturar
      : {}),
  };

  if (!credentials.useCertificates) {
    headers["Authorization"] = `Bearer ${credentials.apiKey}`;
  }

  // Si usa certificados, crear un https.Agent con los certificados
  let httpsAgent = null;
  if (credentials.useCertificates && url.protocol === 'https:') {
    try {
      // Intentar usar P12 primero (más común), sino usar CRT + KEY
      if (credentials.p12Path && fs.existsSync(credentials.p12Path)) {
        // Para P12, necesitamos usar la librería adecuada o convertirlo
        // Por ahora, intentar leerlo como PEM si está disponible
        // Nota: Para P12 necesitarías una librería como node-forge o similar
        // Por ahora, usamos CRT + KEY si están disponibles
        if (credentials.certPath && credentials.keyPath && fs.existsSync(credentials.certPath) && fs.existsSync(credentials.keyPath)) {
          const cert = fs.readFileSync(credentials.certPath);
          const key = fs.readFileSync(credentials.keyPath);

          httpsAgent = new https.Agent({
            cert: cert,
            key: key,
            rejectUnauthorized: true, // Validar certificados del servidor
          });
        } else {
          throw new Error("Certificado P12 encontrado pero no se puede usar directamente. Necesitás convertir a CRT + KEY o usar una librería para P12.");
        }
      } else if (credentials.certPath && credentials.keyPath && fs.existsSync(credentials.certPath) && fs.existsSync(credentials.keyPath)) {
        const cert = fs.readFileSync(credentials.certPath);
        const key = fs.readFileSync(credentials.keyPath);

        httpsAgent = new https.Agent({
          cert: cert,
          key: key,
          rejectUnauthorized: true, // Validar certificados del servidor
        });
      } else {
        throw new Error("Certificados configurados pero archivos no encontrados en las rutas especificadas.");
      }
    } catch (err) {
      throw new Error(`Error leyendo certificados: ${err.message}`);
    }
  }

  const options = {
    method,
    headers,
    ...(httpsAgent ? { agent: httpsAgent } : {}),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ARCA_TIMEOUT_MS);

  try {
    // Usar fetch si no hay certificados, o https.request si hay certificados
    let response;
    if (httpsAgent) {
      // Para certificados, usar https.request directamente
      response = await new Promise((resolve, reject) => {
        const req = https.request(url, {
          ...options,
          agent: httpsAgent,
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              statusText: res.statusMessage,
              text: async () => data,
              json: async () => {
                try {
                  return JSON.parse(data);
                } catch {
                  return { raw: data };
                }
              }
            });
          });
        });
        req.on('error', reject);
        if (body) {
          req.write(JSON.stringify(body));
        }
        req.end();

        // Timeout
        setTimeout(() => {
          req.destroy();
          reject(new Error("Timeout en request a Arca"));
        }, ARCA_TIMEOUT_MS);
      });
    } else {
      // Usar fetch normal para API Key
      response = await fetch(url, {
        ...options,
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    }

    clearTimeout(timeoutId);

    let text, data;

    if (httpsAgent) {
      // Ya tenemos la respuesta del Promise con métodos async
      text = await response.text();
      data = await response.json();
    } else {
      // Fetch normal
      text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      const errorMsg = data?.message || data?.error || text || "Error desconocido";
      throw new Error(`Arca API ${response.status}: ${errorMsg}`);
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === "AbortError" || err.message.includes("Timeout")) {
      throw new Error("Timeout en request a Arca");
    }

    throw err;
  }
}

// Exportar función para obtener credenciales
export { getArcaCredentials };

/**
 * Valida y formatea un CUIT/CUIL
 */
function formatCUIT(cuit) {
  const digits = String(cuit || "").replace(/\D/g, "");
  if (digits.length !== 11) return null;
  return digits;
}

/**
 * Calcula hash idempotente para una factura
 */
function computeInvoiceHash(data) {
  const key = JSON.stringify({
    type: data.tipo_comprobante,
    cuit: data.cuit_cliente,
    amount: data.importe_total,
    ref: data.referencia_interna,
  });
  return crypto.createHash("sha256").update(key).digest("hex");
}

// ============================================
// FUNCIONES PRINCIPALES
// ============================================

/**
 * Genera una factura electrónica
 * 
 * @param {Object} params
 * @param {number} params.tipo_comprobante - Tipo de comprobante (usar COMPROBANTE_TIPOS)
 * @param {number} params.concepto - Concepto (usar CONCEPTOS)
 * @param {string} params.cuit_cliente - CUIT del cliente
 * @param {number} params.tipo_doc_cliente - Tipo de documento (usar DOCUMENTO_TIPOS)
 * @param {string} params.doc_cliente - Número de documento
 * @param {string} params.razon_social - Razón social del cliente
 * @param {string} params.domicilio - Domicilio fiscal
 * @param {number} params.condicion_iva - Condición IVA (usar CONDICIONES_IVA)
 * @param {Array} params.items - Items de la factura [{descripcion, cantidad, precio_unitario, alicuota_iva}]
 * @param {number} params.importe_total - Importe total
 * @param {number} params.importe_neto - Importe neto (sin IVA)
 * @param {number} params.importe_iva - Importe IVA
 * @param {string} params.referencia_interna - Referencia interna (ej: appointment_id)
 * @param {string} params.observaciones - Observaciones opcionales
 * @param {number} params.tenantId - Opcional: ID del tenant para obtener credenciales desde BD
 * 
 * @returns {Object} { cae, vto_cae, numero, tipo_comprobante, punto_venta, fecha_emision }
 */
export async function generarFactura(params) {
  try {
    // Validaciones básicas
    if (!params.tipo_comprobante) {
      throw new Error("Falta tipo de comprobante");
    }

    if (!params.items || !Array.isArray(params.items) || params.items.length === 0) {
      throw new Error("Debe incluir al menos un item");
    }

    // Obtener credenciales del sistema y CUIT del tenant
    let credentials = params.tenantId
      ? await getArcaCredentials(params.tenantId)
      : await getSystemCredentials();

    // Si el tenant no tiene certificados propios, usar los del sistema
    if (params.tenantId && !credentials.useCertificates && !credentials.apiKey) {
      const systemCreds = await getSystemCredentials();
      credentials.useCertificates = systemCreds.useCertificates;
      credentials.certPath = systemCreds.certPath;
      credentials.keyPath = systemCreds.keyPath;
      credentials.p12Path = systemCreds.p12Path;
      credentials.p12Password = systemCreds.p12Password;
      credentials.apiKey = systemCreds.apiKey;
      credentials.cuit = systemCreds.cuit;
      credentials.puntoVenta = credentials.puntoVenta || systemCreds.puntoVenta;
      credentials.apiUrl = systemCreds.apiUrl;
    }

    // Si usa certificados, usar SOAP directamente con AFIP
    if (credentials.useCertificates && (!credentials.apiKey || !credentials.apiUrl || credentials.apiUrl.includes('api.arca.com.ar'))) {
      // Obtener ticket de acceso de WSAA (usar SERVICE del .env o "wsfe" por defecto)
      console.log("[ARCA] Obteniendo ticket de acceso de WSAA...");
      const { token, sign } = await obtenerTicketWSAA(ARCA_SERVICE, credentials);
      console.log("[ARCA] Ticket obtenido exitosamente");

      // Obtener próximo número de comprobante
      console.log("[ARCA] Obteniendo próximo número de comprobante...");
      const proximoNumero = await obtenerProximoNumeroWSFE(
        credentials,
        token,
        sign,
        params.tipo_comprobante,
        params.punto_venta || credentials.puntoVenta
      );
      console.log("[ARCA] Próximo número:", proximoNumero);

      // Preparar datos para WSFE
      const facturaData = {
        punto_venta: Number(params.punto_venta || credentials.puntoVenta),
        tipo_comprobante: Number(params.tipo_comprobante),
        concepto: Number(params.concepto || CONCEPTOS.SERVICIOS),
        numero: proximoNumero,
        cliente: {
          tipo_documento: Number(params.tipo_doc_cliente || DOCUMENTO_TIPOS.DNI),
          documento: String(params.doc_cliente || ""),
          razon_social: String(params.razon_social || "Consumidor Final"),
          domicilio: String(params.domicilio || ""),
          condicion_iva: Number(params.condicion_iva || CONDICIONES_IVA.CONSUMIDOR_FINAL),
        },
        importe_total: Number(params.importe_total || 0),
        importe_neto: Number(params.importe_neto || 0),
        importe_iva: Number(params.importe_iva || 0),
        cbtesAsoc: Array.isArray(params.cbtesAsoc) ? params.cbtesAsoc : undefined,
      };

      console.log("[ARCA] facturaData.cliente.condicion_iva:", facturaData.cliente.condicion_iva);

      // Autorizar factura en WSFE
      console.log("[ARCA] Autorizando factura en WSFE...");
      const wsfeResult = await autorizarFacturaWSFE(facturaData, credentials, token, sign);
      console.log("[ARCA] Factura autorizada:", wsfeResult);

      return {
        success: true,
        cae: wsfeResult.cae,
        vto_cae: wsfeResult.vto_cae,
        numero: wsfeResult.numero,
        tipo_comprobante: params.tipo_comprobante,
        punto_venta: wsfeResult.punto_venta,
        fecha_emision: wsfeResult.fecha_emision,
        pdf_url: null, // AFIP no proporciona PDF directamente
        xml_url: null, // Se puede generar el XML localmente
        hash: computeInvoiceHash(params),
      };
    }

    // Si hay tenantId, usar su CUIT para facturar; sino usar CUIT del sistema
    const cuitParaFacturar = params.tenantId
      ? (credentials.facturarCUIT || credentials.cuit)
      : credentials.cuit;

    // Formatear CUIT si viene
    const cuitCliente = params.cuit_cliente
      ? formatCUIT(params.cuit_cliente)
      : null;

    // Construir payload según formato de Arca
    // IMPORTANTE: El CUIT del emisor (quien factura) es el del tenant, no el del sistema
    const payload = {
      punto_venta: Number(params.punto_venta || credentials.puntoVenta),
      tipo_comprobante: Number(params.tipo_comprobante),
      concepto: Number(params.concepto || CONCEPTOS.SERVICIOS),

      // Emisor (quien factura) - usar CUIT del tenant
      emisor_cuit: cuitParaFacturar,

      // Cliente
      cliente: {
        tipo_documento: Number(params.tipo_doc_cliente || DOCUMENTO_TIPOS.DNI),
        documento: String(params.doc_cliente || ""),
        razon_social: String(params.razon_social || "Consumidor Final"),
        domicilio: String(params.domicilio || ""),
        condicion_iva: Number(params.condicion_iva || CONDICIONES_IVA.CONSUMIDOR_FINAL),
        ...(cuitCliente ? { cuit: cuitCliente } : {}),
      },

      // Items
      items: params.items.map((item) => ({
        descripcion: String(item.descripcion).slice(0, 200),
        cantidad: Number(item.cantidad || 1),
        precio_unitario: Number(item.precio_unitario || 0),
        alicuota_iva: Number(item.alicuota_iva ?? 21), // 21% por defecto
        ...(item.codigo ? { codigo: String(item.codigo) } : {}),
      })),

      // Totales
      importe_total: Number(params.importe_total || 0),
      importe_neto: Number(params.importe_neto || 0),
      importe_iva: Number(params.importe_iva || 0),

      // Metadata
      ...(params.referencia_interna ? {
        referencia_interna: String(params.referencia_interna)
      } : {}),
      ...(params.observaciones ? {
        observaciones: String(params.observaciones).slice(0, 500)
      } : {}),
      ...(params.comprobante_asociado ? {
        comprobante_asociado: {
          tipo: Number(params.comprobante_asociado.tipo),
          punto_venta: Number(params.comprobante_asociado.punto_venta),
          numero: Number(params.comprobante_asociado.numero),
        }
      } : {}),
    };

    // Request a Arca
    const response = await arcaRequest("/facturas", "POST", payload, params.tenantId);

    // Parsear respuesta
    return {
      success: true,
      cae: response.cae,
      vto_cae: response.vencimiento_cae,
      numero: response.numero_comprobante,
      tipo_comprobante: response.tipo_comprobante,
      punto_venta: response.punto_venta,
      fecha_emision: response.fecha_emision,
      pdf_url: response.pdf_url || null,
      xml_url: response.xml_url || null,
      hash: computeInvoiceHash(params),
    };
  } catch (err) {
    console.error("[ARCA] Error generando factura:", err.message);
    throw new Error(`Error al generar factura: ${err.message}`);
  }
}

/**
 * Consulta el estado de una factura por CAE
 * @param {string} cae 
 * @param {number} tenantId - Opcional: para obtener credenciales desde BD
 */
export async function consultarFactura(cae, tenantId = null) {
  try {
    const response = await arcaRequest(`/facturas/${cae}`, "GET", null, tenantId);
    return response;
  } catch (err) {
    console.error("[ARCA] Error consultando factura:", err.message);
    throw err;
  }
}

/**
 * Genera una nota de crédito
 * @param {Object} params - Parámetros similares a generarFactura, más comprobante_asociado
 */
export async function generarNotaCredito(params) {
  const {
    tipo_comprobante_original,
    punto_venta_original,
    numero_original,
    cbtesAsoc,
    comprobante_asociado,
    ...rest
  } = params;

  const tipoNotaCredito = tipo_comprobante_original === COMPROBANTE_TIPOS.FACTURA_A
    ? COMPROBANTE_TIPOS.NOTA_CREDITO_A
    : tipo_comprobante_original === COMPROBANTE_TIPOS.FACTURA_B
      ? COMPROBANTE_TIPOS.NOTA_CREDITO_B
      : COMPROBANTE_TIPOS.NOTA_CREDITO_C;

  const asociados = Array.isArray(cbtesAsoc) && cbtesAsoc.length > 0
    ? cbtesAsoc
    : [
      {
        Tipo: tipo_comprobante_original,
        PtoVta: punto_venta_original,
        Nro: numero_original,
      },
    ];

  const comprobanteAsociadoRest = comprobante_asociado || {
    tipo: tipo_comprobante_original,
    punto_venta: punto_venta_original,
    numero: numero_original,
  };

  return generarFactura({
    ...rest,
    tipo_comprobante: tipoNotaCredito,
    tipo_comprobante_original,
    punto_venta_original,
    numero_original,
    cbtesAsoc: asociados,
    comprobante_asociado: comprobanteAsociadoRest,
  });
}

/**
 * Obtiene el próximo número de comprobante disponible
 * @param {number} tipoComprobante 
 * @param {number} tenantId - Opcional: para obtener credenciales desde BD
 */
export async function obtenerProximoNumero(tipoComprobante, tenantId = null) {
  try {
    const credentials = tenantId
      ? await getArcaCredentials(tenantId)
      : {
        puntoVenta: ARCA_PUNTO_VENTA,
        apiUrl: ARCA_API_URL,
      };

    const response = await arcaRequest(
      `/comprobantes/proximo-numero?tipo=${tipoComprobante}&punto_venta=${credentials.puntoVenta}`,
      "GET",
      null,
      tenantId
    );
    return response.proximo_numero || 1;
  } catch (err) {
    console.error("[ARCA] Error obteniendo próximo número:", err.message);
    return 1;
  }
}

/**
 * Verifica la conexión con Arca
 * @param {number} tenantId - Opcional: para obtener credenciales desde BD
 */
export async function verificarConexion(tenantId = null) {
  try {
    // Verificar primero si hay credenciales configuradas
    let credentials;
    if (tenantId) {
      credentials = await getArcaCredentials(tenantId);
      // Si el tenant no tiene certificados propios, usar los del sistema
      if (!credentials.useCertificates && !credentials.apiKey) {
        const systemCreds = await getSystemCredentials();
        credentials.useCertificates = systemCreds.useCertificates;
        credentials.certPath = systemCreds.certPath;
        credentials.keyPath = systemCreds.keyPath;
        credentials.p12Path = systemCreds.p12Path;
        credentials.p12Password = systemCreds.p12Password;
        credentials.apiKey = systemCreds.apiKey;
        credentials.cuit = systemCreds.cuit;
        credentials.puntoVenta = credentials.puntoVenta || systemCreds.puntoVenta;
        credentials.apiUrl = systemCreds.apiUrl;
      }
    } else {
      credentials = await getSystemCredentials();
    }

    // Verificar CUIT del tenant (si se está facturando para un tenant específico)
    let tenantCUIT = null;
    if (tenantId) {
      try {
        const [[cuitConfig]] = await pool.query(
          `SELECT config_value FROM system_config 
           WHERE tenant_id = ? AND config_key = 'contact.arca_cuit'`,
          [tenantId]
        );
        tenantCUIT = cuitConfig?.config_value ? cuitConfig.config_value.replace(/\D/g, '') : null;
      } catch (err) {
        console.error("[ARCA] Error obteniendo CUIT del tenant:", err);
      }
    }

    // Verificar credenciales del sistema
    if (!credentials.cuit) {
      return {
        ok: false,
        error: "Falta CUIT del sistema. Configurá ARCA_CUIT en el servidor (.env).",
        tenantCUIT: tenantCUIT,
        details: "El sistema necesita un CUIT para autenticarse con ARCA. Configurá ARCA_CUIT en el archivo .env del servidor."
      };
    }

    // Si usa certificados, verificar que existan
    if (credentials.useCertificates) {
      const hasCert = credentials.certPath && fs.existsSync(credentials.certPath);
      const hasKey = credentials.keyPath && fs.existsSync(credentials.keyPath);
      const hasP12 = credentials.p12Path && fs.existsSync(credentials.p12Path);

      // Si hay P12, intentar validar que se pueda abrir
      if (hasP12) {
        // Intentar abrir el P12 para verificar que funciona (puede tener contraseña vacía)
        try {
          const testExtract = extractP12Certificates(credentials.p12Path, credentials.p12Password || "");
          // P12 está configurado correctamente - validación completa
        } catch (p12Err) {
          // Si falla, puede ser que necesite contraseña
          if (p12Err.message.includes('contraseña') || p12Err.message.includes('password')) {
            return {
              ok: false,
              error: "Certificado P12 encontrado pero la contraseña es incorrecta o falta. Configurá P12_PASS en el .env.",
              tenantCUIT: tenantCUIT,
              details: `Certificado P12 encontrado en: ${credentials.p12Path}. Error al abrir: ${p12Err.message}. Si el certificado no tiene contraseña, dejá P12_PASS vacío en el .env.`,
              p12Path: credentials.p12Path,
              p12Error: p12Err.message
            };
          }
          return {
            ok: false,
            error: `Error al validar el certificado P12: ${p12Err.message}`,
            tenantCUIT: tenantCUIT,
            details: `Certificado P12 en: ${credentials.p12Path}. Error: ${p12Err.message}`,
            p12Path: credentials.p12Path
          };
        }
      } else if (!hasCert || !hasKey) {
        // No hay P12 ni certificados separados
        const p12PathInfo = credentials.p12Path
          ? `P12_PATH configurado: ${credentials.p12Path} (${fs.existsSync(credentials.p12Path) ? 'existe' : 'NO existe'})`
          : 'P12_PATH no configurado en .env';

        return {
          ok: false,
          error: "Certificados configurados pero no se encontraron archivos. Verificá P12_PATH en .env o colocá los certificados (.crt y .key) en backend/src/arca/.",
          tenantCUIT: tenantCUIT,
          details: `${p12PathInfo}. Buscando certificados en: ${credentials.certPath || 'N/A'} (${credentials.certPath && fs.existsSync(credentials.certPath) ? 'existe' : 'NO existe'}) y ${credentials.keyPath || 'N/A'} (${credentials.keyPath && fs.existsSync(credentials.keyPath) ? 'existe' : 'NO existe'})`
        };
      }

      // Si usa certificados, solo validar configuración (no intentar conexión REST porque AFIP usa SOAP)
      // La conexión real se hará cuando se intente facturar usando WSAA/WSFE
      const certType = hasP12 ? 'P12' : 'CRT/KEY';
      const certInfo = hasP12
        ? `Certificado P12: ${credentials.p12Path}`
        : `Certificado: ${credentials.certPath}, Clave: ${credentials.keyPath}`;

      return {
        ok: true,
        tenantCUIT: tenantCUIT,
        message: tenantCUIT
          ? `✓ Configuración correcta. CUIT configurado: ${tenantCUIT}. ${certType} detectado. Listo para facturar.`
          : `✓ Configuración correcta. ${certType} detectado. Configurá tu CUIT en Configuración > Contacto para facturar.`,
        configured: true,
        certificatesFound: true,
        certType: certType,
        certPath: credentials.p12Path || credentials.certPath,
        keyPath: credentials.keyPath,
        p12Path: credentials.p12Path
      };
    } else {
      // Si no usa certificados, verificar API Key
      if (!credentials.apiKey) {
        return {
          ok: false,
          error: "Falta API Key del sistema. Configurá ARCA_API_KEY en el servidor (.env) o colocá certificados en backend/src/arca/.",
          tenantCUIT: tenantCUIT,
          details: "El sistema necesita una API Key o certificados para autenticarse con ARCA. Configurá ARCA_API_KEY en .env o colocá los certificados en backend/src/arca/."
        };
      }
    }

    // Si usa API Key (servicio intermediario), intentar conexión real
    if (credentials.apiKey && credentials.apiUrl) {
      try {
        const response = await arcaRequest("/health", "GET", null, tenantId);
        return {
          ok: true,
          ...response,
          tenantCUIT: tenantCUIT,
          message: tenantCUIT
            ? `Conexión OK. CUIT configurado: ${tenantCUIT}. Listo para facturar.`
            : "Conexión OK. Configurá tu CUIT en Configuración > Contacto para facturar."
        };
      } catch (connectionErr) {
        // Si falla la conexión pero las credenciales están configuradas, dar un mensaje más específico
        return {
          ok: false,
          error: connectionErr.message || "Error de conexión con ARCA",
          tenantCUIT: tenantCUIT,
          details: `Credenciales configuradas correctamente, pero falló la conexión con ARCA: ${connectionErr.message}. Verificá que el servidor ARCA esté disponible o que la URL sea correcta.`
        };
      }
    }

    // Si no tiene ni certificados ni API Key
    return {
      ok: false,
      error: "No hay credenciales configuradas",
      tenantCUIT: tenantCUIT,
      details: "Configurá certificados en backend/src/arca/ o configura ARCA_API_KEY en el .env"
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      details: "Verificá que las credenciales del sistema estén configuradas en el servidor (.env) o que los certificados estén en backend/src/arca/"
    };
  }
}

// ============================================
// HELPERS DE NEGOCIO
// ============================================

/**
 * Calcula IVA y totales para un monto
 */
export function calcularIVA(montoNeto, alicuota = 21) {
  const iva = Math.round((montoNeto * alicuota) / 100 * 100) / 100;
  const total = Math.round((montoNeto + iva) * 100) / 100;

  return {
    neto: montoNeto,
    iva,
    total,
  };
}

/**
 * Determina el tipo de comprobante según condición IVA del cliente
 */
export function determinarTipoComprobante(condicionIvaCliente) {
  switch (condicionIvaCliente) {
    case CONDICIONES_IVA.RESPONSABLE_INSCRIPTO:
      return COMPROBANTE_TIPOS.FACTURA_A;
    case CONDICIONES_IVA.MONOTRIBUTISTA:
      return COMPROBANTE_TIPOS.FACTURA_B;
    case CONDICIONES_IVA.CONSUMIDOR_FINAL:
    case CONDICIONES_IVA.EXENTO:
    default:
      return COMPROBANTE_TIPOS.FACTURA_B; // o C según tu caso
  }
}

/**
 * Valida que los datos del cliente sean suficientes para facturar
 */
export function validarDatosFacturacion(cliente) {
  const errors = [];

  if (!cliente.razon_social && !cliente.nombre) {
    errors.push("Falta razón social o nombre del cliente");
  }

  if (!cliente.documento && !cliente.cuit) {
    errors.push("Falta documento o CUIT del cliente");
  }

  if (cliente.condicion_iva === CONDICIONES_IVA.RESPONSABLE_INSCRIPTO) {
    if (!cliente.cuit || !formatCUIT(cliente.cuit)) {
      errors.push("Responsables inscriptos deben tener CUIT válido");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ==== RG 5616: Condición IVA del receptor (FEParamGetCondicionIvaReceptor) ====
const IVA_RECEPTOR_MIN = 1;
const IVA_RECEPTOR_MAX = 7;
// B/C y sus notas (B: 6, C: 11, NDB: 7, NDC: 12, NCB: 8, NCC: 13)
const CBTE_REQUIERE_IVACOND = new Set([6, 11, 7, 12, 8, 13]);

function requiereIvaCond(cbteTipo) {
  return CBTE_REQUIERE_IVACOND.has(Number(cbteTipo));
}

function mapCondicionIvaReceptor(valorApp) {
  const n = Number(valorApp);
  return Number.isInteger(n) && n >= IVA_RECEPTOR_MIN && n <= IVA_RECEPTOR_MAX ? n : null;
}