// Realtime message contract between phone ears and the control screen. Owner: P1.
// Every receiver drops anything that fails validate().

export const EARS = ['L', 'C', 'R'];

export const MSG = {
  HELLO: 'hello',             // ear → control  { ear, label? }
  LEVEL: 'level',             // ear → control  { ear, t, db, floorDb, bandRatio, screamScore }  (~8 Hz)
  SCREAM: 'scream',           // ear → control  { ear, t, peakDb, durationMs, confidence, kind?: 'scream'|'muffled' }
  CALIBRATE: 'calibrate',     // control → ears { phase: 'start'|'clap'|'done', gains? }
  CALIBRATION: 'calibration', // ear → control  { ear, floorDb, clapPeakDb }  (reply after the clap phase)
  SIGHTING: 'sighting',       // ear → control  { ear, t, confidence, offset }  camera saw a person; offset -1 (left) .. +1 (right)
  FRAME: 'frame'              // ear → control  { ear, t, jpg, box?, score? }  small live camera preview (~2/s, ~10 KB), not stored
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
        && isNum(msg.confidence)
        && (msg.kind === undefined || msg.kind === 'scream' || msg.kind === 'muffled');
    case MSG.CALIBRATE:
      return ['start', 'clap', 'done'].includes(msg.phase)
        && (msg.gains === undefined || (typeof msg.gains === 'object' && msg.gains !== null
          && Object.entries(msg.gains).every(([k, v]) => isEar(k) && isNum(v))));
    case MSG.CALIBRATION:
      return isEar(msg.ear) && isNum(msg.floorDb) && isNum(msg.clapPeakDb);
    case MSG.FRAME:
      return isEar(msg.ear) && isNum(msg.t) && typeof msg.jpg === 'string'
        && msg.jpg.startsWith('data:image/jpeg') && msg.jpg.length <= 120000
        && (msg.box == null || (Array.isArray(msg.box) && msg.box.length === 4 && msg.box.every(isNum)))
        && (msg.score == null || isNum(msg.score));
    case MSG.SIGHTING:
      return isEar(msg.ear) && isNum(msg.t) && isNum(msg.confidence) && isNum(msg.offset)
        && msg.offset >= -1 && msg.offset <= 1;
    default:
      return false;
  }
}
