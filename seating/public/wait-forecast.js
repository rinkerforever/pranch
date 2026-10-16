import {planWaitlist} from './wait-plan.js';

export function forecastWindow(estimate,now=Date.now()){
 if(!estimate||!Number.isFinite(estimate.minutes))return null;
 const lower=estimate.ready?0:Math.max(5,Math.floor((estimate.minutes-5)/5)*5);
 const upper=estimate.ready?5:Math.max(lower+10,Math.ceil((estimate.minutes+10)/5)*5);
 return {earliestAt:now+lower*60000,latestAt:now+upper*60000,lower,upper};
}
// Record once, with the same queue and clock used for the seating decision.
// Existing parties without a quote must never be given an invented historical estimate.
export function quoteForParty(state,party,now){
 const estimate=planWaitlist(state,now).rows.find(r=>r.party.id===party.id)?.estimate;
 const window=forecastWindow(estimate,now);
 return {recordedAt:now,partySize:party.size,...(window?{earliestAt:window.earliestAt,latestAt:window.latestAt}:{}),tableIds:estimate?.tables.map(t=>t.id)||[]};
}
export function guestForecast(party,estimate,now=Date.now()){
 const quote=party.waitQuote,original=quote&&Number.isFinite(quote.earliestAt)&&Number.isFinite(quote.latestAt)&&quote.latestAt>=quote.earliestAt?quote:null;
 const pastEstimate=!!original&&party.status==='waiting'&&now>original.latestAt;
 return {original,current:forecastWindow(estimate,now),pastEstimate,pastMinutes:pastEstimate?Math.max(1,Math.floor((now-original.latestAt)/60000)):0,waitedMinutes:Math.max(0,Math.floor((now-party.arrivedAt)/60000))};
}
