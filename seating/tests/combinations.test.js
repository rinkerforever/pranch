import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyAction} from '../src/model.js';
import {nearbyPairs,presetCombinations} from '../public/combinations.js';
const t=(id,x,y,extra={})=>({id,x,y,area:'A',kind:'table',allowed:[],...extra});
test('host override combines across sections without editing links and supports seating then separation',()=>{
 const state={tables:[t('a',100,100,{status:'open',capacity:4}),t('b',300,100,{area:'B',status:'open',capacity:4})],parties:[{id:'p',name:'Guest',size:8,status:'waiting',arrivedAt:1}],history:[]};
 const action={type:'combine',ids:['a','b'],combinationOverride:true};
 assert.throws(()=>applyAction(state,{...action,combinationOverride:false},'host'),/approved combination/);
 assert.throws(()=>applyAction(state,action,'viewer'),/view-only/);
 const combined=applyAction(state,action,'host');assert.equal(combined.tables[0].group,combined.tables[1].group);
 assert.deepEqual(combined.tables.map(t=>t.allowed),[[],[]]);
 const seated=applyAction(combined,{type:'seat',partyId:'p',ids:['a','b']},'host');assert.equal(seated.parties[0].status,'seated');
 assert.throws(()=>applyAction(seated,action,'host'),/Only open/);
 const cleared=applyAction(seated,{type:'status',ids:['a','b'],status:'open'},'host');
 const split=applyAction(cleared,{type:'split',ids:['a','b']},'host');assert.ok(split.tables.every(t=>!t.group));
 const booth=structuredClone(state);booth.tables[0].kind='booth';
 assert.throws(()=>applyAction(booth,action,'host'),/booth combination/);
 assert.doesNotThrow(()=>applyAction(booth,{...action,boothAcknowledged:true},'host'));
 const partial=structuredClone(state);partial.tables.push(t('c',400,100,{status:'open',capacity:4,group:'g'}));partial.tables[0].group='g';
 assert.throws(()=>applyAction(partial,action,'host'),/entire combined/);
});
test('presets find neighbors, respect walls and sections, and exclude booth-to-booth pairs',()=>{
 const s=initialState();assert.ok(s.tables.find(t=>t.id==='B-70').allowed.includes('B-60'));
 assert.ok(s.tables.find(t=>t.id==='B-92').allowed.includes('B-91'));
 for(const a of s.tables)for(const id of a.allowed){const b=s.tables.find(t=>t.id===id);assert.equal(a.area,b.area);assert.ok(b.allowed.includes(a.id));assert.ok(a.kind!=='booth'||b.kind!=='booth');}
 assert.equal(nearbyPairs([t('a',660,740),t('b',695,740)]).length,0);
 assert.equal(nearbyPairs([t('a',1450,710),t('b',1510,710,{area:'B'})]).length,0);
 assert.equal(nearbyPairs([t('a',1450,710,{kind:'booth'}),t('b',1510,710,{kind:'booth'})]).length,0);
 assert.equal(nearbyPairs([t('a',1400,710),t('b',1450,710),t('c',1500,710)]).length,2);
});
test('presets are idempotent, preserve manual links and removals, and leave custom backgrounds alone',()=>{
 const s={tables:[t('a',1400,710,{allowed:['custom']}),t('b',1450,710)]};presetCombinations(s);
 assert.deepEqual(s.tables[0].allowed,['custom','b']);s.tables[0].allowed=['custom'];s.tables[1].allowed=[];
 presetCombinations(s);assert.deepEqual(s.tables[0].allowed,['custom']);
 const custom={background:{key:'upload'},tables:[t('a',1400,710),t('b',1450,710)]};presetCombinations(custom);assert.deepEqual(custom.tables[0].allowed,[]);
 presetCombinations(custom,true);assert.deepEqual(custom.tables[0].allowed,['b']);
});

test('distance cap stops linked chains and distant Tyler 91 suggestions; host can override',async()=>{
 const {combinationCandidates}=await import('../public/suggestions.js');
 const {withinCombinationDistance}=await import('../public/combinations.js');
 const tables=[0,1,2,3].map((n)=>t(String(n),100+n*70,100,{capacity:4,status:'open',allowed:[String(n-1),String(n+1)]}));
 assert.equal(withinCombinationDistance(tables.slice(0,3),tables),true);
 assert.equal(withinCombinationDistance(tables,tables),false);
 assert.ok(combinationCandidates(tables).every(group=>group.length<=3));
 const state={tables,parties:[{id:'p',name:'Guest',size:16,status:'waiting',arrivedAt:1}],history:[]};
 const action={type:'seat',partyId:'p',ids:tables.map(t=>t.id)};
 assert.throws(()=>applyAction(state,action,'host'),/two table spacings/);
 assert.equal(applyAction(state,{...action,combinationOverride:true},'host').parties[0].status,'seated');
 assert.throws(()=>applyAction(state,{...action,combinationOverride:true},'viewer'),/view-only/);
 const tyler=initialState(),a=tyler.tables.find(t=>t.number==='91'),b=tyler.tables.find(t=>t.id==='B-40');
 a.allowed.push(b.id);b.allowed.push(a.id);
 assert.equal(withinCombinationDistance([a,b],tyler.tables),false);
 assert.ok(combinationCandidates(tyler.tables).every(group=>!(group.includes(a)&&group.includes(b))));
});
