import {AppError} from './model.js';
export const OFFLINE_MESSAGE='Online check-in is temporarily unavailable. Please see the host to join the waitlist.';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export const hubRow=(env,id)=>env.DB.prepare('SELECT * FROM seating_hubs WHERE location_id=?').bind(id).first();
export const hubOnline=(hub,now=Date.now())=>!!hub?.enabled&&now-hub.last_seen<10000;
export function hubStatus(hub){return hub?.enabled?{mode:'local',online:hubOnline(hub),lastSeen:hub.last_seen,localUrl:hub.local_url}:null;}
export async function configureHub(request,env,id,profile){
 if(!profile.system_admin)throw new AppError('System administrator access required.',403);
 const existing=await hubRow(env,id);
 if(request.method==='GET')return json({configured:!!existing,enabled:!!existing?.enabled,online:hubOnline(existing),localUrl:existing?.local_url});
 if(request.method!=='POST')throw new AppError('Method not allowed.',405);
 if(existing)throw new AppError('A local server is already registered. Reuse its configuration; contact the administrator for recovery.',409);
 const body=await request.json();let localUrl;
 try{const url=new URL(body.localUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error();localUrl=url.origin;}catch{throw new AppError('Enter the Pi’s HTTPS address without a path or password.');}
 const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 await env.DB.prepare('INSERT INTO seating_hubs(location_id,token_hash,local_url,created_by) VALUES(?,?,?,?)').bind(id,await digest(token),localUrl,profile.id).run();
 return json({locationId:id,token,localUrl,cloudUrl:new URL(request.url).origin});
}
export async function relaySave(env,id,expectedVersion,state,requestId,waitMs=8000){
 const hub=await hubRow(env,id);if(!hub?.enabled)return null;
 if(!hubOnline(hub))throw new AppError('Restaurant is offline — host check-in only. Changes are available on the restaurant Wi-Fi.',503);
 const key=requestId||crypto.randomUUID(),now=Date.now();
 const queued=await env.DB.prepare('SELECT * FROM seating_commands WHERE id=?').bind(key).first();
 if(queued&&(queued.location_id!==id||queued.expected_version!==expectedVersion||queued.state_json!==JSON.stringify(state)))throw new AppError('This request ID was already used for another change.',409);
 if(!queued)await env.DB.prepare('INSERT OR IGNORE INTO seating_commands(id,location_id,expected_version,state_json,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(key,id,expectedVersion,JSON.stringify(state),now,now+waitMs).run();
 do{
  const command=await env.DB.prepare('SELECT status,response_json FROM seating_commands WHERE id=?').bind(key).first();
  if(command?.response_json){const result=JSON.parse(command.response_json);if(result.error)throw new AppError(result.error,result.status||409);return json(result);}
  if(command?.status==='expired')break;
  if(waitMs<=0)break;
  await new Promise(resolve=>setTimeout(resolve,250));
 }while(Date.now()-now<waitMs);
 // Commands must also check their expiry on the Pi. A lost response is never a success message.
 await env.DB.prepare("UPDATE seating_commands SET status='expired' WHERE id=? AND status='pending'").bind(key).run();
 throw new AppError('The restaurant did not confirm this change. Check the latest list with the host before trying again.',503);
}
async function authorizedHub(request,env,id){
 const row=await hubRow(env,id),token=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!row||!token||await digest(token)!==row.token_hash)throw new AppError('Local server authorization failed.',401);
 return row;
}
export async function hubApi(request,env,url){
 const match=url.pathname.match(/^\/api\/hub\/([^/]+)(\/media)?$/);if(!match)throw new AppError('Not found.',404);
 const id=decodeURIComponent(match[1]),hub=await authorizedHub(request,env,id);
 const location=await env.DB.prepare('SELECT id,name FROM locations WHERE id=? AND active=1').bind(id).first();if(!location)throw new AppError('Restaurant is disabled.',403);
 if(match[2]){
  const key=url.searchParams.get('key');if(!key?.startsWith(`seating/${id}/`)||key.length>200)throw new AppError('Invalid floor plan key.');
  if(request.method==='GET'){const object=await env.MEDIA.get(key);if(!object)throw new AppError('Floor plan not found.',404);return new Response(object.body,{headers:{'content-type':object.httpMetadata?.contentType||'image/png'}});}
  if(request.method==='PUT'){
   const bytes=new Uint8Array(await request.arrayBuffer()),type=request.headers.get('content-type');
   if(bytes.length>12*1024*1024)throw new AppError('Floor plan too large.',413);
   if(!((type==='image/png'&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)||(type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)||(type==='image/webp'&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')))throw new AppError('Invalid floor plan.');
   await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:type}});return json({ok:true});
  }
  throw new AppError('Method not allowed.',405);
 }
 if(request.method==='POST'){
  const text=await request.text();if(text.length>2*1024*1024)throw new AppError('Sync payload too large.',413);let body;try{body=JSON.parse(text);}catch{throw new AppError('Invalid sync.');}
  const row=await env.DB.prepare('SELECT version,state_json FROM seating_state WHERE location_id=?').bind(id).first();if(!row)throw new AppError('Open this store’s seating chart online before pairing.',409);
  if(body.activate){
   if(hub.enabled)return json({ok:true,enabled:true});
   if(body.version!==row.version||body.stateHash!==await digest(row.state_json))throw new AppError('Cloud state changed. Bootstrap the Pi again before activation.',409);
   const result=await env.DB.prepare('UPDATE seating_hubs SET enabled=1,last_seen=?,synced_version=? WHERE location_id=? AND enabled=0 AND EXISTS(SELECT 1 FROM seating_state WHERE location_id=? AND version=?)').bind(Date.now(),body.version,id,id,body.version).run();
   if(result.meta.changes!==1)throw new AppError('Cloud state changed. Bootstrap again.',409);
   return json({ok:true,enabled:true});
  }
  if(!hub.enabled)throw new AppError('Activate this local server first.',409);
  if(!Number.isSafeInteger(body.version)||body.version<row.version||body.version>row.version&&!body.state||body.state&&(!Array.isArray(body.state.tables)||!Array.isArray(body.state.parties))||!Array.isArray(body.results)||body.results.length>20)throw new AppError('Local data is older than the cloud or malformed. Administrator recovery is required.',409);
  const snapshot=body.state?JSON.stringify(body.state):row.state_json;
  if(body.version===row.version&&body.state&&snapshot!==JSON.stringify(JSON.parse(row.state_json)))throw new AppError('State differs at the same version. Administrator recovery is required.',409);
  if(body.version>row.version)await env.DB.prepare("UPDATE seating_state SET state_json=?,version=?,updated_by='local-server',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location_id=? AND version<?").bind(snapshot,body.version,id,body.version).run();
  for(const result of body.results){
   if(typeof result.id!=='string'||!result.response||JSON.stringify(result.response).length>2*1024*1024)throw new AppError('Invalid command result.');
   await env.DB.prepare("UPDATE seating_commands SET status='completed',response_json=? WHERE id=? AND location_id=?").bind(JSON.stringify(result.response),result.id,id).run();
  }
  await env.DB.prepare('UPDATE seating_hubs SET last_seen=?,synced_version=? WHERE location_id=?').bind(Date.now(),body.version,id).run();
  await env.DB.prepare('DELETE FROM seating_commands WHERE location_id=? AND created_at<?').bind(id,Date.now()-86400000).run();
  return json({ok:true});
 }
 if(request.method!=='GET')throw new AppError('Method not allowed.',405);
 const row=await env.DB.prepare('SELECT version,state_json FROM seating_state WHERE location_id=?').bind(id).first();
 if(!row)throw new AppError('Open this store’s seating chart online before pairing.',409);
 const roster=await env.DB.prepare("SELECT u.id,u.auth_user_id,u.email,u.display_name,u.system_admin,CASE WHEN u.system_admin=1 THEN 'admin' ELSE g.role END AS role FROM user_profiles u LEFT JOIN seating_grants g ON g.user_id=u.id AND g.location_id=? WHERE u.active=1 AND (u.system_admin=1 OR g.role IS NOT NULL)").bind(id).all();
 const commands=await env.DB.prepare("SELECT id,expected_version,state_json,expires_at FROM seating_commands WHERE location_id=? AND status='pending' ORDER BY created_at LIMIT 20").bind(id).all();
 const rosterHash=await digest(JSON.stringify(roster.results));
 return json({enabled:!!hub.enabled,location,version:row.version,...(!hub.enabled||url.searchParams.get('since')!==String(row.version)?{state:JSON.parse(row.state_json)}:{}),stateHash:await digest(row.state_json),...(url.searchParams.get('roster')!==rosterHash?{roster:roster.results}:{}),commands:commands.results,localUrl:hub.local_url});
}
