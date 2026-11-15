import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/shared/config.js';
import { bestPerson, createSightingGate } from '../src/ear/camera.js';
import { createFusion } from '../src/control/fusion.js';
import { validate } from '../src/shared/protocol.js';

describe('camera eyes', () => {
  it('picks the most confident person and ignores other classes', () => {
    const preds = [
      { class: 'dog', score: 0.99, bbox: [0, 0, 10, 10] },
      { class: 'person', score: 0.7, bbox: [0, 0, 100, 200] },
      { class: 'person', score: 0.9, bbox: [500, 0, 100, 200] }
    ];
    const p = bestPerson(preds, 640, 0.6);
    expect(p.score).toBe(0.9);
    expect(p.offset).toBeCloseTo((550 / 640) * 2 - 1, 5); // right side → positive
  });

  it('returns null below the confidence threshold', () => {
    expect(bestPerson([{ class: 'person', score: 0.4, bbox: [0, 0, 10, 10] }], 640, 0.6)).toBeNull();
  });

  it('needs consecutive frames and respects the cooldown', () => {
    const gate = createSightingGate(CONFIG.camera);
    const person = { score: 0.8, offset: 0 };
    expect(gate.update(person, 0)).toBeNull();          // 1st frame: not confirmed yet
    expect(gate.update(person, 600)).not.toBeNull();    // 2nd frame: report
    expect(gate.update(person, 1200)).toBeNull();       // cooldown
    expect(gate.update(null, 1800)).toBeNull();         // lost
    expect(gate.update(person, 4000)).toBeNull();       // streak restarts
    expect(gate.update(person, 4600)).not.toBeNull();
  });

  it('fusion turns a sighting into a camera detection with direction', () => {
    const out = [];
    const f = createFusion(CONFIG, { onDetection: (d) => out.push(d), autoFlush: false });
    f.ingest({ type: 'sighting', ear: 'L', t: 0, confidence: 0.8, offset: 0.5 }, 100);
    expect(out).toHaveLength(1);
    expect(out[0].sensor).toBe('camera');
    expect(out[0].relBearingDeg).toBeCloseTo(-45 + 0.5 * CONFIG.camera.halfFovDeg, 5);
  });

  it('protocol validates sightings', () => {
    expect(validate({ type: 'sighting', ear: 'C', t: 1, confidence: 0.8, offset: 0.1 })).toBe(true);
    expect(validate({ type: 'sighting', ear: 'C', t: 1, confidence: 0.8, offset: 3 })).toBe(false);
  });
});
