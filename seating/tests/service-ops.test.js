import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAction} from '../src/model.js';
import {planWaitlist,estimateNewParty} from '../public/wait-plan.js';
import {serviceTables,cleaningQueue,delayReason,undoAvailable} from '../public/service-ops.js';
import {walkInTables} from '../public/rooms.js';
const now=1800000000000;
function fixture(){return {tables:[{id:'a',number:'11',area:'A',kind:'table',capacity:4,status:'open',allowed:['b'],x:100,y:100},{id:'b',number:'12',area:'A',kind:'table',capacity:4,status:'open',allowed:['a'],x:150,y:100},{id:'c',number:'21',area:'B',kind:'table',capacity:4,status:'open',allowed:[],x:300,y:100}],areaConfig:[{id:'A',name:'Dining',kind:'section'},{id:'B',name:'Buffet',kind:'section'}],parties:[],history:[]};}
const act=(s,a,time=now)=>applyAction(s,a,'host',time);
const undo=(s,time=now)=>act(s,{type:'undo',undoId:s.lastUndo?.id},time);
test('undo restores a cleared guest and dining samples, rejects stale tokens and expires',()=>{
 let s=act(fixture(),{type:'seatNow',ids:['a'],name:'Guest',size:4},now-30*60000);
 const seated=structuredClone(s);s=act(s,{type:'status',ids:['a'],status:'open'});
 assert.equal(s.parties[0].status,'completed');assert.ok(undoAvailable(s,now));
 const restored=undo(JSON.parse(JSON.stringify(s)));
 assert.deepEqual(restored.tables.find(t=>t.id==='a'),seated.tables.find(t=>t.id==='a'));assert.deepEqual(restored.parties,seated.parties);assert.equal(restored.lastUndo,null);
 assert.throws(()=>undo(s,now+5*60000+1),/expired/);
 const oldId=s.lastUndo.id;s=act(s,{type:'status',ids:['b'],status:'cleaning'});
 assert.throws(()=>act(s,{type:'undo',undoId:oldId}),/no longer/);
 s.tables.find(t=>t.id==='b').status='in_use';assert.equal(undoAvailable(s,now),false);assert.throws(()=>undo(s),/no longer/);
});
test('undo of Seat now removes the walk-in and permissions remain enforced',()=>{
 const s=act(fixture(),{type:'seatNow',ids:['a'],size:2});
 assert.equal(undo(s).parties.length,0);assert.equal(undo(s).tables.find(t=>t.id==='a').status,'open');
 assert.throws(()=>applyAction(s,{type:'undo',undoId:s.lastUndo.id},'viewer',now),/view-only/);
 const changed=act(s,{type:'addParty',name:'New guest',size:2});assert.equal(changed.lastUndo,null);
});
test('closed sections exclude whole groups, counts and suggestions while retaining current guests',()=>{
 let s=fixture();s.tables[0].group='g';s.tables[2].group='g';
 s=act(s,{type:'areaAvailability',area:'B',closed:true});
 assert.deepEqual(serviceTables(s).map(t=>t.id),['b']);assert.deepEqual(walkInTables(s,now).map(t=>t.id),['b']);
 assert.deepEqual(estimateNewParty(planWaitlist(s,now),4).tables.map(t=>t.id),['b']);
 assert.throws(()=>act(s,{type:'status',ids:['a','c'],status:'in_use'}),/closed/);
 assert.throws(()=>act(s,{type:'combine',ids:['a','c'],combinationOverride:true}),/closed/);
 assert.throws(()=>act(s,{type:'seatNow',ids:['c'],size:2}),/occupied, held, or planned/);
 s=act(s,{type:'areaAvailability',area:'A',closed:true});assert.equal(estimateNewParty(planWaitlist(s,now),2),null);
 s=act(s,{type:'areaAvailability',area:'B',closed:false});assert.equal(serviceTables(s).length,0); // Group still crosses closed A.
 assert.throws(()=>applyAction(s,{type:'areaAvailability',area:'A',closed:false},'viewer'),/view-only/);
});
test('not-present guests release queue allocation and return with their original arrival and quote',()=>{
 let s=fixture();s.tables=s.tables.slice(0,1);s=act(s,{type:'addParty',name:'First',size:4});const first=s.parties[0],quote=structuredClone(first.waitQuote);
 s=act(s,{type:'addParty',name:'Second',size:4},now+1000);const second=s.parties[1];
 s=act(s,{type:'partyContact',id:first.id,contact:'called'},now+60000);assert.equal(s.parties[0].calledAt,now+60000);
 s=act(s,{type:'partyContact',id:first.id,contact:'away'},now+120000);
 let rows=planWaitlist(s,now+120000).rows;assert.equal(rows.find(r=>r.party.id===first.id).estimate,null);assert.equal(rows.find(r=>r.party.id===second.id).estimate.ready,true);
 assert.throws(()=>act(s,{type:'seat',partyId:first.id,ids:['a']}),/Return this guest/);
 s=act(s,{type:'partyContact',id:first.id,contact:'waiting'},now+180000);rows=planWaitlist(s,now+180000).rows;
 assert.equal(rows[0].estimate.ready,true);assert.equal(s.parties[0].arrivedAt,first.arrivedAt);assert.deepEqual(s.parties[0].waitQuote,quote);assert.equal(s.parties[0].calledAt,undefined);
});
test('forecast explanations preserve real table status and cleaning queue highlights only immediately ready guests',()=>{
 let s=fixture();s.tables=s.tables.slice(0,2);s.tables[0].status='cleaning';s.tables[0].cleaningAt=now-3*60000;s.tables[1].status='in_use';s.tables[1].seatedAt=now-10*60000;
 s=act(s,{type:'addParty',name:'First',size:4});s=act(s,{type:'addParty',name:'Second',size:4},now+1);
 const plan=planWaitlist(s,now),row=plan.rows[0];assert.equal(row.estimate.tables[0].status,'cleaning');assert.match(delayReason(row.party,row.estimate),/cleaning/);
 const queue=cleaningQueue(s,plan,now,planWaitlist);assert.equal(queue[0].minutes,3);assert.deepEqual(queue[0].guests.map(p=>p.name),['First']);
 s.tables[1].status='cleaning';s.tables[1].cleaningAt=now-8*60000;assert.equal(cleaningQueue(s,planWaitlist(s,now),now,planWaitlist)[0].key,'b');
 s.tables[0].group='g';s.tables[1].group='g';s.tables[1].status='in_use';assert.equal(cleaningQueue(s,planWaitlist(s,now),now,planWaitlist)[0].canReady,false);
});
