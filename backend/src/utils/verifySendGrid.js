// Script para verificar configuración de SendGrid
// Ejecutar con: node src/utils/verifySendGrid.js

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Cargar variables de entorno
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

console.log("🔍 Verificación de Configuración SendGrid");
console.log("=".repeat(50));
console.log();

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM;

// 1. Verificar SMTP_HOST
console.log("1️⃣ SMTP_HOST:");
if (SMTP_HOST === 'smtp.sendgrid.net') {
  console.log(`   ✅ Correcto: ${SMTP_HOST}`);
} else {
  console.log(`   ❌ Incorrecto: ${SMTP_HOST || '(no configurado)'}`);
  console.log(`   → Debe ser: smtp.sendgrid.net`);
}

// 2. Verificar SMTP_PORT
console.log("\n2️⃣ SMTP_PORT:");
if (SMTP_PORT === '587' || SMTP_PORT === '465') {
  console.log(`   ✅ Correcto: ${SMTP_PORT}`);
} else {
  console.log(`   ⚠️  Recomendado: 587 (actual: ${SMTP_PORT || '(no configurado)'})`);
}

// 3. Verificar SMTP_USER
console.log("\n3️⃣ SMTP_USER:");
if (SMTP_USER === 'apikey') {
  console.log(`   ✅ Correcto: "${SMTP_USER}"`);
} else {
  console.log(`   ❌ Incorrecto: "${SMTP_USER || '(no configurado)'}"`);
  console.log(`   → Debe ser exactamente: "apikey" (en minúsculas, sin comillas)`);
  console.log(`   → Actual: "${SMTP_USER}"`);
  if (SMTP_USER) {
    console.log(`   → Tiene ${SMTP_USER.length} caracteres`);
    if (SMTP_USER !== SMTP_USER.toLowerCase()) {
      console.log(`   → ⚠️  Tiene mayúsculas (debe ser todo minúsculas)`);
    }
    if (SMTP_USER.includes(' ')) {
      console.log(`   → ⚠️  Tiene espacios (no debe tener espacios)`);
    }
  }
}

// 4. Verificar SMTP_PASS (API Key)
console.log("\n4️⃣ SMTP_PASS (API Key):");
if (!SMTP_PASS) {
  console.log(`   ❌ No configurado`);
} else {
  const passLength = SMTP_PASS.length;
  const startsWithSG = SMTP_PASS.startsWith('SG.');
  const hasSpaces = SMTP_PASS.includes(' ');
  const cleanPass = SMTP_PASS.replace(/\s/g, '');
  
  console.log(`   Longitud: ${passLength} caracteres`);
  console.log(`   Empieza con "SG.": ${startsWithSG ? '✅' : '❌'}`);
  console.log(`   Tiene espacios: ${hasSpaces ? '❌ (tiene espacios)' : '✅'}`);
  
  if (hasSpaces) {
    console.log(`   → Versión sin espacios: ${cleanPass.length} caracteres`);
    console.log(`   → ⚠️  El código elimina espacios automáticamente, pero es mejor sin espacios`);
  }
  
  if (startsWithSG && passLength > 50) {
    console.log(`   ✅ Parece un API Key válido`);
    console.log(`   Primeros caracteres: ${SMTP_PASS.substring(0, 15)}...`);
  } else {
    console.log(`   ⚠️  El API Key debería:`);
    console.log(`      - Empezar con "SG."`);
    console.log(`      - Tener aproximadamente 70 caracteres`);
    console.log(`      - No tener espacios`);
  }
}

// 5. Verificar SMTP_FROM
console.log("\n5️⃣ SMTP_FROM:");
if (SMTP_FROM) {
  console.log(`   ✅ Configurado: ${SMTP_FROM}`);
  const emailMatch = SMTP_FROM.match(/<(.+?)>/);
  if (emailMatch) {
    const email = emailMatch[1];
    console.log(`   Email extraído: ${email}`);
    console.log(`   → Este email debe estar verificado en SendGrid`);
    console.log(`   → Verificar en: https://app.sendgrid.com/settings/sender_auth`);
  }
} else {
  console.log(`   ⚠️  No configurado (usará SMTP_USER como remitente)`);
}

// Resumen
console.log("\n" + "=".repeat(50));
console.log("📝 Resumen:");
console.log();

const errors = [];
const warnings = [];

if (SMTP_HOST !== 'smtp.sendgrid.net') errors.push('SMTP_HOST incorrecto');
if (SMTP_USER !== 'apikey') errors.push('SMTP_USER debe ser "apikey"');
if (!SMTP_PASS) errors.push('SMTP_PASS no configurado');
if (SMTP_PASS && !SMTP_PASS.startsWith('SG.')) errors.push('SMTP_PASS no parece un API Key válido (debe empezar con SG.)');
if (SMTP_PASS && SMTP_PASS.includes(' ')) warnings.push('SMTP_PASS tiene espacios (se eliminarán automáticamente)');

if (errors.length === 0 && warnings.length === 0) {
  console.log("✅ Configuración correcta!");
  console.log("\n💡 Próximos pasos:");
  console.log("   1. Verificar que el API Key esté activo en SendGrid");
  console.log("   2. Verificar que el email del remitente esté verificado");
  console.log("   3. Reiniciar el servidor y probar");
} else {
  if (errors.length > 0) {
    console.log("❌ Errores encontrados:");
    errors.forEach(err => console.log(`   - ${err}`));
  }
  if (warnings.length > 0) {
    console.log("\n⚠️  Advertencias:");
    warnings.forEach(warn => console.log(`   - ${warn}`));
  }
  console.log("\n💡 Corrige los errores y vuelve a ejecutar este script");
}

