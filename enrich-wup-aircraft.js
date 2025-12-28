const fs = require('fs');
const path = require('path');

class WheelsUpEnrichment {
  constructor() {
    this.databasePath = path.join(__dirname, 'opensky_aircraft_cache.json');
    this.backupPath = path.join(__dirname, 'opensky_aircraft_cache.backup.json');
    this.wupDataPath = path.join(__dirname, 'wup_flightaware_registrations.json');
    this.airlineDatabasePath = path.join(__dirname, 'airline_database.json');
    this.enrichedCount = 0;
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

  // Load airline database
  loadAirlineDatabase() {
    try {
      if (!fs.existsSync(this.airlineDatabasePath)) {
        throw new Error(`Airline database file not found: ${this.airlineDatabasePath}`);
      }
      const data = fs.readFileSync(this.airlineDatabasePath, 'utf8');
      this.airlineDatabase = JSON.parse(data);
      console.log('Loaded airline database');
      return true;
    } catch (error) {
      console.error('Error loading airline database:', error.message);
      return false;
    }
  }

  // Load WUP registration data
  loadWUPData() {
    try {
      if (!fs.existsSync(this.wupDataPath)) {
        throw new Error(`WUP data file not found: ${this.wupDataPath}`);
      }
      const data = fs.readFileSync(this.wupDataPath, 'utf8');
      this.wupData = JSON.parse(data);
      console.log(`Loaded ${this.wupData.total_registrations} WUP registrations`);
      return true;
    } catch (error) {
      console.error('Error loading WUP data:', error.message);
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

  // Add WUP to operating airlines for a specific aircraft
  addWUPToAircraft(aircraft) {
    if (!aircraft.operating_airlines) {
      aircraft.operating_airlines = [];
    }

    // Check if WUP is already in the list
    const hasWUP = aircraft.operating_airlines.some(airline =>
      airline.code === 'WUP' || airline.name === 'Wheels Up'
    );

    if (!hasWUP) {
      aircraft.operating_airlines.push({
        code: 'WUP',
        name: 'Wheels Up'
      });
      return true; // Added
    }

    return false; // Already exists
  }

  // Enrich all WUP aircraft
  async enrichWUPFleet() {
    if (!this.loadDatabase()) {
      return false;
    }

    if (!this.loadAirlineDatabase()) {
      return false;
    }

    if (!this.loadWUPData()) {
      return false;
    }

    if (!this.createBackup()) {
      console.warn('Continuing without backup...');
    }

    console.log(`Starting enrichment of ${this.wupData.total_registrations} WUP aircraft...`);

    let foundCount = 0;
    let enrichedCount = 0;

    for (const registration of this.wupData.registrations) {
      // Find this aircraft in our database
      let found = false;
      for (const [aircraftId, aircraft] of Object.entries(this.database.aircraft)) {
        if (aircraft.registration === registration) {
          found = true;
          foundCount++;

          // Add WUP to operating airlines
          const wasAdded = this.addWUPToAircraft(aircraft);

          if (wasAdded) {
            console.log(`Added WUP to ${registration} (${aircraftId})`);
            enrichedCount++;
          } else {
            console.log(`WUP already exists for ${registration} (${aircraftId})`);
          }

          break;
        }
      }

      if (!found) {
        console.log(`WUP aircraft ${registration} not found in database`);
      }
    }

    // Save the database
    this.saveDatabase();

    const duration = (Date.now() - this.startTime) / 1000;
    console.log(`\nWUP Fleet enrichment complete!`);
    console.log(`Total WUP registrations: ${this.wupData.total_registrations}`);
    console.log(`Found in database: ${foundCount}`);
    console.log(`Enriched (added WUP): ${enrichedCount}`);
    console.log(`Duration: ${duration.toFixed(1)} seconds`);

    return true;
  }
}

// Run the enrichment
async function main() {
  const enricher = new WheelsUpEnrichment();
  await enricher.enrichWUPFleet();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = WheelsUpEnrichment;