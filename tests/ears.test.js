import { describe, it, expect } from 'vitest';
import { connectEars } from '../src/control/ears.js';

describe('connectEars (P2 link)', () => {
  it('simulated scream near L produces a left-turning audio detection', async () => {
    const got = [];
    const ears = connectEars({ room: 'TEST', onDetection: (d) => got.push(d) });
    ears.simulateScream('L');
    await new Promise((r) => setTimeout(r, 800));   // fusion window
    ears.close();
    expect(got).toHaveLength(1);
    expect(got[0].sensor).toBe('audio');
    expect(got[0].relBearingDeg).toBeLessThan(-20);
  });

  it('simulated sighting produces a camera detection immediately', () => {
    const got = [];
    const ears = connectEars({ room: 'TEST', onDetection: (d) => got.push(d) });
    ears.simulateSighting('R', 0);
    ears.close();
    expect(got[0].sensor).toBe('camera');
    expect(got[0].relBearingDeg).toBe(45);
  });

  it('builds ear URLs with the room code', () => {
    const ears = connectEars({ room: 'abcd' });
    expect(ears.room).toBe('ABCD');
    expect(ears.earUrl('C')).toMatch(/\/ear\.html\?room=ABCD&ear=C$/);
    ears.close();
  });
});
