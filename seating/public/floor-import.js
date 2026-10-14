import {AREAS} from './floor.js';
import {pdfLabels,pdfDrawingBounds,detectPlanTables,pagePlacement,planFrame} from './plan-detection.js';
const NS='http://www.w3.org/2000/svg';
const node=(tag,text,attrs={})=>{const e=document.createElement(tag);if(text!==null)e.textContent=text;for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
const svg=(tag,attrs,text)=>{const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;};
const field=(title,input)=>{const label=node('label',title);label.append(input);return label;};

// Nothing is persisted until the manager reviews the imported table list and presses Apply.
export async function reviewFloorImport(file,{locationName,save}){
 if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf'))throw new Error('Automatic table import currently needs a PDF with readable table labels. Export the original drawing as a PDF. Your current layout has not changed.');
 const pdfjs=await import('./vendor/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
 const doc=await pdfjs.getDocument({data:await file.arrayBuffer(),isEvalSupported:false}).promise;
 const dialog=node('dialog',null,{class:'floor-import-dialog','aria-labelledby':'floor-import-title'}),header=node('div',null,{class:'panel-title'});
 header.append(node('h2','Review new floor plan',{id:'floor-import-title'}));const cancel=node('button','Cancel',{type:'button'});header.append(cancel);dialog.append(header);
 dialog.append(node('p',`${locationName} only · ${file.name}`),node('p','Review the table numbers, positions, types and seats. Drag a marker to move it. Uncheck anything that is not a table. Applying replaces this location’s old tables and combinations; the waiting list is kept.',{class:'muted'}));
 const pageSelect=node('select',null,{'aria-label':'PDF page'});for(let p=1;p<=doc.numPages;p++)pageSelect.append(new Option(`Page ${p}`,p));
 const controls=node('div',null,{class:'import-controls'});controls.append(field('PDF page',pageSelect));
 const bulkSeats=node('input',null,{type:'number',min:'1',max:'20',placeholder:'Seats','aria-label':'Seats for unconfirmed tables'}),bulk=node('button','Set unconfirmed seats',{type:'button'});
 controls.append(field('Optional: apply a seat count to unconfirmed tables',bulkSeats),bulk);dialog.append(controls);
 const summary=node('p','Reading PDF…',{role:'status',class:'estimate-note'}),error=node('p','',{role:'alert',class:'error'});dialog.append(summary,error);
 const preview=svg('svg',{viewBox:'0 0 1660 950',class:'import-preview',role:'group','aria-label':'Detected tables over uploaded PDF'});
 const scroll=node('div',null,{class:'import-table-scroll'}),table=node('table',null,{class:'import-table'}),head=node('thead',null),hr=node('tr',null);
 for(const text of ['Use','Table number','Area','Seats','Type','Chairs'])hr.append(node('th',text,{scope:'col'}));head.append(hr);const body=node('tbody',null);table.append(head,body);scroll.append(table);dialog.append(preview,scroll);
 const footer=node('div',null,{class:'dialog-actions'}),apply=node('button','Apply new floor plan',{type:'button',class:'primary'});footer.append(apply);dialog.append(footer);document.body.append(dialog);dialog.showModal();
 let tables=[],blob=null,url=null,loading=false,saving=false,finished=false,declaredSeats=null;
 let resolveResult;const result=new Promise(resolve=>resolveResult=resolve);
 const finish=value=>{if(finished)return;finished=true;dialog.close();resolveResult(value);};
 cancel.onclick=()=>{if(!saving)finish(false);};dialog.oncancel=e=>{e.preventDefault();if(!saving)finish(false);};
 function update(){
  const included=tables.filter(t=>t.included),unknown=included.filter(t=>!t.capacity).length,seen=new Set(),duplicates=[];
  for(const t of included){const key=t.area+'|'+t.number.trim().toLowerCase();if(seen.has(key))duplicates.push(`${t.area}: ${t.number}`);seen.add(key);}
  const invalid=included.length>200||included.some(t=>!t.number.trim()||(t.capacity!==null&&(!Number.isInteger(t.capacity)||t.capacity<1||t.capacity>20)));
  summary.textContent=`${declaredSeats?'PDF total: '+declaredSeats+' seats. ':''}${included.length} tables · ${included.reduce((n,t)=>n+(t.capacity||0),0)} seats entered · ${unknown} need seat counts. Seat counts are suggestions to verify; blank counts are excluded from seating suggestions until confirmed.`;
  error.textContent=duplicates.length?`Duplicate labels in this PDF: ${[...new Set(duplicates)].join(', ')}. Correct a number or area, or uncheck a duplicate.`:included.length>200?'Select no more than 200 tables. Uncheck extras before applying.':invalid?'Check table numbers and seat counts (1–20, or leave blank).':!included.length?'No readable table labels found. Choose another page or a PDF exported with selectable table numbers. The original layout will stay unchanged.':'';
  apply.disabled=loading||saving||!blob||!included.length||invalid||!!duplicates.length;
  draw();
 }
 function draw(){
  preview.replaceChildren();if(url)preview.append(svg('image',{href:url,x:0,y:0,width:1660,height:950}));
  for(const t of tables.filter(t=>t.included)){
   const g=svg('g',{transform:`translate(${t.x} ${t.y})`,class:'import-marker',tabindex:0,role:'button','aria-label':`Table ${t.number}, ${t.capacity||'unconfirmed'} seats`});
   g.append(svg('rect',{x:-22,y:-15,width:44,height:30,rx:4,fill:t.capacity?'#e3f1e5':'#fff0d0',stroke:'#a92528','stroke-width':2}),svg('text',{'text-anchor':'middle',y:5,'font-size':13,'font-weight':700},t.number));
   const focus=()=>body.children[tables.indexOf(t)]?.scrollIntoView({block:'nearest'});g.onclick=focus;g.onkeydown=e=>{if(e.key==='Enter')focus();};
   g.onpointerdown=e=>{if(saving)return;e.preventDefault();g.setPointerCapture(e.pointerId);const move=ev=>{const p=preview.createSVGPoint();p.x=ev.clientX;p.y=ev.clientY;const v=p.matrixTransform(preview.getScreenCTM().inverse());t.x=Math.max(30,Math.min(1630,v.x));t.y=Math.max(30,Math.min(920,v.y));g.setAttribute('transform',`translate(${t.x} ${t.y})`);};g.onpointermove=move;const stop=()=>{g.onpointermove=null;g.onpointerup=null;g.onpointercancel=null;};g.onpointerup=stop;g.onpointercancel=stop;};preview.append(g);
  }
 }
 function renderRows(){
  body.replaceChildren(...tables.map(t=>{
   const row=node('tr',null),include=node('input',null,{type:'checkbox','aria-label':`Include table ${t.number}`});include.checked=t.included;include.onchange=()=>{t.included=include.checked;update();};
   const number=node('input',null,{maxlength:12,'aria-label':`Number for table ${t.number}`});number.value=t.number;number.oninput=()=>{t.number=number.value;update();};
   const area=node('select',null,{'aria-label':`Area for table ${t.number}`});for(const a of AREAS)area.append(new Option(a,a));area.value=t.area;area.onchange=()=>{t.area=area.value;update();};
   const seats=node('input',null,{type:'number',min:1,max:20,placeholder:'Confirm','aria-label':`Seats for table ${t.number}`});seats.value=t.capacity??'';seats.oninput=()=>{t.capacity=seats.value===''?null:Number(seats.value);update();};
   const kind=node('select',null,{'aria-label':`Type for table ${t.number}`});kind.append(new Option('Table','table'),new Option('Booth','booth'));kind.value=t.kind;kind.onchange=()=>{t.kind=kind.value;};
   const orientation=node('select',null,{'aria-label':`Chair sides for table ${t.number}`});orientation.append(new Option('Left / right','lr'),new Option('Top / bottom','tb'));orientation.value=t.orientation;orientation.onchange=()=>{t.orientation=orientation.value;};
   for(const input of [include,number,area,seats,kind,orientation]){const td=node('td',null);td.append(input);row.append(td);}return row;
  }));update();
 }
 async function readPage(){
  let pageError=null;
  loading=true;apply.disabled=true;pageSelect.disabled=true;bulk.disabled=true;error.textContent='';summary.textContent='Reading table labels and drawing the PDF…';
  try{
   const page=await doc.getPage(Number(pageSelect.value)),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2200/base.width,2200/base.height)}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
   await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
   const [text,operators]=await Promise.all([page.getTextContent(),page.getOperatorList()]);if(finished)return;
   const labels=pdfLabels(text.items,base),shapes=pdfDrawingBounds(operators,pdfjs.OPS,base),frame=planFrame(labels,shapes,base.width,base.height);
   declaredSeats=labels.map(l=>/total\s*seats\s*:?\s*(\d+)/i.exec(l.text)?.[1]).find(Boolean)||null;
   tables=detectPlanTables(labels,shapes,base.width,base.height,frame);
   const plan=document.createElement('canvas');plan.width=1660;plan.height=950;const ctx=plan.getContext('2d'),place=pagePlacement(frame.w,frame.h);ctx.fillStyle='#fff';ctx.fillRect(0,0,1660,950);ctx.drawImage(canvas,frame.x*viewport.scale,frame.y*viewport.scale,frame.w*viewport.scale,frame.h*viewport.scale,place.x,place.y,frame.w*place.scale,frame.h*place.scale);
   blob=await new Promise(resolve=>plan.toBlob(resolve,'image/png'));if(!blob)throw new Error('Could not render the PDF. Try exporting it again.');if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);
  }catch(e){blob=null;tables=[];pageError=e.message;}finally{loading=false;pageSelect.disabled=false;bulk.disabled=false;if(!finished){renderRows();if(pageError)error.textContent=pageError;}}
 }
 pageSelect.onchange=readPage;
 bulk.onclick=()=>{const n=Number(bulkSeats.value);if(!Number.isInteger(n)||n<1||n>20){error.textContent='Enter a seat count from 1 to 20.';return;}for(const t of tables)if(t.included&&!t.capacity)t.capacity=n;renderRows();};
 apply.onclick=async()=>{
  update();if(apply.disabled)return;saving=true;update();cancel.disabled=true;pageSelect.disabled=true;bulk.disabled=true;for(const input of body.querySelectorAll('input,select'))input.disabled=true;
  try{await save({blob,tables:tables.filter(t=>t.included).map(({included,...t})=>t),page:Number(pageSelect.value)});finish(true);}catch(e){error.textContent=e.message;}
  finally{saving=false;cancel.disabled=false;pageSelect.disabled=false;bulk.disabled=false;for(const input of body.querySelectorAll('input,select'))input.disabled=false;if(!finished)apply.disabled=false;}
 };
 try{await readPage();return await result;}finally{if(url)URL.revokeObjectURL(url);dialog.remove();await doc.destroy();}
}
