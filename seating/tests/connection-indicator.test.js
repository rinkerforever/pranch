import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionIndicator} from '../public/connection-indicator.js';
const now=100000,base={now,confirmedAt:now,reachable:true};
test('connection box distinguishes the device connection from a cloud relay to the Pi',()=>{
 const connection={mode:'local',online:true};
 assert.deepEqual(connectionIndicator({...base,mode:'local',connection}).label,'Local · Connected');
 assert.equal(connectionIndicator({...base,mode:'cloud',connection}).label,'Cloud · Connected');
 assert.equal(connectionIndicator({...base,mode:'cloud'}).tone,'connected');
 assert.equal(connectionIndicator({...base,mode:'local',connection:{mode:'local',online:false}}).tone,'warning');
 assert.equal(connectionIndicator({...base,mode:'cloud',connection:{mode:'local',online:false}}).tone,'error');
});
test('connection box never shows green for startup, lost or stale connections, recovery or preview',()=>{
 assert.equal(connectionIndicator({now,reachable:true}).tone,'checking');
 assert.equal(connectionIndicator({...base,reachable:false}).tone,'error');
 assert.equal(connectionIndicator({...base,confirmedAt:now-30001}).tone,'error');
 assert.equal(connectionIndicator({...base,mode:'local',confirmedAt:now-15001}).tone,'error');
 assert.equal(connectionIndicator({...base,connection:{requiresRecovery:true}}).tone,'error');
 assert.equal(connectionIndicator({...base,preview:true}).tone,'checking');
});
