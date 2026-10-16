import {roomInfo,activeRoomBlocks,scheduledRooms,roomConflict,protectsBooking} from '../public/rooms.js';
import {areaOptions,roomCombinations} from '../public/areas.js';
import {presetCombinations,includesBoothCombination,childBoothFit} from '../public/combinations.js';
import { initialTables } from '../public/floor.js';
import {waitSettings,planWaitlist} from '../public/wait-plan.js';
import {quoteForParty} from '../public/wait-forecast.js';
import {areaClosed,recordUndo,undoAvailable,restoreUndo} from '../public/service-ops.js';
export class AppError extends Error { constructor(message, status=400) { super(message); this.status=status; } }
const fail = message => { throw new AppError(message); };
const integer = (v,min,max) => Number.isInteger(v) && v>=min && v<=max;
function equipment(action,existing={}){
 for(const key of ['highChair','booster','accessibility'])if(action[key]!==undefined&&typeof action[key]!=='boolean')fail('Choose seating needs with the checkboxes.');
 return {highChair:action.highChair??existing.highChair??false,booster:action.booster??existing.booster??false,accessibility:action.accessibility??existing.accessibility??false};
}
const clean = (v,max) => String(v ?? '').trim().slice(0,max);
export function initialState() { return presetCombinations({ tables:initialTables(), numberingVersion:1, parties:[], background:null, history:[] }); }
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
function combineCheck(state,tables,override=false) {
  completeGroups(state,tables);
  if(tables.some(t=>areaClosed(state,t.area)))fail('This section is closed. Reopen it before seating or combining tables.');
  if(tables.some(t=>t.status!=='open')) fail('Only open tables can be combined or seated.');
  if(tables.length>1 && new Set(tables.map(t=>t.group)).size===1 && tables[0].group) return;
  if(!override&&tables.length>1 && (!connected(tables) || new Set(tables.map(t=>t.area)).size!==1)) fail('These tables are not an approved combination. Use the host combination override after confirming they can be used together.');
}
export function applyAction(original, action, role, now=Date.now(), uuid=()=>crypto.randomUUID()) {
 if(action.type==='undo'){
  if(!['admin','manager','host'].includes(role))throw new AppError('You have view-only access.',403);
  if(action.undoId!==original.lastUndo?.id||!undoAvailable(original,now))fail('This action can no longer be undone. Another change was made or the five-minute undo window expired.');
  const state=structuredClone(original);restoreUndo(state);state.history.unshift({type:'undo',at:now});state.history=state.history.slice(0,100);return state;
 }
 const state=applyActionCore(original,action,role,now,uuid);
 state.lastUndo=recordUndo(original,state,action.type,now,uuid());
 return state;
}
function applyActionCore(original, action, role, now=Date.now(), uuid=()=>crypto.randomUUID()) {
  const state=structuredClone(original);
  const {type}=action;
  if(!['admin','manager','host'].includes(role)) throw new AppError('You have view-only access.',403);
  if(['cleanPlan','saveArea','deleteArea','addRoomCombination','deleteRoomCombination','layout','addTable','removeTable','background','replaceFloor','presetCombinations'].includes(type) && !['admin','manager'].includes(role)) throw new AppError('Manager access required.',403);
  if(type==='areaAvailability'){
    if(!areaOptions(state).some(a=>a.id===action.area)||typeof action.closed!=='boolean')fail('Choose a valid section.');
    state.closedAreas={...(state.closedAreas||{})};
    if(action.closed)state.closedAreas[action.area]={at:now,reason:clean(action.reason,100)||'Temporarily closed'};else delete state.closedAreas[action.area];
  }else if(type==='partyContact'){
    const party=state.parties.find(p=>p.id===action.id&&p.status==='waiting');if(!party)fail('This party is no longer waiting.');
    if(!['called','away','waiting'].includes(action.contact))fail('Choose a valid guest status.');
    if(action.contact==='called'){if(party.attendance==='away')fail('Return this guest to waiting before calling them.');party.calledAt=now;party.attendance='called';}
    if(action.contact==='away'){party.attendance='away';party.awayAt=now;}
    if(action.contact==='waiting'){party.attendance='waiting';party.returnedAt=now;delete party.calledAt;delete party.awayAt;}
  }else if(['saveArea','deleteArea','addRoomCombination','deleteRoomCombination'].includes(type)){
    const areas=structuredClone(areaOptions(state)),combinations=structuredClone(roomCombinations(state));
    const bookings=[...activeRoomBlocks(state),...scheduledRooms(state).filter(b=>b.endsAt>now)];
    if(type==='saveArea'){
      const name=clean(action.name,40),kind=action.kind;
      if(action.accessiblePreferred!==undefined&&typeof action.accessiblePreferred!=='boolean')fail('Choose accessibility preference with the checkbox.');
      if(!name||!['section','room'].includes(kind))fail('Enter an area name and choose table section or party room.');
      if(areas.some(a=>a.id!==action.id&&a.name.toLowerCase()===name.toLowerCase()))fail('That area name already exists at this location.');
      if(action.id){const area=areas.find(a=>a.id===action.id);if(!area)fail('Area no longer exists. Reopen Areas & rooms.');
        if(area.kind!==kind&&(bookings.some(b=>b.areas.includes(area.id))||combinations.some(c=>c.areas.includes(area.id))))fail('Release or cancel this room’s bookings and remove its room combinations before changing its type.');
        Object.assign(area,{name,kind,accessiblePreferred:action.accessiblePreferred??area.accessiblePreferred??false});
      }else{if(areas.length>=40)fail('Maximum 40 areas per location.');areas.push({id:uuid(),name,kind,accessiblePreferred:action.accessiblePreferred??false});}
    }else if(type==='deleteArea'){
      if(!areas.some(a=>a.id===action.id))fail('Area no longer exists.');
      if(state.tables.some(t=>t.area===action.id))fail('Move or remove this area’s tables before deleting it.');
      if(bookings.some(b=>b.areas.includes(action.id))||combinations.some(c=>c.areas.includes(action.id)))fail('Remove this area’s bookings and room combinations first.');
      if(areas.length===1)fail('Keep at least one area at this location.');
      areas.splice(areas.findIndex(a=>a.id===action.id),1);
    }else if(type==='addRoomCombination'){
      const ids=action.areas;
      if(!Array.isArray(ids)||ids.length<2||ids.length>5||new Set(ids).size!==ids.length||ids.some(id=>!areas.some(a=>a.id===id&&a.kind==='room')))fail('Choose 2–5 different party rooms that can open together.');
      if(combinations.some(c=>c.areas.length===ids.length&&ids.every(id=>c.areas.includes(id))))fail('That room combination already exists.');
      if(combinations.length>=40)fail('Maximum 40 room combinations.');
      combinations.push({id:uuid(),areas:[...ids]});
    }else{
      if(!combinations.some(c=>c.id===action.id))fail('Room combination no longer exists.');
      if(bookings.some(b=>b.roomId===action.id))fail('Release or cancel bookings for this combination before removing it.');
      combinations.splice(combinations.findIndex(c=>c.id===action.id),1);
    }
    state.areaConfig=areas;state.roomCombinations=combinations;
  }else if(type==='finishRoomCleaning') {
    const room=roomInfo(state,action.roomId);
    if(!room?.canFinishCleaning)fail('This room is not ready to finish cleaning.');
    completeGroups(state,room.tables);
    for(const t of room.tables.filter(t=>t.status==='cleaning'))Object.assign(t,{status:'open',party:null,group:null,seatedAt:null,cleaningAt:null});
  }else if(type==='replaceFloor') {
    if(state.tables.some(t=>['in_use','reserved'].includes(t.status))||state.parties.some(p=>['seated','reserved'].includes(p.status))||activeRoomBlocks(state).length)fail('Clear all seated guests and release room holds before replacing this location’s tables.');
    if(scheduledRooms(state).some(b=>b.endsAt>now))fail('Cancel or complete future room bookings before replacing this location’s layout.');
    if(!action.background||!Array.isArray(action.tables)||!action.tables.length||action.tables.length>200)fail('Review between 1 and 200 tables before importing.');
    const used=new Set();
    state.tables=action.tables.map(v=>{
      if(!v||typeof v!=='object')fail('Every imported table needs a number, position and type.');
      const number=clean(v.number,12),area=clean(v.area,40),capacity=v.capacity===null||v.capacity===''?null:Number(v.capacity);
      if(!number||!areaOptions(original).some(a=>a.id===area)||!['table','booth'].includes(v.kind)||!['lr','tb'].includes(v.orientation))fail('Check the table number, area and type on every imported table.');
      if(capacity!==null&&!integer(capacity,1,20))fail('Seats must be 1–20, or blank when unconfirmed.');
      if(!Number.isFinite(v.x)||!Number.isFinite(v.y)||v.x<30||v.x>1630||v.y<30||v.y>920)fail('Keep every imported table inside the floor plan.');
      const key=area+'|'+number.toLowerCase();if(used.has(key))fail(`Duplicate table ${number} in ${area}. Correct or exclude the duplicate before importing.`);used.add(key);
      return {id:uuid(),number,area,capacity,kind:v.kind,orientation:v.orientation,x:v.x,y:v.y,status:'open',party:null,group:null,seatedAt:null,cleaningAt:null,allowed:[]};
    });
    state.background=action.background;state.numberingVersion=1;state.combinationVersion=1;
  } else if(type==='scheduleRoom') {
    const room=roomInfo(state,action.roomId),start=Number(action.startsAt),end=Number(action.endsAt),size=Number(action.size),name=clean(action.name,80);
    if(!room||!room.tables.length||room.unconfirmed)fail('Choose a room with confirmed capacity.');
    if(!name||!integer(size,1,room.capacity))fail(`Enter a group name and size from 1 to ${room.capacity}.`);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<now||start>now+366*86400000||end-start<15*60000||end-start>12*3600000)fail('Choose a future start time and a booking length from 15 minutes to 12 hours.');
    if(roomConflict(state,room.areas,start,end))fail('This time overlaps an existing room booking.');
    const upcoming=scheduledRooms(state).filter(b=>b.endsAt>now);if(upcoming.length>=200)fail('Maximum 200 upcoming room bookings.');
    state.roomSchedule=[...upcoming,{id:uuid(),roomId:room.id,areas:room.areas,name,size,notes:clean(action.notes,300),...equipment(action),startsAt:start,endsAt:end,status:'scheduled',createdAt:now}];
  } else if(type==='cancelRoomBooking') {
    const booking=scheduledRooms(state).find(b=>b.id===action.id);if(!booking)fail('Booking not found.');booking.status='cancelled';booking.closedAt=now;
  } else if(type==='activateRoomBooking') {
    const booking=scheduledRooms(state).find(b=>b.id===action.id);if(!booking)fail('Booking not found.');
    if(now<booking.startsAt-30*60000||now>=booking.endsAt)fail('Start this booking within 30 minutes of arrival and before its end time.');
    booking.status='activated';
    const result=applyAction(state,{type:'bookRoom',roomId:booking.roomId,name:booking.name,size:booking.size,notes:booking.notes,highChair:booking.highChair,booster:booking.booster,endsAt:booking.endsAt},role,now,uuid);
    result.roomBlocks.at(-1).scheduleId=booking.id;return result;
  } else if(type==='bookRoom') {
    const room=roomInfo(state,action.roomId);if(!room||!room.available||room.blocks.length)fail('This room is not fully open. Clear its current tables or release its room booking first.');
    if(room.unconfirmed)fail('Confirm every table capacity in this room first.');
    completeGroups(state,room.tables);
    const end=action.endsAt===undefined?now+120*60000:Number(action.endsAt);
    if(!Number.isFinite(end)||end<now+60000||end>now+12*3600000)fail('Choose a room release time within the next 12 hours.');
    if(roomConflict(state,room.areas,now,end))fail('This hold would overlap a scheduled room booking. Choose an earlier release time.');
    let party=action.partyId?state.parties.find(p=>p.id===action.partyId&&p.status==='waiting'):null;
    if(action.partyId&&!party)fail('This party is no longer waiting.');
    if(party?.attendance==='away')fail('Return this guest to waiting before reserving a room.');
    const name=party?.name||clean(action.name,80),size=party?.size||Number(action.size);
    if(!name||!integer(size,1,room.capacity))fail(`Enter a group name and party size from 1 to ${room.capacity}.`);
    const fromWaitlist=!!party;
    if(!party){party={id:uuid(),name,size,notes:clean(action.notes,300),arrivedAt:now,...equipment(action)};state.parties.push(party);}
    const block={id:uuid(),roomId:room.id,name,areas:room.areas,partyId:party.id,size,status:'held',createdAt:now,startsAt:now,endsAt:end,fromWaitlist};
    state.roomBlocks=[...(state.roomBlocks||[]).filter(b=>['held','in_use'].includes(b.status)).slice(-20),block];
    Object.assign(party,{status:'reserved',roomBlock:block.id});
    for(const t of room.tables)Object.assign(t,{status:'reserved',roomBlock:block.id,group:block.id,party:party.id,seatedAt:null});
  } else if(type==='seatRoom'||type==='releaseRoom') {
    const block=activeRoomBlocks(state).find(b=>b.id===action.id);if(!block)fail('This room booking has already ended.');
    const tables=state.tables.filter(t=>t.roomBlock===block.id),party=state.parties.find(p=>p.id===block.partyId);
    if(!party||!tables.length)fail('Room booking is incomplete. Please reload.');
    if(type==='seatRoom'){
      if(tables.some(t=>areaClosed(state,t.area)))fail('Reopen this section before seating the room booking.');
      if(block.status!=='held')fail('This room is already in use.');
      block.status='in_use';block.seatedAt=now;
      Object.assign(party,{status:'seated',seatedAt:now,tables:tables.map(t=>t.id)});
      for(const t of tables)Object.assign(t,{status:'in_use',seatedAt:now});
    }else{
      if(!['open','cleaning'].includes(action.status))fail('Choose open or cleaning when releasing a room.');
      const wasHeld=block.status==='held';block.status='released';block.closedAt=now;
      party.status=wasHeld?(block.fromWaitlist?'waiting':'cancelled'):'completed';
      if(party.status!=='waiting')party.closedAt=now;delete party.roomBlock;
      for(const t of tables)Object.assign(t,{status:action.status,roomBlock:null,group:null,party:null,seatedAt:null,cleaningAt:action.status==='cleaning'?now:null});
    }
  } else if(type==='waitSettings') {
    if(action.automatic===true)delete state.waitSettings;
    else{if(!integer(action.diningMinutes,15,180)||!integer(action.cleaningMinutes,0,30))fail('Use 15–180 minutes for dining and 0–30 minutes for cleaning.');state.waitSettings={diningMinutes:action.diningMinutes,cleaningMinutes:action.cleaningMinutes};}
  } else if(type==='presetCombinations') {
    presetCombinations(state,true);
  } else if(type==='guestSettings') {
    if(typeof action.enabled!=='boolean'||!integer(action.maxPartySize,1,30))fail('Choose a maximum party size from 1 to 30.');
    state.guestSettings={enabled:action.enabled,maxPartySize:action.maxPartySize};
  } else if(type==='readyParty') {
    const party=state.parties.find(p=>p.id===action.id&&p.status==='waiting');
    if(!party)fail('This party is no longer waiting.');
    party.readyAt=now;
  } else if(type==='addParty') {
    const name=clean(action.name,80), size=Number(action.size), notes=clean(action.notes,300);
    if(!name || !integer(size,1,100)) fail('Enter a name and party size between 1 and 100.');
    if(state.parties.filter(p=>p.status==='waiting').length>=200) fail('The waiting list is full.');
    const party={id:uuid(),name,size,notes,...equipment(action),arrivedAt:now,status:'waiting'};
    state.parties.push(party);party.waitQuote=quoteForParty(state,party,now);
  } else if(type==='editParty') {
    const party=state.parties.find(p=>p.id===action.id && p.status==='waiting');
    if(!party) fail('This party is no longer waiting.');
    const name=clean(action.name,80),size=Number(action.size);
    if(!name || !integer(size,1,100)) fail('Enter a name and party size between 1 and 100.');
    Object.assign(party,{name,size,notes:clean(action.notes,300),...equipment(action,party)});
  } else if(type==='cancelParty') {
    const party=state.parties.find(p=>p.id===action.id && p.status==='waiting');
    if(!party) fail('This party is no longer waiting.');
    party.status='cancelled';party.closedAt=now;
  } else if(type==='seatNow') {
    const size=Number(action.size);if(!integer(size,1,100))fail('Enter a party size between 1 and 100.');
    const tables=selectedTables(state,action.ids),plan=planWaitlist(state,now);
    if(tables.some(t=>(plan.available.get(t.id)??Infinity)>0))fail('These tables are occupied, held, or planned for waiting guests. Choose another recommendation.');
    const party={id:uuid(),name:clean(action.name,80)||'Walk-in',size,notes:clean(action.notes,300),...equipment(action),arrivedAt:now,status:'waiting',source:'seat-now'};
    state.parties.push(party);
    const seated=applyAction(state,{type:'seat',partyId:party.id,ids:action.ids,boothAcknowledged:action.boothAcknowledged,childOverride:action.childOverride},role,now,uuid);
    seated.history[0].type='seatNow';return seated;
  } else if(type==='seat') {
    const party=state.parties.find(p=>p.id===action.partyId && p.status==='waiting');
    if(!party) fail('This party has already been seated or removed.');
    if(party.attendance==='away')fail('Return this guest to waiting before seating.');
    const tables=selectedTables(state,action.ids);combineCheck(state,tables);
    const timing=waitSettings(state);if(protectsBooking(state,tables,now,now+(timing.diningMinutes+timing.cleaningMinutes)*60000))fail('These tables are needed for an upcoming room booking. Use Room bookings or choose other tables.');
    if(tables.some(t=>!t.capacity)) fail('Set the capacity for these booths before assigning a party.');
    if(includesBoothCombination(tables)&&action.boothAcknowledged!==true)fail('Confirm the booth combination notice before seating.');
    const short=tables.reduce((n,t)=>n+t.capacity,0)<party.size;
    if(short&&!(action.childOverride===true&&childBoothFit(tables,party.size)))fail('These tables do not have enough seats for this party.');
    if(short)party.childOverride={extraGuests:1,reason:'Small child at booth',confirmedAt:now};
    const group=tables.length>1?uuid():null;
    for(const t of tables) Object.assign(t,{status:'in_use',group,party:party.id,seatedAt:now});
    Object.assign(party,{status:'seated',seatedAt:now,tables:tables.map(t=>t.id)});
  } else if(type==='combine') {
    const tables=selectedTables(state,action.ids);if(tables.length<2) fail('Select at least two tables.');combineCheck(state,tables,action.combinationOverride===true);
    if(tables.some(t=>t.roomBlock))fail('Manage this whole-room block from Room bookings.');
    const timing=waitSettings(state);if(protectsBooking(state,tables,now,now+(timing.diningMinutes+timing.cleaningMinutes)*60000))fail('These tables are needed for an upcoming room booking.');
    if(includesBoothCombination(tables)&&action.boothAcknowledged!==true)fail('Confirm the booth combination notice before combining.');
    const group=uuid();for(const t of tables)t.group=group;
  } else if(type==='split') {
    const tables=selectedTables(state,action.ids);completeGroups(state,tables);
    if(tables.some(t=>t.roomBlock))fail('Manage this whole-room block from Room bookings.');
    if(tables.some(t=>t.status==='in_use')) fail('Clear the party before separating tables.');
    for(const t of tables)t.group=null;
  } else if(type==='status') {
    if(!['open','in_use','cleaning'].includes(action.status)) fail('Choose a valid status.');
    const tables=selectedTables(state,action.ids);completeGroups(state,tables);
    if(action.status==='in_use'&&tables.some(t=>areaClosed(state,t.area)))fail('This section is closed. Reopen it before seating.');
    if(tables.some(t=>t.roomBlock))fail('Manage this whole-room block from Room bookings.');
    const timing=waitSettings(state);if(action.status==='in_use'&&protectsBooking(state,tables,now,now+(timing.diningMinutes+timing.cleaningMinutes)*60000))fail('These tables are needed for an upcoming room booking.');
    if(action.status!=='in_use'){
      const recorded=new Set();
      for(const t of tables.filter(t=>t.status==='in_use'&&!t.party&&t.seatedAt)){
        const key=(t.group||t.id)+'|'+t.seatedAt;if(recorded.has(key))continue;recorded.add(key);
        const minutes=(now-t.seatedAt)/60000;if(minutes>=15&&minutes<=180)state.diningSamples=[...(state.diningSamples||[]),{minutes,closedAt:now}].slice(-60);
      }
    }
    for(const t of tables) {
      if(t.party && action.status!=='in_use') {
        const p=state.parties.find(p=>p.id===t.party);if(p){p.status='completed';p.closedAt=now;}
      }
      if(action.status!=='in_use'){t.party=null;t.seatedAt=null;}
      else if(t.status!=='in_use')t.seatedAt=now;
      if(action.status==='cleaning'&&t.status!=='cleaning')t.cleaningAt=now;
      if(action.status!=='cleaning')t.cleaningAt=null;
      t.status=action.status;
    }
  } else if(type==='addTable' || type==='layout') {
    const table=type==='addTable'?{id:uuid(),status:'open',group:null,party:null,seatedAt:null,allowed:[]}:state.tables.find(t=>t.id===action.id);
    if(!table)fail('Table not found.');
    if(table.status!=='open'||table.group)fail('Open and separate this table before changing its layout.');
    const v=action.table || {};if([...activeRoomBlocks(state),...scheduledRooms(state).filter(b=>b.endsAt>now)].some(b=>b.areas.includes(v.area)||b.areas.includes(table.area)))fail('Release this room booking before changing its layout.');const number=clean(v.number,12),capacity=v.capacity===''||v.capacity===null?null:Number(v.capacity);
      if(!number||!areaOptions(state).some(a=>a.id===v.area)||!['table','booth'].includes(v.kind)||!['lr','tb'].includes(v.orientation))fail('Complete the table details.');
    if(capacity!==null&&!integer(capacity,1,20))fail('Capacity must be between 1 and 20.');
    if(v.kind==='table'&&capacity===null)fail('Enter the number of chairs.');
    if(!Number.isFinite(v.x)||!Number.isFinite(v.y)||v.x<30||v.x>1630||v.y<30||v.y>920)fail('Keep the table inside the floor plan.');
    if(state.tables.some(t=>t.id!==table.id&&t.area===v.area&&t.number===number))fail('That table number already exists in this area.');
    const allowed=[...new Set(Array.isArray(v.allowed)?v.allowed:[])];
    if(allowed.some(id=>!state.tables.some(t=>t.id===id&&t.id!==table.id&&t.area===v.area&&!(v.kind==='booth'&&t.kind==='booth'))))fail('Combine a booth with a table, or tables in the same area.');
    if(state.tables.some(t=>(table.allowed.includes(t.id)||allowed.includes(t.id))&&(t.status!=='open'||t.group)))fail('Open and separate linked tables before changing their combinations.');
    for(const t of state.tables) t.allowed=t.allowed.filter(id=>id!==table.id);
    Object.assign(table,{number,area:v.area,kind:v.kind,orientation:v.orientation,capacity,x:v.x,y:v.y,allowed});
    for(const t of state.tables) if(allowed.includes(t.id))t.allowed.push(table.id);
    if(type==='addTable'){if(state.tables.length>=200)fail('Maximum 200 tables.');state.tables.push(table);}
  } else if(type==='removeTable') {
    const tables=selectedTables(state,[action.id]);
    if(scheduledRooms(state).some(b=>b.endsAt>now&&b.areas.includes(tables[0].area)))fail('Cancel upcoming room bookings before removing a room table.');
    if(tables[0].status!=='open'||tables[0].group)fail('Open and separate this table before removing it.');
    state.tables=state.tables.filter(t=>t.id!==action.id);for(const t of state.tables)t.allowed=t.allowed.filter(id=>id!==action.id);
  } else if(type==='cleanPlan') {
    if(!state.background)fail('Upload a floor plan before cleaning it.');
    if(!Array.isArray(action.covers)||action.covers.length>300)fail('Use no more than 300 covers.');
    state.background.covers=action.covers.map(r=>{
      if(!r||['x','y','width','height'].some(k=>typeof r[k]!=='number'||!Number.isFinite(r[k]))||r.x<0||r.y<0||r.width<1||r.height<1||r.x+r.width>1660||r.y+r.height>950)fail('Keep every cover inside the floor plan.');
      return {x:r.x,y:r.y,width:r.width,height:r.height};
    });
  } else if(type==='background') {
    state.background=action.background;
  } else fail('Unknown action.');
  state.history.unshift({type,at:now});state.history=state.history.slice(0,100);
  const active=state.parties.filter(p=>['waiting','seated','reserved'].includes(p.status));
  const closed=state.parties.filter(p=>!['waiting','seated','reserved'].includes(p.status)&&now-(p.closedAt||now)<86400000).slice(-200);
  state.parties=[...active,...closed];
  return state;
}
