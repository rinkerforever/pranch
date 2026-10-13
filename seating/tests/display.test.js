import test from 'node:test';
import assert from 'node:assert/strict';
import {initialTables,upgradeNumbering,openSeats} from '../public/floor.js';

test('numbering starts at 11 and upgrades existing assignments only once',()=>{
  const seeded=initialTables();assert.equal(Math.min(...seeded.map(t=>Number(t.number))),11);
  const state={tables:[{id:'A-10',number:'10',party:'guest',group:'g',allowed:['A-11']},{id:'A-11',number:'11',party:'guest',group:'g',allowed:['A-10']}],parties:[{id:'guest',tables:['A-10','A-11']}]};
  const upgraded=upgradeNumbering(state);
  assert.deepEqual(upgraded.tables.map(t=>t.number),['11','12']);
  assert.deepEqual(upgraded.parties[0].tables,['A-10','A-11']);
  assert.equal(upgraded.tables[0].party,'guest');assert.equal(upgraded.tables[0].group,'g');
  assert.deepEqual(upgraded.tables[0].allowed,['A-11']);
  assert.deepEqual(upgradeNumbering(upgraded).tables.map(t=>t.number),['11','12']);
});
test('open seat total excludes occupied, cleaning and unknown capacity',()=>{
  const tables=[{status:'open',capacity:4,group:'g'},{status:'open',capacity:6,group:'g'},{status:'open',capacity:null},{status:'in_use',capacity:8},{status:'cleaning',capacity:2}];
  assert.deepEqual(openSeats(tables),{count:10,unconfirmed:1});
  tables[0].status='in_use';assert.deepEqual(openSeats(tables),{count:6,unconfirmed:1});
});
