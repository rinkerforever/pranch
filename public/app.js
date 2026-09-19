const $ = (id) => document.getElementById(id);
const tokenKey = 'pranch-cloud-access';
let currentLocation = null;
async function call(path, options = {}) {
  const token = sessionStorage.getItem(tokenKey); const headers = { ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body) headers['content-type'] = 'application/json';
  const response = await fetch(path, { ...options, headers }); const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Request failed.'); error.status = response.status; throw error; } return data;
}
function signedOut() { sessionStorage.removeItem(tokenKey); currentLocation = null; $('login-card').classList.remove('hidden'); $('password-card').classList.add('hidden'); $('app-card').classList.add('hidden'); }
function sourceLabel(value) { return ({ menu:'Menu', ads:'Ads', funzone:'Funzone Ads', media:'Uploaded Media' })[value] || value; }
function isOnline(value) { return value && Date.now() - new Date(`${value.replace(' ', 'T')}Z`).getTime() < 120000; }
async function loadLocation(id) {
  const data = await call(`/api/locations/${encodeURIComponent(id)}`); currentLocation = data.location.id;
  $('location-role').textContent = data.role.replaceAll('_', ' ');
  $('menu-url').value = data.pages.menu_url; $('ads-url').value = data.pages.ads_url; $('funzone-url').value = data.pages.funzone_url;
  renderDisplays(data.displays);
}
function renderDisplays(displays) {
  if (!displays.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.innerHTML = '<strong>No displays paired</strong><span>Choose Pair display, then enter the six-digit code on a Raspberry Pi.</span>'; $('displays').replaceChildren(empty); return; }
  $('displays').replaceChildren(...displays.map((display) => {
    const card = document.createElement('article'); card.className = 'display';
    const top = document.createElement('div'); top.className = 'row'; const title = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = display.name;
    const state = document.createElement('span'); state.className = `status ${isOnline(display.last_seen) ? 'online' : ''}`; state.textContent = display.pending ? 'Waiting to pair' : (isOnline(display.last_seen) ? 'Online' : 'Offline');
    title.append(name, state); top.append(title);
    const select = document.createElement('select'); select.setAttribute('aria-label', `Content for ${display.name}`);
    ['menu','ads','funzone','media'].forEach((value) => { const option = new Option(sourceLabel(value), value); option.selected = display.desired_source === value; select.add(option); });
    const apply = document.createElement('button'); apply.className = 'small'; apply.textContent = 'Apply';
    apply.onclick = async () => { apply.disabled = true; try { await call(`/api/locations/${encodeURIComponent(currentLocation)}/displays/${encodeURIComponent(display.id)}`, { method:'PATCH', body:JSON.stringify({ desired_source:select.value }) }); apply.textContent = 'Applied'; setTimeout(() => { apply.textContent = 'Apply'; apply.disabled = false; }, 1200); } catch (error) { alert(error.message); apply.disabled = false; } };
    const controls = document.createElement('div'); controls.className = 'display-controls'; controls.append(select, apply);
    const detail = document.createElement('small'); detail.textContent = display.reported_source ? `TV reports: ${sourceLabel(display.reported_source)}` : 'Waiting for a status report from the Pi';
    card.append(top, controls, detail); return card;
  }));
}
async function loadApp() {
  try {
    const [{ profile }, { locations }] = await Promise.all([call('/api/session'), call('/api/locations')]);
    $('identity').textContent = profile.display_name || profile.email;
    $('location-select').replaceChildren(...locations.map((location) => new Option(location.name, location.id)));
    $('login-card').classList.add('hidden'); $('password-card').classList.add('hidden'); $('app-card').classList.remove('hidden');
    if (locations.length) await loadLocation(currentLocation && locations.some((item) => item.id === currentLocation) ? currentLocation : locations[0].id);
  } catch (error) {
    if (error.status === 401) signedOut();
    else { $('login-card').classList.add('hidden'); $('app-card').classList.remove('hidden'); $('status').textContent = `Dashboard error: ${error.message}`; }
  }
}
$('login').addEventListener('submit', async (event) => { event.preventDefault(); $('message').textContent = 'Signing in…'; try { const result = await call('/api/auth/login', { method:'POST', body:JSON.stringify({ email:$('email').value, password:$('password').value }) }); sessionStorage.setItem(tokenKey, result.access_token); $('password').value = ''; $('message').textContent = ''; await loadApp(); } catch (error) { $('message').textContent = error.message; } });
$('logout').addEventListener('click', signedOut);
$('location-select').addEventListener('change', () => loadLocation($('location-select').value).catch((error) => alert(error.message)));
document.querySelectorAll('.tabs button').forEach((button) => button.onclick = () => { document.querySelectorAll('.tabs button').forEach((item) => item.classList.toggle('active', item === button)); document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('hidden', panel.id !== button.dataset.panel)); });
$('pages-form').addEventListener('submit', async (event) => { event.preventDefault(); $('pages-message').textContent = 'Saving…'; try { await call(`/api/locations/${encodeURIComponent(currentLocation)}/pages`, { method:'PUT', body:JSON.stringify({ menu_url:$('menu-url').value, ads_url:$('ads-url').value, funzone_url:$('funzone-url').value }) }); $('pages-message').textContent = 'Page settings saved.'; } catch (error) { $('pages-message').textContent = error.message; } });
$('add-display').addEventListener('click', async () => { const name = prompt('Name this TV display (for example, Dining Room Menu)'); if (!name) return; try { const result = await call(`/api/locations/${encodeURIComponent(currentLocation)}/displays`, { method:'POST', body:JSON.stringify({ name }) }); $('pair-result').classList.remove('hidden'); $('pair-result').textContent = `Pairing code: ${result.pairing_code}. Enter it on the Raspberry Pi within 15 minutes.`; await loadLocation(currentLocation); } catch (error) { alert(error.message); } });
$('password-setup').addEventListener('submit', async (event) => { event.preventDefault(); const password = $('new-password').value; $('password-message').textContent = 'Saving password…'; if (password !== $('confirm-password').value) { $('password-message').textContent = 'The passwords do not match.'; return; } try { await call('/api/auth/password', { method:'POST', body:JSON.stringify({ password }) }); history.replaceState(null, '', '/'); $('new-password').value = ''; $('confirm-password').value = ''; await loadApp(); } catch (error) { $('password-message').textContent = error.message; } });
call('/api/health').then((health) => { $('status').textContent = health.authConfigured ? 'Cloud service online' : 'Cloud service online · authentication setup pending'; }).catch(() => { $('status').textContent = 'Cloud service unavailable'; });
const invite = new URLSearchParams(location.hash.slice(1)); const inviteToken = invite.get('access_token'); const inviteType = invite.get('type');
if (invite.get('error_description')) { $('message').textContent = invite.get('error_description'); history.replaceState(null, '', '/'); }
else if (inviteToken && (inviteType === 'invite' || inviteType === 'recovery')) { sessionStorage.setItem(tokenKey, inviteToken); $('login-card').classList.add('hidden'); $('password-card').classList.remove('hidden'); if (inviteType === 'recovery') $('password-title').textContent = 'Reset your password'; }
else if (sessionStorage.getItem(tokenKey)) loadApp();
