// Find the drawing in the original image, before display opacity or cleanup masks.
export function drawingBounds({data,width,height}){
 let left=width,top=height,right=-1,bottom=-1;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4;
  if(data[i+3]>32&&Math.min(data[i],data[i+1],data[i+2])<245){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
 }
 return right<left?null:{x:left,y:top,width:right-left+1,height:bottom-top+1};
}
export function fullPlanBox(bounds,tables=[]){
 if(!bounds)return [0,0,1660,950];
 let left=bounds.x,top=bounds.y,right=left+bounds.width,bottom=top+bounds.height;
 for(const t of tables){
  const across=t.orientation==='tb',long=Math.max(38,Math.ceil((t.capacity||0)/2)*14+7);
  const w=t.kind==='booth'?44:across?long:38,h=t.kind==='booth'?44:across?38:long;
  left=Math.min(left,t.x-w/2-15);right=Math.max(right,t.x+w/2+15);
  top=Math.min(top,t.y-h/2-15);bottom=Math.max(bottom,t.y+h/2+15);
 }
 const padding=16;
 return [left-padding,top-padding,Math.max(120,right-left+2*padding),Math.max(120,bottom-top+2*padding)];
}
