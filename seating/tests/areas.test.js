import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyAction} from '../src/model.js';
import {areaOptions,areaName,roomOptions} from '../public/areas.js';
import {roomInfo} from '../public/rooms.js';
import {detectPlanTables} from '../public/plan-detection.js';
const run=(s,a,role='manager')=>applyAction(s,a,role,100000);
test('area edits preserve stable table and booking references, and leave other stores alone',()=>{
 const other=initialState();let s=run(other,{type:'bookRoom',roomId:'rose',name:'Birthday',size:10});
 s=run(s,{type:'saveArea',id:'Rose City',name:'Brazos Room',kind:'room'});
 assert.equal(areaName(s,'Rose City'),'Brazos Room');assert.equal(roomInfo(s,'rose').capacity,20);
 assert.equal(roomInfo(s,'rose').blocks.length,1);assert.equal(roomInfo(s,'combined').name,'Brazos Room + Azalea Trail');
 assert.equal(areaName(other,'Rose City'),'Rose City');assert.equal(other.areaConfig,undefined);
 assert.throws(()=>run(s,{type:'saveArea',id:'Rose City',name:'Brazos',kind:'section'}),/bookings/);
});
test('area configuration enforces manager access, unique names and safe removal',()=>{
 let s=initialState();const add={type:'saveArea',name:'Patio',kind:'section'};
 assert.throws(()=>run(s,add,'host'),/Manager/);assert.throws(()=>run(s,add,'viewer'),/view-only/);
 s=run(s,add);const id=s.areaConfig.at(-1).id;
 assert.throws(()=>run(s,{...add,name:' patio '}),/already exists/);
 assert.throws(()=>run(s,{type:'deleteArea',id:'A'}),/tables/);
 s=run(s,{type:'deleteArea',id});assert.ok(!areaOptions(s).some(a=>a.id===id));
 assert.throws(()=>run(s,{type:'saveArea',id,name:'Gone',kind:'room'}),/no longer exists/);
});
test('custom room and combined bookings use assigned capacity and protect overlaps',()=>{
 let s=run(initialState(),{type:'saveArea',name:'Birthday Room',kind:'room'});const id=s.areaConfig.at(-1).id;
 s=run(s,{type:'addTable',table:{number:'1',area:id,capacity:8,kind:'table',orientation:'lr',x:500,y:300}});
 s=run(s,{type:'addRoomCombination',areas:[id,'Rose City']});const combo=s.roomCombinations.at(-1);
 assert.equal(roomInfo(s,combo.id).capacity,28);assert.equal(roomInfo(s,`room:${id}`).capacity,8);
 assert.throws(()=>run(s,{type:'addRoomCombination',areas:['Rose City',id]}),/already exists/);
 s=run(s,{type:'scheduleRoom',roomId:combo.id,name:'Event',size:28,startsAt:200000,endsAt:3800000});
 assert.throws(()=>run(s,{type:'scheduleRoom',roomId:`room:${id}`,name:'Conflict',size:4,startsAt:200000,endsAt:3800000}),/overlaps/);
 assert.throws(()=>run(s,{type:'deleteRoomCombination',id:combo.id}),/bookings/);
 assert.throws(()=>run(s,{type:'deleteArea',id}),/tables/);
});
test('rooms larger than 12 tables can finish cleaning, without clearing occupied rooms',()=>{
 let s=run(initialState(),{type:'saveArea',id:'C',name:'Large Room',kind:'room'});const roomId='room:C';
 assert.ok(roomInfo(s,roomId).tables.length>12);
 for(const t of roomInfo(s,roomId).tables)t.capacity??=4;
 s=run(s,{type:'bookRoom',roomId,name:'Large group',size:20});const id=s.roomBlocks[0].id;
 assert.throws(()=>run(s,{type:'finishRoomCleaning',roomId}),/not ready/);
 s=run(s,{type:'seatRoom',id});s=run(s,{type:'releaseRoom',id,status:'cleaning'});
 assert.throws(()=>run(s,{type:'finishRoomCleaning',roomId},'viewer'),/view-only/);
 s=run(s,{type:'finishRoomCleaning',roomId},'host');assert.equal(roomInfo(s,roomId).available,true);
 assert.ok(roomInfo(s,roomId).tables.every(t=>!t.party&&!t.cleaningAt));
});
test('PDF detection recognizes custom names and uses only configured area IDs',()=>{
 const areas=[{id:'patio',name:'Patio',kind:'section'},{id:'room-1',name:'Brazos Room',kind:'room'}];
 const label=(text,x,y)=>({text,x,y,w:20,h:10});
 const found=detectPlanTables([label('Brazos Room',100,100),label('11',100,130)],[],500,500,undefined,areas);
 assert.equal(found[0].area,'room-1');
 assert.equal(detectPlanTables([label('A12',100,100)],[],500,500,undefined,areas)[0].area,'patio');
 let s=run(initialState(),{type:'saveArea',name:'Patio',kind:'section'});const id=s.areaConfig.at(-1).id;
 s=run(s,{type:'replaceFloor',background:{imported:true},tables:[{...found[0],area:id}]});
 assert.equal(s.tables[0].area,id);assert.equal(areaName(s,id),'Patio');
 const imported={tables:[{area:'A'}],background:{imported:true}};
 assert.deepEqual(areaOptions(imported).map(a=>a.id),['A']);assert.equal(roomOptions(imported).length,0);
});
