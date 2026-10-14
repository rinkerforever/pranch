import {roomOptions} from './areas.js';
export const activeRoomBlocks=state=>(state.roomBlocks||[]).filter(b=>['held','in_use'].includes(b.status));
export function roomInfo(state,id){
 const room=roomOptions(state).find(r=>r.id===id);if(!room)return null;
 const tables=state.tables.filter(t=>room.areas.includes(t.area));
 const blocks=activeRoomBlocks(state).filter(b=>b.areas.some(a=>room.areas.includes(a)));
 const canFinishCleaning=!blocks.length&&tables.some(t=>t.status==='cleaning')&&tables.every(t=>['open','cleaning'].includes(t.status)&&!t.roomBlock);
 return {...room,tables,capacity:tables.reduce((n,t)=>n+(t.capacity||0),0),unconfirmed:tables.some(t=>!t.capacity),blocks,canFinishCleaning,available:tables.length>0&&tables.every(t=>t.status==='open'&&!t.roomBlock)};
}

export const scheduledRooms=state=>(state.roomSchedule||[]).filter(b=>b.status==='scheduled');
export const overlaps=(a,b,c,d)=>a<d&&c<b;
export function roomConflict(state,areas,start,end){return [...scheduledRooms(state),...activeRoomBlocks(state)].find(b=>b.areas.some(a=>areas.includes(a))&&overlaps(start,end,b.startsAt??b.createdAt,b.endsAt??Infinity));}
export function protectsBooking(state,tables,start,end){return scheduledRooms(state).some(b=>b.areas.some(a=>tables.some(t=>t.area===a))&&overlaps(start,end,b.startsAt,b.endsAt));}
export function walkInTables(state,now=Date.now(),duration=(state.waitSettings?.diningMinutes||60)+(state.waitSettings?.cleaningMinutes??5)){
 return state.tables.filter(t=>!t.roomBlock&&!protectsBooking(state,[t],now,now+duration*60000));
}
