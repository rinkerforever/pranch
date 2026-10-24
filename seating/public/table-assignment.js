import {walkInTables} from './rooms.js';
import {combinationCandidates} from './suggestions.js';

export function assignmentChoices(state,ids,now=Date.now()){
 const tables=ids.map(id=>state.tables.find(t=>t.id===id)).filter(Boolean);
 const available=walkInTables(state,now);
 const sameGroup=tables.length>0&&tables[0].group&&tables.every(t=>t.group===tables[0].group)&&state.tables.filter(t=>t.group===tables[0].group).length===tables.length;
 const valid=tables.length===ids.length&&tables.length>0&&tables.every(t=>available.some(a=>a.id===t.id)&&t.status==='open'&&t.capacity)&&
  (sameGroup||combinationCandidates(state.tables).some(ts=>ts.length===ids.length&&ts.every(t=>ids.includes(t.id))));
 const capacity=tables.reduce((sum,t)=>sum+(t.capacity||0),0);
 return state.parties.filter(p=>p.status==='waiting').sort((a,b)=>a.arrivedAt-b.arrivedAt).map((party,index)=>({party,position:index+1,reason:!valid?'Tables unavailable — review selection':party.attendance==='away'?'Guest away':party.size>capacity?'Needs more tables':'Fits'}));
}

export function createTableAssignment({context,seat,changeTables}){
 const dialog=document.createElement('dialog');dialog.className='table-assignment';dialog.setAttribute('aria-label','Assign waiting guest');
 dialog.innerHTML='<div class="panel-title"><h2>Assign waiting guest</h2><button type="button" class="quiet" aria-label="Close">✕</button></div><p class="assignment-context"></p><label>Search waiting guests<input type="search" placeholder="Party name" autocomplete="off"></label><p class="muted">Arrival order · Select a party, then confirm seating.</p><div class="assignment-list"></div><p class="assignment-error" role="alert"></p><div class="dialog-actions"><button type="button" class="assignment-change">Change tables</button><button type="button" class="primary assignment-seat" disabled>Select a guest</button></div>';
 document.body.append(dialog);
 const list=dialog.querySelector('.assignment-list'),search=dialog.querySelector('input'),submit=dialog.querySelector('.assignment-seat'),error=dialog.querySelector('.assignment-error');
 let ids=[],location=null,chosen=null,saving=false,lastKey='';
 dialog.querySelector('[aria-label="Close"]').onclick=()=>dialog.close();
 dialog.querySelector('.assignment-change').onclick=()=>{dialog.close();changeTables(chosen,ids);};
 function refresh(){
  if(!dialog.open)return;
  const c=context();if(!c.state||c.location!==location){dialog.close();return;}
  const rows=assignmentChoices(c.state,ids),tables=c.state.tables.filter(t=>ids.includes(t.id));
  dialog.querySelector('.assignment-context').textContent=tables.map(c.label).join(' + ')+' · '+tables.reduce((n,t)=>n+(t.capacity||0),0)+' seats';
  const selected=rows.find(r=>r.party.id===chosen);
  submit.disabled=saving||!c.canWrite||selected?.reason!=='Fits';
  submit.textContent=selected?`Seat ${selected.party.name} at ${tables.map(c.label).join(' + ')}`:'Select a guest';
  const key=JSON.stringify([rows,search.value,chosen,c.canWrite,saving,Math.floor(Date.now()/60000)]);if(key===lastKey)return;lastKey=key;
  list.replaceChildren();
  for(const row of rows.filter(r=>r.party.name.toLowerCase().includes(search.value.trim().toLowerCase()))){
   const button=document.createElement('button');button.type='button';button.className='assignment-party';button.setAttribute('aria-pressed',String(chosen===row.party.id));button.disabled=saving||!c.canWrite||row.reason!=='Fits';
   const name=document.createElement('strong'),detail=document.createElement('span'),fit=document.createElement('small');
   name.textContent=`#${row.position} · ${row.party.name}`;detail.textContent=`${row.party.size} guests · Waiting ${Math.max(0,Math.floor((Date.now()-row.party.arrivedAt)/60000))} min`;fit.textContent=row.reason;
   button.append(name,detail,fit);button.onclick=()=>{chosen=row.party.id;error.textContent='';refresh();};list.append(button);
  }
  if(!list.children.length){const empty=document.createElement('p');empty.textContent=rows.length?'No matching guests.':'No guests are waiting.';list.append(empty);}
 }
 search.oninput=refresh;
 submit.onclick=async()=>{
  refresh();if(submit.disabled)return;
  saving=true;refresh();error.textContent='';
  try{if(await seat(chosen,[...ids]))dialog.close();else error.textContent='Not seated. Review the current table and guest status, then try again.';}
  finally{saving=false;refresh();}
 };
 return {open(tableIds){ids=[...tableIds];location=context().location;chosen=null;search.value='';error.textContent='';lastKey='';dialog.showModal();refresh();search.focus();},refresh};
}
