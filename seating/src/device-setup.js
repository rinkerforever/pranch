import {hubRow} from './hub.js';
import {AppError} from './model.js';

// Public onboarding information only. Never include pairing tokens or account details.
export async function deviceSetup(env,id,origin){
 const location=await env.DB.prepare('SELECT id,name FROM locations WHERE id=? AND active=1').bind(id).first();
 if(!location)throw new AppError('Restaurant not found.',404);
 const runtime=env.localRuntime?.(),hub=runtime?null:await hubRow(env,id);
 const localUrl=runtime?.localUrl||(hub?.enabled?hub.local_url:null);
 const cloudUrl=env.publicCloudUrl||origin;
 let appUrl=cloudUrl,setupOrigin=cloudUrl,certificateUrl=null;
 if(localUrl){
  const url=new URL(localUrl);
  if(url.protocol!=='https:'||url.username||url.password)throw new AppError('Ask an administrator to check the local seating address.',503);
  appUrl=url.origin;url.protocol='http:';url.port='8081';
  setupOrigin=url.origin;certificateUrl=setupOrigin+'/seating.mobileconfig';
 }
 return {locationId:id,location:location.name,local:!!localUrl,appUrl,certificateUrl,setupUrl:setupOrigin+'/ipad-setup.html?location='+encodeURIComponent(id)};
}
