// drone.js (P2): virtual drone kinematics, per HANDOVER §8.3.
// Frame: x east, y north (metres). headingDeg: 0 = north, clockwise positive.
//
// Fix (P1): at sim speeds of 2–8× one tick covered up to 0.8 s, so the drone moved up to 12 m along a
// heading it was still turning, arcing off its flight line. Now each tick is split into ≤ 0.1 s steps,
// and once the drone faces its target it flies straight down the line to it.

export function wrapDeg(d) { return ((((d + 180) % 360) + 360) % 360) - 180; }
export function bearingTo(from, to) { return (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI; }

const SUBSTEP_S = 0.1;
const ALIGNED_DEG = 15;

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
    let remaining = dtMs / 1000;
    while (remaining > 1e-6) {
      const dt = Math.min(SUBSTEP_S, remaining);
      remaining -= dt;
      const dist = Math.hypot(target.x - state.x, target.y - state.y);
      if (dist < ARRIVE_M) { target = null; return { arrived: true }; }

      // 1. turn toward target, limited by turn rate
      const want = bearingTo(state, target);
      const diff = wrapDeg(want - state.headingDeg);
      const maxTurn = turnRateDegPerS * dt;
      state.headingDeg = wrapDeg(state.headingDeg + Math.max(-maxTurn, Math.min(maxTurn, diff)));

      // 2. move: once facing the target, fly straight down the line to it; while still turning,
      //    creep forward slowly so it turns on the spot instead of arcing off the line
      const left = wrapDeg(want - state.headingDeg);
      if (Math.abs(left) <= ALIGNED_DEG) {
        state.headingDeg = wrapDeg(want);
        const step = Math.min(speedMps * dt, dist);
        state.x += ((target.x - state.x) / dist) * step;
        state.y += ((target.y - state.y) / dist) * step;
      } else {
        const v = speedMps * (Math.abs(left) > 90 ? 0.1 : 0.3);
        const r = (state.headingDeg * Math.PI) / 180;
        state.x += Math.sin(r) * v * dt;
        state.y += Math.cos(r) * v * dt;
      }
    }
    return { arrived: false };
  }

  return { state, setTarget, tick, get target() { return target; } };
}
