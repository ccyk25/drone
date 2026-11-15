// Bayesian search grid engine. Owner: P3. Pure functions only (no DOM). See HANDOVER 8.3.
import { CONFIG } from '../shared/config.js';

export function createGrid(config = CONFIG) { throw new Error('search.createGrid: not implemented (P3)'); }
export function cellCenter(grid, i) { throw new Error('search.cellCenter: not implemented (P3)'); }
export function podFor(distanceM, noiseDb, config = CONFIG) { return 0; }
export function applyNegativeScan(grid, droneXY, noiseDb, config = CONFIG) { /* P3 */ }
export function applyDetection(grid, droneXY, absBearingDeg, confidence, config = CONFIG) { /* P3 */ }
export function applyFamilyReport(grid, i, config = CONFIG) { /* P3 */ }
export function nextWaypoint(grid, droneXY) { return 0; }
export function trustClass(grid, i, config = CONFIG) { return 'unsearched'; }
