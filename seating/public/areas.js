import {AREAS} from './floor.js';
const legacyRooms={'Rose City':'rose','Azalea Trail':'azalea','Piney Woods':'piney'};
// IDs stay stable when names change, so tables and bookings keep their assignments.
export function areaOptions(state){
 if(Array.isArray(state?.areaConfig))return state.areaConfig;
 const ids=state?.background?.imported?[...new Set((state.tables||[]).map(t=>t.area))]:AREAS;
 return ids.map(id=>({id,name:id,kind:legacyRooms[id]?'room':'section'}));
}
export const areaName=(state,id)=>areaOptions(state).find(a=>a.id===id)?.name||id;
export function roomCombinations(state){
 if(Array.isArray(state?.roomCombinations))return state.roomCombinations;
 const rooms=areaOptions(state).filter(a=>a.kind==='room');
 return ['Rose City','Azalea Trail'].every(id=>rooms.some(a=>a.id===id))?[{id:'combined',areas:['Rose City','Azalea Trail']}]:[];
}
export function roomOptions(state){
 const areas=areaOptions(state),single=areas.filter(a=>a.kind==='room').map(a=>({id:legacyRooms[a.id]||`room:${a.id}`,name:a.name,areas:[a.id]}));
 const combined=roomCombinations(state).filter(c=>c.areas.every(id=>areas.some(a=>a.id===id&&a.kind==='room'))).map(c=>({...c,name:c.areas.map(id=>areaName(state,id)).join(' + ')}));
 return [...single,...combined];
}
