#!/usr/bin/env node
/**
 * Build Aircraft Types Database
 * 
 * Creates a comprehensive database mapping aircraft type codes to:
 * - Manufacturer
 * - Body Type (Wide/Narrow/Regional/Business)
 * - Full Model Name
 * - Engine Count
 */

const fs = require('fs');
const path = require('path');

const aircraftTypes = {
    // Boeing 737 Family (Narrow Body)
    'B731': { manufacturer: 'Boeing', model: 'Boeing 737-100', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'B732': { manufacturer: 'Boeing', model: 'Boeing 737-200', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'B733': { manufacturer: 'Boeing', model: 'Boeing 737-300', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'B734': { manufacturer: 'Boeing', model: 'Boeing 737-400', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'B735': { manufacturer: 'Boeing', model: 'Boeing 737-500', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'B736': { manufacturer: 'Boeing', model: 'Boeing 737-600', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'B737': { manufacturer: 'Boeing', model: 'Boeing 737-700', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'B738': { manufacturer: 'Boeing', model: 'Boeing 737-800', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'B739': { manufacturer: 'Boeing', model: 'Boeing 737-900', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'B37M': { manufacturer: 'Boeing', model: 'Boeing 737 MAX 7', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'B38M': { manufacturer: 'Boeing', model: 'Boeing 737 MAX 8', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'B39M': { manufacturer: 'Boeing', model: 'Boeing 737 MAX 9', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'B3XM': { manufacturer: 'Boeing', model: 'Boeing 737 MAX 10', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },

    // Boeing 747 Family (Wide Body)
    'B741': { manufacturer: 'Boeing', model: 'Boeing 747-100', bodyType: 'Wide Body', engines: 4, category: 'Commercial Jet' },
    'B742': { manufacturer: 'Boeing', model: 'Boeing 747-200', bodyType: 'Wide Body', engines: 4, category: 'Commercial Jet' },
    'B743': { manufacturer: 'Boeing', model: 'Boeing 747-300', bodyType: 'Wide Body', engines: 4, category: 'Commercial Jet' },
    'B744': { manufacturer: 'Boeing', model: 'Boeing 747-400', bodyType: 'Wide Body', engines: 4, category: 'Commercial Jet' },
    'B748': { manufacturer: 'Boeing', model: 'Boeing 747-8', bodyType: 'Wide Body', engines: 4, category: 'Commercial Jet' },
    'B74S': { manufacturer: 'Boeing', model: 'Boeing 747SP', bodyType: 'Wide Body', engines: 4, category: 'Commercial Jet' },
    'B74R': { manufacturer: 'Boeing', model: 'Boeing 747SR', bodyType: 'Wide Body', engines: 4, category: 'Commercial Jet' },

    // Boeing 757 Family (Narrow Body)
    'B752': { manufacturer: 'Boeing', model: 'Boeing 757-200', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'B753': { manufacturer: 'Boeing', model: 'Boeing 757-300', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },

    // Boeing 767 Family (Wide Body)
    'B762': { manufacturer: 'Boeing', model: 'Boeing 767-200', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'B763': { manufacturer: 'Boeing', model: 'Boeing 767-300', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'B764': { manufacturer: 'Boeing', model: 'Boeing 767-400', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },

    // Boeing 777 Family (Wide Body)
    'B772': { manufacturer: 'Boeing', model: 'Boeing 777-200', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'B77L': { manufacturer: 'Boeing', model: 'Boeing 777-200LR', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'B773': { manufacturer: 'Boeing', model: 'Boeing 777-300', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'B77W': { manufacturer: 'Boeing', model: 'Boeing 777-300ER', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'B778': { manufacturer: 'Boeing', model: 'Boeing 777-8', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'B779': { manufacturer: 'Boeing', model: 'Boeing 777-9', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'B77X': { manufacturer: 'Boeing', model: 'Boeing 777X', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },

    // Boeing 787 Family (Wide Body)
    'B788': { manufacturer: 'Boeing', model: 'Boeing 787-8 Dreamliner', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'B789': { manufacturer: 'Boeing', model: 'Boeing 787-9 Dreamliner', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'B78X': { manufacturer: 'Boeing', model: 'Boeing 787-10 Dreamliner', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },

    // Airbus A320 Family (Narrow Body)
    'A318': { manufacturer: 'Airbus', model: 'Airbus A318', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'A319': { manufacturer: 'Airbus', model: 'Airbus A319', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'A320': { manufacturer: 'Airbus', model: 'Airbus A320', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'A321': { manufacturer: 'Airbus', model: 'Airbus A321', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'A19N': { manufacturer: 'Airbus', model: 'Airbus A319neo', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'A20N': { manufacturer: 'Airbus', model: 'Airbus A320neo', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'A21N': { manufacturer: 'Airbus', model: 'Airbus A321neo', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },

    // Airbus A330 Family (Wide Body)
    'A332': { manufacturer: 'Airbus', model: 'Airbus A330-200', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'A333': { manufacturer: 'Airbus', model: 'Airbus A330-300', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'A338': { manufacturer: 'Airbus', model: 'Airbus A330-800neo', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'A339': { manufacturer: 'Airbus', model: 'Airbus A330-900neo', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'A330': { manufacturer: 'Airbus', model: 'Airbus A330', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },

    // Airbus A340 Family (Wide Body)
    'A342': { manufacturer: 'Airbus', model: 'Airbus A340-200', bodyType: 'Wide Body', engines: 4, category: 'Commercial Jet' },
    'A343': { manufacturer: 'Airbus', model: 'Airbus A340-300', bodyType: 'Wide Body', engines: 4, category: 'Commercial Jet' },
    'A345': { manufacturer: 'Airbus', model: 'Airbus A340-500', bodyType: 'Wide Body', engines: 4, category: 'Commercial Jet' },
    'A346': { manufacturer: 'Airbus', model: 'Airbus A340-600', bodyType: 'Wide Body', engines: 4, category: 'Commercial Jet' },

    // Airbus A350 Family (Wide Body)
    'A359': { manufacturer: 'Airbus', model: 'Airbus A350-900', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },
    'A35K': { manufacturer: 'Airbus', model: 'Airbus A350-1000', bodyType: 'Wide Body', engines: 2, category: 'Commercial Jet' },

    // Airbus A380 (Wide Body)
    'A388': { manufacturer: 'Airbus', model: 'Airbus A380-800', bodyType: 'Wide Body', engines: 4, category: 'Commercial Jet' },

    // Embraer Regional Jets
    'E135': { manufacturer: 'Embraer', model: 'Embraer ERJ-135', bodyType: 'Regional Jet', engines: 2, category: 'Regional Jet' },
    'E145': { manufacturer: 'Embraer', model: 'Embraer ERJ-145', bodyType: 'Regional Jet', engines: 2, category: 'Regional Jet' },
    'E170': { manufacturer: 'Embraer', model: 'Embraer E170', bodyType: 'Regional Jet', engines: 2, category: 'Regional Jet' },
    'E175': { manufacturer: 'Embraer', model: 'Embraer E175', bodyType: 'Regional Jet', engines: 2, category: 'Regional Jet' },
    'E190': { manufacturer: 'Embraer', model: 'Embraer E190', bodyType: 'Regional Jet', engines: 2, category: 'Regional Jet' },
    'E195': { manufacturer: 'Embraer', model: 'Embraer E195', bodyType: 'Regional Jet', engines: 2, category: 'Regional Jet' },
    'E290': { manufacturer: 'Embraer', model: 'Embraer E190-E2', bodyType: 'Regional Jet', engines: 2, category: 'Regional Jet' },
    'E295': { manufacturer: 'Embraer', model: 'Embraer E195-E2', bodyType: 'Regional Jet', engines: 2, category: 'Regional Jet' },

    // Bombardier CRJ Family
    'CRJ1': { manufacturer: 'Bombardier', model: 'Bombardier CRJ-100', bodyType: 'Regional Jet', engines: 2, category: 'Regional Jet' },
    'CRJ2': { manufacturer: 'Bombardier', model: 'Bombardier CRJ-200', bodyType: 'Regional Jet', engines: 2, category: 'Regional Jet' },
    'CRJ7': { manufacturer: 'Bombardier', model: 'Bombardier CRJ-700', bodyType: 'Regional Jet', engines: 2, category: 'Regional Jet' },
    'CRJ9': { manufacturer: 'Bombardier', model: 'Bombardier CRJ-900', bodyType: 'Regional Jet', engines: 2, category: 'Regional Jet' },
    'CRJX': { manufacturer: 'Bombardier', model: 'Bombardier CRJ-1000', bodyType: 'Regional Jet', engines: 2, category: 'Regional Jet' },

    // Bombardier Dash 8
    'DH8A': { manufacturer: 'Bombardier', model: 'Dash 8-100', bodyType: 'Regional Turboprop', engines: 2, category: 'Turboprop' },
    'DH8B': { manufacturer: 'Bombardier', model: 'Dash 8-200', bodyType: 'Regional Turboprop', engines: 2, category: 'Turboprop' },
    'DH8C': { manufacturer: 'Bombardier', model: 'Dash 8-300', bodyType: 'Regional Turboprop', engines: 2, category: 'Turboprop' },
    'DH8D': { manufacturer: 'Bombardier', model: 'Dash 8-400', bodyType: 'Regional Turboprop', engines: 2, category: 'Turboprop' },
    'DHC6': { manufacturer: 'de Havilland Canada', model: 'DHC-6 Twin Otter', bodyType: 'Small Turboprop', engines: 2, category: 'Turboprop' },

    // ATR Turboprops
    'AT43': { manufacturer: 'ATR', model: 'ATR 42-300', bodyType: 'Regional Turboprop', engines: 2, category: 'Turboprop' },
    'AT45': { manufacturer: 'ATR', model: 'ATR 42-500', bodyType: 'Regional Turboprop', engines: 2, category: 'Turboprop' },
    'AT72': { manufacturer: 'ATR', model: 'ATR 72-500', bodyType: 'Regional Turboprop', engines: 2, category: 'Turboprop' },
    'AT75': { manufacturer: 'ATR', model: 'ATR 72-600', bodyType: 'Regional Turboprop', engines: 2, category: 'Turboprop' },
    'AT76': { manufacturer: 'ATR', model: 'ATR 72-600', bodyType: 'Regional Turboprop', engines: 2, category: 'Turboprop' },

    // Business Jets - Cessna
    'C25A': { manufacturer: 'Cessna', model: 'Citation CJ2', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'C25B': { manufacturer: 'Cessna', model: 'Citation CJ3', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'C25C': { manufacturer: 'Cessna', model: 'Citation CJ4', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'C500': { manufacturer: 'Cessna', model: 'Citation I', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'C550': { manufacturer: 'Cessna', model: 'Citation II', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'C560': { manufacturer: 'Cessna', model: 'Citation V', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'C680': { manufacturer: 'Cessna', model: 'Citation Sovereign', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'C750': { manufacturer: 'Cessna', model: 'Citation X', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },

    // Business Jets - Gulfstream
    'G150': { manufacturer: 'Gulfstream', model: 'Gulfstream G150', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'G280': { manufacturer: 'Gulfstream', model: 'Gulfstream G280', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'GLF4': { manufacturer: 'Gulfstream', model: 'Gulfstream IV', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'GLF5': { manufacturer: 'Gulfstream', model: 'Gulfstream V', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'G650': { manufacturer: 'Gulfstream', model: 'Gulfstream G650', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },

    // Business Jets - Bombardier
    'CL30': { manufacturer: 'Bombardier', model: 'Challenger 300', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'CL35': { manufacturer: 'Bombardier', model: 'Challenger 350', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'CL60': { manufacturer: 'Bombardier', model: 'Challenger 600', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'GL5T': { manufacturer: 'Bombardier', model: 'Global 5000', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },
    'GLEX': { manufacturer: 'Bombardier', model: 'Global Express', bodyType: 'Business Jet', engines: 2, category: 'Business Jet' },

    // Cargo Aircraft
    'B74F': { manufacturer: 'Boeing', model: 'Boeing 747-400F', bodyType: 'Wide Body Freighter', engines: 4, category: 'Cargo' },
    'B77F': { manufacturer: 'Boeing', model: 'Boeing 777F', bodyType: 'Wide Body Freighter', engines: 2, category: 'Cargo' },
    'MD11': { manufacturer: 'McDonnell Douglas', model: 'McDonnell Douglas MD-11', bodyType: 'Wide Body', engines: 3, category: 'Commercial Jet' },
    'MD11F': { manufacturer: 'McDonnell Douglas', model: 'McDonnell Douglas MD-11F', bodyType: 'Wide Body Freighter', engines: 3, category: 'Cargo' },

    // Older Commercial Jets
    'DC10': { manufacturer: 'McDonnell Douglas', model: 'McDonnell Douglas DC-10', bodyType: 'Wide Body', engines: 3, category: 'Commercial Jet' },
    'DC93': { manufacturer: 'McDonnell Douglas', model: 'McDonnell Douglas DC-9-30', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'MD81': { manufacturer: 'McDonnell Douglas', model: 'McDonnell Douglas MD-81', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'MD82': { manufacturer: 'McDonnell Douglas', model: 'McDonnell Douglas MD-82', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'MD83': { manufacturer: 'McDonnell Douglas', model: 'McDonnell Douglas MD-83', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'MD88': { manufacturer: 'McDonnell Douglas', model: 'McDonnell Douglas MD-88', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },
    'MD90': { manufacturer: 'McDonnell Douglas', model: 'McDonnell Douglas MD-90', bodyType: 'Narrow Body', engines: 2, category: 'Commercial Jet' },

    // General Aviation
    'C172': { manufacturer: 'Cessna', model: 'Cessna 172 Skyhawk', bodyType: 'Light Aircraft', engines: 1, category: 'General Aviation' },
    'C182': { manufacturer: 'Cessna', model: 'Cessna 182 Skylane', bodyType: 'Light Aircraft', engines: 1, category: 'General Aviation' },
    'C208': { manufacturer: 'Cessna', model: 'Cessna 208 Caravan', bodyType: 'Utility Turboprop', engines: 1, category: 'Turboprop' },
    'PA28': { manufacturer: 'Piper', model: 'Piper PA-28 Cherokee', bodyType: 'Light Aircraft', engines: 1, category: 'General Aviation' },
    'PA46': { manufacturer: 'Piper', model: 'Piper PA-46 Malibu', bodyType: 'Light Aircraft', engines: 1, category: 'General Aviation' },
    'SR22': { manufacturer: 'Cirrus', model: 'Cirrus SR22', bodyType: 'Light Aircraft', engines: 1, category: 'General Aviation' },
    'PC12': { manufacturer: 'Pilatus', model: 'Pilatus PC-12', bodyType: 'Utility Turboprop', engines: 1, category: 'Turboprop' },

    // Military Transport
    'C130': { manufacturer: 'Lockheed', model: 'Lockheed C-130 Hercules', bodyType: 'Military Transport', engines: 4, category: 'Military' },
    'C17': { manufacturer: 'Boeing', model: 'Boeing C-17 Globemaster III', bodyType: 'Military Transport', engines: 4, category: 'Military' },
    'C5': { manufacturer: 'Lockheed', model: 'Lockheed C-5 Galaxy', bodyType: 'Military Transport', engines: 4, category: 'Military' },
    'A400': { manufacturer: 'Airbus', model: 'Airbus A400M Atlas', bodyType: 'Military Transport', engines: 4, category: 'Military' },

    // Helicopters
    'B407': { manufacturer: 'Bell', model: 'Bell 407', bodyType: 'Helicopter', engines: 1, category: 'Helicopter' },
    'B412': { manufacturer: 'Bell', model: 'Bell 412', bodyType: 'Helicopter', engines: 2, category: 'Helicopter' },
    'EC35': { manufacturer: 'Airbus Helicopters', model: 'Eurocopter EC135', bodyType: 'Helicopter', engines: 2, category: 'Helicopter' },
    'EC45': { manufacturer: 'Airbus Helicopters', model: 'Eurocopter EC145', bodyType: 'Helicopter', engines: 2, category: 'Helicopter' },
    'H125': { manufacturer: 'Airbus Helicopters', model: 'Airbus H125', bodyType: 'Helicopter', engines: 1, category: 'Helicopter' },
    'AS50': { manufacturer: 'Airbus Helicopters', model: 'Airbus AS350', bodyType: 'Helicopter', engines: 1, category: 'Helicopter' },
};

// Create output with metadata
const output = {
    metadata: {
        created: new Date().toISOString(),
        version: '1.0',
        count: Object.keys(aircraftTypes).length,
        description: 'Aircraft type codes mapped to manufacturer, body type, and model information'
    },
    types: aircraftTypes
};

// Write to file
const outputPath = path.join(__dirname, 'aircraft_types.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`✓ Created aircraft types database with ${Object.keys(aircraftTypes).length} types`);
console.log(`✓ Saved to: ${outputPath}`);
console.log('\nSample entries:');
console.log(JSON.stringify(Object.entries(aircraftTypes).slice(0, 5).reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {}), null, 2));
