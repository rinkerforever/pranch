import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';
function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001_seating.sql',import.meta.url),'utf8'));
  sqlite.exec("CREATE TABLE user_profiles(id TEXT,auth_user_id TEXT,email TEXT,display_name TEXT,system_admin INTEGER,active INTEGER); CREATE TABLE locations(id TEXT,name TEXT,active INTEGER); INSERT INTO locations VALUES('loc','Test restaurant',1); INSERT INTO user_profiles VALUES('admin','auth-admin','admin@example.test','Admin',1,1); INSERT INTO user_profiles VALUES('viewer','auth-viewer','viewer@example.test','Viewer',0,1); INSERT INTO seating_grants VALUES('viewer','loc','viewer');");
  const DB={prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return{results:sqlite.prepare(sql).all(...args)};},async run(){const r=sqlite.prepare(sql).run(...args);return{meta:{changes:Number(r.changes)}};}};}};
  const env={DB,SUPABASE_URL:'https://auth.example.test',SUPABASE_PUBLISHABLE_KEY:'public',ASSETS:{fetch:()=>new Response('page')}};
  return{sqlite,env,async call(path,body,token='admin',origin='https://seating.example.test'){return worker.fetch(new Request('https://seating.example.test'+path,{method:body?'POST':'GET',headers:{cookie:`seat_access=${token}`,origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){}});}};
}
test('API enforces auth, origin, location access and viewer read-only',async t=>{
  t.mock.method(globalThis,'fetch',async(url,options)=>new Response(JSON.stringify({id:options.headers.authorization==='Bearer viewer'?'auth-viewer':'auth-admin'}),{status:options.headers.authorization==='Bearer bad'?401:200}));
  const f=fixture();assert.equal((await f.call('/api/session',null,'bad')).status,401);
  assert.equal((await f.call('/api/locations/missing/state')).status,404);
  const first=await f.call('/api/locations/loc/state');assert.equal(first.status,200);
  const body={version:0,action:{type:'addParty',name:'Test',size:2}};
  assert.equal((await f.call('/api/locations/loc/actions',body,'admin','https://evil.example')).status,403);
  assert.equal((await f.call('/api/locations/loc/actions',body,'viewer')).status,403);
  assert.equal((await f.call('/api/staff')).status,200);
  assert.equal((await f.call('/api/staff',null,'viewer')).status,403);f.sqlite.close();
});
test('plan cleanup is location-scoped and versioned without rewriting the stored image',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({id:'auth-admin'})));
 const f=fixture();f.sqlite.exec("INSERT INTO locations VALUES('waco','Waco',1)");
 await f.call('/api/locations/loc/state');const initial=await(await f.call('/api/locations/waco/state')).json();
 initial.state.background={key:'waco-original.png',mime:'image/png',imported:true};
 f.sqlite.prepare('UPDATE seating_state SET state_json=? WHERE location_id=?').run(JSON.stringify(initial.state),'waco');
 const body={version:0,action:{type:'cleanPlan',covers:[{x:20,y:30,width:40,height:50}]}};
 assert.equal((await f.call('/api/locations/waco/actions',body)).status,200);assert.equal((await f.call('/api/locations/waco/actions',body)).status,409);
 const waco=await(await f.call('/api/locations/waco/state')).json(),other=await(await f.call('/api/locations/loc/state')).json();
 assert.equal(waco.state.background.key,'waco-original.png');assert.equal(waco.state.background.covers.length,1);assert.equal(other.state.background,null);assert.deepEqual(waco.state.tables,initial.state.tables);f.sqlite.close();
});

test('area configuration persists only at its location and rejects stale updates',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({id:'auth-admin'})));
 const f=fixture();f.sqlite.exec("INSERT INTO locations VALUES('waco','Waco',1)");
 await f.call('/api/locations/loc/state');await f.call('/api/locations/waco/state');
 const body={version:0,action:{type:'saveArea',name:'Brazos Room',kind:'room'}};
 assert.equal((await f.call('/api/locations/waco/actions',body)).status,200);
 assert.equal((await f.call('/api/locations/waco/actions',body)).status,409);
 const waco=await(await f.call('/api/locations/waco/state')).json(),other=await(await f.call('/api/locations/loc/state')).json();
 assert.equal(waco.state.areaConfig.at(-1).name,'Brazos Room');assert.equal(other.state.areaConfig,undefined);f.sqlite.close();
});

