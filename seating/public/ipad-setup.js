import {detectSetupPlatform} from './setup-platform.js';
const $=id=>document.getElementById(id);
try{
 const id=new URLSearchParams(location.search).get('location');
 if(!id)throw Error('Open the setup QR from your restaurant’s Layout editor → Settings.');
 const response=await fetch('/api/device-setup/'+encodeURIComponent(id),{cache:'no-store'});
 const setup=await response.json();if(!response.ok)throw Error(setup.error||'Unable to load restaurant setup.');
 // URLs come from the restaurant configuration, never from QR query parameters.
 const app=new URL(setup.appUrl);if(app.protocol!=='https:')throw Error('A secure seating address is required.');
 $('restaurant').textContent=setup.location+' · Staff device setup';
 $('open-app').href=app.href;$('app-address').textContent=app.origin;
 let certificate;
 if(setup.local){
  certificate=new URL(setup.certificateUrl);if(certificate.protocol!=='http:'||certificate.hostname!==app.hostname||certificate.port!=='8081')throw Error('Check the restaurant certificate address with an administrator.');
 }else{
  $('certificate-step').hidden=true;$('offline-note').hidden=true;
  $('network-note').textContent='Connect this tablet to Wi-Fi with internet access. This restaurant uses cloud seating.';
  $('signin-note').textContent='Open the app below and sign in with your cloud email and password. Internet access is required.';
  $('signin-number').textContent='2';$('shortcut-number').textContent='3';
 }
 function showPlatform(){
  const platform=$('device-type').value,apple=platform==='apple',android=platform==='android';
  $('setup-title').textContent=android?'Ready for your Android tablet':apple?'Ready for your iPad or iPhone':'Set up your tablet';
  $('apple-certificate').hidden=!apple;$('android-certificate').hidden=!android;$('choose-certificate').hidden=!!platform;
  $('apple-shortcut').hidden=!apple;$('android-shortcut').hidden=!android;$('choose-shortcut').hidden=!!platform;
  $('certificate').hidden=!platform;
  if(certificate)$('certificate').href=android?new URL('/seating-root.crt',certificate).href:certificate.href;
 }
 $('device-type').value=detectSetupPlatform(navigator);$('device-type').onchange=showPlatform;showPlatform();
 $('steps').hidden=false;
}catch(error){$('restaurant').textContent='Setup needs attention';$('error').textContent=error.message;$('error').hidden=false;}
