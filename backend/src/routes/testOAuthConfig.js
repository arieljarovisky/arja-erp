// Script de diagnóstico para verificar configuración OAuth
// Ejecutar con: node src/routes/testOAuthConfig.js

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

console.log('🔍 Verificando configuración OAuth...\n');

if (!GOOGLE_CLIENT_ID) {
  console.error('❌ GOOGLE_CLIENT_ID no está configurado');
  console.log('   Configura esta variable de entorno en Railway:\n');
  console.log('   Name: GOOGLE_CLIENT_ID');
  console.log('   Value: [Tu Client ID de Google Cloud Console]\n');
} else {
  console.log('✅ GOOGLE_CLIENT_ID está configurado:');
  console.log(`   ${GOOGLE_CLIENT_ID.substring(0, 20)}...`);
}

if (!GOOGLE_CLIENT_SECRET) {
  console.error('❌ GOOGLE_CLIENT_SECRET no está configurado');
  console.log('   Configura esta variable de entorno en Railway:\n');
  console.log('   Name: GOOGLE_CLIENT_SECRET');
  console.log('   Value: [Tu Client Secret de Google Cloud Console]\n');
} else {
  console.log('✅ GOOGLE_CLIENT_SECRET está configurado:');
  console.log(`   ${GOOGLE_CLIENT_SECRET.substring(0, 10)}...`);
}

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.log('\n📝 Pasos para configurar:');
  console.log('1. Ve a Railway: https://railway.app/');
  console.log('2. Selecciona tu proyecto → Servicio (backend)');
  console.log('3. Ve a la pestaña "Variables"');
  console.log('4. Agrega las dos variables de entorno');
  console.log('5. Reinicia el servicio');
} else {
  console.log('\n✅ La configuración parece estar correcta');
}

