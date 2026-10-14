import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyAction} from '../src/model.js';
import {detectPlanTables,pdfLabels,pdfDrawingBounds,pagePlacement,planFrame} from '../public/plan-detection.js';
const sample={number:'A51',area:'A',x:1108,y:351,capacity:null,kind:'table',orientation:'tb'};
const background={key:'seating/waco/new-plan',mime:'image/png',name:'Waco.pdf',imported:true};
const replace=(s,tables=[sample],role='manager')=>applyAction(s,{type:'replaceFloor',tables,background},role,1000);

test('PDF labels preserve Waco section prefixes, repeated labels and original positions',()=>{
 const labels=[{text:'A51',x:528.85,y:195.01},{text:'B11',x:440.48,y:191.15},{text:'C11',x:119.89,y:247.70},{text:'212',x:125.03,y:149.28},{text:'212',x:125.05,y:178.90},{text:'Total Seats: 286',x:160,y:468},{text:'120 ft',x:40,y:300}].map(l=>({...l,w:18.62,h:11.04}));
 const tables=detectPlanTables(labels,[],720,540);assert.equal(tables.length,5);
 assert.deepEqual(tables.slice(0,3).map(t=>t.area),['A','B','C']);assert.equal(tables.filter(t=>t.number==='212').length,2);
 assert.ok(tables.every(t=>t.capacity===null));const p=pagePlacement(720,540);assert.equal(tables[0].x,p.x+528.85*p.scale);
 assert.equal(detectPlanTables([],[],720,540).length,0);
});
test('vector chairs suggest a capacity but absent chair evidence stays unconfirmed',()=>{
 const labels=[{text:'11',x:100,y:100,w:8,h:8}],body={x:90,y:90,w:20,h:20};
 const chairs=[{x:83,y:91,w:5,h:5},{x:83,y:103,w:5,h:5},{x:112,y:91,w:5,h:5},{x:112,y:103,w:5,h:5}];
 assert.equal(detectPlanTables(labels,[body,...chairs],720,540)[0].capacity,4);
 assert.equal(detectPlanTables(labels,[body],720,540)[0].capacity,null);
});
test('drawing crop keeps table coordinates aligned and preserves the page when no enclosing drawing exists',()=>{
 const labels=[{text:'A51',x:528,y:195,w:18,h:11},{text:'B11',x:440,y:191,w:18,h:11}];
 const frame=planFrame(labels,[{x:0,y:0,w:720,h:540},{x:18,y:113,w:688,h:277}],720,540);
 assert.deepEqual(frame,{x:10,y:105,w:704,h:293});const p=pagePlacement(frame.w,frame.h);
 const t=detectPlanTables(labels,[],720,540,frame)[0];assert.equal(t.x,p.x+(528-frame.x)*p.scale);assert.equal(t.y,p.y+(195-frame.y)*p.scale);
 assert.deepEqual(planFrame(labels,[],720,540),{x:0,y:0,w:720,h:540});
});
test('PDF coordinate conversion honors viewport rotation, graphics transforms and restore',()=>{
 const viewport={transform:[0,1,1,0,0,0],scale:1};
 assert.deepEqual(pdfLabels([{str:'21',width:10,height:10,transform:[10,0,0,10,20,30]}],viewport)[0],{text:'21',x:33.5,y:25,w:10,h:10});
 const OPS={save:1,restore:2,transform:3,constructPath:4};
 const boxes=pdfDrawingBounds({fnArray:[1,3,4,2,4],argsArray:[[],[1,0,0,1,10,20],[null,null,[0,0,10,10]],[],[null,null,[0,0,10,10]]]},OPS,viewport);
 assert.deepEqual(boxes,[{x:20,y:10,w:10,h:10},{x:0,y:0,w:10,h:10}]);
});
test('import replaces old tables and links, keeps waiting guests and preserves numbers on later reads',()=>{
 const old=initialState();old.parties=[{id:'waiting',name:'Guest',size:2,status:'waiting'}];const next=replace(old);
 assert.equal(next.tables.length,1);assert.equal(next.tables[0].number,'A51');assert.equal(next.tables[0].status,'open');assert.deepEqual(next.tables[0].allowed,[]);
 assert.ok(!old.tables.some(t=>t.id===next.tables[0].id));assert.deepEqual(next.parties,old.parties);assert.equal(old.tables.length,68);
 assert.equal(next.background,background);assert.equal(next.numberingVersion,1);assert.equal(next.combinationVersion,1);
 assert.throws(()=>applyAction(next,{type:'seat',partyId:'waiting',ids:[next.tables[0].id]},'host'),/capacity/);
});
test('import rejects active service, future bookings, duplicates, malformed tables and insufficient roles atomically',()=>{
 const s=initialState();assert.throws(()=>replace(s,[sample],'host'),/Manager/);assert.throws(()=>replace(s,[sample],'viewer'),/view-only/);
 assert.throws(()=>replace(s,[sample,sample]),/Duplicate/);assert.throws(()=>replace(s,[]),/1 and 200/);assert.throws(()=>replace(s,[{...sample,x:Infinity}]),/inside/);assert.throws(()=>replace(s,[{...sample,capacity:99}]),/Seats/);
 assert.throws(()=>replace(s,[null]),/Every imported/);
 s.tables[0].status='in_use';assert.throws(()=>replace(s),/Clear/);s.tables[0].status='open';
 s.roomSchedule=[{status:'scheduled',endsAt:5000}];assert.throws(()=>replace(s),/future/);assert.equal(s.tables.length,68);assert.equal(s.background,null);
});
