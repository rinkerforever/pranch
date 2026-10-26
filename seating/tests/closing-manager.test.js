import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyAction} from '../src/model.js';
import {floorAngle,rotateFloorBox} from '../public/floor-rotation.js';
const run=(s,a,role='manager')=>applyAction(s,a,role,100000);
test('view orientations persist independently without moving tables',()=>{
 const s=initialState(),next=run(s,{type:'viewOrientation',view:'Rose City',angle:0},'host');
 assert.equal(floorAngle(next,'Rose City'),0);assert.equal(floorAngle(next,'All'),180);
 assert.equal(floorAngle(JSON.parse(JSON.stringify(next)),'Rose City'),0);
 assert.deepEqual(next.tables,s.tables);assert.deepEqual(rotateFloorBox([1,2,3,4],0),[1,2,3,4]);
 assert.throws(()=>run(s,{type:'viewOrientation',view:'missing',angle:0}));
 assert.throws(()=>run(s,{type:'viewOrientation',view:'All',angle:90}));
 assert.throws(()=>run(s,{type:'viewOrientation',view:'All',angle:0},'viewer'));
});
test('closing requires manager role and PIN without changing input on rejection',()=>{
 const s=initialState(),before=structuredClone(s);
 assert.throws(()=>run(s,{type:'clearAfterClose',pin:'1111'},'host'),/Manager/);
 assert.throws(()=>run(s,{type:'clearAfterClose',pin:'1234'}),/PIN/);
 assert.deepEqual(s,before);
});
test('closing clears occupied and cleaning tables, preserves bookings and waitlist, supports undo',()=>{
 let s=run(initialState(),{type:'bookRoom',roomId:'rose',name:'Birthday',size:12});
 s=run(s,{type:'seatRoom',id:s.roomBlocks[0].id});
 s=run(s,{type:'bookRoom',roomId:'piney',name:'Held',size:12});
 s=run(s,{type:'addParty',name:'Waiting',size:3});
 const t=s.tables.find(t=>t.area==='A');Object.assign(t,{status:'cleaning',cleaningAt:80000});
 s.roomSchedule=[{id:'future',status:'scheduled',startsAt:200000,endsAt:300000}];s.closedAreas={A:{at:90000}};
 const before=structuredClone(s),next=run(s,{type:'clearAfterClose',pin:'1111'});
 assert.ok(next.tables.every(t=>!['cleaning','in_use'].includes(t.status)));
 assert.equal(next.parties.find(p=>p.name==='Birthday').status,'completed');
 assert.equal(next.parties.find(p=>p.name==='Waiting').status,'waiting');
 assert.equal(next.roomBlocks.find(b=>b.name==='Held').status,'held');
 assert.deepEqual(next.roomSchedule,s.roomSchedule);assert.deepEqual(next.closedAreas,s.closedAreas);
 assert.ok(!JSON.stringify(next).includes('1111'));
 const restored=run(next,{type:'undo',undoId:next.lastUndo.id});
 for(const key of ['tables','parties','roomBlocks'])assert.deepEqual([...restored[key]].sort((a,b)=>a.id.localeCompare(b.id)),[...before[key]].sort((a,b)=>a.id.localeCompare(b.id)));
});
