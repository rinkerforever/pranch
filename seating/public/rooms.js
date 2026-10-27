import {roomOptions} from './areas.js';
import {serviceTables,areaClosed} from './service-ops.js';
export const activeRoomBlocks=state=>(state.roomBlocks||[]).filter(b=>['held','in_use'].includes(b.status));
export function roomInfo(state,id){
 const room=roomOptions(state).find(r=>r.id===id);if(!room)return null;
 const tables=state.tables.filter(t=>room.areas.includes(t.area));
 const blocks=activeRoomBlocks(state).filter(b=>b.areas.some(a=>room.areas.includes(a)));
 const canFinishCleaning=!blocks.length&&tables.some(t=>t.status==='cleaning')&&tables.every(t=>['open','cleaning'].includes(t.status)&&!t.roomBlock);
 return {...room,tables,capacity:tables.reduce((n,t)=>n+(t.capacity||0),0),unconfirmed:tables.some(t=>!t.capacity),blocks,canFinishCleaning,available:tables.length>0&&tables.every(t=>t.status==='open'&&!t.roomBlock&&!areaClosed(state,t.area))};
}

export const scheduledRooms=state=>(state.roomSchedule||[]).filter(b=>b.status==='scheduled');
export const overlaps=(a,b,c,d)=>a<d&&c<b;
export function roomSeatingCheck(state,id,size,now=Date.now(),end=now+90*60000){
 const room=roomInfo(state,id),warnings=[];
 let reason=!room?.available||room?.blocks.length?'Room must be fully open.':room.unconfirmed?'Confirm every table capacity first.':!Number.isInteger(size)||size<1||size>room.capacity?'Choose a room with enough seats.':!Number.isFinite(end)||end<now+60000||end>now+12*3600000?'Choose a room time from 1 to 720 minutes.':'';
 if(room)for(const booking of scheduledRooms(state).filter(b=>b.areas.some(a=>room.areas.includes(a))&&b.endsAt>now)){
  if(booking.startsAt<=now)reason='A scheduled booking is already due in this room.';
  else if(booking.startsAt<=now+90*60000)warnings.push(booking);
  else if(booking.startsAt<end)reason='This room time overlaps a later booking. Choose a shorter room time.';
 }
 return {room,reason,warnings:warnings.sort((a,b)=>a.startsAt-b.startsAt),available:!reason};
}
export function partyRoomSuggestions(state,size,now=Date.now()){
 if(size<=12)return [];
 return roomOptions(state).map(r=>roomSeatingCheck(state,r.id,size,now)).filter(r=>r.available)
  .sort((a,b)=>a.warnings.length-b.warnings.length||a.room.capacity-b.room.capacity);
}
export function roomConflict(state,areas,start,end){return [...scheduledRooms(state),...activeRoomBlocks(state)].find(b=>b.areas.some(a=>areas.includes(a))&&overlaps(start,end,b.startsAt??b.createdAt,b.endsAt??Infinity));}
export function protectsBooking(state,tables,start,end){return scheduledRooms(state).some(b=>b.areas.some(a=>tables.some(t=>t.area===a))&&overlaps(start,end,b.startsAt,b.endsAt));}
export function walkInTables(state,now=Date.now(),duration=(state.waitSettings?.diningMinutes||60)+(state.waitSettings?.cleaningMinutes??5)){
 return serviceTables(state).filter(t=>!t.roomBlock&&!protectsBooking(state,[t],now,now+duration*60000));
}
