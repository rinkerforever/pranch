import {roomOptions} from './areas.js';
export function partyDisplayUrl(state,locationId,roomId,demo=false){
 if(demo)return '/room-display.html?demo=1';
 if(!state.partyDisplay?.enabled||!state.partyDisplay.key)return null;
 return `https://partydisplay.projectaimnet.com/?location=${encodeURIComponent(locationId)}&room=${encodeURIComponent(roomId)}#key=${state.partyDisplay.key}`;
}
export function openPartyDisplayAddon({getState,locationId,canEdit,save,demo}){
 const d=document.createElement('dialog');
 const title=document.createElement('h2');title.textContent='Party Display add-on';
 const intro=document.createElement('p');intro.textContent='Show room availability, party names and reservation countdowns on dedicated tablets. Enable this add-on for this restaurant, then open a room link on its tablet.';
 const label=document.createElement('label'),toggle=document.createElement('input');label.className='equipment-toggle';toggle.type='checkbox';toggle.checked=!!getState().partyDisplay?.enabled;toggle.disabled=!canEdit;label.append(toggle,' Enable Party Display for this restaurant');
 const links=document.createElement('div'),message=document.createElement('p');message.setAttribute('role','status');
 const note=document.createElement('p');note.textContent='Room links allow read-only access to party names and times. Keep them on restaurant tablets. Disabling the add-on revokes existing links; re-enabling creates new links.';
 const close=document.createElement('button');close.textContent='Done';close.onclick=()=>d.close();
 function render(){links.replaceChildren();if(!getState().partyDisplay?.enabled)return;for(const room of roomOptions(getState())){const row=document.createElement('div'),a=document.createElement('a');row.className='room-block';a.href=partyDisplayUrl(getState(),locationId,room.id,demo);a.target='_blank';a.rel='noopener';a.textContent=`Open ${room.name} display`;row.append(a);
  if(canEdit&&!demo){const qr=document.createElement('img');qr.src=`/api/locations/${encodeURIComponent(locationId)}/qr?kind=party-display&room=${encodeURIComponent(room.id)}`;qr.alt=`Scan on the ${room.name} tablet to set up Party Display`;qr.width=260;qr.height=260;qr.style.cssText='display:block;max-width:100%;height:auto;margin:12px auto';const caption=document.createElement('p');caption.textContent='Scan with the room tablet’s camera to open its display.';row.append(qr,caption);}links.append(row);}if(!links.children.length)links.textContent='Add party rooms in Areas & rooms first.';}
 toggle.onchange=async()=>{toggle.disabled=true;try{if(!await save({type:'partyDisplaySettings',enabled:toggle.checked}))throw Error('Settings were not saved.');message.textContent=toggle.checked?'Party Display enabled.':'Party Display disabled. Existing links are revoked.';}catch(e){message.textContent=e.message;}finally{toggle.checked=!!getState().partyDisplay?.enabled;toggle.disabled=!canEdit;render();}};
 d.append(title,intro,label,links,message,note,close);document.body.append(d);render();d.showModal();d.onclose=()=>d.remove();
}
