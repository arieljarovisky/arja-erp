// Script para verificar el password exacto
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envTestPath = join(__dirname, '..', '.env.test');

console.log('🔍 Analizando archivo .env.test...\n');

try {
  const content = readFileSync(envTestPath, 'utf-8');
  const lines = content.split('\n');
  
  const passLine = lines.find(line => line.trim().startsWith('TEST_DB_PASS'));
  
  if (passLine) {
    console.log('📋 Línea encontrada:');
    console.log(`   "${passLine}"`);
    console.log('');
    
    const match = passLine.match(/TEST_DB_PASS\s*=\s*(.+)/);
    if (match) {
      const password = match[1].trim();
      console.log(`🔑 Password extraído: "${password}"`);
      console.log(`📏 Longitud: ${password.length} caracteres`);
      console.log(`🔢 Códigos ASCII: ${password.split('').map(c => c.charCodeAt(0)).join(', ')}`);
      
      // Verificar si tiene espacios
      if (password !== password.trim()) {
        console.log('⚠️  El password tiene espacios al inicio o final!');
      }
      
      // Verificar si tiene comillas
      if (password.startsWith('"') || password.startsWith("'")) {
        console.log('⚠️  El password tiene comillas! Debe estar sin comillas.');
      }
    }
  } else {
    console.log('❌ No se encontró la línea TEST_DB_PASS');
  }
  
  // Cargar con dotenv y comparar
  dotenv.config({ path: envTestPath });
  const envPassword = process.env.TEST_DB_PASS || '';
  console.log(`\n📦 Password desde process.env: "${envPassword}"`);
  console.log(`📏 Longitud: ${envPassword.length} caracteres`);
  
} catch (error) {
  console.error('❌ Error:', error.message);
}

