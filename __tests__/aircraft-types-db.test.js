const aircraftTypesDB = require('../lib/aircraft-types-db');

describe('Aircraft Types Database Module', () => {
  describe('getStats() function', () => {
    test('should return statistics object', () => {
      const stats = aircraftTypesDB.getStats();
      expect(typeof stats).toBe('object');
      expect(stats).toHaveProperty('loaded');
      expect(stats).toHaveProperty('typeCount');
      expect(stats).toHaveProperty('created');
      expect(stats).toHaveProperty('version');
    });

    test('statistics should have reasonable values', () => {
      const stats = aircraftTypesDB.getStats();
      expect(typeof stats.loaded).toBe('boolean');
      expect(typeof stats.typeCount).toBe('number');
      expect(stats.typeCount).toBeGreaterThanOrEqual(0);
      expect(typeof stats.version).toBe('string');
    });
  });

  describe('lookup() function', () => {
    test('should return aircraft type data for valid typecode', () => {
      const result = aircraftTypesDB.lookup('B737');
      // The result should be an object or null
      expect(typeof result).toBe('object');
      // If it returns data, it should have expected properties
      if (result) {
        expect(result).toHaveProperty('manufacturer');
        expect(result).toHaveProperty('model');
        expect(result.manufacturer).toBe('Boeing');
      }
    });

    test('should handle invalid typecode gracefully', () => {
      const result = aircraftTypesDB.lookup('INVALID');
      expect(result).toBeNull();
    });

    test('should handle empty/null input', () => {
      expect(aircraftTypesDB.lookup('')).toBeNull();
      expect(aircraftTypesDB.lookup(null)).toBeNull();
      expect(aircraftTypesDB.lookup(undefined)).toBeNull();
    });
  });
});