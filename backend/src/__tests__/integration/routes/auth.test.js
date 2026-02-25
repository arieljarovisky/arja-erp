import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { auth } from '../../../routes/auth.js';

describe('Auth Routes', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/auth', auth);
  });

  describe('POST /auth/login', () => {
    it('debe rechazar login sin credenciales', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({});

      // Puede ser 400 o 401 dependiendo de la validación
      expect([400, 401]).toContain(response.status);
      expect(response.body).toHaveProperty('error');
    });

    it('debe rechazar login con email inválido', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'invalid-email',
          password: 'password123'
        });

      // La ruta puede validar el email o simplemente buscar en la BD
      expect([400, 401]).toContain(response.status);
    });

    it('debe rechazar login con credenciales incorrectas', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'wrongpassword'
        })
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });

  // Nota: Los tests de registro requieren configuración de base de datos
  // y pueden necesitar un tenant válido. Estos tests son ejemplos básicos.
  describe('POST /auth/register', () => {
    it.skip('debe rechazar registro sin datos requeridos', async () => {
      // Este test requiere configuración de BD
      const response = await request(app)
        .post('/auth/register')
        .send({});

      expect([400, 404]).toContain(response.status);
    });

    it.skip('debe validar formato de email', async () => {
      // Este test requiere configuración de BD
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'invalid-email',
          password: 'password123',
          name: 'Test User'
        });

      expect([400, 404]).toContain(response.status);
    });

    it.skip('debe validar fortaleza de contraseña', async () => {
      // Este test requiere configuración de BD
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          password: '123', // Contraseña muy débil
          name: 'Test User'
        });

      expect([400, 404]).toContain(response.status);
    });
  });
});

