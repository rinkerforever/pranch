export function selectTablesForParty(tables,selectedIds,tappedId,partySize){
 const tapped=tables.find(t=>t.id===tappedId);
 if(!tapped)return new Set(selectedIds);
 const group=tapped.group?tables.filter(t=>t.group===tapped.group):[tapped];
 const next=new Set(selectedIds);
 if(group.every(t=>next.has(t.id))){for(const t of group)next.delete(t.id);return next;}
 const capacity=tables.filter(t=>next.has(t.id)).reduce((total,t)=>total+(t.capacity||0),0);
 if(capacity>=partySize)next.clear();
 for(const t of group)next.add(t.id);
 return next;
}
