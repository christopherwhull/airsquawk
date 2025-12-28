const axios = require('axios');
const config = require('../config-loader');

class AviationStackAPI {
  constructor() {
    this.apiKey = config.get('aviationstack', 'apiKey');
    this.baseUrl = config.get('aviationstack', 'baseUrl') || 'https://api.aviationstack.com/v1';
    this.enabled = config.get('aviationstack', 'enabled') || false;
    this.rateLimit = config.get('aviationstack', 'rateLimit') || 100;
    this.cacheTimeout = config.get('aviationstack', 'cacheTimeout') || 300;

    // Simple in-memory cache
    this.cache = new Map();

    // Rate limiting
    this.requestsThisMinute = 0;
    this.minuteStart = Date.now();

    console.log('AviationStack config:', {
      enabled: this.enabled,
      apiKey: this.apiKey ? 'present' : 'missing',
      baseUrl: this.baseUrl
    });
  }

  // Rate limiting check
  canMakeRequest() {
    const now = Date.now();
    if (now - this.minuteStart > 60000) { // Reset every minute
      this.requestsThisMinute = 0;
      this.minuteStart = now;
    }
    return this.requestsThisMinute < this.rateLimit;
  }

  // Get cached data or null
  getCached(key) {
    const cached = this.cache.get(key);
    if (cached && (Date.now() - cached.timestamp) < (this.cacheTimeout * 1000)) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  // Cache data
  setCached(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  // Make API request with rate limiting and caching
  async makeAPIRequest(endpoint, params = {}) {
    if (!this.enabled) {
      return null;
    }

    if (!this.apiKey || this.apiKey === 'YOUR_AVIATIONSTACK_API_KEY_HERE') {
      console.warn('AviationStack API key not configured');
      return null;
    }

    if (!this.canMakeRequest()) {
      console.warn('AviationStack API rate limit exceeded');
      return null;
    }

    const cacheKey = `api_${endpoint}_${JSON.stringify(params)}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      this.requestsThisMinute++;

      const url = `${this.baseUrl}${endpoint}`;
      const requestParams = {
        access_key: this.apiKey,
        ...params
      };

      console.log('Making AviationStack API request:', { url, params: { ...requestParams, access_key: '[REDACTED]' } });

      const response = await axios.get(url, {
        params: requestParams,
        timeout: 10000
      });

      const data = response.data;
      this.setCached(cacheKey, data);
      return data;
    } catch (error) {
      console.error('AviationStack API error:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      return null;
    }
  }

  // Get aircraft information by ICAO hex code
  async getAircraftByIcaoHex(icaoHex) {
    return this.makeAPIRequest('/airplanes', {
      icao_code_hex: icaoHex.toUpperCase(),
      limit: 1
    });
  }

  // Get aircraft information by registration
  async getAircraftByRegistration(registration) {
    return this.makeAPIRequest('/airplanes', {
      registration_number: registration.toUpperCase(),
      limit: 1
    });
  }

  // Search aircraft by various criteria
  async searchAircraft(searchParams) {
    return this.makeAPIRequest('/airplanes', {
      ...searchParams,
      limit: 100
    });
  }

  // Get airline information
  async getAirline(iataCode) {
    return this.makeAPIRequest('/airlines', {
      iata_code: iataCode.toUpperCase(),
      limit: 1
    });
  }

  // Get airport information
  async getAirport(iataCode) {
    return this.makeAPIRequest('/airports', {
      iata_code: iataCode.toUpperCase(),
      limit: 1
    });
  }

  // Get flight information
  async getFlight(flightNumber) {
    return this.makeAPIRequest('/flights', {
      flight_number: flightNumber,
      limit: 1
    });
  }

  // Get aircraft types
  async getAircraftTypes() {
    return this.makeAPIRequest('/aircraft_types', {
      limit: 1000
    });
  }
}

module.exports = new AviationStackAPI();