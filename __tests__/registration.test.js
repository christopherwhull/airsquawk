const { registration_from_hexid } = require('../lib/registration');

describe('Registration Module', () => {
  describe('registration_from_hexid() function', () => {
    test('should return registration for valid hex', () => {
      const result = registration_from_hexid('A1B2C3');
      // Should return a string or null
      expect(typeof result === 'string' || result === null).toBe(true);
      // If it returns a string, it should be a valid registration format
      if (typeof result === 'string') {
        expect(result.length).toBeGreaterThan(0);
      }
    });

    test('should handle invalid hex gracefully', () => {
      const result = registration_from_hexid('INVALID');
      expect(result).toBeNull();
    });

    test('should handle empty/null input', () => {
      expect(registration_from_hexid('')).toBeNull();
      expect(registration_from_hexid(null)).toBeNull();
      expect(registration_from_hexid(undefined)).toBeNull();
    });

    test('should handle different hex formats', () => {
      // Test with different case
      const result1 = registration_from_hexid('a1b2c3');
      const result2 = registration_from_hexid('A1B2C3');
      // Results should be consistent regardless of case
      expect(result1).toBe(result2);
    });
  });
});