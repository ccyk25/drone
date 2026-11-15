// What covers each grid cell: decides what each sensor can see/hear there. Owner: P3.
// 12 columns × 8 rows (CONFIG.grid). Row 0 = north. Rough model of a flooded residential area
// like Taman Sri Muda: rows of terrace-house roofs, open streets, a park, and the river/flood channel.
//   R = roof (houses)   O = open (streets, car parks)   T = trees (park)   W = water (river, deep flood)
const MAP = [
  'RRRORRRORRRW',
  'RRRORRRORRWW',
  'OOOOOOOOOOWW',
  'RRROTTTORRWW',
  'RRROTTTORRRW',
  'OOOOOOOOOOOW',
  'RRRORRRORRRW',
  'RRRORRRORRRW'
];

const CODE = { R: 'roof', O: 'open', T: 'trees', W: 'water' };

/** Flat array (row-major, length cols × rows) of 'roof' | 'open' | 'trees' | 'water'. */
export const COVER = MAP.join('').split('').map((c) => CODE[c]);
