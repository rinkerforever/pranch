import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAction} from '../src/model.js';
import {reportClock,reportView,seatOccupancy} from '../public/reports.js';
const start=Date.parse('2026-06-01T15:00:00Z'),minute=60000;
function fixture(){return {tables:[{id:'a',area:'A',number:'11',kind:'table',capacity:4,status:'open',allowed:[]},{id:'b',area:'B',number:'21',kind:'table',capacity:6,status:'open',allowed:[]}],parties:[],history:[],areaConfig:[{id:'A',name:'A',kind:'section'},{id:'B',name:'B',kind:'section'}]};}
const act=(s,a,t=start)=>applyAction(s,a,'manager',t);
test('time-weighted occupancy uses actual guests, persists daily totals and projects idle time without writes',()=>{
 let s=act(fixture(),{type:'seatNow',ids:['a'],name:'Two guests',size:2});
 s=act(s,{type:'status',ids:['a'],status:'cleaning'},start+30*minute);
 s=act(s,{type:'status',ids:['a'],status:'open'},start+40*minute);
 s=act(s,{type:'seatNow',ids:['b'],name:'Six guests',size:6},start+60*minute);
 const saved=JSON.stringify(s),r=reportView(s,'2026-06-01',10,12,start+120*minute);
 assert.equal(r.averageSeats,3.5);assert.equal(r.averagePercent,35);assert.equal(r.peak.hour,11);assert.equal(r.peak.percent,60);
 assert.equal(r.metrics.seatedGuests,8);assert.equal(r.metrics.seatedParties,2);assert.equal(r.metrics.waitCount,undefined);
 assert.equal(r.metrics.diningMinutes,30);assert.equal(r.metrics.cleaningMinutes,10);assert.equal(r.estimated,false);
 assert.equal(JSON.stringify(s),saved);assert.deepEqual(reportView(JSON.parse(saved),'2026-06-01',10,12,start+120*minute),r);
});
test('manual in-use occupancy is explicitly estimated, closed sections remain in restaurant capacity',()=>{
 let s=act(fixture(),{type:'status',ids:['a'],status:'in_use'});s=act(s,{type:'areaAvailability',area:'B',closed:true},start+minute);
 const r=reportView(s,'2026-06-01',10,11,start+60*minute);assert.equal(r.averagePercent,40);assert.equal(r.estimated,true);assert.equal(r.metrics.seatedGuests,undefined);
 assert.deepEqual(seatOccupancy(s),{seats:4,known:0,estimated:4,capacity:10,unknownCapacity:0});
});
test('wait metrics use the original quote and cancellation is counted once',()=>{
 let s=act(fixture(),{type:'addParty',name:'Waiting',size:2});const id=s.parties[0].id;
 s=act(s,{type:'seat',ids:['a'],partyId:id},start+10*minute);
 s=act(s,{type:'addParty',name:'Leaving',size:3},start+11*minute);const left=s.parties.find(p=>p.name==='Leaving').id;
 s=act(s,{type:'cancelParty',id:left},start+12*minute);
 const m=reportView(s,'2026-06-01',10,21,start+13*minute).metrics;
 assert.equal(m.waitCount,1);assert.equal(m.waitMinutes,10);assert.equal(m.quoteCount,1);assert.equal(m.quoteMet,undefined);assert.equal(m.lateMinutes,5);assert.equal(m.leftGuests,3);assert.equal(m.leftParties,1);
 assert.throws(()=>act(s,{type:'cancelParty',id:left},start+13*minute),/no longer waiting/);
});
test('undo corrects totals and accidental occupancy rather than recording a second visit',()=>{
 let s=act(fixture(),{type:'seatNow',ids:['a'],size:2});
 s=act(s,{type:'undo',undoId:s.lastUndo.id},start+2*minute);
 let r=reportView(s,'2026-06-01',10,11,start+5*minute);assert.equal(r.metrics.seatedGuests,0);assert.equal(r.averagePercent,0);assert.equal(r.current.known,0);
 s=act(s,{type:'seatNow',ids:['a'],size:2},start+10*minute);
 s=act(s,{type:'status',ids:['a'],status:'open'},start+30*minute);
 s=act(s,{type:'undo',undoId:s.lastUndo.id},start+32*minute);
 r=reportView(s,'2026-06-01',10,11,start+40*minute);assert.equal(r.metrics.seatedGuests,2);assert.equal(r.metrics.diningCount,0);assert.equal(r.averagePercent,15);assert.equal(r.current.known,2);
});
test('missing history stays missing; partial hours and unknown capacities are flagged',()=>{
 assert.equal(reportView(fixture(),'2026-06-01',10,21,start).startedAt,null);
 let s=fixture();s.tables[1].capacity=null;s=act(s,{type:'seatNow',ids:['a'],size:2},start+15*minute);
 const r=reportView(s,'2026-06-01',10,11,start+30*minute);assert.equal(r.observedMs,15*minute);assert.equal(r.averagePercent,50);assert.equal(r.unknownCapacity,true);
 assert.equal(reportView(s,'2026-05-31',10,21,start).averagePercent,null);
});
test('midnight, DST fallback and bounded retention use restaurant time, not device timezone',()=>{
 assert.equal(reportClock(Date.parse('2026-06-02T04:59:00Z')).date,'2026-06-01');assert.equal(reportClock(Date.parse('2026-06-02T05:00:00Z')).date,'2026-06-02');
 const fall=Date.parse('2026-11-01T06:00:00Z');let s=act(fixture(),{type:'seatNow',ids:['a'],size:2},fall);
 const r=reportView(s,'2026-11-01',1,2,fall+120*minute);assert.equal(r.observedMs,120*minute);assert.equal(r.averagePercent,20);
 s=act(s,{type:'status',ids:['a'],status:'open'},fall+60*86400000);assert.ok(Object.keys(s.reporting.days).length<=31);assert.equal(s.reporting.days['2026-11-01'],undefined);
});
test('store hours are location state and require manager access and valid same-day range',()=>{
 assert.throws(()=>applyAction(fixture(),{type:'reportHours',from:10,to:21},'host',start),/Manager access/);
 assert.throws(()=>act(fixture(),{type:'reportHours',from:21,to:10}),/closing after opening/);
 const a=fixture(),b=fixture(),s=act(a,{type:'reportHours',from:10,to:21});assert.deepEqual(s.reportHours,{from:10,to:21});assert.equal(a.reportHours,undefined);assert.equal(b.reportHours,undefined);
});
test('minor clock rollback preserves guest counts without integrating elapsed time twice',()=>{
 let s=act(fixture(),{type:'reportHours',from:10,to:21});
 s=act(s,{type:'seatNow',size:2,ids:['a']},start-1000);
 assert.equal(s.reporting.cursor,start);assert.equal(reportView(s,'2026-06-01',10,11,start+minute).metrics.seatedGuests,2);
 assert.equal(reportView(s,'2026-06-01',10,11,start+minute).observedMs,minute);
});
