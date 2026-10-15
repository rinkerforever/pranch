import {areaOptions,areaName,roomOptions} from './areas.js';
import {planImage,cleanUpPlan} from './plan-cleanup.js';
import {readyTracker} from './ready-alert.js';
import {installApp,runtimeInfo,pairLocalServer,layoutSettings} from './device.js';
import {roomInfo,activeRoomBlocks,scheduledRooms,walkInTables} from './rooms.js';
import {planWaitlist,estimateNewParty,waitRange} from './wait-plan.js';
import {presetCombinations,includesBoothCombination,childBoothFit} from './combinations.js';
import { suggestTables } from './suggestions.js';
import { WALL_PATH, ROOM_LABELS, DOORS, upgradeNumbering, openSeats } from './floor.js';
const $=id=>document.getElementById(id), NS='http://www.w3.org/2000/svg';
const demo=new URLSearchParams(location.search).get('demo')==='1';
let state=null,version=0,profile=null,locations=[],locationId=null,role='viewer',selected=new Set(),partyId=null,editing=false,tableDraft=null,editGuest=null,busy=false,view='Dining',viewBox=[140,550,1495,360],toastTimer,uploadBusy=false;
let demoModel;
let runtime={mode:'cloud'},transportReady=false,connection=null,alerts=readyTracker();
installApp();
const names={open:'Open',in_use:'In use',cleaning:'Cleaning',reserved:'Room held'};
function el(tag,attrs={},text){const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==='class')n.className=v;else n.setAttribute(k,v);}if(text!==undefined)n.textContent=text;return n;}
function svg(tag,attrs={},text){const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;}
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').className=error?'error':'';$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?9000:4000);}
function confirmChange(title,message){return new Promise(resolve=>{const d=$('confirm-dialog');$('confirm-title').textContent=title;$('confirm-message').textContent=message;const finish=value=>{d.close();resolve(value);};$('confirm-ok').onclick=()=>finish(true);$('confirm-cancel').onclick=()=>finish(false);d.oncancel=e=>{e.preventDefault();finish(false);};d.showModal();});}
async function api(path,options={}){
  const r=await fetch(path,{...options,headers:{...(options.body&&typeof options.body==='string'?{'content-type':'application/json'}:{}),...(options.headers||{})}});
  const data=await r.json();if(!r.ok){const e=new Error(data.error||'Request failed.');e.status=r.status;throw e;}return data;
}
function endpoint(resource){return `/api/locations/${encodeURIComponent(locationId)}/${resource}`;}
function sync(ok,text){$('sync-text').textContent=text;$('sync-dot').style.background=ok?'#2e805c':'#c48a25';}
function connectionStatus(value=connection){
 connection=value;transportReady=demo||!!state&&!value?.requiresRecovery&&!(runtime.mode!=='local'&&value?.mode==='local'&&!value.online);
 $('network-banner').hidden=!(value?.requiresRecovery||value?.mode==='local'&&!value.online);
 $('network-banner').textContent=value?.requiresRecovery?'Data recovery required. Seating changes are paused; contact the administrator.':runtime.mode==='local'?'Internet unavailable — host check-in only. Local devices are sharing through this Pi.':'Restaurant offline — host check-in only. This is the last cloud update; seating changes are paused.';
 if(value?.requiresRecovery){sync(false,'Recovery required · changes paused');return;}
 sync(transportReady,demo?'Preview · local changes':runtime.mode==='local'?(value?.online?'Saved · local + cloud':'Saved on Pi · host check-in only'):value?.mode==='local'?'Saved · sharing through restaurant Pi':'Saved · sharing live');
}
function showReadyAlert(){
 if(!transportReady||!state||editing){$('ready-banner').hidden=true;document.body.classList.remove('table-ready');return;}
 const pending=alerts.update(currentPlan().rows),first=pending[0];
 $('ready-banner').hidden=!first;document.body.classList.toggle('table-ready',!!first);
 if(first)$('ready-message').textContent=`Table ready — ${first.party.name}, party of ${first.party.size} · ${first.estimate.tables.map(label).join(' + ')}${pending.length>1?` · ${pending.length} parties ready`:''}`;
}
async function loadSession(){
  let data;
  if(demo){demoModel=await import('./model.js');profile={display_name:'Preview manager',system_admin:true};locations=[{id:'preview',name:'Pizza Ranch · Preview',role:'admin'}];data={profile,locations};}
  else data=await api('/api/session');
  profile=data.profile;locations=data.locations;
  $('login').hidden=true;$('app').hidden=false;$('demo-banner').hidden=!demo;
  $('staff-open').hidden=!profile.system_admin;$('location').replaceChildren(...locations.map(l=>new Option(l.name,l.id)));
  $('local-server-open').hidden=demo||runtime.mode==='local'||!profile.system_admin;
  $('logout').textContent=runtime.mode==='local'?'Lock / switch employee':'Sign out';
  $('no-access').hidden=locations.length>0;$('workspace').hidden=!locations.length;
  if(locations.length){if(matchMedia('(max-width:599px)').matches)setView('C');locationId=locations[0].id;role=locations[0].role;await refresh(true);}
}
function demoInitial(){let s=demoModel.initialState();
  s.parties=[{id:'johnson',name:'Johnson',size:6,notes:'Prefers main dining room',arrivedAt:Date.now()-18*60000,status:'waiting'},{id:'miller',name:'Miller',size:2,notes:'',arrivedAt:Date.now()-12*60000,status:'waiting'},{id:'davis',name:'Davis',size:4,notes:'One high chair',arrivedAt:Date.now()-8*60000,status:'waiting'}];
  for(const t of s.tables){if(['C-61','C-41','B-30','A-21','Piney Woods-21'].includes(t.id)){t.status='in_use';t.seatedAt=Date.now()-30*60000;}if(['C-70','A-42'].includes(t.id))t.status='cleaning';}
  s.tables.find(t=>t.id==='B-70').allowed=['B-60'];s.tables.find(t=>t.id==='B-60').allowed=['B-70'];return s;
}
async function refresh(force=false){
  if(!locationId||busy||uploadBusy)return;
  const requestedLocation=locationId;
  try{
    const data=demo?{state:JSON.parse(localStorage.getItem('seating-preview')||'null')||demoInitial(),version:version+1,role:'admin'}:await api(endpoint('state'));
    if(requestedLocation!==locationId||data.version<version)return;
    connection=data.connection;transportReady=!connection?.requiresRecovery&&!(runtime.mode!=='local'&&connection?.mode==='local'&&!connection.online);
    if(force||data.version!==version||role!==data.role){state=presetCombinations(upgradeNumbering(data.state));version=data.version;role=data.role;if(force&&(state.background?.imported||state.areaConfig))viewBox=importedViewBox(view);selected=new Set([...selected].filter(id=>state.tables.some(t=>t.id===id)));if(!state.parties.some(p=>p.id===partyId&&p.status==='waiting'))partyId=null;render();}
    else if(!editing){renderWait();renderSelection();renderRoomBookings();}
    connectionStatus(data.connection);showReadyAlert();
  }catch(e){transportReady=false;showReadyAlert();sync(false,'Disconnected · changes unavailable');if(e.status===401){$('login').hidden=false;$('app').hidden=true;}else if(force)toast(e.message,true);}
}
async function act(action){
  if(busy||!transportReady){if(!busy)toast('Reconnect to the restaurant before making changes.',true);return false;}busy=true;$('location').disabled=true;sync(false,'Saving…');
  const releasedTables=action.type==='releaseRoom'?state.tables.filter(t=>t.roomBlock===action.id).map(t=>t.id):[];
  try{const data=demo?{state:demoModel.applyAction(state,action,role),version:version+1}:await api(endpoint('actions'),{method:'POST',headers:{'x-request-id':crypto.randomUUID()},body:JSON.stringify({version,action})});
    state=presetCombinations(upgradeNumbering(data.state));version=data.version;if(demo)localStorage.setItem('seating-preview',JSON.stringify(state));
    if(action.type==='seat'||action.type==='cancelParty')partyId=null;
    selected=new Set([...selected].filter(id=>!releasedTables.includes(id)&&state.tables.some(t=>t.id===id)));render();connectionStatus();showReadyAlert();return true;
  }catch(e){toast(e.message,true);sync(false,'Change not saved');if(e.status===409){busy=false;await refresh(true);}if(e.status===401){$('app').hidden=true;$('login').hidden=false;}return false;}finally{busy=false;$('location').disabled=false;}
}
function current(){return state.tables.filter(t=>selected.has(t.id));}
function canWrite(){return transportReady&&['admin','manager','host'].includes(role);}
function canEdit(){return transportReady&&['admin','manager'].includes(role);}
function label(t){return /^[A-Z]+\d/i.test(t.number)?t.number:`${areaName(state,t.area)}-${t.number}`;}
function minutes(stamp){return Math.max(0,Math.floor((Date.now()-stamp)/60000));}
function groupTables(t){return t.group?state.tables.filter(o=>o.group===t.group):[t];}
function updatePhoneNav(waiting){$('phone-floor').setAttribute('aria-pressed',!waiting);$('phone-wait').setAttribute('aria-pressed',waiting);}
function showSidebar(panel){updatePhoneNav(panel==='waiting');$('workspace').dataset.panel=panel;$('workspace').classList.add('sidebar-open');$('tablet-wait').setAttribute('aria-expanded',panel==='waiting');$('tablet-details').setAttribute('aria-expanded',panel==='details');}
function closeSidebar(){updatePhoneNav(false);$('workspace').classList.remove('sidebar-open');for(const id of ['tablet-wait','tablet-details'])$(id).setAttribute('aria-expanded','false');}
function chooseTable(t){
  showSidebar('details');
  if(editing){selected=new Set([t.id]);tableDraft=structuredClone(t);renderFloor();renderEditor();return;}
  const group=groupTables(t),remove=group.every(o=>selected.has(o.id));for(const o of group){if(remove)selected.delete(o.id);else selected.add(o.id);}renderFloor();renderSelection();
}
function tableSymbol(t){
  const cap=t.capacity||0,across=t.orientation==='tb',long=Math.max(38,Math.ceil(cap/2)*14+7);
  const w=t.kind==='booth'?44:(across?long:38),h=t.kind==='booth'?44:(across?38:long);
  const group=svg('g',{class:`table-node ${t.status}${selected.has(t.id)?' is-selected':''}`,transform:`translate(${t.x} ${t.y})`,role:'button',tabindex:0,'aria-label':`${label(t)}, ${t.kind==='booth'?'booth, ':''}${cap?cap+' seats':'capacity unconfirmed'}, ${names[t.status]}`,'data-id':t.id,'aria-pressed':selected.has(t.id)});
  group.append(svg('title',{},`${label(t)} · ${cap?cap+' seats':'Confirm booth capacity'} · ${names[t.status]}`));
  if(t.kind==='booth'){
    for(const sign of [-1,1])group.append(svg('rect',across?{x:-w/2,y:sign<0?-h/2-9:h/2+3,width:w,height:6,rx:2,class:'chair'}:{x:sign<0?-w/2-9:w/2+3,y:-h/2,width:6,height:h,rx:2,class:'chair'}));
  }else{
    const sides=[Math.ceil(cap/2),Math.floor(cap/2)];
    sides.forEach((count,side)=>{for(let i=0;i<count;i++){const pos=(i-(count-1)/2)*14;group.append(svg('rect',across?{x:pos-5,y:side===0?-h/2-11:h/2+3,width:10,height:8,rx:2,class:'chair'}:{x:side===0?-w/2-11:w/2+3,y:pos-5,width:8,height:10,rx:2,class:'chair'}));}});
  }
  group.append(svg('rect',{x:-w/2,y:-h/2,width:w,height:h,rx:5,class:'table-surface'}));
  group.append(svg('text',{x:0,y:0,class:'number'},t.number),svg('text',{x:0,y:12,class:'seat-label'},cap?`${cap} seats`:'Seats · ?'));
  group.append(svg('rect',{x:-w/2-15,y:-h/2-15,width:w+30,height:h+30,rx:7,class:'focus-ring','pointer-events':'all'}));
  if(t.group)group.append(svg('circle',{cx:w/2-2,cy:-h/2+1,r:3,fill:'#3476ba'}));
  group.addEventListener('click',()=>{if(!group.dataset.dragged)chooseTable(t);});
  group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseTable(t);}});
  group.addEventListener('pointerdown',e=>{
    if(!editing||t.status!=='open'||t.group)return;
    selected=new Set([t.id]);tableDraft=structuredClone(t);renderEditor();
    const start={x:e.clientX,y:e.clientY};group.dataset.dragged='';group.setPointerCapture(e.pointerId);
    const move=ev=>{if(Math.hypot(ev.clientX-start.x,ev.clientY-start.y)<4)return;group.dataset.dragged='1';const p=$('floor').createSVGPoint();p.x=ev.clientX;p.y=ev.clientY;const local=p.matrixTransform($('floor').getScreenCTM().inverse());tableDraft.x=Math.max(30,Math.min(1630,Math.round(local.x)));tableDraft.y=Math.max(30,Math.min(920,Math.round(local.y)));group.setAttribute('transform',`translate(${tableDraft.x} ${tableDraft.y})`);$('table-x').value=tableDraft.x;$('table-y').value=tableDraft.y;};
    const up=()=>{group.removeEventListener('pointermove',move);group.removeEventListener('pointerup',up);if(group.dataset.dragged)toast('Position updated. Choose Save table to apply it.');setTimeout(()=>delete group.dataset.dragged,50);};group.addEventListener('pointermove',move);group.addEventListener('pointerup',up);
  });return group;
}
function renderFloor(){
  const viewport=$('floor');viewport.replaceChildren();viewport.setAttribute('viewBox',viewBox.join(' '));
  const clip=svg('clipPath',{id:'floor-view-clip',clipPathUnits:'userSpaceOnUse'});
  clip.append(svg('rect',{id:'floor-view-bounds',x:viewBox[0],y:viewBox[1],width:viewBox[2],height:viewBox[3]}));
  const defs=svg('defs');defs.append(clip);
  const floor=svg('g',{'clip-path':'url(#floor-view-clip)'});viewport.append(defs,floor);
  if(state.background)floor.append(planImage(demo?state.background.dataUrl:endpoint('floorplan')+`?v=${version}`,state.background.covers));
  else{
    floor.append(svg('rect',{x:10,y:0,width:1600,height:870,fill:'#f8f9f4'}),svg('path',{d:activeRoomBlocks(state).some(b=>b.roomId==='combined')?WALL_PATH.replace('M1205 0V130',''):WALL_PATH,class:'wall'}));
    if(activeRoomBlocks(state).some(b=>b.roomId==='combined')){const divider=svg('path',{d:'M1205 0V130',fill:'none',stroke:'#9562aa','stroke-width':2,'stroke-dasharray':'4 6','aria-label':'Rose City and Azalea Trail divider open for combined booking'});divider.append(svg('title',{},'Divider open · combined room booking'));floor.append(divider);}
    for(const door of DOORS){const g=svg('g',{'aria-label':door.name});g.append(svg('title',{},door.name),svg('path',{d:door.opening,class:'door-opening'}),svg('path',{d:door.swing,class:'door-swing'}));floor.append(g);}
    for(const[text,x,y]of ROOM_LABELS){
      const areaId=text.startsWith('Section ')?text.slice(8):text,area=areaOptions(state).find(a=>a.id===areaId),isArea=['A','B','C','Rose City','Azalea Trail','Piney Woods'].includes(areaId);
      if(isArea&&!area)continue;
      const small=!['Funzone','Kitchen'].includes(text),display=area?area.name:text;
      const n=svg('text',{x,y,class:`room-label${small?' small':''}${text.startsWith('Section')?' section':''}`},display);if(text.includes('restroom'))n.setAttribute('transform',`rotate(-90 ${x} ${y})`);floor.append(n);
      const room=roomOptions(state).find(r=>r.areas.length===1&&r.areas[0]===areaId);
      if(room){const info=roomInfo(state,room.id);floor.append(svg('text',{x,y:y+15,class:'room-label small'},`${info.capacity} seats${info.blocks.length?' · Booked':''}`));}
    }
    floor.append(svg('rect',{x:1475,y:485,width:94,height:42,rx:3,fill:'none',stroke:'#b1b8ad','stroke-width':2}));
  }
  const groups=[...new Set(state.tables.map(t=>t.group).filter(Boolean))];for(const id of groups){const ts=state.tables.filter(t=>t.group===id);for(let i=1;i<ts.length;i++)floor.append(svg('line',{x1:ts[i-1].x,y1:ts[i-1].y,x2:ts[i].x,y2:ts[i].y,class:'group-line'}));}
  for(const t of state.tables)floor.append(tableSymbol(t));
  for(const s of Object.keys(names))$('count-'+s).textContent=state.tables.filter(t=>t.status===s).length;
  const seats=openSeats(state.tables);$('count-seats').textContent=seats.count;$('phone-seat-count').textContent=seats.count;$('phone-seat-note').textContent=seats.unconfirmed?'Confirmed capacity only':'Restaurant total';
  $('seat-count-note').textContent=seats.unconfirmed?`${seats.unconfirmed} open booths/tables need a capacity; excluded from seat count.`:'';
  $('selection-hint').textContent=selected.size?`${selected.size} table${selected.size===1?'':'s'} selected`:'Tap a table to select it';
  $('plan-note').textContent=state.background?`Uploaded plan: ${state.background.name}. Review seats and table positions in Layout editor.`:'Chair counts follow your PDF. Booth capacities remain unconfirmed until set in Layout editor.';
}
let planCache=null,planState=null,planMinute=-1;
function currentPlan(){const minute=Math.floor(Date.now()/60000);if(planState!==state||planMinute!==minute){planCache=planWaitlist(state);planState=state;planMinute=minute;}return planCache;}
function chooseWaitingParty(p,tables=[]){partyId=p.id;selected=new Set(tables.map(t=>t.id));editing=false;if(tables.length)setView(tables[0].area);render();showSidebar(tables.length?'details':'waiting');}
function renderQuote(){if(!state)return;const estimate=estimateNewParty(currentPlan(),Number($('estimate-size').value));$('estimate-result').textContent=waitRange(estimate);}
function renderGuestQuote(){if(!state)return;const size=Number($('guest-size').value),plan=currentPlan();const estimate=editGuest?plan.rows.find(r=>r.party.id===editGuest&&r.party.size===size)?.estimate:estimateNewParty(plan,size);$('guest-estimate').textContent=editGuest&&!estimate?'Updated estimate appears after saving.':`Estimated wait: ${waitRange(estimate)}. Based on the current queue; timing may change.`;}
function renderWaitlistView(){
 if(!$('waitlist-dialog').open)return;
 const plan=currentPlan(),rows=plan.rows,ready=rows.filter(r=>r.estimate?.ready).length;
 $('waitlist-location').textContent=locations.find(l=>l.id===locationId)?.name||'';
 $('waitlist-summary').textContent=`${rows.length} parties · ${rows.reduce((n,r)=>n+r.party.size,0)} guests · ${ready} ready to seat`;
 $('wait-estimate-basis').textContent=`${plan.settings.source}: ${plan.settings.diningMinutes} min dining + ${plan.settings.cleaningMinutes} min cleaning. Uses time already seated and current queue. Overdue occupied tables keep a 10-minute buffer. Update table statuses promptly.`;
 $('waitlist-empty').hidden=rows.length>0;
 $('waitlist-rows').replaceChildren(...rows.map(({party:p,estimate,combinationPriority},i)=>{
  const row=el('tr',{class:estimate?.ready?'ready-row':''}),guest=el('td'),wait=el('td',{},`${minutes(p.arrivedAt)} min`),eta=el('td'),table=el('td'),action=el('td');
  guest.append(el('strong',{},`${i+1}. ${p.name}`),el('small',{},`${p.size} guests${p.highChair?' · High chair':''}${p.booster?' · Booster':''}`));
  if(p.notes)guest.append(el('small',{},p.notes));
  if(combinationPriority)guest.append(el('span',{class:'combination-tag'},'Combination priority'));
  eta.append(el('strong',{},waitRange(estimate)));
  table.append(el('span',{},estimate?estimate.tables.map(label).join(' + '):'No configured fit'));
  if(estimate&&includesBoothCombination(estimate.tables))table.append(el('small',{},'Includes booth · confirm fit'));
  const button=el('button',{class:estimate?.ready?'primary small':'small'},estimate?.ready?'Review & seat':'View options');button.onclick=()=>{$('waitlist-dialog').close();chooseWaitingParty(p,estimate?.ready?estimate.tables:[]);};action.append(button);
  row.append(guest,wait,eta,table,action);return row;
 }));renderQuote();
}
function renderWait(){
  const plan=currentPlan();renderWaitlistView();if($('guest-dialog').open)renderGuestQuote();
  const waiting=state.parties.filter(p=>p.status==='waiting').sort((a,b)=>a.arrivedAt-b.arrivedAt);$('wait-count').textContent=waiting.length;$('tablet-wait-count').textContent=waiting.length;$('phone-wait-count').textContent=waiting.length;$('add-guest').disabled=!canWrite();
  if(!waiting.length){$('wait-list').replaceChildren(el('div',{class:'empty'},'Everyone is seated. Add a party when guests arrive.'));return;}
  $('wait-list').replaceChildren(...waiting.map((p,index)=>{
    const planned=plan.rows.find(r=>r.party.id===p.id),ready=!!planned?.estimate?.ready;
    const row=el('div',{class:`guest${p.id===partyId?' active':''}${ready?' ready-row':''}`,tabindex:0,role:'button','aria-label':`${p.name}, ${p.size} guests, waiting ${minutes(p.arrivedAt)} minutes`});
    const main=el('div',{class:'guest-main'});main.append(el('strong',{},p.name),el('small',{},`#${index+1}`));
    const meta=el('div',{class:'guest-meta'});meta.append(el('span',{},`${p.size} guests`),el('span',{},`${minutes(p.arrivedAt)} min wait`));row.append(main,meta);
    row.append(el('p',{class:'wait-estimate'},waitRange(planned?.estimate)));if(planned?.combinationPriority)row.append(el('span',{class:'combination-tag'},'Combination priority'));
    if(p.source==='qr')row.append(el('small',{class:'qr-source'},p.readyAt?'QR guest · Ready — return to host':'QR guest check-in'));
    if(p.highChair||p.booster)row.append(el('p',{class:'equipment-badges'},[p.highChair?'High chair':null,p.booster?'Booster seat':null].filter(Boolean).join(' · ')));
    if(p.notes)row.append(el('p',{class:'guest-note'},p.notes));
    const choose=()=>{partyId=p.id;selected.clear();renderWait();renderSelection();renderRecommendations();renderFloor();$('recommend-panel').scrollIntoView({block:'nearest',behavior:'smooth'});};const fit=ready?planned.estimate.tables:null;const fitButton=el('button',{class:'guest-fit',type:'button'},fit?`Suggested: ${fit.map(label).join(' + ')} · View options`:'Find tables');fitButton.onclick=e=>{e.stopPropagation();choose();};row.append(fitButton);row.onclick=choose;row.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();choose();}};
    if(partyId===p.id&&canWrite()){
      const actions=el('div',{class:'guest-actions'}),edit=el('button',{class:'quiet small'},'Edit'),cancel=el('button',{class:'quiet small danger'},'Remove');
      edit.onclick=e=>{e.stopPropagation();openGuest(p);};cancel.onclick=async e=>{e.stopPropagation();if(await confirmChange('Remove waiting party?',`Remove ${p.name} from the waiting list?`))await act({type:'cancelParty',id:p.id});};actions.append(edit,cancel);if(p.source==='qr'){const ready=el('button',{class:'small'},p.readyAt?'Ready sent':'Mark ready');ready.disabled=!!p.readyAt;ready.onclick=async e=>{e.stopPropagation();if(await act({type:'readyParty',id:p.id}))toast('Guest status page updated: table ready.');};actions.append(ready);}row.append(actions);
    }return row;
  }));
}
function renderSelection(){
  const box=$('selection-body'),tables=current(),party=state.parties.find(p=>p.id===partyId&&p.status==='waiting');const overrideKey=JSON.stringify([party?.id,party?.size,tables.map(t=>[t.id,t.capacity,t.status])]),keepOverride=box.dataset.overrideKey===overrideKey&&!!box.querySelector('#child-override')?.checked;box.dataset.overrideKey=overrideKey;box.replaceChildren();$('selection-title').textContent=party?`Seat ${party.name}`:'Table details';
  if(!canWrite())box.append(el('p',{class:'read-only-note'},'View-only access. Ask an administrator for host access to make changes.'));
  if(party)box.append(el('p',{class:'muted'},`${party.size} guests · Choose a table below or tap tables on the floor.`));
  if(!tables.length){box.append(el('div',{class:'empty'},party?'Choose a suggestion or select tables on the floor.':'Select a table to see seats, status, and available actions.'));return;}
  const summary=el('div',{class:'selection-summary'}),capacity=tables.reduce((n,t)=>n+(t.capacity||0),0),unknown=tables.some(t=>!t.capacity);
  summary.append(el('strong',{},tables.map(label).join(' + ')),el('p',{},unknown?'Capacity unconfirmed':`${capacity} seats total`));
  for(const t of tables){const p=state.parties.find(p=>p.id===t.party);summary.append(el('p',{},`${label(t)} · ${names[t.status]}${t.seatedAt?' · '+minutes(t.seatedAt)+' min':''}${p?' · '+p.name+' ('+p.size+')'+(p.highChair?' · High chair':'')+(p.booster?' · Booster':'')+(p.childOverride?' · Child override':''):''}`));}box.append(summary);
  if(tables.some(t=>t.roomBlock)){const b=el('button',{class:'primary wide'},'Manage whole-room booking');b.onclick=openRoomBookings;box.append(el('p',{class:'combination-notice'},'These tables belong to a whole-room block.'),b);return;}
  if(!canWrite())return;
  const boothNotice='This combination includes a fixed booth. Confirm the nearby table works for this party and leaves the aisle clear.';
  if(includesBoothCombination(tables))box.append(el('p',{class:'combination-notice'},boothNotice));
  if(party){
    const button=el('button',{class:'primary wide'},tables.length>1?'Combine & seat party':'Seat party');let override=null;
    if(childBoothFit(tables,party.size)){
      const toggle=el('label',{class:'equipment-toggle'});override=el('input',{type:'checkbox',id:'child-override'});override.checked=keepOverride;
      toggle.append(override,document.createTextNode('Small-child override: 1 extra guest at this booth'));
      box.append(toggle,el('p',{class:'muted'},'Host must confirm the party fits. The normal booth capacity stays unchanged.'));
      override.onchange=()=>{button.disabled=!override.checked||tables.some(t=>t.status!=='open');};
    }
    button.disabled=unknown||(capacity<party.size&&!override?.checked)||tables.some(t=>t.status!=='open');
    button.onclick=async()=>{
      const childOverride=!!override?.checked,boothAcknowledged=includesBoothCombination(tables);
      if((childOverride||boothAcknowledged)&&!await confirmChange(childOverride?'Confirm child seating override':'Confirm booth combination',childOverride?`Seat ${party.size} guests at this ${capacity}-seat booth, including a small child? Confirm the party fits before seating.`:boothNotice))return;
      if(await act({type:'seat',partyId:party.id,ids:tables.map(t=>t.id),childOverride,boothAcknowledged}))toast(`${party.name} seated.`);
    };box.append(button);if(unknown)box.append(el('p',{class:'muted'},'A manager needs to confirm booth capacity first.'));
  }
  const actions=el('div',{class:'actions'});
  for(const status of ['open','in_use','cleaning']){const b=el('button',{class:'small'},status==='in_use'?'Mark in use':status==='open'?'Mark open':'Cleaning');b.onclick=async()=>{if(tables.some(t=>t.party)&&status!=='in_use'&&!await confirmChange('Clear seated party?',`Mark ${tables.map(label).join(' + ')} ${names[status].toLowerCase()} and finish the seated party?`))return;await act({type:'status',ids:[...selected],status});};actions.append(b);}box.append(actions);
  const grouping=el('div',{class:'actions'});
  if(tables.length>1&&tables.every(t=>t.status==='open')){const b=el('button',{class:'small'},'Combine tables');b.onclick=async()=>{const boothAcknowledged=includesBoothCombination(tables);if(boothAcknowledged&&!await confirmChange('Confirm booth combination',boothNotice))return;await act({type:'combine',ids:tables.map(t=>t.id),boothAcknowledged});};grouping.append(b);}
  if(tables.some(t=>t.group)){const b=el('button',{class:'small'},'Separate tables');b.disabled=tables.some(t=>t.status==='in_use');b.onclick=()=>act({type:'split',ids:[...selected]});grouping.append(b);}box.append(grouping);
}
function renderRecommendations(){
  const party=state.parties.find(p=>p.id===partyId&&p.status==='waiting');$('recommend-panel').hidden=editing;$('recommend-context').textContent=party?`${party.name} · ${party.size} guests — best fits first`:'Select a waiting party to find an open table that fits.';if(!party){$('recommendations').replaceChildren();return;}
  const candidates=suggestTables(walkInTables(state),party.size);
  const planned=currentPlan().rows.find(r=>r.party.id===party.id)?.estimate;
  if(planned?.ready){const key=ts=>ts.map(t=>t.id).sort().join('|'),index=candidates.findIndex(ts=>key(ts)===key(planned.tables));if(index>=0)candidates.splice(index,1);candidates.unshift(planned.tables);}
  candidates.push(...state.tables.filter(t=>t.status==='open'&&!t.group&&childBoothFit([t],party.size)).slice(0,2).map(t=>[t]));
  $('recommendations').replaceChildren(...candidates.map(ts=>{const b=el('button',{class:'suggestion'}),info=el('span');info.append(el('strong',{},ts.map(label).join(' + ')),el('small',{},`${ts.reduce((n,t)=>n+t.capacity,0)} seats · ${childBoothFit(ts,party.size)?'Small-child override required':includesBoothCombination(ts)?'Booth + table · confirm fit':ts.length>1?'Nearby combination':'Open table'}`));b.append(info,el('span',{},'→'));b.onclick=()=>{selected=new Set(ts.map(t=>t.id));setView(ts[0].area);renderFloor();renderSelection();showSidebar('details');};return b;}));
  if(!candidates.length)$('recommendations').append(el('p',{class:'empty'},'No available fit. A manager can confirm booth capacities or approve table combinations in Layout editor.'));
}
function importedViewBox(value){
 if(value==='All')return [0,0,1660,950];
 const rooms=new Set(areaOptions(state).filter(a=>a.kind==='room').map(a=>a.id));
 const tables=state.tables.filter(t=>value==='Dining'?!rooms.has(t.area):value==='Party rooms'?rooms.has(t.area):t.area===value);
 if(!tables.length)return [0,0,1660,950];
 const xs=tables.map(t=>t.x),ys=tables.map(t=>t.y),x=Math.max(0,Math.min(...xs)-65),y=Math.max(0,Math.min(...ys)-65);
 return [x,y,Math.min(1660-x,Math.max(150,Math.max(...xs)-x+65)),Math.min(950-y,Math.max(150,Math.max(...ys)-y+65))];
}
function setView(value){closeSidebar();view=value;const boxes={All:[0,-20,1660,950],Dining:[140,550,1495,360],A:[1300,540,340,350],B:[680,610,665,285],C:[155,610,540,285],'Party rooms':[1000,-10,640,220],'Rose City':[1010,-10,190,200],'Azalea Trail':[1190,-10,210,200],'Piney Woods':[1390,-10,250,230]};viewBox=(state?.background?.imported||state?.areaConfig)?importedViewBox(value):(boxes[value]||boxes.All);renderAreas();if(state)renderFloor();}
function renderAreas(){
 const areas=areaOptions(state),labels={All:'Full plan',Dining:'Dining room'};
 for(const a of areas)labels[a.id]=a.name;
 if(areas.some(a=>a.kind==='room'))labels['Party rooms']='Party rooms';
 $('areas').replaceChildren(...Object.entries(labels).map(([key,name])=>{const b=el('button',{class:view===key?'active':'','data-view':key},name);b.onclick=()=>setView(key);return b;}));
}
function renderEditor(){
  $('layout-panel').hidden=!editing||!tableDraft;if(!editing||!tableDraft)return;
  const t=tableDraft;$('layout-title').textContent=t.id?'Edit '+label(t):'Add table';$('table-area').replaceChildren(...areaOptions(state).map(a=>new Option(a.name,a.id)));$('table-area').value=t.area;$('table-number').value=t.number;$('table-kind').value=t.kind;$('table-capacity').value=t.capacity??'';$('table-orientation').value=t.orientation;$('table-x').value=t.x;$('table-y').value=t.y;$('remove-table').hidden=!t.id;renderAllowed(t.allowed||[]);
}
function renderAllowed(allowed=[]){const area=$('table-area').value,kind=$('table-kind').value;$('allowed-tables').replaceChildren();
  for(const t of state.tables.filter(t=>t.area===area&&t.id!==tableDraft?.id&&!(kind==='booth'&&t.kind==='booth'))){const l=el('label'),c=el('input',{type:'checkbox',value:t.id});c.checked=allowed.includes(t.id);l.append(c,document.createTextNode(`${label(t)} · ${t.capacity} seats`));$('allowed-tables').append(l);}
}
function render(){
  $('clean-plan').hidden=!state.background;
  $('guest-checkin').hidden=!canWrite();$('areas-open').hidden=!canEdit();
  $('phone-location').textContent=locations.find(l=>l.id===locationId)?.name||'';
  $('edit-tab').hidden=!canEdit();if(!canEdit())editing=false;$('tablet-wait').hidden=editing;
  $('live-tab').classList.toggle('active',!editing);$('edit-tab').classList.toggle('active',editing);$('editor-toolbar').hidden=!editing;$('wait-panel').hidden=editing;$('selection-panel').hidden=editing;$('layout-panel').hidden=!editing||!tableDraft;
  $('page-title').textContent=editing?'Make the floor yours.':'Let’s get everyone seated.';
  renderAreas();renderFloor();renderWait();renderSelection();renderRecommendations();renderRoomBookings();showReadyAlert();
  // Keep unsaved layout fields intact while live state polls update the floor.
}
function openGuest(p=null){editGuest=p?.id||null;$('guest-title').textContent=p?'Edit waiting party':'Add guests';$('guest-name').value=p?.name||'';$('guest-size').value=p?.size||2;$('guest-notes').value=p?.notes||'';$('guest-highchair').checked=!!p?.highChair;$('guest-booster').checked=!!p?.booster;renderGuestQuote();$('guest-dialog').showModal();$('guest-name').focus();}
$('login-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;$('login-error').textContent='';try{await api('/api/login',{method:'POST',body:JSON.stringify(runtime.mode==='local'?{pin:$('local-pin').value}:{email:$('email').value,password:$('password').value})});$('password').value='';$('local-pin').value='';await loadSession();}catch(error){$('login-error').textContent=error.message;}finally{b.disabled=false;}};
$('logout').onclick=async()=>{if(!demo)await api('/api/logout',{method:'POST'});locationId=null;state=null;transportReady=false;alerts=readyTracker();showReadyAlert();$('app').hidden=true;$('login').hidden=false;if(demo)location.href='/';};
$('location').onchange=async()=>{locationId=$('location').value;role=locations.find(l=>l.id===locationId).role;selected.clear();partyId=null;tableDraft=null;editing=false;version=-1;alerts=readyTracker();await refresh(true);};
$('live-tab').onclick=()=>{$('app').classList.remove('phone-menu-open');closeSidebar();editing=false;tableDraft=null;render();};$('edit-tab').onclick=()=>{$('app').classList.remove('phone-menu-open');closeSidebar();editing=true;partyId=null;tableDraft=null;selected.clear();render();toast('Select a table to edit its capacity, chairs, or allowed combinations.');};
$('phone-floor').onclick=closeSidebar;$('phone-wait').onclick=()=>{editing=false;render();showSidebar('waiting');};$('phone-more').onclick=()=>{const open=$('app').classList.toggle('phone-menu-open');$('phone-more').setAttribute('aria-expanded',open);};
$('tablet-wait').onclick=()=>showSidebar('waiting');$('tablet-details').onclick=()=>showSidebar('details');$('sidebar-close').onclick=closeSidebar;
$('add-guest').onclick=()=>openGuest();$('clear-selection').onclick=()=>{selected.clear();renderFloor();renderSelection();};
$('guest-form').onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;const ok=await act({type:editGuest?'editParty':'addParty',id:editGuest,name:$('guest-name').value,size:Number($('guest-size').value),notes:$('guest-notes').value,highChair:$('guest-highchair').checked,booster:$('guest-booster').checked});e.submitter.disabled=false;if(ok){$('guest-dialog').close();toast(editGuest?'Party updated.':'Added to waiting list.');}};
for(const b of document.querySelectorAll('.close-dialog'))b.onclick=()=>b.closest('dialog').close();
$('add-table').onclick=()=>{showSidebar('details');tableDraft={area:areaOptions(state).some(a=>a.id===view)?view:areaOptions(state)[0]?.id,number:'',capacity:4,kind:'table',orientation:'lr',x:Math.round(viewBox[0]+viewBox[2]/2),y:Math.round(viewBox[1]+viewBox[3]/2),allowed:[]};selected.clear();renderEditor();$('table-number').focus();};
$('table-area').onchange=()=>renderAllowed();$('table-kind').onchange=()=>renderAllowed();
$('layout-form').onsubmit=async e=>{e.preventDefault();if(!tableDraft)return;e.submitter.disabled=true;const table={area:$('table-area').value,number:$('table-number').value,kind:$('table-kind').value,capacity:$('table-capacity').value===''?null:Number($('table-capacity').value),orientation:$('table-orientation').value,x:Number($('table-x').value),y:Number($('table-y').value),allowed:[...$('allowed-tables').querySelectorAll('input:checked')].map(i=>i.value)};const ok=await act({type:tableDraft.id?'layout':'addTable',id:tableDraft.id,table});e.submitter.disabled=false;if(ok){tableDraft=null;$('layout-panel').hidden=true;toast('Table layout saved.');}};
$('remove-table').onclick=async()=>{if(!tableDraft?.id)return;if(await confirmChange('Remove table?',`Remove ${label(tableDraft)} from this layout? You can add it again in Layout editor.`)&&await act({type:'removeTable',id:tableDraft.id})){tableDraft=null;selected.clear();$('layout-panel').hidden=true;renderFloor();}};
for(const[id,factor]of [['zoom-in',.75],['zoom-out',1.333]])$(id).onclick=()=>{const[x,y,w,h]=viewBox;const nw=Math.min(2000,Math.max(120,w*factor)),nh=h*(nw/w);viewBox=[x+(w-nw)/2,y+(h-nh)/2,nw,nh];renderFloor();};$('zoom-fit').onclick=()=>setView(view);
// Pan the canvas from an empty area, keeping table dragging exclusive to Layout editor.
$('floor').addEventListener('pointerdown',e=>{if(e.target.closest('.table-node'))return;const floor=$('floor'),start=[e.clientX,e.clientY],box=[...viewBox],matrix=floor.getScreenCTM();floor.setPointerCapture(e.pointerId);const move=ev=>{viewBox=[box[0]-(ev.clientX-start[0])/matrix.a,box[1]-(ev.clientY-start[1])/matrix.d,box[2],box[3]];floor.setAttribute('viewBox',viewBox.join(' '));const bounds=$('floor-view-bounds');bounds.setAttribute('x',viewBox[0]);bounds.setAttribute('y',viewBox[1]);};const end=()=>{floor.removeEventListener('pointermove',move);floor.removeEventListener('pointerup',end);};floor.addEventListener('pointermove',move);floor.addEventListener('pointerup',end);});
$('upload').onchange=async()=>{
  const file=$('upload').files[0];if(!file||busy||uploadBusy||!canEdit())return;
  if(file.size>20*1024*1024){toast('Choose a file smaller than 20 MB.',true);$('upload').value='';return;}
  uploadBusy=true;$('location').disabled=true;const importLocation=locationId,importVersion=version;
  sync(false,'Reviewing new floor plan…');
  try{
    const {reviewFloorImport}=await import('./floor-import.js');
    const saved=await reviewFloorImport(file,{locationName:locations.find(l=>l.id===importLocation)?.name||'Selected location',areas:areaOptions(state),save:async({blob,tables,page})=>{
      if(locationId!==importLocation||version!==importVersion)throw new Error('The floor changed during review. Cancel and upload again.');
      if(demo){
        const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
        const next=demoModel.applyAction(state,{type:'replaceFloor',tables,background:{name:file.name,dataUrl,imported:true,page}},role);
        localStorage.setItem('seating-preview',JSON.stringify(next));state=next;version++;
      }else{
        const form=new FormData();form.append('image',blob,'floor.png');form.append('layout',JSON.stringify({version:importVersion,name:file.name,page,tables}));
        const data=await api(`/api/locations/${encodeURIComponent(importLocation)}/floorplan`,{method:'POST',body:form});state=data.state;version=data.version;
      }
    }});
    if(saved){selected.clear();partyId=null;tableDraft=null;setView('All');render();toast('New floor plan and tables saved for this location. Confirm any remaining seat counts in Layout editor.');}
    sync(true,demo?'Preview · local changes':'Saved · sharing live');
  }catch(e){toast(e.message,true);sync(false,'Import not saved');}finally{uploadBusy=false;$('location').disabled=false;$('upload').value='';}
};
$('staff-open').onclick=async()=>{
 if(demo){toast('Seating access is managed in the live app.');return;}
 const staffLocation=locationId;
 try{const data=await api('/api/staff');$('staff-location').textContent=locations.find(l=>l.id===staffLocation)?.name||'';
 $('staff-list').replaceChildren(...data.users.map(u=>{
  const row=el('div',{class:'staff-row'}),info=el('div');info.append(el('strong',{},u.display_name||u.email),el('small',{},u.email));row.append(info);
  if(u.system_admin)row.append(el('small',{},'Administrator · full seating access'));
  else{
   let saved=data.grants.find(g=>g.user_id===u.id&&g.location_id===staffLocation)?.role||'none';
   const controls=el('div',{class:'staff-controls'}),toggle=el('label',{class:'equipment-toggle'}),enabled=el('input',{type:'checkbox','aria-label':`Enable seating access for ${u.email}`}),select=el('select',{'aria-label':`Seating role for ${u.email}`});
   for(const [v,n] of [['host','Host — seat guests'],['viewer','Viewer — view only'],['manager','Manager — edit floor']])select.add(new Option(n,v));
   const restore=()=>{enabled.checked=saved!=='none';select.value=saved==='none'?'host':saved;select.disabled=saved==='none';};restore();
   const save=async()=>{const next=enabled.checked?select.value:'none';enabled.disabled=true;select.disabled=true;try{await api('/api/staff',{method:'POST',body:JSON.stringify({userId:u.id,locationId:staffLocation,role:next})});saved=next;toast('Seating access saved.');}catch(e){toast(e.message,true);}finally{enabled.disabled=false;restore();}};
   enabled.onchange=save;select.onchange=save;toggle.append(enabled,document.createTextNode('Seating access'));controls.append(toggle,select);row.append(controls);
  }return row;
 }));$('staff-dialog').showModal();}catch(e){toast(e.message,true);}
};
$('demo-reset').onclick=()=>{localStorage.removeItem('seating-preview');selected.clear();partyId=null;refresh(true);};
setInterval(()=>{if(!document.hidden&&locationId&&!editing)refresh();},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
window.addEventListener('online',()=>refresh(true));window.addEventListener('offline',()=>{transportReady=false;showReadyAlert();sync(false,'Disconnected · changes unavailable');});
async function boot(){runtime=demo?{mode:'cloud'}:await runtimeInfo();const local=runtime.mode==='local';$('local-pin-label').hidden=!local;$('cloud-email-label').hidden=local;$('cloud-password-label').hidden=local;$('email').required=!local;$('password').required=!local;$('local-pin').required=local;$('pin-enroll-open').hidden=!local;$('login-copy').textContent=local?'On the restaurant Wi-Fi, enter your four-digit employee PIN.':'Sign in with your Kiosk Manager account.';await loadSession();}
boot().catch(e=>{if(e.status!==401)toast(e.message,true);});
$('ready-ack').onclick=()=>{alerts.acknowledge(currentPlan().rows);showReadyAlert();};
$('local-server-open').onclick=()=>pairLocalServer({locationId,api}).catch(e=>toast(e.message,true));
$('layout-settings').onclick=()=>{if(demo)return toast('iPad setup is available when signed in to your restaurant.');layoutSettings({locationId,api}).catch(e=>toast(e.message,true));};
$('pin-enroll-open').onclick=()=>$('pin-enroll-dialog').showModal();
$('pin-enroll-form').onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{await api('/api/local/enroll',{method:'POST',body:JSON.stringify({email:$('pin-email').value,password:$('pin-password').value,pin:$('pin-new').value})});$('pin-password').value='';$('pin-new').value='';$('pin-enroll-dialog').close();toast('PIN saved. Sign in with your four-digit PIN.');}catch(error){$('pin-error').textContent=error.message;}finally{e.submitter.disabled=false;}};

