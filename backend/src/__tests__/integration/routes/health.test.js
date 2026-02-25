import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// Importar la ruta de health
import { health } from '../../../routes/health.js';

describe('Health Endpoint', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/health', health);
  });

  it('debe responder con status 200', async () => {
    const response = await request(app)
      .get('/api/health')
      .expect(200);

    expect(response.body).toHaveProperty('ok');
  });

  it('debe incluir información de la API', async () => {
    const response = await request(app)
      .get('/api/health')
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.service).toBe('pelu-api');
    expect(response.body).toHaveProperty('time');
  });
});

