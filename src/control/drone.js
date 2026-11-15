// Virtual drone state and motion. Owner: P2. See HANDOVER 8.3.
import { CONFIG } from '../shared/config.js';

export function createDrone(config = CONFIG) {
  const state = { x: 0, y: 0, headingDeg: 0, mode: 'search' };
  return {
    state,
    setTarget(xy, mode = 'search') { /* P2 */ },
    tick(dtMs) { /* P2 */ }
  };
}
