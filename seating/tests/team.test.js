import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyAction} from '../src/model.js';
import {SHIFT_MS,mySeatingTasks,seatingTaskIds} from '../public/team-state.js';
const now=100000,alex='tablet-alex',sam='tablet-sam';
const run=(s,a,role='host',at=now)=>applyAction(s,a,role,at,()=>crypto.randomUUID());
function setup(){let s=run(initialState(),{type:'teamSettings',enabled:true,names:['Alex','Sam']},'manager');for(const [deviceId,name] of [[alex,'Alex'],[sam,'Sam']])s=run(s,{type:'teamAssign',deviceId,name,label:name+' tablet'});return s;}
const request=(s,extra={})=>run(s,{type:'teamRequest',deviceId:alex,kind:'help',...extra});
test('team is opt-in, manager-controlled, validated, and location scoped',()=>{
 assert.throws(()=>request(initialState()),/turned off/);
 assert.throws(()=>run(initialState(),{type:'teamSettings',enabled:true,names:[]}),/Manager/);
 assert.throws(()=>run(initialState(),{type:'teamSettings',enabled:true,names:['Alex','alex']},'manager'),/different/);
 assert.throws(()=>run(setup(),{type:'teamAssign',deviceId:sam,name:'Sam',label:'Floor'},'viewer'),/view-only/);
 assert.throws(()=>request(initialState()),/turned off/);
 let s=request(setup());s=run(s,{type:'teamSettings',enabled:false,names:['Alex','Sam']},'manager');assert.deepEqual(s.team.tasks,[]);assert.deepEqual(s.team.tablets,[]);assert.throws(()=>request(s),/turned off/);
});
test('staff move between tablets and old accepted tasks return to team',()=>{
 let s=request(setup());s=run(s,{type:'teamAccept',deviceId:sam,id:s.team.tasks[0].id});
 s=run(s,{type:'teamAssign',deviceId:'tablet-new',name:'Sam',label:'Floor'});
 assert.equal(s.team.tablets.filter(t=>t.name==='Sam').length,1);assert.equal(s.team.tasks[0].status,'pending');assert.equal(s.team.tasks[0].owner,null);
 assert.throws(()=>run(s,{type:'teamAccept',deviceId:sam,id:s.team.tasks[0].id}),/Choose who/);
});
test('requests have one owner, enforce target, and only owner can finish',()=>{
 let s=request(setup(),{target:sam}),id=s.team.tasks[0].id;
 assert.throws(()=>run(s,{type:'teamAccept',deviceId:alex,id}),/another teammate/);
 s=run(s,{type:'teamAccept',deviceId:sam,id});assert.equal(s.team.tasks[0].ownerName,'Sam');
 assert.throws(()=>run(s,{type:'teamAccept',deviceId:sam,id}),/another teammate/);
 assert.throws(()=>run(s,{type:'teamDone',deviceId:alex,id}),/Only the assigned/);
 s=run(s,{type:'teamDone',deviceId:sam,id});assert.equal(s.team.tasks[0].status,'done');
 assert.throws(()=>run(s,{type:'teamAccept',deviceId:sam,id}),/no longer active/);
});
test('seat handoff stays highlighted until its owner confirms Done after real seating',()=>{
 let s=run(setup(),{type:'addParty',name:'Johnson',size:6,highChair:true}),partyId=s.parties[0].id;
 s=request(s,{kind:'seat',partyId,ids:['C-71'],target:sam});const id=s.team.tasks[0].id;
 assert.equal(mySeatingTasks(s,sam,now).length,1);assert.equal(mySeatingTasks(s,alex,now).length,0);
 s=run(s,{type:'teamAccept',deviceId:sam,id});assert.equal(s.parties[0].status,'waiting');assert.equal(s.tables.find(t=>t.id==='C-71').status,'open');
 assert.throws(()=>run(s,{type:'teamDone',deviceId:sam,id}),/floor controls/);
 assert.throws(()=>run(s,{type:'seat',partyId,ids:['C-72']}),/enough seats/);
 s=run(s,{type:'seat',partyId,ids:['C-71']});assert.equal(s.team.tasks[0].status,'accepted');assert.equal(mySeatingTasks(s,sam,now).length,1);
 assert.throws(()=>run(s,{type:'teamDone',deviceId:alex,id}),/Only the assigned/);
 const finished=run(s,{type:'teamDone',deviceId:sam,id});assert.equal(finished.team.tasks[0].status,'done');assert.equal(mySeatingTasks(finished,sam,now).length,0);assert.equal(finished.tables.find(t=>t.id==='C-71').status,'in_use');
 s=run(s,{type:'undo',undoId:s.lastUndo.id});assert.equal(s.team.tasks[0].status,'accepted');assert.equal(s.parties[0].status,'waiting');
 s=run(s,{type:'cancelParty',id:partyId});assert.equal(s.team.tasks[0].status,'cancelled');
});
test('broadcast handoffs highlight only after acceptance and clear on return, shift end, disable or expiry',()=>{
 let s=run(setup(),{type:'addParty',name:'Smith',size:2});s=request(s,{kind:'seat',partyId:s.parties[0].id,ids:['C-71']});const id=s.team.tasks[0].id;
 assert.deepEqual(mySeatingTasks(s,sam,now),[]);
 s=run(s,{type:'teamAccept',deviceId:sam,id});assert.equal(mySeatingTasks(s,sam,now).length,1);
 assert.equal(mySeatingTasks(run(s,{type:'teamReturn',deviceId:sam,id}),sam,now).length,0);
 assert.equal(mySeatingTasks(run(s,{type:'teamAssign',deviceId:sam,name:'',label:'Floor'}),sam,now).length,0);
 assert.equal(mySeatingTasks(run(s,{type:'teamSettings',enabled:false,names:['Alex','Sam']},'manager'),sam,now).length,0);
 assert.equal(mySeatingTasks(s,sam,now+SHIFT_MS).length,0);
});
test('highlight follows the actual seated tables if the party is seated elsewhere',()=>{
 let s=run(setup(),{type:'addParty',name:'Smith',size:2}),partyId=s.parties[0].id;s=request(s,{kind:'seat',partyId,ids:['C-71'],target:sam});const id=s.team.tasks[0].id;
 s=run(s,{type:'teamAccept',deviceId:sam,id});s=run(s,{type:'seat',partyId,ids:['C-51']});
 assert.deepEqual(seatingTaskIds(s,mySeatingTasks(s,sam,now)[0]),['C-51']);
 s=run(s,{type:'status',ids:['C-51'],status:'cleaning'});assert.deepEqual(mySeatingTasks(s,sam,now),[]);
});
test('cleanup completes only when tables are actually open',()=>{
 let s=setup();assert.throws(()=>request(s,{kind:'clean',ids:['C-71']}),/need cleaning/);
 s=run(s,{type:'status',ids:['C-71'],status:'cleaning'});s=request(s,{kind:'clean',ids:['C-71']});
 s=run(s,{type:'status',ids:['C-71'],status:'open'});assert.equal(s.team.tasks[0].status,'done');
});
test('duplicate, stale, invalid and unassigned requests are rejected without mutation',()=>{
 let s=request(setup()),before=JSON.stringify(s);assert.throws(()=>request(s),/already an active/);assert.equal(JSON.stringify(s),before);
 assert.throws(()=>request(s,{kind:'chair',ids:['missing']}),/valid tables/);
 assert.throws(()=>request(s,{kind:'seat',ids:['C-71'],partyId:'missing'}),/waiting party/);
 assert.throws(()=>request(s,{deviceId:'unassigned-device'}),/Choose who/);
 assert.throws(()=>run(s,{type:'teamAccept',deviceId:sam,id:s.team.tasks[0].id},'host',now+SHIFT_MS),/Choose who/);
 s=run(s,{type:'teamAssign',deviceId:sam,name:'Sam',label:'Floor'},'host',now+SHIFT_MS);assert.equal(s.team.tasks[0].status,'expired');
});
test('history retention never drops unfinished work',()=>{
 let s=request(setup());const first=s.team.tasks[0].id;
 for(let i=0;i<110;i++){
  s=request(s,{kind:'chair',ids:['C-71']});const id=s.team.tasks.at(-1).id;
  s=run(s,{type:'teamAccept',deviceId:sam,id});s=run(s,{type:'teamDone',deviceId:sam,id});
 }
 assert.equal(s.team.tasks.find(t=>t.id===first).status,'pending');assert.equal(s.team.tasks.length,51);
});
test('Seat now atomically assigns a seated walk-in and its highlighted tables to a teammate',()=>{
 let s=setup();s=run(s,{type:'seatNow',name:'Taylor',size:4,ids:['C-71'],teamTarget:sam,deviceId:alex});
 const party=s.parties.find(p=>p.name==='Taylor'),task=s.team.tasks[0];
 assert.equal(party.status,'seated');assert.equal(task.partyId,party.id);assert.equal(task.target,sam);assert.equal(task.status,'pending');
 assert.equal(mySeatingTasks(s,sam,now).length,1);assert.equal(mySeatingTasks(s,alex,now).length,0);
 const undone=run(s,{type:'undo',undoId:s.lastUndo.id});assert.equal(undone.parties.length,0);assert.equal(undone.team.tasks.length,0);assert.equal(undone.tables.find(t=>t.id==='C-71').status,'open');
 s=run(s,{type:'teamAccept',deviceId:sam,id:task.id});s=run(s,{type:'teamDone',deviceId:sam,id:task.id});assert.equal(mySeatingTasks(s,sam,now).length,0);assert.equal(s.tables.find(t=>t.id==='C-71').status,'in_use');
});
test('assigned seating rejects unavailable recipients or invalid seats without seating or creating tasks',()=>{
 const s=setup(),before=JSON.stringify(s),a={type:'seatNow',size:4,ids:['C-71'],teamTarget:sam,deviceId:alex};
 for(const action of [{...a,teamTarget:'missing-tablet'},{...a,teamTarget:alex},{...a,deviceId:'missing-tablet'},{...a,size:100}])assert.throws(()=>run(s,action));
 assert.equal(JSON.stringify(s),before);
 assert.throws(()=>run(s,a,'viewer'),/view-only/);
 assert.throws(()=>run(s,a,'host',now+SHIFT_MS),/Choose who/);
 const off=run(s,{type:'teamSettings',enabled:false,names:['Alex','Sam']},'manager');assert.throws(()=>run(off,a),/turned off/);
 const own=run(off,{type:'seatNow',size:4,ids:['C-71']});assert.equal(own.parties[0].status,'seated');assert.equal(own.team.tasks.length,0);
});
test('an existing waiting party can be seated and assigned in one action',()=>{
 let s=run(setup(),{type:'addParty',name:'Waiting guest',size:2}),partyId=s.parties[0].id;
 s=run(s,{type:'seat',partyId,ids:['C-71'],teamTarget:sam,deviceId:alex});
 assert.equal(s.parties.length,1);assert.equal(s.parties[0].status,'seated');assert.equal(s.team.tasks[0].partyId,partyId);assert.equal(mySeatingTasks(s,sam,now).length,1);
});
