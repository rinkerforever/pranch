import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyAction} from '../src/model.js';
import {locationWallPath} from '../public/floor.js';
const now=1800000000000;
const run=(s,a,time=now)=>applyAction(s,a,'host',time);
test('saving a table with unchanged links works while its neighbor is occupied',()=>{
 let s=run(initialState(),{type:'seatNow',size:4,ids:['B-70']});
 const table=s.tables.find(t=>t.id==='B-60');assert.ok(table.allowed.includes('B-70'));
 const saved=applyAction(s,{type:'layout',id:table.id,table:{...table,capacity:6}},'admin',now);
 assert.equal(saved.tables.find(t=>t.id===table.id).capacity,6);
 assert.throws(()=>applyAction(s,{type:'layout',id:table.id,table:{...table,allowed:table.allowed.filter(id=>id!=='B-70')}},'admin',now),/Open and separate/);
});
test('reassign preserves party and timer, cleans originals, and supports undo without duplicate report counts',()=>{
 let s=run(initialState(),{type:'seatNow',size:4,name:'Family',ids:['B-70']});
 const p=s.parties[0],before=JSON.stringify(s);
 const moved=run(s,{type:'reassign',fromIds:['B-70'],ids:['B-60']},now+600000);
 assert.equal(JSON.stringify(s),before);assert.equal(moved.parties[0].id,p.id);assert.equal(moved.parties[0].seatedAt,p.seatedAt);
 assert.deepEqual(moved.parties[0].tables,['B-60']);assert.equal(moved.tables.find(t=>t.id==='B-70').status,'cleaning');
 assert.equal(moved.tables.find(t=>t.id==='B-60').seatedAt,now);
 const totals=Object.values(moved.reporting.days).reduce((n,d)=>n+(d.metrics.seatedParties||0),0);assert.equal(totals,1);
 const undone=run(moved,{type:'undo',undoId:moved.lastUndo.id},now+610000);assert.deepEqual(undone.parties[0].tables,['B-70']);assert.equal(undone.tables.find(t=>t.id==='B-60').status,'open');
});
test('reassignment rejects insufficient capacity, occupied destinations and partial groups',()=>{
 let s=run(initialState(),{type:'seatNow',size:4,ids:['B-70']});
 assert.throws(()=>run(s,{type:'reassign',fromIds:['B-70'],ids:['C-72']}),/enough/);
 assert.throws(()=>run(s,{type:'reassign',fromIds:['B-70'],ids:['B-70']}),/Only open/);
 s=run(s,{type:'reassign',fromIds:['B-70'],ids:['B-60','B-50']});
 assert.throws(()=>run(s,{type:'reassign',fromIds:['B-60'],ids:['B-70']}),/entire/);
});
test('manual occupied table moves retain timer without counting a completed visit',()=>{
 let s=run(initialState(),{type:'status',ids:['B-70'],status:'in_use'});
 s=run(s,{type:'reassign',fromIds:['B-70'],ids:['B-60'],size:3},now+600000);
 assert.equal(s.tables.find(t=>t.id==='B-60').seatedAt,now);
 assert.equal(Object.values(s.reporting.days).reduce((n,d)=>n+(d.metrics.diningCount||0),0),0);
});
test('Tyler divider positions follow the requested pairs and never affect another store or imported plan',()=>{
 const state=initialState();assert.equal(locationWallPath('waco',state),'');assert.equal(locationWallPath('loc_tyler',{...state,background:{key:'plan'}}),'');
 assert.equal(locationWallPath('loc_tyler',state),'M1183 802V858 M823 802V858');
});
