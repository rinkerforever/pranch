export async function manageStores({api,reload}){
 const d=document.createElement('dialog');
 const title=document.createElement('h2');title.textContent='Manage stores';
 const note=document.createElement('p');note.textContent='Deactivate stores you are not using. This removes them from active store lists across the shared apps and blocks online seating and Party Display access. Saved data stays available for reactivation.';
 const rows=document.createElement('div'),message=document.createElement('p');message.setAttribute('role','status');
 const done=document.createElement('button');done.textContent='Done';done.onclick=()=>d.close();
 let changed=false;
 async function render(){const data=await api('/api/stores');rows.replaceChildren();for(const store of data.stores){const row=document.createElement('div');row.className='room-block';const name=document.createElement('strong');name.textContent=`${store.name} · ${store.active?'Active':'Inactive'}`;const button=document.createElement('button');button.textContent=store.active?'Deactivate store':'Reactivate store';button.onclick=async()=>{
  if(!confirm(store.active?`Deactivate ${store.name}? It will disappear from active store lists. Online seating and Party Display access will stop. Saved data is preserved and you can reactivate it here.`:`Reactivate ${store.name} and restore its availability in the apps?`))return;
  button.disabled=true;try{await api('/api/stores',{method:'POST',body:JSON.stringify({id:store.id,active:!store.active})});changed=true;message.textContent=`${store.name} ${store.active?'deactivated':'reactivated'}.`;await render();}catch(e){message.textContent=e.message;button.disabled=false;}
 };row.append(name,document.createElement('br'),button);rows.append(row);}}
 d.append(title,note,rows,message,done);document.body.append(d);d.showModal();d.onclose=async()=>{d.remove();if(changed)await reload();};
 try{await render();}catch(e){message.textContent=e.message;}
}
