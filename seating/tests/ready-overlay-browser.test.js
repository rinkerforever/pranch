import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../../public/ready-display.js',import.meta.url),'utf8');
function fixture(){
 const node=()=>({hidden:true,children:[],append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;}});
 const elements={menu:node(),ready:node(),parties:node(),error:node()},timers=[],intervals=[];
 let now=1000,response={ok:true,status:200,json:async()=>({parties:[{name:'Jessica M.',size:6},{name:'David R.',size:4},{name:'Alex S.',size:3}]})};
 const context={URL,URLSearchParams,AbortSignal,location:{hash:'#location=preview&key=secret&source=https%3A%2F%2Fexample.com%2Fmenu'},document:{getElementById:id=>elements[id],createElement:node},performance:{now:()=>now},fetch:async()=>response,window:{addEventListener(){}},setTimeout:fn=>timers.push(fn),setInterval:(fn,ms)=>intervals.push({fn,ms})};
 vm.runInNewContext(script,context);
 return {elements,timers,intervals,setResponse:r=>response=r,setTime:n=>now=n};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('banner rotates without reloading menu, clears on failure and recovers',async()=>{
 const f=fixture();await flush();assert.equal(f.elements.ready.hidden,false);assert.equal(f.elements.menu.src,'https://example.com/menu');assert.equal(f.elements.parties.children.length,2);
 f.intervals.find(i=>i.ms===7000).fn();assert.equal(f.elements.parties.children[0].children[0].textContent,'Alex S.');
 f.setResponse({ok:false,status:503});await f.timers.shift()();assert.equal(f.elements.ready.hidden,true);assert.equal(f.elements.menu.src,'https://example.com/menu');
 f.setResponse({ok:true,json:async()=>({parties:[{name:'New guest',size:2}]})});await f.timers.shift()();assert.equal(f.elements.ready.hidden,false);
 f.setResponse({ok:true,json:async()=>({parties:[]})});await f.timers.shift()();assert.equal(f.elements.ready.hidden,true);
});
test('stale announcements expire and revoked display stops polling',async()=>{
 const f=fixture();await flush();f.setTime(17000);f.intervals.find(i=>i.ms===1000).fn();assert.equal(f.elements.ready.hidden,true);
 f.setResponse({ok:false,status:403});await f.timers.shift()();assert.equal(f.timers.length,0);assert.equal(f.elements.ready.hidden,true);
});
