import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyAction} from '../src/model.js';
const now=1800000000000,run=(s,a)=>applyAction(s,a,'host',now);
test('a prepared insert key activates once and cannot replace an existing printed QR',()=>{
 const key='a'.repeat(64),setup={type:'funZoneSetup',key};
 const s=run(initialState(),setup);assert.equal(s.funZoneKey,key);assert.equal(run(s,setup).funZoneKey,key);
 assert.throws(()=>run(s,{type:'funZoneSetup',key:'b'.repeat(64)}),/already active/);
 assert.throws(()=>run(initialState(),{type:'funZoneSetup',key:'bad'}),/Invalid/);
 assert.throws(()=>applyAction(initialState(),setup,'viewer'),/view-only/);
});
test('Fun Zone timestamps survive repeat check-ins and reassignment, stop on return and reset for the next trip',()=>{
 let s=run(initialState(),{type:'seatNow',size:4,ids:['B-70']});
 const enter={type:'funZone',ids:['B-70'],active:true};
 s=applyAction(s,enter,'host',now+1000);s=applyAction(s,enter,'host',now+5000);
 assert.equal(s.tables.find(t=>t.id==='B-70').funZoneSince,now+1000);
 s=applyAction(s,{type:'reassign',fromIds:['B-70'],ids:['B-60']},'host',now+10000);
 assert.equal(s.tables.find(t=>t.id==='B-60').funZoneSince,now+1000);
 assert.equal(s.tables.find(t=>t.id==='B-70').funZoneSince,null);
 s=applyAction(s,{type:'funZone',ids:['B-60'],active:false},'host',now+11000);
 assert.equal(s.tables.find(t=>t.id==='B-60').funZoneSince,null);
 s=applyAction(s,{type:'funZone',ids:['B-60'],active:true},'host',now+12000);
 assert.equal(s.tables.find(t=>t.id==='B-60').funZoneSince,now+12000);
 s=applyAction(s,{type:'status',ids:['B-60'],status:'open'},'host',now+13000);
 assert.equal(s.tables.find(t=>t.id==='B-60').funZoneSince,null);
});
test('FunZone preserves occupancy, timer, transfers with reassignment and clears on release',()=>{
 let s=run(initialState(),{type:'seatNow',size:4,ids:['B-70']});
 s=run(s,{type:'funZone',ids:['B-70'],active:true});
 assert.equal(s.tables.find(t=>t.id==='B-70').seatedAt,now);assert.equal(s.tables.find(t=>t.id==='B-70').status,'in_use');
 const undone=run(s,{type:'undo',undoId:s.lastUndo.id});assert.ok(!undone.tables.find(t=>t.id==='B-70').funZone);
 s=run(s,{type:'reassign',fromIds:['B-70'],ids:['B-60']});assert.equal(s.tables.find(t=>t.id==='B-60').funZone,true);assert.equal(s.tables.find(t=>t.id==='B-70').funZone,false);
 for(const status of ['cleaning','open']){const cleared=run(s,{type:'status',ids:['B-60'],status});assert.equal(cleared.tables.find(t=>t.id==='B-60').funZone,false);}
 s=run(s,{type:'funZone',ids:['B-60'],active:false});assert.equal(s.tables.find(t=>t.id==='B-60').funZone,false);
});
test('FunZone validates permissions, occupied status, boolean and complete groups',()=>{
 const s=initialState();assert.throws(()=>run(s,{type:'funZone',ids:['B-70'],active:true}),/occupied/);
 const seated=run(s,{type:'seatNow',size:8,ids:['B-70','B-60']});
 assert.throws(()=>run(seated,{type:'funZone',ids:['B-70'],active:true}),/entire/);
 assert.throws(()=>run(seated,{type:'funZone',ids:['B-70','B-60'],active:'true'}),/whether/);
 assert.throws(()=>applyAction(seated,{type:'funZone',ids:['B-70','B-60'],active:true},'viewer'),/view-only/);
 const away=run(seated,{type:'funZone',ids:['B-70','B-60'],active:true});assert.ok(away.tables.filter(t=>t.group===away.tables.find(t=>t.id==='B-70').group).every(t=>t.funZone));
});
