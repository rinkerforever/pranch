export function readyTracker(acknowledged=[]){
 let ack=new Set(acknowledged);
 return {update(rows){const ready=rows.filter(r=>r.estimate?.ready),ids=new Set(ready.map(r=>r.party.id));ack=new Set([...ack].filter(id=>ids.has(id)));return ready.filter(r=>!ack.has(r.party.id));},acknowledge(rows){for(const r of rows.filter(r=>r.estimate?.ready))ack.add(r.party.id);return [...ack];},saved:()=>[...ack]};
}
