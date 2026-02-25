// Script de diagnóstico SMTP para producción
// Ejecutar con: node src/utils/smtpDiagnostic.js

import dotenv from "dotenv";
import { createConnection } from "net";
import { lookup } from "dns/promises";
import dns from "dns";
import https from "https";
import http from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Cargar variables de entorno desde .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);

if (!SMTP_HOST) {
  console.error("❌ SMTP_HOST no está configurado");
  console.error("\n💡 Verifica que:");
  console.error("   1. Existe un archivo .env en la raíz del proyecto");
  console.error("   2. El archivo .env contiene: SMTP_HOST=tu-servidor-smtp.com");
  console.error("   3. Estás ejecutando el script desde la raíz del proyecto");
  console.error("\nEjemplo de .env:");
  console.error("   SMTP_HOST=smtp.gmail.com");
  console.error("   SMTP_PORT=587");
  console.error("   SMTP_USER=tu-email@gmail.com");
  console.error("   SMTP_PASS=tu-contraseña");
  process.exit(1);
}

console.log("🔍 Diagnóstico SMTP");
console.log("==================\n");
console.log(`Host: ${SMTP_HOST}`);
console.log(`Port: ${SMTP_PORT}\n`);

// 1. Verificar DNS
console.log("1️⃣ Verificando resolución DNS...");
try {
  const addresses = await lookup(SMTP_HOST, { all: true });
  console.log(`✅ DNS resuelto correctamente:`);
  addresses.forEach((addr, i) => {
    console.log(`   ${i + 1}. ${addr.address} (IPv${addr.family === 4 ? '4' : '6'})`);
  });
} catch (error) {
  console.error(`❌ Error de DNS: ${error.message}`);
  console.error("   → Verifica que el hostname sea correcto");
  process.exit(1);
}

// 2. Verificar conectividad TCP
console.log("\n2️⃣ Verificando conectividad TCP...");
const tcpCheck = await new Promise((resolve) => {
  const socket = createConnection({ 
    host: SMTP_HOST, 
    port: SMTP_PORT, 
    timeout: 10000 
  }, () => {
    socket.destroy();
    resolve({ success: true });
  });

  socket.on('error', (error) => {
    socket.destroy();
    resolve({ success: false, error: error.message, code: error.code });
  });

  socket.on('timeout', () => {
    socket.destroy();
    resolve({ success: false, error: 'Connection timeout', code: 'ETIMEDOUT' });
  });
});

if (tcpCheck.success) {
  console.log(`✅ Conectividad TCP OK: ${SMTP_HOST}:${SMTP_PORT}`);
} else {
  console.error(`❌ Error de conectividad TCP: ${tcpCheck.error}`);
  console.error(`   Código: ${tcpCheck.code}`);
  
  if (tcpCheck.code === 'ETIMEDOUT' || tcpCheck.code === 'ECONNREFUSED') {
    console.error("\n⚠️  Posibles causas:");
    console.error("   1. Firewall bloqueando el puerto " + SMTP_PORT);
    console.error("   2. El servidor SMTP requiere whitelist de IP");
    console.error("   3. El servidor SMTP no permite conexiones externas");
    console.error("\n💡 Soluciones:");
    console.error("   → Obtener la IP pública del servidor:");
    console.error("     curl ifconfig.me");
    console.error("   → Agregar esa IP a la whitelist del SMTP");
    console.error("   → Verificar reglas de firewall del servidor");
  }
}

// 3. Obtener IP pública del servidor
console.log("\n3️⃣ Obteniendo IP pública del servidor...");
try {
  const publicIP = await new Promise((resolve, reject) => {
    https.get('https://api.ipify.org?format=json', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data).ip);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
  
  console.log(`✅ IP pública: ${publicIP}`);
  console.log(`\n📋 Acción requerida:`);
  console.log(`   Agregar esta IP (${publicIP}) a la whitelist de tu servidor SMTP`);
  console.log(`   - Gmail/Google Workspace: Configuración > Seguridad > IP permitidas`);
  console.log(`   - Outlook/Office 365: Centro de administración > IP permitidas`);
  console.log(`   - Otros: Revisar documentación del proveedor`);
} catch (error) {
  console.warn(`⚠️  No se pudo obtener la IP pública: ${error.message}`);
  console.warn(`   Puedes obtenerla manualmente con: curl ifconfig.me`);
}

// 4. Verificar variables de entorno
console.log("\n4️⃣ Verificando variables de entorno...");
const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
const missing = required.filter(key => !process.env[key]);

if (missing.length === 0) {
  console.log("✅ Todas las variables requeridas están configuradas");
  console.log(`   SMTP_HOST: ${process.env.SMTP_HOST}`);
  console.log(`   SMTP_PORT: ${process.env.SMTP_PORT}`);
  console.log(`   SMTP_USER: ${process.env.SMTP_USER ? '✅ configurado' : '❌ faltante'}`);
  console.log(`   SMTP_PASS: ${process.env.SMTP_PASS ? '✅ configurado' : '❌ faltante'}`);
} else {
  console.error(`❌ Variables faltantes: ${missing.join(', ')}`);
}

console.log("\n" + "=".repeat(50));
console.log("📝 Resumen:");
if (tcpCheck.success) {
  console.log("✅ La conectividad básica funciona");
  console.log("   El problema puede ser de autenticación o configuración SMTP");
} else {
  console.log("❌ La conectividad TCP falla");
  console.log("   Necesitas resolver el problema de red/firewall primero");
}

