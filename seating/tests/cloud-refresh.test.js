import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('slow cloud refreshes do not overlap and release their guard after completion',async()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const refresh=source.slice(source.indexOf('const pendingRefreshes='),source.indexOf('async function act('));
 let resolve,calls=0;
 const context=vm.createContext({Date,Set,api:()=>{calls++;return new Promise(r=>resolve=r);},endpoint:()=>'/state',
  locationId:'test',busy:false,uploadBusy:false,demo:false,version:0,role:'host',editing:false,runtime:{mode:'cloud'},
  $:()=>({open:false}),renderWait(){},renderSelection(){},renderRoomBookings(){},connectionStatus(){},showReadyAlert(){}});
 vm.runInContext(refresh,context);
 const first=vm.runInContext('refresh()',context);await vm.runInContext('refresh()',context);assert.equal(calls,1);
 resolve({version:0,role:'host',connection:{mode:'cloud'}});await first;
 const next=vm.runInContext('refresh()',context);assert.equal(calls,2);resolve({version:0,role:'host',connection:{mode:'cloud'}});await next;
});
