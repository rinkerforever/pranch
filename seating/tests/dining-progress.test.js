import test from 'node:test';
import assert from 'node:assert/strict';
import {diningProgress} from '../public/dining-progress.js';
const now=1800000000000;
test('dining ring excludes unoccupied or missing timestamps',()=>{
 for(const status of ['open','cleaning','reserved'])assert.equal(diningProgress({status,seatedAt:now-60000},45,now),null);
 assert.equal(diningProgress({status:'in_use'},45,now),null);
});
test('dining ring uses estimate, caps overdue and tolerates clock skew',()=>{
 const table={status:'in_use',seatedAt:now-32*60000};
 assert.equal(diningProgress(table,45,now).short,'32 / 45m');
 assert.match(diningProgress(table,45,now).description,/13 min remaining/);
 const late=diningProgress(table,30,now);assert.equal(late.percent,100);assert.equal(late.overdue,2);
 assert.equal(diningProgress({...table,seatedAt:now+60000},45,now).percent,0);
});
