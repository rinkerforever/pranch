// Chairs transcribed from Seating Chart Final 9-13.pdf. Booth capacities intentionally unconfirmed.
export const AREAS = ['A', 'B', 'C', 'Rose City', 'Azalea Trail', 'Piney Woods'];
export function initialTables() {
  const tables = [];
  const add = (area, number, x, y, capacity, orientation = 'lr', kind = 'table') => tables.push({
    id: `${area}-${number}`, area, number: String(number + 1), x, y, capacity,
    orientation, kind, status: 'open', group: null, party: null, seatedAt: null, allowed: [],
  });
  [70,60,50,40,30,20].forEach((n,i) => add('C',n,200+i*63,668,null,'lr','booth'));
  [71,61,51,41,31,21].forEach((n,i) => add('C',n,200+i*63,758,6));
  [72,62,52,42,32,22].forEach((n,i) => add('C',n,200+i*63,830,2));
  // These three tables sit LEFT of the C/B divider in the source PDF.
  add('C',10,641,668,2,'tb'); add('C',11,641,748,2,'tb'); add('C',12,641,830,2);
  add('B',90,720,673,2);
  [91,80,70,60,50,40,30,20].forEach((n,i) => add('B',n,715+i*72,752,i<5?4:6));
  [92,81,71,61,51,41,31,21,10].forEach((n,i) => add('B',n,715+i*72,830,(i<2||i>6)?null:4,'lr',(i<2||i>6)?'booth':'table'));
  [40,41,42].forEach((n,i) => add('A',n,1361,706+i*62,null,'tb','booth'));
  [10,11,12,13].forEach((n,i) => add('A',n,1578,624+i*66,null,'tb','booth'));
  [30,31,32].forEach((n,i) => add('A',n,1429,680+i*72,4,'tb'));
  [20,21,22].forEach((n,i) => add('A',n,1502,680+i*72,4,'tb'));
  for (const [area,offset] of [['Rose City',0],['Azalea Trail',175]]) {
    [50,30,10].forEach((n,i) => add(area,n,1064+offset+i*52,42,4,'tb'));
    [40,20].forEach((n,i) => add(area,n,1090+offset+i*60,100,4,'tb'));
  }
  [31,21,11].forEach((n,i) => add('Piney Woods',n,1428+i*67,45,6));
  [30,20,10].forEach((n,i) => add('Piney Woods',n,1438+i*65,112,4,'tb'));
  // Combination eligibility is configured by a manager; adjacency alone does not imply permission.
  return tables;
}
export const FLOOR = { width:1660, height:950 };
// Keep the kitchen above the C booths and allow clearance around the south booth benches.
export const WALL_PATH = 'M10 870V0H1610V165M1610 230V297M1610 380V870M10 870H1610M10 90H110V340H10M10 400H110V650H10M110 650V770M10 770H110M165 310V638H560V600H700V555H940L960 537H1240L1310 500L1395 438V330H1430M165 410H525V317H1115V400H1310V362H1340L1360 335H1430M1115 317H1240V377H1310M1030 0V134H1045M1080 140H1335M1370 140H1385V0M1205 0V130M1610 230H1495M1460 190L1420 150L1405 135L1385 125M1510 410V328L1520 297H1610M1585 410H1610M10 340H90M10 400H90M676 638V870 M900 680H1075 M1327 666V870 M1540 585H1610';
// Door openings from the manager's annotated plan. Blue swing arcs distinguish them from walls.
export const DOORS = [
  {name:'Rose City door',opening:'M1045 134L1080 140',swing:'M1045 134V169 Q1080 169 1080 140'},
  {name:'Azalea Trail door',opening:'M1335 140H1370',swing:'M1370 140V175 Q1335 175 1335 140'},
  {name:'Piney Woods door',opening:'M1460 190L1495 230',swing:'M1460 190L1435 222 Q1455 255 1495 230'},
];
export const ROOM_LABELS = [
  ['Funzone',570,174],['Kitchen',725,450],['Women’s restroom',60,225],['Men’s restroom',60,532],
  ['Rose City',1120,167],['Azalea Trail',1300,167],['Piney Woods',1500,185],
  ['Entrance',1565,354],['Host',1520,513],['Section C',384,714],['Section B',998,656],['Section A',1460,568],
];

// Stable IDs preserve assignments and combination links when visible numbers change.
export function upgradeNumbering(state) {
  if (state.numberingVersion === 1) return state;
  for (const table of state.tables) {
    if (/^\d+$/.test(table.number)) table.number = String(Number(table.number) + 1);
  }
  state.numberingVersion = 1;
  return state;
}
export function openSeats(tables) {
  const open = tables.filter(t => t.status === 'open');
  return { count: open.reduce((sum,t) => sum + (t.capacity || 0), 0), unconfirmed: open.filter(t => !t.capacity).length };
}
