/**
 * Helpers para tests de integración
 */
import { getTestPool as getTestPoolFromDb } from './db.test.js';

/**
 * Obtiene el pool de test
 */
export function getTestPool() {
  try {
    return getTestPoolFromDb();
  } catch (error) {
    // Si no hay BD configurada, retornar null
    console.warn('⚠️ Pool de test no disponible:', error.message);
    return null;
  }
}

/**
 * Crea un usuario de prueba en la base de datos
 */
export async function createTestUser(pool = null, { email, password, tenantId, role = 'user' }) {
  if (!pool) pool = getTestPool();
  const bcrypt = await import('bcryptjs');
  const hashedPassword = await bcrypt.hash(password, 10);

  const [result] = await pool.query(
    `INSERT INTO users (email, password_hash, tenant_id, role, is_active)
     VALUES (?, ?, ?, ?, 1)`,
    [email, hashedPassword, tenantId, role]
  );

  return result.insertId;
}

/**
 * Crea un tenant de prueba
 */
export async function createTestTenant(pool = null, { name = 'Test Tenant', isActive = true }) {
  if (!pool) pool = getTestPool();
  const [result] = await pool.query(
    `INSERT INTO tenant (name, is_active, status)
     VALUES (?, ?, ?)`,
    [name, isActive ? 1 : 0, 'active']
  );

  return result.insertId;
}

/**
 * Limpia datos de prueba
 */
export async function cleanupTestData(pool = null, { userId, tenantId }) {
  if (!pool) pool = getTestPool();
  if (userId) {
    await pool.query('DELETE FROM users WHERE id = ?', [userId]);
  }
  if (tenantId) {
    await pool.query('DELETE FROM tenant WHERE id = ?', [tenantId]);
  }
}

/**
 * Genera un token JWT de prueba
 */
export async function generateTestToken(payload, secret = process.env.JWT_SECRET || 'test-secret') {
  const jwt = await import('jsonwebtoken');
  return jwt.default.sign(payload, secret, { expiresIn: '1h' });
}

/**
 * Setup antes de cada test de integración
 */
export async function setupBeforeEach() {
  const { cleanupTestDatabase } = await import('./db.test.js');
  await cleanupTestDatabase();
}

/**
 * Teardown después de cada test de integración
 */
export async function teardownAfterEach() {
  // Opcional: limpiar datos específicos después de cada test
  // Por defecto, se limpia antes de cada test
}

