const fs = require('fs');

const db = JSON.parse(fs.readFileSync('opensky_aircraft_cache.json'));
const airbusTypes = {};
const boeingTypes = {};
let airbusTotal = 0;
let boeingTotal = 0;

for (const [id, aircraft] of Object.entries(db.aircraft)) {
    if (aircraft.manufacturer === 'Airbus' && aircraft.type) {
        airbusTypes[aircraft.type] = (airbusTypes[aircraft.type] || 0) + 1;
        airbusTotal++;
    } else if (aircraft.manufacturer === 'Boeing' && aircraft.type) {
        boeingTypes[aircraft.type] = (boeingTypes[aircraft.type] || 0) + 1;
        boeingTotal++;
    }
}

console.log('=== AIRBUS AIRCRAFT (with manufacturer field) ===');
console.log('Total Airbus aircraft:', airbusTotal);
console.log('\nBy type:');
Object.entries(airbusTypes).sort((a,b)=>b[1]-a[1]).forEach(([type, count]) => {
    console.log(type + ':', count);
});

console.log('\n=== BOEING AIRCRAFT (with manufacturer field) ===');
console.log('Total Boeing aircraft:', boeingTotal);
console.log('\nBy type:');
Object.entries(boeingTypes).sort((a,b)=>b[1]-a[1]).forEach(([type, count]) => {
    console.log(type + ':', count);
});