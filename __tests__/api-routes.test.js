const request = require('supertest');
const express = require('express');
const { setupApiRoutes } = require('../lib/api-routes');

// Mock S3 client and other dependencies
const mockS3 = {
  send: jest.fn()
};
const mockReadBucket = 'test-read-bucket';
const mockWriteBucket = 'test-write-bucket';
const mockGetInMemoryState = () => ({ positions: [] });
const mockCache = {};
const mockPositionCache = {
  getStats: () => ({
    totalPositions: 0,
    uniqueAircraft: 0,
    uniqueFlights: 0,
    uniqueAirlines: 0,
    lastRefresh: 'Never',
    cacheMemoryMb: 0,
    data: {}
  }),
  positions: [],
  positionsByHex: {}
};

describe('API Routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Setup API routes with mocks
    setupApiRoutes(app, mockS3, mockReadBucket, mockWriteBucket, mockGetInMemoryState, mockCache, mockPositionCache);
  });

  describe('GET /api/health', () => {
    test('should return health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body.status).toBe('ok');
    });
  });

  describe('GET /api/cache-status', () => {
    test('should return cache status', async () => {
      const response = await request(app)
        .get('/api/cache-status')
        .expect(200);

      expect(response.body).toHaveProperty('positionCache');
      expect(response.body).toHaveProperty('aircraftDatabase');
      expect(response.body).toHaveProperty('typeDatabase');
      expect(response.body).toHaveProperty('apiCache');
      expect(response.body).toHaveProperty('logoCache');
      expect(response.body).toHaveProperty('logoCoverage');
    });
  });

  describe('404 handling', () => {
    test('should return 404 for unknown routes', async () => {
      await request(app)
        .get('/api/nonexistent')
        .expect(404);
    });
  });
});