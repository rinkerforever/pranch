import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestTables} from '../public/suggestions.js';
const table=(id,capacity,extra={})=>({id,area:'A',capacity,status:'open',allowed:[],group:null,...extra});
test('suggestions prefer exact fits and exclude unavailable or unknown seats',()=>{
 const ts=[table('large',8),table('exact',4),table('busy',4,{status:'in_use'}),table('clean',4,{status:'cleaning'}),table('unknown',null)];
 assert.deepEqual(suggestTables(ts,4).map(g=>g.map(t=>t.id)),[['exact'],['large']]);assert.deepEqual(suggestTables(ts,10),[]);
});
test('only mutual approved links form suggestions; existing groups stay whole',()=>{
 const ts=[table('a',2,{allowed:['b']}),table('b',2,{allowed:['a']}),table('c',2,{allowed:['d']}),table('d',2)];
 assert.deepEqual(suggestTables(ts,4).map(g=>g.map(t=>t.id)),[['a','b']]);
 ts[0].group='g';ts[1].group='g';assert.deepEqual(suggestTables(ts,2).at(-1).map(t=>t.id),['a','b']);
 ts[1].status='in_use';assert.ok(suggestTables(ts,2).every(g=>g.every(t=>!['a','b'].includes(t.id))));
});
test('suggestions prefer a single table over a combination with equal capacity',()=>{
 const ts=[table('a',2,{allowed:['b']}),table('b',2,{allowed:['a']}),table('single',4)];
 assert.equal(suggestTables(ts,4,1)[0][0].id,'single');
});
