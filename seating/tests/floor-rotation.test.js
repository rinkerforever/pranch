import test from 'node:test';
import assert from 'node:assert/strict';
import {rotateFloorBox,rotateFloorPoint} from '../public/floor-rotation.js';
test('rotation keeps each table inside its rotated section and reverses pointer mapping',()=>{
 for(const box of [[0,-20,1660,950],[1300,540,340,350],[1010,-10,190,200],[50,160,420,220]]){
  const [x,y,w,h]=box,point={x:x+w*.3,y:y+h*.7};
  const rotated=rotateFloorPoint(point),[rx,ry,rw,rh]=rotateFloorBox(box);
  assert.ok(rotated.x>=rx&&rotated.x<=rx+rw&&rotated.y>=ry&&rotated.y<=ry+rh);
  assert.deepEqual(rotateFloorPoint(rotated),point);
  assert.deepEqual(rotateFloorBox(rotateFloorBox(box)),box);
 }
});
