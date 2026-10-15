import {preferredSeating} from './accessibility.js';
// Suggestions never split an existing group and only join mutually approved neighbors.
export function combinationCandidates(tables){
  const open=tables.filter(t=>t.status==='open'&&t.capacity),results=[],seen=new Set();
  const add=ts=>{const ids=ts.map(t=>t.id).sort(),key=ids.join('|');if(seen.has(key)||ts.some(t=>t.group&&tables.some(o=>o.group===t.group&&!ids.includes(o.id))))return;seen.add(key);results.push(ts);};
  const units=[];
  for(const t of open){const group=t.group?tables.filter(o=>o.group===t.group):[t];if(group.every(o=>o.status==='open'&&o.capacity)){add(group);if(!units.some(u=>u[0].id===group[0].id))units.push(group);}}
  for(let i=0;i<results.length&&i<2000;i++){const ts=results[i];for(const unit of units){if(ts.length+unit.length>4||unit.some(t=>ts.includes(t)||t.area!==ts[0].area))continue;if(unit.some(t=>ts.some(o=>o.allowed.includes(t.id)&&t.allowed.includes(o.id))))add([...ts,...unit]);}}
  return results;
}
export function suggestTables(tables,size,limit=5,preferred=new Set()){
  if(!Number.isInteger(size)||size<1)return [];
  const results=combinationCandidates(tables);
  const capacity=ts=>ts.reduce((sum,t)=>sum+t.capacity,0);
  return results.filter(ts=>capacity(ts)>=size).sort((a,b)=>Number(preferredSeating(b,preferred))-Number(preferredSeating(a,preferred))||capacity(a)-capacity(b)||a.length-b.length).slice(0,limit);
}
