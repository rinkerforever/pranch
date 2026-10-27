import {openClosingManager} from './closing-manager.js';
import {createTeam} from './team.js';
import {combineToolbar,needsCombinationOverride} from './combine-toolbar.js';
import {rotateFloorBox,rotateFloorPoint,floorAngle,floorTransform} from './floor-rotation.js';
import {diningProgress} from './dining-progress.js';
import {createTableAssignment} from './table-assignment.js';
import {reportView,reportClock} from './reports.js';
import {areaClosed,serviceTables,cleaningQueue,delayReason,undoAvailable,undoLabels} from './service-ops.js';
import {keyedChildren,floorImageUrl} from './render-cache.js';
import {areaOptions,areaName,roomOptions,partyRoomAreas} from './areas.js';
import {planImage,cleanUpPlan} from './plan-cleanup.js';
import {drawingBounds,fullPlanBox,tableFocusBox} from './plan-fit.js';
import {readyTracker} from './ready-alert.js';
import {adaptiveSync} from './adaptive-sync.js';
import {connectionIndicator} from './connection-indicator.js';
import {installApp,runtimeInfo,pairLocalServer,layoutSettings} from './device.js';
import {roomInfo,activeRoomBlocks,scheduledRooms,walkInTables} from './rooms.js';
import {partyDisplayUrl,openPartyDisplayAddon} from './party-display-addon.js';
import {planWaitlist,estimateNewParty,seatingOptions,waitRange,waitSettings} from './wait-plan.js';
import {guestForecast} from './wait-forecast.js';
import {preferredAreas,preferredSeating} from './accessibility.js';
import {presetCombinations,includesBoothCombination,childBoothFit} from './combinations.js';
import { suggestTables,preferDiningTables } from './suggestions.js';
import { WALL_PATH, ROOM_LABELS, DOORS, locationWallPath, upgradeNumbering, openSeats } from './floor.js';
const $=id=>document.getElementById(id), NS='http://www.w3.org/2000/svg';
const demo=new URLSearchParams(location.search).get('demo')==='1';
let state=null,version=0,profile=null,locations=[],locationId=null,role='viewer',selected=new Set(),partyId=null,editing=false,tableDraft=null,editGuest=null,busy=false,view='All',viewBox=[0,-20,1660,950],toastTimer,uploadBusy=false;
let demoModel;
let runtime={mode:'cloud'},transportReady=false,connection=null,alerts=readyTracker();
let backgroundFit=null,viewFitted=true;
let combining=false;
let seatNowMode=false,guestAdviceKey='';
let recoveringAccess=false;
let lastConnectionConfirmed=0,seatingReachable=true;
let activeScreen=['#waitlist','#busser','#reports'].includes(location.hash)?location.hash.slice(1):'floor';
function renderScreen(){
 $('manager-open').hidden=!canEdit();
 $('seat-now-open').hidden=activeScreen!=='floor'||editing||!canWrite();
 $('app').dataset.screen=activeScreen;
 history.replaceState(null,'','#'+activeScreen);
 const allowed=!!state&&locations.some(l=>l.id===locationId);$('sections-open').hidden=!allowed;$('undo-action').hidden=!allowed||!canWrite()||!undoAvailable(state);
 $('workspace').hidden=!allowed||activeScreen!=='floor';$('waitlist-screen').hidden=!allowed||activeScreen!=='waitlist';$('busser-screen').hidden=!allowed||activeScreen!=='busser';$('reports-screen').hidden=!allowed||activeScreen!=='reports';$('reports-open').classList.toggle('active',activeScreen==='reports');$('reports-open').setAttribute('aria-current',activeScreen==='reports'?'page':'false');$('busser-open').classList.toggle('active',activeScreen==='busser');$('busser-open').setAttribute('aria-current',activeScreen==='busser'?'page':'false');
 $('live-tab').classList.toggle('active',activeScreen==='floor');$('waitlist-open').classList.toggle('active',activeScreen==='waitlist');
 $('live-tab').setAttribute('aria-current',activeScreen==='floor'?'page':'false');$('waitlist-open').setAttribute('aria-current',activeScreen==='waitlist'?'page':'false');
 $('page-title').textContent=activeScreen==='reports'?'Daily service report':activeScreen==='busser'?'Busser screen':activeScreen==='waitlist'?'Waiting list':editing?'Layout editor':'Live floor';
 $('edit-tab').hidden=activeScreen!=='floor'||!canEdit();
 $('phone-floor').setAttribute('aria-pressed',activeScreen==='floor');$('phone-wait').setAttribute('aria-pressed',activeScreen==='waitlist');
}
function setScreen(screen){
 activeScreen=screen;closeSidebar();$('app').classList.remove('phone-menu-open');
 if(screen!=='floor')editing=false;
 renderScreen();if(state){if(screen==='waitlist')renderWaitlistView();else{render();requestAnimationFrame(()=>renderFloor());}}
}
const forecastTime=stamp=>new Date(stamp).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const forecastWindowText=window=>`${forecastTime(window.earliestAt)}–${forecastTime(window.latestAt)}`;
function renderConnection(){
 const status=connectionIndicator({mode:runtime.mode,confirmedAt:lastConnectionConfirmed,reachable:seatingReachable,connection,preview:demo});
 if(status.label.includes('Disconnected'))transportReady=false;
 $('connection-status').dataset.tone=status.tone;$('connection-label').textContent=status.label;
 $('connection-status').title=status.message;
 if($('connection-dialog').open){
  $('connection-restaurant').textContent=locations.find(l=>l.id===locationId)?.name||'No restaurant selected';
  $('connection-message').textContent=status.message;
  $('connection-source').textContent=demo?'Preview':runtime.mode==='local'?'Local restaurant Pi':'Cloud website';
  $('connection-confirmed').textContent=lastConnectionConfirmed?new Date(lastConnectionConfirmed).toLocaleString():'Not yet confirmed';
  const stamp=runtime.mode==='local'?connection?.lastCloud:connection?.lastSeen;
  $('connection-cloud').textContent=demo?'Preview only':!seatingReachable||status.label.includes('Disconnected')?'Not confirmed':connection?.requiresRecovery?'Recovery required':connection?.mode==='local'?connection.online?`Online${stamp?' · '+new Date(stamp).toLocaleTimeString():''}`:'Offline · guest QR check-in paused':'Online';
 }
}
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
 renderConnection();team.refresh();
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
  locationId=null;version=-1;
  lastConnectionConfirmed=0;seatingReachable=true;renderConnection();
  $('login').hidden=true;$('app').hidden=false;$('demo-banner').hidden=!demo;
  $('staff-open').hidden=!profile.system_admin;$('location').replaceChildren(...locations.map(l=>new Option(l.name,l.id)));
  $('local-server-open').hidden=demo||runtime.mode==='local'||!profile.system_admin;
  $('logout').textContent=runtime.mode==='local'?'Lock / switch employee':'Sign out';
  $('no-access').hidden=locations.length>0;renderScreen();
  if(locations.length){if(matchMedia('(max-width:599px)').matches)setView('C');locationId=locations[0].id;role=locations[0].role;await refresh(true);}
}
async function recoverLocationAccess(){
  if(recoveringAccess)return;
  recoveringAccess=true;transportReady=false;state=null;locationId=null;version=-1;selected.clear();partyId=null;tableDraft=null;editing=false;combining=false;
  $('workspace').hidden=true;$('waitlist-screen').hidden=true;$('busser-screen').hidden=true;$('reports-screen').hidden=true;$('sections-dialog').close();$('floor').replaceChildren();$('location').replaceChildren();
  for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
  showReadyAlert();
  try{await loadSession();toast('Your restaurant access changed. Available locations have been updated.');}
  catch(e){$('app').hidden=true;$('login').hidden=false;toast(e.message,true);}
  finally{recoveringAccess=false;}
}
function demoInitial(){let s=demoModel.initialState();
  s.parties=[{id:'johnson',name:'Johnson',size:6,notes:'Prefers main dining room',arrivedAt:Date.now()-18*60000,status:'waiting'},{id:'miller',name:'Miller',size:2,notes:'',arrivedAt:Date.now()-12*60000,status:'waiting'},{id:'davis',name:'Davis',size:4,notes:'One high chair',arrivedAt:Date.now()-8*60000,status:'waiting'}];
  // Explicit example quotes in preview data only; live history is never backfilled.
  for(const p of s.parties)p.waitQuote={recordedAt:p.arrivedAt,partySize:p.size,earliestAt:p.arrivedAt+10*60000,latestAt:p.arrivedAt+15*60000,tableIds:[]};
  for(const t of s.tables){if(['C-61','C-41','B-30','A-21','Piney Woods-21'].includes(t.id)){t.status='in_use';t.seatedAt=Date.now()-30*60000;}if(['C-70','A-42'].includes(t.id))t.status='cleaning';}
  s.tables.find(t=>t.id==='B-70').allowed=['B-60'];s.tables.find(t=>t.id==='B-60').allowed=['B-70'];return s;
}
const pendingRefreshes=new Set();
async function refresh(force=false){
  if(!locationId||busy||uploadBusy||pendingRefreshes.has(locationId))return;
  const requestedLocation=locationId;pendingRefreshes.add(requestedLocation);
  try{
    const data=demo?{state:JSON.parse(localStorage.getItem('seating-preview')||'null')||demoInitial(),version:version+1,role:'admin'}:await api(endpoint('state'));
    if(requestedLocation!==locationId||busy||data.version<version)return;
    if(force)viewFitted=true;
    connection=data.connection;transportReady=!connection?.requiresRecovery&&!(runtime.mode!=='local'&&connection?.mode==='local'&&!connection.online);
    if(force||data.version!==version||role!==data.role){state=presetCombinations(upgradeNumbering(data.state));version=data.version;role=data.role;if(force&&(state.background?.imported||state.areaConfig))viewBox=importedViewBox(view);selected=new Set([...selected].filter(id=>state.tables.some(t=>t.id===id)));if(!state.parties.some(p=>p.id===partyId&&p.status==='waiting'))partyId=null;render();}
    else if(!editing){renderWait();renderSelection();renderRoomBookings();}
    lastConnectionConfirmed=Date.now();seatingReachable=true;connectionStatus(data.connection);showReadyAlert();if($('guest-dialog').open)renderGuestQuote();
  }catch(e){if(requestedLocation!==locationId)return;transportReady=false;seatingReachable=false;renderConnection();showReadyAlert();sync(false,'Disconnected · changes unavailable');if(e.status===401){$('login').hidden=false;$('app').hidden=true;}else if(e.status===403){if(recoveringAccess)throw e;await recoverLocationAccess();}else if(force)toast(e.message,true);}finally{pendingRefreshes.delete(requestedLocation);}
}
async function act(action){
  if(busy||!transportReady){if(!busy)toast('Reconnect to the restaurant before making changes.',true);return false;}busy=true;$('location').disabled=true;sync(false,'Saving…');
  const releasedTables=action.type==='releaseRoom'?state.tables.filter(t=>t.roomBlock===action.id).map(t=>t.id):[];
  try{const data=demo?{state:demoModel.applyAction(state,action,role),version:version+1}:await api(endpoint('actions'),{method:'POST',headers:{'x-request-id':crypto.randomUUID()},body:JSON.stringify({version,action})});
    state=presetCombinations(upgradeNumbering(data.state));version=data.version;if(demo)localStorage.setItem('seating-preview',JSON.stringify(state));
    if(action.type==='seat'||action.type==='seatNow'||action.type==='cancelParty')partyId=null;
    selected=new Set([...selected].filter(id=>!releasedTables.includes(id)&&state.tables.some(t=>t.id===id)));
    if(['status','seat','seatNow','combine','split','reassign'].includes(action.type)){selected.clear();combining=false;closeSidebar();}
    lastConnectionConfirmed=Date.now();seatingReachable=true;render();connectionStatus();showReadyAlert();return true;
  }catch(e){toast(e.message,true);sync(false,'Change not saved');if(e.status===409){busy=false;await refresh(true);}if(e.status===401){$('app').hidden=true;$('login').hidden=false;}if(e.status===403){busy=false;await recoverLocationAccess();}return false;}finally{busy=false;$('location').disabled=false;}
}
function current(){return state.tables.filter(t=>selected.has(t.id));}
function canWrite(){return transportReady&&['admin','manager','host'].includes(role);}
function canEdit(){return transportReady&&['admin','manager'].includes(role);}
function label(t){return /^[A-Z]+\d/i.test(t.number)?t.number:`${areaName(state,t.area)}-${t.number}`;}
function minutes(stamp){return Math.max(0,Math.floor((Date.now()-stamp)/60000));}
function groupTables(t){return t.group?state.tables.filter(o=>o.group===t.group):[t];}
function updatePhoneNav(){ $('phone-floor').setAttribute('aria-pressed',activeScreen==='floor');$('phone-wait').setAttribute('aria-pressed',activeScreen==='waitlist'); }
function showSidebar(panel){updatePhoneNav(panel==='waiting');$('workspace').dataset.panel=panel;$('workspace').classList.add('sidebar-open');$('tablet-details').setAttribute('aria-expanded',panel==='details');}
function closeSidebar(){updatePhoneNav(false);$('workspace').classList.remove('sidebar-open');for(const id of ['tablet-details'])$(id).setAttribute('aria-expanded','false');}
function chooseTable(t){
  if(busy)return;
  if(editing){showSidebar('details');selected=new Set([t.id]);tableDraft=structuredClone(t);renderFloor();renderEditor();return;}
  const group=groupTables(t),remove=group.every(o=>selected.has(o.id));
  if(combining||partyId){
    if(group.some(o=>o.status!=='open')){toast('Choose open tables to combine.');return;}
    for(const o of group){if(remove)selected.delete(o.id);else selected.add(o.id);}
  }else{selected=remove?new Set():new Set(group.map(o=>o.id));if(partyId)showSidebar('details');else{closeSidebar();if(!remove&&view==='All'){view=t.area;viewFitted=true;viewBox=importedViewBox(view);renderAreas();}}}
  renderFloor();renderSelection();
}
function tableSymbol(t){
  const cap=t.capacity||0,across=t.orientation==='tb',long=Math.max(38,Math.ceil(cap/2)*14+7);
  const w=t.kind==='booth'?44:(across?(cap<=6?44:long):44),h=t.kind==='booth'?44:(across?38:long);
  const group=svg('g',{class:`table-node ${areaClosed(state,t.area)?'section-closed ':''}${t.status}${selected.has(t.id)?' is-selected':''}`,transform:`translate(${t.x} ${t.y}) rotate(${floorAngle(state,view)})`,role:'button',tabindex:0,'aria-label':`${label(t)}, ${t.kind==='booth'?'booth, ':''}${cap?cap+' seats':'capacity unconfirmed'}, ${names[t.status]}`,'data-id':t.id,'aria-pressed':selected.has(t.id)});
  group.append(svg('title',{},`${label(t)} · ${cap?cap+' seats':'Confirm booth capacity'} · ${names[t.status]}`));
  if(t.kind==='booth'){
    for(const sign of [-1,1])group.append(svg('rect',across?{x:-w/2,y:sign<0?-h/2-9:h/2+3,width:w,height:6,rx:2,class:'chair'}:{x:sign<0?-w/2-9:w/2+3,y:-h/2,width:6,height:h,rx:2,class:'chair'}));
  }else{
    const sides=[Math.ceil(cap/2),Math.floor(cap/2)];
    sides.forEach((count,side)=>{for(let i=0;i<count;i++){const pos=(i-(count-1)/2)*14;group.append(svg('rect',across?{x:pos-5,y:side===0?-h/2-11:h/2+3,width:10,height:8,rx:2,class:'chair'}:{x:side===0?-w/2-11:w/2+3,y:pos-5,width:8,height:10,rx:2,class:'chair'}));}});
  }
  group.append(svg('rect',{x:-w/2,y:-h/2,width:w,height:h,rx:5,class:'table-surface'}));
  group.append(svg('text',{x:0,y:0,class:'number'},t.number),svg('text',{x:0,y:12,class:'seat-label'},cap?`${cap} seats`:'Seats · ?'));
  if(!editing){const timing=diningProgress(t,waitSettings(state).diningMinutes);if(timing){
   for(const progress of [false,true])group.append(svg('rect',{x:-w/2-2,y:-h/2-2,width:w+4,height:h+4,rx:7,fill:'none',class:`dining-ring ${progress?(timing.overdue?'overdue':'elapsed'):'track'}`,pathLength:100,...(progress?{'stroke-dasharray':`${timing.percent} 100`}:{})}));
   group.querySelector('.seat-label').textContent=timing.short;
   group.querySelector('title').textContent+=` · ${timing.description}`;
   group.setAttribute('aria-label',group.getAttribute('aria-label')+`, ${timing.description}`);
  }}
  group.append(svg('rect',{x:-w/2-15,y:-h/2-15,width:w+30,height:h+30,rx:7,class:'focus-ring','pointer-events':'all'}));
  group.append(svg('rect',{x:-w/2-18,y:-h/2-18,width:w+36,height:h+36,rx:10,class:'team-assignment-ring','pointer-events':'none'}));
  if(t.group)group.append(svg('circle',{cx:w/2-2,cy:-h/2+1,r:3,fill:'#3476ba'}));
  if(t.status==='in_use'&&t.funZone){
   const badge=svg('g',{class:'funzone-badge',transform:`translate(${w/2+1} ${-h/2-1})`,'pointer-events':'none'});
   badge.append(svg('circle',{r:11,fill:'#ffe19a',stroke:'#ac750e','stroke-width':1.5}),svg('path',{d:'M-5 -7H5L4 0 6 7H-6L-4 0Z',fill:'#ad2429'}),svg('rect',{x:-3,y:-5,width:6,height:4,rx:1,fill:'#fff5d5'}),svg('path',{d:'M-3 2V4M-4 3H-2M1 3H3',stroke:'#fff5d5','stroke-width':1.3}));group.append(badge);
   const tag=svg('g',{'pointer-events':'none'});tag.append(svg('rect',{x:-27,y:h/2+12,width:54,height:12,rx:4,fill:'#ffda75'}),svg('text',{x:0,y:h/2+21,'text-anchor':'middle',fill:'#372900','font-size':8,'font-weight':700},t.funZoneSince?'FunZone '+minutes(t.funZoneSince)+'m':'In FunZone'));group.append(tag);
   group.querySelector('title').textContent+=' · In FunZone';group.setAttribute('aria-label',group.getAttribute('aria-label')+', In FunZone');
  }
  group.addEventListener('click',()=>{if(!group.dataset.dragged)chooseTable(t);});
  group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseTable(t);}});
  group.addEventListener('pointerdown',e=>{
    if(!editing||t.status!=='open'||t.group)return;
    selected=new Set([t.id]);tableDraft=structuredClone(t);renderEditor();
    const start={x:e.clientX,y:e.clientY};group.dataset.dragged='';group.setPointerCapture(e.pointerId);
    const move=ev=>{if(Math.hypot(ev.clientX-start.x,ev.clientY-start.y)<4)return;group.dataset.dragged='1';const p=$('floor').createSVGPoint();p.x=ev.clientX;p.y=ev.clientY;const local=p.matrixTransform($('floor-tables').getScreenCTM().inverse());tableDraft.x=Math.max(30,Math.min(1630,Math.round(local.x)));tableDraft.y=Math.max(30,Math.min(920,Math.round(local.y)));group.setAttribute('transform',`translate(${tableDraft.x} ${tableDraft.y}) rotate(${floorAngle(state,view)})`);$('table-x').value=tableDraft.x;$('table-y').value=tableDraft.y;};
    const up=()=>{group.removeEventListener('pointermove',move);group.removeEventListener('pointerup',up);if(group.dataset.dragged)toast('Position updated. Choose Save table to apply it.');setTimeout(()=>delete group.dataset.dragged,50);};group.addEventListener('pointermove',move);group.addEventListener('pointerup',up);
  });return group;
}
function preparePlanFit(){
 if(!state.background)return;
 const key=locationId+'|'+(state.background.key||state.background.dataUrl);
 if(backgroundFit?.key===key)return;
 const fit=backgroundFit={key,bounds:null};
 const image=new Image();image.src=floorImageUrl(endpoint('floorplan'),state.background,demo);
 image.decode().then(()=>{
  const canvas=document.createElement('canvas');canvas.width=1660;canvas.height=950;
  const ctx=canvas.getContext('2d',{willReadFrequently:true}),scale=Math.min(1660/image.naturalWidth,950/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
  ctx.drawImage(image,(1660-w)/2,(950-h)/2,w,h);fit.bounds=drawingBounds(ctx.getImageData(0,0,1660,950));
  if(backgroundFit===fit&&view==='All'&&viewFitted){viewBox=fullPlanBox(fit.bounds,state.tables);renderFloor();}
 }).catch(()=>{/* Keep the complete canvas if the image cannot be inspected. */});
}
let floorSceneKey=null;
function renderFloor(){
  preparePlanFit();
  $('rotate-view').disabled=!canWrite()||busy;
  $('rotate-view').title=`Rotate this view 180° (currently ${floorAngle(state,view)}°)`;
  if(view==='All'&&state.background&&viewFitted)viewBox=fullPlanBox(backgroundFit?.bounds,state.tables);
  const viewport=$('floor');viewport.setAttribute('viewBox',rotateFloorBox(viewBox,floorAngle(state,view)).join(' '));
  if(!viewport.querySelector('#floor-static')){
   const clip=svg('clipPath',{id:'floor-view-clip'});clip.append(svg('rect',{id:'floor-view-bounds'}));
   const defs=svg('defs');defs.append(clip);
   const scene=svg('g',{'clip-path':'url(#floor-view-clip)'});
   scene.append(svg('g',{id:'floor-static'}),svg('g',{id:'floor-groups'}),svg('g',{id:'floor-tables'}));
   viewport.replaceChildren(defs,scene);floorSceneKey=null;
  }
  const bounds=$('floor-view-bounds');for(const [i,name] of ['x','y','width','height'].entries())bounds.setAttribute(name,rotateFloorBox(viewBox,floorAngle(state,view))[i]);
  const sceneKey=JSON.stringify([floorAngle(state,view),locationId,locationWallPath(locationId,state),state.background||null,...(state.background?[]:[areaOptions(state),roomOptions(state).map(r=>{const info=roomInfo(state,r.id);return [r.id,info.capacity,info.blocks.length];}),activeRoomBlocks(state).some(b=>b.roomId==='combined')])]);
  if(sceneKey!==floorSceneKey){
   const floor=$('floor-static');floor.replaceChildren();floorSceneKey=sceneKey;
  if(state.background)floor.append(planImage(floorImageUrl(endpoint('floorplan'),state.background,demo),state.background.covers));
  else{
    floor.append(svg('rect',{x:10,y:0,width:1600,height:870,fill:'#f8f9f4'}),svg('path',{d:activeRoomBlocks(state).some(b=>b.roomId==='combined')?WALL_PATH.replace('M1205 0V130',''):WALL_PATH,class:'wall'}));
    if(activeRoomBlocks(state).some(b=>b.roomId==='combined')){const divider=svg('path',{d:'M1205 0V130',fill:'none',stroke:'#9562aa','stroke-width':2,'stroke-dasharray':'4 6','aria-label':'Rose City and Azalea Trail divider open for combined booking'});divider.append(svg('title',{},'Divider open · combined room booking'));floor.append(divider);}
    for(const door of DOORS){const g=svg('g',{'aria-label':door.name});g.append(svg('title',{},door.name),svg('path',{d:door.opening,class:'door-opening'}),svg('path',{d:door.swing,class:'door-swing'}));floor.append(g);}
    for(const[text,x,y]of ROOM_LABELS){
      const areaId=text.startsWith('Section ')?text.slice(8):text,area=areaOptions(state).find(a=>a.id===areaId),isArea=['A','B','C','Rose City','Azalea Trail','Piney Woods'].includes(areaId);
      if(isArea&&!area)continue;
      const small=!['Funzone','Kitchen'].includes(text),display=area?area.name:text;
      const n=svg('text',{x,y,class:`room-label${small?' small':''}${text.startsWith('Section')?' section':''}`},display);n.setAttribute('transform',`rotate(${floorAngle(state,view)+(text.includes('restroom')?-90:0)} ${x} ${y})`);floor.append(n);
      const room=roomOptions(state).find(r=>r.areas.length===1&&r.areas[0]===areaId);
      if(room){const info=roomInfo(state,room.id);floor.append(svg('text',{x,y:y+15,class:'room-label small',transform:`rotate(${floorAngle(state,view)} ${x} ${y+15})`},`${info.capacity} seats${info.blocks.length?' · Booked':''}`));}
    }
    floor.append(svg('rect',{x:1475,y:485,width:94,height:42,rx:3,fill:'none',stroke:'#b1b8ad','stroke-width':2}));
  }
  }
  const wall=locationWallPath(locationId,state);let extra=$('location-walls');if(wall){if(!extra){extra=svg('path',{id:'location-walls',class:'wall','aria-label':'Tyler table dividers'});$('floor-static').append(extra);}extra.setAttribute('d',wall);}else extra?.remove();
  const groups=[...new Set(state.tables.map(t=>t.group).filter(Boolean))].map(id=>({id,tables:state.tables.filter(t=>t.group===id)}));
  keyedChildren($('floor-groups'),groups,g=>g.id,g=>JSON.stringify(g.tables.map(t=>[t.id,t.x,t.y])),g=>{const node=svg('g');for(let i=1;i<g.tables.length;i++){const a=g.tables[i-1],b=g.tables[i];node.append(svg('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'group-line'}));}return node;});
  keyedChildren($('floor-tables'),state.tables,t=>t.id,t=>JSON.stringify([floorAngle(state,view),locationId,t,areaClosed(state,t.area),selected.has(t.id),editing,combining,canWrite(),t.status==='in_use'?[Math.floor(Date.now()/60000),waitSettings(state).diningMinutes]:null]),tableSymbol);
  for(const s of Object.keys(names))$('count-'+s).textContent=state.tables.filter(t=>t.status===s&&(s!=='open'||serviceTables(state).includes(t))).length;
  const seats=openSeats(serviceTables(state));$('count-seats').textContent=seats.count;$('phone-seat-count').textContent=seats.count;$('phone-seat-note').textContent=seats.unconfirmed?'Confirmed capacity only':'Restaurant total';
  $('seat-count-note').textContent=seats.unconfirmed?`${seats.unconfirmed} open booths/tables need a capacity; excluded from seat count.`:'';
  $('combine-select').hidden=editing||!canWrite();$('combine-cancel').hidden=!combining||editing;
  $('combine-select').setAttribute('aria-pressed',String(combining));
  const combineControl=combineToolbar(state,[...selected],combining);
  $('combine-select').textContent=combineControl.label;
  $('combine-select').disabled=combineControl.disabled;
  $('combine-select').title=combineControl.action==='split'&&combineControl.disabled?'Clear the seated party before un-combining tables.':'';
  $('selection-hint').textContent=combining?'Select open tables, then tap Apply.':selected.size?`${selected.size} table${selected.size===1?'':'s'} selected`:'Tap a table to select it';
  $('plan-note').textContent=state.background?`Uploaded plan: ${state.background.name}. Review seats and table positions in Layout editor.`:'Chair counts follow your PDF. Booth capacities remain unconfirmed until set in Layout editor.';
  $('reassign-open').hidden=!canWrite()||!current().length||current().some(t=>t.status!=='in_use'||t.roomBlock);
  const away=current().length>0&&current().every(t=>t.funZone);const fun=$('funzone-toggle');fun.hidden=editing||!canWrite()||!current().length||current().some(t=>t.status!=='in_use');fun.textContent=away?'Back from FunZone':'In FunZone';fun.setAttribute('aria-pressed',String(away));
  $('save-layout').disabled=!editing||!tableDraft||busy;
  for(const id of ['floor-static','floor-groups','floor-tables'])$(id).setAttribute('transform',floorTransform(floorAngle(state,view)));
  renderFocusDock();
  team.paintHighlights();
}
let overviewKey='',focusDockKey='';
function renderFocusDock(){
 const dock=$('focus-dock');dock.hidden=editing;if(editing)return;
 const map=$('floor-overview'),key=JSON.stringify([floorAngle(state,'All'),locationId,floorSceneKey,state.tables.map(t=>[t.id,t.x,t.y,t.area,t.status]),areaOptions(state),backgroundFit?.bounds]);
 if(key!==overviewKey){
  overviewKey=key;map.replaceChildren();map.setAttribute('viewBox',rotateFloorBox(fullPlanBox(backgroundFit?.bounds,state.tables),floorAngle(state,'All')).join(' '));
  const mapScene=svg('g',{id:'overview-scene',transform:floorTransform(floorAngle(state,'All'))});map.append(mapScene);
  const background=$('floor-static').cloneNode(true);background.removeAttribute('id');background.removeAttribute('transform');for(const label of background.querySelectorAll('text[transform]')){const transform=label.getAttribute('transform');label.setAttribute('transform',transform.replace(/rotate\((-?\d+)/,(_,angle)=>'rotate('+(Number(angle)+floorAngle(state,'All')-floorAngle(state,view))));}background.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));background.setAttribute('pointer-events','none');mapScene.append(background);
  for(const t of state.tables)mapScene.append(svg('rect',{x:t.x-16,y:t.y-16,width:32,height:32,rx:3,fill:({open:'#b8dcbc',in_use:'#dc9c96',cleaning:'#e8c56d',reserved:'#c5a6d7'})[t.status]||'#ddd','pointer-events':'none'}));
  for(const area of areaOptions(state)){
   const ts=state.tables.filter(t=>t.area===area.id);if(!ts.length)continue;
   const [x,y,width,height]=importedViewBox(area.id),target=svg('rect',{x,y,width,height,fill:'transparent',role:'button',tabindex:0,'aria-label':`Show ${area.name}`,'data-area':area.id,class:'overview-area'});
   target.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setView(area.id);}});mapScene.append(target);
  }
  map.onclick=e=>{const p=map.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const matrix=map.getScreenCTM();if(!matrix)return;const point=rotateFloorPoint(p.matrixTransform(matrix.inverse()),floorAngle(state,'All'));const nearest=state.tables.reduce((best,t)=>!best||Math.hypot(t.x-point.x,t.y-point.y)<Math.hypot(best.x-point.x,best.y-point.y)?t:best,null);if(nearest)setView(nearest.area);};
  mapScene.append(svg('rect',{id:'overview-view',fill:'#2878ba18',stroke:'#175fa8','stroke-width':8,'pointer-events':'none'}));
 }
 const marker=$('overview-view');if(marker)for(const [i,k]of ['x','y','width','height'].entries())marker.setAttribute(k,viewBox[i]);
 $('overview-caption').textContent=view==='All'?'Full plan · Tap an area':`${areaName(state,view)} · Tap another area`;
 const dockKey=JSON.stringify([locationId,view,current(),canWrite(),partyId,Math.floor(Date.now()/60000),waitSettings(state)]);if(dockKey===focusDockKey)return;focusDockKey=dockKey;
 const tables=current(),summary=$('focus-summary'),actions=$('focus-actions');summary.replaceChildren();actions.replaceChildren();dock.classList.toggle('has-selection',tables.length>0);summary.hidden=!tables.length;
 summary.append(el('span',{class:'eyebrow'},tables.length?'SELECTED TABLE':'AREA VIEW'),el('strong',{},tables.length?tables.map(label).join(' + '):view==='All'?'Choose an area':areaName(state,view)));
 if(tables.length){summary.append(el('span',{},`${tables.reduce((n,t)=>n+(t.capacity||0),0)} seats · ${[...new Set(tables.map(t=>names[t.status]))].join(' / ')}`));for(const t of tables){const timing=diningProgress(t,waitSettings(state).diningMinutes);if(timing)summary.append(el('p',{class:'focus-timing'},`${tables.length>1?label(t)+': ':''}${timing.description}`));}}
 else summary.append(el('span',{},'Tap a table for seating and status controls.'));
 const button=(text,fn,primary=false)=>{const b=el('button',{class:primary?'primary':''},text);b.onclick=fn;actions.append(b);return b;};
 if(tables.length){



  if(canWrite()&&!tables.some(t=>t.roomBlock))for(const [status,text]of [['in_use','Mark in use'],['cleaning','Cleaning'],['open','Mark open']])button(text,async()=>{if(busy)return;if(tables.some(t=>t.party)&&status!=='in_use'&&!await confirmChange('Clear seated party?',`Mark ${tables.map(label).join(' + ')} ${names[status].toLowerCase()} and finish the seated party?`))return;await act({type:'status',ids:tables.map(t=>t.id),status});});
 }

}
let planCache=null,planState=null,planMinute=-1;
function currentPlan(){const minute=Math.floor(Date.now()/60000);if(planState!==state||planMinute!==minute){planCache=planWaitlist(state);planState=state;planMinute=minute;}return planCache;}
function chooseWaitingParty(p,tables=[]){combining=false;partyId=p.id;selected=new Set(tables.map(t=>t.id));editing=false;activeScreen='floor';renderScreen();render();showSidebar('details');if(tables.length)focusTables(tables);}
function renderQuote(){if(!state)return;const estimate=estimateNewParty(currentPlan(),Number($('estimate-size').value),{accessibility:$('estimate-accessibility').checked});$('estimate-result').textContent=waitRange(estimate);}
function renderGuestQuote(){
 if(!state)return;const size=Number($('guest-size').value),preferences={accessibility:$('guest-accessibility').checked},plan=currentPlan();
 const key=[version,size,preferences.accessibility,seatNowMode,Math.floor(Date.now()/60000)].join('|');if(key===guestAdviceKey)return;guestAdviceKey=key;
 const estimate=editGuest?plan.rows.find(r=>r.party.id===editGuest&&r.party.size===size&&!!r.party.accessibility===preferences.accessibility)?.estimate:estimateNewParty(plan,size,preferences);
 const basis=`${plan.settings.diningMinutes} min dining + ${plan.settings.cleaningMinutes} min cleaning · ${plan.settings.source}${plan.settings.sampleCount?' · '+plan.settings.sampleCount+' completed visits':''}.`;
 $('guest-estimate').textContent=(seatNowMode?'':editGuest&&!estimate?'Updated estimate appears after saving. ':`Estimated wait: ${waitRange(estimate)}. `)+basis+(preferences.accessibility&&preferredAreas(state).size===0?' No preferred areas configured yet; confirm suitable seating with the guest.':'');
 if(!seatNowMode)return;
 const options=seatingOptions(plan,size,{...preferences,selectedIds:[...selected]}),previous=$('seat-now-options').querySelector('select')?.value;
 const keepPrevious=options.open.some(o=>JSON.stringify(o.tables.map(t=>t.id))===previous);
 const tableChoice=el('select',{'aria-label':'Suggested table for Seat now'});
 for(const option of options.open)tableChoice.append(new Option(`${option.tables.map(label).join(' + ')} · ${option.capacity} seats${option.selectedOnFloor?' · Selected on floor':''}${option.accessiblePreferred?' · Accessible area':''}${includesBoothCombination(option.tables)?' · Booth combination':''}`,JSON.stringify(option.tables.map(t=>t.id))));
 if(keepPrevious)tableChoice.value=previous;tableChoice.disabled=!options.open.length;
 $('seat-now-options').replaceChildren(tableChoice);
 if(selected.size&&!options.open.some(o=>o.selectedOnFloor))$('seat-now-options').prepend(el('p',{class:'muted'},'Your floor selection is not available for this party size after the current waitlist and bookings. Choose another option below, or choose an existing waiting party above.'));
 if(!options.open.length)$('seat-now-options').append(el('p',{class:'empty'},'No suitable open table after the current queue. Add this party to the waitlist or adjust the party size.'));
 $('guest-save').disabled=!canWrite()||!options.open.length;
 $('seat-now-soon').replaceChildren(...options.soon.map(option=>{
  const row=el('p',{class:'forecast-option'}),occupied=option.tables.map(t=>state.tables.find(o=>o.id===t.id)).filter(t=>t?.status==='in_use'&&t.seatedAt),elapsed=occupied.length?Math.round(Math.max(...occupied.map(t=>(Date.now()-t.seatedAt)/60000))):null;
  row.append(el('strong',{},option.tables.map(label).join(' + ')),el('span',{},` · ${waitRange(option)}${option.accessiblePreferred?' · Accessibility preferred':''}${elapsed!==null?' · Current guests seated '+elapsed+' min':''}`));return row;
 }));
 if(!options.soon.length)$('seat-now-soon').append(el('p',{class:'muted'},estimate&&!estimate.ready?`Next estimated fit: ${waitRange(estimate)}.`:'No additional fit expected within 30 minutes.'));
 $('seat-now-soon').append(el('p',{class:'muted'},'Forecasts include the current queue. Occupied or cleaning tables must be cleared by staff before seating; estimates do not reserve a table.'));
}
function renderWaitlistView(){
 if(activeScreen!=='waitlist'||!state)return;
 const plan=currentPlan(),rows=plan.rows,ready=rows.filter(r=>r.estimate?.ready).length;
 $('waitlist-location').textContent=locations.find(l=>l.id===locationId)?.name||'';
 const now=Date.now(),late=rows.filter(r=>guestForecast(r.party,r.estimate,now).pastEstimate).length;
 const summary=$('waitlist-summary');summary.replaceChildren();
 for(const [value,title,note,tone] of [[rows.length,'parties',`${rows.reduce((n,r)=>n+r.party.size,0)} guests waiting`,''],[ready,'ready to seat','Review the open table','ready'],[late,'past estimate','Review these guests first','late'],[rows.length?Math.max(...rows.map(r=>minutes(r.party.arrivedAt))):0,'min','Longest current wait','']]){const card=el('div',{class:`wait-stat ${tone}`});card.append(el('strong',{},`${value} ${title}`),el('small',{},note));summary.append(card);}
 $('waitlist-updated').textContent=`Forecasts updated ${forecastTime(lastConnectionConfirmed||now)} · Times are estimates, not table reservations.`;
 $('waitlist-add').disabled=!canWrite();
 $('wait-estimate-basis').textContent=`${plan.settings.source}: ${plan.settings.diningMinutes} min dining + ${plan.settings.cleaningMinutes} min cleaning. Uses time already seated and current queue. Overdue occupied tables keep a 10-minute buffer. Update table statuses promptly.`;
 $('waitlist-empty').hidden=rows.length>0;
 keyedChildren($('waitlist-rows'),rows.map((r,i)=>({...r,index:i})),r=>r.party.id,r=>JSON.stringify([locationId,r,Math.floor(now/60000),canWrite()]),({party:p,estimate,combinationPriority,index:i})=>{
  const forecast=guestForecast(p,estimate,now),row=el('tr',{class:`${estimate?.ready?'ready-row ':''}${forecast.pastEstimate?'past-estimate-row':''}`}),guest=el('td'),wait=el('td'),eta=el('td'),table=el('td'),action=el('td');
  wait.append(el('strong',{},`${forecast.waitedMinutes} min`),el('small',{},`Arrived ${forecastTime(p.arrivedAt)}`));
  guest.append(el('strong',{},`${i+1}. ${p.name}`),el('small',{},`${p.size} guests${p.highChair?' · High chair':''}${p.booster?' · Booster':''}`));
  if(p.guestSizeChangedAt)guest.append(el('small',{},`Guest updated size: ${p.previousGuestSize} → ${p.size} · ${forecastTime(p.guestSizeChangedAt)}`));
  if(p.attendance==='away')guest.append(el('strong',{class:'attendance-note'},`Not present · ${minutes(p.awayAt)} min`));
  else if(p.calledAt)guest.append(el('strong',{class:'attendance-note'},`Called ${minutes(p.calledAt)} min ago`));
  if(p.accessibility)guest.append(el('small',{},'Accessibility-preferred seating'));
  if(p.notes)guest.append(el('small',{},p.notes));
  if(combinationPriority)guest.append(el('span',{class:'combination-tag'},'Combination priority'));
  eta.append(el('strong',{},p.attendance==='away'?'Paused — guest not present':estimate?.ready?'Ready to seat now':forecast.current?forecastWindowText(forecast.current):'Host review needed'));
  if(!estimate?.ready&&forecast.current)eta.append(el('small',{},`About ${forecast.current.lower}–${forecast.current.upper} min more`));
  eta.append(el('small',{},forecast.original?`Original window: ${forecastWindowText(forecast.original)}`:'Original estimate not recorded'));
  if(forecast.original&&forecast.original.partySize!==p.size)eta.append(el('small',{},`Original estimate was for ${forecast.original.partySize} guests`));
  if(forecast.pastEstimate)eta.append(el('strong',{class:'overdue-estimate'},`${forecast.pastMinutes} min past original window`));
  table.append(el('span',{},estimate?estimate.tables.map(label).join(' + '):'No configured fit'));
  if(estimate?.accessiblePreferred)table.append(el('small',{},'Accessibility-preferred area'));
  if(estimate&&includesBoothCombination(estimate.tables))table.append(el('small',{},'Includes booth · confirm fit'));
  table.append(el('small',{},delayReason(p,estimate)));
  const button=el('button',{class:estimate?.ready?'primary small':'small'},estimate?.ready?'Review & seat':'View options');button.onclick=()=>chooseWaitingParty(p,estimate?.ready?estimate.tables:[]);action.append(button);
  if(canWrite()){
   for(const [contact,title] of p.attendance==='away'?[['waiting','Return to waiting']]:[['called',p.calledAt?'Call again':'Called'],['away','Not here']]){
    const contactButton=el('button',{class:'small'},title);contactButton.onclick=async()=>{if(contact==='away'&&!await confirmChange('Guest not present?',`Pause table planning for ${p.name}? Their original arrival time and quote stay saved. Return them to waiting when they arrive.`))return;await act({type:'partyContact',id:p.id,contact});};action.append(contactButton);
   }
  }
  if(canWrite()){const edit=el('button',{class:'quiet small'},'Adjust party');edit.onclick=()=>openGuest(p);action.append(edit);const remove=el('button',{class:'quiet small danger'},'Remove');remove.onclick=async()=>{if(await confirmChange('Remove waiting party?',`Remove ${p.name} from the waiting list?`))await act({type:'cancelParty',id:p.id});};action.append(remove);}
  const controls=el('div',{class:'wait-row-actions'});controls.append(...action.childNodes);action.append(controls);
  row.append(guest,wait,eta,table,action);return row;
 });renderQuote();
}
function renderWait(){
  const plan=currentPlan();renderServiceTools();renderReport();renderWaitlistView();if($('guest-dialog').open)renderGuestQuote();
  const waiting=state.parties.filter(p=>p.status==='waiting').sort((a,b)=>a.arrivedAt-b.arrivedAt);$('rail-wait-count').textContent=waiting.length;$('wait-count').textContent=waiting.length;$('phone-wait-count').textContent=waiting.length;$('add-guest').disabled=!canWrite();
}

let selectionRenderKey=null;
const tableAssignment=createTableAssignment({
 context:()=>({state,location:locationId,canWrite:canWrite()&&!busy,label}),
 seat:async(id,ids)=>{
  const party=state.parties.find(p=>p.id===id&&p.status==='waiting'),tables=state.tables.filter(t=>ids.includes(t.id));
  if(!party||!canWrite())return false;
  const boothAcknowledged=includesBoothCombination(tables);
  if(!await confirmChange('Confirm seating',`Seat ${party.name}, party of ${party.size}, at ${tables.map(label).join(' + ')}?${boothAcknowledged?' This includes a fixed booth; confirm the fit and clear aisle.':''}`))return false;
  const saved=await act({type:'seat',partyId:id,ids,boothAcknowledged});if(saved)toast(`${party.name} seated.`);return saved;
 },
 changeTables:(id,ids)=>{partyId=id;selected=new Set(ids);combining=true;closeSidebar();renderFloor();renderSelection();toast('Tap open tables to adjust the selection, then Review.');}
});
function openSeatWholeRoom(){
 if(!canWrite()||busy)return;
 const dialog=document.createElement('dialog');dialog.className='seat-room-dialog';
 dialog.innerHTML='<div class="panel-title"><h2>Seat a party room</h2><button type="button" class="quiet">Close</button></div><p>Seat a waiting party now. Every table in the selected room will be assigned to that party.</p><div class="room-seat-choices"></div><label>Waiting party<select class="room-seat-party"></select></label><label>Room time (minutes)<input class="room-seat-time" type="number" min="1" max="720" value="120"></label><p class="room-seat-info" role="status"></p><button class="primary wide room-seat-submit" disabled>Choose a room and party</button><p class="muted">Future reservations remain in Bookings. Current bookings, closed sections, and occupied tables must be cleared before seating.</p>';
 document.body.append(dialog);let chosen=null,saving=false;
 const choices=dialog.querySelector('.room-seat-choices'),guest=dialog.querySelector('select'),duration=dialog.querySelector('input'),info=dialog.querySelector('.room-seat-info'),save=dialog.querySelector('.room-seat-submit');
 dialog.querySelector('.quiet').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 guest.append(new Option('Choose a waiting party',''),...state.parties.filter(p=>p.status==='waiting').sort((a,b)=>a.arrivedAt-b.arrivedAt).map(p=>new Option(`${p.name} · ${p.size} guests${p.attendance==='away'?' · Away':''}`,p.id)));
 const options=roomOptions(state).filter(r=>r.areas.length<=2);
 function update(){
  const minutes=Number(duration.value),party=state.parties.find(p=>p.id===guest.value&&p.status==='waiting'),room=chosen&&roomInfo(state,chosen);
  const conflict=room&&scheduledRooms(state).some(b=>b.areas.some(a=>room.areas.includes(a))&&b.startsAt<Date.now()+minutes*60000&&b.endsAt>Date.now());
  const valid=room?.available&&!room.unconfirmed&&party&&party.attendance!=='away'&&party.size<=room.capacity&&Number.isInteger(minutes)&&minutes>=1&&minutes<=720&&!conflict;
  choices.replaceChildren(...options.map(option=>{const r=roomInfo(state,option.id),b=el('button',{type:'button','aria-pressed':String(chosen===r.id),class:'room-seat-card'},`${r.name} · ${r.capacity} seats · ${r.available?'Open':'Unavailable'}`);b.disabled=saving;b.onclick=()=>{chosen=r.id;update();};return b;}));
  info.textContent=!room?'Choose a room above.':!room.available?'All tables must be open and the section reopened before seating.':room.unconfirmed?'Confirm all table capacities first.':conflict?'This duration overlaps a future booking. Choose a shorter room time.':party?.attendance==='away'?'Return this guest to waiting first.':party&&party.size>room.capacity?'This party needs a larger room combination.':`${room.tables.length} tables will be seated together.${room.areas.length>1?' Confirm the divider is open and the rooms can serve one group.':''}`;
  save.disabled=saving||!canWrite()||busy||!valid;save.textContent=valid?`Seat ${party.name} in ${room.name}`:'Choose an available room and party';
 }
 guest.onchange=duration.oninput=update;
 save.onclick=async()=>{update();if(save.disabled)return;const room=roomInfo(state,chosen),party=state.parties.find(p=>p.id===guest.value);if(!await confirmChange('Seat whole room?',`Seat ${party.name} in ${room.name} for ${duration.value} minutes? All ${room.tables.length} tables will be in use.${room.areas.length>1?' Confirm the divider is open.':''}`))return;saving=true;update();try{if(await act({type:'seatWholeRoom',roomId:chosen,partyId:guest.value,endsAt:Date.now()+Number(duration.value)*60000})){dialog.close();toast('Whole party seated. Use Bookings to finish and release the room.');}}finally{saving=false;if(dialog.open)update();}};
 dialog.showModal();update();
}
const seatWholeRoomButton=el('button',{class:'primary'},'Seat room');seatWholeRoomButton.onclick=openSeatWholeRoom;$('combine-select').parentElement.prepend(seatWholeRoomButton);
function renderSelection(){
 team.refresh();
 const assignmentKey=JSON.stringify([locationId,partyId,[...selected]]),selectionBox=$('selection-body');
 const previousAssignment=selectionBox.dataset.assignmentKey===assignmentKey?selectionBox.querySelector('#selected-team-assignment select')?.value||'':'';
 selectionBox.dataset.assignmentKey=assignmentKey;
  const key=JSON.stringify([locationId,role,transportReady,state.closedAreas,partyId,current(),state.parties.filter(p=>p.status==='waiting'),combining,editing,Math.floor(Date.now()/60000)]);
  if(key===selectionRenderKey)return;selectionRenderKey=key;
  const box=$('selection-body'),tables=current(),party=state.parties.find(p=>p.id===partyId&&p.status==='waiting');const overrideKey=JSON.stringify([party?.id,party?.size,tables.map(t=>[t.id,t.capacity,t.status])]),keepOverride=box.dataset.overrideKey===overrideKey&&!!box.querySelector('#child-override')?.checked;box.dataset.overrideKey=overrideKey;box.replaceChildren();$('selection-title').textContent=party?`Seat ${party.name}`:'Table details';
  if(!canWrite())box.append(el('p',{class:'read-only-note'},'View-only access. Ask an administrator for host access to make changes.'));
  if(tables.some(t=>areaClosed(state,t.area)))box.append(el('p',{class:'read-only-note'},'Section closed to new seating. Reopen it in Sections.'));
  if(party?.attendance==='away')box.append(el('p',{class:'read-only-note'},'Guest not present. Return them to waiting from the waitlist before seating.'));
  if(party){
   box.append(el('p',{class:'muted'},`${party.size} guests · Tap tables on the floor to add or remove them from your selection.`));
   const clear=el('button',{class:'small'},'Clear selected tables');clear.disabled=!tables.length;clear.onclick=()=>{selected.clear();renderFloor();renderSelection();};box.append(clear);
   const choices=el('div',{class:'actions'});
   for(const t of tables){const remove=el('button',{class:'small'},`Remove ${label(t)}`);remove.onclick=()=>chooseTable(t);choices.append(remove);}box.append(choices);
  }
  if(party?.accessibility)box.append(el('p',{class:'equipment-badges'},'Accessible seating preferred · confirm fit and route with the guest.'));
  if(!party&&canWrite()&&tables.length&&tables.every(t=>t.status==='open')){
   const assign=el('button',{class:'primary wide'},'Assign waiting guest');assign.onclick=()=>tableAssignment.open(tables.map(t=>t.id));box.append(assign);
   const waiting=state.parties.filter(p=>p.status==='waiting');if(waiting.length){const field=el('label',{},'Seat a waiting guest'),select=el('select',{'aria-label':'Choose waiting guest for selected tables'});select.append(new Option('Choose a guest...', ''));for(const p of waiting)select.append(new Option(`${p.name} · ${p.size} guests`,p.id));select.onchange=()=>{if(select.value){partyId=select.value;renderSelection();renderRecommendations();}};field.append(select);box.append(field);}
  }
  if(!tables.length){box.append(el('div',{class:'empty'},party?'Choose a suggestion or select tables on the floor.':'Select a table to see seats, status, and available actions.'));return;}
  const summary=el('div',{class:'selection-summary'}),capacity=tables.reduce((n,t)=>n+(t.capacity||0),0),unknown=tables.some(t=>!t.capacity);
  summary.append(el('strong',{},tables.map(label).join(' + ')),el('p',{},unknown?'Capacity unconfirmed':`${capacity} seats total`));
  for(const t of tables){const p=state.parties.find(p=>p.id===t.party);summary.append(el('p',{},`${label(t)} · ${names[t.status]}${t.seatedAt?' · '+minutes(t.seatedAt)+' min':''}${p?' · '+p.name+' ('+p.size+')'+(p.highChair?' · High chair':'')+(p.booster?' · Booster':'')+(p.accessibility?' · Accessible seating':'')+(p.childOverride?' · Child override':''):''}`));}box.append(summary);
  for(const t of tables.filter(t=>t.status==='in_use'&&t.funZone))box.append(el('p',{class:'funzone-summary'},`${label(t)} · Fun Zone${t.funZoneSince?' · '+minutes(t.funZoneSince)+' min':' · Timer starts with the next check-in'} · Table stays in use`));
  if(tables.some(t=>t.roomBlock)){const b=el('button',{class:'primary wide'},'Manage whole-room booking');b.onclick=openRoomBookings;box.append(el('p',{class:'combination-notice'},'These tables belong to a whole-room block.'),b);return;}
  if(!canWrite())return;
  if(tables.every(t=>t.status==='in_use')){const move=el('button',{class:'wide'},'Reassign party');move.onclick=()=>openReassign(tables);box.append(move);}
  const boothNotice='This combination includes a fixed booth. Confirm the nearby table works for this party and leaves the aisle clear.';
  if(includesBoothCombination(tables))box.append(el('p',{class:'combination-notice'},boothNotice));
  if(party){
    const button=el('button',{id:'seat-selected-party',class:'primary wide'},tables.length>1?'Combine & seat party':'Seat party');let override=null;
    box.append(team.seatingPicker('selected-team-assignment',previousAssignment));
    if(childBoothFit(tables,party.size)){
      const toggle=el('label',{class:'equipment-toggle'});override=el('input',{type:'checkbox',id:'child-override'});override.checked=keepOverride;
      toggle.append(override,document.createTextNode('Small-child override: 1 extra guest at this booth'));
      box.append(toggle,el('p',{class:'muted'},'Host must confirm the party fits. The normal booth capacity stays unchanged.'));
      override.onchange=()=>{button.disabled=!override.checked||tables.some(t=>t.status!=='open');};
    }
    button.disabled=unknown||party.attendance==='away'||(capacity<party.size&&!override?.checked)||tables.some(t=>t.status!=='open'||areaClosed(state,t.area));
    button.onclick=async()=>{
      const childOverride=!!override?.checked,boothAcknowledged=includesBoothCombination(tables);
      const combinationOverride=!!box.querySelector('#combination-override')?.checked;
      if(combinationOverride&&!await confirmChange('Confirm table combination override',`Seat this party at ${tables.map(label).join(' + ')}? Confirm the distance, fit and clear access.`))return;
      if((childOverride||boothAcknowledged)&&!await confirmChange(childOverride?'Confirm child seating override':'Confirm booth combination',childOverride?`Seat ${party.size} guests at this ${capacity}-seat booth, including a small child? Confirm the party fits before seating.`:boothNotice))return;
      const assignment=team.seatingAssignment('selected-team-assignment');
      if(await act({type:'seat',partyId:party.id,ids:tables.map(t=>t.id),childOverride,boothAcknowledged,combinationOverride,...assignment}))toast(assignment.teamTarget?`${party.name} assigned to teammate; tables marked in use.`:`${party.name} seated.`);
    };box.append(button);if(unknown)box.append(el('p',{class:'muted'},'A manager needs to confirm booth capacity first.'));
  }
  const actions=el('div',{class:'actions'});
  for(const status of ['open','in_use','cleaning']){const b=el('button',{class:'small'},status==='in_use'?'Mark in use':status==='open'?'Mark open':'Cleaning');b.onclick=async()=>{if(tables.some(t=>t.party)&&status!=='in_use'&&!await confirmChange('Clear seated party?',`Mark ${tables.map(label).join(' + ')} ${names[status].toLowerCase()} and finish the seated party?`))return;if(await act({type:'status',ids:[...selected],status}))closeSidebar();};actions.append(b);}box.append(actions);
  const grouping=el('div',{class:'actions'});
  if(tables.length>1&&tables.every(t=>t.status==='open')){
    const toggle=el('label',{class:'equipment-toggle'}),override=el('input',{type:'checkbox',id:'combination-override'});
    toggle.append(override,document.createTextNode('Override combination rules'));
    box.append(toggle,el('p',{class:'muted'},'Use these tables together without changing the layout. Confirm the fit and clear access; separate them when finished.'));
    const b=el('button',{class:'small'},'Combine tables');b.onclick=async()=>{
      const combinationOverride=override.checked,boothAcknowledged=includesBoothCombination(tables);
      if(combinationOverride&&!await confirmChange('Confirm table combination override',`Combine ${tables.map(label).join(' + ')}? Confirm these tables can serve one party with clear access.${boothAcknowledged?' '+boothNotice:''}`))return;
      if(!combinationOverride&&boothAcknowledged&&!await confirmChange('Confirm booth combination',boothNotice))return;
      await act({type:'combine',ids:tables.map(t=>t.id),boothAcknowledged,combinationOverride});
    };grouping.append(b);
  }
  if(tables.some(t=>t.group)){const b=el('button',{class:'small'},'Separate tables');b.disabled=tables.some(t=>t.status==='in_use');b.onclick=()=>act({type:'split',ids:[...selected]});grouping.append(b);}box.append(grouping);
}
function renderRecommendations(){
  const party=state.parties.find(p=>p.id===partyId&&p.status==='waiting');$('recommend-panel').hidden=editing;$('recommend-context').textContent=party?`${party.name} · ${party.size} guests — best fits first`:'Select a waiting party to find an open table that fits.';if(!party){$('recommendations').replaceChildren();return;}
  let candidates=suggestTables(walkInTables(state,Date.now(),currentPlan().context.duration),party.size,5,party.accessibility?preferredAreas(state):new Set(),partyRoomAreas(state),state.areaPriorities);
  const planned=currentPlan().rows.find(r=>r.party.id===party.id)?.estimate;
  if(planned?.ready){const key=ts=>ts.map(t=>t.id).sort().join('|'),index=candidates.findIndex(ts=>key(ts)===key(planned.tables));if(index>=0)candidates.splice(index,1);candidates.unshift(planned.tables);}
  candidates.push(...state.tables.filter(t=>t.status==='open'&&!t.group&&childBoothFit([t],party.size)).slice(0,2).map(t=>[t]));
  candidates=preferDiningTables(candidates,partyRoomAreas(state));
  const choices=el('select',{'aria-label':'Suggested seating tables'});choices.append(new Option('Choose a suggested table…',''));
  for(const ts of candidates)choices.append(new Option(`${ts.map(label).join(' + ')} · ${ts.reduce((n,t)=>n+t.capacity,0)} seats${childBoothFit(ts,party.size)?' · Child override required':includesBoothCombination(ts)?' · Booth combination':''}`,JSON.stringify(ts.map(t=>t.id))));
  const matching=candidates.find(ts=>ts.length===selected.size&&ts.every(t=>selected.has(t.id)));if(matching)choices.value=JSON.stringify(matching.map(t=>t.id));
  choices.disabled=!candidates.length;choices.onchange=()=>{if(!choices.value)return;const ids=JSON.parse(choices.value),ts=state.tables.filter(t=>ids.includes(t.id));combining=false;selected=new Set(ids);renderFloor();renderSelection();showSidebar('details');focusTables(ts);};
  $('recommendations').replaceChildren(choices);
  if(planned&&!planned.ready)$('recommendations').append(el('p',{class:'estimate-note'},`Expected next: ${planned.tables.map(label).join(' + ')} · ${waitRange(planned)}${planned.accessiblePreferred?' · Accessibility preferred':''}. Host must confirm the table is clear.`));
  if(!candidates.length)$('recommendations').append(el('p',{class:'empty'},'No available fit. A manager can confirm booth capacities or approve table combinations in Layout editor.'));
}
function importedViewBox(value){
 if(value==='All')return fullPlanBox(backgroundFit?.key===locationId+'|'+(state.background?.key||state.background?.dataUrl)?backgroundFit.bounds:null,state.tables);
 const rooms=new Set(areaOptions(state).filter(a=>a.kind==='room').map(a=>a.id));
 const tables=state.tables.filter(t=>value==='Dining'?!rooms.has(t.area):value==='Party rooms'?rooms.has(t.area):t.area===value);
 if(!tables.length)return [0,0,1660,950];
 const xs=tables.map(t=>t.x),ys=tables.map(t=>t.y),x=Math.max(0,Math.min(...xs)-45),y=Math.max(0,Math.min(...ys)-45);
 return [x,y,Math.min(1660-x,Math.max(150,Math.max(...xs)-x+45)),Math.min(950-y,Math.max(150,Math.max(...ys)-y+45))];
}
function focusTables(tables){view=tables.every(t=>t.area===tables[0].area)?tables[0].area:'All';viewFitted=false;viewBox=tableFocusBox(tables);renderAreas();renderFloor();}
function setView(value){closeSidebar();view=value;viewFitted=true;const boxes={All:[0,-20,1660,950],Dining:[140,550,1495,360],A:[1300,540,340,350],B:[680,610,665,285],C:[155,610,540,285],'Party rooms':[1000,-10,640,220],'Rose City':[1010,-10,190,200],'Azalea Trail':[1190,-10,210,200],'Piney Woods':[1390,-10,250,230]};viewBox=(state?.background?.imported||state?.areaConfig)?importedViewBox(value):(boxes[value]||boxes.All);renderAreas();if(state)renderFloor();}
function renderAreas(){
 const areas=areaOptions(state),labels={All:'Full plan',Dining:'Dining room'};
 for(const a of areas)labels[a.id]=a.name;
 if(areas.some(a=>a.kind==='room'))labels['Party rooms']='Party rooms';
 $('areas').replaceChildren(...Object.entries(labels).map(([key,name])=>{const b=el('button',{class:view===key?'active':'','data-view':key},name);b.onclick=()=>setView(key);return b;}));
}
function renderEditor(){
  $('layout-panel').hidden=!editing||!tableDraft;if(!editing||!tableDraft)return;
  $('save-layout').disabled=false;const t=tableDraft;$('layout-title').textContent=t.id?'Edit '+label(t):'Add table';$('table-area').replaceChildren(...areaOptions(state).map(a=>new Option(a.name,a.id)));$('table-area').value=t.area;$('table-number').value=t.number;$('table-kind').value=t.kind;$('table-capacity').value=t.capacity??'';$('table-orientation').value=t.orientation;$('table-x').value=t.x;$('table-y').value=t.y;$('remove-table').hidden=!t.id;renderAllowed(t.allowed||[]);
}
function renderAllowed(allowed=[]){const area=$('table-area').value,kind=$('table-kind').value;$('allowed-tables').replaceChildren();
  for(const t of state.tables.filter(t=>t.area===area&&t.id!==tableDraft?.id&&!(kind==='booth'&&t.kind==='booth'))){const l=el('label'),c=el('input',{type:'checkbox',value:t.id});c.checked=allowed.includes(t.id);l.append(c,document.createTextNode(`${label(t)} · ${t.capacity} seats`));$('allowed-tables').append(l);}
}
function render(){
  $('clean-plan').hidden=!state.background;
  seatWholeRoomButton.hidden=editing||activeScreen!=='floor'||!canWrite();
  $('seat-now-open').hidden=activeScreen!=='floor'||editing||!canWrite();
  $('guest-checkin').hidden=!canWrite();$('areas-open').hidden=!canEdit();
  $('phone-location').textContent=locations.find(l=>l.id===locationId)?.name||'';
  $('edit-tab').hidden=!canEdit();if(!canEdit())editing=false;
  $('live-tab').classList.toggle('active',!editing);$('edit-tab').classList.toggle('active',editing);$('editor-toolbar').hidden=!editing;$('wait-panel').hidden=editing;$('selection-panel').hidden=editing;$('layout-panel').hidden=!editing||!tableDraft;
  renderScreen();
  renderAreas();renderFloor();renderWait();renderSelection();renderRecommendations();renderRoomBookings();showReadyAlert();
  tableAssignment.refresh();team.refresh();
  // Keep unsaved layout fields intact while live state polls update the floor.
}


let reportLocation=null,reportKey='',lastReport=null;
const reportNumber=value=>Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:1}):'—';
const hourLabel=hour=>hour===24?'12 AM':`${hour%12||12} ${hour<12?'AM':'PM'}`;
function renderReport(){
 if(activeScreen!=='reports'||!state)return;
 const now=Date.now(),zone=state.reporting?.zone||'America/Chicago',today=reportClock(now,zone).date;
 if(reportLocation!==locationId){reportLocation=locationId;reportKey='';$('report-date').value=today;let saved;try{saved=JSON.parse(localStorage.getItem('seating-report-hours:'+locationId)||'null');}catch{}const defaults=state.reportHours||{from:10,to:21};$('report-from').value=saved?.from??defaults.from;$('report-to').value=saved?.to??defaults.to;}
 $('report-save-hours').hidden=!canEdit();$('report-date').max=today;$('report-date').min=reportClock(now-30*86400000,zone).date;
 const date=$('report-date').value,from=Number($('report-from').value),to=Number($('report-to').value);
 if(!date||date<$('report-date').min||date>today||!Number.isInteger(from)||!Number.isInteger(to)||from<0||to>24||from>=to){$('report-note').textContent='Choose a date within the last 31 days and hours from 0 to 24, with the end after the start.';$('report-export').disabled=true;return;}
 const key=JSON.stringify([locationId,version,date,from,to,Math.floor(now/60000)]);
 if(reportKey===key)return;reportKey=key;
 const r=reportView(state,date,from,to,now),m=r.metrics;lastReport=r;$('report-export').disabled=false;
 const storeHours=state.reportHours||{from:10,to:21};
 $('report-period').textContent=`${locations.find(l=>l.id===locationId)?.name||''} · ${date} · ${zone} · Viewing ${hourLabel(from)}–${hourLabel(to)} · Store hours ${hourLabel(storeHours.from)}–${hourLabel(storeHours.to)}`;
 const tracked=Math.round(r.observedMs/60000),notes=[];
 if(!r.startedAt)notes.push('Tracking starts with the next saved seating change. No historical occupancy is available.');
 else if(!tracked)notes.push('No occupancy observations in the selected hours yet.');
 else notes.push(`${tracked} minutes tracked in the selected hours. Partial hours and untracked periods are not treated as empty seats.`);
 if(r.estimated)notes.push('Estimated occupancy includes full capacity for tables marked in use without a recorded party size.');
 if(r.unknownCapacity)notes.push('Some tables have unknown capacity; occupancy percentages may be incomplete.');
 $('report-note').textContent=notes.join(' ');
 const metric=(box,title,value,note)=>{const card=el('article',{class:'report-stat'});card.append(el('small',{},title),el('strong',{},value),el('small',{},note));box.append(card);};
 const total=$('report-totals');total.replaceChildren();
 metric(total,'Guests seated',String(m.seatedGuests||0),`${m.seatedParties||0} recorded parties · manual in-use counts excluded`);
 metric(total,'Average wait',m.waitCount?reportNumber(m.waitMinutes/m.waitCount)+' min':'—',`${m.waitCount||0} waitlisted parties seated · walk-ins excluded`);
 metric(total,'Seated by quoted latest time',m.quoteCount?reportNumber(100*(m.quoteMet||0)/m.quoteCount)+'%':'—',`${m.quoteCount||0} parties with original quotes`);
 metric(total,'Average dining time',m.diningCount?reportNumber(m.diningMinutes/m.diningCount)+' min':'—',`${m.diningCount||0} completed visits`);
 metric(total,'Average cleaning time',m.cleaningCount?reportNumber(m.cleaningMinutes/m.cleaningCount)+' min':'—',`${m.cleaningCount||0} tables finished cleaning`);
 metric(total,'Left / removed before seating',String(m.leftParties||0),`${m.leftGuests||0} guests · includes host removals and guest cancellations`);
 const occupancy=$('report-occupancy');occupancy.replaceChildren();
 metric(occupancy,'Average seat occupancy',(r.averagePercent===null?'—':reportNumber(r.averagePercent)+'%')+(r.estimated?' estimated':''),'Time-weighted across tracked minutes');
 metric(occupancy,'Average occupied seats',reportNumber(r.averageSeats),'Uses party size; manual in-use tables use full capacity');
 metric(occupancy,'Peak hour',r.peak&&r.peak.percent>0?`${hourLabel(r.peak.hour)}–${hourLabel(r.peak.hour+1)}`:'—',r.peak&&r.peak.percent>0?`${reportNumber(r.peak.percent)}% average occupancy · ${Math.round(r.peak.observedMs/60000)} min tracked`:'No occupied seats recorded');
 const rows=$('report-hours');rows.replaceChildren();
 for(const h of r.hours){
  const row=el('tr'),time=el('th',{scope:'row'},`${hourLabel(h.hour)}–${hourLabel(h.hour+1)}`),barCell=el('td'),bar=el('div',{class:'occupancy-track'}),fill=el('span',{class:'occupancy-fill'});
  fill.style.width=Math.min(100,h.percent||0)+'%';bar.append(fill);bar.setAttribute('aria-hidden','true');
  barCell.append(bar,el('strong',{},h.percent===null?'No data':reportNumber(h.percent)+'%'+(h.estimatedMs?' est.':'')));
  row.append(time,barCell,el('td',{},reportNumber(h.averageSeats)),el('td',{},h.observedMs?String(Math.round(h.observedMs/60000)):'—'));rows.append(row);
 }
}
$('reports-open').onclick=()=>setScreen('reports');
$('reports-settings-open').onclick=()=>{$('app-settings-dialog').close();setScreen('reports');};
$('report-save-hours').onclick=async()=>{const from=Number($('report-from').value),to=Number($('report-to').value);if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to>24||from>=to){toast('Choose valid opening and closing hours.',true);return;}if(await act({type:'reportHours',from,to}))toast('Restaurant report hours saved.');};
for(const id of ['report-date','report-from','report-to'])$(id).onchange=()=>{reportKey='';renderReport();if(!$('report-export').disabled)localStorage.setItem('seating-report-hours:'+locationId,JSON.stringify({from:Number($('report-from').value),to:Number($('report-to').value)}));};
$('report-export').onclick=()=>{
 if(!lastReport||$('report-export').disabled)return;
 const r=lastReport,m=r.metrics,rows=[['Restaurant',locations.find(l=>l.id===locationId)?.name||''],['Date',r.date],['Timezone',r.zone],['Tracking began',r.startedAt?new Date(r.startedAt).toISOString():'Not started'],['Daily metric','Value'],['Guests seated',m.seatedGuests||0],['Parties seated',m.seatedParties||0],['Average wait (minutes)',m.waitCount?m.waitMinutes/m.waitCount:''],['Seated by quoted latest time (%)',m.quoteCount?100*(m.quoteMet||0)/m.quoteCount:''],['Average dining (minutes)',m.diningCount?m.diningMinutes/m.diningCount:''],['Average cleaning (minutes)',m.cleaningCount?m.cleaningMinutes/m.cleaningCount:''],['Parties left or removed',m.leftParties||0],['Guests left or removed',m.leftGuests||0],['Selected-hours average occupancy (%)',r.averagePercent??''],['Selected-hours average occupied seats',r.averageSeats??''],['Includes estimated occupancy',r.estimated?'Yes':'No'],['Unknown table capacities',r.unknownCapacity?'Yes':'No'],[],['Hour','Occupancy percent','Average occupied seats','Tracked minutes','Estimated occupancy']];
 for(const h of r.hours)rows.push([`${hourLabel(h.hour)}-${hourLabel(h.hour+1)}`,h.percent??'',h.averageSeats??'',h.observedMs/60000,h.estimatedMs?'Yes':'No']);
 const csv=rows.map(row=>row.map(value=>'"'+(typeof value==='string'&&/^[=+@\-\t\r]/.test(value)?"'"+value:String(value)).replaceAll('"','""')+'"').join(',')).join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=el('a',{href:url,download:`seating-report-${r.date}.csv`});
 link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

let busserCache=null,busserState=null,busserMinute=-1;
function renderServiceTools(){
 const now=Date.now(),undo=state.lastUndo;
 $('undo-action').hidden=!canWrite()||!undoAvailable(state,now);
 $('undo-action').textContent=undo?'Undo '+(undoLabels[undo.type]||'last action'):'Undo last action';
 if(activeScreen==='busser'){
  if(busserState!==state||busserMinute!==Math.floor(now/60000)){busserCache=cleaningQueue(state,currentPlan(),now,planWaitlist);busserState=state;busserMinute=Math.floor(now/60000);}const rows=busserCache;$('busser-empty').hidden=rows.length>0;
  keyedChildren($('busser-cards'),rows,r=>r.key,r=>JSON.stringify([locationId,r,canWrite()]),r=>{
   const card=el('article',{class:'service-card'+(r.guests.length?' ready-cleaning':'')});
   card.append(el('h2',{},r.tables.map(label).join(' + ')),el('strong',{},r.tables.some(t=>t.cleaningAt)?`${r.minutes} min awaiting cleaning`:'Cleaning time not recorded'));
   if(r.guests.length)card.append(el('p',{},'Can help seat: '+r.guests.map(p=>`${p.name} (${p.size})`).join(', ')));
   if(r.tables.some(t=>areaClosed(state,t.area)))card.append(el('p',{},'Section closed — cleaning will not reopen it.'));
   const button=el('button',{class:'primary'},'Ready');button.disabled=!canWrite()||!r.canReady;
   button.onclick=()=>act({type:'status',ids:r.tables.map(t=>t.id),status:'open'});card.append(button);
   if(!r.canReady)card.append(el('p',{},'Manage this group from the floor or Room bookings.'));
   return card;
  });
 }
 if($('sections-dialog').open){
  keyedChildren($('section-cards'),areaOptions(state),a=>a.id,a=>JSON.stringify([locationId,a,state.areaPriorities?.[a.id],state.closedAreas?.[a.id],state.tables.filter(t=>t.area===a.id),canWrite()]),a=>{
   const closed=areaClosed(state,a.id),tables=state.tables.filter(t=>t.area===a.id),card=el('article',{class:'service-card'});
   card.append(el('h3',{},a.name),el('strong',{},closed?'Closed to new seating':'Open for service'),el('p',{},`${tables.length} tables · ${tables.filter(t=>t.status==='in_use').length} in use`));
   if(closed)card.append(el('p',{},state.closedAreas[a.id].reason));
   const button=el('button',{},closed?'Reopen section':'Close section');button.disabled=!canWrite();
   button.onclick=async()=>{if(!await confirmChange(closed?'Reopen section?':'Close section?',closed?`Make ${a.name} available for new seating?`:`Stop new seating in ${a.name}? Current guests and bookings remain; reopen the section when ready.`))return;await act({type:'areaAvailability',area:a.id,closed:!closed});};
   const field=el('label',{},'Seating priority'),select=el('select',{'aria-label':a.name+' seating priority'});for(let i=1;i<=10;i++)select.append(new Option(i===1?'1 · Use first':i===10?'10 · Use last':String(i),i));select.value=state.areaPriorities?.[a.id]??5;select.disabled=!canEdit();
   select.onchange=async()=>{const priorities=Object.fromEntries(areaOptions(state).map(area=>[area.id,state.areaPriorities?.[area.id]??5]));priorities[a.id]=Number(select.value);select.disabled=true;try{if(await act({type:'areaPriorities',priorities}))toast('Area priorities saved for this restaurant.');else select.value=state.areaPriorities?.[a.id]??5;}finally{select.disabled=!canEdit();}};field.append(select);card.append(field,button);return card;
  });
 }
}
$('busser-open').onclick=()=>setScreen('busser');
$('busser-settings-open').onclick=()=>{$('app-settings-dialog').close();setScreen('busser');};
function openSections(){$('app-settings-dialog').close();$('sections-dialog').showModal();renderServiceTools();}
$('sections-open').onclick=openSections;$('sections-settings-open').onclick=openSections;
$('undo-action').onclick=async()=>{
 const undo=state.lastUndo;if(!undo||!undoAvailable(state))return;
 if(await confirmChange('Undo last action?',`Undo ${undoLabels[undo.type]} for this restaurant? This restores the affected tables and guests. Only the most recent eligible action within five minutes can be undone.`))await act({type:'undo',undoId:undo.id});
};

$('reassign-open').onclick=()=>openReassign(current());
$('funzone-toggle').onclick=()=>act({type:'funZone',ids:current().map(t=>t.id),active:!current().every(t=>t.funZone)});
$('funzone-print').onclick=async()=>{if(demo)return toast('Sign in to your restaurant to create its Fun Zone insert.');if(!state.funZoneKey&&!await act({type:'funZoneSetup'}))return;location.href=`/funzone-sign.html?location=${encodeURIComponent(locationId)}`;};
let reassignmentIds=[];
function openReassign(tables){
 reassignmentIds=tables.map(t=>t.id);const party=state.parties.find(p=>p.id===tables[0]?.party);
 $('reassign-context').textContent=`Move ${party?.name||'guests'} from ${tables.map(label).join(' + ')}`;
 $('reassign-size-label').hidden=!!party;$('reassign-size').value=party?.size||2;
 renderReassignment();$('reassign-dialog').showModal();
}
function renderReassignment(){
 const from=state.tables.filter(t=>reassignmentIds.includes(t.id)),party=state.parties.find(p=>p.id===from[0]?.party),size=party?.size||Number($('reassign-size').value),box=$('reassign-options');box.replaceChildren();
 if(!Number.isInteger(size)||size<1||size>100)return;
 const options=suggestTables(walkInTables(state,Date.now(),currentPlan().context.duration),size,15,party?.accessibility?preferredAreas(state):new Set(),partyRoomAreas(state),state.areaPriorities);
 for(const tables of options){const button=el('button',{class:'suggestion'},`${tables.map(label).join(' + ')} · ${tables.reduce((n,t)=>n+t.capacity,0)} seats`);
  button.onclick=async()=>{const boothAcknowledged=includesBoothCombination(tables);if(!await confirmChange('Move seated party?',`Move to ${tables.map(label).join(' + ')}? The original tables will be marked Cleaning.${boothAcknowledged?' Includes a booth: confirm the fit and aisle clearance.':''}`))return;button.disabled=true;try{if(await act({type:'reassign',fromIds:reassignmentIds,ids:tables.map(t=>t.id),size,boothAcknowledged})){$('reassign-dialog').close();toast('Party reassigned. Original tables need cleaning.');}}finally{if($('reassign-dialog').open)renderReassignment();}};box.append(button);
 }
 if(!options.length)box.append(el('p',{class:'muted'},'No open table combination fits this party.'));
}
$('reassign-size').addEventListener('input',renderReassignment);
function updatePartySizePicker(custom=false){
 $('custom-party-size').hidden=!custom;
 for(const button of $('party-size-buttons').children)button.setAttribute('aria-pressed',String(button.dataset.size==='custom'?custom:!custom&&Number(button.dataset.size)===Number($('guest-size').value)));
}
for(const size of [...Array.from({length:12},(_,i)=>i+1),'custom']){
 const button=el('button',{type:'button','data-size':String(size),'aria-pressed':'false'},size==='custom'?'Custom':String(size));
 button.onclick=()=>{
  if(size==='custom'){updatePartySizePicker(true);button.focus();return;}
  $('guest-size').value=size;updatePartySizePicker();button.focus();
  $('guest-size').dispatchEvent(new Event('input',{bubbles:true}));
 };
 $('party-size-buttons').append(button);
}
function openGuest(p=null,immediate=false){
 seatNowMode=immediate&&!p;guestAdviceKey='';editGuest=p?.id||null;
 let waitChoice=$('seat-now-existing');
 if(!waitChoice){
  waitChoice=el('section',{id:'seat-now-existing',class:'seat-now-existing'});
  const label=el('label',{},'Choose from waitlist'),select=el('select',{'aria-label':'Choose an existing waiting party'});
  label.append(select);waitChoice.append(label,el('p',{class:'muted'},'Use the existing party and arrival time, or enter a new guest below.'));
  $('guest-title').closest('.panel-title').after(waitChoice);
  select.onchange=()=>{const waiting=state.parties.find(p=>p.id===select.value&&p.status==='waiting');if(!waiting||waiting.attendance==='away')return;const tables=current().filter(t=>t.status==='open');$('guest-dialog').close();seatNowMode=false;chooseWaitingParty(waiting,tables);toast(tables.length?'Confirm the selected tables, then seat this waiting party.':'Choose a suggested table or tap tables on the floor.');};
 }
 const seatableParties=state.parties.filter(p=>p.status==='waiting'&&p.attendance!=='away');
 waitChoice.hidden=!seatNowMode||!seatableParties.length;
 const waitingSelect=waitChoice.querySelector('select');
 waitingSelect.replaceChildren(new Option('Select a waiting party…',''),...seatableParties.sort((a,b)=>a.arrivedAt-b.arrivedAt).map(p=>new Option(`${p.name} · ${p.size} guests · ${minutes(p.arrivedAt)} min`,p.id)));
 $('guest-title').textContent=p?'Edit waiting party':seatNowMode?'Seat guests now':'Add guests';
 $('guest-name').value=p?.name||'';$('guest-name').required=!seatNowMode;$('guest-name').placeholder=seatNowMode?'Walk-in (name optional)':'';
 $('guest-size').value=p?.size||2;$('guest-notes').value=p?.notes||'';$('guest-highchair').checked=!!p?.highChair;$('guest-booster').checked=!!p?.booster;$('guest-accessibility').checked=!!p?.accessibility;
 updatePartySizePicker(Number($('guest-size').value)>12);
 $('guest-team-assignment')?.remove();$('seat-now-panel').prepend(team.seatingPicker('guest-team-assignment'));
 $('guest-dialog').classList.toggle('seat-now-mode',seatNowMode);
 $('guest-save').textContent=seatNowMode?'Seat at selected table':'Save to waiting list';$('guest-save').disabled=false;$('seat-now-panel').hidden=!seatNowMode;$('seat-now-wait').hidden=!seatNowMode;$('seat-now-options').replaceChildren();renderGuestQuote();$('guest-dialog').showModal();$('guest-title').focus();
}
function pinKey(key){
 if(runtime.mode!=='local'||$('login-form').querySelector('[type=submit]').disabled)return;
 const field=$('local-pin');
 if(/^[0-9]$/.test(key)&&field.value.length<4)field.value+=key;
 else if(key==='Backspace')field.value=field.value.slice(0,-1);
 else if(key==='Clear'||key==='Delete')field.value='';
 $('login-error').textContent='';
}
for(const key of ['1','2','3','4','5','6','7','8','9','Clear','0','Backspace']){
 const button=el('button',{type:'button','aria-label':key==='Backspace'?'Delete last digit':key},key==='Backspace'?'⌫':key);
 button.onclick=()=>pinKey(key);$('pin-keypad').append(button);
}
$('login-form').addEventListener('keydown',e=>{
 if(e.target.id==='local-pin')return; // Native editing supports the tablet keyboard, cursor and selection.
 if(runtime.mode!=='local'||!['local-pin','pin-keypad'].some(id=>$(id).contains(e.target))||e.ctrlKey||e.metaKey||e.altKey)return;
 if(/^[0-9]$/.test(e.key)||['Backspace','Delete'].includes(e.key)){e.preventDefault();pinKey(e.key);}
 if(e.key==='Enter'&&e.target.id==='local-pin'){e.preventDefault();$('login-form').requestSubmit();}
});
$('local-pin').addEventListener('input',()=>{$('local-pin').value=$('local-pin').value.replace(/\D/g,'').slice(0,4);$('login-error').textContent='';});
$('login-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter||$('login-form').querySelector('[type=submit]');if(b.disabled)return;if(runtime.mode==='local'&&!/^[0-9]{4}$/.test($('local-pin').value)){$('login-error').textContent='Enter your four-digit PIN.';return;}b.disabled=true;$('login-error').textContent='';try{await api('/api/login',{method:'POST',body:JSON.stringify(runtime.mode==='local'?{pin:$('local-pin').value}:{email:$('email').value,password:$('password').value})});$('password').value='';$('local-pin').value='';await loadSession();}catch(error){$('login-error').textContent=error.message;}finally{b.disabled=false;}};
$('logout').onclick=async()=>{if(!demo)await api('/api/logout',{method:'POST'});locationId=null;state=null;transportReady=false;alerts=readyTracker();showReadyAlert();$('app').hidden=true;$('login').hidden=false;if(demo)location.href='/';};
$('location').onchange=async()=>{combining=false;locationId=$('location').value;role=locations.find(l=>l.id===locationId).role;selected.clear();partyId=null;tableDraft=null;editing=false;version=-1;alerts=readyTracker();await refresh(true);};
$('live-tab').onclick=()=>{editing=false;tableDraft=null;setScreen('floor');};$('edit-tab').onclick=()=>{combining=false;$('app').classList.remove('phone-menu-open');closeSidebar();activeScreen='floor';editing=!editing;partyId=null;tableDraft=null;selected.clear();render();if(editing)toast('Select a table to edit its capacity, chairs, or allowed combinations.');};
$('phone-floor').onclick=()=>{editing=false;setScreen('floor');};$('phone-wait').onclick=()=>openWaitlist();
const partyDisplayButton=el('button',{id:'party-display-addon'},'Party Display add-on');
const seatForecastDetails=el('details',{class:'seat-forecast-details'}),seatForecastSummary=el('summary',{},'Expected next');
$('seat-now-soon').previousElementSibling.replaceWith(seatForecastDetails);seatForecastDetails.append(seatForecastSummary,$('seat-now-soon'));
const team=createTeam({getContext:()=>({state,locationId,locationName:locations.find(l=>l.id===locationId)?.name||'',canWrite:canWrite(),canEdit:canEdit(),partyId,ids:[...selected],label}),save:act,toast,openFloor:task=>{partyId=state.parties.some(p=>p.id===task.partyId&&p.status==='waiting')?task.partyId:null;selected=new Set(task.ids);editing=false;setScreen('floor');render();const tables=current();if(tables.length)focusTables(tables);showSidebar('details');}});
$('app-settings-dialog').append(partyDisplayButton);
partyDisplayButton.onclick=()=>{if(!state)return;openPartyDisplayAddon({getState:()=>state,locationId,canEdit:canEdit(),save:act,demo});};
const storeSettingsButton=el('button',{id:'store-settings'},'Manage stores');
$('app-settings-dialog').append(storeSettingsButton);
storeSettingsButton.onclick=async()=>{if(!profile?.system_admin)return;const {manageStores}=await import('./store-settings.js');await manageStores({api,reload:loadSession});};
const openAppSettings=()=>{storeSettingsButton.hidden=!profile?.system_admin||demo||runtime.mode==='local';$('app-settings-dialog').showModal();};
for(const id of ['phone-more','phone-settings','app-settings-open','app-settings-rail'])$(id).onclick=openAppSettings;
$('phone-bookings').onclick=()=>openRoomBookings();
$('app-settings-dialog').addEventListener('click',e=>{if(e.target.closest('button:not(.close-dialog)'))$('app-settings-dialog').close();});
$('tablet-details').onclick=()=>showSidebar('details');$('sidebar-close').onclick=closeSidebar;
$('add-guest').onclick=()=>openGuest();$('clear-selection').onclick=()=>{selected.clear();renderFloor();renderSelection();};
$('combine-select').onclick=async()=>{
 if(busy||!canWrite())return;
 const control=combineToolbar(state,[...selected],combining);if(control.disabled)return;
 if(control.action==='start'){combining=true;partyId=null;selected.clear();closeSidebar();renderFloor();renderSelection();toast('Select open tables, then tap Apply.');return;}
 const ids=[...selected],tables=current(),chosenLocation=locationId;
 if(control.action==='split'){if(await act({type:'split',ids}))toast('Tables un-combined.');return;}
 const combinationOverride=needsCombinationOverride(tables,state.tables),boothAcknowledged=includesBoothCombination(tables);
 if((combinationOverride||boothAcknowledged)&&!await confirmChange('Confirm table combination',`Combine ${tables.map(label).join(' + ')}? ${combinationOverride?'This is outside the approved combinations. ':''}${boothAcknowledged?'Includes a fixed booth. ':''}Confirm the tables fit together and leave the aisle clear.`))return;
 if(locationId!==chosenLocation)return;
 if(await act({type:'combine',ids,combinationOverride,boothAcknowledged}))toast('Tables combined.');
};
$('combine-cancel').onclick=()=>{combining=false;selected.clear();closeSidebar();renderFloor();renderSelection();};
$('seat-now-open').onclick=()=>{
 if(!canWrite()||busy)return;
 if(partyId){
  const party=state.parties.find(p=>p.id===partyId&&p.status==='waiting');
  if(!party){toast('This party is no longer waiting. Select another waiting guest.',true);return;}
  renderSelection();
  const seat=$('seat-selected-party');
  if(state.team?.enabled){showSidebar('details');toast('Choose who will seat this party, then confirm seating.');return;}
  if(seat&&!seat.disabled){seat.click();return;}
  showSidebar('details');
  toast('Choose available tables that fit '+party.name+'. Review any required seating overrides.',true);
  return;
 }
 openGuest(null,true);
};
$('seat-now-wait').onclick=()=>{seatNowMode=false;document.getElementById('seat-now-existing')?.setAttribute('hidden','');guestAdviceKey='';$('guest-title').textContent='Add guests';$('guest-name').required=true;$('guest-save').textContent='Save to waiting list';$('guest-save').disabled=false;$('seat-now-panel').hidden=true;$('seat-now-wait').hidden=true;renderGuestQuote();};
$('guest-form').onsubmit=async e=>{
 e.preventDefault();if(busy)return;
 const action={type:seatNowMode?'seatNow':editGuest?'editParty':'addParty',id:editGuest,name:$('guest-name').value,size:Number($('guest-size').value),notes:$('guest-notes').value,highChair:$('guest-highchair').checked,booster:$('guest-booster').checked,accessibility:$('guest-accessibility').checked};
 if(seatNowMode){
  Object.assign(action,team.seatingAssignment('guest-team-assignment'));
  const checked=$('seat-now-options').querySelector('select');if(!checked?.value){toast('Choose an open table first.',true);return;}
  action.ids=JSON.parse(checked.value);const tables=state.tables.filter(t=>action.ids.includes(t.id));action.boothAcknowledged=includesBoothCombination(tables);
  if(action.boothAcknowledged&&!await confirmChange('Confirm booth combination','This includes a fixed booth. Confirm the fit and clear aisle before seating.'))return;
 }
 e.submitter.disabled=true;
 try{if(await act(action)){$('guest-dialog').close();toast(action.teamTarget?'Seating assigned to teammate; tables marked in use.':seatNowMode?'Party seated.':editGuest?'Party updated.':'Added to waiting list.');}}
 finally{e.submitter.disabled=false;guestAdviceKey='';if($('guest-dialog').open)renderGuestQuote();}
};
for(const b of document.querySelectorAll('.close-dialog'))b.onclick=()=>b.closest('dialog').close();
$('add-table').onclick=()=>{showSidebar('details');tableDraft={area:areaOptions(state).some(a=>a.id===view)?view:areaOptions(state)[0]?.id,number:'',capacity:4,kind:'table',orientation:'lr',x:Math.round(viewBox[0]+viewBox[2]/2),y:Math.round(viewBox[1]+viewBox[3]/2),allowed:[]};selected.clear();renderEditor();$('table-number').focus();};
$('table-area').onchange=()=>renderAllowed();$('table-kind').onchange=()=>renderAllowed();
$('layout-form').onsubmit=async e=>{e.preventDefault();if(!tableDraft)return;e.submitter.disabled=true;const table={area:$('table-area').value,number:$('table-number').value,kind:$('table-kind').value,capacity:$('table-capacity').value===''?null:Number($('table-capacity').value),orientation:$('table-orientation').value,x:Number($('table-x').value),y:Number($('table-y').value),allowed:[...$('allowed-tables').querySelectorAll('input:checked')].map(i=>i.value)};const ok=await act({type:tableDraft.id?'layout':'addTable',id:tableDraft.id,table});e.submitter.disabled=false;if(ok){tableDraft=null;$('layout-panel').hidden=true;$('save-layout').disabled=true;toast('Table layout saved.');}};
$('remove-table').onclick=async()=>{if(!tableDraft?.id)return;if(await confirmChange('Remove table?',`Remove ${label(tableDraft)} from this layout? You can add it again in Layout editor.`)&&await act({type:'removeTable',id:tableDraft.id})){tableDraft=null;selected.clear();$('layout-panel').hidden=true;renderFloor();}};
for(const[id,factor]of [['zoom-in',.75],['zoom-out',1.333]])$(id).onclick=()=>{viewFitted=false;const[x,y,w,h]=viewBox;const nw=Math.min(2000,Math.max(120,w*factor)),nh=h*(nw/w);viewBox=[x+(w-nw)/2,y+(h-nh)/2,nw,nh];renderFloor();};$('zoom-fit').onclick=()=>setView(view);
// Pan the canvas from an empty area, keeping table dragging exclusive to Layout editor.
$('floor').addEventListener('pointerdown',e=>{if(e.target.closest('.table-node'))return;const floor=$('floor'),start=[e.clientX,e.clientY],box=[...viewBox],matrix=floor.getScreenCTM();floor.setPointerCapture(e.pointerId);const move=ev=>{viewFitted=false;viewBox=[box[0]+(floorAngle(state,view)===180?1:-1)*(ev.clientX-start[0])/matrix.a,box[1]+(floorAngle(state,view)===180?1:-1)*(ev.clientY-start[1])/matrix.d,box[2],box[3]];renderFloor();};const end=()=>{floor.removeEventListener('pointermove',move);floor.removeEventListener('pointerup',end);};floor.addEventListener('pointermove',move);floor.addEventListener('pointerup',end);});
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
const syncSchedule=adaptiveSync();let lastDiningMinute=-1;
function pollFloor(){if(!document.hidden&&locationId&&syncSchedule.due(Date.now(),runtime.mode))refresh();}
setInterval(()=>{if(document.hidden)return;renderConnection();team.refresh();const minute=Math.floor(Date.now()/60000);if(state&&!editing&&activeScreen==='floor'&&minute!==lastDiningMinute){lastDiningMinute=minute;renderFloor();renderSelection();}pollFloor();},1000);
for(const event of ['pointerdown','keydown','wheel'])document.addEventListener(event,()=>{if(document.hidden)return;if(syncSchedule.activity())pollFloor();},{passive:true});
$('overview-full').onclick=()=>setView('All');
document.addEventListener('visibilitychange',()=>{if(!document.hidden){syncSchedule.resume();syncSchedule.due(Date.now(),runtime.mode);refresh(true);}});
window.addEventListener('online',()=>refresh(true));window.addEventListener('offline',()=>{transportReady=false;seatingReachable=false;renderConnection();showReadyAlert();sync(false,'Disconnected · changes unavailable');});
$('connection-status').onclick=()=>{$('connection-dialog').showModal();renderConnection();};
async function boot(){runtime=demo?{mode:'cloud'}:await runtimeInfo();const local=runtime.mode==='local';$('local-pin-label').hidden=!local;$('pin-keypad').hidden=!local;$('cloud-email-label').hidden=local;$('cloud-password-label').hidden=local;$('email').required=!local;$('password').required=!local;$('local-pin').required=local;$('pin-enroll-open').hidden=!local;$('login-copy').textContent=local?'On the restaurant Wi-Fi, enter your four-digit employee PIN.':'Sign in with your Kiosk Manager account.';await loadSession();}
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

function openWaitlist(){if(!state)return;const settings=currentPlan().settings;$('dining-minutes').value=settings.diningMinutes;$('cleaning-minutes').value=settings.cleaningMinutes;for(const id of ['dining-minutes','cleaning-minutes','wait-settings-save','wait-settings-auto'])$(id).disabled=!canWrite();setScreen('waitlist');}
$('waitlist-open').onclick=openWaitlist;$('waitlist-add').onclick=()=>{if(canWrite())openGuest();};
$('estimate-size').oninput=renderQuote;$('estimate-accessibility').onchange=renderQuote;
for(const id of ['guest-size','guest-accessibility'])$(id).addEventListener(id==='guest-size'?'input':'change',()=>{guestAdviceKey='';$('seat-now-options').replaceChildren();renderGuestQuote();});
$('wait-settings-auto').onclick=async()=>{if(await act({type:'waitSettings',automatic:true})){const settings=currentPlan().settings;$('dining-minutes').value=settings.diningMinutes;$('cleaning-minutes').value=settings.cleaningMinutes;toast('Estimates will use the recent dining average when at least 3 visits are recorded.');}};
$('wait-settings-form').onsubmit=async e=>{e.preventDefault();$('wait-settings-save').disabled=true;try{if(await act({type:'waitSettings',diningMinutes:Number($('dining-minutes').value),cleaningMinutes:Number($('cleaning-minutes').value)}))toast('Wait estimate assumptions saved.');}finally{$('wait-settings-save').disabled=!canWrite();$('wait-settings-auto').disabled=!canWrite();}};

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
  const displayUrl=partyDisplayUrl(state,locationId,room.id,demo);
  if(displayUrl)card.append(el('a',{href:displayUrl,target:'_blank',rel:'noopener',class:'button'},'Open tablet display'));
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
 try{await cleanUpPlan({state,href:floorImageUrl(endpoint('floorplan'),state.background,demo),locationName:locations.find(l=>l.id===locationId)?.name||'',save:async covers=>{if(!await act({type:'cleanPlan',covers}))throw new Error('Cleanup was not saved. Close this window and reopen it to review the latest plan.');toast('Cleaned plan saved for this location.');}});}
 finally{uploadBusy=false;$('location').disabled=false;}
};

$('rotate-view').onclick=async()=>{
 if(!state||!canWrite()||busy)return;
 const targetView=view,targetLocation=locationId,angle=floorAngle(state,view)===180?0:180;
 const name=view==='All'?'Full plan':view==='Dining'?'Dining room':areaName(state,view);
 if(!await confirmChange('Rotate '+name+'?', 'Turn this view 180°? This saves only this view’s orientation for this restaurant on all devices, until changed again.'))return;
 if(locationId!==targetLocation||view!==targetView){toast('View changed. Please try again.');return;}
 if(await act({type:'viewOrientation',view:targetView,angle}))toast(name+' orientation saved.');
};
$('manager-open').onclick=()=>{if(canEdit())openClosingManager({state:()=>state,location:()=>locationId,name:locations.find(l=>l.id===locationId)?.name||'this restaurant',act});};
