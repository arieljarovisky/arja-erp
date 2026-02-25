/**
 * Setup global para Jest
 * Se ejecuta una vez antes de todos los tests
 */
import { setupTestDatabase } from './db.test.js';

export default async function globalSetup() {
  console.log('🔧 Configurando entorno de test...');
  
  // Configurar variables de entorno para tests
  process.env.NODE_ENV = 'test';
  
  try {
    // Inicializar base de datos de test
    await setupTestDatabase();
    console.log('✅ Setup global completado');
  } catch (error) {
    console.error('❌ Error en setup global:', error.message);
    // No lanzar error para permitir que los tests unitarios corran sin BD
    console.warn('⚠️ Continuando sin base de datos de test (algunos tests pueden fallar)');
  }
}

