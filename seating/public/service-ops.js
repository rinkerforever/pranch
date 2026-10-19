// Shared by cloud, local server and UI. No timers or network requests.
export const areaClosed=(state,area)=>!!state.closedAreas?.[area];
export function serviceTables(state){
 const blockedGroups=new Set(state.tables.filter(t=>areaClosed(state,t.area)&&t.group).map(t=>t.group));
 return state.tables.filter(t=>!areaClosed(state,t.area)&&!blockedGroups.has(t.group));
}
export function delayReason(party,estimate){
 if(party.attendance==='away')return 'Not present — estimates paused until returned to waiting.';
 if(!estimate)return 'No available configured fit. Review closed sections, capacity and combinations.';
 if(estimate.ready)return 'Tables are open — confirm the guest is present and seat.';
 const occupied=estimate.tables.filter(t=>t.status==='in_use'),cleaning=estimate.tables.filter(t=>t.status==='cleaning');
 const reasons=[];
 if(occupied.length)reasons.push(`${occupied.length} table${occupied.length===1?' is':'s are'} still occupied, then need cleaning`);
 if(cleaning.length)reasons.push(`${cleaning.length} table${cleaning.length===1?' needs':'s need'} cleaning`);
 if(estimate.tables.length>1)reasons.push('all tables in the combination must be ready together');
 return reasons.length?reasons.join('; ')+'.':'Waiting behind planned guests or a room booking.';
}
export function cleaningQueue(state,plan,now=Date.now(),planner){
 const seen=new Set(),rows=[];
 for(const t of state.tables.filter(t=>t.status==='cleaning')){
  const key=t.group||t.id;if(seen.has(key))continue;seen.add(key);
  const tables=t.group?state.tables.filter(o=>o.group===t.group):[t];
  const ids=new Set(tables.map(t=>t.id));
  const projected=planner?planner({...state,tables:state.tables.map(t=>ids.has(t.id)&&t.status==='cleaning'?{...t,status:'open'}:t)},now):plan;
  const guests=projected.rows.filter(r=>r.party.attendance!=='away'&&r.estimate?.ready&&r.estimate.tables.some(t=>ids.has(t.id)));
  const started=Math.min(...tables.map(t=>t.cleaningAt||now));
  rows.push({key,tables,started,minutes:Math.max(0,Math.floor((now-started)/60000)),guests:guests.map(r=>r.party),canReady:tables.every(t=>t.status==='cleaning'&&!t.roomBlock)});
 }
 return rows.sort((a,b)=>a.started-b.started||a.key.localeCompare(b.key));
}
export const undoLabels={reassign:'reassign party',status:'table status',seat:'seat guest',seatNow:'seat walk-in',combine:'combine tables',split:'separate tables',cancelParty:'remove guest',partyContact:'guest attendance',areaAvailability:'section availability'};
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
export function recordUndo(before,after,type,now,id){
 if(!undoLabels[type])return null;
 const changes=[];
 for(const key of ['tables','parties']){
  const left=new Map(before[key].map(v=>[v.id,v])),right=new Map(after[key].map(v=>[v.id,v]));
  for(const id of new Set([...left.keys(),...right.keys()]))if(!same(left.get(id),right.get(id)))changes.push({key,id,before:left.get(id)||null,after:right.get(id)||null});
 }
 for(const key of ['diningSamples','closedAreas'])if(!same(before[key],after[key]))changes.push({key,before:before[key]??null,after:after[key]??null});
 return changes.length?{id,type,at:now,changes:structuredClone(changes)}:null;
}
export function undoAvailable(state,now=Date.now()){
 const undo=state.lastUndo;if(!undo||now-undo.at>5*60000)return false;
 return undo.changes.every(c=>same(c.id?state[c.key].find(v=>v.id===c.id):state[c.key],c.after));
}
export function restoreUndo(state){
 for(const c of state.lastUndo.changes){
  if(c.id){state[c.key]=state[c.key].filter(v=>v.id!==c.id);if(c.before)state[c.key].push(structuredClone(c.before));}
  else if(c.before===null)delete state[c.key];else state[c.key]=structuredClone(c.before);
 }
 state.lastUndo=null;
}
