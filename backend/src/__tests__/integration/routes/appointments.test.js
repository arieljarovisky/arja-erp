import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { appointments } from '../../../routes/appointments.js';

// Mock simple de middleware de autenticación y tenant
const mockRequireAuth = (req, res, next) => {
  // Simular usuario autenticado con toda la estructura esperada
  req.user = {
    id: 1,
    tenant_id: 1,
    tenantId: 1,
    role: 'admin',
    email: 'test@example.com'
  };
  next();
};

const mockRequireTenant = (req, res, next) => {
  req.tenantId = req.user?.tenantId || 1;
  next();
};

const mockRequireActiveSubscription = (req, res, next) => {
  // Simular suscripción activa
  next();
};

describe('Appointments API', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    // Aplicar middlewares en el mismo orden que en index.js
    app.use(mockRequireAuth);
    app.use(mockRequireTenant);
    app.use(mockRequireActiveSubscription);
    app.use('/api/appointments', appointments);
  });

  // Nota: Estos tests requieren una base de datos de test configurada
  // y datos de prueba. Por ahora están marcados como skip.
  // Para activarlos, configura .env.test según TEST_DB_SETUP.md
  
  describe('GET /api/appointments', () => {
    it.skip('debe listar turnos con paginación', async () => {
      // Requiere BD de test configurada
      const response = await request(app)
        .get('/api/appointments')
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it.skip('debe filtrar turnos por fecha', async () => {
      // Requiere BD de test configurada
      const response = await request(app)
        .get('/api/appointments')
        .query({
          startDate: '2024-01-01',
          endDate: '2024-01-31'
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
    });

    it.skip('debe filtrar turnos por instructor', async () => {
      // Requiere BD de test configurada
      const response = await request(app)
        .get('/api/appointments')
        .query({ instructorId: 1 })
        .expect(200);

      expect(response.body).toHaveProperty('data');
    });
  });

  describe('POST /api/appointments', () => {
    it.skip('debe rechazar turno sin datos requeridos', async () => {
      // Requiere BD de test configurada
      const response = await request(app)
        .post('/api/appointments')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it.skip('debe rechazar turno con fecha pasada', async () => {
      // Requiere BD de test configurada
      const response = await request(app)
        .post('/api/appointments')
        .send({
          customerId: 1,
          serviceId: 1,
          instructorId: 1,
          startsAt: '2020-01-01 10:00:00'
        })
        .expect(400);

      expect(response.body.error).toContain('futura');
    });

    it.skip('debe rechazar turno con minutos no múltiplos de 5', async () => {
      // Requiere BD de test configurada
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      futureDate.setMinutes(7); // Minutos no múltiplos de 5

      const response = await request(app)
        .post('/api/appointments')
        .send({
          customerId: 1,
          serviceId: 1,
          instructorId: 1,
          startsAt: futureDate.toISOString().replace('T', ' ').slice(0, 19)
        })
        .expect(400);

      expect(response.body.error).toContain('bloques de 5 minutos');
    });
  });

  describe('PUT /api/appointments/:id', () => {
    it('debe rechazar actualización sin ID', async () => {
      const response = await request(app)
        .put('/api/appointments/')
        .send({})
        .expect(404);
    });

    it.skip('debe validar datos al actualizar', async () => {
      // Requiere BD de test configurada
      const response = await request(app)
        .put('/api/appointments/999')
        .send({
          startsAt: '2020-01-01 10:00:00' // Fecha pasada
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/appointments/:id', () => {
    it('debe rechazar cancelación sin ID', async () => {
      const response = await request(app)
        .delete('/api/appointments/')
        .expect(404);
    });
  });
});

