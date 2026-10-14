import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyAction} from '../src/model.js';
import {roomInfo,activeRoomBlocks} from '../public/rooms.js';
import {openSeats} from '../public/floor.js';
import {suggestTables} from '../public/suggestions.js';
import {planWaitlist} from '../public/wait-plan.js';
const run=(s,a,role='host')=>applyAction(s,a,role,100000,()=>crypto.randomUUID());
const book=(s,roomId='rose',size=12)=>run(s,{type:'bookRoom',roomId,name:'Birthday',size});
test('room capacities reflect saved seats and combined room totals',()=>{
 const s=initialState();assert.equal(roomInfo(s,'rose').capacity,20);assert.equal(roomInfo(s,'azalea').capacity,20);assert.equal(roomInfo(s,'piney').capacity,30);assert.equal(roomInfo(s,'combined').capacity,40);
 s.tables.find(t=>t.area==='Rose City').capacity=6;assert.equal(roomInfo(s,'combined').capacity,42);
});
test('whole room hold removes all its tables from open seats and suggestions',()=>{
 const s=initialState(),before=openSeats(s.tables).count,held=book(s),block=activeRoomBlocks(held)[0];
 assert.equal(openSeats(held.tables).count,before-20);assert.equal(roomInfo(held,'rose').available,false);assert.equal(held.parties[0].status,'reserved');
 assert.ok(suggestTables(held.tables,4,1000).every(ts=>ts.every(t=>t.roomBlock!==block.id)));
 assert.ok(planWaitlist(held).candidates.every(ts=>ts.every(t=>t.roomBlock!==block.id)));
 assert.throws(()=>book(held),/fully open/);assert.throws(()=>book(held,'combined',30),/fully open/);
 assert.throws(()=>run(held,{type:'status',ids:roomInfo(held,'rose').tables.map(t=>t.id),status:'open'}),/Room bookings/);
 assert.throws(()=>run(held,{type:'split',ids:roomInfo(held,'rose').tables.map(t=>t.id)}),/Room bookings/);
});
test('both left rooms book as one block, seat and release together',()=>{
 let s=book(initialState(),'combined',40),b=s.roomBlocks[0];assert.equal(s.tables.filter(t=>t.roomBlock===b.id).length,10);
 assert.throws(()=>book(s,'azalea'),/fully open/);assert.equal(roomInfo(s,'piney').available,true);
 s=run(s,{type:'seatRoom',id:b.id});assert.equal(s.parties[0].status,'seated');assert.equal(s.tables.filter(t=>t.roomBlock===b.id&&t.status==='in_use').length,10);
 assert.throws(()=>run(s,{type:'seatRoom',id:b.id}),/already in use/);
 s=run(s,{type:'releaseRoom',id:b.id,status:'cleaning'});assert.equal(activeRoomBlocks(s).length,0);assert.equal(s.parties[0].status,'completed');
 assert.ok(roomInfo(s,'combined').tables.every(t=>t.status==='cleaning'&&!t.roomBlock&&!t.group));
 assert.throws(()=>run(s,{type:'releaseRoom',id:b.id,status:'open'}),/already ended/);
});
test('hold can take a waiting party and cancellation returns that party without duplicates',()=>{
 let s=run(initialState(),{type:'addParty',name:'Smith',size:18,highChair:true});const p=s.parties[0];
 s=run(s,{type:'bookRoom',roomId:'rose',partyId:p.id});assert.equal(s.parties.length,1);assert.equal(s.parties[0].highChair,true);
 s=run(s,{type:'releaseRoom',id:s.roomBlocks[0].id,status:'open'});assert.equal(s.parties[0].status,'waiting');assert.equal(s.parties[0].arrivedAt,p.arrivedAt);assert.equal(roomInfo(s,'rose').available,true);
});
test('booking validates room, capacity, occupancy and permissions; held layout cannot change',()=>{
 const s=initialState();assert.throws(()=>book(s,'rose',21),/party size/);assert.throws(()=>book(s,'missing'),/fully open/);
 assert.throws(()=>run(s,{type:'bookRoom',roomId:'rose',name:'X',size:2},'viewer'),/view-only/);
 const held=book(s);const t=roomInfo(s,'rose').tables[0];assert.throws(()=>run(held,{type:'layout',id:t.id,table:t},'manager'),/Open and separate/);
 assert.throws(()=>run(held,{type:'addTable',table:{...t,number:'99'}},'manager'),/Release/);
 t.status='in_use';assert.throws(()=>book(s),/fully open/);
 t.status='open';t.capacity=null;assert.throws(()=>book(s),/Confirm every/);
});
const later=2000000;
const schedule=(s,roomId='rose',start=later,end=later+3600000)=>run(s,{type:'scheduleRoom',roomId,name:'Future event',size:18,startsAt:start,endsAt:end});
test('future room bookings enforce overlap rules across the movable divider',()=>{
 let s=schedule(initialState());assert.equal(roomInfo(s,'rose').available,true);assert.equal(s.parties.length,0);
 assert.throws(()=>schedule(s,'combined'),/overlaps/);assert.throws(()=>schedule(s,'rose',later+1000),/overlaps/);
 s=schedule(s,'azalea');assert.equal(s.roomSchedule.length,2);
 s=schedule(s,'rose',later+3600000,later+7200000);assert.equal(s.roomSchedule.length,3);
 assert.throws(()=>book(s),/overlap/);
 assert.throws(()=>run(s,{type:'scheduleRoom',roomId:'piney',name:'X',size:31,startsAt:later,endsAt:later+3600000}),/size/);
});
test('upcoming room bookings prevent walk-ins and adjust wait estimates',()=>{
 let s=schedule(initialState(),'rose',100000+30*60000,100000+90*60000);
 s=run(s,{type:'addParty',name:'Walk-in',size:4});const table=roomInfo(s,'rose').tables[0];
 assert.throws(()=>run(s,{type:'seat',partyId:s.parties[0].id,ids:[table.id]}),/upcoming/);
 assert.throws(()=>run(s,{type:'status',ids:[table.id],status:'in_use'}),/upcoming/);
 s.tables=s.tables.filter(t=>t.area==='Rose City');const plan=planWaitlist(s,100000);assert.equal(plan.rows[0].estimate.ready,false);assert.equal(plan.rows[0].estimate.minutes,90);
});
test('scheduled booking activates atomically near arrival and cannot double-activate',()=>{
 let s=schedule(initialState(),'combined',later,later+3600000),id=s.roomSchedule[0].id;
 assert.throws(()=>run(s,{type:'activateRoomBooking',id}),/30 minutes/);
 s=applyAction(s,{type:'activateRoomBooking',id},'host',later,()=>crypto.randomUUID());assert.equal(s.roomSchedule[0].status,'activated');assert.equal(activeRoomBlocks(s)[0].roomId,'combined');assert.equal(s.tables.filter(t=>t.status==='reserved').length,10);
 assert.throws(()=>applyAction(s,{type:'activateRoomBooking',id},'host',later),/not found/);
});
test('failed activation preserves future booking; cancellation frees its time',()=>{
 let s=schedule(initialState()),id=s.roomSchedule[0].id;s.tables.find(t=>t.area==='Rose City').status='in_use';
 assert.throws(()=>applyAction(s,{type:'activateRoomBooking',id},'host',later),/fully open/);assert.equal(s.roomSchedule[0].status,'scheduled');
 s=run(s,{type:'cancelRoomBooking',id});s=schedule(s);assert.equal(s.roomSchedule.length,1);
 assert.throws(()=>run(s,{type:'cancelRoomBooking',id:s.roomSchedule[0].id},'viewer'),/view-only/);
});
