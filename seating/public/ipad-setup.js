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
 if(setup.local){
  const certificate=new URL(setup.certificateUrl);if(certificate.protocol!=='http:'||certificate.hostname!==app.hostname||certificate.port!=='8081')throw Error('Check the restaurant certificate address with an administrator.');
  $('certificate').href=certificate.href;
 }else{
  $('certificate-step').hidden=true;$('offline-note').hidden=true;
  $('network-note').textContent='Connect this iPad to Wi-Fi with internet access. This restaurant uses cloud seating.';
  $('signin-note').textContent='Open the app below and sign in with your cloud email and password. Internet access is required.';
  $('signin-number').textContent='2';$('shortcut-number').textContent='3';
 }
 $('steps').hidden=false;
}catch(error){$('restaurant').textContent='Setup needs attention';$('error').textContent=error.message;$('error').hidden=false;}
