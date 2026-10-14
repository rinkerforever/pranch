const NS='http://www.w3.org/2000/svg';
const svg=(tag,attrs={},text)=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!==null)n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
export function suggestedCovers(tables){
 return tables.map(t=>{
  const across=t.orientation==='tb',long=Math.max(38,Math.ceil((t.capacity||4)/2)*14+7);
  const w=(t.kind==='booth'?44:across?long:38)+28,h=(t.kind==='booth'?44:across?38:long)+28;
  const x=Math.max(0,t.x-w/2),y=Math.max(0,t.y-h/2);
  return {x,y,width:Math.min(w,1660-x),height:Math.min(h,950-y)};
 });
}
// Mask only the image. Table controls above it keep their original coordinates and behavior.
export function planImage(href,covers=[],id='plan-cleanup-mask',opacity=.48){
 const g=svg('g'),defs=svg('defs'),mask=svg('mask',{id,maskUnits:'userSpaceOnUse',x:0,y:0,width:1660,height:950,'mask-type':'luminance'});
 mask.append(svg('rect',{width:1660,height:950,fill:'white'}));
 for(const r of covers)mask.append(svg('rect',{...r,fill:'black'}));
 defs.append(mask);g.append(defs,svg('image',{href,x:0,y:0,width:1660,height:950,preserveAspectRatio:'xMidYMid meet',opacity,mask:`url(#${id})`}));return g;
}
export async function cleanUpPlan({state,href,locationName,save}){
 let covers=structuredClone(state.background.covers||[]),selected=-1,busy=false,history=[],resolve;
 const dialog=el('dialog',null,{class:'plan-cleanup-dialog','aria-labelledby':'cleanup-title'}),header=el('div',null,{class:'panel-title'}),cancel=el('button','Cancel',{type:'button'});
 header.append(el('h2','Clean up plan',{id:'cleanup-title'}),cancel);
 dialog.append(header,el('p',`${locationName} only`),el('p','Cover the printed tables and chairs so only your selectable tables remain. Suggested covers are approximate: check the walls and doors before saving. Drag over the image to add a cover; tap a dashed cover to adjust or remove it. The original image is kept.',{class:'muted'}));
 const controls=el('div',null,{class:'cleanup-controls'}),suggest=el('button','Suggest table covers',{type:'button'}),add=el('button','Add cover',{type:'button'}),undo=el('button','Undo',{type:'button'}),restore=el('button','Restore original image',{type:'button'});
 const original=el('input',null,{type:'checkbox'}),originalLabel=el('label',null),show=el('input',null,{type:'checkbox'}),showLabel=el('label',null);show.checked=true;originalLabel.append(original,document.createTextNode('Compare original'));showLabel.append(show,document.createTextNode('Show selectable tables'));
 controls.append(suggest,add,undo,restore,originalLabel,showLabel);dialog.append(controls);
 const preview=svg('svg',{viewBox:'0 0 1660 950',class:'cleanup-preview','aria-label':'Floor plan cleanup preview'});dialog.append(preview);
 const edit=el('div',null,{class:'cleanup-fields'}),pick=el('select',null,{'aria-label':'Cover to adjust'});edit.append(pick);
 const fields={};for(const [key,name]of [['x','Left'],['y','Top'],['width','Width'],['height','Height']]){const label=el('label',name),input=el('input',null,{type:'number',min:key==='x'||key==='y'?0:1,max:key==='x'||key==='width'?1660:950,'aria-label':`Cover ${name.toLowerCase()}`});fields[key]=input;label.append(input);edit.append(label);}
 const remove=el('button','Remove cover',{type:'button'});edit.append(remove);dialog.append(edit);
 const status=el('p','',{role:'status'}),error=el('p','',{role:'alert',class:'error'}),apply=el('button','Save cleaned plan',{type:'button',class:'primary'});dialog.append(status,error,apply);document.body.append(dialog);dialog.showModal();
 const done=new Promise(r=>resolve=r),finish=()=>{if(!busy){dialog.close();resolve();}};cancel.onclick=finish;dialog.oncancel=e=>{e.preventDefault();finish();};
 const remember=()=>{history.push(structuredClone(covers));if(history.length>20)history.shift();};
 function draw(){
  preview.replaceChildren(planImage(href,original.checked?[]:covers,'cleanup-preview-mask',1));
  if(show.checked)for(const t of state.tables){const g=svg('g',{'pointer-events':'none'});g.append(svg('rect',{x:t.x-19,y:t.y-19,width:38,height:38,rx:5,fill:'#e3f1e5',stroke:'#36744a'}),svg('text',{x:t.x,y:t.y+4,'font-size':13,'text-anchor':'middle',fill:'#26362b'},t.number));preview.append(g);}
  if(!original.checked)covers.forEach((r,i)=>{const box=svg('rect',{...r,fill:'transparent',stroke:i===selected?'#ad2429':'#3379b9','stroke-width':2,'stroke-dasharray':'5 4',tabindex:0,role:'button','aria-label':`Adjust cover ${i+1}`});box.onpointerdown=e=>e.stopPropagation();box.onclick=()=>{selected=i;render();};box.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selected=i;render();}};preview.append(box);});
 }
 function render(){
  pick.replaceChildren(new Option('Select a cover',''),...covers.map((_,i)=>new Option(`Cover ${i+1}`,String(i))));pick.value=selected<0?'':String(selected);
  for(const[key,input]of Object.entries(fields)){input.value=covers[selected]?Math.round(covers[selected][key]*10)/10:'';input.disabled=!covers[selected]||busy;}
  remove.disabled=!covers[selected]||busy;undo.disabled=!history.length||busy;suggest.disabled=busy||!state.tables.length;restore.disabled=busy||!covers.length;add.disabled=busy||covers.length>=300;
  status.textContent=`${covers.length} covers · Your tables, guests and seat counts stay unchanged.`;draw();
 }
 pick.onchange=()=>{selected=pick.value===''?-1:Number(pick.value);render();};
 for(const[key,input]of Object.entries(fields))input.onchange=()=>{if(!covers[selected])return;const next={...covers[selected],[key]:Number(input.value)};if(Object.values(next).some(v=>!Number.isFinite(v))||next.x<0||next.y<0||next.width<1||next.height<1||next.x+next.width>1660||next.y+next.height>950){error.textContent='Keep the cover inside the floor plan.';render();return;}error.textContent='';remember();covers[selected]=next;render();};
 suggest.onclick=()=>{remember();covers=suggestedCovers(state.tables);selected=-1;original.checked=false;render();};
 add.onclick=()=>{remember();covers.push({x:800,y:445,width:60,height:60});selected=covers.length-1;original.checked=false;render();};
 restore.onclick=()=>{remember();covers=[];selected=-1;render();};undo.onclick=()=>{if(history.length){covers=history.pop();selected=-1;render();}};
 remove.onclick=()=>{if(selected<0)return;remember();covers.splice(selected,1);selected=-1;render();};original.onchange=draw;show.onchange=draw;
 preview.onpointerdown=e=>{
  if(busy||original.checked||covers.length>=300)return;e.preventDefault();const position=ev=>{const p=preview.createSVGPoint();p.x=ev.clientX;p.y=ev.clientY;const r=p.matrixTransform(preview.getScreenCTM().inverse());return {x:Math.max(0,Math.min(1660,r.x)),y:Math.max(0,Math.min(950,r.y))};};
  const start=position(e),draft=svg('rect',{fill:'#3379b933',stroke:'#3379b9','pointer-events':'none'});preview.append(draft);preview.setPointerCapture(e.pointerId);let rect=null;
  preview.onpointermove=ev=>{const p=position(ev);rect={x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),width:Math.abs(p.x-start.x),height:Math.abs(p.y-start.y)};for(const[k,v]of Object.entries(rect))draft.setAttribute(k,v);};
  const stop=commit=>{preview.onpointermove=null;preview.onpointerup=null;preview.onpointercancel=null;if(commit&&rect&&rect.width>=2&&rect.height>=2){remember();covers.push(rect);selected=covers.length-1;}render();};preview.onpointerup=()=>stop(true);preview.onpointercancel=()=>stop(false);
 };
 apply.onclick=async()=>{if(busy)return;busy=true;for(const n of dialog.querySelectorAll('input,button,select'))n.disabled=true;error.textContent='';try{await save(covers);busy=false;finish();}catch(e){error.textContent=e.message;}finally{busy=false;for(const n of dialog.querySelectorAll('input,button,select'))n.disabled=false;render();}};
 render();try{await done;}finally{dialog.remove();}
}
