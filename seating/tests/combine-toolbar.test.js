import test from 'node:test';
import assert from 'node:assert/strict';
import {combineToolbar,needsCombinationOverride} from '../public/combine-toolbar.js';
import {initialState,applyAction} from '../src/model.js';
test('single toolbar supports selecting, applying and un-combining a full group',()=>{
 let s=initialState();const ids=['B-70','B-60'];
 assert.equal(combineToolbar(s,[],false).action,'start');
 assert.equal(combineToolbar(s,[],true).disabled,true);assert.equal(combineToolbar(s,[ids[0]],true).disabled,true);
 const apply=combineToolbar(s,ids,true);assert.equal(apply.label,'Apply (2)');assert.equal(apply.disabled,false);
 const override=needsCombinationOverride(s.tables.filter(t=>ids.includes(t.id)),s.tables);
 s=applyAction(s,{type:'combine',ids,combinationOverride:override},'host');
 assert.deepEqual(combineToolbar(s,ids,false),{action:'split',label:'Un-combine',disabled:false});
 assert.equal(combineToolbar(s,[ids[0]],false).action,'start');
 s=applyAction(s,{type:'split',ids},'host');assert.equal(combineToolbar(s,ids,false).action,'start');
});
test('occupied and room-block groups cannot be un-combined by the toolbar',()=>{
 const s={tables:[{id:'a',group:'g',status:'in_use'},{id:'b',group:'g',status:'in_use'}]};
 assert.equal(combineToolbar(s,['a','b'],false).disabled,true);assert.equal(combineToolbar(s,['a','b'],true).disabled,true);
 for(const t of s.tables){t.status='open';t.roomBlock='booking';}assert.equal(combineToolbar(s,['a','b'],false).disabled,true);
});
test('only connected approved nearby combinations skip the override confirmation',()=>{
 const a={id:'a',x:100,y:100,area:'A',allowed:['b'],status:'open'},b={id:'b',x:150,y:100,area:'A',allowed:['a'],status:'open'};
 assert.equal(needsCombinationOverride([a,b],[a,b]),false);
 assert.equal(needsCombinationOverride([a,{...b,allowed:[]}],[a,b]),true);
 assert.equal(needsCombinationOverride([a,{...b,area:'B'}],[a,b]),true);
});
