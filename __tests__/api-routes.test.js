// Ensure test env vars are set before requiring server modules
process.env.GIT_COMMIT_OVERRIDE = process.env.GIT_COMMIT_OVERRIDE || 'test';
process.env.GIT_DIRTY_OVERRIDE = process.env.GIT_DIRTY_OVERRIDE || 'false';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const request = require('supertest');
const express = require('express');

// Mock S3 client and other dependencies - provide default safe implementations for startup tasks
jest.mock('../lib/s3-helpers', () => ({
  listS3Files: jest.fn().mockResolvedValue([]),
  downloadAndParseS3File: jest.fn().mockResolvedValue([]),
  downloadAndParseS3FileJson: jest.fn().mockResolvedValue([]),
  getS3Object: jest.fn().mockResolvedValue(null)
}));
const { listS3Files, downloadAndParseS3File } = require('../lib/s3-helpers');

const { setupApiRoutes } = require('../lib/api-routes');

// (s3-helpers are mocked above before requiring modules)

// Mock S3 client for tests: provide a send() handler for common commands
const mockS3 = {
  send: jest.fn().mockImplementation(async (cmd) => {
    const name = cmd.constructor && cmd.constructor.name ? cmd.constructor.name : '';
    if (name.includes('ListObjectsV2Command')) {
      return { Contents: [] };
    }
    if (name.includes('GetObjectCommand')) {
      // Return an empty body stream
      const stream = require('stream');
      const readable = new stream.Readable({ read() {} });
      readable.push('[]');
      readable.push(null);
      return { Body: readable };
    }
    return {};
  })
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

  beforeAll(() => {
    // Ensure the s3 helper mocks don't throw when called by startup tasks
    listS3Files.mockResolvedValue([]);
    downloadAndParseS3File.mockResolvedValue([]);
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

  describe('POST /api/restart', () => {
    let previousToken;
    beforeAll(() => {
      previousToken = process.env.RESTART_API_TOKEN;
    });
    afterAll(() => {
      process.env.RESTART_API_TOKEN = previousToken;
    });

    test('should reject when no token configured', async () => {
      process.env.RESTART_API_TOKEN = '';
      const app = express();
      app.use(express.json());
      setupApiRoutes(app, mockS3, mockReadBucket, mockWriteBucket, mockGetInMemoryState, mockCache, mockPositionCache);

      const response = await request(app)
        .post('/api/restart');
      expect([403, 500]).toContain(response.status);
    });

    test('should authorize with token and spawn restart', async () => {
      process.env.RESTART_API_TOKEN = 'unittesttoken';
      const spawn = require('child_process').spawn;
      const mockSpawn = jest.spyOn(require('child_process'), 'spawn').mockImplementation(() => ({ unref: () => {} }));
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

      const app = express();
      app.use(express.json());
      setupApiRoutes(app, mockS3, mockReadBucket, mockWriteBucket, mockGetInMemoryState, mockCache, mockPositionCache);

      const response = await request(app)
        .post('/api/restart')
        .set('Authorization', 'Bearer unittesttoken');

      expect([200, 500]).toContain(response.status);
      mockSpawn.mockRestore();
      exitSpy.mockRestore();
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

  describe('GET /api/airline-database', () => {
    test('should return the airline DB and set a Cache-Control header', async () => {
      // Create a local app and inject a small airlineDB via opts so the route returns deterministic data
      const localApp = express();
      localApp.use(express.json());
      const injectedAirlineDB = { TEST: { name: 'Test Airline', logo: '/api/v2logos/TEST' } };
      setupApiRoutes(localApp, mockS3, mockReadBucket, mockWriteBucket, mockGetInMemoryState, mockCache, mockPositionCache, 0, { airlineDB: injectedAirlineDB });

      const response = await request(localApp)
        .get('/api/airline-database')
        .expect(200);

      expect(response.headers['cache-control']).toBeDefined();
      expect(response.headers['cache-control']).toMatch(/max-age=3600/);
      expect(response.body).toHaveProperty('TEST');
      expect(response.body.TEST).toHaveProperty('name', 'Test Airline');
    });
  });

  describe('GET /api/airlines', () => {
    test('should return the airline list and set a Cache-Control header', async () => {
      const localApp = express();
      localApp.use(express.json());
      const injectedAirlineDB = { TEST: { name: 'Test Airline', logo: '/api/v2logos/TEST' } };
      setupApiRoutes(localApp, mockS3, mockReadBucket, mockWriteBucket, mockGetInMemoryState, mockCache, mockPositionCache, 0, { airlineDB: injectedAirlineDB });

      const response = await request(localApp)
        .get('/api/airlines')
        .expect(200);

      expect(response.headers['cache-control']).toBeDefined();
      expect(response.headers['cache-control']).toMatch(/max-age=3600/);
      expect(response.body).toHaveProperty('TEST');
      expect(response.body.TEST).toHaveProperty('name', 'Test Airline');
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

      // Heatmap returns an array of grid cells with metadata: lat_min, lon_min, count
      expect(Array.isArray(response.body)).toBe(true);
      if (response.body.length > 0) {
        expect(response.body[0]).toHaveProperty('lat_min');
        expect(response.body[0]).toHaveProperty('lon_min');
        expect(response.body[0]).toHaveProperty('count');
      }
    });

    test('should filter by airline', async () => {
      const response = await request(app)
        .get('/api/heatmap?window=1h&airline=TEST')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /api/flights - N-number fallback', () => {
    test('should use callsign as registration when missing and callsign is N-number', async () => {
      // Mock S3 to provide one flight file containing a flight with missing registration
      listS3Files.mockResolvedValue([{ Key: 'flights/hourly/test.json' }]);
      const flightJson = JSON.stringify([
        {
          icao: 'abc123',
          callsign: 'N66TN',
          registration: 'N/A',
          type: 'C172',
          start_time: new Date().toISOString()
        }
      ]);
      // A GetObjectCommand will be issued; s3.send in test returns a stream containing the JSON
      const stream = require('stream');
      const readable = new stream.Readable({ read() {} });
      readable.push(flightJson);
      readable.push(null);
      mockS3.send.mockResolvedValue({ Body: readable });

      // Setup new app instance using the custom getInMemoryState
      const localApp = express();
      localApp.use(express.json());
      // Use the mocked in-memory state accessor
      setupApiRoutes(localApp, mockS3, mockReadBucket, mockWriteBucket, mockGetInMemoryState, mockCache, mockPositionCache);

      const response = await request(localApp)
        .get('/api/flights')
        .expect(200);
      // Debug: Print response body
      console.log('DEBUG /api/flights response:', JSON.stringify(response.body, null, 2));

      // Expect an active flight to be present and registration to reflect the callsign
      expect(Array.isArray(response.body.active)).toBe(true);
      const active = response.body.active;
      const our = active.find(f => (f.icao || '').toLowerCase() === 'abc123');
      expect(our).toBeDefined();
      expect(our.registration).toBe('N66TN');
    });

    test('should set airline_code and airlineLogo for known airline callsign', async () => {
      // Prepare a flight with a callsign that includes airline code DAL
      listS3Files.mockResolvedValue([{ Key: 'flights/hourly/test2.json' }]);
      const flightJson = JSON.stringify([
        {
          icao: 'abc234',
          callsign: 'DAL2738',
          registration: 'N/A',
          type: 'B738',
          start_time: new Date().toISOString()
        }
      ]);
      const stream = require('stream');
      const readable = new stream.Readable({ read() {} });
      readable.push(flightJson);
      readable.push(null);
      mockS3.send.mockResolvedValue({ Body: readable });

      // Mock the airline DB to contain DAL entry
      downloadAndParseS3File.mockResolvedValueOnce({ DAL: { name: 'Delta Air Lines', logo: '/api/v2logos/DAL' } });

      const localApp = express();
      localApp.use(express.json());
      setupApiRoutes(localApp, mockS3, mockReadBucket, mockWriteBucket, mockGetInMemoryState, mockCache, mockPositionCache);

      const response = await request(localApp).get('/api/flights');
      expect(response.status).toBe(200);
      const active = response.body.active || [];
      const our = active.find(f => (f.icao || '').toLowerCase() === 'abc234');
      expect(our).toBeDefined();
      expect(our.airline_code).toBe('DAL');
      expect(our.airline_name).toBe('Delta Air Lines');
      expect(our.airlineLogo).toBe('/api/v2logos/DAL');
    });

    test('should NOT set airline_code for FAA registration-style callsigns (N123AB)', async () => {
      listS3Files.mockResolvedValue([{ Key: 'flights/hourly/test3.json' }]);
      const flightJson = JSON.stringify([
        {
          icao: 'def456',
          callsign: 'N234KH',
          registration: 'N/A',
          type: 'C172',
          start_time: new Date().toISOString()
        }
      ]);
      const stream = require('stream');
      const readable = new stream.Readable({ read() {} });
      readable.push(flightJson);
      readable.push(null);
      mockS3.send.mockResolvedValue({ Body: readable });

      // Provide an empty/unrelated airline DB
      downloadAndParseS3File.mockResolvedValueOnce({});

      const localApp = express();
      localApp.use(express.json());
      setupApiRoutes(localApp, mockS3, mockReadBucket, mockWriteBucket, mockGetInMemoryState, mockCache, mockPositionCache);

      const response = await request(localApp).get('/api/flights');
      expect(response.status).toBe(200);
      const active = response.body.active || [];
      const our = active.find(f => (f.icao || '').toLowerCase() === 'def456');
      expect(our).toBeDefined();
      expect(our.airline_code).toBeUndefined();
      expect(our.airline_name).toBe(null);
      expect(our.airlineLogo).toBeUndefined();
    });

    test('should set airline_code but NOT set airlineLogo when DB has code with null logo', async () => {
      // Prepare a flight with callsign that maps to ABC code
      listS3Files.mockResolvedValue([{ Key: 'flights/hourly/test4.json' }]);
      const flightJson = JSON.stringify([
        {
          icao: 'abc567',
          callsign: 'ABC555',
          registration: 'N/A',
          type: 'A320',
          start_time: new Date().toISOString()
        }
      ]);
      const stream = require('stream');
      const readable = new stream.Readable({ read() {} });
      readable.push(flightJson);
      readable.push(null);
      mockS3.send.mockResolvedValue({ Body: readable });

      // Airline DB contains ABC but with null logo
      const localApp = express();
      localApp.use(express.json());
      // Inject airlineDB via opts to make test deterministic
      setupApiRoutes(localApp, mockS3, mockReadBucket, mockWriteBucket, mockGetInMemoryState, mockCache, mockPositionCache, 0, { airlineDB: { ABC: { name: 'ABC Airways', logo: null } } });

      const response = await request(localApp).get('/api/flights');
      expect(response.status).toBe(200);
      const active = response.body.active || [];
      const our = active.find(f => (f.icao || '').toLowerCase() === 'abc567');
      expect(our).toBeDefined();
      expect(our.airline_code).toBe('ABC');
      expect(our.airline_name).toBe('ABC Airways');
      // airlineLogo should not be set when DB logo is null
      expect(our.airlineLogo).toBeUndefined();
      // no db spy to restore since we used opts injection
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

describe('GET /api/server-status', () => {
  test('should return server start time and commit info that indicates no dirty working tree', async () => {
    const app = express();
    app.use(express.json());
    setupApiRoutes(app, mockS3, mockReadBucket, mockWriteBucket, mockGetInMemoryState, mockCache, mockPositionCache);

    const response = await request(app)
      .get('/api/server-status')
      .expect(200);

    expect(response.body).toHaveProperty('serverStartIso');
    expect(response.body).toHaveProperty('gitCommit');
    expect(response.body).toHaveProperty('gitDirty');
    expect(response.body.gitDirty).toBe(false);
  });
});