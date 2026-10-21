const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),demo=params.get('demo')==='1';
const locationId=params.get('location'),roomId=params.get('room'),key=new URLSearchParams(location.hash.slice(1)).get('key');
let snapshot=null,lastSync=0,loading=false,wakeLock,clockOffset=0,errorMessage='Connecting…';
const time=t=>new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(t);
const date=t=>new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric'}).format(t);
const range=b=>`${date(b.startsAt)} · ${time(b.startsAt)} – ${time(b.endsAt)}`;
function viewAt(now){
 if(!snapshot||Date.now()-lastSync>45000)return {status:'unavailable'};
 const bookings=[snapshot.booking,snapshot.next].filter(b=>b&&b.endsAt>now).sort((a,b)=>a.startsAt-b.startsAt);
 const booking=bookings[0],next=bookings[1];
 if(!booking)return {room:snapshot.room,status:snapshot.baseStatus};
 if(booking.startsAt>now)return {room:snapshot.room,status:'reserved',booking};
 return {room:snapshot.room,status:'active',booking,next,remaining:booking.endsAt-now,progress:Math.min(1,(now-booking.startsAt)/(booking.endsAt-booking.startsAt))};
}
function render(){
 const now=Date.now()+clockOffset;const view=viewAt(now);$('clock').textContent=time(now);
 document.body.dataset.status=view.status;
 $('room').textContent=snapshot?.room.name||'Party room';
 $('status').textContent={active:'Party in progress',reserved:'Reserved',closed:'Closed',open:'Open',unavailable:'Please check with staff'}[view.status];
 $('party').textContent=view.booking?.name||'';$('reservation').textContent=view.booking?range(view.booking):'';
 $('timer-panel').hidden=view.status!=='active';
 if(view.status==='active'){const seconds=Math.ceil(view.remaining/1000);$('timer').textContent=`${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;$('progress').value=view.progress;}
 $('message').textContent={open:'Welcome! This room is open.',closed:'This room is currently closed.',reserved:'We look forward to celebrating with you.',active:'Enjoy your time together.',unavailable:'Live room information is unavailable.'}[view.status];
 $('next-label').textContent=view.next?'UP NEXT':'WELCOME TO PIZZA RANCH';$('next').textContent=view.next?`${view.next.name} · ${range(view.next)}`:'Make room for good times.';
 $('connection').textContent=demo?'Preview · sample reservations':view.status==='unavailable'?errorMessage:`Updated ${time(lastSync+clockOffset)} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
}
async function refresh(){
 if(loading||demo||!key||!locationId||!roomId)return;loading=true;
 try{
  const response=await fetch(`/api/party-display/${encodeURIComponent(locationId)}?room=${encodeURIComponent(roomId)}`,{headers:{'x-party-display-key':key},cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
  if(!response.ok){if([401,403,404].includes(response.status)){snapshot=null;lastSync=0;}const data=await response.json();throw Error(data.error||'Room information unavailable.');}
  const data=await response.json();snapshot=data.view;lastSync=Date.now();clockOffset=data.serverTime-lastSync;errorMessage='Connection interrupted · checking for updates';$('setup-error').textContent='';
 }catch(e){errorMessage=e.message;$('setup-error').textContent=e.message;}finally{loading=false;render();}
}
$('settings').onclick=()=> $('setup').showModal();
async function stayAwake(){try{if('wakeLock'in navigator&&document.visibilityState==='visible')wakeLock=await navigator.wakeLock.request('screen');}catch{}}
$('fullscreen').onclick=async()=>{try{await document.documentElement.requestFullscreen?.();await stayAwake();}catch{}};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){refresh();stayAwake();}});
async function start(){
 if(demo){const now=Date.now();snapshot={room:{name:'Rose City'},baseStatus:'open',booking:{name:'The Johnson Birthday Party',startsAt:now-1800000,endsAt:now+5400000},next:{name:'Miller Family Celebration',startsAt:now+7200000,endsAt:now+14400000}};lastSync=now;setInterval(()=>lastSync=Date.now(),10000);}
 else if(!key||!locationId||!roomId){errorMessage='Open this tablet’s room link from Seating → Settings → Party Display add-on.';$('setup-error').textContent=errorMessage;$('setup').showModal();}
 else await refresh();
 render();await stayAwake();setInterval(render,1000);setInterval(refresh,10000);
}
start();
