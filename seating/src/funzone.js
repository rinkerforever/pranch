import {AppError,applyAction} from './model.js';
import {hubRow,hubOnline,OFFLINE_MESSAGE} from './hub.js';
import {areaName} from '../public/areas.js';

async function visitKey(secret,t){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify([t.id,t.seatedAt,t.party,t.group])))),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function funzoneApi(request,env,url,{json,readBody,saveState}){
 const id=decodeURIComponent(url.pathname.slice('/api/funzone/'.length));
 const location=await env.DB.prepare('SELECT id,name FROM locations WHERE id=? AND active=1').bind(id).first();
 if(!location)throw new AppError('Restaurant not found.',404);
 if(!['GET','POST'].includes(request.method))throw new AppError('Method not allowed.',405);
 const row=await env.DB.prepare('SELECT version,state_json FROM seating_state WHERE location_id=?').bind(id).first();
 const state=row?JSON.parse(row.state_json):null;
 if(!state?.funZoneKey||request.headers.get('x-funzone-key')!==state.funZoneKey)throw new AppError('Scan the Fun Zone QR code at your table.',403);
 const hub=await hubRow(env,id);
 if(env.localIdentity||hub?.enabled&&!hubOnline(hub))throw new AppError(OFFLINE_MESSAGE,503);
 if(request.method==='GET')return json({location:location.name,tables:await Promise.all(state.tables.map(async t=>({id:t.id,label:/^[A-Z]+\d/i.test(t.number)?t.number:`${areaName(state,t.area)}-${t.number}`,visit:await visitKey(state.funZoneKey,t)})))});
 const body=await readBody(request),t=state.tables.find(t=>t.id===body?.table);
 if(!t||t.status!=='in_use'||!t.seatedAt||body.visit!==await visitKey(state.funZoneKey,t))throw new AppError('This table visit has changed. Scan again or see the host.',409);
 if(!['enter','back','status'].includes(body.action))throw new AppError('Choose a Fun Zone action.');
 if(body.action==='status')return json({since:t.funZoneSince||null});
 const ids=state.tables.filter(x=>x.id===t.id||(t.group&&x.group===t.group)).map(x=>x.id);
 if((body.action==='enter'&&t.funZone&&t.funZoneSince)||(body.action==='back'&&!t.funZone))return json({since:t.funZoneSince||null});
 const next=applyAction(state,{type:'funZone',ids,active:body.action==='enter'},'host');
 // Use the normal atomic save / Pi relay. Never claim success before the authority confirms it.
 const response=await saveState(id,row,next),result=await response.json();
 return json({since:result.state.tables.find(x=>x.id===t.id)?.funZoneSince||null});
}
