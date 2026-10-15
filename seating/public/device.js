export function installApp(){
 if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
export async function runtimeInfo(){try{const response=await fetch('/api/runtime',{cache:'no-store'});return response.ok?response.json():{mode:'cloud'};}catch{return {mode:'cloud',unavailable:true};}}
export async function pairLocalServer({locationId,api}){
 const existing=await api(`/api/locations/${encodeURIComponent(locationId)}/hub`);
 const d=document.createElement('dialog');d.className='local-setup-dialog';
 const title=document.createElement('h2');title.textContent='Local seating server';const description=document.createElement('p');description.textContent=existing.configured?`Pi registered at ${existing.localUrl}. ${existing.enabled?'Local mode is active.':'Waiting for the Pi to pair.'}`:'Register one Pi for this store. Activation moves all seating changes through that Pi. Cloud check-in will pause when it is unreachable.';
 const close=document.createElement('button');close.textContent='Done';close.onclick=()=>d.close();d.append(title,description);
 if(!existing.configured){
  const form=document.createElement('form'),label=document.createElement('label'),url=document.createElement('input'),save=document.createElement('button'),error=document.createElement('p');
  label.textContent='Local HTTPS address';url.type='url';url.required=true;url.placeholder='https://seating-waco.projectaimnet.com';label.append(url);save.textContent='Create Pi configuration';save.type='submit';save.className='primary';form.append(label,save,error);d.append(form);
  form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{const result=await api(`/api/locations/${encodeURIComponent(locationId)}/hub`,{method:'POST',body:JSON.stringify({localUrl:url.value})});const config=`SEATING_LOCATION_ID=${result.locationId}\nSEATING_HUB_TOKEN=${result.token}\nSEATING_CLOUD_URL=${result.cloudUrl}\nSEATING_LOCAL_URL=${result.localUrl}\nSEATING_DATA_DIR=/var/lib/pizza-ranch-seating\n`;const blob=new Blob([config],{type:'text/plain'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='seating-pi.env';link.textContent='Download private Pi configuration';d.append(link);form.remove();description.textContent='Download this configuration once and install it on the Pi. It contains the store’s pairing secret; keep it with the administrator.';link.onclick=()=>setTimeout(()=>URL.revokeObjectURL(link.href),60000);}catch(e){error.textContent=e.message;save.disabled=false;}};
 }
 d.append(close);document.body.append(d);d.showModal();await new Promise(resolve=>d.onclose=resolve);d.remove();
}
