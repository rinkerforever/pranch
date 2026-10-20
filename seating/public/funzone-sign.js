import {areaName} from './areas.js';
const $=id=>document.getElementById(id),id=new URLSearchParams(location.search).get('location'),requestedKey=new URLSearchParams(location.hash.slice(1)).get('activate');
const controls=document.querySelector('.print-controls'),activate=document.createElement('button'),preview=document.createElement('a');
activate.textContent='Activate this printed sticker';activate.hidden=true;controls.prepend(activate);preview.textContent='Open guest Fun Zone page';controls.append(preview);
$('print').onclick=()=>window.print();
async function api(path,body){const r=await fetch(path,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Unable to load restaurant.');return data;}
const endpoint=resource=>`/api/locations/${encodeURIComponent(id)}/${resource}`;
let cloudUrl=location.origin;
const template=document.querySelector('.insert'),sheets=document.createElement('div');
template.hidden=true;document.body.prepend(controls);document.body.append(sheets);
async function renderTables(state){
 $('print').disabled=true;sheets.replaceChildren();
 const tables=state.tables.map(t=>({...t,label:/^[A-Z]+\d/i.test(t.number)?t.number:`${areaName(state,t.area)}-${t.number}`})).sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}));
 if(!tables.length)throw new Error('Add tables to the seating chart before printing stickers.');
 let sheet;
 const images=tables.map((t,i)=>{
  if(i%6===0){sheet=document.createElement('section');sheet.className='sticker-sheet';sheets.append(sheet);}
  const sticker=template.cloneNode(true);sticker.hidden=false;sticker.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
  const label=sticker.querySelector('.return');label.className='table-label';label.textContent=`TABLE ${t.label}`;
  const img=sticker.querySelector('img');img.className='table-qr';img.hidden=false;img.alt=`Fun Zone check-in for table ${t.label}`;
  sheet.append(sticker);
  return new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Some QR codes could not load. Reload before printing.'));img.src=endpoint('qr')+'?kind=funzone&table='+encodeURIComponent(t.id);});
 });
 await Promise.all(images);$('print').disabled=false;$('print').textContent=`Print ${tables.length} numbered stickers / Save PDF`;
 $('error').textContent=`${tables.length} table stickers ready on ${Math.ceil(tables.length/6)} Letter sheets. Place each sticker on its matching table. Guest check-in requires the restaurant to be online.`;
}
function show(state){
 if(requestedKey&&state.funZoneKey&&state.funZoneKey!==requestedKey)throw new Error('Another sticker is already active. Use the sticker generated from Guest check-in.');
 activate.hidden=!!state.funZoneKey||!requestedKey;
 if(!state.funZoneKey){$('error').textContent=requestedKey?'Activate this sticker once the restaurant Pi is online. Guests cannot check in until activation.':'Open Fun Zone stickers from Guest check-in to set it up.';return;}
 $('error').textContent='This sticker is active. Guest check-in also requires the restaurant to be online.';
 renderTables(state).catch(e=>{$('error').textContent=e.message;});
 preview.href=`${cloudUrl}/funzone.html?location=${encodeURIComponent(id)}#key=${state.funZoneKey}`;
}
activate.onclick=async()=>{activate.disabled=true;try{const latest=await api(endpoint('state'));const result=await api(endpoint('actions'),{version:latest.version,action:{type:'funZoneSetup',key:requestedKey}});show(result.state);}catch(e){$('error').textContent=e.message;}finally{activate.disabled=false;}};
try{const session=await api('/api/session'),loc=session.locations.find(l=>l.id===id);if(!loc)throw new Error('Sign in with access to this restaurant first.');$('restaurant').textContent=loc.name;const runtime=await api('/api/runtime');cloudUrl=runtime.cloudUrl||location.origin;const {state}=await api(endpoint('state'));show(state);}catch(e){$('error').textContent=e.message;}
