import {AppError,applyAction} from './model.js';
import {hubRow,hubOnline,OFFLINE_MESSAGE} from './hub.js';
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const settings=state=>({enabled:state?.guestSettings?.enabled===true,maxPartySize:state?.guestSettings?.maxPartySize||12});
function ownParty(state,tokenHash){return state?.parties?.filter(p=>p.guestTokenHash===tokenHash).sort((a,b)=>b.arrivedAt-a.arrivedAt)[0]||null;}
function visibleParty(p){return p?{name:p.name,size:p.size,status:p.status,ready:!!p.readyAt,arrivedAt:p.arrivedAt}:null;}
export async function guestApi(request,env,ctx,url,{json,readBody,cookies,saveState}){
 const match=url.pathname.match(/^\/api\/guest\/([^/]+)$/);if(!match)throw new AppError('Not found.',404);
 const id=decodeURIComponent(match[1]);
 const location=await env.DB.prepare('SELECT id,name FROM locations WHERE id=? AND active=1').bind(id).first();
 if(!location)throw new AppError('Restaurant not found.',404);
 const cookieName='guest_'+(await hash(id)).slice(0,16);
 let token=cookies(request)[cookieName];
 if(!/^[a-f0-9]{64}$/.test(token||'')){
   if(request.method!=='GET')throw new AppError('Please reload this page and allow cookies before joining.',400);
   token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
   ctx.cookies.push(`${cookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/guest/; Max-Age=86400`);
 }
 const tokenHash=await hash(token);
 const body=request.method==='POST'?await readBody(request):null;
 if(request.method==='POST'&&(!body||typeof body!=='object'||Array.isArray(body)))throw new AppError('Invalid request.');
 if(!['GET','POST'].includes(request.method))throw new AppError('Method not allowed.',405);
 for(let attempt=0;attempt<4;attempt++){
   const row=await env.DB.prepare('SELECT version,state_json FROM seating_state WHERE location_id=?').bind(id).first();
   let state=row?JSON.parse(row.state_json):null;
   const config=settings(state),own=ownParty(state,tokenHash);
   const hub=await hubRow(env,id),offline=!!env.localIdentity||!!hub?.enabled&&!hubOnline(hub);
   if(request.method==='GET')return json({location:location.name,...config,enabled:config.enabled&&!offline,offline,message:offline?OFFLINE_MESSAGE:null,party:visibleParty(own)});
   if(!state)throw new AppError('Online check-in is closed. Please see the host.',409);
   const now=Date.now();
   if(body.action==='cancel'){
     if(!own||own.status!=='waiting')throw new AppError('This party is no longer waiting.',409);
     state=applyAction(state,{type:'cancelParty',id:own.id},'host',now);
   }else if(body.action==='join'){
     // Same-browser retries are idempotent, including after a lost response.
     if(own&&['waiting','seated','reserved'].includes(own.status))return json({party:visibleParty(own),alreadyJoined:true});
     if(offline)throw new AppError(OFFLINE_MESSAGE,503);
     if(!config.enabled)throw new AppError('Online check-in is closed. Please see the host.',409);
     if(body.website||typeof body.name!=='string'||!body.name.trim()||body.name.length>80||!Number.isInteger(body.size)||body.size<1||body.size>config.maxPartySize||typeof body.notes!=='string'||body.notes.length>300)throw new AppError(`Enter your name and a party size from 1 to ${config.maxPartySize}.`);
     const ipHash=await hash(id+':'+(request.headers.get('CF-Connecting-IP')||'local'));
     const recent=(state.guestJoins||[]).filter(j=>now-j.at<3600000),same=recent.filter(j=>j.ipHash===ipHash);
     if(same.length>=120||same.filter(j=>now-j.at<600000).length>=30||same.some(j=>now-j.at<3000)||recent.filter(j=>now-j.at<600000).length>=60)throw new AppError('Too many check-ins. Please see the host or try again later.',429);
     const partyId=crypto.randomUUID();
     state=applyAction(state,{type:'addParty',name:body.name,size:body.size,notes:body.notes,highChair:body.highChair,booster:body.booster,accessibility:body.accessibility},'host',now,()=>partyId);
     Object.assign(state.parties.find(p=>p.id===partyId),{source:'qr',guestTokenHash:tokenHash});
     state.guestJoins=[...recent,{ipHash,at:now}];
   }else throw new AppError('Invalid request.');
   if(hub?.enabled){
     const response=await saveState(id,row,state),result=await response.json();
     return json({party:visibleParty(ownParty(result.state,tokenHash))});
   }
   const result=await env.DB.prepare("UPDATE seating_state SET state_json=?,version=version+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location_id=? AND version=? AND NOT EXISTS(SELECT 1 FROM seating_hubs WHERE location_id=? AND enabled=1)").bind(JSON.stringify(state),'guest-check-in',id,row.version,id).run();
   if(result.meta.changes===1)return json({party:visibleParty(ownParty(state,tokenHash))});
 }
 throw new AppError('The host is updating the list. Please try again.',409);
}
