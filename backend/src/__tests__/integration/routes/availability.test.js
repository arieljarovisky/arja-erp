import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { availability } from '../../../routes/availability.js';

// Mock de middleware
const mockRequireAuth = (req, res, next) => {
  req.user = { id: 1, tenant_id: 1 };
  req.tenant = { id: 1 };
  next();
};

describe('Availability API', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(mockRequireAuth);
    app.use('/api/availability', availability);
  });

  describe('GET /api/availability', () => {
    it('debe requerir parámetros requeridos', async () => {
      const response = await request(app)
        .get('/api/availability')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('instructorId');
    });

    it('debe requerir serviceId', async () => {
      const response = await request(app)
        .get('/api/availability')
        .query({ date: '2024-01-15', instructorId: 1 })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('serviceId');
    });

    it('debe requerir date', async () => {
      const response = await request(app)
        .get('/api/availability')
        .query({ instructorId: 1, serviceId: 1 })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('date');
    });

    it('debe retornar slots disponibles', async () => {
      const response = await request(app)
        .get('/api/availability')
        .query({
          date: '2024-01-15',
          instructorId: 1,
          serviceId: 1
        })
        .expect(200);

      expect(response.body).toHaveProperty('ok');
      expect(response.body).toHaveProperty('data');
    });
  });
});

