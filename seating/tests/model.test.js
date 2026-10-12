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
  assert.throws(()=>run(s,{type:'seat',partyId,ids:['B-70','B-60']}),/approved combination/);
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
test('chairs cannot become booths with combination links, and links cannot cross areas',()=>{
  const s=initialState(),t=s.tables.find(t=>t.id==='B-70');
  assert.throws(()=>run(s,{type:'layout',id:t.id,table:{...t,kind:'booth',allowed:['B-60']}}),/movable/);
  assert.throws(()=>run(s,{type:'layout',id:t.id,table:{...t,allowed:['A-20']}}),/movable/);
});
test('editing waiting guests retains arrival order and removal cannot remove seated parties',()=>{
  let s=waiting(2),p=s.parties[0];s=run(s,{type:'editParty',id:p.id,name:'Updated',size:4,notes:'Window'});assert.equal(s.parties[0].arrivedAt,p.arrivedAt);
  s=run(s,{type:'seat',partyId:p.id,ids:['B-70']});assert.throws(()=>run(s,{type:'cancelParty',id:p.id}),/no longer waiting/);
});
