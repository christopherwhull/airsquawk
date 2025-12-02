const request = require('supertest');
const express = require('express');
const { setupApiRoutes } = require('../lib/api-routes');

// Mock S3 client and other dependencies
jest.mock('../lib/s3-helpers');
const { listS3Files, downloadAndParseS3File } = require('../lib/s3-helpers');

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

  describe('GET /api/heatmap', () => {
    beforeEach(() => {
      // Mock the S3 helpers
      listS3Files.mockResolvedValue([
        { Key: 'data/piaware_aircraft_log_20251128_1800.json' }
      ]);
      downloadAndParseS3File.mockResolvedValue([
        {
          ICAO: 'testicao',
          Ident: 'TEST123',
          Aircraft_type: 'B737',
          Latitude: 40.0,
          Longitude: -74.0,
          Timestamp: new Date().toISOString()
        }
      ]);
    });

    test('should return heatmap positions', async () => {
      const response = await request(app)
        .get('/api/heatmap?window=1h')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      // Should return positions as [lat, lon] arrays
      if (response.body.length > 0) {
        expect(response.body[0]).toHaveLength(2);
        expect(typeof response.body[0][0]).toBe('number');
        expect(typeof response.body[0][1]).toBe('number');
      }
    });

    test('should filter by airline', async () => {
      const response = await request(app)
        .get('/api/heatmap?window=1h&airline=TEST')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
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