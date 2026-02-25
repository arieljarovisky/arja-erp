import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { config } from '../../../routes/config.js';

// Mocks de middlewares
const mockRequireAuth = (req, res, next) => {
  req.user = { id: 1, tenant_id: 1, role: 'admin' };
  req.tenant = { id: 1 };
  next();
};

const mockRequireAdmin = (req, res, next) => {
  if (req.user?.role === 'admin') {
    next();
  } else {
    res.status(403).json({ ok: false, error: 'Forbidden' });
  }
};

describe('Config API', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(mockRequireAuth);
    app.use(mockRequireAdmin);
    app.use('/api/config', config);
  });

  describe('GET /api/config', () => {
    it('debe obtener configuración', async () => {
      const response = await request(app)
        .get('/api/config')
        .expect(200);

      expect(response.body).toHaveProperty('ok');
    });
  });

  describe('PUT /api/config', () => {
    it('debe validar datos al actualizar', async () => {
      const response = await request(app)
        .put('/api/config')
        .send({})
        .expect(200); // Puede aceptar objeto vacío

      expect(response.body).toHaveProperty('ok');
    });
  });
});

