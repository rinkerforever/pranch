import test from 'node:test';
import assert from 'node:assert/strict';
import {planWaitlist,estimateNewParty,waitRange,waitSettings} from '../public/wait-plan.js';
import {initialState,applyAction} from '../src/model.js';
const now=10000000;
const table=(id,capacity,extra={})=>({id,capacity,area:'A',allowed:[],status:'open',group:null,kind:'table',...extra});
const party=(id,size,arrivedAt=now-1000)=>({id,name:id,size,arrivedAt,status:'waiting'});
test('green rows have distinct open tables; newcomer waits behind queued parties',()=>{
 const state={tables:[table('a',4)],parties:[party('first',4,1),party('second',2,2)]};
 const plan=planWaitlist(state,now);assert.equal(plan.rows[0].estimate.ready,true);assert.equal(plan.rows[1].estimate.ready,false);assert.equal(plan.rows[1].estimate.minutes,65);
 assert.equal(estimateNewParty(plan,2).minutes,130);assert.equal(waitRange(plan.rows[0].estimate),'Ready to seat');assert.equal(waitRange(plan.rows[1].estimate),'60–75 min');
 assert.equal(state.tables[0].status,'open');assert.deepEqual(state.tables[0].allowed,[]);
});
test('large party gets a ready combination before smaller parties take its tables',()=>{
 const state={tables:[table('a',4,{allowed:['b']}),table('b',4,{allowed:['a']}),table('c',2)],parties:[party('small',2,1),party('large',8,2)]};
 const plan=planWaitlist(state,now),large=plan.rows[1],small=plan.rows[0];assert.equal(large.combinationPriority,true);assert.equal(large.estimate.ready,true);assert.deepEqual(large.estimate.tables.map(t=>t.id),['a','b']);assert.equal(small.estimate.tables[0].id,'c');assert.equal(small.estimate.ready,true);
});
test('available combinations beat waiting for an occupied single table',()=>{
 const state={tables:[table('big',8,{status:'in_use',seatedAt:now-10*60000}),table('a',4,{allowed:['b']}),table('b',4,{allowed:['a']})],parties:[party('family',8)]};
 const plan=planWaitlist(state,now);assert.equal(plan.rows[0].estimate.ready,true);assert.equal(plan.rows[0].estimate.tables.length,2);
});
test('estimates include elapsed dining and cleaning time, with an overdue buffer',()=>{
 const state={tables:[table('a',4,{status:'in_use',seatedAt:now-45*60000})],parties:[party('next',4)],waitSettings:{diningMinutes:60,cleaningMinutes:5}};
 assert.equal(planWaitlist(state,now).rows[0].estimate.minutes,20);
 state.tables[0].seatedAt=now-100*60000;assert.equal(planWaitlist(state,now).rows[0].estimate.minutes,15);
 state.tables[0].status='cleaning';state.tables[0].cleaningAt=now-2*60000;assert.equal(planWaitlist(state,now).rows[0].estimate.minutes,3);
});
test('unknown capacities, impossible fits, invalid sizes and groups are handled conservatively',()=>{
 const state={tables:[table('unknown',null),table('a',4,{group:'g'}),table('b',4,{group:'g',status:'in_use',seatedAt:now})],parties:[party('first',4)]};
 const plan=planWaitlist(state,now);assert.equal(plan.rows[0].estimate.ready,false);assert.equal(plan.rows[0].estimate.tables.length,2);assert.equal(estimateNewParty(plan,20),null);assert.equal(estimateNewParty(plan,0),null);assert.equal(estimateNewParty(plan,2.5),null);assert.equal(waitRange(null),'Host review needed');
});
test('recent visit average informs estimates unless host sets an assumption',()=>{
 const state={parties:[30,45,60,1000].map((n,i)=>({status:'completed',seatedAt:1000,closedAt:1000+n*60000}))};assert.equal(waitSettings(state).diningMinutes,45);state.waitSettings={diningMinutes:70,cleaningMinutes:0};assert.equal(waitSettings(state).diningMinutes,70);assert.equal(waitSettings(state).cleaningMinutes,0);
});
test('assumptions require write access and valid durations; cleaning timestamps retain start time',()=>{
 let state=initialState();assert.throws(()=>applyAction(state,{type:'waitSettings',diningMinutes:60,cleaningMinutes:5},'viewer'),/view-only/);
 assert.throws(()=>applyAction(state,{type:'waitSettings',diningMinutes:0,cleaningMinutes:5},'host'),/15/);
 state=applyAction(state,{type:'waitSettings',diningMinutes:50,cleaningMinutes:4},'host',now);assert.equal(state.waitSettings.diningMinutes,50);
 const action={type:'status',ids:['B-70'],status:'cleaning'};state=applyAction(state,action,'host',now);state=applyAction(state,action,'host',now+60000);assert.equal(state.tables.find(t=>t.id==='B-70').cleaningAt,now);
 state=applyAction(state,{...action,status:'open'},'host',now+120000);assert.equal(state.tables.find(t=>t.id==='B-70').cleaningAt,null);
});