test('two hosts writing the same version: one succeeds and one conflicts',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({id:'auth-admin'})));
  const f=fixture();await f.call('/api/locations/loc/state');
  const action={version:0,action:{type:'addParty',name:'Test',size:2}};
  const responses=await Promise.all([f.call('/api/locations/loc/actions',action),f.call('/api/locations/loc/actions',action)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const result=await(await f.call('/api/locations/loc/state')).json();assert.equal(result.state.parties.length,1);assert.equal(result.version,1);f.sqlite.close();
});
test('staff grants permit only assigned locations and honor disabled accounts',async t=>{
  t.mock.method(globalThis,'fetch',async(url,options)=>new Response(JSON.stringify({id:options.headers.authorization==='Bearer viewer'?'auth-viewer':'auth-admin'})));
  const f=fixture();assert.equal((await f.call('/api/staff',{userId:'viewer',locationId:'loc',role:'host'})).status,200);
  const r=await(await f.call('/api/locations/loc/state',null,'viewer')).json();assert.equal(r.role,'host');
  assert.equal((await f.call('/api/locations/loc/actions',{version:0,action:{type:'addParty',name:'Guest',size:2}},'viewer')).status,200);
  f.sqlite.exec("UPDATE user_profiles SET active=0 WHERE id='viewer'");assert.equal((await f.call('/api/session',null,'viewer')).status,403);f.sqlite.close();
});

test('legacy numbering survives repeated reads and persists with the next saved change',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({id:'auth-admin'})));
  const f=fixture();const original=await(await f.call('/api/locations/loc/state')).json();
  delete original.state.numberingVersion;
  for(const table of original.state.tables)table.number=String(Number(table.number)-1);
  f.sqlite.prepare('UPDATE seating_state SET state_json=? WHERE location_id=?').run(JSON.stringify(original.state),'loc');
  for(let i=0;i<2;i++){
    const result=await(await f.call('/api/locations/loc/state')).json();
    assert.equal(result.state.tables.find(t=>t.id==='A-10').number,'11');
    assert.equal(result.version,0);
  }
  const response=await f.call('/api/locations/loc/actions',{version:0,action:{type:'status',ids:['A-10'],status:'in_use'}});
  assert.equal(response.status,200);
  const stored=JSON.parse(f.sqlite.prepare('SELECT state_json FROM seating_state').get().state_json);
  assert.equal(stored.numberingVersion,1);assert.equal(stored.tables.find(t=>t.id==='A-10').number,'11');
  assert.equal(stored.tables.find(t=>t.id==='A-10').status,'in_use');f.sqlite.close();
});

