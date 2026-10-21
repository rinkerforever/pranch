import {roomOptions} from './areas.js';
import {areaClosed} from './service-ops.js';

// Display intervals are half-open: the next booking wins at the exact end time.
export function roomDisplayState(state,roomId,now=Date.now()){
 const room=roomOptions(state).find(r=>r.id===roomId);
 if(!room)return {status:'unavailable'};
 const schedule=state.roomSchedule||[];
 const blocks=(state.roomBlocks||[]).filter(b=>['held','in_use'].includes(b.status)).map(b=>({...b,startsAt:b.scheduledStartsAt??schedule.find(s=>s.id===b.scheduleId)?.startsAt??b.startsAt??b.createdAt}));
 const bookings=[...schedule.filter(b=>b.status==='scheduled'),...blocks].filter(b=>b.areas?.some(a=>room.areas.includes(a))&&Number.isFinite(b.startsAt)&&Number.isFinite(b.endsAt)&&b.endsAt>now).sort((a,b)=>a.startsAt-b.startsAt);
 const current=bookings.find(b=>b.startsAt<=now),next=bookings.find(b=>b.startsAt>now);
 if(current)return {room,status:'active',booking:current,next,remaining:Math.max(0,current.endsAt-now),progress:Math.max(0,Math.min(1,(now-current.startsAt)/(current.endsAt-current.startsAt)))};
 if(next)return {room,status:'reserved',booking:next};
 return {room,status:room.areas.some(a=>areaClosed(state,a))?'closed':'open'};
}
