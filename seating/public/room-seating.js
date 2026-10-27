import {roomOptions} from './areas.js';
import {roomSeatingCheck} from './rooms.js';
export const roomWarning=check=>check.warnings.map(b=>`${b.name||'Reserved party'} starts at ${new Date(b.startsAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`).join('; ');
export function openRoomSeating({getState,canWrite,save,confirm,partyId,roomId}){
 const d=document.createElement('dialog');d.className='seat-room-dialog';
 d.innerHTML='<h2>Seat whole party room</h2><p>Assign every table in the room to one party, without manually combining tables.</p><label>Waiting party<select class="guest"></select></label><label>Party room<select class="room"></select></label><label>Room time (minutes)<input type="number" min="1" max="720" value="90"></label><p class="info" role="status"></p><button class="seat primary">Seat whole room</button><button class="done">Cancel</button>';
 const guests=d.querySelector('.guest'),rooms=d.querySelector('.room'),duration=d.querySelector('input'),info=d.querySelector('.info'),seat=d.querySelector('.seat');
 let saving=false;
 for(const p of getState().parties.filter(p=>p.status==='waiting'))guests.add(new Option(`${p.name} · ${p.size} guests`,p.id));
 for(const r of roomOptions(getState()))rooms.add(new Option(r.name,r.id));
 if(partyId)guests.value=partyId;if(roomId)rooms.value=roomId;
 function check(){const s=getState(),p=s.parties.find(p=>p.id===guests.value&&p.status==='waiting');const c=roomSeatingCheck(s,rooms.value,p?.size,Date.now(),Date.now()+Number(duration.value)*60000);return {p,c};}
 function update(){const {p,c}=check();seat.disabled=saving||!canWrite()||!p||p.attendance==='away'||!c.available;
 info.textContent=!p?'Choose a waiting party.':p.attendance==='away'?'Return this guest to waiting first.':c.reason||`${c.room.capacity} seats · All ${c.room.tables.length} tables.${c.warnings.length?' WARNING: '+roomWarning(c)+'. Booking within 90 minutes — you may continue after confirming the conflict.':' No booking conflict.'}${c.room.areas.length>1?' Confirm the room divider is open.':''}`;}
 guests.onchange=rooms.onchange=duration.oninput=update;d.querySelector('.done').onclick=()=>d.close();
 seat.onclick=async()=>{update();if(seat.disabled)return;const {p,c}=check(),end=Date.now()+Number(duration.value)*60000;
  if(!await confirm(c.warnings.length?'Booking conflict — seat anyway?':'Seat whole room?',`${p.name}, party of ${p.size}, in ${c.room.name}. Every table will be assigned.${c.warnings.length?' '+roomWarning(c)+'. This booking is within 90 minutes; continuing may conflict with the reservation. Confirm you still want to seat this party.':''}${c.room.areas.length>1?' Confirm the divider is open.':''}`))return;
  saving=true;update();try{if(await save({type:'seatWholeRoom',partyId:p.id,roomId:c.room.id,endsAt:end,acknowledgedBookings:c.warnings.map(b=>b.id)}))d.close();}finally{saving=false;if(d.open)update();}
 };
 document.body.append(d);d.showModal();update();const timer=setInterval(update,3000);d.onclose=()=>{clearInterval(timer);d.remove();};
}
