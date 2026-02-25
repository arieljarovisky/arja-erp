/**
 * Teardown global para Jest
 * Se ejecuta una vez después de todos los tests
 */
import { closeTestDatabase } from './db.test.js';

export default async function globalTeardown() {
  console.log('🧹 Limpiando entorno de test...');
  
  try {
    // Cerrar pool de test
    await closeTestDatabase();
    console.log('✅ Teardown global completado');
  } catch (error) {
    console.error('❌ Error en teardown global:', error.message);
  }
}

