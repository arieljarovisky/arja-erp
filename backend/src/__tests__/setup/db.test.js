/**
 * Configuración de base de datos para tests
 * Crea un pool separado para tests usando variables de entorno de test
 */
import { createPool } from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cargar variables de entorno de test (si existe)
// Primero intenta .env.test, luego .env como fallback
try {
  dotenv.config({ path: join(__dirname, '../../../.env.test') });
} catch (error) {
  // Si no existe .env.test, usar .env normal
  dotenv.config();
}

// Configuración de pool para tests
const testPoolConfig = {
  host: process.env.TEST_DB_HOST || process.env.DB_HOST || 'localhost',
  port: Number(process.env.TEST_DB_PORT || process.env.DB_PORT || 3306),
  user: process.env.TEST_DB_USER || process.env.DB_USER || 'root',
  password: process.env.TEST_DB_PASS || process.env.DB_PASS || '',
  database: process.env.TEST_DB_NAME || 'pelu_turnos',
  waitForConnections: true,
  decimalNumbers: true,
  connectionLimit: 5, // Menos conexiones para tests
  queueLimit: 0,
  timezone: "-03:00",
  dateStrings: true,
  connectTimeout: 10000,
  // Removidas opciones no válidas para mysql2
  // acquireTimeout y timeout no son opciones válidas del pool
};

// Pool de test (lazy initialization para evitar errores si no hay BD configurada)
let testPoolInstance = null;

export function getTestPool() {
  if (!testPoolInstance) {
    try {
      testPoolInstance = createPool(testPoolConfig);
    } catch (error) {
      console.warn('⚠️ No se pudo crear pool de test:', error.message);
      throw error;
    }
  }
  return testPoolInstance;
}

// Export para compatibilidad - usar getTestPool() en su lugar
export { getTestPool as testPool };

// Función para limpiar todas las tablas de test
export async function cleanupTestDatabase() {
  const pool = getTestPool();
  if (!pool) return;
  
  // Desactivar foreign keys temporalmente
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  
  // Lista de tablas a limpiar (ajustar según tu esquema)
  const tables = [
    'appointment',
    'customer',
    'service',
    'instructor',
    'users',
    'tenant_branch',
    'tenant',
    'payment',
    'stock_product',
    'stock_movement',
    'notification',
    'time_off',
    'working_hours',
    // Agregar más tablas según necesites
  ];

  for (const table of tables) {
    try {
      await pool.query(`TRUNCATE TABLE ${table}`);
    } catch (error) {
      // Si la tabla no existe, continuar
      if (error.code !== 'ER_NO_SUCH_TABLE') {
        console.warn(`No se pudo limpiar la tabla ${table}:`, error.message);
      }
    }
  }

  // Reactivar foreign keys
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

// Función para inicializar la base de datos de test
export async function setupTestDatabase() {
  try {
    const pool = getTestPool();
    if (!pool) {
      throw new Error('No se pudo crear pool de test');
    }
    
    // Verificar conexión
    await pool.query('SELECT 1');
    console.log('✅ Base de datos de test conectada');
    
    // Limpiar datos anteriores
    await cleanupTestDatabase();
    console.log('✅ Base de datos de test limpiada');
    
    return true;
  } catch (error) {
    console.error('❌ Error configurando base de datos de test:', error.message);
    throw error;
  }
}

// Función para cerrar el pool de test
export async function closeTestDatabase() {
  if (testPoolInstance) {
    await testPoolInstance.end();
    testPoolInstance = null;
    console.log('✅ Pool de test cerrado');
  }
}

