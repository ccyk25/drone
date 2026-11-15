// drone.js (P2): virtual drone kinematics, per HANDOVER §8.3.
// Frame: x east, y north (metres). headingDeg: 0 = north, clockwise positive.

export function wrapDeg(d) { return ((((d + 180) % 360) + 360) % 360) - 180; }
export function bearingTo(from, to) { return (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI; }

export function createDrone(config, start = { x: 0, y: 0, headingDeg: 0 }) {
  const { speedMps, turnRateDegPerS } = config.drone;
  const state = { x: start.x, y: start.y, headingDeg: start.headingDeg || 0, mode: 'idle' };
  let target = null;
  const ARRIVE_M = 8;

  function setTarget(xy, mode = 'search') {
    target = xy ? { x: xy.x, y: xy.y } : null;
    state.mode = target ? mode : 'idle';
  }

  /** Advance dtMs. Returns { arrived } (true on the tick the target is reached). */
  function tick(dtMs) {
    if (!target) return { arrived: false };
    const dt = dtMs / 1000;
    const dist = Math.hypot(target.x - state.x, target.y - state.y);
    if (dist < ARRIVE_M) { target = null; return { arrived: true }; }

    // 1. turn toward target, limited by turn rate
    const diff = wrapDeg(bearingTo(state, target) - state.headingDeg);
    const maxTurn = turnRateDegPerS * dt;
    state.headingDeg = wrapDeg(state.headingDeg + Math.max(-maxTurn, Math.min(maxTurn, diff)));

    // 2. move forward; slow down when facing away so it doesn't orbit the target
    const v = speedMps * (Math.abs(diff) > 90 ? 0.3 : 1);
    const step = Math.min(v * dt, dist);
    const r = (state.headingDeg * Math.PI) / 180;
    state.x += Math.sin(r) * step;
    state.y += Math.cos(r) * step;
    return { arrived: false };
  }

  return { state, setTarget, tick, get target() { return target; } };
}
