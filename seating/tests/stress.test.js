import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';
function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001_seating.sql',import.meta.url),'utf8'));
  sqlite.exec("CREATE TABLE user_profiles(id TEXT,auth_user_id TEXT,email TEXT,display_name TEXT,system_admin INTEGER,active INTEGER); CREATE TABLE locations(id TEXT,name TEXT,active INTEGER); CREATE TABLE user_location_roles(user_id TEXT,location_id TEXT,role TEXT,permissions_json TEXT); INSERT INTO user_location_roles VALUES('viewer','loc','viewer','[]'); INSERT INTO locations VALUES('loc','Test restaurant',1); INSERT INTO user_profiles VALUES('admin','auth-admin','admin@example.test','Admin',1,1); INSERT INTO user_profiles VALUES('viewer','auth-viewer','viewer@example.test','Viewer',0,1); INSERT INTO seating_grants VALUES('viewer','loc','viewer');");
  const DB={prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return{results:sqlite.prepare(sql).all(...args)};},async run(){const r=sqlite.prepare(sql).run(...args);return{meta:{changes:Number(r.changes)}};}};}};
  const env={DB,SUPABASE_URL:'https://auth.example.test',SUPABASE_PUBLISHABLE_KEY:'public',ASSETS:{fetch:()=>new Response('page')}};
  return{sqlite,env,async call(path,body,token='admin',origin='https://seating.example.test'){return worker.fetch(new Request('https://seating.example.test'+path,{method:body?'POST':'GET',headers:{cookie:`seat_access=${token}`,origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){}});}};
}

import {initialState,applyAction} from '../src/model.js';
import {planWaitlist} from '../public/wait-plan.js';

test('stress: 1,000 competing host writes preserve one winner per version',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({id:'auth-admin'})));
 const f=fixture();t.after(()=>f.sqlite.close());
 const initial=await(await f.call('/api/locations/loc/state')).json();
 const table=initial.state.tables.find(t=>t.capacity>=4&&t.kind==='table');let version=initial.version;
 const latencies=[];
 for(let wave=0;wave<50;wave++){
  const start=performance.now();
  const action={type:'status',ids:[table.id],status:wave%2?'open':'cleaning'};
  const responses=await Promise.all(Array.from({length:20},()=>f.call('/api/locations/loc/actions',{version,action})));
  assert.equal(responses.filter(r=>r.status===200).length,1);
  assert.equal(responses.filter(r=>r.status===409).length,19);
  const result=await(await f.call('/api/locations/loc/state')).json();assert.equal(result.version,++version);
  assert.equal(result.state.tables.find(t=>t.id===table.id).status,action.status);latencies.push(performance.now()-start);
 }
 latencies.sort((a,b)=>a-b);t.diagnostic('20-host batch p95: '+latencies[Math.floor(latencies.length*.95)].toFixed(1)+' ms (in-process SQLite, not Pi hardware)');
});

test('stress: 300 complete seating cycles, undo and rejected double seating preserve state',t=>{
 let state=initialState(),now=Date.now();const table=state.tables.find(t=>t.capacity>=4&&t.kind==='table');
 const run=action=>{state=applyAction(state,action,'admin',now);};
 for(let i=0;i<300;i++){
  run({type:'seatNow',name:'Stress '+i,size:4,ids:[table.id]});
  const before=JSON.stringify(state);assert.throws(()=>applyAction(state,{type:'seatNow',size:2,ids:[table.id]},'host',now));assert.equal(JSON.stringify(state),before);
  now+=45*60000;run({type:'status',ids:[table.id],status:'cleaning'});
  if(i%10===0){run({type:'undo',undoId:state.lastUndo.id});assert.equal(state.tables.find(t=>t.id===table.id).status,'in_use');run({type:'status',ids:[table.id],status:'cleaning'});}
  now+=5*60000;run({type:'status',ids:[table.id],status:'open'});
  assert.ok(state.tables.every(t=>!t.party));assert.equal(new Set(state.tables.map(t=>t.id)).size,state.tables.length);
  assert.equal(state.parties.filter(p=>p.status==='seated').length,0);
 }
 assert.ok(state.parties.every(p=>p.status==='completed'&&now-p.closedAt<86400000));
 assert.equal(Object.values(state.reporting.days).reduce((n,d)=>n+(d.metrics.seatedParties||0),0),300);
 t.diagnostic('300 parties completed; 960 accepted transitions plus 300 rejected double-seat attempts');
});

test('stress: full 200-party queue produces distinct ready assignments and rejects overflow',t=>{
 let state=initialState();const now=Date.now();
 for(let i=0;i<200;i++)state=applyAction(state,{type:'addParty',name:'Queue '+i,size:1+i%12},'host',now+i);
 assert.throws(()=>applyAction(state,{type:'addParty',name:'Overflow',size:2},'host',now+201),/full/);
 const times=[];for(let i=0;i<10;i++){
  const start=performance.now(),plan=planWaitlist(state,now+1000);times.push(performance.now()-start);
  assert.equal(plan.rows.length,200);const assigned=new Set();
  for(const row of plan.rows.filter(r=>r.estimate?.ready))for(const table of row.estimate.tables){assert.ok(!assigned.has(table.id));assigned.add(table.id);}
 }
 times.sort((a,b)=>a-b);t.diagnostic('200-party forecast median: '+times[5].toFixed(1)+' ms; max: '+times.at(-1).toFixed(1)+' ms on test workstation');
});
