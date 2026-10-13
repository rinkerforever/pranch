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
