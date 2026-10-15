import test from 'node:test';
import assert from 'node:assert/strict';
import {drawingBounds,fullPlanBox} from '../public/plan-fit.js';
test('full plan removes white margins but preserves faint walls and transparent canvas edges',()=>{
 const image={width:20,height:10,data:new Uint8ClampedArray(20*10*4).fill(255)};
 const pixel=(x,y,r,g,b,a=255)=>image.data.set([r,g,b,a],(y*20+x)*4);
 pixel(3,2,220,220,220);pixel(17,7,0,0,0);pixel(0,0,0,0,0,0);
 assert.deepEqual(drawingBounds(image),{x:3,y:2,width:15,height:6});
 assert.deepEqual(fullPlanBox(null),[0,0,1660,950]);
});
test('fit includes the complete drawing and every selectable table, chair and focus target',()=>{
 const bounds={x:30,y:300,width:1600,height:350};
 const tables=[{x:10,y:290,kind:'table',orientation:'tb',capacity:20},{x:1640,y:660,kind:'booth'}];
 const [x,y,w,h]=fullPlanBox(bounds,tables);
 assert.ok(x<=10-(147/2+15));assert.ok(x+w>=1640+37);
 assert.ok(y<=290-34);assert.ok(y+h>=660+37);
 assert.ok(y<=bounds.y&&y+h>=bounds.y+bounds.height);
 assert.ok(h<950,'wide plans use a tight drawing height instead of the entire blank canvas');
 const blank={width:2,height:2,data:new Uint8ClampedArray(16).fill(255)};assert.equal(drawingBounds(blank),null);
});
