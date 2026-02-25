// Script para debuggear la carga de .env.test
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🔍 Debug de variables de entorno...\n');

// Intentar cargar .env.test
const envTestPath = join(__dirname, '..', '.env.test');
console.log(`📁 Buscando archivo: ${envTestPath}`);

const result = dotenv.config({ path: envTestPath });

if (result.error) {
  console.log('❌ Error al cargar .env.test:', result.error.message);
} else {
  console.log('✅ Archivo .env.test cargado\n');
}

console.log('📋 Variables de entorno detectadas:');
console.log(`   TEST_DB_HOST: "${process.env.TEST_DB_HOST || 'NO DEFINIDO'}"`);
console.log(`   TEST_DB_PORT: "${process.env.TEST_DB_PORT || 'NO DEFINIDO'}"`);
console.log(`   TEST_DB_USER: "${process.env.TEST_DB_USER || 'NO DEFINIDO'}"`);
console.log(`   TEST_DB_PASS: "${process.env.TEST_DB_PASS ? '***' + process.env.TEST_DB_PASS.slice(-2) : 'NO DEFINIDO'}" (longitud: ${process.env.TEST_DB_PASS?.length || 0})`);
console.log(`   TEST_DB_NAME: "${process.env.TEST_DB_NAME || 'NO DEFINIDO'}"`);

console.log('\n💡 Si alguna variable muestra "NO DEFINIDO", verifica:');
console.log('   1. Que el archivo .env.test exista');
console.log('   2. Que no tenga espacios alrededor del =');
console.log('   3. Que no tenga comillas alrededor de los valores');

