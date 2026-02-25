import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { calendar } from '../../../routes/calendar.js';

// Mocks de middlewares
const mockRequireAuth = (req, res, next) => {
  req.user = {
    id: 1,
    tenant_id: 1,
    tenantId: 1,
    role: 'admin',
    permissions: {}
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

describe('Calendar API', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(mockRequireAuth);
    app.use(mockRequireRole('admin', 'staff', 'user'));
    app.use('/api/calendar', calendar);
  });

  describe('GET /api/calendar/calendar/day', () => {
    it('debe requerir parámetro date', async () => {
      const response = await request(app)
        .get('/api/calendar/calendar/day')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('date');
    });

    it('debe retornar eventos del día', async () => {
      const response = await request(app)
        .get('/api/calendar/calendar/day')
        .query({ date: '2024-01-15' })
        .expect(200);

      expect(response.body).toHaveProperty('ok');
    });
  });
});

