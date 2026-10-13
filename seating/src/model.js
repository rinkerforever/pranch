import { initialTables, AREAS } from '../public/floor.js';
export class AppError extends Error { constructor(message, status=400) { super(message); this.status=status; } }
const fail = message => { throw new AppError(message); };
const integer = (v,min,max) => Number.isInteger(v) && v>=min && v<=max;
const clean = (v,max) => String(v ?? '').trim().slice(0,max);
export function initialState() { return { tables:initialTables(), numberingVersion:1, parties:[], background:null, history:[] }; }
export function selectedTables(state, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length>12 || new Set(ids).size!==ids.length) fail('Select between 1 and 12 different tables.');
  const tables=ids.map(id=>state.tables.find(t=>t.id===id));
  if(tables.some(t=>!t)) fail('A selected table no longer exists.');
  return tables;
}
export function connected(tables) {
  const seen=new Set([tables[0]?.id]);
  let more=true;
  while(more) { more=false; for(const t of tables) if(!seen.has(t.id) && tables.some(o=>seen.has(o.id) && o.allowed.includes(t.id) && t.allowed.includes(o.id))) { seen.add(t.id);more=true; } }
  return seen.size===tables.length;
}
function completeGroups(state,tables) {
  for(const t of tables) if(t.group && state.tables.some(o=>o.group===t.group && !tables.includes(o))) fail('Select the entire combined table group.');
}
function combineCheck(state,tables) {
  completeGroups(state,tables);
  if(tables.some(t=>t.status!=='open')) fail('Only open tables can be combined or seated.');
  if(tables.length>1 && new Set(tables.map(t=>t.group)).size===1 && tables[0].group) return;
  if(tables.length>1 && (!connected(tables) || new Set(tables.map(t=>t.area)).size!==1)) fail('These tables are not an approved combination. A manager can configure combinations in Layout editor.');
}
export function applyAction(original, action, role, now=Date.now(), uuid=()=>crypto.randomUUID()) {
  const state=structuredClone(original);
  const {type}=action;
  if(!['admin','manager','host'].includes(role)) throw new AppError('You have view-only access.',403);
  if(['layout','addTable','removeTable','background'].includes(type) && !['admin','manager'].includes(role)) throw new AppError('Manager access required.',403);
  if(type==='addParty') {
    const name=clean(action.name,80), size=Number(action.size), notes=clean(action.notes,300);
    if(!name || !integer(size,1,100)) fail('Enter a name and party size between 1 and 100.');
    if(state.parties.filter(p=>p.status==='waiting').length>=200) fail('The waiting list is full.');
    state.parties.push({id:uuid(),name,size,notes,arrivedAt:now,status:'waiting'});
  } else if(type==='editParty') {
    const party=state.parties.find(p=>p.id===action.id && p.status==='waiting');
    if(!party) fail('This party is no longer waiting.');
    const name=clean(action.name,80),size=Number(action.size);
    if(!name || !integer(size,1,100)) fail('Enter a name and party size between 1 and 100.');
    Object.assign(party,{name,size,notes:clean(action.notes,300)});
  } else if(type==='cancelParty') {
    const party=state.parties.find(p=>p.id===action.id && p.status==='waiting');
    if(!party) fail('This party is no longer waiting.');
    party.status='cancelled';party.closedAt=now;
  } else if(type==='seat') {
    const party=state.parties.find(p=>p.id===action.partyId && p.status==='waiting');
    if(!party) fail('This party has already been seated or removed.');
    const tables=selectedTables(state,action.ids);combineCheck(state,tables);
    if(tables.some(t=>!t.capacity)) fail('Set the capacity for these booths before assigning a party.');
    if(tables.reduce((n,t)=>n+t.capacity,0)<party.size) fail('These tables do not have enough seats for this party.');
    const group=tables.length>1?uuid():null;
    for(const t of tables) Object.assign(t,{status:'in_use',group,party:party.id,seatedAt:now});
    Object.assign(party,{status:'seated',seatedAt:now,tables:tables.map(t=>t.id)});
  } else if(type==='combine') {
    const tables=selectedTables(state,action.ids);if(tables.length<2) fail('Select at least two tables.');combineCheck(state,tables);
    const group=uuid();for(const t of tables)t.group=group;
  } else if(type==='split') {
    const tables=selectedTables(state,action.ids);completeGroups(state,tables);
    if(tables.some(t=>t.status==='in_use')) fail('Clear the party before separating tables.');
    for(const t of tables)t.group=null;
  } else if(type==='status') {
    if(!['open','in_use','cleaning'].includes(action.status)) fail('Choose a valid status.');
    const tables=selectedTables(state,action.ids);completeGroups(state,tables);
    for(const t of tables) {
      if(t.party && action.status!=='in_use') {
        const p=state.parties.find(p=>p.id===t.party);if(p){p.status='completed';p.closedAt=now;}
      }
      if(action.status!=='in_use'){t.party=null;t.seatedAt=null;}
      else if(t.status!=='in_use')t.seatedAt=now;
      t.status=action.status;
    }
  } else if(type==='addTable' || type==='layout') {
    const table=type==='addTable'?{id:uuid(),status:'open',group:null,party:null,seatedAt:null,allowed:[]}:state.tables.find(t=>t.id===action.id);
    if(!table)fail('Table not found.');
    if(table.status!=='open'||table.group)fail('Open and separate this table before changing its layout.');
    const v=action.table || {};const number=clean(v.number,12),capacity=v.capacity===''||v.capacity===null?null:Number(v.capacity);
    if(!number||!AREAS.includes(v.area)||!['table','booth'].includes(v.kind)||!['lr','tb'].includes(v.orientation))fail('Complete the table details.');
    if(capacity!==null&&!integer(capacity,1,20))fail('Capacity must be between 1 and 20.');
    if(v.kind==='table'&&capacity===null)fail('Enter the number of chairs.');
    if(!Number.isFinite(v.x)||!Number.isFinite(v.y)||v.x<30||v.x>1630||v.y<30||v.y>920)fail('Keep the table inside the floor plan.');
    if(state.tables.some(t=>t.id!==table.id&&t.area===v.area&&t.number===number))fail('That table number already exists in this area.');
    const allowed=[...new Set(Array.isArray(v.allowed)?v.allowed:[])];
    if(allowed.some(id=>!state.tables.some(t=>t.id===id&&t.id!==table.id&&t.area===v.area&&t.kind==='table'))||v.kind==='booth'&&allowed.length)fail('Only movable tables in the same area can be combined.');
    if(state.tables.some(t=>(table.allowed.includes(t.id)||allowed.includes(t.id))&&(t.status!=='open'||t.group)))fail('Open and separate linked tables before changing their combinations.');
    for(const t of state.tables) t.allowed=t.allowed.filter(id=>id!==table.id);
    Object.assign(table,{number,area:v.area,kind:v.kind,orientation:v.orientation,capacity,x:v.x,y:v.y,allowed});
    for(const t of state.tables) if(allowed.includes(t.id))t.allowed.push(table.id);
    if(type==='addTable'){if(state.tables.length>=200)fail('Maximum 200 tables.');state.tables.push(table);}
  } else if(type==='removeTable') {
    const tables=selectedTables(state,[action.id]);
    if(tables[0].status!=='open'||tables[0].group)fail('Open and separate this table before removing it.');
    state.tables=state.tables.filter(t=>t.id!==action.id);for(const t of state.tables)t.allowed=t.allowed.filter(id=>id!==action.id);
  } else if(type==='background') {
    state.background=action.background;
  } else fail('Unknown action.');
  state.history.unshift({type,at:now});state.history=state.history.slice(0,100);
  const active=state.parties.filter(p=>['waiting','seated'].includes(p.status));
  const closed=state.parties.filter(p=>!['waiting','seated'].includes(p.status)&&now-(p.closedAt||now)<86400000).slice(-200);
  state.parties=[...active,...closed];
  return state;
}
