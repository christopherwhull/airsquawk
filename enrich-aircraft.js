#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const aviationstack = require('./lib/aviationstack-api');
const aircraftDatabase = require('./lib/aircraft-database');

class AircraftEnrichment {
  constructor() {
    this.databasePath = path.join(__dirname, 'opensky_aircraft_cache.json');
    this.backupPath = path.join(__dirname, 'opensky_aircraft_cache.backup.json');
    this.enrichedCount = 0;
    this.errors = [];
    this.startTime = Date.now();
  }

  // Load the aircraft database
  loadDatabase() {
    try {
      if (!fs.existsSync(this.databasePath)) {
        throw new Error(`Database file not found: ${this.databasePath}`);
      }
      const data = fs.readFileSync(this.databasePath, 'utf8');
      this.database = JSON.parse(data);
      const aircraftCount = Object.keys(this.database.aircraft || {}).length;
      console.log(`Loaded ${aircraftCount} aircraft from database`);
      return true;
    } catch (error) {
      console.error('Error loading database:', error.message);
      return false;
    }
  }

  // Create backup before enrichment
  createBackup() {
    try {
      if (fs.existsSync(this.databasePath)) {
        fs.copyFileSync(this.databasePath, this.backupPath);
        console.log('Database backup created');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error creating backup:', error.message);
      return false;
    }
  }

  // Save the enriched database
  saveDatabase() {
    try {
      const data = JSON.stringify(this.database, null, 2);
      fs.writeFileSync(this.databasePath, data);
      console.log('Database saved successfully');
      return true;
    } catch (error) {
      console.error('Error saving database:', error.message);
      return false;
    }
  }

  // Get airborne Southwest flights and extract registrations
  async getRecentSWAFlights() {
    try {
      console.log('Fetching airborne Southwest flights...');
      const apiResponse = await aviationstack.makeAPIRequest('/flights', {
        airline_iata: 'WN',
        flight_status: 'active', // airborne flights
        limit: 100
      });

      if (!apiResponse || !apiResponse.data) {
        console.log('No flight data received');
        return [];
      }

      const airborneFlights = apiResponse.data.filter(flight =>
        flight.flight_status === 'active' &&
        flight.airline?.iata === 'WN' &&
        flight.live // has live tracking data (airborne)
      );

      console.log(`Found ${airborneFlights.length} airborne SWA flights`);

      // Extract unique registrations or ICAO24 codes
      const identifiers = [];
      for (const flight of airborneFlights) {
        if (flight.aircraft?.registration) {
          identifiers.push(flight.aircraft.registration);
        } else if (flight.aircraft?.icao24) {
          // If no registration, we'll need to look up by ICAO24 later
          identifiers.push(flight.aircraft.icao24);
        }
      }

      const uniqueIdentifiers = [...new Set(identifiers)];
      console.log(`Extracted ${uniqueIdentifiers.length} unique aircraft identifiers from airborne SWA flights`);
      return uniqueIdentifiers;
    } catch (error) {
      console.error('Error fetching airborne SWA flights:', error.message);
      return [];
    }
  }

  // Get all Southwest 737-700 and 737-800 aircraft from airplanes API
  async getAllSWABoeingAircraft() {
    try {
      console.log('Fetching all Southwest Boeing 737 aircraft from airplanes API...');
      
      const allAircraft = [];
      
      // Try searching by airline IATA code (WN for Southwest)
      console.log('Searching for aircraft by Southwest airline IATA code...');
      const airlineResponse = await aviationstack.makeAPIRequest('/airplanes', {
        airline_iata_code: 'WN',
        limit: 100
      });

      if (airlineResponse && airlineResponse.data) {
        const swaAircraft = airlineResponse.data.filter(aircraft => 
          aircraft.iata_type?.startsWith('B737') || aircraft.iata_type?.startsWith('B738')
        );
        allAircraft.push(...swaAircraft);
        console.log(`Found ${swaAircraft.length} Southwest 737/738 aircraft by airline IATA code`);
      }

      // Try searching by airline ICAO code (SWA for Southwest)
      console.log('Searching for aircraft by Southwest airline ICAO code...');
      const icaoResponse = await aviationstack.makeAPIRequest('/airplanes', {
        airline_icao_code: 'SWA',
        limit: 100
      });

      if (icaoResponse && icaoResponse.data) {
        const swaIcaoAircraft = icaoResponse.data.filter(aircraft => 
          aircraft.iata_type?.startsWith('B737') || aircraft.iata_type?.startsWith('B738')
        );
        allAircraft.push(...swaIcaoAircraft);
        console.log(`Found ${swaIcaoAircraft.length} Southwest 737/738 aircraft by airline ICAO code`);
      }

      // Try searching for aircraft with Southwest registrations (N*WN pattern)
      console.log('Searching for aircraft with Southwest registration pattern...');
      // Since we can't search by registration pattern, let's get more aircraft and filter
      const generalResponse = await aviationstack.makeAPIRequest('/airplanes', {
        limit: 1000  // Get more to find Southwest aircraft
      });

      if (generalResponse && generalResponse.data) {
        const swaRegAircraft = generalResponse.data.filter(aircraft => 
          aircraft.registration_number?.match(/^N.*WN$/) &&  // N followed by anything ending with WN
          (aircraft.iata_type?.startsWith('B737') || aircraft.iata_type?.startsWith('B738'))
        );
        allAircraft.push(...swaRegAircraft);
        console.log(`Found ${swaRegAircraft.length} Southwest 737/738 aircraft by registration pattern`);
      }

      // Remove duplicates based on registration
      const uniqueAircraft = allAircraft.filter((aircraft, index, self) => 
        index === self.findIndex(a => a.registration_number === aircraft.registration_number)
      );

      console.log(`Total unique Southwest 737 aircraft found: ${uniqueAircraft.length}`);

      // Extract ICAO hex and registration pairs
      const results = uniqueAircraft.map(aircraft => ({
        icao_hex: aircraft.icao_code_hex,
        registration: aircraft.registration_number,
        type: aircraft.iata_type,
        model: aircraft.model_name,
        owner: aircraft.plane_owner,
        body_type: aircraft.iata_type?.startsWith('B737') ? 'narrow' : undefined
      }));

      return results;
    } catch (error) {
      console.error('Error fetching all SWA Boeing aircraft:', error.message);
      return [];
    }
  }

  // Enrich all missing fields for the entire SWA fleet
  async enrichSWAFleet() {
    if (!this.loadDatabase()) {
      return false;
    }

    if (!this.createBackup()) {
      console.warn('Continuing without backup...');
    }

    // Get all SWA aircraft from API
    const swaFleet = await this.getAllSWABoeingAircraft();
    if (swaFleet.length === 0) {
      console.log('No SWA fleet data retrieved from API');
      return true;
    }

    console.log(`Retrieved ${swaFleet.length} SWA aircraft from API`);

    // Find which aircraft in our database need enrichment
    const aircraftToEnrich = [];
    for (const apiAircraft of swaFleet) {
      // Find this aircraft in our database
      let found = false;
      for (const [aircraftId, dbAircraft] of Object.entries(this.database.aircraft)) {
        if (dbAircraft.registration === apiAircraft.registration) {
          if (this.needsEnrichment(dbAircraft, [apiAircraft.registration])) {
            aircraftToEnrich.push({
              id: aircraftId,
              dbAircraft,
              apiData: apiAircraft
            });
          }
          found = true;
          break;
        }
      }
      if (!found) {
        console.log(`SWA aircraft ${apiAircraft.registration} not found in database`);
      }
    }

    if (aircraftToEnrich.length === 0) {
      console.log('No SWA aircraft in database need enrichment');
      return true;
    }

    console.log(`Starting enrichment of ${aircraftToEnrich.length} SWA aircraft with missing fields...`);

    for (let i = 0; i < aircraftToEnrich.length; i++) {
      const { id, dbAircraft, apiData } = aircraftToEnrich[i];
      console.log(`Processing ${i + 1}/${aircraftToEnrich.length}: ${id} (${dbAircraft.registration})`);

      // Get fresh data from AviationStack for this aircraft
      const apiResponse = await aviationstack.getAircraftByRegistration(dbAircraft.registration);

      if (!apiResponse) {
        console.log(`No API data found for ${dbAircraft.registration}`);
        continue;
      }

      const enrichedData = this.extractAircraftData(apiResponse);

      if (!enrichedData) {
        console.log(`No useful enrichment data found for ${dbAircraft.registration}`);
        continue;
      }

      // Update the database with all enriched data
      Object.assign(this.database.aircraft[id], enrichedData);

      console.log(`Enriched ${dbAircraft.registration}:`, enrichedData);
      this.enrichedCount++;

      // Add small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));

      // Save progress every 10 aircraft
      if ((i + 1) % 10 === 0) {
        console.log(`Saving progress... (${i + 1}/${aircraftToEnrich.length})`);
        this.saveDatabase();
      }
    }

    // Final save
    this.saveDatabase();

    const duration = (Date.now() - this.startTime) / 1000;
    console.log(`\nSWA Fleet enrichment complete!`);
    console.log(`Processed: ${aircraftToEnrich.length}`);
    console.log(`Enriched: ${this.enrichedCount}`);
    console.log(`Duration: ${duration.toFixed(1)} seconds`);

    return true;
  }

  // Enrich a specific aircraft by registration
  async enrichByRegistration(registration) {
    if (!this.loadDatabase()) {
      return false;
    }

    // Find the aircraft in the database by registration
    let targetAircraft = null;
    let targetId = null;

    for (const [aircraftId, aircraft] of Object.entries(this.database.aircraft)) {
      if (aircraft.registration === registration) {
        targetAircraft = aircraft;
        targetId = aircraftId;
        break;
      }
    }

    if (!targetAircraft) {
      console.log(`Aircraft with registration ${registration} not found in database`);
      return false;
    }

    console.log(`Found aircraft ${targetId} (${registration})`);

    // Check if it needs enrichment
    if (!this.needsEnrichment(targetAircraft, [registration])) {
      console.log(`Aircraft ${targetId} doesn't need enrichment`);
      return true;
    }

    // Enrich the aircraft
    return await this.enrichAircraft(targetId, targetAircraft);
  }

  // Check if aircraft needs enrichment (any missing/null fields)
  needsEnrichment(aircraft, identifiers) {
    // Check if type is missing or empty
    if (!aircraft.type || aircraft.type.trim() === '') {
      return true;
    }

    // Check if model is missing or empty
    if (!aircraft.model || aircraft.model.trim() === '') {
      return true;
    }

    // Check if operator is missing or null
    if (!aircraft.operator) {
      return true;
    }

    // Check if owner is missing or null
    if (!aircraft.owner) {
      return true;
    }

    // Check if manufacturer is missing (new field we're adding)
    if (!aircraft.manufacturer) {
      return true;
    }

    // Check for other potentially useful fields that might be missing
    const usefulFields = ['construction_number', 'delivery_date', 'engines_count', 'engines_type', 'plane_age', 'plane_status', 'body_type'];
    for (const field of usefulFields) {
      if (!aircraft[field]) {
        return true;
      }
    }

    return false;
  }

  // Extract aircraft data from AviationStack response
  extractAircraftData(apiResponse) {
    if (!apiResponse || !apiResponse.data || apiResponse.data.length === 0) {
      return null;
    }

    const aircraft = apiResponse.data[0]; // Get first result

    const enrichedData = {};

    // Extract type (map AviationStack format to OpenSky format)
    if (aircraft.iata_type) {
      enrichedData.type = aircraft.iata_type;
      
      // Classify as narrow body or wide body
      if (aircraft.iata_type.startsWith('B737') || 
          aircraft.iata_type.startsWith('B717') ||
          aircraft.iata_type.startsWith('A320') ||
          aircraft.iata_type.startsWith('A319') ||
          aircraft.iata_type.startsWith('A318') ||
          aircraft.iata_type.startsWith('A321') ||
          aircraft.iata_type.startsWith('E190') ||
          aircraft.iata_type.startsWith('E195') ||
          aircraft.iata_type.startsWith('CRJ') ||
          aircraft.iata_type.startsWith('ERJ')) {
        enrichedData.body_type = 'narrow';
      } else if (aircraft.iata_type.startsWith('B747') ||
                 aircraft.iata_type.startsWith('B777') ||
                 aircraft.iata_type.startsWith('B787') ||
                 aircraft.iata_type.startsWith('A330') ||
                 aircraft.iata_type.startsWith('A340') ||
                 aircraft.iata_type.startsWith('A350') ||
                 aircraft.iata_type.startsWith('A380')) {
        enrichedData.body_type = 'wide';
      }
    }

    // Extract operator/airline (if not already set)
    if (aircraft.airline && aircraft.airline.name && !enrichedData.operator) {
      enrichedData.operator = aircraft.airline.name;
    }

    // Extract owner
    if (aircraft.plane_owner) {
      enrichedData.owner = aircraft.plane_owner;
    }

    // Extract model
    if (aircraft.model_name) {
      enrichedData.model = aircraft.model_name;
    }

    // Extract manufacturer if available (map from various possible fields)
    if (aircraft.manufacturer) {
      enrichedData.manufacturer = aircraft.manufacturer;
    } else if (aircraft.production_line && aircraft.production_line.toLowerCase().includes('boeing')) {
      enrichedData.manufacturer = 'Boeing';
    } else if (aircraft.production_line && aircraft.production_line.toLowerCase().includes('airbus')) {
      enrichedData.manufacturer = 'Airbus';
    }

    // Add additional fields that might be useful
    if (aircraft.construction_number) {
      enrichedData.construction_number = aircraft.construction_number;
    }

    if (aircraft.delivery_date) {
      enrichedData.delivery_date = aircraft.delivery_date;
    }

    if (aircraft.engines_count) {
      enrichedData.engines_count = aircraft.engines_count;
    }

    if (aircraft.engines_type) {
      enrichedData.engines_type = aircraft.engines_type;
    }

    if (aircraft.plane_age) {
      enrichedData.plane_age = aircraft.plane_age;
    }

    if (aircraft.plane_status) {
      enrichedData.plane_status = aircraft.plane_status;
    }

    return Object.keys(enrichedData).length > 0 ? enrichedData : null;
  }

  // Enrich a single aircraft
  async enrichAircraft(aircraftId, aircraft, identifierType = 'registration') {
    try {
      if (!aircraft.registration && identifierType === 'registration') {
        console.log(`Skipping ${aircraftId}: no registration`);
        return false;
      }

      console.log(`Enriching aircraft ${aircraftId} (${aircraft.registration || 'no reg'})...`);

      let apiResponse;
      if (identifierType === 'icao24') {
        // Look up by ICAO24 hex code
        apiResponse = await aviationstack.getAircraftByIcaoHex(aircraft.icao_hex);
      } else {
        // Look up by registration
        apiResponse = await aviationstack.getAircraftByRegistration(aircraft.registration);
      }

      if (!apiResponse) {
        console.log(`No data found for ${identifierType}: ${identifierType === 'icao24' ? aircraft.icao_hex : aircraft.registration}`);
        return false;
      }

      const enrichedData = this.extractAircraftData(apiResponse);

      if (!enrichedData) {
        const identifier = identifierType === 'icao24' ? aircraft.icao_hex : aircraft.registration;
        console.log(`No useful enrichment data found for ${identifier}`);
        return false;
      }

      // Update the database
      Object.assign(this.database.aircraft[aircraftId], enrichedData);

      const identifier = identifierType === 'icao24' ? aircraft.icao_hex : aircraft.registration;
      console.log(`Enriched ${identifier}:`, enrichedData);
      this.enrichedCount++;
      return true;

    } catch (error) {
      const identifier = identifierType === 'icao24' ? aircraft.icao_hex : aircraft.registration;
      console.error(`Error enriching ${aircraftId} (${identifier}):`, error.message);
      this.errors.push({ id: aircraftId, identifier, identifierType, error: error.message });
      return false;
    }
  }

  // Get list of aircraft IDs that need enrichment
  getAircraftNeedingEnrichment(identifiers) {
    const needingEnrichment = [];

    // Look up aircraft by registration or ICAO24
    for (const identifier of identifiers) {
      let found = false;

      // First try to find by registration
      for (const [aircraftId, aircraft] of Object.entries(this.database.aircraft)) {
        if (aircraft.registration === identifier) {
          if (this.needsEnrichment(aircraft, identifiers)) {
            needingEnrichment.push({ id: aircraftId, aircraft, identifierType: 'registration' });
          }
          found = true;
          break;
        }
      }

      // If not found by registration, try by ICAO24
      if (!found) {
        const normalizedIcao = identifier.toLowerCase();
        for (const [aircraftId, aircraft] of Object.entries(this.database.aircraft)) {
          if (aircraft.icao_hex === normalizedIcao) {
            if (this.needsEnrichment(aircraft, identifiers)) {
              needingEnrichment.push({ id: aircraftId, aircraft, identifierType: 'icao24' });
            }
            break;
          }
        }
      }
    }

    console.log(`Found ${needingEnrichment.length} airborne SWA aircraft needing enrichment`);
    return needingEnrichment;
  }

  // Main enrichment process
  async enrichDatabase(limit = null) {
    if (!this.loadDatabase()) {
      return false;
    }

    if (!this.createBackup()) {
      console.warn('Continuing without backup...');
    }

    // Get recent Southwest flights
    const recentSWARegistrations = await this.getRecentSWAFlights();
    if (recentSWARegistrations.length === 0) {
      console.log('No recent SWA flights found');
      return true;
    }

    const aircraftToEnrich = this.getAircraftNeedingEnrichment(recentSWARegistrations);

    if (aircraftToEnrich.length === 0) {
      console.log('No recent SWA aircraft need enrichment');
      return true;
    }

    // Limit the number to process if specified
    const toProcess = limit ? aircraftToEnrich.slice(0, limit) : aircraftToEnrich;

    console.log(`Starting enrichment of ${toProcess.length} airborne SWA aircraft...`);

    for (let i = 0; i < toProcess.length; i++) {
      const { id, aircraft, identifierType } = toProcess[i];
      console.log(`Processing ${i + 1}/${toProcess.length}: ${id} (${aircraft.registration || 'no reg'}) [${identifierType}]`);

      const success = await this.enrichAircraft(id, aircraft, identifierType);

      // Add small delay to respect rate limits
      if (success) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Save progress every 10 aircraft
      if ((i + 1) % 10 === 0) {
        console.log(`Saving progress... (${i + 1}/${toProcess.length})`);
        this.saveDatabase();
      }
    }

    // Final save
    this.saveDatabase();

    const duration = (Date.now() - this.startTime) / 1000;
    console.log(`\nEnrichment complete!`);
    console.log(`Processed: ${toProcess.length}`);
    console.log(`Enriched: ${this.enrichedCount}`);
    console.log(`Errors: ${this.errors.length}`);
    console.log(`Duration: ${duration.toFixed(1)} seconds`);

    if (this.errors.length > 0) {
      console.log('\nErrors encountered:');
      this.errors.forEach(err => console.log(`  ${err.id} (${err.registration}): ${err.error}`));
    }

    return true;
  }

  // Test enrichment with a specific registration
  async testEnrichment(registration) {
    console.log(`Testing enrichment for registration ${registration}...`);

    const apiResponse = await aviationstack.getAircraftByRegistration(registration);

    if (apiResponse) {
      console.log('API Response:', JSON.stringify(apiResponse, null, 2));

      const enrichedData = this.extractAircraftData(apiResponse);
      console.log('Extracted data:', enrichedData);
    } else {
      console.log('No response from API');
    }
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  const enrichment = new AircraftEnrichment();

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node enrich-aircraft.js test <REGISTRATION>  - Test enrichment for specific aircraft registration');
    console.log('  node enrich-aircraft.js callsign <CALLSIGN>   - Enrich aircraft for specific callsign (e.g., SWA139)');
    console.log('  node enrich-aircraft.js enrich [limit]       - Enrich recent SWA aircraft missing type/manufacturer');
    console.log('  node enrich-aircraft.js swa-flights          - Show recent airborne SWA flights from API');
    console.log('  node enrich-aircraft.js swa-fleet            - Show all Southwest 737-700/800 aircraft from API');
    console.log('  node enrich-aircraft.js enrich-swa-fleet     - Enrich ALL missing fields for SWA fleet');
    return;
  }

  const command = args[0];

  if (command === 'test' && args[1]) {
    await enrichment.testEnrichment(args[1].toUpperCase());
  } else if (command === 'callsign' && args[1]) {
    await enrichment.enrichByCallsign(args[1].toUpperCase());
  } else if (command === 'enrich') {
    const limit = args[1] ? parseInt(args[1]) : null;
    await enrichment.enrichDatabase(limit);
  } else if (command === 'swa-flights') {
    const registrations = await enrichment.getRecentSWAFlights();
    console.log('Recent SWA aircraft registrations:', registrations.slice(0, 10));
    if (registrations.length > 10) {
      console.log(`... and ${registrations.length - 10} more`);
    }
  } else if (command === 'swa-fleet') {
    const fleet = await enrichment.getAllSWABoeingAircraft();
    console.log('All Southwest 737-700/800 aircraft:');
    fleet.forEach(aircraft => {
      console.log(`  ${aircraft.registration} (${aircraft.icao_hex}) - ${aircraft.type} - ${aircraft.body_type} body - ${aircraft.owner}`);
    });
    console.log(`\nTotal: ${fleet.length} aircraft`);
  } else if (command === 'enrich-swa-fleet') {
    await enrichment.enrichSWAFleet();
  } else {
    console.log('Invalid command. Use "test <REGISTRATION>", "callsign <CALLSIGN>", "enrich [limit]", "swa-flights", "swa-fleet", or "enrich-swa-fleet"');
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = AircraftEnrichment;