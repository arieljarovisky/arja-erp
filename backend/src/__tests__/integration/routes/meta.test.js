import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { meta } from '../../../routes/meta.js';

// Mock de middleware
const mockRequireAuth = (req, res, next) => {
  req.user = { 
    id: 1, 
    tenant_id: 1, 
    role: 'admin',
    permissions: {
      appointments: ['appointments.read', 'appointments.write']
    }
  };
  req.tenant = { id: 1 };
  next();
};

describe('Meta API', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(mockRequireAuth);
    app.use('/api/meta', meta);
  });

  describe('GET /api/meta/services', () => {
    it('debe listar servicios', async () => {
      const response = await request(app)
        .get('/api/meta/services')
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('GET /api/meta/instructors', () => {
    it('debe listar instructores', async () => {
      const response = await request(app)
        .get('/api/meta/instructors')
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });
});

