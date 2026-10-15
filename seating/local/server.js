import http from 'node:http';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join,extname,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {openStore,hash,pinHash,pinMatches,syncRoster,processCommand} from './store.js';
import worker from '../src/worker.js';
import {AppError} from '../src/model.js';
const PUBLIC=resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.ico':'image/x-icon'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export function createLocalServer(config){
 const {locationId,token,cloudUrl,publicUrl,directory}=config;
 if(!locationId||!token||!/^https:\/\//.test(cloudUrl)||!/^https:\/\//.test(publicUrl)&&!config.testMode)throw Error('Set the location ID, pairing token, HTTPS cloud URL and HTTPS local URL.');
 const origin=new URL(publicUrl).origin,store=openStore(directory),mediaDir=join(directory,'media');
 let lastCloud=0,lastError='Waiting for initial synchronization',cycling=false,closed=false,active=store.meta('active')==='1',recovery=store.meta('recovery')==='1';
 const cookie=(value,age)=>`seat_local=${value}; HttpOnly; ${config.testMode?'':'Secure; '}SameSite=Strict; Path=/; Max-Age=${age}`;
 const clientAllowed=ip=>ip==='127.0.0.1'||ip==='::1'||ip==='::ffff:127.0.0.1';
 const mediaPath=key=>join(mediaDir,hash(key));
 const MEDIA={async get(key){try{const body=await readFile(mediaPath(key)),type=await readFile(mediaPath(key)+'.type','utf8');return {body,httpMetadata:{contentType:type}};}catch{return null;}},async put(key,bytes,{httpMetadata}={}){await mkdir(mediaDir,{recursive:true,mode:0o700});await writeFile(mediaPath(key),Buffer.from(bytes),{mode:0o600});await writeFile(mediaPath(key)+'.type',httpMetadata?.contentType||'image/png',{mode:0o600});},async delete(key){/* Retain original media locally for backup and in-flight requests. */}};
 async function cloud(path,options={}){
  const response=await (config.fetch||fetch)(cloudUrl+path,{...options,signal:AbortSignal.timeout(6000),headers:{authorization:`Bearer ${token}`,...options.headers}});
  if(!response.ok){const e=await response.json().catch(()=>({}));throw Error(e.error||`Cloud returned ${response.status}`);}return response;
 }
 const hubPath=`/api/hub/${encodeURIComponent(locationId)}`;
 async function downloadMedia(state){if(state.background?.key&&!await MEDIA.get(state.background.key)){const response=await cloud(hubPath+'/media?key='+encodeURIComponent(state.background.key));await MEDIA.put(state.background.key,await response.arrayBuffer(),{httpMetadata:{contentType:response.headers.get('content-type')}});}}
 async function uploadMedia(state){const key=state.background?.key;if(!key||store.meta('uploadedMedia')===key)return;const image=await MEDIA.get(key);if(!image)throw Error('Floor plan image is missing locally.');await cloud(hubPath+'/media?key='+encodeURIComponent(key),{method:'PUT',headers:{'content-type':image.httpMetadata.contentType},body:image.body});store.meta('uploadedMedia',key);}
 async function cycle(){
  if(cycling||closed)return;cycling=true;
  try{
   const remote=await(await cloud(hubPath)).json();
   if(remote.localUrl!==origin)throw Error('Local URL differs from the registered Pi address.');
   if(active){const local=store.snapshot(locationId);if(recovery||!remote.enabled||!local||local.version<remote.version||local.version===remote.version&&JSON.stringify(local.state)!==JSON.stringify(remote.state)){recovery=true;store.meta('recovery','1');throw Error('Data recovery required. This Pi differs from the saved primary server. Seating changes are paused.');}}
   if(!active){
    if(remote.enabled&&store.meta('active')!=='1')throw Error('This store is already active on a Pi. Restore its complete database; do not bootstrap a second server.');
    await downloadMedia(remote.state);
    store.db.prepare('INSERT OR REPLACE INTO seating_state(location_id,version,state_json,updated_by) VALUES(?,?,?,?)').run(locationId,remote.version,JSON.stringify(remote.state),'bootstrap');
    store.db.prepare('INSERT OR REPLACE INTO locations VALUES(?,?,1)').run(locationId,remote.location.name);
    syncRoster(store,locationId,remote.roster);
    await cloud(hubPath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({activate:true,version:remote.version,stateHash:remote.stateHash})});
    store.meta('active','1');active=true;
   }
   const results=[];for(const command of remote.commands){await downloadMedia(JSON.parse(command.state_json));results.push({id:command.id,response:processCommand(store,locationId,command)});}
   syncRoster(store,locationId,remote.roster);
   const snapshot=store.snapshot(locationId);await uploadMedia(snapshot.state);
   await cloud(hubPath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...snapshot,results})});
   lastCloud=Date.now();lastError='';
  }catch(e){lastError=e.message;}finally{cycling=false;}
 }
 const runtime=()=>({mode:'local',online:Date.now()-lastCloud<10000,lastCloud,lastError,active,requiresRecovery:recovery,localUrl:origin,cloudUrl});
 function identity(request){
  const tokenValue=request.headers.get('cookie')?.match(/(?:^|;\s*)seat_local=([a-f0-9]+)/)?.[1];
  const row=tokenValue&&store.db.prepare('SELECT u.* FROM local_sessions s JOIN user_profiles u ON s.user_id=u.id JOIN local_pins p ON p.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND p.expires_at>? AND u.active=1').get(hash(tokenValue),Date.now(),Date.now());
  if(!row||Date.now()-Number(store.meta('rosterAt')||0)>7*86400000)throw new AppError('Enter your local PIN. Online account verification is required at least every 7 days.',401);
  return row;
 }
 const env={DB:store.adapter,MEDIA,localIdentity:identity,localRuntime:runtime,publicCloudUrl:cloudUrl,ASSETS:{async fetch(request){
  let path;try{path=decodeURIComponent(new URL(request.url).pathname);}catch{return new Response('Bad path',{status:400});}
  if(path==='/')path='/index.html';if(!extname(path))path+='.html';const absolute=resolve(PUBLIC,'.'+path);
  if(!absolute.startsWith(PUBLIC+sep))return new Response('Not found',{status:404});
  try{return new Response(await readFile(absolute),{headers:{'content-type':mime[extname(absolute)]||'application/octet-stream','cache-control':'no-cache'}});}catch{return new Response('Not found',{status:404});}
 }}};
 async function handle(request,client='127.0.0.1'){
  if(!clientAllowed(client))return json({error:'Use the local HTTPS proxy.'},403);
  const url=new URL(request.url);if(url.origin!==origin)return json({error:'Unknown local hostname.'},403);
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==origin)return json({error:'Request origin is not allowed.'},403);
  try{
   if(url.pathname.startsWith('/api/hub/'))throw new AppError('Local pairing endpoint is not public.',404);
   if(url.pathname==='/api/local/enroll'&&request.method==='POST'){
    const body=await limitedBody(request),{email,password,pin}=body;
    if(!active||!/^\d{4}$/.test(pin)||typeof email!=='string'||email.length>254||typeof password!=='string'||password.length>256)throw new AppError('Enter your cloud email, password and a four-digit local PIN.');
    throttle('enroll');
    const logged=await (config.fetch||fetch)(cloudUrl+'/api/login',{method:'POST',headers:{origin:cloudUrl,'content-type':'application/json'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(10000)});
    if(!logged.ok)throw new AppError('Cloud sign-in failed. Check your account or connection.',401);
    const cookies=logged.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
    const response=await (config.fetch||fetch)(cloudUrl+'/api/session',{headers:{cookie:cookies},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new AppError('Cloud account verification failed.',401);const session=await response.json(),loc=session.locations.find(l=>l.id===locationId);
    if(!loc)throw new AppError('Your account has no seating access at this restaurant.',403);
    const profile=session.profile;
    const pinKey=hash(token+':'+pin);if(store.db.prepare('SELECT user_id FROM local_pins WHERE pin_key=? AND user_id<>?').get(pinKey,profile.id))throw new AppError('That PIN is already assigned. Choose a different PIN.');
    store.db.prepare('INSERT OR REPLACE INTO user_profiles VALUES(?,?,?,?,?,1)').run(profile.id,profile.auth_user_id||'',email,profile.display_name,profile.system_admin?1:0);
    if(!profile.system_admin)store.db.prepare('INSERT OR REPLACE INTO seating_grants VALUES(?,?,?)').run(profile.id,locationId,loc.role);
    store.db.prepare('INSERT OR REPLACE INTO local_pins VALUES(?,?,?,?)').run(profile.id,pinHash(pin),Date.now()+30*86400000,pinKey);store.db.prepare('DELETE FROM local_sessions WHERE user_id=?').run(profile.id);
    return json({ok:true,message:'Local PIN saved. Use it on the restaurant Wi-Fi.'});
   }
   if(url.pathname==='/api/login'&&request.method==='POST'){
    if(!active)throw new AppError('The local server is not paired yet.',503);
    const {pin}=await limitedBody(request);throttle('login');if(!/^\d{4}$/.test(pin))throw new AppError('Enter four digits.',401);
    const candidate=store.db.prepare('SELECT p.* FROM local_pins p JOIN user_profiles u ON p.user_id=u.id WHERE u.active=1 AND p.expires_at>? AND p.pin_key=?').get(Date.now(),hash(token+':'+pin));
    const matched=candidate&&pinMatches(pin,candidate.verifier)?candidate:null;if(!matched)throw new AppError('PIN not recognized. Ask a manager or verify your cloud account.',401);
    if(Date.now()-Number(store.meta('rosterAt')||0)>7*86400000)throw new AppError('Connect the Pi to the internet to renew staff access.',401);
    store.db.prepare('DELETE FROM local_sessions WHERE expires_at<?').run(Date.now());const value=randomBytes(32).toString('hex');store.db.prepare('INSERT INTO local_sessions VALUES(?,?,?)').run(hash(value),matched.user_id,Date.now()+12*3600000);
    return new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json','set-cookie':cookie(value,43200),'cache-control':'no-store'}});
   }
   if(url.pathname==='/api/logout'&&request.method==='POST'){
    const value=request.headers.get('cookie')?.match(/seat_local=([a-f0-9]+)/)?.[1];if(value)store.db.prepare('DELETE FROM local_sessions WHERE token_hash=?').run(hash(value));return new Response('{}',{headers:{'content-type':'application/json','set-cookie':cookie('',0),'cache-control':'no-store'}});
   }
   if(url.pathname==='/api/guest/'+encodeURIComponent(locationId))return json({location:store.db.prepare('SELECT name FROM locations WHERE id=?').get(locationId)?.name,enabled:false,offline:true,message:'Please see the host to join the waitlist.',maxPartySize:12,party:null},request.method==='POST'?503:200);
   if(url.pathname==='/api/runtime')return json(runtime());
   if(recovery&&!['GET','HEAD'].includes(request.method))throw new AppError('Data recovery required. Seating changes are paused; contact the administrator.',503);
   return await worker.fetch(request,env,{waitUntil:p=>p.catch(()=>{})});
  }catch(e){return json({error:e instanceof AppError?e.message:'Unable to complete this request. Check the connection and try again.'},e.status||503);}
 }
 function throttle(key){
  const now=Date.now(),row=store.db.prepare('SELECT * FROM local_attempts WHERE client=?').get(key);
  if(row&&now-row.window_start<60000&&row.attempts>=5)throw new AppError('Too many attempts. Wait one minute before trying again.',429);
  if(!row||now-row.window_start>=60000)store.db.prepare('INSERT OR REPLACE INTO local_attempts VALUES(?,1,?)').run(key,now);else store.db.prepare('UPDATE local_attempts SET attempts=attempts+1 WHERE client=?').run(key);
 }
 async function limitedBody(request){const text=await request.text();if(text.length>4096)throw new AppError('Request too large.',413);try{return JSON.parse(text);}catch{throw new AppError('Invalid request.');}}
 const server=http.createServer(async(req,res)=>{
  try{
   const buffers=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>12*1024*1024){res.writeHead(413);res.end('Request too large');return;}buffers.push(chunk);}
   const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(buffers)}:{})});
   const response=await handle(request,req.socket.remoteAddress);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(503);res.end('Local service unavailable');}
 });
 const timer=config.noTimer?null:setInterval(cycle,1500);timer?.unref();
 return {server,store,handle,cycle,runtime,async close(){closed=true;if(timer)clearInterval(timer);await new Promise(resolve=>server.listening?server.close(resolve):resolve());store.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=createLocalServer({locationId:process.env.SEATING_LOCATION_ID,token:process.env.SEATING_HUB_TOKEN,cloudUrl:process.env.SEATING_CLOUD_URL||'https://seating.projectaimnet.com',publicUrl:process.env.SEATING_LOCAL_URL,directory:process.env.SEATING_DATA_DIR||'/var/lib/pizza-ranch-seating'});
 app.server.listen(Number(process.env.PORT)||8790,'127.0.0.1',()=>{console.log('Local seating service listening on loopback port '+(process.env.PORT||8790));app.cycle();});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit()));
}