$('guest-checkin').onclick=()=>{
 const loc=locations.find(l=>l.id===locationId),config=state.guestSettings||{enabled:false,maxPartySize:12};
 $('checkin-location').textContent=loc.name;$('checkin-summary').textContent=config.enabled?'Guests can join online now.':'Online check-in is currently closed.';
 $('checkin-enabled').checked=config.enabled;$('checkin-max').value=config.maxPartySize;
 $('checkin-code').hidden=demo;
 if(!demo){$('checkin-qr').src=endpoint('qr');$('checkin-link').href=`${runtime.cloudUrl||''}/join.html?location=${encodeURIComponent(locationId)}`;$('checkin-print').href=`/sign.html?location=${encodeURIComponent(locationId)}`;}
 $('checkin-dialog').showModal();
};
$('checkin-form').onsubmit=async e=>{e.preventDefault();const button=$('checkin-save');button.disabled=true;try{if(await act({type:'guestSettings',enabled:$('checkin-enabled').checked,maxPartySize:Number($('checkin-max').value)})){$('checkin-summary').textContent=state.guestSettings.enabled?'Guests can join online now.':'Online check-in is closed. Existing guests can still check their status.';toast('Guest check-in settings saved.');}}finally{button.disabled=false;}};

$('preset-combinations').onclick=async()=>{if(await confirmChange('Preset nearby combinations?','Add links between neighboring tables in this sectioned floor plan. Existing links stay available. Booth combinations require a notice before use. Review links after moving tables or uploading a different plan.')){if(await act({type:'presetCombinations'})){tableDraft=null;render();toast('Nearby combinations are ready.');}}};

