import {scheduledRooms,overlaps} from './rooms.js';
import {partyRoomAreas,seatingPriority} from './areas.js';
import {combinationCandidates,usesPartyRoom} from './suggestions.js';
import {preferredAreas,preferredSeating} from './accessibility.js';
import {serviceTables} from './service-ops.js';
const capacity=ts=>ts.reduce((n,t)=>n+t.capacity,0);
export function waitSettings(state){
 const visits=state.parties.filter(p=>p.status==='completed'&&p.seatedAt&&p.closedAt>p.seatedAt).map(p=>({minutes:(p.closedAt-p.seatedAt)/60000,closedAt:p.closedAt}));
 const samples=[...visits,...(state.diningSamples||[])].filter(v=>Number.isFinite(v.minutes)&&v.minutes>=15&&v.minutes<=180).sort((a,b)=>a.closedAt-b.closedAt).slice(-30).map(v=>v.minutes);
 const observed=samples.length>=3?Math.round(samples.reduce((a,b)=>a+b,0)/samples.length):null;
 return {diningMinutes:state.waitSettings?.diningMinutes||observed||60,cleaningMinutes:state.waitSettings?.cleaningMinutes??5,source:state.waitSettings?'Host setting':observed?'Recent completed visits (average)':'Default assumption',sampleCount:samples.length,observedMinutes:observed};
}
function choose(candidates,available,size,context,accessibility=false){
 let best=null;const options=[];
 for(const tables of candidates){
  const seats=capacity(tables);if(seats<size)continue;
  let minutes=Math.max(...tables.map(t=>available.get(t.id)??Infinity));
  if(context){const bookings=context.bookings.filter(b=>tables.some(t=>b.areas.includes(t.area))).sort((a,b)=>a.startsAt-b.startsAt);
   for(const b of bookings)if(overlaps(context.now+minutes*60000,context.now+(minutes+context.duration)*60000,b.startsAt,b.endsAt))minutes=(b.endsAt-context.now)/60000;
  }
  if(!Number.isFinite(minutes))continue;
  options.push({tables,minutes,seats});
 }
 // Use party rooms as overflow only after suitable open dining tables are allocated.
 const rooms=context?.partyRoomAreas||partyRoomAreas();
 const diningReady=options.some(o=>o.minutes===0&&!usesPartyRoom(o.tables,rooms));
 const roomReady=!diningReady&&options.some(o=>o.minutes===0&&usesPartyRoom(o.tables,rooms));
 for(const {tables,minutes,seats} of options){
  if(diningReady&&usesPartyRoom(tables,rooms)||roomReady&&minutes!==0)continue;
  const preferred=accessibility&&preferredSeating(tables,context?.preferredAreas||new Set());
  // Prefer a suitable marked area when its extra predicted wait is at most 15 minutes.
  const rank=minutes-(preferred?15:0),bestRank=best?best.minutes-(best.accessiblePreferred?15:0):Infinity;
  const score=[rank,Number(!preferred),minutes,Number(usesPartyRoom(tables,rooms)),seatingPriority(tables,context?.areaPriorities),seats,tables.length];
  const previous=best?[bestRank,Number(!best.accessiblePreferred),best.minutes,Number(usesPartyRoom(best.tables,rooms)),seatingPriority(best.tables,context?.areaPriorities),best.capacity,best.tables.length]:null;
  const difference=previous?score.map((v,i)=>v-previous[i]).find(v=>v!==0): -1;
  if(!best||difference<0)best={tables,minutes,capacity:seats,ready:minutes===0,...(accessibility?{accessiblePreferred:preferred}:{})};
 }return best;
}
export function estimateNewParty(plan,size,preferences={}){return Number.isInteger(size)&&size>0&&size<=100?choose(plan.candidates,plan.available,size,plan.context,preferences.accessibility===true):null;}
export function seatingOptions(plan,size,preferences={}){
 if(!Number.isInteger(size)||size<1||size>100)return {open:[],soon:[]};
 const all=plan.candidates.map(tables=>choose([tables],plan.available,size,plan.context,preferences.accessibility===true)).filter(Boolean);
 const key=tables=>tables.map(t=>t.id).sort().join('|'),byTables=new Map(all.map(o=>[key(o.tables),o]));
 const options=all.filter(o=>{
  if(o.tables.length>4)return true; // Larger existing groups are indivisible.
  for(let mask=1;mask<(1<<o.tables.length)-1;mask++){
   const other=byTables.get(key(o.tables.filter((t,i)=>mask&(1<<i))));
   if(other&&other.minutes<=o.minutes&&(!o.accessiblePreferred||other.accessiblePreferred))return false;
  }
  return true;
 });
 const rooms=plan.context.partyRoomAreas;
 const open=options.filter(o=>o.ready),diningOpen=open.filter(o=>!usesPartyRoom(o.tables,rooms));
 const order=(a,b)=>(a.minutes-(a.accessiblePreferred?15:0))-(b.minutes-(b.accessiblePreferred?15:0))||Number(!!b.accessiblePreferred)-Number(!!a.accessiblePreferred)||a.minutes-b.minutes||Number(usesPartyRoom(a.tables,rooms))-Number(usesPartyRoom(b.tables,rooms))||seatingPriority(a.tables,plan.context.areaPriorities)-seatingPriority(b.tables,plan.context.areaPriorities)||a.capacity-b.capacity||a.tables.length-b.tables.length;
 const ranked=(diningOpen.length?diningOpen:open).sort(order).slice(0,5);
 const selected=preferences.selectedIds;
 const chosen=Array.isArray(selected)&&selected.length?all.find(o=>o.ready&&o.tables.length===selected.length&&o.tables.every(t=>selected.includes(t.id))):null;
 if(chosen){const other=ranked.filter(o=>key(o.tables)!==key(chosen.tables));ranked.splice(0,ranked.length,{...chosen,selectedOnFloor:true},...other);}
 return {open:ranked,soon:options.filter(o=>!o.ready&&o.minutes<=30).sort(order).slice(0,5)};
}
export function waitRange(estimate){
 if(!estimate)return 'Host review needed';
 if(estimate.ready)return 'Ready to seat';
 const lower=Math.max(5,Math.floor((estimate.minutes-5)/5)*5),upper=Math.max(lower+10,Math.ceil((estimate.minutes+10)/5)*5);
 return `${lower}–${upper} min`;
}
export function planWaitlist(state,now=Date.now()){
 const settings=waitSettings(state),available=new Map(),eligible=new Set(serviceTables(state).map(t=>t.id)),context={now,areaPriorities:state.areaPriorities||{},duration:settings.diningMinutes+settings.cleaningMinutes,bookings:scheduledRooms(state),preferredAreas:preferredAreas(state),partyRoomAreas:partyRoomAreas(state)};
 for(const t of state.tables){
  const elapsed=t.seatedAt?Math.max(0,(now-t.seatedAt)/60000):0;
  const cleaningElapsed=t.cleaningAt?Math.max(0,(now-t.cleaningAt)/60000):0;
  const minutes=t.status==='open'?0:t.status==='cleaning'?Math.max(1,settings.cleaningMinutes-cleaningElapsed):t.status==='in_use'?Math.max(10,settings.diningMinutes-elapsed)+settings.cleaningMinutes:Infinity;
  available.set(t.id,eligible.has(t.id)?minutes:Infinity);
 }
 const candidates=combinationCandidates(serviceTables(state).filter(t=>!t.roomBlock).map(t=>({...t,status:'open',actualStatus:t.status}))).map(ts=>ts.map(({actualStatus,...t})=>({...t,status:actualStatus})));
 const largestSingle=Math.max(0,...serviceTables(state).map(t=>t.capacity||0));
 const waiting=state.parties.filter(p=>p.status==='waiting').sort((a,b)=>a.arrivedAt-b.arrivedAt);
 // Parties requiring combinations get planned before individual tables are offered away.
 // Arrival order is retained within each category; the displayed list keeps arrival order.
 const order=[...waiting].sort((a,b)=>Number(b.size>largestSingle)-Number(a.size>largestSingle)||a.arrivedAt-b.arrivedAt);
 const results=new Map();
 for(const party of order){
  if(party.attendance==='away'){results.set(party.id,{party,estimate:null,combinationPriority:false});continue;}
  const estimate=choose(candidates,available,party.size,context,party.accessibility===true);
  results.set(party.id,{party,estimate,combinationPriority:party.size>largestSingle});
  if(estimate)for(const t of estimate.tables)available.set(t.id,estimate.minutes+settings.diningMinutes+settings.cleaningMinutes);
 }
 return {rows:waiting.map(p=>results.get(p.id)),available,candidates,settings,context};
}
