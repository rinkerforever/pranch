import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../src/model.js';
import {assignmentChoices} from '../public/table-assignment.js';
test('table-first picker preserves arrival order and identifies fit without changing state',()=>{
 const state=initialState(),table=state.tables.find(t=>t.capacity===4);
 state.parties=[{id:'large',name:'Large',size:8,status:'waiting',arrivedAt:2},{id:'fit',name:'Fits',size:2,status:'waiting',arrivedAt:1},{id:'away',name:'Away',size:2,status:'waiting',attendance:'away',arrivedAt:3},{id:'seated',name:'Seated',size:2,status:'seated',arrivedAt:0}];
 const before=JSON.stringify(state),rows=assignmentChoices(state,[table.id]);
 assert.deepEqual(rows.map(r=>[r.party.id,r.position,r.reason]),[['fit',1,'Fits'],['large',2,'Needs more tables'],['away',3,'Guest away']]);
 assert.equal(JSON.stringify(state),before);
 table.status='in_use';assert.ok(assignmentChoices(state,[table.id]).every(r=>r.reason.includes('unavailable')));
 table.status='open';state.closedAreas={[table.area]:true};assert.ok(assignmentChoices(state,[table.id]).every(r=>r.reason.includes('unavailable')));
 assert.ok(assignmentChoices(state,['missing']).every(r=>r.reason.includes('unavailable')));
});