$('waitlist-open').onclick=()=>{if(!state)return;const settings=currentPlan().settings;$('dining-minutes').value=settings.diningMinutes;$('cleaning-minutes').value=settings.cleaningMinutes;for(const id of ['dining-minutes','cleaning-minutes','wait-settings-save'])$(id).disabled=!canWrite();$('waitlist-dialog').showModal();renderWaitlistView();};
$('estimate-size').oninput=renderQuote;$('guest-size').addEventListener('input',renderGuestQuote);
$('wait-settings-form').onsubmit=async e=>{e.preventDefault();$('wait-settings-save').disabled=true;try{if(await act({type:'waitSettings',diningMinutes:Number($('dining-minutes').value),cleaningMinutes:Number($('cleaning-minutes').value)}))toast('Wait estimate assumptions saved.');}finally{$('wait-settings-save').disabled=!canWrite();}};

function roomCapacityText(info){return `${info.capacity} seats${info.unconfirmed?' + unconfirmed capacity':''}`;}
function updateRoomBookingForm(){
 const info=roomInfo(state,$('book-room').value);if(!info){$('room-book-save').disabled=true;return;}
 $('room-capacity').textContent=`${roomCapacityText(info)} · ${info.available&&!info.blocks.length?'Available for whole-room booking':'Currently unavailable'}`;
 $('room-divider-note').hidden=info.areas.length<2;$('room-divider-note').textContent=`${info.name} will be held together. Open the shared divider as needed; all rooms must be available.`;$('room-size').max=info.capacity;
 const future=$('room-book-kind').value==='future';$('room-start-label').hidden=!future;$('room-party-label').hidden=future;if(future)$('room-party').value='';
 const existing=!!$('room-party').value;$('room-new-group').hidden=existing;$('room-name').required=!existing;$('room-size').required=!existing;
  $('room-book-save').textContent=future?'Save future booking':'Hold whole room';$('room-book-save').disabled=!canWrite()||!info.tables.length||(!future&&(!info.available||!!info.blocks.length))||info.unconfirmed;
}
function renderRoomBookings(){
 if(!$('rooms-dialog').open)return;
 $('rooms-location').textContent=locations.find(l=>l.id===locationId)?.name||'';
 const selectedRoom=$('book-room').value,options=roomOptions(state);$('book-room').replaceChildren(...options.map(r=>new Option(r.name,r.id)));if(options.some(r=>r.id===selectedRoom))$('book-room').value=selectedRoom;
 $('room-cards').replaceChildren(...roomOptions(state).map(room=>{
  const info=roomInfo(state,room.id),card=el('div',{class:'room-card'});
  card.append(el('h3',{},room.name),el('strong',{},roomCapacityText(info)),el('p',{},!info.tables.length?'Assign tables in Layout editor':info.blocks.length?'Room booked':info.available?'Available':info.canFinishCleaning?'Cleaning · mark open when ready':'Some tables in use / cleaning'));
  const b=el('button',{},room.areas.length>1?'Book rooms together':'Choose room');b.disabled=!info.available||!!info.blocks.length||!canWrite();
  b.onclick=()=>{$('book-room').value=room.id;updateRoomBookingForm();$('room-book-form').scrollIntoView({block:'nearest',behavior:'smooth'});};card.append(b);
  if(info.canFinishCleaning&&canWrite()){
   const clean=el('button',{class:'primary'},'Mark cleaned & open');
   clean.onclick=async()=>{clean.disabled=true;try{if(await act({type:'finishRoomCleaning',roomId:room.id}))toast(`${room.name} is clean and open.`);}finally{clean.disabled=false;}};
   card.append(clean);
  }
  return card;
 }));
 if(!roomOptions(state).length)$('room-cards').append(el('p',{class:'muted'},'No party rooms configured. A manager can add them in Areas & rooms, then assign tables in Layout editor.'));
 const blocks=activeRoomBlocks(state);$('room-blocks').replaceChildren(...blocks.map(block=>{const card=el('div',{class:'room-block'}),p=state.parties.find(p=>p.id===block.partyId);card.append(el('strong',{},`${block.name} · ${block.size} guests`),el('p',{},`${block.areas.map(id=>areaName(state,id)).join(' + ')} · ${block.status==='held'?'Held for arrival':'In use'} · Release by ${formatRoomTime(block.endsAt)}`));if(p?.notes)card.append(el('p',{},p.notes));if(p?.highChair||p?.booster)card.append(el('small',{},[p.highChair?'High chair':null,p.booster?'Booster seat':null].filter(Boolean).join(' · ')));
  if(canWrite()){const actions=el('div',{class:'actions'});if(block.status==='held'){const seat=el('button',{class:'primary'},'Seat group');seat.onclick=()=>act({type:'seatRoom',id:block.id});actions.append(seat);}for(const status of block.status==='held'?['open']:['cleaning','open']){const b=el('button',{},block.status==='held'?'Cancel room hold':status==='cleaning'?'Finish & mark cleaning':'Release as open');b.onclick=async()=>{if(await confirmChange('Release room block?',block.status==='held'?`Cancel the hold for ${block.name}? ${block.fromWaitlist?'The party will return to the waitlist.':'The room will reopen.'}`:`Finish ${block.name} and mark all room tables ${status}?`))await act({type:'releaseRoom',id:block.id,status});};actions.append(b);}card.append(actions);}return card;}));
 if(!blocks.length)$('room-blocks').append(el('p',{class:'muted'},'No rooms are currently booked.'));
 const selectedParty=$('room-party').value;$('room-party').replaceChildren(new Option('New group',''),...state.parties.filter(p=>p.status==='waiting').map(p=>new Option(`${p.name} · ${p.size} guests`,p.id)));$('room-party').value=state.parties.some(p=>p.id===selectedParty&&p.status==='waiting')?selectedParty:'';
 renderRoomSchedule();$('room-book-form').hidden=!canWrite()||!roomOptions(state).length;updateRoomBookingForm();
}
function openRoomBookings(){if(!state)return;$('room-book-kind').value='now';$('room-start').value=localRoomTime(Date.now()+3600000);$('room-end').value=localRoomTime(Date.now()+7200000);$('book-room').replaceChildren(...roomOptions(state).map(r=>new Option(r.name,r.id)));$('rooms-dialog').showModal();renderRoomBookings();}
$('rooms-open').onclick=openRoomBookings;$('book-room').onchange=updateRoomBookingForm;$('room-party').onchange=updateRoomBookingForm;$('room-book-kind').onchange=updateRoomBookingForm;
$('room-book-form').onsubmit=async e=>{e.preventDefault();const info=roomInfo(state,$('book-room').value);if(!info)return;$('room-book-save').disabled=true;try{const ok=await act({type:$('room-book-kind').value==='future'?'scheduleRoom':'bookRoom',startsAt:new Date($('room-start').value).getTime(),endsAt:new Date($('room-end').value).getTime(),roomId:info.id,partyId:$('room-party').value||undefined,name:$('room-name').value,size:Number($('room-size').value),notes:$('room-notes').value,highChair:$('room-highchair').checked,booster:$('room-booster').checked});if(ok){$('room-name').value='';$('room-notes').value='';$('room-highchair').checked=false;$('room-booster').checked=false;toast($('room-book-kind').value==='future'?'Future room booking saved.':'Whole room held. Its tables are unavailable for other parties.');}}finally{updateRoomBookingForm();}};

