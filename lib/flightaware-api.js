const axios = require('axios');
const config = require('../config-loader');

class FlightAwareAPI {
  constructor() {
    this.apiKey = config.get('flightaware', 'apiKey');
    this.baseUrl = config.get('flightaware', 'baseUrl') || 'https://aeroapi.flightaware.com/aeroapi';
    this.enabled = config.get('flightaware', 'enabled') || false;
    this.rateLimit = config.get('flightaware', 'rateLimit') || 100;
    this.cacheTimeout = config.get('flightaware', 'cacheTimeout') || 300;

    // Simple in-memory cache
    this.cache = new Map();

    // Rate limiting
    this.requestsThisMinute = 0;
    this.minuteStart = Date.now();

    // For web scraping, we don't need an API key
    console.log('FlightAware config:', { enabled: this.enabled, apiKey: this.apiKey ? 'present' : 'missing' });
    if (this.enabled) {
      console.log('FlightAware web scraping enabled');
    }
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

  // Make web scraping request with rate limiting and caching
  async makeWebRequest(url) {
    if (!this.enabled) {
      return null;
    }

    if (!this.canMakeRequest()) {
      console.warn('FlightAware web scraping rate limit exceeded');
      return null;
    }

    const cacheKey = `web_${url}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      this.requestsThisMinute++;

      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 10000
      });

      // Simple HTML parsing to extract flight data
      const flightData = this.parseFlightPage(response.data);
      this.setCached(cacheKey, flightData);
      return flightData;
    } catch (error) {
      console.error('FlightAware web scraping error:', error.message);
      return null;
    }
  }

  // Parse FlightAware flight page HTML
  parseFlightPage(html) {
    try {
      // Extract basic flight information from HTML
      const flight = {};

      // Try to extract status
      const statusMatch = html.match(/status[^>]*>([^<]+)</i);
      if (statusMatch) {
        flight.status = statusMatch[1].trim();
      }

      // Try to extract route
      const routeMatch = html.match(/route[^>]*>([^<]+)</i);
      if (routeMatch) {
        flight.route = routeMatch[1].trim();
      }

      // Try to extract departure/arrival delays
      const depDelayMatch = html.match(/departure.*delay[^>]*>([^<]+)</i);
      if (depDelayMatch) {
        flight.departure_delay = depDelayMatch[1].trim();
      }

      const arrDelayMatch = html.match(/arrival.*delay[^>]*>([^<]+)</i);
      if (arrDelayMatch) {
        flight.arrival_delay = arrDelayMatch[1].trim();
      }

      return { flights: [flight] };
    } catch (error) {
      console.error('Error parsing flight page:', error);
      return null;
    }
  }

  // Get flight information by callsign (web scraping)
  async getFlightByCallsign(callsign) {
    const url = `https://flightaware.com/live/flight/${encodeURIComponent(callsign)}`;
    return this.makeWebRequest(url);
  }

  // Get flight information by ICAO hex (web scraping)
  async getFlightByHex(hex) {
    const url = `https://flightaware.com/live/modes/${encodeURIComponent(hex.toLowerCase())}/ident`;
    return this.makeWebRequest(url);
  }

  // Get detailed flight information (web scraping)
  async getFlightDetails(flightId) {
    const url = `https://flightaware.com/live/flight/${encodeURIComponent(flightId)}`;
    return this.makeWebRequest(url);
  }

  // Get aircraft information (web scraping)
  async getAircraftInfo(registration) {
    const url = `https://flightaware.com/live/flight/${encodeURIComponent(registration)}`;
    return this.makeWebRequest(url);
  }

  // Get airport information (web scraping)
  async getAirportInfo(airportCode) {
    const url = `https://flightaware.com/live/airport/${encodeURIComponent(airportCode.toUpperCase())}`;
    return this.makeWebRequest(url);
  }

  // Search flights (web scraping)
  async searchFlights(query) {
    const url = `https://flightaware.com/live/flight/${encodeURIComponent(query)}`;
    return this.makeWebRequest(url);
  }

  // Get flight path/position history (web scraping)
  async getFlightPath(flightId) {
    const url = `https://flightaware.com/live/flight/${encodeURIComponent(flightId)}`;
    return this.makeWebRequest(url);
  }
}

module.exports = new FlightAwareAPI();