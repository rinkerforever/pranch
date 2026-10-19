import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyAction} from '../src/model.js';
import {areaOptions} from '../public/areas.js';
import {suggestTables} from '../public/suggestions.js';
import {planWaitlist,seatingOptions,estimateNewParty} from '../public/wait-plan.js';
test('area priorities are manager-only, validated and do not mutate another state',()=>{
 const original=initialState(),priorities=Object.fromEntries(areaOptions(original).map(a=>[a.id,5]));priorities.B=1;
 const action={type:'areaPriorities',priorities};
 assert.throws(()=>applyAction(original,action,'host'),/Manager/);
 assert.throws(()=>applyAction(original,{...action,priorities:{...priorities,B:0}},'admin'),/1 to 10/);
 const saved=applyAction(original,action,'manager');assert.equal(saved.areaPriorities.B,1);assert.equal(original.areaPriorities,undefined);
});
test('priorities guide suggestions, queue forecasts and Seat now while retaining overflow and availability',()=>{
 const base=initialState().tables.find(t=>t.capacity===4&&t.kind==='table');
 const tables=['A','B','Room'].map(area=>({...base,id:area,area,number:area,allowed:[],group:null,party:null,status:'open'}));
 const state={...initialState(),tables,areaConfig:[{id:'A',name:'A',kind:'section'},{id:'B',name:'B',kind:'section'},{id:'Room',name:'Room',kind:'room'}],areaPriorities:{A:8,B:2,Room:1},parties:[]};
 assert.equal(suggestTables(tables,4,5,new Set(),new Set(['Room']),state.areaPriorities)[0][0].id,'B');
 let plan=planWaitlist(state);assert.equal(estimateNewParty(plan,4).tables[0].id,'B');assert.equal(seatingOptions(plan,4).open[0].tables[0].id,'B');
 state.parties=[{id:'guest',size:4,status:'waiting',arrivedAt:Date.now()}];assert.equal(planWaitlist(state).rows[0].estimate.tables[0].id,'B');
 tables[1].status='in_use';tables[1].seatedAt=Date.now();assert.equal(planWaitlist(state).rows[0].estimate.tables[0].id,'A');
});
