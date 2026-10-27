import {withinCombinationDistance} from './combinations.js';
export function combineToolbar(state,ids,combining){
 const tables=state.tables.filter(t=>ids.includes(t.id)),group=tables[0]?.group;
 const wholeGroup=!!group&&tables.every(t=>t.group===group)&&state.tables.filter(t=>t.group===group).length===tables.length;
 if(!combining&&wholeGroup)return {action:'split',label:'Un-combine',disabled:tables.some(t=>t.status==='in_use'||t.roomBlock)};
 if(combining)return {action:'combine',label:`Apply${tables.length?' ('+tables.length+')':''}`,disabled:tables.length<2||tables.length>12||tables.some(t=>t.status!=='open'||t.roomBlock)};
 return {action:'start',label:'Combine',disabled:false};
}
export function needsCombinationOverride(tables,allTables){
 if(tables.length<2)return false;
 if(tables[0].group&&tables.every(t=>t.group===tables[0].group))return false;
 const seen=new Set([tables[0].id]);let changed=true;
 while(changed){changed=false;for(const t of tables)if(!seen.has(t.id)&&tables.some(o=>seen.has(o.id)&&o.allowed.includes(t.id)&&t.allowed.includes(o.id))){seen.add(t.id);changed=true;}}
 return seen.size!==tables.length||new Set(tables.map(t=>t.area)).size!==1||!withinCombinationDistance(tables,allTables);
}
