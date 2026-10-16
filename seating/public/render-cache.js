// Retain unchanged nodes so focus, image decoding and pointer handlers survive updates.
const lists=new WeakMap();
export function keyedChildren(parent,items,key,signature,build){
 const previous=lists.get(parent)||new Map(),next=new Map();let index=0;
 for(const item of items){
  const id=key(item),stamp=signature(item),old=previous.get(id);
  const entry=old?.stamp===stamp?old:{stamp,node:build(item)};
  next.set(id,entry);
  if(parent.children[index]!==entry.node)parent.insertBefore(entry.node,parent.children[index]||null);
  index++;
 }
 const retained=new Set([...next.values()].map(e=>e.node));
 for(const child of [...parent.children])if(!retained.has(child))child.remove();
 lists.set(parent,next);
}
export function floorImageUrl(endpoint,background,demo=false){
 return demo?background.dataUrl:endpoint+'?image='+encodeURIComponent(background.key||'');
}
