import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAction,initialState} from '../src/model.js';
import {planWaitlist} from '../public/wait-plan.js';
import {guestForecast} from '../public/wait-forecast.js';
const start=1800000000000;
test('a shared original forecast survives edits, elapsed time and a later revised forecast',()=>{
 let state=initialState();for(const t of state.tables){t.status='in_use';t.seatedAt=start-50*60000;}
 state=applyAction(state,{type:'addParty',name:'Johnson',size:4},'host',start,()=> 'johnson');
 const quote=structuredClone(state.parties[0].waitQuote);assert.ok(quote.latestAt>start);assert.equal(quote.partySize,4);
 const later=quote.latestAt+3*60000;
 state=applyAction(state,{type:'editParty',id:'johnson',name:'Johnson family',size:5,notes:'Host reviewed delay'},'host',later);
 assert.deepEqual(state.parties[0].waitQuote,quote);assert.equal(state.parties[0].arrivedAt,start);
 const estimate=planWaitlist(state,later).rows[0].estimate,forecast=guestForecast(state.parties[0],estimate,later);
 assert.equal(forecast.pastEstimate,true);assert.equal(forecast.pastMinutes,3);assert.ok(forecast.current.latestAt>quote.latestAt);
 assert.equal(guestForecast(state.parties[0],{minutes:0,ready:true},later).pastEstimate,true);
 const restored=JSON.parse(JSON.stringify(state));assert.deepEqual(restored.parties[0].waitQuote,quote);
});
test('legacy and impossible-fit parties have no fabricated original deadline',()=>{
 assert.equal(guestForecast({status:'waiting',arrivedAt:start},null,start+60000).original,null);
 const state=applyAction(initialState(),{type:'addParty',name:'Very large party',size:100},'host',start,()=> 'large');
 assert.equal(state.parties[0].waitQuote.latestAt,undefined);assert.equal(guestForecast(state.parties[0],null,start+86400000).pastEstimate,false);
});
test('ready-at-arrival quotes allow a short seating window and cannot be supplied by a client',()=>{
 const state=applyAction(initialState(),{type:'addParty',name:'Miller',size:4,waitQuote:{latestAt:9999999999999}},'host',start,()=> 'miller');
 assert.equal(state.parties[0].waitQuote.latestAt,start+5*60000);
 assert.equal(guestForecast(state.parties[0],null,start+4*60000).pastEstimate,false);
});
