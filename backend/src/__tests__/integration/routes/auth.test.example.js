/**
 * EJEMPLO: Test de integración completo con base de datos
 * 
 * Para usar este test:
 * 1. Configura .env.test según TEST_DB_SETUP.md
 * 2. Renombra este archivo a auth.test.js (o copia el contenido)
 * 3. Asegúrate de tener la BD de test configurada
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { auth } from '../../../routes/auth.js';
import { 
  getTestPool, 
  createTestUser, 
  createTestTenant, 
  cleanupTestData,
  setupBeforeEach 
} from '../../setup/testHelpers.js';

describe('Auth Routes - Integration Tests', () => {
  let app;
  let testTenantId;
  let testUserId;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/auth', auth);

    // Crear tenant de prueba una vez
    testTenantId = await createTestTenant();
  });

  beforeEach(async () => {
    // Limpiar datos antes de cada test
    await setupBeforeEach();
    
    // Crear usuario de prueba para cada test
    testUserId = await createTestUser({
      email: 'test@example.com',
      password: 'Test123!@#',
      tenantId: testTenantId,
      role: 'user'
    });
  });

  afterEach(async () => {
    // Limpiar datos después de cada test
    await cleanupTestData({ userId: testUserId, tenantId: null });
  });

  describe('POST /auth/login', () => {
    it('debe autenticar usuario válido', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Test123!@#'
        })
        .expect(200);

      expect(response.body).toHaveProperty('ok', true);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
    });

    it('debe rechazar credenciales incorrectas', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'WrongPassword123!'
        })
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('debe rechazar login sin credenciales', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('POST /auth/register', () => {
    it('debe registrar nuevo usuario', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'NewUser123!@#',
          name: 'New User',
          tenantId: testTenantId
        })
        .expect(201);

      expect(response.body).toHaveProperty('ok', true);
      expect(response.body).toHaveProperty('user');
    });

    it('debe rechazar registro con contraseña débil', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'weak@example.com',
          password: '123', // Contraseña muy débil
          name: 'Weak User',
          tenantId: testTenantId
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('contraseña');
    });

    it('debe rechazar registro con email inválido', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'invalid-email',
          password: 'ValidPass123!@#',
          name: 'Invalid User',
          tenantId: testTenantId
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });
});

