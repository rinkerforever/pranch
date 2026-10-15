import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,hash,pinHash,syncRoster,processCommand} from '../local/store.js';
import {createLocalServer} from '../local/server.js';
import {initialState,applyAction} from '../src/model.js';
import {hubApi,relaySave,hubOnline,configureHub} from '../src/hub.js';
import {readyTracker} from '../public/ready-alert.js';
import worker from '../src/worker.js';
const cleanup=new WeakMap();
function temporary(t){if(!cleanup.has(t)){const tasks={dirs:[],close:[]};cleanup.set(t,tasks);t.after(async()=>{for(const close of tasks.close.reverse())await close();for(const dir of tasks.dirs){assert.ok(dir.startsWith(join(tmpdir(),'seating-test-')));rmSync(dir,{recursive:true,force:true});}});}const dir=mkdtempSync(join(tmpdir(),'seating-test-'));cleanup.get(t).dirs.push(dir);return dir;}
const closeAfter=(t,fn)=>cleanup.get(t).close.push(fn);
function cloudFixture(t){
 const store=openStore(temporary(t));closeAfter(t,()=>store.close());const db=store.db;
 db.prepare('INSERT INTO locations VALUES(?,?,1)').run('waco','Waco');
 db.prepare('INSERT INTO user_profiles VALUES(?,?,?,?,1,1)').run('admin','auth-admin','admin@example.test','Admin');
 db.prepare('INSERT INTO seating_state(location_id,version,state_json,updated_by) VALUES(?,0,?,?)').run('waco',JSON.stringify(initialState()),'test');
 db.prepare('INSERT INTO seating_hubs(location_id,token_hash,local_url,created_by) VALUES(?,?,?,?)').run('waco',hash('secret'),'https://waco.local:8443','admin');
 const env={DB:store.adapter,MEDIA:{async get(){return null;}},ASSETS:{fetch:()=>new Response('page')},SUPABASE_URL:'https://auth.example.test',SUPABASE_PUBLISHABLE_KEY:'public'};
 const call=(body,token='secret')=>hubApi(new Request('https://cloud.example.test/api/hub/waco',{method:body?'POST':'GET',headers:{authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})}),env,new URL('https://cloud.example.test/api/hub/waco'));
 return {store,db,env,call};
}
function seededLocal(t){
 const app=createLocalServer({locationId:'waco',token:'secret',cloudUrl:'https://cloud.example.test',publicUrl:'https://waco.local:8443',directory:temporary(t),noTimer:true,fetch:async()=>{throw Error('Internet down');}});closeAfter(t,()=>app.close());
 app.store.db.prepare('INSERT INTO locations VALUES(?,?,1)').run('waco','Waco');
 app.store.db.prepare('INSERT INTO seating_state(location_id,version,state_json,updated_by) VALUES(?,0,?,?)').run('waco',JSON.stringify(initialState()),'test');
 syncRoster(app.store,'waco',[{id:'host',auth_user_id:'auth-host',email:'host@example.test',display_name:'Host',system_admin:0,role:'host'}]);
 app.store.db.prepare('INSERT INTO local_pins VALUES(?,?,?,?)').run('host',pinHash('1234'),Date.now()+86400000,hash('secret:1234'));
 // Restart as an already-paired Pi, using the same persistent store.
 app.store.meta('active','1');return app;
}
const localRequest=(app,path,body,cookie='',client)=>app.handle(new Request('https://waco.local:8443'+path,{method:body?'POST':'GET',headers:{origin:'https://waco.local:8443',cookie},...(body?{body:JSON.stringify(body)}:{})}),client);
test('local PIN is salted, restricted to loopback proxy, rate-limited and cannot authenticate cloud',async t=>{
 const app=seededLocal(t);assert.ok(!app.store.db.prepare('SELECT verifier FROM local_pins').get().verifier.includes('1234'));
 assert.equal((await localRequest(app,'/api/login',{pin:'1234'},'','203.0.113.1')).status,403);
 const response=await localRequest(app,'/api/login',{pin:'1234'});assert.equal(response.status,503); // activation is deliberately latched at startup
 const wrong=new Request('https://evil.example/api/login',{method:'POST',headers:{origin:'https://evil.example'},body:'{}'});assert.equal((await app.handle(wrong)).status,403);
});
test('paired local hosts keep working offline, survive restart, and competing writes cannot double-seat',async t=>{
 // Open a fresh paired database after persisting the seed.
 const directory=temporary(t),seed=openStore(directory);seed.db.exec('VACUUM');seed.close();
 const app=createLocalServer({locationId:'waco',token:'secret',cloudUrl:'https://cloud.example.test',publicUrl:'https://waco.local:8443',directory,noTimer:true,fetch:async()=>{throw Error('offline');}});
 app.store.db.prepare('INSERT INTO locations VALUES(?,?,1)').run('waco','Waco');app.store.db.prepare('INSERT INTO seating_state(location_id,version,state_json,updated_by) VALUES(?,0,?,?)').run('waco',JSON.stringify(initialState()),'seed');
 syncRoster(app.store,'waco',[{id:'host',email:'host@example.test',display_name:'Host',system_admin:0,role:'host',auth_user_id:'h'}]);
 app.store.db.prepare('INSERT INTO local_pins VALUES(?,?,?,?)').run('host',pinHash('1234'),Date.now()+86400000,hash('secret:1234'));app.store.meta('active','1');await app.close();
 const reopened=createLocalServer({locationId:'waco',token:'secret',cloudUrl:'https://cloud.example.test',publicUrl:'https://waco.local:8443',directory,noTimer:true,fetch:async()=>{throw Error('Internet down');}});closeAfter(t,()=>reopened.close());
 const login=await localRequest(reopened,'/api/login',{pin:'1234'});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.ok(login.headers.get('set-cookie').includes('Secure'));
 await reopened.cycle();assert.equal(reopened.runtime().online,false);
 const action={version:0,action:{type:'addParty',name:'Offline guest',size:4}};
 const results=await Promise.all([localRequest(reopened,'/api/locations/waco/actions',action,cookie),localRequest(reopened,'/api/locations/waco/actions',action,cookie)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const state=await(await localRequest(reopened,'/api/locations/waco/state',null,cookie)).json();assert.equal(state.state.parties.length,1);assert.equal(state.connection.online,false);
 assert.equal((await localRequest(reopened,'/api/locations/another/state',null,cookie)).status,404);
 assert.equal((await localRequest(reopened,'/api/locations/waco/actions',{version:1,action:{type:'saveArea',name:'Unauthorized',kind:'room'}},cookie)).status,403);
 assert.equal((await localRequest(reopened,'/api/guest/waco',{action:'join'})).status,503);
 for(let i=0;i<4;i++)await localRequest(reopened,'/api/login',{pin:'0000'});assert.equal((await localRequest(reopened,'/api/login',{pin:'0000'})).status,429);
 await localRequest(reopened,'/api/logout',{},cookie);assert.equal((await localRequest(reopened,'/api/session',null,cookie)).status,401);
});
test('hub bootstraps atomically, synchronizes local changes, and executes cloud requests once',async t=>{
 const cloud=cloudFixture(t),directory=temporary(t);
 const app=createLocalServer({locationId:'waco',token:'secret',cloudUrl:'https://cloud.example.test',publicUrl:'https://waco.local:8443',directory,noTimer:true,fetch:(url,options={})=>cloud.call(options.body?JSON.parse(options.body):null)});closeAfter(t,()=>app.close());
 await app.cycle();assert.equal(app.runtime().active,true);assert.equal(app.runtime().online,true);assert.equal(hubOnline(await cloud.db.prepare('SELECT * FROM seating_hubs').get()),true);
 const next=applyAction(cloud.store.snapshot('waco').state,{type:'addParty',name:'Cloud guest',size:4},'host');
 const pending=relaySave(cloud.env,'waco',0,next,'unique-command',2000);await new Promise(r=>setTimeout(r,20));await app.cycle();const response=await pending;assert.equal(response.status,200);assert.equal(app.store.snapshot('waco').state.parties.length,1);
 const command=cloud.db.prepare('SELECT * FROM seating_commands').get();assert.equal(processCommand(app.store,'waco',command).version,1);assert.equal(app.store.snapshot('waco').version,1);
 assert.equal(cloud.store.snapshot('waco').state.parties[0].name,'Cloud guest');
 await assert.rejects(cloud.call(null,'wrong'),/authorization/);
});
test('activation rejects stale bootstrap and expired commands never apply after reconnect',async t=>{
 const cloud=cloudFixture(t),snapshot=await(await cloud.call()).json();cloud.db.prepare('UPDATE seating_state SET version=1').run();
 await assert.rejects(cloud.call({activate:true,version:0,stateHash:snapshot.stateHash}),/changed/);
 const command={id:'expired',expected_version:1,expires_at:1,state_json:JSON.stringify(initialState())};
 assert.equal(processCommand(cloud.store,'waco',command).status,409);assert.equal(cloud.store.snapshot('waco').version,1);
});
test('a lost activation reply recovers only the Pi that persisted the matching bootstrap',async t=>{
 const cloud=cloudFixture(t);let loseReply=true;
 const app=createLocalServer({locationId:'waco',token:'secret',cloudUrl:'https://cloud.example.test',publicUrl:'https://waco.local:8443',directory:temporary(t),noTimer:true,fetch:async(url,options={})=>{const body=options.body?JSON.parse(options.body):null,response=await cloud.call(body);if(body?.activate&&loseReply){loseReply=false;throw Error('Lost activation response');}return response;}});closeAfter(t,()=>app.close());
 await app.cycle();assert.equal(app.runtime().active,false);assert.equal(cloud.db.prepare('SELECT enabled FROM seating_hubs').get().enabled,1);
 await app.cycle();assert.equal(app.runtime().active,true);assert.equal(app.runtime().online,true);
 const duplicate=createLocalServer({locationId:'waco',token:'secret',cloudUrl:'https://cloud.example.test',publicUrl:'https://waco.local:8443',directory:temporary(t),noTimer:true,fetch:(url,options={})=>cloud.call(options.body?JSON.parse(options.body):null)});closeAfter(t,()=>duplicate.close());await duplicate.cycle();assert.equal(duplicate.runtime().active,false);assert.match(duplicate.runtime().lastError,/already active/);
});
test('local changes win a race with a cloud proposal; a stale backup cannot overwrite cloud state',async t=>{
 const cloud=cloudFixture(t),directory=temporary(t),config={locationId:'waco',token:'secret',cloudUrl:'https://cloud.example.test',publicUrl:'https://waco.local:8443',directory,noTimer:true,fetch:(url,options={})=>cloud.call(options.body?JSON.parse(options.body):null)};
 const app=createLocalServer(config);closeAfter(t,()=>app.close());await app.cycle();
 const proposal=applyAction(initialState(),{type:'addParty',name:'Remote',size:2},'host');
 const pending=relaySave(cloud.env,'waco',0,proposal,'race-command',2000).then(()=>{throw Error('Should reject stale proposal');},e=>e);
 await new Promise(r=>setTimeout(r,20));const local=applyAction(initialState(),{type:'addParty',name:'Local',size:4},'host');
 app.store.db.prepare('UPDATE seating_state SET version=1,state_json=?').run(JSON.stringify(local));await app.cycle();assert.equal((await pending).status,409);assert.equal(cloud.store.snapshot('waco').state.parties[0].name,'Local');
 cloud.db.prepare('UPDATE seating_state SET version=2').run();await app.cycle();assert.equal(app.runtime().requiresRecovery,true);assert.equal(cloud.store.snapshot('waco').version,2);
});
test('pairing requires an administrator and never exposes a saved token again',async t=>{
 const cloud=cloudFixture(t);cloud.db.prepare('DELETE FROM seating_hubs').run();const req=()=>new Request('https://cloud.example.test/api/locations/waco/hub',{method:'POST',body:JSON.stringify({localUrl:'https://waco.local:8443'})});
 await assert.rejects(configureHub(req(),cloud.env,'waco',{id:'host'}),/administrator/);
 const created=await(await configureHub(req(),cloud.env,'waco',{id:'admin',system_admin:1})).json();assert.equal(created.token.length,64);const row=cloud.db.prepare('SELECT * FROM seating_hubs').get();assert.equal(row.token_hash,hash(created.token));assert.ok(!JSON.stringify(row).includes(created.token));
 await assert.rejects(configureHub(req(),cloud.env,'waco',{id:'admin',system_admin:1}),/already registered/);
});
test('public QR check-in is closed by the server when the enabled hub is stale',async t=>{
 const cloud=cloudFixture(t);cloud.db.prepare('UPDATE seating_hubs SET enabled=1,last_seen=?').run(Date.now()-20000);
 const s=initialState();s.guestSettings={enabled:true,maxPartySize:12};cloud.db.prepare('UPDATE seating_state SET state_json=?').run(JSON.stringify(s));
 const response=await worker.fetch(new Request('https://cloud.example.test/api/guest/waco'),cloud.env,{waitUntil(){}});const data=await response.json();assert.equal(data.enabled,false);assert.equal(data.offline,true);assert.match(data.message,/host/);
 const cookie=response.headers.get('set-cookie').split(';')[0];const post=await worker.fetch(new Request('https://cloud.example.test/api/guest/waco',{method:'POST',headers:{origin:'https://cloud.example.test',cookie,'content-type':'application/json'},body:JSON.stringify({action:'join',name:'No false success',size:2,notes:''})}),cloud.env,{waitUntil(){}});assert.equal(post.status,503);assert.equal(cloud.store.snapshot('waco').state.parties.length,0);
});
test('ready alerts stop after acknowledgment, rearm only after availability changes, and include new parties',()=>{
 const tracker=readyTracker(),row=(id,ready)=>({party:{id},estimate:{ready}});assert.equal(tracker.update([row('a',true)]).length,1);tracker.acknowledge([row('a',true)]);assert.equal(tracker.update([row('a',true)]).length,0);assert.equal(tracker.update([row('a',true),row('b',true)]).length,1);tracker.update([row('a',false)]);assert.equal(tracker.update([row('a',true)]).length,1);
});
test('unchanged staff polls avoid disk writes but changed permissions revoke access immediately',t=>{
 const store=openStore(temporary(t));closeAfter(t,()=>store.close());const roster=[{id:'h',auth_user_id:'h',email:'h@example.test',display_name:'Host',system_admin:0,role:'host'}];
 syncRoster(store,'waco',roster,100000);const before=store.db.prepare('SELECT total_changes() AS n').get().n;
 syncRoster(store,'waco',roster,101000);assert.equal(store.db.prepare('SELECT total_changes() AS n').get().n,before);
 syncRoster(store,'waco',[],102000);assert.equal(store.db.prepare('SELECT active FROM user_profiles WHERE id=?').get('h').active,0);
});
