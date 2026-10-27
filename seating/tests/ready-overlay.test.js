import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initialState,applyAction} from '../src/model.js';
import {overlayPages,readyParties,readyOverlayFeed} from '../../src/ready-overlay.mjs';
import mediaWorker from '../../src/index.js';

const enable=s=>applyAction(s,{type:'readyOverlaySettings',enabled:true},'manager');
test('media worker delivers the wrapper only when enabled and limits frame permissions to its page',async()=>{
 let state=enable(initialState());
 const env={ASSETS:{fetch:async()=>new Response('page')},DB:{prepare(sql){return {bind(){return this;},async first(){
  if(sql.includes('FROM devices'))return {device_id:'device',location_id:'loc',screen_id:'screen',source_type:'menu'};
  if(sql.includes('configuration_revisions'))return null;
  if(sql.includes('seating_state'))return {state_json:JSON.stringify(state)};
  throw Error(sql);
 }}}}};
 const request=()=>new Request('https://media.test/api/device/state',{headers:{authorization:'Device test'}});
 let response=await mediaWorker.fetch(request(),env);assert.equal(response.status,200);
 let data=await response.json();assert.equal(data.desired_source,'menu');assert.ok(data.pages.menu_url.startsWith('https://media.test/ready-display.html#'));
 state=applyAction(state,{type:'readyOverlaySettings',enabled:false},'manager');
 data=await(await mediaWorker.fetch(request(),env)).json();assert.ok(data.pages.menu_url.startsWith('https://green-forest-'));
 response=await mediaWorker.fetch(new Request('https://media.test/ready-display.html'),env);assert.match(response.headers.get('content-security-policy'),/frame-src https:/);
 response=await mediaWorker.fetch(new Request('https://media.test/ready-display'),env);assert.match(response.headers.get('content-security-policy'),/frame-src https:/);
 response=await mediaWorker.fetch(new Request('https://media.test/'),env);assert.doesNotMatch(response.headers.get('content-security-policy'),/frame-src https:/);
});
test('overlay defaults off, requires a manager, preserves enabled keys and revokes on disable',()=>{
 const original=initialState();assert.equal(original.readyOverlay,undefined);
 for(const role of ['host','viewer'])assert.throws(()=>applyAction(original,{type:'readyOverlaySettings',enabled:true},role),e=>e.status===403);
 assert.throws(()=>applyAction(original,{type:'readyOverlaySettings',enabled:'true'},'manager'));
 const on=enable(original);assert.equal(on.readyOverlay.key.length,64);assert.equal(enable(on).readyOverlay.key,on.readyOverlay.key);
 const off=applyAction(on,{type:'readyOverlaySettings',enabled:false},'manager');assert.deepEqual(off.readyOverlay,{enabled:false});assert.notEqual(enable(off).readyOverlay.key,on.readyOverlay.key);
 assert.equal(original.readyOverlay,undefined);
});
test('only staff-confirmed waiting guests appear, names are abbreviated and private fields excluded',()=>{
 const state=initialState();state.parties=[
  {id:'1',name:'Jessica Marie Miller',size:6,status:'waiting',readyAt:20,notes:'private',phone:'private'},
  {id:'2',name:'David Reed',size:4,status:'waiting',calledAt:10},
  {id:'3',name:'Away',size:3,status:'waiting',readyAt:1,attendance:'away'},
  {id:'4',name:'Seated',size:3,status:'seated',readyAt:1},
  {id:'5',name:'Uncalled',size:3,status:'waiting'},
  {id:'6',name:'Removed',size:3,status:'cancelled',readyAt:1}];
 assert.deepEqual(readyParties(state),[{name:'David R.',size:4},{name:'Jessica M.',size:6}]);
 const reset=applyAction(state,{type:'partyContact',id:'1',contact:'waiting'},'host');assert.deepEqual(readyParties(reset),[{name:'David R.',size:4}]);
});
test('wrapper changes only the device menu URL and keeps secrets in its fragment',()=>{
 const pages={menu_url:'https://example.com/menu?type=menu-only',ads_url:'https://example.com/ads',custom_pages:[]};
 assert.equal(overlayPages(pages,initialState(),'a','https://media.test'),pages);
 const wrapped=overlayPages(pages,enable(initialState()),'a','https://media.test');
 const url=new URL(wrapped.menu_url),params=new URLSearchParams(url.hash.slice(1));
 assert.equal(url.pathname,'/ready-display.html');assert.equal(url.search,'');assert.equal(params.get('source'),pages.menu_url);assert.equal(params.get('location'),'a');assert.equal(wrapped.ads_url,pages.ads_url);assert.equal(pages.menu_url,'https://example.com/menu?type=menu-only');
});
test('feed isolates locations, rejects revoked links and suppresses offline hub data',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE locations(id TEXT,active INTEGER);CREATE TABLE seating_state(location_id TEXT,state_json TEXT);CREATE TABLE seating_hubs(location_id TEXT,enabled INTEGER,last_seen INTEGER);');
 const a=enable(initialState()),b=enable(initialState());a.parties=[{name:'Jessica Miller',size:6,status:'waiting',readyAt:1}];
 for(const [id,state] of [['a',a],['b',b]]){db.prepare('INSERT INTO locations VALUES(?,1)').run(id);db.prepare('INSERT INTO seating_state VALUES(?,?)').run(id,JSON.stringify(state));}
 const env={DB:{prepare(sql){return {bind(...args){return {first:async()=>db.prepare(sql).get(...args)}}}}}};
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
 const get=(id,key,method='GET')=>{const url=new URL(`https://media.test/api/ready-overlay?location=${id}`);return readyOverlayFeed(new Request(url,{method,headers:{'x-ready-overlay-key':key}}),env,url,json);};
 assert.deepEqual(await (await get('a',a.readyOverlay.key)).json(),{parties:[{name:'Jessica M.',size:6}]});
 assert.equal((await get('b',a.readyOverlay.key)).status,403);assert.equal((await get('a','')).status,403);assert.equal((await get('a',a.readyOverlay.key,'POST')).status,405);
 db.prepare('INSERT INTO seating_hubs VALUES(?,1,?)').run('a',Date.now()-16000);assert.equal((await get('a',a.readyOverlay.key)).status,503);
 db.prepare('UPDATE seating_hubs SET last_seen=?').run(Date.now());assert.equal((await get('a',a.readyOverlay.key)).status,200);
 db.prepare('UPDATE seating_state SET state_json=? WHERE location_id=?').run(JSON.stringify({readyOverlay:{enabled:false}}),'a');assert.equal((await get('a',a.readyOverlay.key)).status,403);
 db.prepare('UPDATE locations SET active=0 WHERE id=?').run('b');assert.equal((await get('b',b.readyOverlay.key)).status,404);db.close();
});
