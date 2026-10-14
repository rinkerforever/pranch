import {scheduledRooms,overlaps} from './rooms.js';
import {combinationCandidates} from './suggestions.js';
const capacity=ts=>ts.reduce((n,t)=>n+t.capacity,0);
export function waitSettings(state){
 const samples=state.parties.filter(p=>p.status==='completed'&&p.seatedAt&&p.closedAt>p.seatedAt).map(p=>(p.closedAt-p.seatedAt)/60000).filter(n=>n>=15&&n<=180).slice(-30).sort((a,b)=>a-b);
 const observed=samples.length>=3?Math.round(samples[Math.floor(samples.length/2)]):null;
 return {diningMinutes:state.waitSettings?.diningMinutes||observed||60,cleaningMinutes:state.waitSettings?.cleaningMinutes??5,source:state.waitSettings?'Host setting':observed?'Recent completed visits':'Default assumption',sampleCount:samples.length};
}
function choose(candidates,available,size,context){
 let best=null;
 for(const tables of candidates){
  const seats=capacity(tables);if(seats<size)continue;
  let minutes=Math.max(...tables.map(t=>available.get(t.id)??Infinity));
  if(context){const bookings=context.bookings.filter(b=>tables.some(t=>b.areas.includes(t.area))).sort((a,b)=>a.startsAt-b.startsAt);
   for(const b of bookings)if(overlaps(context.now+minutes*60000,context.now+(minutes+context.duration)*60000,b.startsAt,b.endsAt))minutes=(b.endsAt-context.now)/60000;
  }
  if(!Number.isFinite(minutes))continue;
  if(!best||minutes<best.minutes||minutes===best.minutes&&(seats<best.capacity||seats===best.capacity&&tables.length<best.tables.length))best={tables,minutes,capacity:seats,ready:minutes===0};
 }return best;
}
export function estimateNewParty(plan,size){return Number.isInteger(size)&&size>0&&size<=100?choose(plan.candidates,plan.available,size,plan.context):null;}
export function waitRange(estimate){
 if(!estimate)return 'Host review needed';
 if(estimate.ready)return 'Ready to seat';
 const lower=Math.max(5,Math.floor((estimate.minutes-5)/5)*5),upper=Math.max(lower+10,Math.ceil((estimate.minutes+10)/5)*5);
 return `${lower}–${upper} min`;
}
export function planWaitlist(state,now=Date.now()){
 const settings=waitSettings(state),available=new Map(),context={now,duration:settings.diningMinutes+settings.cleaningMinutes,bookings:scheduledRooms(state)};
 for(const t of state.tables){
  const elapsed=t.seatedAt?Math.max(0,(now-t.seatedAt)/60000):0;
  const cleaningElapsed=t.cleaningAt?Math.max(0,(now-t.cleaningAt)/60000):0;
  const minutes=t.status==='open'?0:t.status==='cleaning'?Math.max(1,settings.cleaningMinutes-cleaningElapsed):t.status==='in_use'?Math.max(10,settings.diningMinutes-elapsed)+settings.cleaningMinutes:Infinity;
  available.set(t.id,minutes);
 }
 const candidates=combinationCandidates(state.tables.filter(t=>!t.roomBlock).map(t=>({...t,status:'open'})));
 const largestSingle=Math.max(0,...state.tables.map(t=>t.capacity||0));
 const waiting=state.parties.filter(p=>p.status==='waiting').sort((a,b)=>a.arrivedAt-b.arrivedAt);
 // Parties requiring combinations get planned before individual tables are offered away.
 // Arrival order is retained within each category; the displayed list keeps arrival order.
 const order=[...waiting].sort((a,b)=>Number(b.size>largestSingle)-Number(a.size>largestSingle)||a.arrivedAt-b.arrivedAt);
 const results=new Map();
 for(const party of order){
  const estimate=choose(candidates,available,party.size,context);
  results.set(party.id,{party,estimate,combinationPriority:party.size>largestSingle});
  if(estimate)for(const t of estimate.tables)available.set(t.id,estimate.minutes+settings.diningMinutes+settings.cleaningMinutes);
 }
 return {rows:waiting.map(p=>results.get(p.id)),available,candidates,settings,context};
}
