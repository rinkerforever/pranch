import {presetCombinations} from '../public/combinations.js';
import {guestApi} from './guest.js';
import qrcode from 'qrcode-generator';
import { upgradeNumbering } from '../public/floor.js';
import { initialState, applyAction, AppError } from './model.js';
import {hubApi,hubRow,hubStatus,configureHub,relaySave} from './hub.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const cookie=(name,value,age)=>`${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;
function cookies(request){return Object.fromEntries((request.headers.get('cookie')||'').split(';').map(v=>{const i=v.indexOf('=');return [v.slice(0,i).trim(),decodeURIComponent(v.slice(i+1))];}));}
const secureHeaders={
  'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',
  'permissions-policy':'camera=(), microphone=(), geolocation=()',
};
async function authFetch(env,path,body,token){return fetch(`${env.SUPABASE_URL}/auth/v1/${path}`,{method:body?'POST':'GET',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,...(token?{authorization:`Bearer ${token}`} : {}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
function setSession(ctx,data){ctx.cookies.push(cookie('seat_access',data.access_token,data.expires_in||3600),cookie('seat_refresh',data.refresh_token,604800));}
async function identity(request,env,ctx){
  if(env.localIdentity)return env.localIdentity(request);
  const c=cookies(request);let user=null;
  if(c.seat_access){const r=await authFetch(env,'user',null,c.seat_access);if(r.ok)user=await r.json();}
  if(!user&&c.seat_refresh){const r=await authFetch(env,'token?grant_type=refresh_token',{refresh_token:c.seat_refresh});if(r.ok){const data=await r.json();user=data.user;setSession(ctx,data);}}
  if(!user)throw new AppError('Please sign in again.',401);
  const profile=await env.DB.prepare('SELECT id,auth_user_id,email,display_name,system_admin FROM user_profiles WHERE auth_user_id=? AND active=1').bind(user.id).first();
  if(!profile)throw new AppError('This account is disabled or has no restaurant access.',403);
  return profile;
}
async function readBody(request){if(Number(request.headers.get('content-length'))>65536)throw new AppError('Request is too large.',413);const text=await request.text();if(text.length>65536)throw new AppError('Request is too large.',413);try{return JSON.parse(text);}catch{throw new AppError('Invalid request.');}}
async function roleFor(env,profile,id){
  const loc=await env.DB.prepare('SELECT id,name FROM locations WHERE id=? AND active=1').bind(id).first();
  if(!loc)throw new AppError('Location not found.',404);
  if(profile.system_admin)return 'admin';
  const row=await env.DB.prepare('SELECT role FROM seating_grants WHERE user_id=? AND location_id=?').bind(profile.id,id).first();
  if(!row)throw new AppError('A restaurant administrator must grant you seating access.',403);
  return row.role;
}
async function loadState(env,id,profile){
  const existing=await env.DB.prepare('SELECT version,state_json,updated_at FROM seating_state WHERE location_id=?').bind(id).first();
  if(existing)return {...existing,state_json:JSON.stringify(presetCombinations(upgradeNumbering(JSON.parse(existing.state_json))))};
  await env.DB.prepare('INSERT OR IGNORE INTO seating_state(location_id,version,state_json,updated_by) VALUES(?,0,?,?)').bind(id,JSON.stringify(initialState()),profile.id).run();
  return env.DB.prepare('SELECT version,state_json,updated_at FROM seating_state WHERE location_id=?').bind(id).first();
}
async function saveState(env,id,row,state,profile,requestId){
  if(!env.localIdentity){const relayed=await relaySave(env,id,row.version,state,requestId);if(relayed)return relayed;}
  const r=await env.DB.prepare("UPDATE seating_state SET state_json=?,version=version+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location_id=? AND version=? AND NOT EXISTS(SELECT 1 FROM seating_hubs WHERE location_id=? AND enabled=1)")
    .bind(JSON.stringify(state),profile.id,id,row.version,id).run();
  if(r.meta.changes!==1)throw new AppError('Another host updated this floor. The latest changes have been loaded; please try your action again.',409);
  return json({state,version:row.version+1});
}
async function api(request,env,ctx,url){
  if(url.pathname.startsWith('/api/hub/'))return hubApi(request,env,url);
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==url.origin)throw new AppError('Request origin is not allowed.',403);
  if(url.pathname==='/api/health')return json({ok:true,service:'pizza-ranch-seating',version:'1.0.0'});
  if(url.pathname==='/api/login'&&request.method==='POST'){
    const body=await readBody(request);if(typeof body.email!=='string'||typeof body.password!=='string'||body.email.length>254||body.password.length>256)throw new AppError('Enter your email and password.');
    const r=await authFetch(env,'token?grant_type=password',{email:body.email.trim(),password:body.password});
    if(!r.ok)throw new AppError(r.status===429?'Too many attempts. Please wait before trying again.':'Email or password is incorrect.',r.status===429?429:401);
    const data=await r.json();
    const profile=await env.DB.prepare('SELECT id FROM user_profiles WHERE auth_user_id=? AND active=1').bind(data.user.id).first();
    if(!profile)throw new AppError('This account has not been activated for Pizza Ranch.',403);
    setSession(ctx,data);return json({ok:true});
  }
  if(url.pathname==='/api/logout'&&request.method==='POST'){
    ctx.cookies.push(cookie('seat_access','',0),cookie('seat_refresh','',0));return json({ok:true});
  }
  if(url.pathname==='/api/runtime')return json(env.localRuntime?env.localRuntime():{mode:'cloud'});
  if(url.pathname.startsWith('/api/guest/'))return guestApi(request,env,ctx,url,{json,readBody,cookies,saveState:(id,row,state,requestId)=>saveState(env,id,row,state,{id:'guest-check-in'},requestId)});
  const profile=await identity(request,env,ctx);
  if(url.pathname==='/api/session'){
    const rows=profile.system_admin?await env.DB.prepare("SELECT id,name,'admin' AS role FROM locations WHERE active=1 ORDER BY name").all():await env.DB.prepare('SELECT l.id,l.name,g.role FROM locations l JOIN seating_grants g ON g.location_id=l.id WHERE l.active=1 AND g.user_id=? ORDER BY l.name').bind(profile.id).all();
    return json({profile,locations:rows.results});
  }
  if(url.pathname==='/api/staff'){
    if(env.localIdentity&&request.method!=='GET')throw new AppError('Manage account access through the cloud site.',403);
    if(!profile.system_admin)throw new AppError('System administrator access required.',403);
    if(request.method==='GET'){
      const users=await env.DB.prepare('SELECT id,email,display_name,system_admin FROM user_profiles WHERE active=1 ORDER BY display_name').all();
      const grants=await env.DB.prepare('SELECT user_id,location_id,role FROM seating_grants').all();return json({users:users.results,grants:grants.results});
    }
    if(request.method==='POST'){
      const body=await readBody(request);await roleFor(env,profile,body.locationId);
      const user=await env.DB.prepare('SELECT id FROM user_profiles WHERE id=? AND active=1').bind(body.userId).first();if(!user)throw new AppError('User not found.');
      if(body.role==='none')await env.DB.prepare('DELETE FROM seating_grants WHERE user_id=? AND location_id=?').bind(body.userId,body.locationId).run();
      else{if(!['manager','host','viewer'].includes(body.role))throw new AppError('Invalid role.');await env.DB.prepare('INSERT INTO seating_grants(user_id,location_id,role) VALUES(?,?,?) ON CONFLICT(user_id,location_id) DO UPDATE SET role=excluded.role').bind(body.userId,body.locationId,body.role).run();}
      return json({ok:true});
    }
  }
  const match=url.pathname.match(/^\/api\/locations\/([^/]+)\/(state|actions|floorplan|qr|hub)$/);
  if(!match)throw new AppError('Not found.',404);
  const id=decodeURIComponent(match[1]),resource=match[2],role=await roleFor(env,profile,id);
  if(resource==='hub'){if(env.localIdentity)throw new AppError('Pair local servers from the cloud site.',403);return configureHub(request,env,id,profile);}
  if(resource==='floorplan'&&request.method==='GET'){
    const row=await loadState(env,id,profile),state=JSON.parse(row.state_json);
    if(!state.background)throw new AppError('No uploaded floor plan.',404);
    const object=await env.MEDIA.get(state.background.key);if(!object)throw new AppError('Floor plan file not found.',404);
    return new Response(object.body,{headers:{'content-type':state.background.mime,'cache-control':'private, no-store'}});
  }
  if(resource==='qr'&&request.method==='GET'){
    const code=qrcode(0,'M');code.addData(`${env.publicCloudUrl||url.origin}/join.html?location=${encodeURIComponent(id)}`);code.make();
    return new Response(code.createSvgTag({cellSize:6,margin:24,scalable:true}),{headers:{'content-type':'image/svg+xml','cache-control':'private, no-store'}});
  }
  const row=await loadState(env,id,profile);
  if(resource==='state'&&request.method==='GET')return json({state:JSON.parse(row.state_json),version:row.version,role,connection:env.localRuntime?env.localRuntime():hubStatus(await hubRow(env,id))});
  if(resource==='actions'&&request.method==='POST'){
    const body=await readBody(request);if(body.version!==row.version)throw new AppError('Another host updated this floor. The latest changes have been loaded; please try your action again.',409);
    if(['background','replaceFloor'].includes(body.action?.type))throw new AppError('Use the floor plan upload.');
    const state=applyAction(JSON.parse(row.state_json),body.action||{},role);return saveState(env,id,row,state,profile,request.headers.get('x-request-id'));
  }
  if(resource==='floorplan'&&request.method==='POST'){
    if(!['admin','manager'].includes(role))throw new AppError('Manager access required.',403);
    if(Number(request.headers.get('content-length'))>12*1024*1024)throw new AppError('Maximum floor plan size is 12 MB.',413);
    let bytes=await request.arrayBuffer();if(bytes.byteLength>12*1024*1024)throw new AppError('Maximum floor plan size is 12 MB.',413);
    let type=request.headers.get('content-type'),imported=null,name=url.searchParams.get('name'),expectedVersion=Number(url.searchParams.get('version'));
    if(type?.startsWith('multipart/form-data')){
      let form;try{form=await new Response(bytes,{headers:{'content-type':type}}).formData();}catch{throw new AppError('Invalid floor plan upload.');}
      const manifest=form.get('layout'),image=form.get('image');
      if(typeof manifest!=='string'||manifest.length>65536||!image||typeof image.arrayBuffer!=='function')throw new AppError('Upload the reviewed tables and floor image together.');
      try{imported=JSON.parse(manifest);}catch{throw new AppError('Invalid table review.');}
      if(!imported||!Array.isArray(imported.tables))throw new AppError('Review the detected tables first.');
      name=imported.name;expectedVersion=imported.version;type=image.type;bytes=await image.arrayBuffer();
    }
    if(expectedVersion!==row.version)throw new AppError('Another host changed this location. Cancel this review and upload again to use the latest state.',409);
    const b=new Uint8Array(bytes);
    const valid=(type==='image/png'&&b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71)||(type==='image/jpeg'&&b[0]===255&&b[1]===216&&b[2]===255)||(type==='image/webp'&&new TextDecoder().decode(b.slice(0,4))==='RIFF'&&new TextDecoder().decode(b.slice(8,12))==='WEBP');
    if(!valid)throw new AppError('Upload a PNG, JPEG, WebP, or converted PDF floor plan.');
    const key=`seating/${id}/${crypto.randomUUID()}`;
    const old=JSON.parse(row.state_json).background;
    const state=applyAction(JSON.parse(row.state_json),{type:imported?'replaceFloor':'background',tables:imported?.tables,background:{key,mime:type,name:cleanFilename(name),...(imported?{imported:true,page:Math.max(1,Math.min(10000,Number(imported.page)||1))}:{})}},role);
    await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:type}});
    try{const response=await saveState(env,id,row,state,profile);if(old?.key)ctx.waitUntil(env.MEDIA.delete(old.key));return response;}catch(error){if(error.status!==503)await env.MEDIA.delete(key);throw error;}
  }
  throw new AppError('Method not allowed.',405);
}
function cleanFilename(s){return String(s||'Uploaded floor plan').slice(0,120);}
export default {
  async fetch(request,env,execution){
    const ctx={cookies:[],waitUntil:p=>execution.waitUntil(p)};let response;
    try{
      const url=new URL(request.url);
      if(url.pathname.startsWith('/api/'))response=await api(request,env,ctx,url);
      else response=await env.ASSETS.fetch(request);
    }catch(error){
      if(!(error instanceof AppError))console.error('Seating request failed',error.message);
      response=json({error:error instanceof AppError?error.message:'Service temporarily unavailable. Please retry.'},error.status||503);
    }
    const headers=new Headers(response.headers);for(const [k,v]of Object.entries(secureHeaders))headers.set(k,v);
    for(const value of ctx.cookies)headers.append('set-cookie',value);
    return new Response(response.body,{status:response.status,headers});
  }
};
