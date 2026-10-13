import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../src/model.js';
import {nearbyPairs,presetCombinations} from '../public/combinations.js';
const t=(id,x,y,extra={})=>({id,x,y,area:'A',kind:'table',allowed:[],...extra});
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
