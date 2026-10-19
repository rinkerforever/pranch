const $=id=>document.getElementById(id),id=new URLSearchParams(location.search).get('location'),requestedKey=new URLSearchParams(location.hash.slice(1)).get('activate');
const controls=document.querySelector('.print-controls'),activate=document.createElement('button'),preview=document.createElement('a');
activate.textContent='Activate this printed sticker';activate.hidden=true;controls.prepend(activate);preview.textContent='Open guest Fun Zone page';controls.append(preview);
$('print').onclick=()=>window.print();
async function api(path,body){const r=await fetch(path,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Unable to load restaurant.');return data;}
const endpoint=resource=>`/api/locations/${encodeURIComponent(id)}/${resource}`;
let cloudUrl=location.origin;
function show(state){
 if(requestedKey&&state.funZoneKey&&state.funZoneKey!==requestedKey)throw new Error('Another sticker is already active. Use the sticker generated from Guest check-in.');
 activate.hidden=!!state.funZoneKey||!requestedKey;
 if(!state.funZoneKey){$('error').textContent=requestedKey?'Activate this sticker once the restaurant Pi is online. Guests cannot check in until activation.':'Open Fun Zone stickers from Guest check-in to set it up.';return;}
 $('error').textContent='This sticker is active. Guest check-in also requires the restaurant to be online.';
 $('qr').onload=()=>{$('print').disabled=false;};$('qr').onerror=()=>{$('error').textContent='Unable to load the QR code. Please reload.';};$('qr').src=endpoint('qr')+'?kind=funzone';$('qr').hidden=false;
 preview.href=`${cloudUrl}/funzone.html?location=${encodeURIComponent(id)}#key=${state.funZoneKey}`;
}
activate.onclick=async()=>{activate.disabled=true;try{const latest=await api(endpoint('state'));const result=await api(endpoint('actions'),{version:latest.version,action:{type:'funZoneSetup',key:requestedKey}});show(result.state);}catch(e){$('error').textContent=e.message;}finally{activate.disabled=false;}};
try{const session=await api('/api/session'),loc=session.locations.find(l=>l.id===id);if(!loc)throw new Error('Sign in with access to this restaurant first.');$('restaurant').textContent=loc.name;const runtime=await api('/api/runtime');cloudUrl=runtime.cloudUrl||location.origin;const {state}=await api(endpoint('state'));show(state);}catch(e){$('error').textContent=e.message;}
