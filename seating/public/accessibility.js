import {areaOptions} from './areas.js';
export const preferredAreas=state=>new Set(areaOptions(state).filter(a=>a.accessiblePreferred===true).map(a=>a.id));
export const preferredSeating=(tables,areas)=>tables.length>0&&tables.every(t=>areas.has(t.area));
