// The device's server determines Local/Cloud, even when cloud data is relayed to a Pi.
export function connectionIndicator({mode='cloud',confirmedAt=0,reachable=false,connection,preview=false,now=Date.now()}){
 const source=mode==='local'?'Local':'Cloud';
 if(preview)return {tone:'checking',label:'Preview',message:'Sample data in this browser.'};
 if(!confirmedAt&&reachable)return {tone:'checking',label:`${source} · Connecting`,message:'Waiting for a confirmed seating connection.'};
 if(!reachable||now-confirmedAt>(mode==='local'?15000:30000))return {tone:'error',label:`${source} · Disconnected`,message:'Cannot confirm the seating connection. Changes are paused.'};
 if(connection?.requiresRecovery)return {tone:'error',label:`${source} · Recovery needed`,message:'Seating changes are paused. Contact your administrator.'};
 if(connection?.mode==='local'&&!connection.online)return mode==='local'
  ?{tone:'warning',label:'Local · Internet offline',message:'Local seating works. Cloud sync and guest QR check-in are paused.'}
  :{tone:'error',label:'Cloud · Restaurant offline',message:'The website is reachable, but the restaurant Pi is offline. Seating changes and guest QR check-in are paused.'};
 return {tone:'connected',label:`${source} · Connected`,message:mode==='local'?'Connected directly to the restaurant Pi. Cloud sync is online.':'Connected through the internet.'};
}