async function guestCall(f,{token='',body,ip='192.0.2.1',origin='https://seating.example.test',location='loc'}={}){
 return f.env && worker.fetch(new Request(`https://seating.example.test/api/guest/${location}`,{method:body?'POST':'GET',headers:{cookie:token,origin,'CF-Connecting-IP':ip,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),f.env,{waitUntil(){}});
}
async function openGuestCheckin(f){await f.call('/api/locations/loc/state');return f.call('/api/locations/loc/actions',{version:0,action:{type:'guestSettings',enabled:true,maxPartySize:8}});}

test('reviewed floor import is atomic, location-scoped, versioned and manager-only',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({id:'auth-admin'})));
 const f=fixture(),objects=new Map(),deleted=[];
 f.env.MEDIA={async put(key,bytes){objects.set(key,bytes);},async delete(key){deleted.push(key);objects.delete(key);}};
 f.sqlite.exec("INSERT INTO locations VALUES('other','Other restaurant',1)");
 const old=await(await f.call('/api/locations/loc/state')).json(),other=await(await f.call('/api/locations/other/state')).json();
 const table={number:'A51',area:'A',capacity:4,kind:'table',orientation:'tb',x:1108,y:351};
 const upload=async(version,tables=[table])=>{
  const form=new FormData();form.append('image',new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'}),'plan.png');form.append('layout',JSON.stringify({version,tables,name:'Waco.pdf',page:1}));
  return worker.fetch(new Request('https://seating.example.test/api/locations/loc/floorplan',{method:'POST',headers:{origin:'https://seating.example.test',cookie:'seat_access=admin'},body:form}),f.env,{waitUntil(){}});
 };
 assert.equal((await upload(99)).status,409);assert.equal(objects.size,0);
 assert.equal((await upload(0,[table,table])).status,400);assert.equal(objects.size,0);
 assert.equal((await f.call('/api/locations/loc/actions',{version:0,action:{type:'replaceFloor',tables:[table],background:{key:'other-private-image'}}})).status,400);
 const response=await upload(0);assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.state.tables.length,1);assert.equal(saved.version,1);assert.equal(saved.state.background.imported,true);assert.equal(objects.size,1);
 const unchanged=await(await f.call('/api/locations/other/state')).json();assert.deepEqual(unchanged,other);
 assert.equal((await upload(0)).status,409);assert.equal(objects.size,1);
 // An uploaded object is removed if the database write loses a concurrent update.
 const prepare=f.env.DB.prepare.bind(f.env.DB);f.env.DB.prepare=sql=>sql.startsWith('UPDATE seating_state')?{bind(){return this;},async run(){return{meta:{changes:0}};}}:prepare(sql);
 assert.equal((await upload(1)).status,409);assert.equal(objects.size,1);assert.equal(deleted.length,1);
 f.env.DB.prepare=prepare;
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({id:'auth-viewer'})));
 assert.equal((await upload(1)).status,403);assert.equal(old.state.tables.length,68);f.sqlite.close();
});
const guestJoin={action:'join',name:'Guest One',size:4,notes:'High chair',website:'',highChair:true,booster:true};
test('guest check-in is closed by default, scoped to an active location and enforces origin and size',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({id:'auth-admin'})));
 const f=fixture(),first=await guestCall(f),token=first.headers.get('set-cookie').split(';')[0];
 assert.equal((await first.json()).enabled,false);
 assert.equal((await guestCall(f,{token,body:guestJoin})).status,409);
 await openGuestCheckin(f);
 assert.equal((await guestCall(f,{body:guestJoin})).status,400);
 assert.equal((await guestCall(f,{token,body:guestJoin,origin:'https://evil.example'})).status,403);
 assert.equal((await guestCall(f,{token,body:{...guestJoin,size:9}})).status,400);
 assert.equal((await guestCall(f,{token,body:{...guestJoin,website:'spam'}})).status,400);
 assert.equal((await guestCall(f,{location:'missing'})).status,404);
 f.sqlite.exec("UPDATE locations SET active=0 WHERE id='loc'");assert.equal((await guestCall(f,{token})).status,404);f.sqlite.close();
});
test('concurrent duplicate submissions create one party and private status exposes only that guest',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({id:'auth-admin'})));
 const f=fixture();await openGuestCheckin(f);
 const first=await guestCall(f),token=first.headers.get('set-cookie').split(';')[0];
 const results=await Promise.all([guestCall(f,{token,body:guestJoin}),guestCall(f,{token,body:guestJoin})]);
 assert.deepEqual(results.map(r=>r.status),[200,200]);
 let staff=await(await f.call('/api/locations/loc/state')).json();assert.equal(staff.state.parties.length,1);assert.equal(staff.state.parties[0].source,'qr');assert.equal(staff.state.parties[0].highChair,true);assert.equal(staff.state.parties[0].booster,true);
 const second=await guestCall(f),otherToken=second.headers.get('set-cookie').split(';')[0];assert.equal((await second.json()).party,null);
 assert.equal((await guestCall(f,{token:otherToken,body:guestJoin})).status,429);
 const publicData=await(await guestCall(f,{token})).json();assert.deepEqual(Object.keys(publicData.party).sort(),['arrivedAt','name','ready','size','status']);assert.ok(!JSON.stringify(publicData).includes('guestTokenHash'));assert.ok(!JSON.stringify(publicData).includes('High chair'));
 await f.call('/api/locations/loc/actions',{version:staff.version,action:{type:'readyParty',id:staff.state.parties[0].id}});
 assert.equal((await(await guestCall(f,{token})).json()).party.ready,true);
 assert.equal((await guestCall(f,{token:otherToken,body:{action:'cancel'}})).status,409);
 assert.equal((await guestCall(f,{token,body:{action:'cancel'}})).status,200);
 assert.equal((await(await guestCall(f,{token})).json()).party.status,'cancelled');f.sqlite.close();
});
test('closed check-in still serves private status; QR images require staff access',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({id:'auth-admin'})));
 const f=fixture();await openGuestCheckin(f);const first=await guestCall(f),token=first.headers.get('set-cookie').split(';')[0];await guestCall(f,{token,body:guestJoin});
 const staff=await(await f.call('/api/locations/loc/state')).json();await f.call('/api/locations/loc/actions',{version:staff.version,action:{type:'guestSettings',enabled:false,maxPartySize:8}});
 const status=await(await guestCall(f,{token})).json();assert.equal(status.enabled,false);assert.equal(status.party.name,'Guest One');
 const qr=await f.call('/api/locations/loc/qr');assert.equal(qr.status,200);assert.match(await qr.text(),/<svg/);
 const anonymous=await worker.fetch(new Request('https://seating.example.test/api/locations/loc/qr'),f.env,{waitUntil(){}});assert.equal(anonymous.status,401);f.sqlite.close();
});
