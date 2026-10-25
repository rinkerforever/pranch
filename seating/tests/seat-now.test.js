import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAction} from '../src/model.js';
import {planWaitlist,seatingOptions,estimateNewParty,waitSettings} from '../public/wait-plan.js';
import {suggestTables} from '../public/suggestions.js';
const now=10_000_000;
const table=(id,area='A',extra={})=>({id,number:id,area,x:100,y:100,capacity:4,status:'open',kind:'table',orientation:'lr',allowed:[],group:null,party:null,...extra});
const state=()=>({tables:[table('near'),table('other','B')],parties:[],history:[],areaConfig:[{id:'A',name:'Near buffet',kind:'section',accessiblePreferred:true},{id:'B',name:'Back dining',kind:'section'}]});
const ids=()=>{let n=0;return ()=>`new-${++n}`;};
test('Seat now creates and seats one party atomically, with equipment and accessibility needs',()=>{
 const original=state(),result=applyAction(original,{type:'seatNow',size:4,ids:['near'],highChair:true,booster:true,accessibility:true},'host',now,ids());
 assert.equal(result.parties.length,1);const party=result.parties[0];
 assert.equal(party.name,'Walk-in');assert.equal(party.status,'seated');assert.equal(party.seatedAt,now);assert.equal(party.source,'seat-now');
 assert.equal(party.highChair,true);assert.equal(party.booster,true);assert.equal(party.accessibility,true);
 assert.equal(result.tables[0].party,party.id);assert.equal(result.tables[0].status,'in_use');assert.equal(result.history[0].type,'seatNow');assert.equal(original.parties.length,0);
 assert.throws(()=>applyAction(original,{type:'seatNow',size:4,ids:['near']},'viewer',now),/view-only/);
 for(const action of [{size:5,ids:['near']},{size:4,ids:['missing']},{size:4,ids:['near'],accessibility:'yes'}])assert.throws(()=>applyAction(original,{type:'seatNow',...action},'host',now));
 assert.equal(original.parties.length,0);
});
test('Seat now cannot steal tables planned for waiting guests or seat an occupied table',()=>{
 const s=state();s.parties=[{id:'waiting',name:'Waiting',size:4,status:'waiting',arrivedAt:1}];
 assert.throws(()=>applyAction(s,{type:'seatNow',size:2,ids:['near']},'host',now),/planned for waiting/);
 const result=applyAction(s,{type:'seatNow',size:2,ids:['other']},'host',now,ids());assert.equal(result.parties[0].status,'waiting');assert.equal(result.parties[1].status,'seated');
 s.tables[1].status='in_use';assert.throws(()=>applyAction(s,{type:'seatNow',size:2,ids:['other']},'host',now),/occupied/);
 s.tables[1].status='reserved';s.tables[1].roomBlock='held';assert.throws(()=>applyAction(s,{type:'seatNow',size:2,ids:['other']},'host',now));
});
test('Seat now validates combinations, capacity and future room bookings before committing',()=>{
 const s=state();s.tables=[table('a','A',{allowed:['b']}),table('b','A',{allowed:['a']})];
 const action={type:'seatNow',name:'Large party',size:7,ids:['a','b']};
 const result=applyAction(s,action,'host',now,ids());assert.equal(result.parties[0].size,7);assert.ok(result.tables[0].group);assert.equal(result.tables[0].group,result.tables[1].group);
 s.roomSchedule=[{id:'booking',status:'scheduled',areas:['A'],startsAt:now+30*60000,endsAt:now+120*60000}];
 assert.throws(()=>applyAction(s,action,'host',now),/upcoming room booking/);assert.equal(s.parties.length,0);
});
test('preferred areas are store-specific, manager-only and remain flagged when old clients rename them',()=>{
 const s=state(),action={type:'saveArea',id:'B',name:'Quiet dining',kind:'section',accessiblePreferred:true};
 assert.throws(()=>applyAction(s,action,'host',now),/Manager/);
 const edited=applyAction(s,action,'manager',now);assert.equal(edited.areaConfig[1].accessiblePreferred,true);assert.equal(s.areaConfig[1].accessiblePreferred,undefined);
 const renamed=applyAction(edited,{type:'saveArea',id:'B',name:'Updated name',kind:'section'},'manager',now);assert.equal(renamed.areaConfig[1].accessiblePreferred,true);
 assert.throws(()=>applyAction(s,{...action,accessiblePreferred:'yes'},'manager',now),/checkbox/);
});
test('accessible guests get preferred open seating and a preferred upcoming fit within 15 extra minutes',()=>{
 const s=state();let plan=planWaitlist(s,now);
 assert.equal(seatingOptions(plan,4,{accessibility:true}).open[0].tables[0].id,'near');
 assert.equal(suggestTables(s.tables,4,5,new Set(['A']))[0][0].id,'near');
 s.tables[0].status='in_use';s.tables[0].seatedAt=now-60*60000;plan=planWaitlist(s,now);
 const preferred=estimateNewParty(plan,4,{accessibility:true});assert.equal(preferred.tables[0].id,'near');assert.equal(preferred.minutes,15);assert.equal(preferred.ready,false);
 const options=seatingOptions(plan,4,{accessibility:true});assert.equal(options.open[0].tables[0].id,'other');assert.equal(options.soon[0].accessiblePreferred,true);
 s.tables[0].seatedAt=now-5*60000;assert.equal(estimateNewParty(planWaitlist(s,now),4,{accessibility:true}).tables[0].id,'other');
 s.parties=[{id:'accessible',size:4,accessibility:true,status:'waiting',arrivedAt:1}];s.tables[0].seatedAt=now-60*60000;
 assert.equal(planWaitlist(s,now).rows[0].estimate.accessiblePreferred,true);
});
test('forecasts shrink with time, account for the queue, and never turn occupied tables into open tables',()=>{
 const s=state();s.tables=[table('a','A',{status:'in_use',seatedAt:now-40*60000})];
 assert.equal(estimateNewParty(planWaitlist(s,now),4).minutes,25);
 assert.equal(estimateNewParty(planWaitlist(s,now+10*60000),4).minutes,15);
 assert.equal(seatingOptions(planWaitlist(s,now),4).open.length,0);assert.equal(s.tables[0].status,'in_use');
 s.parties=[{id:'queue',size:4,status:'waiting',arrivedAt:1}];assert.equal(seatingOptions(planWaitlist(s,now),4).soon.length,0);
 assert.equal(seatingOptions(planWaitlist(s,now),9).open.length,0);
});
test('real completed visits and manually cleared tables train the recent mean without double-counting groups',()=>{
 let s=state();s.parties=[20,30,100].map((n,i)=>({id:`done${i}`,status:'completed',seatedAt:1000,closedAt:1000+n*60000}));
 assert.equal(waitSettings(s).diningMinutes,50);assert.equal(waitSettings(s).observedMinutes,50);
 s.tables=[table('a','A',{status:'in_use',group:'g',seatedAt:now-60*60000}),table('b','A',{status:'in_use',group:'g',seatedAt:now-60*60000})];
 s=applyAction(s,{type:'status',ids:['a','b'],status:'cleaning'},'host',now);assert.equal(s.diningSamples.length,1);assert.equal(waitSettings(s).diningMinutes,53);
 s=applyAction(s,{type:'status',ids:['a','b'],status:'open'},'host',now+60000);assert.equal(s.diningSamples.length,1);
 s=applyAction(s,{type:'waitSettings',diningMinutes:90,cleaningMinutes:3},'host',now);assert.equal(waitSettings(s).diningMinutes,90);
 s=applyAction(s,{type:'waitSettings',automatic:true},'host',now);assert.equal(waitSettings(s).diningMinutes,53);
});

