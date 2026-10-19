const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),key=new URLSearchParams(location.hash.slice(1)).get('key'),id=params.get('location');
let tables=[],current=null,since=null,busy=false;
async function api(body){const r=await fetch(`/api/funzone/${encodeURIComponent(id)}`,{method:body?'POST':'GET',headers:{'x-funzone-key':key||'',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Unable to update. Please see the host.');return data;}
function tick(){if(since)$('timer').textContent=`In the Fun Zone for ${Math.max(0,Math.floor((Date.now()-since)/60000))} min. Your table is still in use.`;}
function show(data){since=data.since;$('status').hidden=false;$('status-title').textContent=since?'Have fun! Our team has been updated.':'You’re back! Our team has been updated.';$('timer').textContent=since?'':'Your Fun Zone timer has stopped.';$('back').hidden=!since;tick();}
async function update(action){if(busy||!current)return;busy=true;$('table').disabled=true;$('enter').disabled=true;$('back').disabled=true;$('error').textContent='';try{show(await api({table:current.id,visit:current.visit,action}));}catch(e){$('error').textContent=e.message;}finally{busy=false;$('table').disabled=false;$('enter').disabled=false;$('back').disabled=false;}}
$('form').onsubmit=e=>{e.preventDefault();current=tables.find(t=>t.id===$('table').value);update('enter');};
$('back').onclick=()=>update('back');
$('table').onchange=()=>{current=null;since=null;$('status').hidden=true;$('error').textContent='';};
try{if(!id||!key)throw new Error('Please scan the Fun Zone QR code at your table.');const data=await api();tables=data.tables;$('restaurant').textContent=data.location;$('table').replaceChildren(new Option('Choose your table…',''),...tables.map(t=>new Option(t.label,t.id)));$('enter').disabled=false;}catch(e){$('error').textContent=e.message;}
setInterval(tick,1000);
setInterval(async()=>{if(!current||busy||document.hidden)return;const visit=current;try{const data=await api({table:visit.id,visit:visit.visit,action:'status'});if(current===visit&&!busy)show(data);}catch(e){if(current!==visit||busy)return;$('error').textContent=e.message;}},10000);
