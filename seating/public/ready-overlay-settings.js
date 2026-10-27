export function openReadyOverlaySettings({getState,locationName,canEdit,save}){
 const dialog=document.createElement('dialog'),heading=document.createElement('h2'),intro=document.createElement('p'),label=document.createElement('label'),toggle=document.createElement('input'),status=document.createElement('p'),done=document.createElement('button');
 heading.textContent='Ready-party TV overlay';
 intro.textContent=`${locationName}: show ready or called parties on this location’s cloud-managed menu screens. Names appear as first name and last initial, with party size. Ads and uploaded media are unchanged.`;
 label.className='equipment-toggle';toggle.type='checkbox';toggle.checked=!!getState().readyOverlay?.enabled;toggle.disabled=!canEdit;label.append(toggle,' Enable ready-party overlay for this location');
 status.setAttribute('role','status');
 const note=document.createElement('p');note.textContent='Off by default. Parties disappear when seated, removed, or marked away. The banner hides if the seating connection is lost. Menu screens update automatically after saving.';
 toggle.onchange=async()=>{toggle.disabled=true;try{if(!await save({type:'readyOverlaySettings',enabled:toggle.checked}))throw Error('Settings were not saved.');status.textContent=getState().readyOverlay?.enabled?'Overlay enabled for this location.':'Overlay disabled for this location.';}catch(error){status.textContent=error.message;}finally{toggle.checked=!!getState().readyOverlay?.enabled;toggle.disabled=!canEdit;}};
 done.textContent='Done';done.onclick=()=>dialog.close();dialog.append(heading,intro,label,note,status,done);document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();
}
