import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/shared/config.js';
import { COVER } from '../src/shared/cover.js';
import {
  createGrid, cellCenter, cellAt, sensorPod, applyNegativeScan, applyDetection, applyPointDetection,
  applyFamilyReport, nextWaypoint, trustClass, clearedPercent, bearingTo
} from '../src/control/search.js';
import { simulateThermal, mulberry32 } from '../src/control/sensorsSim.js';
import { runComparison } from '../src/control/sim.js';

const sum = (a) => a.reduce((s, v) => s + v, 0);
const firstCell = (grid, type) => grid.cover.findIndex((c) => c === type);

describe('trust-map engine', () => {
  it('grid matches the cover map and cell geometry round-trips', () => {
    const g = createGrid(CONFIG, COVER);
    expect(g.n).toBe(CONFIG.grid.cols * CONFIG.grid.rows);
    expect(COVER).toHaveLength(g.n);
    for (const i of [0, 13, g.n - 1]) { const c = cellCenter(g, i); expect(cellAt(g, c.x, c.y)).toBe(i); }
  });

  it('probabilities always sum to 1', () => {
    const g = createGrid();
    applyNegativeScan(g, { x: 0, y: 0 }, { audio: { noiseDb: -50 }, thermal: {} });
    applyDetection(g, { x: 0, y: 0 }, 90, 0.8);
    applyFamilyReport(g, 5);
    expect(sum([...g.p])).toBeCloseTo(1, 9);
  });

  it('silence in noise lowers probability less than silence in quiet', () => {
    const quiet = createGrid(), noisy = createGrid();
    const at = cellCenter(quiet, 40);
    applyNegativeScan(quiet, at, { audio: { noiseDb: -60 } });
    applyNegativeScan(noisy, at, { audio: { noiseDb: -30 } });
    expect(noisy.cumPod[40]).toBeLessThan(quiet.cumPod[40]);
  });

  it('thermal cannot clear a roof cell, ears can partly', () => {
    const g = createGrid();
    const roof = firstCell(g, 'roof'), open = firstCell(g, 'open');
    const podRoof = sensorPod('thermal', { distanceM: 10, cover: 'roof' });
    const podOpen = sensorPod('thermal', { distanceM: 10, cover: 'open' });
    expect(podRoof).toBeLessThan(0.05);
    expect(podOpen).toBeGreaterThan(0.8);
    expect(sensorPod('audio', { distanceM: 10, noiseDb: -50, cover: 'roof' })).toBeGreaterThan(0.5);
    for (let t = 0; t < 30; t++) applyNegativeScan(g, cellCenter(g, roof), { thermal: {} });
    expect(trustClass(g, roof)).not.toBe('cleared');
    for (let t = 0; t < 30; t++) applyNegativeScan(g, cellCenter(g, open), { thermal: {} });
    expect(trustClass(g, open)).toBe('cleared');
  });

  it('hot afternoons weaken thermal', () => {
    expect(sensorPod('thermal', { distanceM: 0, cover: 'open', hotDay: true }))
      .toBeLessThan(sensorPod('thermal', { distanceM: 0, cover: 'open', hotDay: false }));
  });

  it('a sound from the east raises cells to the east', () => {
    const g = createGrid();
    const centre = { x: 0, y: 0 };
    const east = cellAt(g, 75, 0), west = cellAt(g, -75, 0);
    applyDetection(g, centre, 90, 0.9);
    expect(g.p[east]).toBeGreaterThan(g.p[west] * 3);
    expect(bearingTo(centre, cellCenter(g, east))).toBeGreaterThan(60);
  });

  it('point detections and family reports pull the next waypoint', () => {
    const g = createGrid();
    const far = g.n - 1;
    applyPointDetection(g, cellCenter(g, far), 0.9);
    expect(nextWaypoint(g, cellCenter(g, 0))).toBe(far);
    const g2 = createGrid();
    applyFamilyReport(g2, 20);
    applyFamilyReport(g2, 20);
    expect(nextWaypoint(g2, cellCenter(g2, 20))).toBe(20);
  });

  it('tick length matters: ten 0.1 s scans equal about one 1 s scan', () => {
    const a = createGrid(), b = createGrid();
    const at = cellCenter(a, 50);
    for (let k = 0; k < 10; k++) applyNegativeScan(a, at, { thermal: {} }, CONFIG, 0.1);
    applyNegativeScan(b, at, { thermal: {} }, CONFIG, 1);
    expect(a.cumPod[50]).toBeCloseTo(b.cumPod[50], 6);
  });

  it('cleared percent grows as the drone searches in quiet', () => {
    const g = createGrid();
    expect(clearedPercent(g)).toBe(0);
    for (let i = 0; i < g.n; i++) for (let t = 0; t < 5; t++) applyNegativeScan(g, cellCenter(g, i), { audio: { noiseDb: -60 }, thermal: {} });
    expect(clearedPercent(g)).toBeGreaterThan(50);
  });
});

describe('simulated thermal sensor', () => {
  it('sees someone in the open far more often than under a roof', () => {
    const g = createGrid();
    const open = cellCenter(g, firstCell(g, 'open')), roof = cellCenter(g, firstCell(g, 'roof'));
    const rng = mulberry32(1);
    let seenOpen = 0, seenRoof = 0;
    for (let k = 0; k < 200; k++) {
      seenOpen += simulateThermal(g, open, [{ id: 0, ...open }], { rng }).length;
      seenRoof += simulateThermal(g, roof, [{ id: 0, ...roof }], { rng }).length;
    }
    expect(seenOpen).toBeGreaterThan(150);
    expect(seenRoof).toBeLessThan(20);
  });
});

describe('simulation', () => {
  it('runs quickly and reports sane numbers for all three strategies', () => {
    const r = runComparison({ runs: 30 });
    expect(r.results).toHaveLength(3);
    for (const s of r.results) {
      expect(s.foundPct).toBeGreaterThanOrEqual(0);
      expect(s.foundPct).toBeLessThanOrEqual(100);
    }
  }, 30000);
});
