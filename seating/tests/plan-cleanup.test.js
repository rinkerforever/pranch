import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyAction} from '../src/model.js';
import {suggestedCovers} from '../public/plan-cleanup.js';
const cover={x:100,y:150,width:60,height:70};
test('cleanup preserves the original image, tables, seats and guests and can be restored',()=>{
 const s=initialState();s.background={key:'original.png',mime:'image/png',imported:true};
 const next=applyAction(s,{type:'cleanPlan',covers:[cover]},'manager');
 assert.deepEqual(next.tables,s.tables);assert.deepEqual(next.parties,s.parties);
 assert.equal(next.background.key,'original.png');assert.equal(s.background.covers,undefined);
 assert.deepEqual(next.background.covers,[cover]);
 const restored=applyAction(next,{type:'cleanPlan',covers:[]},'manager');assert.deepEqual(restored.background.covers,[]);assert.equal(restored.background.key,s.background.key);
});
test('cleanup is manager only and rejects invalid masks without modifying the plan',()=>{
 const s=initialState();assert.throws(()=>applyAction(s,{type:'cleanPlan',covers:[]},'manager'),/Upload/);s.background={key:'original.png'};
 for(const role of ['host','viewer'])assert.throws(()=>applyAction(s,{type:'cleanPlan',covers:[cover]},role),/access/);
 for(const covers of [null,Array(301).fill(cover),[null],[{...cover,x:-1}],[{...cover,width:Infinity}],[{...cover,height:0}],[{...cover,x:1650}],[{...cover,y:940}],[{...cover,x:'100'}]])assert.throws(()=>applyAction(s,{type:'cleanPlan',covers},'manager'));
 assert.equal(s.background.covers,undefined);
});
test('suggested covers stay in bounds and remain fixed when selectable tables move',()=>{
 const s=initialState();s.background={key:'original.png'};const covers=suggestedCovers(s.tables);
 assert.equal(covers.length,s.tables.length);for(const r of covers)assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=1660&&r.y+r.height<=950);
 const next=applyAction(s,{type:'cleanPlan',covers},'manager');const table=next.tables.find(t=>t.kind==='table');
 const moved=applyAction(next,{type:'layout',id:table.id,table:{...table,x:table.x+10,allowed:[]}},'manager');assert.deepEqual(moved.background.covers,covers);
});
