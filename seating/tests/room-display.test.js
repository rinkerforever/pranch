import test from 'node:test';
import assert from 'node:assert/strict';
import {roomDisplayState} from '../public/room-display-state.js';
import {applyAction,initialState} from '../src/model.js';
import {partyDisplayUrl} from '../public/party-display-addon.js';

test('add-on is off by default, manager-only, and revokes old links',()=>{
 const initial=initialState();assert.equal(partyDisplayUrl(initial,'loc','rose'),null);
 for(const role of ['host','viewer'])assert.throws(()=>applyAction(initial,{type:'partyDisplaySettings',enabled:true},role),/access/);
 assert.throws(()=>applyAction(initial,{type:'partyDisplaySettings',enabled:'yes'},'manager'),/enabled/);
 const enabled=applyAction(initial,{type:'partyDisplaySettings',enabled:true},'manager');
 assert.match(enabled.partyDisplay.key,/^[a-f0-9]{64}$/);
 assert.match(partyDisplayUrl(enabled,'loc','room:a'),/^https:\/\/partydisplay\.projectaimnet\.com\/\?location=loc&room=room%3Aa#key=/);
 assert.equal(applyAction(enabled,{type:'partyDisplaySettings',enabled:true},'manager').partyDisplay.key,enabled.partyDisplay.key);
 const disabled=applyAction(enabled,{type:'partyDisplaySettings',enabled:false},'manager');assert.equal(disabled.partyDisplay.key,undefined);
 assert.notEqual(applyAction(disabled,{type:'partyDisplaySettings',enabled:true},'admin').partyDisplay.key,enabled.partyDisplay.key);
});
const base=()=>({areaConfig:[{id:'a',name:'Party room',kind:'room'},{id:'b',name:'Other room',kind:'room'}],roomSchedule:[],roomBlocks:[]});
const booking=(start=100,end=200)=>({id:'booking',areas:['a'],name:'Birthday',status:'scheduled',startsAt:start,endsAt:end});
test('open and closed follow configured room settings',()=>{const s=base();assert.equal(roomDisplayState(s,'room:a',50).status,'open');s.closedAreas={a:true};assert.equal(roomDisplayState(s,'room:a',50).status,'closed');assert.equal(roomDisplayState(s,'missing',50).status,'unavailable');});
test('reservation starts and ends at exact boundaries, then advances',()=>{const s=base();s.roomSchedule=[booking(),{...booking(200,300),id:'next',name:'Next'}];assert.equal(roomDisplayState(s,'room:a',99).status,'reserved');assert.equal(roomDisplayState(s,'room:a',100).remaining,100);assert.equal(roomDisplayState(s,'room:a',200).booking.name,'Next');assert.equal(roomDisplayState(s,'room:a',300).status,'open');s.closedAreas={a:true};assert.equal(roomDisplayState(s,'room:a',300).status,'closed');});
test('future reservations take priority over closure, cancelled reservations are ignored',()=>{const s=base();s.closedAreas={a:true};s.roomSchedule=[booking()];assert.equal(roomDisplayState(s,'room:a',50).status,'reserved');s.roomSchedule[0].status='cancelled';assert.equal(roomDisplayState(s,'room:a',50).status,'closed');});
test('early activation preserves scheduled start, including after schedule pruning',()=>{const s=base();s.roomSchedule=[{...booking(),status:'activated'}];s.roomBlocks=[{...booking(75,200),status:'held',scheduleId:'booking'}];assert.equal(roomDisplayState(s,'room:a',80).status,'reserved');s.roomBlocks[0].scheduledStartsAt=100;s.roomSchedule=[];assert.equal(roomDisplayState(s,'room:a',80).status,'reserved');assert.equal(roomDisplayState(s,'room:a',150).remaining,50);s.roomBlocks[0].status='released';assert.equal(roomDisplayState(s,'room:a',150).status,'open');});
test('combined bookings appear on each room and expired blocks do not linger',()=>{const s=base();s.roomBlocks=[{...booking(),areas:['a','b'],status:'in_use'}];assert.equal(roomDisplayState(s,'room:b',150).status,'active');assert.equal(roomDisplayState(s,'room:b',200).status,'open');});
