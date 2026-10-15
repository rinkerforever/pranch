import {areaOptions,areaName,roomCombinations} from './areas.js';
const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!==null)n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const types=()=>{const s=el('select',null);s.append(new Option('Table section','section'),new Option('Party room','room'));return s;};
export async function manageAreas({getState,locationName,save}){
 const dialog=el('dialog',null,{class:'area-manager','aria-labelledby':'area-manager-title'}),header=el('div',null,{class:'panel-title'}),close=el('button','Done',{type:'button'});
 header.append(el('h2','Areas & rooms',{id:'area-manager-title'}),close);dialog.append(header,el('p',`${locationName} only`,{class:'access-location'}),el('p','Name the table sections and party rooms for this store. Assign tables in Layout editor or in the PDF import review. Room capacities come from the assigned tables.',{class:'muted'}));
 const error=el('p','',{class:'error',role:'alert'}),list=el('div',null,{class:'area-list'});dialog.append(error,list);
 const add=el('form',null,{class:'area-add-form'}),name=el('input',null,{placeholder:'New area name',maxlength:40,required:'','aria-label':'New area name'}),kind=types();kind.setAttribute('aria-label','New area type');
 add.append(el('h3','Add an area'),name,kind,el('button','Add area',{class:'primary',type:'submit'}));dialog.append(add);
 const comboSection=el('section',null),combos=el('div',null),comboForm=el('form',null,{class:'area-combo-form'}),choices=el('div',null,{class:'checks'}),comboSave=el('button','Add room combination',{type:'submit'});
 comboSection.append(el('h3','Rooms that can open together'),el('p','Only combine rooms with a shared opening or movable divider. Each room can also be booked separately.',{class:'muted'}),combos);comboForm.append(choices,comboSave);comboSection.append(comboForm);dialog.append(comboSection);
 document.body.append(dialog);dialog.showModal();let busy=false,resolveDone;const done=new Promise(resolve=>resolveDone=resolve);
 const finish=()=>{if(!busy){dialog.close();resolveDone();}};close.onclick=finish;dialog.oncancel=e=>{e.preventDefault();finish();};
 async function change(action){
  if(busy)return false;busy=true;error.textContent='';for(const e of dialog.querySelectorAll('button,input,select'))e.disabled=true;
  try{await save(action);render();return true;}catch(e){error.textContent=e.message;return false;}finally{busy=false;for(const e of dialog.querySelectorAll('button,input,select'))e.disabled=false;comboSave.disabled=areaOptions(getState()).filter(a=>a.kind==='room').length<2;}
 }
 function render(){
  const state=getState(),areas=areaOptions(state);
  list.replaceChildren(...areas.map(a=>{
   const row=el('div',null,{class:'area-edit-row'}),input=el('input',null,{maxlength:40,'aria-label':`Name for ${a.name}`}),type=types();input.value=a.name;type.value=a.kind;type.setAttribute('aria-label',`Type for ${a.name}`);
   const tables=state.tables.filter(t=>t.area===a.id),info=el('small',`${tables.length} tables · ${tables.reduce((sum,t)=>sum+(t.capacity||0),0)} confirmed seats`),update=el('button','Save',{type:'button','aria-label':`Save ${a.name}`}),remove=el('button','Remove',{type:'button',class:'quiet danger','aria-label':`Remove ${a.name}`});
   const preferred=el('input',null,{type:'checkbox','aria-label':`Accessibility preferred for ${a.name}`});preferred.checked=!!a.accessiblePreferred;
   const preference=el('label',null,{class:'equipment-toggle area-accessibility'});preference.append(preferred,document.createTextNode('Accessibility preferred / closer to buffet'));
   update.onclick=()=>change({type:'saveArea',id:a.id,name:input.value,kind:type.value,accessiblePreferred:preferred.checked});remove.onclick=()=>change({type:'deleteArea',id:a.id});row.append(input,type,update,remove,info,preference);return row;
  }));
  combos.replaceChildren(...roomCombinations(state).map(c=>{const row=el('div',null,{class:'area-combo-row'}),title=c.areas.map(id=>areaName(state,id)).join(' + '),remove=el('button','Remove',{type:'button','aria-label':`Remove combination ${title}`});remove.onclick=()=>change({type:'deleteRoomCombination',id:c.id});row.append(el('span',title),remove);return row;}));
  const rooms=areas.filter(a=>a.kind==='room');choices.replaceChildren(...rooms.map(a=>{const l=el('label',null),check=el('input',null,{type:'checkbox',value:a.id});l.append(check,document.createTextNode(a.name));return l;}));comboSave.disabled=rooms.length<2;
  if(rooms.length<2)choices.append(el('p','Add at least two party rooms to create a combination.',{class:'muted'}));
 }
 add.onsubmit=async e=>{e.preventDefault();if(await change({type:'saveArea',name:name.value,kind:kind.value}))name.value='';};
 comboForm.onsubmit=e=>{e.preventDefault();change({type:'addRoomCombination',areas:[...choices.querySelectorAll('input:checked')].map(n=>n.value)});};
 render();try{await done;}finally{dialog.remove();}
}
