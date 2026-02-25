import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { payments } from '../../../routes/payments.js';

// Mocks de middlewares
const mockRequireAuth = (req, res, next) => {
  req.user = {
    id: 1,
    tenant_id: 1,
    tenantId: 1,
    role: 'admin'
  };
  req.tenant = { id: 1 };
  next();
};

const mockRequireRole = (...roles) => (req, res, next) => {
  if (roles.includes(req.user?.role)) {
    next();
  } else {
    res.status(403).json({ ok: false, error: 'Forbidden' });
  }
};

describe('Payments API', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(mockRequireAuth);
    app.use(mockRequireRole('admin', 'user'));
    app.use('/api/payments', payments);
  });

  describe('POST /api/payments/preference', () => {
    it('debe rechazar request sin appointmentId', async () => {
      const response = await request(app)
        .post('/api/payments/preference')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('appointmentId');
    });

    it('debe rechazar si MercadoPago no está configurado', async () => {
      const response = await request(app)
        .post('/api/payments/preference')
        .send({ appointmentId: 1 })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/payments/status/:appointmentId', () => {
    it('debe obtener estado de pago', async () => {
      const response = await request(app)
        .get('/api/payments/status/1')
        .expect(200);

      expect(response.body).toHaveProperty('ok');
    });
  });
});

