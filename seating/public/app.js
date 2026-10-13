import { AREAS, WALL_PATH, ROOM_LABELS, upgradeNumbering, openSeats } from './floor.js';
const $=id=>document.getElementById(id), NS='http://www.w3.org/2000/svg';
const demo=new URLSearchParams(location.search).get('demo')==='1';
let state=null,version=0,profile=null,locations=[],locationId=null,role='viewer',selected=new Set(),partyId=null,editing=false,tableDraft=null,editGuest=null,busy=false,view='Dining',viewBox=[140,550,1495,360],toastTimer,uploadBusy=false;
let demoModel;
const names={open:'Open',in_use:'In use',cleaning:'Cleaning'};
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
async function loadSession(){
  let data;
  if(demo){demoModel=await import('./model.js');profile={display_name:'Preview manager',system_admin:true};locations=[{id:'preview',name:'Pizza Ranch · Preview',role:'admin'}];data={profile,locations};}
  else data=await api('/api/session');
  profile=data.profile;locations=data.locations;
  $('login').hidden=true;$('app').hidden=false;$('demo-banner').hidden=!demo;
  $('staff-open').hidden=!profile.system_admin;$('location').replaceChildren(...locations.map(l=>new Option(l.name,l.id)));
  $('no-access').hidden=locations.length>0;$('workspace').hidden=!locations.length;
  if(locations.length){locationId=locations[0].id;role=locations[0].role;await refresh(true);}
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
    if(force||data.version!==version||role!==data.role){state=upgradeNumbering(data.state);version=data.version;role=data.role;selected=new Set([...selected].filter(id=>state.tables.some(t=>t.id===id)));if(!state.parties.some(p=>p.id===partyId&&p.status==='waiting'))partyId=null;render();}
    else if(!editing){renderWait();renderSelection();}
    sync(true,demo?'Preview · local changes':'Saved · sharing live');
  }catch(e){sync(false,'Offline · changes unavailable');if(e.status===401){$('login').hidden=false;$('app').hidden=true;}else if(force)toast(e.message,true);}
}
async function act(action){
  if(busy)return false;busy=true;$('location').disabled=true;sync(false,'Saving…');
  try{const data=demo?{state:demoModel.applyAction(state,action,role),version:version+1}:await api(endpoint('actions'),{method:'POST',body:JSON.stringify({version,action})});
    state=upgradeNumbering(data.state);version=data.version;if(demo)localStorage.setItem('seating-preview',JSON.stringify(state));
    if(action.type==='seat'||action.type==='cancelParty')partyId=null;
    selected=new Set([...selected].filter(id=>state.tables.some(t=>t.id===id)));render();sync(true,demo?'Preview · local changes':'Saved · sharing live');return true;
  }catch(e){toast(e.message,true);sync(false,'Change not saved');if(e.status===409){busy=false;await refresh(true);}if(e.status===401){$('app').hidden=true;$('login').hidden=false;}return false;}finally{busy=false;$('location').disabled=false;}
}
function current(){return state.tables.filter(t=>selected.has(t.id));}
function canWrite(){return ['admin','manager','host'].includes(role);}
function canEdit(){return ['admin','manager'].includes(role);}
function label(t){return `${t.area}-${t.number}`;}
function minutes(stamp){return Math.max(0,Math.floor((Date.now()-stamp)/60000));}
function groupTables(t){return t.group?state.tables.filter(o=>o.group===t.group):[t];}
function chooseTable(t){
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
  group.append(svg('text',{x:0,y:0,class:'number'},t.number),svg('text',{x:0,y:12,class:'seat-label'},cap?`${cap} seats`:'Booth · ?'));
  group.append(svg('rect',{x:-w/2-15,y:-h/2-15,width:w+30,height:h+30,rx:7,class:'focus-ring'}));
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
  if(state.background)floor.append(svg('image',{href:demo?state.background.dataUrl:endpoint('floorplan')+`?v=${version}`,x:0,y:0,width:1660,height:950,preserveAspectRatio:'xMidYMid meet',opacity:.48}));
  else{
    floor.append(svg('rect',{x:10,y:0,width:1600,height:870,fill:'#f8f9f4'}),svg('path',{d:WALL_PATH,class:'wall'}));
    for(const[text,x,y]of ROOM_LABELS){const small=!['Funzone','Kitchen'].includes(text);const n=svg('text',{x,y,class:`room-label${small?' small':''}${text.startsWith('Section')?' section':''}`},text);if(text.includes('restroom'))n.setAttribute('transform',`rotate(-90 ${x} ${y})`);floor.append(n);}
    floor.append(svg('rect',{x:1475,y:485,width:94,height:42,rx:3,fill:'none',stroke:'#b1b8ad','stroke-width':2}));
  }
  const groups=[...new Set(state.tables.map(t=>t.group).filter(Boolean))];for(const id of groups){const ts=state.tables.filter(t=>t.group===id);for(let i=1;i<ts.length;i++)floor.append(svg('line',{x1:ts[i-1].x,y1:ts[i-1].y,x2:ts[i].x,y2:ts[i].y,class:'group-line'}));}
  for(const t of state.tables)floor.append(tableSymbol(t));
  for(const s of Object.keys(names))$('count-'+s).textContent=state.tables.filter(t=>t.status===s).length;
  const seats=openSeats(state.tables);$('count-seats').textContent=seats.count;
  $('seat-count-note').textContent=seats.unconfirmed?`${seats.unconfirmed} open booths/tables need a capacity; excluded from seat count.`:'';
  $('selection-hint').textContent=selected.size?`${selected.size} table${selected.size===1?'':'s'} selected`:'Tap a table to select it';
  $('plan-note').textContent=state.background?`Uploaded plan: ${state.background.name}. Use Layout editor to align tables with the plan.`:'Chair counts follow your PDF. Booth capacities remain unconfirmed until set in Layout editor.';
}
function renderWait(){
  const waiting=state.parties.filter(p=>p.status==='waiting').sort((a,b)=>a.arrivedAt-b.arrivedAt);$('wait-count').textContent=waiting.length;$('add-guest').disabled=!canWrite();
  if(!waiting.length){$('wait-list').replaceChildren(el('div',{class:'empty'},'Everyone is seated. Add a party when guests arrive.'));return;}
  $('wait-list').replaceChildren(...waiting.map((p,index)=>{
    const row=el('div',{class:`guest${p.id===partyId?' active':''}`,tabindex:0,role:'button','aria-label':`${p.name}, ${p.size} guests, waiting ${minutes(p.arrivedAt)} minutes`});
    const main=el('div',{class:'guest-main'});main.append(el('strong',{},p.name),el('small',{},`#${index+1}`));
    const meta=el('div',{class:'guest-meta'});meta.append(el('span',{},`${p.size} guests`),el('span',{},`${minutes(p.arrivedAt)} min wait`));row.append(main,meta);
    if(p.notes)row.append(el('p',{class:'guest-note'},p.notes));
    const choose=()=>{partyId=p.id;selected.clear();renderWait();renderSelection();renderRecommendations();renderFloor();};row.onclick=choose;row.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();choose();}};
    if(partyId===p.id&&canWrite()){
      const actions=el('div',{class:'guest-actions'}),edit=el('button',{class:'quiet small'},'Edit'),cancel=el('button',{class:'quiet small danger'},'Remove');
      edit.onclick=e=>{e.stopPropagation();openGuest(p);};cancel.onclick=async e=>{e.stopPropagation();if(await confirmChange('Remove waiting party?',`Remove ${p.name} from the waiting list?`))await act({type:'cancelParty',id:p.id});};actions.append(edit,cancel);row.append(actions);
    }return row;
  }));
}
function renderSelection(){
  const box=$('selection-body'),tables=current(),party=state.parties.find(p=>p.id===partyId&&p.status==='waiting');box.replaceChildren();$('selection-title').textContent=party?`Seat ${party.name}`:'Table details';
  if(!canWrite())box.append(el('p',{class:'read-only-note'},'View-only access. Ask an administrator for host access to make changes.'));
  if(party)box.append(el('p',{class:'muted'},`${party.size} guests · Choose a table below or tap tables on the floor.`));
  if(!tables.length){box.append(el('div',{class:'empty'},party?'Choose a suggestion or select tables on the floor.':'Select a table to see seats, status, and available actions.'));return;}
  const summary=el('div',{class:'selection-summary'}),capacity=tables.reduce((n,t)=>n+(t.capacity||0),0),unknown=tables.some(t=>!t.capacity);
  summary.append(el('strong',{},tables.map(label).join(' + ')),el('p',{},unknown?'Capacity unconfirmed':`${capacity} seats total`));
  for(const t of tables){const p=state.parties.find(p=>p.id===t.party);summary.append(el('p',{},`${label(t)} · ${names[t.status]}${t.seatedAt?' · '+minutes(t.seatedAt)+' min':''}${p?' · '+p.name+' ('+p.size+')':''}`));}box.append(summary);
  if(!canWrite())return;
  if(party){const button=el('button',{class:'primary wide'},tables.length>1?'Combine & seat party':'Seat party');button.disabled=unknown||capacity<party.size||tables.some(t=>t.status!=='open');button.onclick=async()=>{if(await act({type:'seat',partyId:party.id,ids:[...selected]}))toast(`${party.name} seated.`);};box.append(button);if(unknown)box.append(el('p',{class:'muted'},'A manager needs to confirm booth capacity first.'));}
  const actions=el('div',{class:'actions'});
  for(const status of ['open','in_use','cleaning']){const b=el('button',{class:'small'},status==='in_use'?'Mark in use':status==='open'?'Mark open':'Cleaning');b.onclick=async()=>{if(tables.some(t=>t.party)&&status!=='in_use'&&!await confirmChange('Clear seated party?',`Mark ${tables.map(label).join(' + ')} ${names[status].toLowerCase()} and finish the seated party?`))return;await act({type:'status',ids:[...selected],status});};actions.append(b);}box.append(actions);
  const grouping=el('div',{class:'actions'});
  if(tables.length>1&&tables.every(t=>t.status==='open')){const b=el('button',{class:'small'},'Combine tables');b.onclick=()=>act({type:'combine',ids:[...selected]});grouping.append(b);}
  if(tables.some(t=>t.group)){const b=el('button',{class:'small'},'Separate tables');b.disabled=tables.some(t=>t.status==='in_use');b.onclick=()=>act({type:'split',ids:[...selected]});grouping.append(b);}box.append(grouping);
}
function candidateGroups(){
  const open=state.tables.filter(t=>t.status==='open'&&t.capacity),results=[],seen=new Set();
  const add=ts=>{const ids=ts.map(t=>t.id).sort(),key=ids.join('|');if(seen.has(key)||ts.some(t=>t.group&&state.tables.some(o=>o.group===t.group&&!ids.includes(o.id))))return;seen.add(key);results.push(ts);};
  for(const t of open){const initial=groupTables(t);if(initial.every(t=>t.status==='open'&&t.capacity))add(initial);}
  // Up to four approved tables per suggestion. Manual selection supports larger groups.
  for(let i=0;i<results.length&&i<2000;i++){const ts=results[i];if(ts.length>=4)continue;for(const t of open){if(ts.includes(t)||t.area!==ts[0].area)continue;if(ts.some(o=>o.allowed.includes(t.id)&&t.allowed.includes(o.id)))add([...ts,t]);}}
  return results;
}
function renderRecommendations(){
  const party=state.parties.find(p=>p.id===partyId&&p.status==='waiting');$('recommend-panel').hidden=!party||editing;if(!party)return;
  const candidates=candidateGroups().filter(ts=>ts.reduce((n,t)=>n+t.capacity,0)>=party.size).sort((a,b)=>a.reduce((n,t)=>n+t.capacity,0)-b.reduce((n,t)=>n+t.capacity,0)||a.length-b.length).slice(0,5);
  $('recommendations').replaceChildren(...candidates.map(ts=>{const b=el('button',{class:'suggestion'}),info=el('span');info.append(el('strong',{},ts.map(label).join(' + ')),el('small',{},`${ts.reduce((n,t)=>n+t.capacity,0)} seats · ${ts.length>1?'Approved combination':'Open table'}`));b.append(info,el('span',{},'→'));b.onclick=()=>{selected=new Set(ts.map(t=>t.id));setView(ts[0].area);renderFloor();renderSelection();};return b;}));
  if(!candidates.length)$('recommendations').append(el('p',{class:'empty'},'No available fit. A manager can confirm booth capacities or approve table combinations in Layout editor.'));
}
function setView(value){view=value;const boxes={All:[0,-20,1660,950],Dining:[140,550,1495,360],A:[1300,540,340,350],B:[680,610,665,285],C:[155,610,540,285],'Party rooms':[1000,-10,640,220],'Rose City':[1010,-10,190,200],'Azalea Trail':[1190,-10,210,200],'Piney Woods':[1390,-10,250,230]};viewBox=boxes[value]||boxes.All;renderAreas();if(state)renderFloor();}
function renderAreas(){const labels={All:'Full plan',Dining:'Dining room',A:'A',B:'B',C:'C','Party rooms':'Party rooms'};$('areas').replaceChildren(...Object.entries(labels).map(([key,name])=>{const b=el('button',{class:view===key?'active':''},name);b.onclick=()=>setView(key);return b;}));}
function renderEditor(){
  $('layout-panel').hidden=!editing||!tableDraft;if(!editing||!tableDraft)return;
  const t=tableDraft;$('layout-title').textContent=t.id?'Edit '+label(t):'Add table';$('table-area').replaceChildren(...AREAS.map(a=>new Option(a,a)));$('table-area').value=t.area;$('table-number').value=t.number;$('table-kind').value=t.kind;$('table-capacity').value=t.capacity??'';$('table-orientation').value=t.orientation;$('table-x').value=t.x;$('table-y').value=t.y;$('remove-table').hidden=!t.id;renderAllowed(t.allowed||[]);
}
function renderAllowed(allowed=[]){const area=$('table-area').value,kind=$('table-kind').value;$('allowed-tables').replaceChildren();if(kind==='booth'){$('allowed-tables').append(el('p',{class:'muted'},'Booths cannot be combined.'));return;}
  for(const t of state.tables.filter(t=>t.area===area&&t.id!==tableDraft?.id&&t.kind==='table')){const l=el('label'),c=el('input',{type:'checkbox',value:t.id});c.checked=allowed.includes(t.id);l.append(c,document.createTextNode(`${label(t)} · ${t.capacity} seats`));$('allowed-tables').append(l);}
}
function render(){
  $('edit-tab').hidden=!canEdit();if(!canEdit())editing=false;
  $('live-tab').classList.toggle('active',!editing);$('edit-tab').classList.toggle('active',editing);$('editor-toolbar').hidden=!editing;$('wait-panel').hidden=editing;$('selection-panel').hidden=editing;$('layout-panel').hidden=!editing||!tableDraft;
  $('page-title').textContent=editing?'Make the floor yours.':'Let’s get everyone seated.';
  renderAreas();renderFloor();renderWait();renderSelection();renderRecommendations();
  // Keep unsaved layout fields intact while live state polls update the floor.
}
function openGuest(p=null){editGuest=p?.id||null;$('guest-title').textContent=p?'Edit waiting party':'Add guests';$('guest-name').value=p?.name||'';$('guest-size').value=p?.size||2;$('guest-notes').value=p?.notes||'';$('guest-dialog').showModal();$('guest-name').focus();}
$('login-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;$('login-error').textContent='';try{await api('/api/login',{method:'POST',body:JSON.stringify({email:$('email').value,password:$('password').value})});$('password').value='';await loadSession();}catch(error){$('login-error').textContent=error.message;}finally{b.disabled=false;}};
$('logout').onclick=async()=>{if(!demo)await api('/api/logout',{method:'POST'});locationId=null;state=null;$('app').hidden=true;$('login').hidden=false;if(demo)location.href='/';};
$('location').onchange=async()=>{locationId=$('location').value;role=locations.find(l=>l.id===locationId).role;selected.clear();partyId=null;tableDraft=null;editing=false;version=-1;await refresh(true);};
$('live-tab').onclick=()=>{editing=false;tableDraft=null;render();};$('edit-tab').onclick=()=>{editing=true;partyId=null;tableDraft=null;selected.clear();render();toast('Select a table to edit its capacity, chairs, or allowed combinations.');};
$('add-guest').onclick=()=>openGuest();$('clear-selection').onclick=()=>{selected.clear();renderFloor();renderSelection();};
$('guest-form').onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;const ok=await act({type:editGuest?'editParty':'addParty',id:editGuest,name:$('guest-name').value,size:Number($('guest-size').value),notes:$('guest-notes').value});e.submitter.disabled=false;if(ok){$('guest-dialog').close();toast(editGuest?'Party updated.':'Added to waiting list.');}};
for(const b of document.querySelectorAll('.close-dialog'))b.onclick=()=>b.closest('dialog').close();
$('add-table').onclick=()=>{tableDraft={area:['A','B','C'].includes(view)?view:'B',number:'',capacity:4,kind:'table',orientation:'lr',x:Math.round(viewBox[0]+viewBox[2]/2),y:Math.round(viewBox[1]+viewBox[3]/2),allowed:[]};selected.clear();renderEditor();$('table-number').focus();};
$('table-area').onchange=()=>renderAllowed();$('table-kind').onchange=()=>renderAllowed();
$('layout-form').onsubmit=async e=>{e.preventDefault();if(!tableDraft)return;e.submitter.disabled=true;const table={area:$('table-area').value,number:$('table-number').value,kind:$('table-kind').value,capacity:$('table-capacity').value===''?null:Number($('table-capacity').value),orientation:$('table-orientation').value,x:Number($('table-x').value),y:Number($('table-y').value),allowed:[...$('allowed-tables').querySelectorAll('input:checked')].map(i=>i.value)};const ok=await act({type:tableDraft.id?'layout':'addTable',id:tableDraft.id,table});e.submitter.disabled=false;if(ok){tableDraft=null;$('layout-panel').hidden=true;toast('Table layout saved.');}};
$('remove-table').onclick=async()=>{if(!tableDraft?.id)return;if(await confirmChange('Remove table?',`Remove ${label(tableDraft)} from this layout? You can add it again in Layout editor.`)&&await act({type:'removeTable',id:tableDraft.id})){tableDraft=null;selected.clear();$('layout-panel').hidden=true;renderFloor();}};
for(const[id,factor]of [['zoom-in',.75],['zoom-out',1.333]])$(id).onclick=()=>{const[x,y,w,h]=viewBox;const nw=Math.min(2000,Math.max(120,w*factor)),nh=h*(nw/w);viewBox=[x+(w-nw)/2,y+(h-nh)/2,nw,nh];renderFloor();};$('zoom-fit').onclick=()=>setView(view);
// Pan the canvas from an empty area, keeping table dragging exclusive to Layout editor.
$('floor').addEventListener('pointerdown',e=>{if(e.target.closest('.table-node'))return;const floor=$('floor'),start=[e.clientX,e.clientY],box=[...viewBox],matrix=floor.getScreenCTM();floor.setPointerCapture(e.pointerId);const move=ev=>{viewBox=[box[0]-(ev.clientX-start[0])/matrix.a,box[1]-(ev.clientY-start[1])/matrix.d,box[2],box[3]];floor.setAttribute('viewBox',viewBox.join(' '));const bounds=$('floor-view-bounds');bounds.setAttribute('x',viewBox[0]);bounds.setAttribute('y',viewBox[1]);};const end=()=>{floor.removeEventListener('pointermove',move);floor.removeEventListener('pointerup',end);};floor.addEventListener('pointermove',move);floor.addEventListener('pointerup',end);});
$('upload').onchange=async()=>{
  const file=$('upload').files[0];if(!file)return;
  if(file.size>20*1024*1024){toast('Choose a file smaller than 20 MB.',true);return;}
  if(!await confirmChange('Replace floor plan background?','Your tables and guest assignments will be kept. After upload, position the tables over your new plan in Layout editor.'))return;
  uploadBusy=true;$('location').disabled=true;sync(false,'Preparing floor plan…');
  try{
    let blob=file;
    if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')){
      const pdfjs=await import('./vendor/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';const doc=await pdfjs.getDocument({data:await file.arrayBuffer(),isEvalSupported:false}).promise;const page=await doc.getPage(1),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2500/base.width,2500/base.height)}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await doc.destroy();if(doc.numPages>1)toast('Using the first PDF page.');
    }
    if(!blob||!['image/png','image/jpeg','image/webp'].includes(blob.type))throw new Error('Choose a PDF, PNG, JPEG, or WebP file.');
    if(demo){const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});state.background={name:file.name,dataUrl};localStorage.setItem('seating-preview',JSON.stringify(state));}
    else{const r=await fetch(endpoint('floorplan')+`?version=${version}&name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'content-type':blob.type},body:blob}),data=await r.json();if(!r.ok)throw new Error(data.error);state=upgradeNumbering(data.state);version=data.version;}
    setView('All');render();toast('Floor plan uploaded. Position and save tables in Layout editor.');sync(true,demo?'Preview · local changes':'Saved · sharing live');
  }catch(e){toast(e.message,true);sync(false,'Upload not saved');}finally{uploadBusy=false;$('location').disabled=false;$('upload').value='';}
};
$('staff-open').onclick=async()=>{
  if(demo){toast('Staff access is managed in the live app.');return;}try{const data=await api('/api/staff');$('staff-list').replaceChildren(...data.users.map(u=>{const row=el('div',{class:'staff-row'}),info=el('div');info.append(el('strong',{},u.display_name||u.email),el('small',{},u.email));row.append(info);if(u.system_admin)row.append(el('small',{},'Administrator'));else{const select=el('select',{'aria-label':`Seating access for ${u.email}`});for(const[v,n]of [['none','No access'],['viewer','Viewer'],['host','Host'],['manager','Manager']])select.add(new Option(n,v));select.value=data.grants.find(g=>g.user_id===u.id&&g.location_id===locationId)?.role||'none';select.onchange=async()=>{select.disabled=true;try{await api('/api/staff',{method:'POST',body:JSON.stringify({userId:u.id,locationId,role:select.value})});toast('Staff access saved.');}catch(e){toast(e.message,true);}finally{select.disabled=false;}};row.append(select);}return row;}));$('staff-dialog').showModal();}catch(e){toast(e.message,true);}
};
$('demo-reset').onclick=()=>{localStorage.removeItem('seating-preview');selected.clear();partyId=null;refresh(true);};
setInterval(()=>{if(!document.hidden&&locationId&&!editing)refresh();},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
window.addEventListener('online',()=>refresh(true));window.addEventListener('offline',()=>sync(false,'Offline · changes unavailable'));
loadSession().catch(e=>{if(e.status!==401)toast(e.message,true);});
