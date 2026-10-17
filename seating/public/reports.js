// Event-driven aggregates: no background writes, guest names, or extra polling.
const HALF_HOUR=1800000,DAY=86400000,RETENTION=31;
const formatters=new Map();
export function reportClock(time,zone='America/Chicago'){
 if(!formatters.has(zone))formatters.set(zone,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
 const p=Object.fromEntries(formatters.get(zone).formatToParts(time).map(p=>[p.type,p.value]));
 return {date:`${p.year}-${p.month}-${p.day}`,slot:Number(p.hour)*2+(Number(p.minute)>=30?1:0)};
}
export function seatOccupancy(state){
 const seated=state.tables.filter(t=>t.status==='in_use'),parties=new Map(state.parties.map(p=>[p.id,p]));
 const seen=new Set();let guests=0,estimated=0;
 for(const t of seated){
  const p=parties.get(t.party);
  if(p?.status==='seated'&&Number.isFinite(p.size)){if(!seen.has(p.id)){guests+=p.size;seen.add(p.id);}}
  else estimated+=Number(t.capacity)||0;
 }
 return {seats:guests+estimated,known:guests,estimated,capacity:state.tables.reduce((n,t)=>n+(Number(t.capacity)||0),0),unknownCapacity:state.tables.filter(t=>!t.capacity).length};
}
const dayRow=()=>({metrics:{},slots:{}});
function addInterval(report,start,end,occupancy){
 start=Math.max(start,end-RETENTION*DAY);
 while(start<end){
  const finish=Math.min(end,(Math.floor(start/HALF_HOUR)+1)*HALF_HOUR),dt=finish-start,{date,slot}=reportClock(start,report.zone);
  const day=report.days[date]??=dayRow(),v=day.slots[slot]??=[0,0,0,0,0,0];
  // observed milliseconds, occupied seat-ms, capacity seat-ms, estimated seat-ms,
  // peak simultaneous seats, milliseconds with unknown table capacities.
  v[0]+=dt;v[1]+=occupancy.seats*dt;v[2]+=occupancy.capacity*dt;v[3]+=occupancy.estimated*dt;v[4]=Math.max(v[4],occupancy.seats);v[5]+=occupancy.unknownCapacity?dt:0;
  start=finish;
 }
}
function trim(report,now){
 const oldest=reportClock(now-(RETENTION-1)*DAY,report.zone).date;
 for(const date of Object.keys(report.days))if(date<oldest)delete report.days[date];
}
const add=(metrics,key,value=1)=>{metrics[key]=(metrics[key]||0)+value;};
function metricChanges(before,after,now){
 const m={},previous=new Map(before.parties.map(p=>[p.id,p]));
 for(const p of after.parties){
  const old=previous.get(p.id);
  if(p.status==='seated'&&old?.status!=='seated'){
   add(m,'seatedParties');add(m,'seatedGuests',p.size);
   if(p.source!=='seat-now'&&(old?.status==='waiting'||old?.waitQuote)){
    add(m,'waitCount');add(m,'waitMinutes',Math.max(0,(now-p.arrivedAt)/60000));
    if(Number.isFinite(p.waitQuote?.latestAt)){add(m,'quoteCount');if(now<=p.waitQuote.latestAt)add(m,'quoteMet');else add(m,'lateMinutes',(now-p.waitQuote.latestAt)/60000);}
   }
  }
  if(p.status==='completed'&&old?.status==='seated'&&Number.isFinite(old.seatedAt)){add(m,'diningCount');add(m,'diningMinutes',Math.max(0,(now-old.seatedAt)/60000));}
  if(p.status==='cancelled'&&old?.status==='waiting'){add(m,'leftParties');add(m,'leftGuests',p.size);}
 }
 const tables=new Map(after.tables.map(t=>[t.id,t])),visits=new Set();
 for(const t of before.tables){
  const next=tables.get(t.id);if(!next)continue;
  if(t.status==='cleaning'&&next.status==='open'&&Number.isFinite(t.cleaningAt)){add(m,'cleaningCount');add(m,'cleaningMinutes',Math.max(0,(now-t.cleaningAt)/60000));}
  if(t.status==='in_use'&&next.status!=='in_use'&&!t.party&&Number.isFinite(t.seatedAt)){
   const key=(t.group||t.id)+':'+t.seatedAt;if(!visits.has(key)){visits.add(key);add(m,'diningCount');add(m,'diningMinutes',Math.max(0,(now-t.seatedAt)/60000));}
  }
 }
 return m;
}
export function recordReport(before,after,action,now){
 const report=structuredClone(before.reporting||{version:1,zone:'America/Chicago',startedAt:now,cursor:now,days:{}});
 if(now<report.cursor)return null; // Never integrate a clock rollback twice.
 // Undo is only possible for the latest action. Correct that interval using
 // the restored occupancy, rather than keeping an accidental seating spike.
 const undo=action.type==='undo'?before.lastUndo?.reportDelta:null;
 addInterval(report,report.cursor,now,seatOccupancy(action.type==='undo'?after:before));
 let delta;
 if(action.type==='undo'){
  const day=undo&&report.days[undo.date];if(day)for(const [k,v] of Object.entries(undo.metrics))day.metrics[k]=(day.metrics[k]||0)-v;
 }else{
  const date=reportClock(now,report.zone).date,metrics=metricChanges(before,after,now);
  const day=report.days[date]??=dayRow();for(const [k,v] of Object.entries(metrics))add(day.metrics,k,v);
  delta={date,metrics};
 }
 report.cursor=now;trim(report,now);after.reporting=report;return delta;
}
export function reportView(state,date,from=0,to=24,now=Date.now()){
 const report=state.reporting?structuredClone(state.reporting):null,current=seatOccupancy(state);
 if(report){addInterval(report,report.cursor,now,current);trim(report,now);}
 const day=report?.days[date],metrics=day?.metrics||{},hours=[];
 for(let hour=from;hour<to;hour++){
  const values=[day?.slots[hour*2],day?.slots[hour*2+1]].filter(Boolean),v=[0,0,0,0,0,0];
  for(const item of values)for(let i=0;i<v.length;i++)v[i]=i===4?Math.max(v[i],item[i]):v[i]+item[i];
  hours.push({hour,observedMs:v[0],seatMs:v[1],capacityMs:v[2],estimatedMs:v[3],peakSeats:v[4],unknownMs:v[5],percent:v[2]>0?100*v[1]/v[2]:null,averageSeats:v[0]>0?v[1]/v[0]:null});
 }
 const total=key=>hours.reduce((n,h)=>n+h[key],0),observed=total('observedMs'),capacity=total('capacityMs');
 const peak=hours.filter(h=>h.percent!==null).sort((a,b)=>b.percent-a.percent||a.hour-b.hour)[0]||null;
 return {date,zone:report?.zone||'America/Chicago',startedAt:report?.startedAt??null,metrics,hours,current,averagePercent:capacity?100*total('seatMs')/capacity:null,averageSeats:observed?total('seatMs')/observed:null,observedMs:observed,estimated:total('estimatedMs')>0,unknownCapacity:total('unknownMs')>0,peak};
}
