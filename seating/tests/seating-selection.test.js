import test from 'node:test';
import assert from 'node:assert/strict';
import {selectTablesForParty} from '../public/seating-selection.js';

const tables=[
 {id:'two-a',capacity:2},{id:'two-b',capacity:2},
 {id:'six-a',capacity:6},{id:'six-b',capacity:6},{id:'six-c',capacity:6},
 {id:'group-a',capacity:2,group:'joined'},{id:'group-b',capacity:2,group:'joined'},
];
const tap=(selected,id,size)=>selectTablesForParty(tables,selected,id,size);

test('a party of four can build a pair, then replace it with a larger table',()=>{
 let selected=tap(new Set(),'two-a',4);
 selected=tap(selected,'two-b',4);
 assert.deepEqual([...selected],['two-a','two-b']);
 selected=tap(selected,'six-a',4);
 assert.deepEqual([...selected],['six-a']);
 selected=tap(selected,'six-b',4);
 assert.deepEqual([...selected],['six-b']);
 selected=tap(selected,'six-b',4);
 assert.deepEqual([...selected],[]);
});

test('a party of twelve builds to twelve, then starts a fresh combination',()=>{
 let selected=tap(new Set(),'six-a',12);
 selected=tap(selected,'six-b',12);
 assert.deepEqual([...selected],['six-a','six-b']);
 selected=tap(selected,'six-c',12);
 assert.deepEqual([...selected],['six-c']);
 selected=tap(selected,'six-b',12);
 assert.deepEqual([...selected],['six-c','six-b']);
});

test('an existing combined group stays together when selected or removed',()=>{
 let selected=tap(new Set(),'group-a',4);
 assert.deepEqual([...selected],['group-a','group-b']);
 selected=tap(selected,'group-b',4);
 assert.deepEqual([...selected],[]);
});
