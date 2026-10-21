import {partyRoomAreas,seatingPriority} from './areas.js';
import {preferredSeating} from './accessibility.js';
import {withinCombinationDistance} from './combinations.js';
// Suggestions never split an existing group and only join mutually approved neighbors.
export function combinationCandidates(tables){
  const open=tables.filter(t=>t.status==='open'&&t.capacity),results=[],seen=new Set();
  const add=ts=>{const ids=ts.map(t=>t.id).sort(),key=ids.join('|');if(seen.has(key)||!withinCombinationDistance(ts,tables)||ts.some(t=>t.group&&tables.some(o=>o.group===t.group&&!ids.includes(o.id))))return;seen.add(key);results.push(ts);};
  const units=[];
  for(const t of open){const group=t.group?tables.filter(o=>o.group===t.group):[t];if(group.every(o=>o.status==='open'&&o.capacity)){add(group);if(!units.some(u=>u[0].id===group[0].id))units.push(group);}}
  for(let i=0;i<results.length&&i<2000;i++){const ts=results[i];for(const unit of units){if(ts.length+unit.length>4||unit.some(t=>ts.includes(t)||t.area!==ts[0].area))continue;if(unit.some(t=>ts.some(o=>o.allowed.includes(t.id)&&t.allowed.includes(o.id))))add([...ts,...unit]);}}
  return results;
}
export const usesPartyRoom=(tables,rooms)=>tables.some(t=>rooms.has(t.area));
export function preferDiningTables(candidates,rooms){
 const dining=candidates.filter(ts=>!usesPartyRoom(ts,rooms));
 return dining.length?dining:candidates;
}
export function suggestTables(tables,size,limit=5,preferred=new Set(),rooms=partyRoomAreas(),priorities={}){
  if(!Number.isInteger(size)||size<1)return [];
  const results=combinationCandidates(tables);
  const capacity=ts=>ts.reduce((sum,t)=>sum+t.capacity,0);
  return preferDiningTables(results.filter(ts=>capacity(ts)>=size),rooms).sort((a,b)=>Number(preferredSeating(b,preferred))-Number(preferredSeating(a,preferred))||seatingPriority(a,priorities)-seatingPriority(b,priorities)||capacity(a)-capacity(b)||a.length-b.length).slice(0,limit);
}