test('Seat now puts the floor selection first even outside the five recommendations',()=>{
 const s=state();s.tables=Array.from({length:8},(_,i)=>table('t'+i));
 let options=seatingOptions(planWaitlist(s,now),2,{selectedIds:['t7']});
 assert.equal(options.open[0].tables[0].id,'t7');assert.equal(options.open[0].selectedOnFloor,true);
 assert.equal(options.open.filter(o=>o.tables[0].id==='t7').length,1);
 s.tables[7].status='cleaning';options=seatingOptions(planWaitlist(s,now),2,{selectedIds:['t7']});assert.ok(options.open.every(o=>!o.selectedOnFloor));
 s.tables[7].status='open';options=seatingOptions(planWaitlist(s,now),8,{selectedIds:['t7']});assert.ok(options.open.every(o=>!o.selectedOnFloor));
 s.parties=[{id:'p',name:'First',size:4,status:'waiting',arrivedAt:1}];options=seatingOptions(planWaitlist(s,now),2,{selectedIds:['t0']});assert.ok(options.open.every(o=>!o.selectedOnFloor));
});
test('an explicitly selected valid combination remains first instead of being reduced to a smaller table',()=>{
 const s=state();s.tables[0].allowed=['other'];s.tables[1].allowed=['near'];s.tables[1].area='A';
 const options=seatingOptions(planWaitlist(s,now),2,{selectedIds:['near','other']});
 assert.equal(options.open[0].tables.length,2);assert.equal(options.open[0].selectedOnFloor,true);
});
