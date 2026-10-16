import test from 'node:test';
import assert from 'node:assert/strict';
import {planWaitlist,seatingOptions,estimateNewParty} from '../public/wait-plan.js';
import {suggestTables} from '../public/suggestions.js';
import {partyRoomAreas} from '../public/areas.js';
const now=10_000_000;
const table=(id,area,capacity=4,extra={})=>({id,area,capacity,status:'open',allowed:[],group:null,...extra});
const party=(id,size,arrivedAt)=>({id,size,arrivedAt,status:'waiting'});
const state=()=>({tables:[table('room','custom-room',4),table('dining','main',6)],parties:[],areaConfig:[{id:'main',name:'Main dining',kind:'section'},{id:'custom-room',name:'Birthday room',kind:'room',accessiblePreferred:true}]});

test('dining room beats a tighter party-room fit across waitlist, estimates and Seat now',()=>{
 const s=state(),rooms=partyRoomAreas(s);
 assert.deepEqual(suggestTables(s.tables,4,5,new Set(['custom-room']),rooms).map(ts=>ts.map(t=>t.id)),[['dining']]);
 const plan=planWaitlist(s,now);
 assert.equal(estimateNewParty(plan,4,{accessibility:true}).tables[0].id,'dining');
 assert.deepEqual(seatingOptions(plan,4,{accessibility:true}).open.map(o=>o.tables[0].id),['dining']);
 s.parties=[party('first',4,1),party('second',4,2)];
 const rows=planWaitlist(s,now).rows;
 assert.equal(rows[0].estimate.tables[0].id,'dining');
 assert.equal(rows[1].estimate.tables[0].id,'room');
 assert.ok(rows.every(r=>r.estimate.ready));
});

test('suitable main-dining combinations are used before party-room singles',()=>{
 const s=state();s.tables=[table('room','custom-room',8),table('a','main',4,{allowed:['b']}),table('b','main',4,{allowed:['a']})];
 s.parties=[party('large',8,1)];
 assert.deepEqual(planWaitlist(s,now).rows[0].estimate.tables.map(t=>t.id),['a','b']);
 assert.deepEqual(seatingOptions(planWaitlist({...s,parties:[]},now),8).open.map(o=>o.tables.map(t=>t.id)),[['a','b']]);
});

test('party rooms become overflow immediately when dining is occupied, cleaning or too small',()=>{
 for(const extra of [{status:'in_use',seatedAt:now},{status:'cleaning',cleaningAt:now},{capacity:2}]){
  const s=state();Object.assign(s.tables[1],extra);
  const plan=planWaitlist(s,now);
  assert.equal(estimateNewParty(plan,4).tables[0].id,'room');
  assert.deepEqual(seatingOptions(plan,4).open.map(o=>o.tables[0].id),['room']);
  assert.equal(suggestTables(s.tables,4,5,new Set(),partyRoomAreas(s))[0][0].id,'room');
 }
});

test('overflow still protects scheduled and blocked rooms, and honors store-specific area kinds',()=>{
 const s=state();s.tables[1].status='in_use';s.tables[1].seatedAt=now;
 s.roomSchedule=[{id:'booking',status:'scheduled',areas:['custom-room'],startsAt:now,endsAt:now+120*60000}];
 assert.equal(seatingOptions(planWaitlist(s,now),4).open.length,0);
 s.roomSchedule=[];s.tables[0].roomBlock='held';s.tables[0].status='reserved';
 assert.equal(seatingOptions(planWaitlist(s,now),4).open.length,0);
 const renamed=state();renamed.areaConfig[0].name='Rose City';renamed.areaConfig[1].name='New room name';
 assert.equal(estimateNewParty(planWaitlist(renamed,now),4).tables[0].id,'dining');
 assert.deepEqual([...partyRoomAreas({tables:[]})],['Rose City','Azalea Trail','Piney Woods']);
});
