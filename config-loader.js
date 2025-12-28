/**
 * Config Loader Utility
 * Loads and validates configuration from config.json
 */

const fs = require('fs');
const path = require('path');
const JSON5 = require('json5');

class ConfigLoader {
  constructor(configPath = null) {
    this.configPath = configPath || path.join(__dirname, 'config.json');
    this.config = null;
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.configPath)) {
        throw new Error(`Config file not found: ${this.configPath}`);
      }

      const configData = fs.readFileSync(this.configPath, 'utf8');
      this.config = JSON5.parse(configData);

      // Basic validation
      this.validate();

      console.log('✅ Configuration loaded successfully');
      return this.config;
    } catch (error) {
      console.error('❌ Failed to load configuration:', error.message);
      throw error;
    }
  }

  validate() {
    const requiredSections = ['server', 'heatmap', 'screenshots', 'data', 'logging', 'ui'];

    for (const section of requiredSections) {
      if (!this.config[section]) {
        throw new Error(`Missing required config section: ${section}`);
      }
    }

    // Validate port ranges
    if (this.config.server.mainPort < 1000 || this.config.server.mainPort > 65535) {
      throw new Error('Invalid mainPort range');
    }

    if (this.config.server.tileProxyPort < 1000 || this.config.server.tileProxyPort > 65535) {
      throw new Error('Invalid tileProxyPort range');
    }

    // Validate opacity ranges
    if (this.config.heatmap.defaultOpacity < 0 || this.config.heatmap.defaultOpacity > 1) {
      throw new Error('Invalid heatmap opacity range');
    }
  }

  get(section, key = null) {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }

    if (key === null) {
      return this.config[section];
    }

    return this.config[section]?.[key];
  }

  getAll() {
    return this.config;
  }

  reload() {
    console.log('🔄 Reloading configuration...');
    return this.load();
  }

  // Convenience getters for commonly used config values
  get server() {
    return this.get('server');
  }

  get heatmap() {
    return this.get('heatmap');
  }

  get mapCenter() {
    return this.get('heatmap', 'mapCenter');
  }

  get screenshots() {
    return this.get('screenshots');
  }

  get data() {
    return this.get('data');
  }

  get s3() {
    return this.get('s3');
  }

  get buckets() {
    return this.get('buckets');
  }

  get tsdb() {
    return this.get('tsdb');
  }

  get state() {
    return this.get('state');
  }

  get retention() {
    return this.get('retention');
  }

  get logging() {
    return this.get('logging');
  }

  get logDirectory() {
    return this.get('logging', 'directory');
  }

  get logMaxSizeMB() {
    return this.get('logging', 'maxSizeMB');
  }

  get logRotationIntervalHours() {
    return this.get('logging', 'rotationIntervalHours');
  }

  get proxy() {
    return this.get('proxy');
  }

  get dataSource() {
    return this.get('dataSource');
  }

  get buckets() {
    return this.get('buckets');
  }

  get storage() {
    return this.get('storage');
  }

  get state() {
    return this.get('state');
  }

  get retention() {
    return this.get('retention');
  }

  get backgroundJobs() {
    return this.get('backgroundJobs');
  }

  get initialJobDelays() {
    return this.get('initialJobDelays');
  }

  get positionCache() {
    return this.get('positionCache');
  }

  get api() {
    return this.get('api');
  }

  get s3ListLimits() {
    return this.get('s3ListLimits');
  }

  get dataProcessing() {
    return this.get('dataProcessing');
  }

  get reception() {
    return this.get('reception');
  }

  get development() {
    return this.get('development');
  }
}

// Export singleton instance
const config = new ConfigLoader();

module.exports = config;