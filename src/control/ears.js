// One-call link between the phone ears and any control screen. Owner: P1. Built for P2.
//
//   import { connectEars } from './ears.js';
//   const ears = connectEars({
//     onDetection: (d) => { /* d.sensor 'audio'|'camera', d.relBearingDeg, d.confidence */ },
//     onEarStatus: (connected) => { /* e.g. ['L','C'] */ },
//     onLog: (line) => console.log(line)
//   });
//   ears.room                  // 4-letter room code to show on screen
//   ears.earUrl('L')           // URL to turn into a QR code for each phone
//   ears.noiseFloorDb()        // average background level the phones hear (for POD), or null
//   ears.calibrate.start() / .clap() / .apply()
//   ears.simulateScream('L')   // demo fallback, no phones needed
//   ears.simulateSighting('C') // camera fallback
//
// Absolute bearing for the drone = drone heading + d.relBearingDeg.
import { CONFIG } from '../shared/config.js';
import { EARS, MSG, makeRoomCode } from '../shared/protocol.js';
import { joinRoom } from '../realtime/channel.js';
import { createFusion, computeGains } from './fusion.js';

const SIM_DB = { L: { L: -20, C: -24, R: -28 }, C: { L: -24, C: -20, R: -24 }, R: { L: -28, C: -24, R: -20 } };

export function connectEars({ room, config = CONFIG, onDetection, onEarStatus, onLevel, onLog } = {}) {
  room = (room || new URLSearchParams(globalThis.location?.search ?? '').get('room') || makeRoomCode()).toUpperCase();
  const log = (s) => onLog?.(s);
  const floors = {};               // ear → { db, at }
  const clapPeaks = {};
  const fusion = createFusion(config, {
    onDetection: (d) => {
      log(`${d.sensor === 'camera' ? '📷' : '👂'} ${d.sensor} detection ${d.relBearingDeg.toFixed(0)}° (${(d.confidence * 100).toFixed(0)}%)`);
      onDetection?.(d);
    }
  });

  const channel = joinRoom(room, {
    onStatus: (s) => log(`channel ${s}`),
    onMessage: (msg) => {
      fusion.ingest(msg);
      if (msg.type === MSG.LEVEL) { floors[msg.ear] = { db: msg.floorDb, at: Date.now() }; onLevel?.(msg); }
      if (msg.type === MSG.SCREAM) log(`${msg.kind === 'muffled' ? 'muffled voice' : 'scream'} on ${msg.ear}`);
      if (msg.type === MSG.CALIBRATION) { clapPeaks[msg.ear] = msg.clapPeakDb; log(`calibration from ${msg.ear}`); }
    }
  });

  let lastConnected = '';
  const statusTimer = setInterval(() => {
    const c = fusion.connectedEars();
    if (c.join() !== lastConnected) { lastConnected = c.join(); onEarStatus?.(c); }
  }, 500);

  const origin = (typeof __DEV_LAN_ORIGIN__ !== 'undefined' && __DEV_LAN_ORIGIN__ && ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname))
    ? __DEV_LAN_ORIGIN__ : (globalThis.location?.origin ?? '');

  function inject(near) {
    const t = Date.now();
    for (const ear of EARS) {
      const db = SIM_DB[near][ear];
      fusion.ingest({ type: MSG.LEVEL, ear, t, db, floorDb: -60, bandRatio: 0.6, screamScore: 0.9 });
      if (ear === near || db > -25) fusion.ingest({ type: MSG.SCREAM, ear, t, peakDb: db, durationMs: 350, confidence: 0.9, kind: 'scream' });
    }
  }

  return {
    room,
    get status() { return channel.status; },
    earUrl: (ear) => `${origin}/ear.html?room=${room}&ear=${ear}`,
    connectedEars: () => fusion.connectedEars(),
    noiseFloorDb() {
      const recent = Object.values(floors).filter((f) => Date.now() - f.at < 3000);
      return recent.length ? recent.reduce((s, f) => s + f.db, 0) / recent.length : null;
    },
    calibrate: {
      start() { channel.send({ type: MSG.CALIBRATE, phase: 'start' }); log('calibrate: stay quiet 3 s'); },
      clap() { channel.send({ type: MSG.CALIBRATE, phase: 'clap' }); log('calibrate: clap once at the centre'); },
      apply() {
        const gains = computeGains(clapPeaks);
        fusion.setGains(gains);
        channel.send({ type: MSG.CALIBRATE, phase: 'done', gains });
        log(`calibrate: gains ${JSON.stringify(gains)}`);
        return gains;
      }
    },
    simulateScream: (ear = 'C') => { inject(ear); log(`simulated scream near ${ear}`); },
    simulateSighting: (ear = 'C', offset = 0) => {
      fusion.ingest({ type: MSG.SIGHTING, ear, t: Date.now(), confidence: 0.85, offset });
      log(`simulated camera sighting on ${ear}`);
    },
    close() { clearInterval(statusTimer); channel.close(); }
  };
}
