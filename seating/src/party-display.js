import {AppError} from './model.js';
import {hubRow,hubOnline,OFFLINE_MESSAGE} from './hub.js';
import {roomDisplayState} from '../public/room-display-state.js';

// A display link grants read-only room signage access, never staff access.
export async function partyDisplayApi(request,env,url,json){
 if(request.method!=='GET')throw new AppError('Method not allowed.',405);
 const id=decodeURIComponent(url.pathname.slice('/api/party-display/'.length));
 const location=await env.DB.prepare('SELECT id,name FROM locations WHERE id=? AND active=1').bind(id).first();
 if(!location)throw new AppError('Restaurant not found.',404);
 const row=await env.DB.prepare('SELECT version,state_json FROM seating_state WHERE location_id=?').bind(id).first();
 const state=row?JSON.parse(row.state_json):null;
 if(!state?.partyDisplay?.enabled||!state.partyDisplay.key||request.headers.get('x-party-display-key')!==state.partyDisplay.key)throw new AppError('Display link is inactive. Ask a manager to enable Party Display and open a current room link.',403);
 const hub=await hubRow(env,id);
 if(!env.localIdentity&&hub?.enabled&&!hubOnline(hub))throw new AppError(OFFLINE_MESSAGE,503);
 if(env.localRuntime?.().requiresRecovery)throw new AppError(OFFLINE_MESSAGE,503);
 const now=Date.now(),view=roomDisplayState(state,url.searchParams.get('room'),now);
 if(!view.room)throw new AppError('Room no longer exists. Ask a manager for a new display link.',404);
 const booking=b=>b?{name:b.name,startsAt:b.startsAt,endsAt:b.endsAt}:null;
 return json({location:location.name,serverTime:now,view:{status:view.status,baseStatus:view.room.areas.some(a=>state.closedAreas?.[a])?'closed':'open',room:{id:view.room.id,name:view.room.name},booking:booking(view.booking),next:booking(view.next)}});
}
