// Chairs transcribed from Seating Chart Final 9-13.pdf. Booth capacities intentionally unconfirmed.
export const AREAS = ['A', 'B', 'C', 'Rose City', 'Azalea Trail', 'Piney Woods'];
export function initialTables() {
  const tables = [];
  const add = (area, number, x, y, capacity, orientation = 'lr', kind = 'table') => tables.push({
    id: `${area}-${number}`, area, number: String(number), x, y, capacity,
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
export const WALL_PATH = 'M10 860V0H1610V165L1640 165M1610 230V300M1610 380V870M10 860H1610M10 90H110V340H10M10 400H110V650H10M110 650V770M165 310V680H560V600H700V555H940L960 537H1240L1310 500V438H1395V330H1490M165 410H525V317H1115V400H1310V362H1340L1360 335H1430M1115 317H1240V377H1310M1030 0V134H1080M1080 134H1340M1385 0V130M1205 0V130M1610 230H1495L1460 190L1420 150M1510 330V410M10 340H90M10 400H90M10 860V905M1610 870V930';
export const ROOM_LABELS = [
  ['Funzone',570,174],['Kitchen',725,450],['Women’s restroom',60,225],['Men’s restroom',60,532],
  ['Rose City',1120,167],['Azalea Trail',1300,167],['Piney Woods',1500,185],
  ['Entrance',1565,354],['Host',1520,513],['Section C',384,714],['Section B',998,680],['Section A',1460,568],
];
