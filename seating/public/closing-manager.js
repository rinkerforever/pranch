export function openClosingManager({state,location,name,act}){
 const locationId=location(),dialog=document.createElement('dialog');
 dialog.innerHTML='<form><h2>Manager · Close of day</h2><p class="closing-summary"></p><p>Clear occupied and cleaning tables, finish seated parties, and release rooms currently in use. Waiting guests, held reservations, future bookings, and section settings stay unchanged.</p><label>Manager PIN<input name="pin" type="password" inputmode="numeric" autocomplete="off" required></label><label class="closing-confirm"><input name="confirm" type="checkbox" required> I have checked that all guests have left and the tables are ready to open.</label><p class="error" role="alert"></p><div class="dialog-actions"><button type="button">Cancel</button><button class="primary" type="submit">Clear tables after close</button></div></form>';
 const form=dialog.querySelector('form'),submit=form.querySelector('[type=submit]'),error=form.querySelector('.error');
 const count=state().tables.filter(t=>['in_use','cleaning'].includes(t.status)).length;
 form.querySelector('.closing-summary').textContent=`${name}: ${count} occupied or cleaning tables.`;
 submit.disabled=!count;
 form.querySelector('[type=button]').onclick=()=>dialog.close();
 form.onsubmit=async e=>{
  e.preventDefault();error.textContent='';
  if(location()!==locationId){error.textContent='Restaurant changed. Close this window and try again.';return;}
  if(form.elements.pin.value!=='1111'){error.textContent='Incorrect manager PIN.';return;}
  if(!form.reportValidity())return;
  submit.disabled=true;
  try{if(await act({type:'clearAfterClose',pin:form.elements.pin.value}))dialog.close();else error.textContent='Tables were not cleared. Review the message and try again.';}finally{submit.disabled=false;}
 };
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();form.elements.pin.focus();
}
