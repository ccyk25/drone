import { runComparison } from '../src/control/sim.js';
const r = runComparison({ runs: Number(process.argv[2] || 200) });
console.log(`runs ${r.runs} in ${r.ms} ms`);
for (const s of r.results) console.log(`${s.name.padEnd(42)} found ${s.foundPct.toFixed(1)}% | first find ${s.medianFirstFindS}s | missed-in-flown-over ${s.missedFlownOverPct.toFixed(0)}% | missed-marked-cleared ${s.missedMarkedClearedPct.toFixed(0)}%`);
