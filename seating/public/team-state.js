// Shared location-scoped team workflow. Tablet names identify shifts, not login permissions.
export const SHIFT_MS=12*60*60*1000;
export const teamActive=t=>['pending','accepted'].includes(t.status);
export const teamAssignments=(s,now=Date.now())=>(s.team?.tablets||[]).filter(t=>t.name&&now-t.at<SHIFT_MS);
export function seatingTaskIds(s,task){
 const party=s.parties.find(p=>p.id===task.partyId);
 return party?.status==='seated'?s.tables.filter(t=>t.party===party.id).map(t=>t.id):task.ids;
}
export function mySeatingTasks(s,deviceId,now=Date.now()){
 if(!s?.team?.enabled)return [];
 const me=teamAssignments(s,now).find(t=>t.id===deviceId);if(!me)return [];
 return (s.team.tasks||[]).filter(t=>t.kind==='seat'&&teamActive(t)&&now-t.at<SHIFT_MS&&
  (t.owner?t.owner===deviceId&&t.ownerName===me.name:t.target===deviceId)&&
  s.parties.some(p=>p.id===t.partyId&&['waiting','seated'].includes(p.status)));
}
export function reconcileTeam(s,now){
 if(!s.team)return;
 const tablets=teamAssignments(s,now);
 for(const t of s.team.tasks||[]){
  if(!teamActive(t))continue;
  const party=s.parties.find(p=>p.id===t.partyId),tables=t.ids.map(id=>s.tables.find(v=>v.id===id));
  if(now-t.at>=SHIFT_MS){t.status='expired';t.updatedAt=now;continue;}
  if(t.kind==='seat'&&!['waiting','seated'].includes(party?.status)||tables.some(v=>!v)){t.status='cancelled';t.updatedAt=now;continue;}
  if(t.kind==='clean'&&tables.every(v=>v.status==='open')){t.status='done';t.updatedAt=now;continue;}
  if(t.kind==='clean'&&tables.some(v=>!['open','cleaning'].includes(v.status))){t.status='cancelled';t.updatedAt=now;continue;}
  if(t.owner&&!tablets.some(v=>v.id===t.owner&&v.name===t.ownerName)){t.status='pending';t.owner=null;t.ownerName=null;t.target=null;t.updatedAt=now;}
  if(t.target&&!tablets.some(v=>v.id===t.target)){t.target=null;t.updatedAt=now;}
 }
 s.team.tablets=tablets;
 const tasks=s.team.tasks||[];
 const recent=tasks.filter(t=>!teamActive(t)&&now-(t.updatedAt||t.at)<86400000).slice(-50);
 s.team.tasks=tasks.filter(t=>teamActive(t)||recent.includes(t));
}
export function applyTeam(s,a,role,now,uuid,fail){
 if(a.type==='teamSettings'){
  if(!['admin','manager'].includes(role))fail('Manager access required.');
  if(typeof a.enabled!=='boolean'||!Array.isArray(a.names)||a.names.length>40||a.names.some(n=>typeof n!=='string'||!n.trim()||n.trim().length>30))fail('Enter up to 40 staff names, each at most 30 characters.');
  const names=a.names.map(n=>n.trim());if(new Set(names.map(n=>n.toLowerCase())).size!==names.length)fail('Use different staff names.');
  s.team={enabled:a.enabled,names,tablets:a.enabled?(s.team?.tablets||[]):[],tasks:a.enabled?(s.team?.tasks||[]):[]};
  s.team.tablets=s.team.tablets.filter(t=>names.includes(t.name));reconcileTeam(s,now);return;
 }
 if(!s.team?.enabled)fail('Team communication is turned off for this location.');
 reconcileTeam(s,now);
 if(typeof a.deviceId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(a.deviceId))fail('Reload this tablet before using Team.');
 if(a.type==='teamAssign'){
  if(a.name!==''&&!s.team.names.includes(a.name))fail('Choose a staff name from this location.');
  if(typeof a.label!=='string'||!a.label.trim()||a.label.length>30)fail('Enter a tablet label of up to 30 characters.');
  s.team.tablets=s.team.tablets.filter(t=>t.id!==a.deviceId&&(!a.name||t.name!==a.name));
  if(a.name){if(s.team.tablets.length>=40)fail('Maximum 40 assigned tablets.');s.team.tablets.push({id:a.deviceId,name:a.name,label:a.label.trim(),at:now});}
  reconcileTeam(s,now);return;
 }
 const me=s.team.tablets.find(t=>t.id===a.deviceId);if(!me)fail('Choose who is using this tablet first.');
 if(a.type==='teamRequest'){
  if(!['seat','clean','help','chair'].includes(a.kind))fail('Choose a quick request.');
  const ids=a.ids||[];
  if(!Array.isArray(ids)||ids.length>12||new Set(ids).size!==ids.length||ids.some(id=>!s.tables.some(t=>t.id===id)))fail('Select valid tables.');
  if(a.kind!=='help'&&!ids.length)fail('Select a table first.');
  if(a.kind==='clean'&&ids.some(id=>s.tables.find(t=>t.id===id).status!=='cleaning'))fail('Select tables that need cleaning.');
  if(a.kind==='seat'&&!s.parties.some(p=>p.id===a.partyId&&p.status==='waiting'&&p.attendance!=='away'))fail('Choose a waiting party who is present.');
  if(a.target&&!s.team.tablets.some(t=>t.id===a.target&&t.id!==a.deviceId))fail('That teammate is no longer assigned.');
  if(s.team.tasks.filter(teamActive).length>=50)fail('Finish existing requests before adding more.');
  if(s.team.tasks.some(t=>teamActive(t)&&t.kind===a.kind&&(a.kind==='seat'?t.partyId===a.partyId:a.kind==='help'||t.ids.some(id=>ids.includes(id)))))fail('There is already an active request for this.');
  s.team.tasks.push({id:uuid(),kind:a.kind,ids:[...ids],partyId:a.kind==='seat'?a.partyId:null,from:me.id,fromName:me.name,target:a.target||null,status:'pending',at:now,updatedAt:now});return;
 }
 const task=s.team.tasks.find(t=>t.id===a.id&&teamActive(t));if(!task)fail('This request is no longer active.');
 if(a.type==='teamAccept'){
  if(task.status!=='pending'||task.target&&task.target!==me.id)fail('This request is assigned to another teammate.');
  Object.assign(task,{status:'accepted',owner:me.id,ownerName:me.name});
 }else if(a.type==='teamReturn'){
  if(task.owner!==me.id&&task.target!==me.id)fail('Only the assigned teammate can return this request.');
  Object.assign(task,{status:'pending',owner:null,ownerName:null,target:null});
 }else if(a.type==='teamCancel'){
  if(task.from!==me.id&&!['admin','manager'].includes(role))fail('Only the sender or a manager can cancel this request.');task.status='cancelled';
 }else if(a.type==='teamDone'){
  if(task.owner!==me.id)fail('Only the assigned teammate can finish this request.');
  if(task.kind==='seat'&&!s.parties.some(p=>p.id===task.partyId&&p.status==='seated'))fail('Seat the party using the floor controls before marking this request done.');
  if(!['help','chair','seat'].includes(task.kind))fail('Finish cleaning using the floor controls.');task.status='done';
 }else fail('Unknown team action.');
 task.updatedAt=now;
}
