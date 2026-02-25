import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { customers } from '../../../routes/customers.js';

// Mocks de middlewares
const mockRequireAuth = (req, res, next) => {
  req.user = {
    id: 1,
    tenant_id: 1,
    tenantId: 1,
    role: 'admin',
    email: 'test@example.com',
    permissions: {},
    is_super_admin: false
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

describe('Customers API', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    // Aplicar mocks antes de las rutas
    app.use(mockRequireAuth);
    app.use(mockRequireRole('admin', 'user'));
    app.use('/api/customers', customers);
  });

  describe('GET /api/customers/by-phone/:phone', () => {
    it('debe rechazar request sin tenant', async () => {
      const appNoTenant = express();
      appNoTenant.use(express.json());
      // Mock de requireAuth sin tenant
      appNoTenant.use((req, res, next) => {
        req.user = { id: 1, role: 'admin', tenant_id: null };
        req.tenant = null;
        next();
      });
      // Mock de requireRole
      appNoTenant.use((req, res, next) => {
        if (['admin', 'user'].includes(req.user?.role)) {
          next();
        } else {
          res.status(403).json({ ok: false, error: 'Forbidden' });
        }
      });
      appNoTenant.use('/api/customers', customers);

      const response = await request(appNoTenant)
        .get('/api/customers/by-phone/+5491112345678')
        .expect(403);

      expect(response.body).toHaveProperty('error');
    });

    it('debe retornar 404 si cliente no existe', async () => {
      const response = await request(app)
        .get('/api/customers/by-phone/+5499999999999')
        .expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.ok).toBe(false);
    });
  });

  describe('PUT /api/customers/:phone/name', () => {
    it('debe rechazar request sin phone', async () => {
      const response = await request(app)
        .put('/api/customers//name')
        .send({ name: 'Test' })
        .expect(404); // Express route not found
    });

    it.skip('debe validar que phone esté presente', async () => {
      // Requiere BD de test
      const response = await request(app)
        .put('/api/customers/123/name')
        .send({})
        .expect(200); // La función acepta name vacío
    });
  });

  describe('GET /api/customers', () => {
    it('debe listar clientes con paginación', async () => {
      const response = await request(app)
        .get('/api/customers')
        .query({ limit: 10, offset: 0 })
        .expect(200);

      expect(response.body).toHaveProperty('ok');
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('debe filtrar clientes por búsqueda', async () => {
      const response = await request(app)
        .get('/api/customers')
        .query({ q: 'test' })
        .expect(200);

      expect(response.body).toHaveProperty('data');
    });
  });
});


