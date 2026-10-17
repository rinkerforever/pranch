// Client-only display. Use the same dining estimate as the waiting-list planner.
export function diningProgress(table, estimate, now=Date.now()) {
 if(table.status!=='in_use'||!Number.isFinite(table.seatedAt)||table.seatedAt<=0||!Number.isFinite(estimate)||estimate<=0)return null;
 const elapsed=Math.max(0,Math.floor((now-table.seatedAt)/60000));
 const overdue=Math.max(0,elapsed-estimate);
 return {elapsed,estimate,overdue,percent:Math.min(100,elapsed/estimate*100),
  short:overdue?`${overdue}m over`:`${elapsed} / ${estimate}m`,
  description:`${elapsed} min seated · ${overdue?`${overdue} min past estimate`:`~${estimate-elapsed} min remaining`} · ${estimate}-minute estimate`};
}
