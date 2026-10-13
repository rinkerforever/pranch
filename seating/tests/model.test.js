import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyAction} from '../src/model.js';
const run=(s,a,role='admin')=>applyAction(s,a,role,100000,()=>crypto.randomUUID());
const waiting=(size=6)=>run(initialState(),{type:'addParty',name:'Johnson',size,notes:''});
test('PDF transcription preserves all 68 table identities and chair capacities',()=>{
  const {tables}=initialState();assert.equal(tables.length,68);assert.equal(new Set(tables.map(t=>t.id)).size,68);
  for(const n of [71,61,51,41,31,21])assert.equal(tables.find(t=>t.id===`C-${n}`).capacity,6);
  for(const n of [72,62,52,42,32,22])assert.equal(tables.find(t=>t.id===`C-${n}`).capacity,2);
  for(const n of [30,31,32,20,21,22])assert.equal(tables.find(t=>t.id===`A-${n}`).capacity,4);
  assert.equal(tables.find(t=>t.id==='B-40').capacity,6);
  assert.ok(tables.filter(t=>t.kind==='booth').every(t=>t.capacity===null));
});
test('undersized, occupied, and unknown-capacity tables cannot seat guests',()=>{
  let s=waiting();const partyId=s.parties[0].id;
  assert.throws(()=>run(s,{type:'seat',partyId,ids:['B-70']}),/enough seats/);
  assert.throws(()=>run(s,{type:'seat',partyId,ids:['C-70']}),/capacity/);
  s=run(s,{type:'status',ids:['C-71'],status:'cleaning'});
  assert.throws(()=>run(s,{type:'seat',partyId,ids:['C-71']}),/Only open/);
});
test('approved combinations seat and clear as a group; partial clear is rejected',()=>{
  let s=waiting(),partyId=s.parties[0].id;
  assert.throws(()=>run(s,{type:'seat',partyId,ids:['B-70','B-20']}),/approved combination/);
  const t=s.tables.find(t=>t.id==='B-70');s=run(s,{type:'layout',id:t.id,table:{...t,allowed:['B-60']}});
  s=run(s,{type:'seat',partyId,ids:['B-70','B-60']});assert.equal(s.parties[0].status,'seated');
  assert.throws(()=>run(s,{type:'status',ids:['B-70'],status:'open'}),/entire combined/);
  assert.throws(()=>run(s,{type:'split',ids:['B-70','B-60']}),/Clear the party/);
  s=run(s,{type:'status',ids:['B-70','B-60'],status:'cleaning'});assert.equal(s.parties[0].status,'completed');
  s=run(s,{type:'split',ids:['B-70','B-60']});assert.equal(s.tables.find(t=>t.id==='B-70').group,null);
});
test('same party cannot be seated twice',()=>{let s=waiting(),partyId=s.parties[0].id;s=run(s,{type:'seat',partyId,ids:['C-71']});assert.throws(()=>run(s,{type:'seat',partyId,ids:['C-51']}),/already been seated/);});
test('viewer cannot write and host cannot edit layout',()=>{
  const s=initialState();assert.throws(()=>run(s,{type:'addParty',name:'X',size:2},'viewer'),/view-only/);
  assert.throws(()=>run(s,{type:'layout',id:'B-70',table:s.tables[0]},'host'),/Manager/);
});
test('invalid sizes, duplicate table ids and invalid statuses are rejected without mutation',()=>{
  const s=initialState(),before=JSON.stringify(s);
  for(const size of [0,-1,101,2.5,NaN])assert.throws(()=>run(s,{type:'addParty',name:'X',size}),/party size/);
  assert.throws(()=>run(s,{type:'status',ids:['B-70','B-70'],status:'open'}));
  assert.throws(()=>run(s,{type:'status',ids:['B-70'],status:'made_up'}));assert.equal(JSON.stringify(s),before);
});
test('booths can link to tables, but not other booths or different areas',()=>{
  const s=initialState(),t=s.tables.find(t=>t.id==='B-70');
  assert.doesNotThrow(()=>run(s,{type:'layout',id:t.id,table:{...t,kind:'booth',allowed:['B-60']}}));
  assert.throws(()=>run(s,{type:'layout',id:t.id,table:{...t,kind:'booth',allowed:['B-92']}}),/same area/);
  assert.throws(()=>run(s,{type:'layout',id:t.id,table:{...t,allowed:['A-20']}}),/same area/);
});
test('editing waiting guests retains arrival order and removal cannot remove seated parties',()=>{
  let s=waiting(2),p=s.parties[0];s=run(s,{type:'editParty',id:p.id,name:'Updated',size:4,notes:'Window'});assert.equal(s.parties[0].arrivedAt,p.arrivedAt);
  s=run(s,{type:'seat',partyId:p.id,ids:['B-70']});assert.throws(()=>run(s,{type:'cancelParty',id:p.id}),/no longer waiting/);
});

