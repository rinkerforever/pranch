import {WALL_PATH} from './floor.js';
// Walls in the built-in plan use only M/L/H/V segments.
function wallSegments(path){
 const tokens=path.match(/[MLHV]|-?\d+(?:\.\d+)?/g)||[];let x=0,y=0;const result=[];
 for(let i=0;i<tokens.length;){const cmd=tokens[i++];let nx=x,ny=y;
  if(cmd==='M'||cmd==='L'){nx=Number(tokens[i++]);ny=Number(tokens[i++]);}
  else if(cmd==='H')nx=Number(tokens[i++]);else if(cmd==='V')ny=Number(tokens[i++]);else throw new Error('Unsupported wall command');
  if(cmd!=='M')result.push([{x,y},{x:nx,y:ny}]);x=nx;y=ny;
 }return result;
}
const walls=wallSegments(WALL_PATH);
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function intersects(a,b,c,d){
 const on=(p,q,r)=>Math.abs(cross(p,q,r))<.001&&r.x>=Math.min(p.x,q.x)&&r.x<=Math.max(p.x,q.x)&&r.y>=Math.min(p.y,q.y)&&r.y<=Math.max(p.y,q.y);
 return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
}
export function nearbyPairs(tables){
 const pairs=[];
 for(let i=0;i<tables.length;i++)for(const b of tables.slice(i+1)){
  const a=tables[i],dx=Math.abs(a.x-b.x),dy=Math.abs(a.y-b.y),distance=Math.hypot(dx,dy);
  if(a.area!==b.area||a.kind==='booth'&&b.kind==='booth'||distance<1||distance>105||Math.min(dx,dy)>30)continue;
  if(walls.some(([c,d])=>intersects(a,b,c,d)))continue;
  // Do not skip over an intervening table in a row or column.
  if(tables.some(t=>t!==a&&t!==b&&t.area===a.area&&Math.hypot(t.x-a.x,t.y-a.y)+Math.hypot(t.x-b.x,t.y-b.y)<distance+8))continue;
  pairs.push([a,b]);
 }return pairs;
}
export function presetCombinations(state,force=false){
 if(state.combinationVersion===1&&!force)return state;
 // An uploaded plan has unknown walls; a manager can explicitly request presets.
 if(!state.background||force)for(const [a,b] of nearbyPairs(state.tables)){
  if(!a.allowed.includes(b.id))a.allowed.push(b.id);
  if(!b.allowed.includes(a.id))b.allowed.push(a.id);
 }
 state.combinationVersion=1;return state;
}
export const includesBoothCombination=tables=>tables.length>1&&tables.some(t=>t.kind==='booth');
export const childBoothFit=(tables,size)=>tables.length===1&&tables[0].kind==='booth'&&!!tables[0].capacity&&size===tables[0].capacity+1;
// Use the floor's typical nearest-table spacing, not table numbers or approved-link chains.
export function withinCombinationDistance(selected,all){
 const positioned=t=>Number.isFinite(t.x)&&Number.isFinite(t.y);
 const peers=all.filter(t=>t.area===selected[0]?.area&&positioned(t));
 const distances=peers.map(a=>Math.min(...peers.filter(b=>b.id!==a.id).map(b=>Math.hypot(a.x-b.x,a.y-b.y)).filter(d=>d>0))).filter(Number.isFinite).sort((a,b)=>a-b);
 const spacing=distances.length?Math.min(105,distances[Math.floor(distances.length/2)]):80;
 return selected.every(a=>selected.every(b=>!positioned(a)||!positioned(b)||Math.hypot(a.x-b.x,a.y-b.y)<=2*spacing+1));
}
