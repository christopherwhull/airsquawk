#!/usr/bin/env node
// Extended checker to sample random positions and produce coverage stats for altitude fields
// Usage: node tools/check-api-altitude-fields.js [--positions N] [--hexes M]

const base = process.env.API_BASE || 'http://localhost:3002';
const POS_SAMPLE = Number(process.argv.find(a => a.startsWith('--positions='))?.split('=')[1]) || Number(process.env.POS_SAMPLE) || 500;
const HEX_SAMPLE = Number(process.argv.find(a => a.startsWith('--hexes='))?.split('=')[1]) || Number(process.env.HEX_SAMPLE) || 50;

const expectedAltitudeFields = [
  'alt', 'altitude', 'Altitude', 'altitude_ft', 'alt_ft', 'alt_baro', 'max_alt_ft', 'max_alt', 'altitude_m', 'alt_m'
];

async function fetchJson(path) {
  const url = base + path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function detectAltitudeFields(obj) {
  const found = [];
  expectedAltitudeFields.forEach(k => {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) found.push({key:k,val:obj[k]});
  });
  return found;
}

function sampleStr(obj, n=6) {
  try { return JSON.stringify(obj, null, 2).split('\n').slice(0, n).join('\n'); } catch (e) { return String(obj); }
}

function randSampleIndices(total, n) {
  const set = new Set();
  n = Math.min(n, total);
  while (set.size < n) {
    set.add(Math.floor(Math.random() * total));
  }
  return Array.from(set);
}

(async () => {
  try {
    console.log(`Using API base: ${base}`);

    console.log(`\n1) /api/positions?hours=1 — sampling ${POS_SAMPLE} random positions`);
    const posPayload = await fetchJson('/api/positions?hours=1');
    const positions = Array.isArray(posPayload.positions) ? posPayload.positions : (Array.isArray(posPayload) ? posPayload : []);
    console.log(`  total positions available = ${positions.length}`);
    if (positions.length === 0) {
      console.warn('  No positions returned; skipping checks');
    } else {
      const sampleIdx = randSampleIndices(positions.length, POS_SAMPLE);
      let withAlt = 0;
      const fieldCounts = {};
      sampleIdx.forEach((idx, i) => {
        const p = positions[idx];
        const det = detectAltitudeFields(p);
        if (det.length) {
          withAlt++;
          det.forEach(d => fieldCounts[d.key] = (fieldCounts[d.key] || 0) + 1);
        }
      });
      console.log(`  sampled ${sampleIdx.length} positions — ${withAlt} (${((withAlt/sampleIdx.length)*100).toFixed(1)}%) had altitude fields`);
      console.log('  field distribution:');
      Object.keys(fieldCounts).sort((a,b)=>fieldCounts[b]-fieldCounts[a]).forEach(k => console.log(`    ${k}: ${fieldCounts[k]}`));
      // show examples
      const examples = [];
      for (let i=0;i<positions.length && examples.length<5;i++) {
        const p = positions[i];
        const d = detectAltitudeFields(p);
        if (d.length) examples.push({hex:(p.hex||p.icao||p.icao24||'n/a'), sample:d.map(x=>x.key)});
      }
      if (examples.length) console.log('  examples (first matches):', JSON.stringify(examples, null, 2));
      else console.log('  no examples of altitude fields found in positions');

      // Timestamp coverage: determine how many sampled positions had reasonable timestamps
      const nowMs = Date.now();
      const hasTs = [];
      const hasGoodAge = [];
      const tsNormalize = v => {
        if (v === undefined || v === null || v === '') return null;
        if (typeof v === 'number') return (v < 1e11) ? v * 1000 : v;
        const nv = Number(v);
        if (!Number.isNaN(nv)) return (nv < 1e11) ? nv * 1000 : nv;
        const parsed = Date.parse(v);
        if (!Number.isNaN(parsed)) return parsed;
        return null;
      };
      for (const idx of sampleIdx) {
        const p = positions[idx];
        const tsVal = p.timestamp ?? p.ts ?? p.time ?? p.t ?? p.time_ts ?? p.time_utc ?? null;
        const ts = tsNormalize(tsVal);
        if (ts) hasTs.push(ts);
        const age = ts ? Math.floor((nowMs - ts) / 1000) : null;
        if (age !== null && age >=0 && age <= 300) hasGoodAge.push(age);
      }
      console.log(`  timestamps present in sample: ${hasTs.length}/${sampleIdx.length} (${((hasTs.length/sampleIdx.length)*100).toFixed(1)}%)`);
      console.log(`  recent timestamps (<=300s): ${hasGoodAge.length}/${sampleIdx.length} (${((hasGoodAge.length/sampleIdx.length)*100).toFixed(1)}%)`);

      // Collect a set of hexes with positions for deeper tests
      const hexSet = new Set();
      positions.forEach(p => { const h = (p.hex||p.icao||p.icao24); if (h) hexSet.add(h.toLowerCase()); });
      const hexes = Array.from(hexSet).slice(0, Math.min(hexSet.size, HEX_SAMPLE));
      console.log(`\n2) Sampling ${hexes.length} hexes for /api/track and /api/flight checks`);

      let trackPointsWithAlt = 0;
      let trackPointsTotal = 0;
      const trackHexStats = [];

      for (const hxRaw of hexes) {
        const hx = encodeURIComponent(hxRaw);
        try {
          const track = await fetchJson(`/api/track?hex=${hx}&minutes=10`);
          const pts = Array.isArray(track.track) ? track.track : (Array.isArray(track) ? track : []);
          let ptsWithAlt = 0;
          pts.forEach(t => { const d = detectAltitudeFields(t); if (d.length) ptsWithAlt++; });
          trackPointsTotal += pts.length;
          trackPointsWithAlt += ptsWithAlt;
          trackHexStats.push({hex:hxRaw, points:pts.length, withAlt:ptsWithAlt});
        } catch (e) {
          trackHexStats.push({hex:hxRaw, points:0, withAlt:0, error:e.message});
        }
      }

      const totalHexesWithTracks = trackHexStats.filter(h=>h.points>0).length;
      console.log(`  track hexes with any points: ${totalHexesWithTracks}/${hexes.length}`);
      if (trackPointsTotal) console.log(`  track points total: ${trackPointsTotal}, with altitude fields: ${trackPointsWithAlt} (${((trackPointsWithAlt/trackPointsTotal)*100).toFixed(1)}%)`);
      else console.log('  no track points found in sampled hexes');

      console.log('\n3) /api/flight checks for sampled hexes (flight payload altitude fields)');
      let flightWithAlt = 0;
      for (const hxRaw of hexes) {
        const hx = encodeURIComponent(hxRaw);
        try {
          const flight = await fetchJson(`/api/flight?icao=${hx}`);
          const fl = flight && flight.flight ? flight.flight : flight;
          const d = detectAltitudeFields(fl || {});
          if (d.length) flightWithAlt++;
        } catch (e) {
          // ignore per-flight failures
        }
      }
      console.log(`  flights with altitude fields: ${flightWithAlt}/${hexes.length}`);
    }

    console.log('\nDone.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(2);
  }
})();