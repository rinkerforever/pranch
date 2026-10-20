// Background reads only; seating writes always run immediately.
export function adaptiveSync(start=Date.now()){
 let lastActivity=start,next=0;
 const idle=now=>now-lastActivity>=90000;
 return {
  activity(now=Date.now()){const waking=idle(now);lastActivity=now;if(waking)next=0;return waking;},
  due(now,mode){if(now<next)return false;next=now+(idle(now)?10000:mode==='local'?5000:2000);return true;},
  resume(now=Date.now()){lastActivity=now;next=0;}
 };
}
