import test from 'node:test';
import assert from 'node:assert/strict';
import {keyedChildren,floorImageUrl} from '../public/render-cache.js';
function parent(){return {children:[],moves:0,insertBefore(node,before){this.moves++;const i=this.children.indexOf(node);if(i>=0)this.children.splice(i,1);this.children.splice(before?this.children.indexOf(before):this.children.length,0,node);node.remove=()=>this.children.splice(this.children.indexOf(node),1);}};}
test('unchanged tables retain nodes, only changes rebuild, and removed/reordered guests reconcile',()=>{
 const root=parent();let built=0;
 const update=rows=>keyedChildren(root,rows,r=>r.id,r=>JSON.stringify(r),r=>({id:r.id,created:++built}));
 update([{id:'a',status:'open'},{id:'b',status:'open'}]);const [a,b]=root.children;root.moves=0;
 update([{id:'a',status:'open'},{id:'b',status:'open'}]);assert.equal(built,2);assert.equal(root.moves,0);
 update([{id:'a',status:'in_use'},{id:'b',status:'open'}]);assert.equal(built,3);assert.notEqual(root.children[0],a);assert.equal(root.children[1],b);
 const changed=root.children[0];update([{id:'b',status:'open'},{id:'a',status:'in_use'}]);assert.deepEqual(root.children,[b,changed]);assert.equal(built,3);
 update([{id:'b',status:'open'}]);assert.deepEqual(root.children,[b]);update([]);assert.equal(root.children.length,0);
});
test('floor image identity changes only with the stored image, not table changes or cleanup covers',()=>{
 const bg={key:'seating/store/plan one.png',covers:[]};const url=floorImageUrl('/api/locations/store/floorplan',bg);
 assert.equal(floorImageUrl('/api/locations/store/floorplan',{...bg,covers:[{x:1}]}),url);
 assert.notEqual(floorImageUrl('/api/locations/store/floorplan',{key:'seating/store/new.png'}),url);
 assert.equal(floorImageUrl('/unused',{dataUrl:'data:image/png;base64,test'},true),'data:image/png;base64,test');
});
