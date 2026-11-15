// Realtime message contract between phone ears and the control screen. Owner: P1.
// Every receiver drops anything that fails validate().

export const EARS = ['L', 'C', 'R'];

export const MSG = {
  HELLO: 'hello',             // ear → control  { ear, label? }
  LEVEL: 'level',             // ear → control  { ear, t, db, floorDb, bandRatio, screamScore }  (~8 Hz)
  SCREAM: 'scream',           // ear → control  { ear, t, peakDb, durationMs, confidence }
  CALIBRATE: 'calibrate',     // control → ears { phase: 'start'|'clap'|'done', gains? }
  CALIBRATION: 'calibration'  // ear → control  { ear, floorDb, clapPeakDb }  (reply after the clap phase)
};

export const channelName = (room) => `gema-room-${room}`;

export function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isEar = (v) => EARS.includes(v);

export function validate(msg) {
  if (!msg || typeof msg !== 'object') return false;
  switch (msg.type) {
    case MSG.HELLO:
      return isEar(msg.ear) && (msg.label === undefined || typeof msg.label === 'string');
    case MSG.LEVEL:
      return isEar(msg.ear) && isNum(msg.t) && isNum(msg.db) && isNum(msg.floorDb)
        && isNum(msg.bandRatio) && isNum(msg.screamScore);
    case MSG.SCREAM:
      return isEar(msg.ear) && isNum(msg.t) && isNum(msg.peakDb) && isNum(msg.durationMs)
        && isNum(msg.confidence);
    case MSG.CALIBRATE:
      return ['start', 'clap', 'done'].includes(msg.phase)
        && (msg.gains === undefined || (typeof msg.gains === 'object' && msg.gains !== null
          && Object.entries(msg.gains).every(([k, v]) => isEar(k) && isNum(v))));
    case MSG.CALIBRATION:
      return isEar(msg.ear) && isNum(msg.floorDb) && isNum(msg.clapPeakDb);
    default:
      return false;
  }
}