test('booth combinations require acknowledgement for combine and seat',()=>{
 let s=waiting(6);const booth=s.tables.find(t=>t.id==='B-92');booth.capacity=4;
 const ids=['B-92','B-91'],partyId=s.parties[0].id;
 assert.throws(()=>run(s,{type:'combine',ids}),/notice/);
 assert.throws(()=>run(s,{type:'seat',ids,partyId}),/notice/);
 s=run(s,{type:'combine',ids,boothAcknowledged:true});
 assert.throws(()=>run(s,{type:'seat',ids,partyId}),/notice/);
 s=run(s,{type:'seat',ids,partyId,boothAcknowledged:true});assert.equal(s.parties[0].status,'seated');
});
test('child override allows exactly one extra guest at a confirmed single booth',()=>{
 let s=waiting(5),id='A-40',partyId=s.parties[0].id;s.tables.find(t=>t.id===id).capacity=4;
 assert.throws(()=>run(s,{type:'seat',ids:[id],partyId}),/enough seats/);
 assert.throws(()=>run(s,{type:'seat',ids:['B-70'],partyId,childOverride:true}),/enough seats/);
 assert.throws(()=>run(s,{type:'seat',ids:['C-70'],partyId,childOverride:true}),/capacity/);
 let tooLarge=structuredClone(s);tooLarge.parties[0].size=6;
 assert.throws(()=>run(tooLarge,{type:'seat',ids:[id],partyId,childOverride:true}),/enough seats/);
 const seated=run(s,{type:'seat',ids:[id],partyId,childOverride:true},'host');
 assert.equal(seated.tables.find(t=>t.id===id).capacity,4);assert.equal(seated.parties[0].childOverride.extraGuests,1);
 assert.throws(()=>run(seated,{type:'seat',ids:[id],partyId,childOverride:true}),/already/);
 assert.throws(()=>run(s,{type:'seat',ids:[id],partyId,childOverride:true},'viewer'),/view-only/);
});
test('equipment requests survive edits and seating; invalid flags are rejected',()=>{
 let s=run(initialState(),{type:'addParty',name:'Family',size:4,highChair:true,booster:true});let p=s.parties[0];
 assert.equal(p.highChair,true);assert.equal(p.booster,true);
 s=run(s,{type:'editParty',id:p.id,name:p.name,size:4});assert.equal(s.parties[0].highChair,true);
 s=run(s,{type:'editParty',id:p.id,name:p.name,size:4,booster:false});assert.equal(s.parties[0].booster,false);
 s=run(s,{type:'seat',partyId:p.id,ids:['B-70']});assert.equal(s.parties[0].highChair,true);
 assert.throws(()=>run(s,{type:'addParty',name:'X',size:2,highChair:'yes'}),/checkboxes/);
 assert.throws(()=>run(s,{type:'presetCombinations'},'host'),/Manager/);
});
