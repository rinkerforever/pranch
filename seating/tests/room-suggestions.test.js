import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyAction} from '../src/model.js';
import {partyRoomSuggestions,roomSeatingCheck,roomInfo} from '../public/rooms.js';
const now=1000000,run=(s,a)=>applyAction(s,a,'host',now);
const fixture=()=>{const s=initialState();s.parties=[{id:'guest',name:'Large group',size:13,status:'waiting'}];return s;};
const booking=(minutes,areas=['Rose City'])=>({id:'booking',name:'Birthday',areas,status:'scheduled',startsAt:now+minutes*60000,endsAt:now+(minutes+120)*60000});
test('rooms are suggested only above twelve, with capacity and room availability enforced',()=>{
 const s=fixture();assert.equal(partyRoomSuggestions(s,12,now).length,0);assert.ok(partyRoomSuggestions(s,13,now).some(o=>o.room.id==='rose'));
 s.closedAreas={'Rose City':true};assert.ok(!partyRoomSuggestions(s,13,now).some(o=>o.room.areas.includes('Rose City')));
 assert.equal(partyRoomSuggestions(s,101,now).length,0);
});
test('ninety-minute boundary warns, later bookings do not warn, due bookings block',()=>{
 const s=fixture();s.roomSchedule=[booking(90)];assert.equal(roomSeatingCheck(s,'rose',13,now).warnings.length,1);
 s.roomSchedule=[booking(91)];assert.equal(roomSeatingCheck(s,'rose',13,now).warnings.length,0);
 assert.equal(roomSeatingCheck(s,'rose',13,now,now+120*60000).available,false);
 s.roomSchedule=[booking(0)];assert.equal(roomSeatingCheck(s,'rose',13,now).available,false);
 s.roomSchedule=[{...booking(20),status:'cancelled'}];assert.equal(roomSeatingCheck(s,'rose',13,now).warnings.length,0);
});
test('near booking requires explicit acknowledgement; whole-room seating preserves reservation',()=>{
 const s=fixture();s.roomSchedule=[booking(45)];const action={type:'seatWholeRoom',partyId:'guest',roomId:'rose'};
 assert.throws(()=>run(s,action),/confirm seating anyway/);
 const seated=run(s,{...action,acknowledgedBookings:['booking']});assert.equal(seated.parties[0].status,'seated');
 assert.ok(roomInfo(seated,'rose').tables.every(t=>t.status==='in_use'&&t.party==='guest'));
 assert.deepEqual(seated.roomSchedule,s.roomSchedule);assert.deepEqual(seated.roomBlocks[0].bookingConflictAcknowledged.bookingIds,['booking']);
 assert.equal(s.parties[0].status,'waiting');
 s.roomSchedule.push({...booking(60),id:'new'});assert.throws(()=>run(s,{...action,acknowledgedBookings:['booking']}),/confirm seating anyway/);
});
test('override cannot bypass active bookings, closed rooms, cross-room conflicts, or normal room holds',()=>{
 const s=fixture();s.roomSchedule=[booking(20)];
 assert.equal(roomSeatingCheck(s,'combined',13,now).warnings.length,1);
 assert.throws(()=>run(s,{type:'bookRoom',roomId:'rose',partyId:'guest',acknowledgedBookings:['booking']}),/overlap/);
 s.roomSchedule=[booking(0)];assert.throws(()=>run(s,{type:'seatWholeRoom',roomId:'rose',partyId:'guest',acknowledgedBookings:['booking']}),/already due/);
 s.roomSchedule=[];s.closedAreas={'Rose City':true};assert.throws(()=>run(s,{type:'seatWholeRoom',roomId:'rose',partyId:'guest'}),/fully open/);
});
test('Seat now creates and seats one whole-room party atomically',()=>{
 const s=initialState();const result=run(s,{type:'seatWholeRoom',roomId:'rose',name:'Walk-in group',size:16,highChair:true});
 assert.equal(result.parties.length,1);assert.equal(result.parties[0].status,'seated');assert.equal(result.parties[0].highChair,true);
 assert.ok(roomInfo(result,'rose').tables.every(t=>t.party===result.parties[0].id));
});
