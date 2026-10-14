// PDF text and vector bounds are converted through the same viewport used to draw the page.
const point=(m,x,y)=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
function bounds(points){const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};}
export function pagePlacement(width,height){const scale=Math.min(1600/width,890/height);return {scale,x:(1660-width*scale)/2,y:(950-height*scale)/2};}
export function planFrame(labels,shapes,width,height){
 const numbers=labels.filter(l=>/^(?:[A-Z]?\d{1,3}[A-Z]?)$/i.test(l.text));
 // Some PDF exports embed the complete architectural drawing as one bounded image/path.
 // Crop only when a single substantial drawing contains every table label.
 const drawing=numbers.length&&shapes.filter(b=>b.w*b.h>width*height*.1&&b.w*b.h<width*height*.9&&numbers.every(l=>contains(b,l))).sort((a,b)=>b.w*b.h-a.w*a.h)[0];
 if(!drawing)return {x:0,y:0,w:width,h:height};
 const x=Math.max(0,drawing.x-8),y=Math.max(0,drawing.y-8);
 return {x,y,w:Math.min(width-x,drawing.w+16),h:Math.min(height-y,drawing.h+16)};
}
export function pdfDrawingBounds(list,OPS,viewport){
 let matrix=[1,0,0,1,0,0];const stack=[],result=[];
 for(let i=0;i<list.fnArray.length;i++){
  const op=list.fnArray[i],a=list.argsArray[i];
  if(op===OPS.save)stack.push([...matrix]);
  else if(op===OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0];
  else if(op===OPS.transform)matrix=multiply(matrix,a);
  else if(op===OPS.paintFormXObjectBegin){stack.push([...matrix]);if(a[0])matrix=multiply(matrix,a[0]);}
  else if(op===OPS.paintFormXObjectEnd)matrix=stack.pop()||[1,0,0,1,0,0];
  else if(op===OPS.constructPath&&a[2]?.length===4){
   const [x1,y1,x2,y2]=a[2],m=multiply(viewport.transform,matrix);
   const b=bounds([point(m,x1,y1),point(m,x1,y2),point(m,x2,y1),point(m,x2,y2)]);
   if(b.w>0&&b.h>0&&!result.some(r=>Math.abs(r.x-b.x)<.5&&Math.abs(r.y-b.y)<.5&&Math.abs(r.w-b.w)<.5&&Math.abs(r.h-b.h)<.5))result.push(b);
  }
 }
 return result;
}
export function pdfLabels(items,viewport){
 return items.filter(t=>t.str?.trim()&&t.width>0).map(t=>{
  const m=t.transform,size=Math.hypot(m[0],m[1])||1,ux=m[0]/size,uy=m[1]/size,h=t.height||size;
  const p=point(viewport.transform,m[4]+ux*t.width/2-uy*h*.35,m[5]+uy*t.width/2+ux*h*.35);
  return {text:t.str.trim(),x:p.x,y:p.y,w:t.width*viewport.scale,h:h*viewport.scale};
 });
}
const contains=(b,t)=>t.x>b.x&&t.x<b.x+b.w&&t.y>b.y&&t.y<b.y+b.h;
export function detectPlanTables(labels,shapes,width,height,frame={x:0,y:0,w:width,h:height}){
 const placement=pagePlacement(frame.w,frame.h),areas=labels.map(l=>({...l,area:/^(?:section|area)\s+([ABC])$/i.exec(l.text)?.[1].toUpperCase()||(['Rose City','Azalea Trail','Piney Woods'].find(a=>a.toLowerCase()===l.text.toLowerCase()))})).filter(l=>l.area);
 const found=[];
 for(const l of labels){
  const match=/^(?:(?:table|booth)\s*#?\s*|T\s*[-#]?\s*)?([A-Z]?\d{1,3}[A-Z]?)$/i.exec(l.text);if(!match)continue;
  if(found.some(t=>t.number===match[1]&&Math.hypot(t.source.x-l.x,t.source.y-l.y)<l.h))continue;
  const body=shapes.filter(b=>contains(b,l)&&b.w>=l.w*.9&&b.h>=l.h&&b.w<width*.16&&b.h<height*.16).sort((a,b)=>a.w*a.h-b.w*b.h)[0];
  // Unenclosed numeric labels remain review candidates; dimensions / page numbers can be unchecked.
  const center=body?{x:body.x+body.w/2,y:body.y+body.h/2}:l;
  const prefix=/^([ABC])\d/i.exec(match[1]);
  const area=prefix?.[1].toUpperCase()||areas.toSorted((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0]?.area||'A';
  found.push({number:match[1],area,source:center,body,x:Math.max(30,Math.min(1630,placement.x+(center.x-frame.x)*placement.scale)),y:Math.max(30,Math.min(920,placement.y+(center.y-frame.y)*placement.scale)),capacity:null,kind:/^booth/i.test(l.text)?'booth':'table',orientation:'lr',included:true});
 }
 for(const t of found){
  if(!t.body)continue;
  const b=t.body,short=Math.min(b.w,b.h),near=shapes.filter(s=>{
   const c={x:s.x+s.w/2,y:s.y+s.h/2};
   if(contains(b,c)||s.w>short*.8||s.h>short*.8||Math.min(s.w,s.h)<short*.08)return false;
   const dx=Math.max(b.x-c.x,0,c.x-b.x-b.w),dy=Math.max(b.y-c.y,0,c.y-b.y-b.h);
   if(Math.hypot(dx,dy)>short*.65)return false;
   return found.every(other=>other===t||Math.hypot(c.x-t.source.x,c.y-t.source.y)<Math.hypot(c.x-other.source.x,c.y-other.source.y));
  });
  // Nested outlines are one chair, not two; elongated booth benches do not imply a seat count.
  const chairs=near.filter(s=>!near.some(o=>o!==s&&o.w*o.h>s.w*s.h&&contains(o,{x:s.x+s.w/2,y:s.y+s.h/2})));
  const compact=chairs.filter(s=>Math.max(s.w,s.h)/Math.min(s.w,s.h)<2);
  const explicit=labels.find(l=>/^\d{1,2}\s*(?:seats?|chairs?)$/i.test(l.text)&&contains(b,l));
  if(explicit)t.capacity=Number.parseInt(explicit.text,10);
  else if(compact.length>=2&&compact.length<=20&&compact.length===chairs.length)t.capacity=compact.length;
  else if(chairs.length===2)t.kind='booth';
  const lr=chairs.filter(s=>s.x+s.w/2<b.x||s.x+s.w/2>b.x+b.w).length;
  t.orientation=lr>=chairs.length/2?'lr':'tb';
 }
 return found.map(({source,body,...table})=>table);
}
