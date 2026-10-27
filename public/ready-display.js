(() => {
  const params=new URLSearchParams(location.hash.slice(1));
  const key=params.get('key'),id=params.get('location');
  const menu=document.getElementById('menu'),banner=document.getElementById('ready'),cards=document.getElementById('parties');
  let source;
  try {source=new URL(params.get('source'));if(source.protocol!=='https:'||source.username||source.password||source.pathname==='/ready-display.html')throw Error();}
  catch {menu.hidden=true;document.getElementById('error').hidden=false;return;}
  menu.src=source.href;
  let parties=[],offset=0,lastSuccess=0,signature='',stopped=false;
  function hide(){parties=[];banner.hidden=true;cards.replaceChildren();}
  function render(){
    if(!parties.length||performance.now()-lastSuccess>15000){hide();return;}
    cards.replaceChildren();
    for(const p of parties.slice(offset,offset+2)){
      const card=document.createElement('div'),name=document.createElement('strong'),size=document.createElement('span');
      card.className='party';name.textContent=p.name;size.textContent=`Party of ${p.size}`;card.append(name,size);cards.append(card);
    }
    banner.hidden=false;
  }
  async function poll(){
    if(!key||!id||stopped)return;
    try{
      const response=await fetch(`/api/ready-overlay?location=${encodeURIComponent(id)}`,{headers:{'x-ready-overlay-key':key},cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(8000)});
      if(!response.ok){if([403,404].includes(response.status))stopped=true;throw Error();}
      const data=await response.json();if(!Array.isArray(data.parties))throw Error();
      const next=JSON.stringify(data.parties);if(next!==signature){signature=next;offset=0;}
      parties=data.parties;lastSuccess=performance.now();render();
    }catch{hide();}
    finally{if(!stopped)setTimeout(poll,3000);}
  }
  window.addEventListener('offline',hide);
  setInterval(()=>{if(parties.length){offset=(offset+2)%parties.length;render();}},7000);
  setInterval(()=>{if(performance.now()-lastSuccess>15000)hide();},1000);
  poll();
})();
