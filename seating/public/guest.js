const $=id=>document.getElementById(id),id=new URLSearchParams(location.search).get('location');
const endpoint='/api/guest/'+encodeURIComponent(id||'');let sending=false,visitFinished=false;
async function request(body){const r=await fetch(endpoint,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Unable to connect. Please see the host.');return data;}
function render(data){
 $('restaurant').textContent=data.location;$('error').textContent='';const p=data.party,active=p&&['waiting','seated','reserved'].includes(p.status);
 visitFinished=!!p&&['seated','cancelled','completed'].includes(p.status);
 document.body.classList.toggle('showing-status',!!active);
 $('heading').textContent=active?(p.status==='reserved'?'Your party room is held':p.ready&&p.status==='waiting'?'Your table is ready!':p.status==='seated'?'Enjoy your meal!':"You're on the list"):'Join the waitlist';
 $('message').textContent=data.offline?data.message||'Online check-in is temporarily unavailable. Please see the host to join the waitlist.':active?'':data.enabled?`Welcome! Parties of up to ${data.maxPartySize} can join here.`:'Online check-in is closed. Please see the host.';
 $('join-form').hidden=active||!data.enabled;$('party').hidden=!p;
 $('lookup-form').hidden=active||data.offline;
 $('resize-form').hidden=!p||p.status!=='waiting'||data.offline;
 $('new-size').max=data.maxPartySize;
 if(p&&document.activeElement!==$('new-size'))$('new-size').value=p.size;
 $('size').max=data.maxPartySize;$('cancel').hidden=!p||p.status!=='waiting';
 $('wait-summary').hidden=!p||p.status!=='waiting';
 $('queue-position').textContent=p?.position?`Your place in line: #${p.position}`:'';
 $('wait-estimate').textContent=data.offline?'Wait estimate temporarily unavailable':p?.ready?'Your table is ready — please return to the host.':p?.paused?'Your wait is paused. Please check in with the host.':p?.wait?`Estimated remaining wait: ${p.wait.lower}–${p.wait.upper} minutes`:'Please ask the host for a wait estimate.';
 if(!p)$('size-confirmation').textContent='';
 if(p){$('party-name').textContent=p.name;$('party-size').textContent=`Party of ${p.size}`;$('party').classList.toggle('ready',p.ready&&p.status==='waiting');$('guidance').textContent=p.status==='waiting'?(p.ready?'Please return to the host stand now.':'Please stay nearby. This page checks for updates automatically.'):p.status==='reserved'?'Please check with the host when your group arrives.':p.status==='seated'?'Your party has been seated.':p.status==='cancelled'?'Your party has left the waitlist.':'Your visit is complete. Thank you!';}
 $('updated').textContent='Updated '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
}
async function refresh(){if(sending)return;try{render(await request());}catch(e){$('join-form').hidden=true;$('lookup-form').hidden=true;$('resize-form').hidden=true;$('error').textContent='Online check-in is unavailable. Please see the host to join the waitlist.';$('updated').textContent='Status could not be refreshed. Please check with the host.';}}
$('lookup-form').onsubmit=async e=>{e.preventDefault();if(sending)return;sending=true;$('lookup-button').disabled=true;try{await request({action:'lookup',name:$('lookup-name').value.trim(),size:Number($('lookup-size').value)});render(await request());}catch(e){$('error').textContent=e.message;}finally{sending=false;$('lookup-button').disabled=false;}};
$('resize-form').onsubmit=async e=>{e.preventDefault();if(sending)return;sending=true;$('resize-button').disabled=true;try{await request({action:'resize',size:Number($('new-size').value)});render(await request());$('size-confirmation').textContent='Party size updated. Staff will see your new size and revised seating options.';}catch(e){$('error').textContent=e.message;}finally{sending=false;$('resize-button').disabled=false;}};
$('join-form').onsubmit=async e=>{e.preventDefault();if(sending)return;sending=true;$('join-button').disabled=true;try{await request({action:'join',name:$('name').value.trim(),size:Number($('size').value),notes:$('notes').value.trim(),highChair:$('highchair').checked,booster:$('booster').checked,accessibility:$('accessibility').checked,website:$('website').value});render(await request());}catch(e){$('error').textContent=e.message;}finally{sending=false;$('join-button').disabled=false;}};
$('cancel').onclick=async()=>{if(sending||!confirm('Leave the waitlist?'))return;sending=true;$('cancel').disabled=true;try{await request({action:'cancel'});render(await request());}catch(e){$('error').textContent=e.message;}finally{sending=false;$('cancel').disabled=false;}};
$('refresh').onclick=refresh;if(id)refresh();else{$('message').textContent='Please scan the restaurant’s QR code or ask the host for a check-in link.';$('refresh').hidden=true;}
setInterval(()=>{if(id&&!document.hidden&&!visitFinished)refresh();},5000);document.addEventListener('visibilitychange',()=>{if(id&&!document.hidden)refresh();});