function localRoomTime(ms){const d=new Date(ms);return new Date(ms-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function formatRoomTime(ms){return ms?new Date(ms).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Staff release';}
function renderRoomSchedule(){
 const bookings=scheduledRooms(state).sort((a,b)=>a.startsAt-b.startsAt);
 $('room-timezone').textContent=`Booking times use this device’s timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Rooms stay blocked until staff releases them.`;
 $('room-upcoming').replaceChildren(...bookings.map(b=>{const card=el('div',{class:'room-block'});card.append(el('strong',{},`${b.name} · ${b.size} guests`),el('p',{},b.areas.map(id=>areaName(state,id)).join(' + ')),el('p',{},`${formatRoomTime(b.startsAt)} – ${formatRoomTime(b.endsAt)}`));if(b.notes)card.append(el('p',{},b.notes));
 if(canWrite()){const actions=el('div',{class:'actions'}),start=el('button',{class:'primary'},'Start booking'),cancel=el('button',{},'Cancel booking');start.disabled=Date.now()<b.startsAt-1800000||Date.now()>=b.endsAt;start.onclick=()=>act({type:'activateRoomBooking',id:b.id});cancel.onclick=async()=>{if(await confirmChange('Cancel future room booking?',`Cancel ${b.name} on ${formatRoomTime(b.startsAt)}?`))await act({type:'cancelRoomBooking',id:b.id});};actions.append(start,cancel);card.append(actions);}return card;}));
 if(!bookings.length)$('room-upcoming').append(el('p',{class:'muted'},'No future room bookings.'));
}

$('areas-open').onclick=async()=>{
 if(!state||!canEdit()||busy||uploadBusy)return;
 const {manageAreas}=await import('./area-manager.js');$('location').disabled=true;
 try{await manageAreas({getState:()=>state,locationName:locations.find(l=>l.id===locationId)?.name||'',save:async action=>{if(!await act(action))throw new Error($('toast').textContent||'Area change was not saved.');}});}
 finally{$('location').disabled=false;if(tableDraft)renderEditor();setView(areaOptions(state).some(a=>a.id===view)?view:'All');}
};
$('clean-plan').onclick=async()=>{
 if(!state?.background||!canEdit()||busy||uploadBusy)return;
 uploadBusy=true;$('location').disabled=true;
 try{await cleanUpPlan({state,href:demo?state.background.dataUrl:endpoint('floorplan')+`?v=${version}`,locationName:locations.find(l=>l.id===locationId)?.name||'',save:async covers=>{if(!await act({type:'cleanPlan',covers}))throw new Error('Cleanup was not saved. Close this window and reopen it to review the latest plan.');toast('Cleaned plan saved for this location.');}});}
 finally{uploadBusy=false;$('location').disabled=false;}
};
