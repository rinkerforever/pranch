import {teamAssignments,teamActive,SHIFT_MS,mySeatingTasks,seatingTaskIds} from './team-state.js';
export function createTeam({getContext,save,openFloor,toast}){
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 let deviceId=localStorage.getItem('seating-team-device');if(!deviceId){deviceId=crypto.randomUUID();localStorage.setItem('seating-team-device',deviceId);}
 const button=el('button','Team','quiet');button.id='team-open';button.hidden=true;button.setAttribute('aria-expanded','false');
 document.querySelector('.top-actions').prepend(button);
 const settings=el('button','Team communication');settings.id='team-settings-open';document.querySelector('.settings-actions').append(settings);
 const panel=el('aside',null,'team-panel');panel.hidden=true;panel.setAttribute('aria-label','Team communication');panel.id='team-panel';button.setAttribute('aria-controls',panel.id);
 const head=el('div',null,'panel-title'),title=el('h2','Team'),close=el('button','Close');head.append(title,close);
 const body=el('div');panel.append(head,body);document.getElementById('app').append(panel);
 const guidance=el('section',null,'team-seating-guidance');guidance.id='team-seating-guidance';guidance.hidden=true;guidance.setAttribute('aria-label','Your seating assignments');document.getElementById('ready-banner').before(guidance);
 let guidanceKey='';
 let lastKey='',lastLocation=null,seen=new Map(),initialized=false,target='';
 const shut=()=>{panel.hidden=true;button.setAttribute('aria-expanded','false');};close.onclick=()=>{shut();button.focus();};
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){shut();button.focus();}});
 button.onclick=()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));lastKey='';refresh();if(!panel.hidden)close.focus();};
 function action(type,extra={}){return save({type,deviceId,...extra});}
 function btn(text,fn,disabled=false){const b=el('button',text);b.disabled=disabled;b.onclick=fn;return b;}
 function showTask(task){shut();openFloor({...task,ids:seatingTaskIds(getContext().state,task)});}
 async function acceptTask(task){if(await action('teamAccept',{id:task.id})&&task.kind==='seat')showTask(task);}
 function paintHighlights(){
  const s=getContext().state,ids=new Set(mySeatingTasks(s,deviceId).flatMap(t=>seatingTaskIds(s,t)));
  for(const node of document.querySelectorAll('#floor-tables .table-node')){
   const active=ids.has(node.dataset.id);node.classList.toggle('team-seat-target',active);
   const label=node.getAttribute('aria-label').replace(/, Your seating assignment$/,'');node.setAttribute('aria-label',label+(active?', Your seating assignment':''));
  }
 }
 function renderGuidance(c){
  const tasks=mySeatingTasks(c.state,deviceId),s=c.state;guidance.hidden=!tasks.length;paintHighlights();
  const key=JSON.stringify([c.locationId,c.canWrite,tasks.map(t=>[t.id,t.status,t.owner,taskTitle(t,s),s.parties.find(p=>p.id===t.partyId)?.status])]);if(key===guidanceKey)return;guidanceKey=key;guidance.replaceChildren();
  for(const task of tasks){
   const row=el('div',null,'team-seating-row'),copy=el('div'),seated=s.parties.find(p=>p.id===task.partyId)?.status==='seated';
   copy.append(el('strong',taskTitle(task,s)),el('p',seated?'Party seated · Tap Done to clear your highlight.':'Your assigned tables are outlined in purple.','muted'));row.append(copy);
   row.append(btn('Show table',()=>showTask(task)));
   if(task.status==='pending')row.append(btn('I’ve got it',()=>acceptTask(task),!c.canWrite));
   else row.append(btn('Done',()=>action('teamDone',{id:task.id}),!c.canWrite||!seated));
   guidance.append(row);
  }
 }
 function assign(){
  const c=getContext(),s=c.state;if(!s?.team?.enabled)return;
  const d=el('dialog'),h=el('h2','Who is using this tablet?'),label=el('label','Tablet label'),input=el('input');input.maxLength=30;input.value=teamAssignments(s).find(t=>t.id===deviceId)?.label||localStorage.getItem('seating-team-label')||'Tablet';label.append(input);
  d.append(h,label,el('p','Tap your name to start or renew a 12-hour shift. Choosing a name moves it from its previous tablet.','muted'));
  const choices=el('div',null,'team-choices');
  for(const name of s.team.names)choices.append(btn(name,async()=>{if(c.locationId!==getContext().locationId){d.close();return;}if(await action('teamAssign',{name,label:input.value.trim()})){localStorage.setItem('seating-team-label',input.value.trim());d.close();}},!c.canWrite));
  if(!s.team.names.length)d.append(el('p','A manager can add staff names in Settings → Team communication.'));
  d.append(choices,btn('End my shift',async()=>{if(c.locationId!==getContext().locationId){d.close();return;}if(await action('teamAssign',{name:'',label:input.value.trim()||'Tablet'}))d.close();},!c.canWrite),btn('Close',()=>d.close()));document.body.append(d);d.onclose=()=>d.remove();d.showModal();
 }
 settings.onclick=()=>{
  const c=getContext();if(!c.state)return;
  const d=el('dialog'),h=el('h2','Team communication'),label=el('label',null,'equipment-toggle'),toggle=el('input');toggle.type='checkbox';toggle.checked=!!c.state.team?.enabled;label.append(toggle,' Enable for this location');
  const namesLabel=el('label','Staff names — one per line'),names=el('textarea');names.rows=7;names.value=(c.state.team?.names||[]).join('\n');namesLabel.append(names);toggle.disabled=names.disabled=!c.canEdit;
  d.append(h,el('p',c.locationName),label,namesLabel,el('p','Off by default. Turning this off clears requests and tablet assignments. Staff tap a name once per shift; everyday requests need no typing.','muted'),btn('Save',async()=>{if(c.locationId!==getContext().locationId){d.close();return;}if(await save({type:'teamSettings',enabled:toggle.checked,names:names.value.split('\n').map(n=>n.trim()).filter(Boolean)}))d.close();},!c.canEdit),btn('Close',()=>d.close()));document.body.append(d);d.onclose=()=>d.remove();d.showModal();
 };
 function refresh(){
  const c=getContext(),s=c.state,enabled=!!s?.team?.enabled;
  renderGuidance(c);
  settings.hidden=!s||!c.canEdit;button.hidden=!enabled;
  if(c.locationId!==lastLocation){lastLocation=c.locationId;seen=new Map();initialized=false;target='';shut();lastKey='';}
  if(!enabled){shut();initialized=false;return;}
  const tablets=teamAssignments(s),me=tablets.find(t=>t.id===deviceId),tasks=(s.team.tasks||[]).filter(t=>Date.now()-t.at<SHIFT_MS),active=tasks.filter(teamActive);
  const incoming=active.filter(t=>t.from!==deviceId&&(!t.target||t.target===deviceId)&&(!t.owner||t.owner===deviceId));
  button.textContent=`Team${incoming.length?' · '+incoming.length:''}${me?' · '+me.name:''}`;
  for(const t of tasks){const previous=seen.get(t.id),changed=previous!==t.status;seen.set(t.id,t.status);if(initialized&&changed&&c.canWrite&&(incoming.includes(t)||t.from===deviceId))toast(t.from===deviceId?`Team: ${taskTitle(t,s)} · ${t.status==='accepted'?`${t.ownerName} accepted`:t.status}`:`Team: ${taskTitle(t,s)} — tap Team`);}
  initialized=true;
  if(panel.hidden)return;
  const key=JSON.stringify([s.team,c.canWrite,c.canEdit,c.partyId,c.ids,!!me,s.parties,s.tables.map(t=>[t.id,t.status]),Math.floor(Date.now()/60000)]);if(key===lastKey)return;lastKey=key;
  body.replaceChildren();
  body.append(btn(me?`${me.name} · ${me.label} — switch / end shift`:'Choose my name',assign,!c.canWrite));
  if(!c.canWrite)body.append(el('p','Reconnect or sign in with host access to send and accept requests.','read-only-note'));
  const roster=el('p',tablets.length?tablets.map(t=>`${t.name} · ${t.label}`).join(' / '):'No tablets assigned yet.','muted');body.append(roster);
  const toLabel=el('label','Send to'),to=el('select');to.append(new Option('Anyone on the team',''));for(const t of tablets.filter(t=>t.id!==deviceId))to.append(new Option(`${t.name} · ${t.label}`,t.id));if(!tablets.some(t=>t.id===target&&t.id!==deviceId))target='';to.value=target;to.onchange=()=>target=to.value;toLabel.append(to);body.append(toLabel);
  const selected=s.tables.filter(t=>c.ids.includes(t.id)),party=s.parties.find(p=>p.id===c.partyId&&p.status==='waiting');
  body.append(el('p',[party?`${party.name} · ${party.size} guests`:'',selected.map(t=>c.label(t)).join(' + ')].filter(Boolean).join(' → ')||'Select a party or table on the floor for a specific request.','muted'));
  const quick=el('div',null,'team-choices'),send=kind=>action('teamRequest',{kind,ids:kind==='help'?[]:c.ids,partyId:c.partyId,target});
  quick.append(btn('Help at the door',()=>send('help'),!me||!c.canWrite),btn('Request cleanup',()=>send('clean'),!me||!c.canWrite||!selected.length||selected.some(t=>t.status!=='cleaning')),btn('Bring high chair',()=>send('chair'),!me||!c.canWrite||!selected.length),btn('Ask teammate to seat',()=>send('seat'),!me||!c.canWrite||!party||!selected.length));body.append(quick);
  body.append(el('h3','Requests'));
  if(!tasks.length)body.append(el('p','No requests this shift.','muted'));
  for(const t of [...tasks].reverse()){
   const row=el('section',null,'team-request');row.append(el('strong',taskTitle(t,s)),el('p',`From ${t.fromName} · ${t.status==='accepted'?`${t.ownerName} accepted`:t.status==='pending'?`Awaiting acceptance${t.target?' · '+(tablets.find(v=>v.id===t.target)?.name||'teammate'):''}`:t.status}`,'muted'));
   const p=s.parties.find(p=>p.id===t.partyId);if(p)row.append(el('p',[p.highChair?'High chair':'',p.booster?'Booster':'',p.accessibility?'Accessible seating':''].filter(Boolean).join(' · ')));
   const actions=el('div',null,'team-choices');
   if(me&&c.canWrite&&teamActive(t)){
    if(t.status==='pending'&&(!t.target||t.target===deviceId))actions.append(btn('I’ve got it',()=>acceptTask(t)));
    if(t.owner===deviceId||t.target===deviceId)actions.append(btn('Return to team',()=>action('teamReturn',{id:t.id})));
    if(t.owner===deviceId){if(['seat','clean'].includes(t.kind))actions.append(btn(t.kind==='seat'?'Open seating controls':'Open cleaning controls',()=>showTask(t)));if(t.kind!=='clean')actions.append(btn('Done',()=>action('teamDone',{id:t.id}),t.kind==='seat'&&p?.status!=='seated'));}
    if(t.from===deviceId||c.canEdit)actions.append(btn('Cancel',()=>action('teamCancel',{id:t.id})));
   }
   row.append(actions);body.append(row);
  }
 }
 function taskTitle(t,s){const c=getContext(),tables=seatingTaskIds(s,t).map(id=>s.tables.find(v=>v.id===id)).filter(Boolean).map(c.label).join(' + ');return t.kind==='help'?'Help at the front door':t.kind==='clean'?`Clean ${tables}`:t.kind==='chair'?`High chair → ${tables}`:`Seat ${s.parties.find(p=>p.id===t.partyId)?.name||'party'} → ${tables}`;}
 return {refresh,paintHighlights};
}
