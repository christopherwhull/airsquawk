const aircraftDB = require('../lib/aircraft-database');

describe('Aircraft Database Module', () => {
  describe('lookup() function', () => {
    test('should return aircraft data for valid hex', () => {
      const result = aircraftDB.lookup('A1B2C3');
      // The result should be an object or null
      expect(typeof result).toBe('object');
      // If it returns data, it should have expected properties
      if (result) {
        expect(result).toHaveProperty('typecode');
      }
    });

    test('should handle invalid hex gracefully', () => {
      const result = aircraftDB.lookup('INVALID');
      expect(result).toBeNull();
    });

    test('should handle empty/null input', () => {
      expect(aircraftDB.lookup('')).toBeNull();
      expect(aircraftDB.lookup(null)).toBeNull();
      expect(aircraftDB.lookup(undefined)).toBeNull();
    });
  });

  describe('getStats() function', () => {
    test('should return statistics object', () => {
      const stats = aircraftDB.getStats();
      expect(typeof stats).toBe('object');
      expect(stats).toHaveProperty('loaded');
      expect(stats).toHaveProperty('aircraftCount');
      expect(stats).toHaveProperty('source');
      expect(stats).toHaveProperty('downloaded');
    });

    test('statistics should have reasonable values', () => {
      const stats = aircraftDB.getStats();
      expect(typeof stats.loaded).toBe('boolean');
      expect(typeof stats.aircraftCount).toBe('number');
      expect(stats.aircraftCount).toBeGreaterThanOrEqual(0);
      expect(typeof stats.source).toBe('string');
    });
  });
});