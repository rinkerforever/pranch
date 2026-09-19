const $ = (id) => document.getElementById(id);
const tokenKey = 'pranch-cloud-access';
let currentLocation = null;
let currentPages = { custom_pages:[] };
let allLocations = [];
let currentProfile = null;
let invitationsConfigured = false;
async function call(path, options = {}) {
  const token = sessionStorage.getItem(tokenKey); const headers = { ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body) headers['content-type'] = 'application/json';
  const response = await fetch(path, { ...options, headers }); const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Request failed.'); error.status = response.status; throw error; } return data;
}
function signedOut() { sessionStorage.removeItem(tokenKey); currentLocation = null; $('login-card').classList.remove('hidden'); $('password-card').classList.add('hidden'); $('app-card').classList.add('hidden'); }
function sourceLabel(value) { if (value.startsWith('custom:')) return currentPages.custom_pages.find((page) => `custom:${page.id}` === value)?.name || 'Custom page'; return ({ menu:'Menu', ads:'Ads', funzone:'Funzone Ads', media:'Uploaded Media' })[value] || value; }
function isOnline(value) { return value && Date.now() - new Date(`${value.replace(' ', 'T')}Z`).getTime() < 120000; }
async function loadLocation(id) {
  const data = await call(`/api/locations/${encodeURIComponent(id)}`); currentLocation = data.location.id;
  $('location-role').textContent = data.role.replaceAll('_', ' '); currentPages = { ...data.pages, custom_pages:data.pages.custom_pages || [] };
  $('menu-url').value = data.pages.menu_url; $('ads-url').value = data.pages.ads_url; $('funzone-url').value = data.pages.funzone_url;
  renderCustomPages(); renderDisplays(data.displays);
}
function renderCustomPages() {
  $('custom-pages').replaceChildren(...currentPages.custom_pages.map((page) => {
    const row = document.createElement('div'); row.className = 'custom-page'; row.dataset.id = page.id;
    const name = document.createElement('label'); name.textContent = 'Page name'; const nameInput = document.createElement('input'); nameInput.required = true; nameInput.maxLength = 80; nameInput.value = page.name; nameInput.oninput = () => { page.name = nameInput.value; }; name.append(nameInput);
    const url = document.createElement('label'); url.textContent = 'HTTPS address'; const urlInput = document.createElement('input'); urlInput.type = 'url'; urlInput.required = true; urlInput.value = page.url; urlInput.oninput = () => { page.url = urlInput.value; }; url.append(urlInput);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet small'; remove.textContent = 'Remove'; remove.onclick = () => { currentPages.custom_pages = currentPages.custom_pages.filter((item) => item.id !== page.id); renderCustomPages(); };
    row.append(name,url,remove); return row;
  }));
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
    ['menu','ads','funzone','media',...currentPages.custom_pages.map((page) => `custom:${page.id}`)].forEach((value) => { const option = new Option(sourceLabel(value), value); option.selected = display.desired_source === value; select.add(option); });
    const apply = document.createElement('button'); apply.className = 'small'; apply.textContent = 'Apply';
    apply.onclick = async () => { apply.disabled = true; try { await call(`/api/locations/${encodeURIComponent(currentLocation)}/displays/${encodeURIComponent(display.id)}`, { method:'PATCH', body:JSON.stringify({ desired_source:select.value }) }); apply.textContent = 'Applied'; setTimeout(() => { apply.textContent = 'Apply'; apply.disabled = false; }, 1200); } catch (error) { alert(error.message); apply.disabled = false; } };
    const controls = document.createElement('div'); controls.className = 'display-controls'; controls.append(select, apply);
    const detail = document.createElement('small'); detail.textContent = display.reported_source ? `TV reports: ${sourceLabel(display.reported_source)}` : 'Waiting for a status report from the Pi';
    card.append(top, controls, detail); return card;
  }));
}
async function loadApp() {
  try {
    const [{ profile, userInvitesConfigured }, { locations }] = await Promise.all([call('/api/session'), call('/api/locations')]);
    currentProfile = profile; allLocations = locations; invitationsConfigured = userInvitesConfigured;
    $('identity').textContent = profile.display_name || profile.email;
    $('location-select').replaceChildren(...locations.map((location) => new Option(location.name, location.id)));
    $('login-card').classList.add('hidden'); $('password-card').classList.add('hidden'); $('app-card').classList.remove('hidden');
    $('add-location').classList.toggle('hidden',profile.global_role !== 'system_admin'); $('add-user').classList.toggle('hidden',profile.global_role !== 'system_admin');
    if (locations.length) await loadLocation(currentLocation && locations.some((item) => item.id === currentLocation) ? currentLocation : locations[0].id);
    if (profile.global_role === 'system_admin') await loadUsers();
  } catch (error) {
    if (error.status === 401) signedOut();
    else { $('login-card').classList.add('hidden'); $('app-card').classList.remove('hidden'); $('status').textContent = `Dashboard error: ${error.message}`; }
  }
}

function permissionDefaults(role) { return role === 'location_manager' ? ['manage_displays','manage_pages','manage_content','manage_users'] : role === 'operator' ? ['manage_displays','manage_content'] : []; }
function renderUserLocations(assignments = []) {
  $('user-locations').replaceChildren(...allLocations.map((location) => {
    const saved = assignments.find((item) => item.location_id === location.id); const box = document.createElement('fieldset'); box.className = 'assignment'; box.dataset.locationId = location.id;
    const legend = document.createElement('legend'); const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.className = 'assignment-enabled'; enabled.checked = Boolean(saved); legend.append(enabled,document.createTextNode(` ${location.name}`));
    const roleLabel = document.createElement('label'); roleLabel.textContent = 'Role'; const role = document.createElement('select'); role.className = 'assignment-role'; ['location_manager','operator','viewer'].forEach((value) => role.add(new Option(value.replaceAll('_',' '),value))); role.value = saved?.role || 'operator'; roleLabel.append(role);
    const permissions = document.createElement('div'); permissions.className = 'permission-grid';
    [['manage_displays','Pair/remove displays'],['manage_pages','Edit page addresses'],['manage_content','Change TV content'],['manage_users','Manage location users']].forEach(([value,label]) => { const item = document.createElement('label'); item.className = 'check'; const check = document.createElement('input'); check.type = 'checkbox'; check.value = value; check.checked = (saved?.permissions || permissionDefaults(role.value)).includes(value); item.append(check,document.createTextNode(` ${label}`)); permissions.append(item); });
    role.onchange = () => { const defaults = permissionDefaults(role.value); permissions.querySelectorAll('input').forEach((input) => { input.checked = defaults.includes(input.value); }); };
    const toggle = () => { role.disabled = !enabled.checked; permissions.querySelectorAll('input').forEach((input) => { input.disabled = !enabled.checked; }); }; enabled.onchange = toggle; toggle(); box.append(legend,roleLabel,permissions); return box;
  }));
}
function userAssignments() { return [...document.querySelectorAll('.assignment')].filter((box) => box.querySelector('.assignment-enabled').checked).map((box) => ({ location_id:box.dataset.locationId, role:box.querySelector('.assignment-role').value, permissions:[...box.querySelectorAll('.permission-grid input:checked')].map((input) => input.value) })); }
async function loadUsers() {
  const data = await call('/api/admin/users'); invitationsConfigured = data.invitationsConfigured;
  $('invite-warning').classList.toggle('hidden',invitationsConfigured);
  $('users').replaceChildren(...data.users.map((user) => {
    const row = document.createElement('div'); row.className = 'user-row'; const info = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = user.display_name; const detail = document.createElement('span'); detail.textContent = `${user.email} · ${user.system_admin ? 'system administrator' : `${user.assignments.length} location${user.assignments.length === 1 ? '' : 's'}`} · ${user.active ? 'active' : 'disabled'}`; info.append(name,detail);
    const edit = document.createElement('button'); edit.className = 'quiet small'; edit.textContent = 'Edit'; edit.onclick = () => openUser(user); row.append(info,edit); return row;
  }));
}
function openUser(user = null) {
  $('user-form').reset(); $('user-id').value = user?.id || ''; $('user-title').textContent = user ? 'Edit user' : 'Add user'; $('user-email').value = user?.email || ''; $('user-email').disabled = Boolean(user); $('user-name').value = user?.display_name || ''; $('user-admin').checked = Boolean(user?.system_admin); $('user-active').checked = user ? Boolean(user.active) : true; $('user-message').textContent = '';
  renderUserLocations(user?.assignments || []); $('user-locations').classList.toggle('disabled',$('user-admin').checked); $('user-dialog').showModal();
}
$('login').addEventListener('submit', async (event) => { event.preventDefault(); $('message').textContent = 'Signing in…'; try { const result = await call('/api/auth/login', { method:'POST', body:JSON.stringify({ email:$('email').value, password:$('password').value }) }); sessionStorage.setItem(tokenKey, result.access_token); $('password').value = ''; $('message').textContent = ''; await loadApp(); } catch (error) { $('message').textContent = error.message; } });
$('logout').addEventListener('click', signedOut);
$('location-select').addEventListener('change', () => loadLocation($('location-select').value).catch((error) => alert(error.message)));
document.querySelectorAll('.tabs button').forEach((button) => button.onclick = () => { document.querySelectorAll('.tabs button').forEach((item) => item.classList.toggle('active', item === button)); document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('hidden', panel.id !== button.dataset.panel)); });
$('add-location').addEventListener('click', () => { $('location-form').reset(); $('location-message').textContent = ''; $('location-dialog').showModal(); });
$('location-form').addEventListener('submit', async (event) => { event.preventDefault(); $('location-message').textContent = 'Creating…'; try { const location = await call('/api/locations',{ method:'POST',body:JSON.stringify({ name:$('location-name').value }) }); $('location-dialog').close(); currentLocation = location.id; await loadApp(); } catch (error) { $('location-message').textContent = error.message; } });
$('add-user').addEventListener('click', () => { if (!invitationsConfigured) { $('invite-warning').classList.remove('hidden'); return; } openUser(); });
$('user-admin').addEventListener('change', () => { $('user-locations').classList.toggle('disabled',$('user-admin').checked); });
$('user-form').addEventListener('submit', async (event) => { event.preventDefault(); $('user-message').textContent = 'Saving…'; const id = $('user-id').value; const admin = $('user-admin').checked; const body = { email:$('user-email').value, display_name:$('user-name').value, system_admin:admin, active:$('user-active').checked, assignments:admin ? [] : userAssignments() }; try { await call(id ? `/api/admin/users/${encodeURIComponent(id)}` : '/api/admin/users',{ method:id ? 'PATCH' : 'POST',body:JSON.stringify(body) }); $('user-dialog').close(); await loadUsers(); } catch (error) { $('user-message').textContent = error.message; } });
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click',() => $(button.dataset.close).close()));
$('add-page').addEventListener('click', () => { currentPages.custom_pages.push({ id:crypto.randomUUID(), name:'', url:'https://' }); renderCustomPages(); $('custom-pages').lastElementChild?.querySelector('input')?.focus(); });
$('pages-form').addEventListener('submit', async (event) => { event.preventDefault(); $('pages-message').textContent = 'Saving…'; try { await call(`/api/locations/${encodeURIComponent(currentLocation)}/pages`, { method:'PUT', body:JSON.stringify({ menu_url:$('menu-url').value, ads_url:$('ads-url').value, funzone_url:$('funzone-url').value, custom_pages:currentPages.custom_pages }) }); $('pages-message').textContent = 'Page settings saved.'; await loadLocation(currentLocation); } catch (error) { $('pages-message').textContent = error.message; } });
$('add-display').addEventListener('click', async () => { const name = prompt('Name this TV display (for example, Dining Room Menu)'); if (!name) return; try { const result = await call(`/api/locations/${encodeURIComponent(currentLocation)}/displays`, { method:'POST', body:JSON.stringify({ name }) }); $('pair-result').classList.remove('hidden'); $('pair-result').textContent = `Pairing code: ${result.pairing_code}. Enter it on the Raspberry Pi within 15 minutes.`; await loadLocation(currentLocation); } catch (error) { alert(error.message); } });
$('password-setup').addEventListener('submit', async (event) => { event.preventDefault(); const password = $('new-password').value; $('password-message').textContent = 'Saving password…'; if (password !== $('confirm-password').value) { $('password-message').textContent = 'The passwords do not match.'; return; } try { await call('/api/auth/password', { method:'POST', body:JSON.stringify({ password }) }); history.replaceState(null, '', '/'); $('new-password').value = ''; $('confirm-password').value = ''; await loadApp(); } catch (error) { $('password-message').textContent = error.message; } });
call('/api/health').then((health) => { $('status').textContent = health.authConfigured ? 'Cloud service online' : 'Cloud service online · authentication setup pending'; }).catch(() => { $('status').textContent = 'Cloud service unavailable'; });
const invite = new URLSearchParams(location.hash.slice(1)); const inviteToken = invite.get('access_token'); const inviteType = invite.get('type');
if (invite.get('error_description')) { $('message').textContent = invite.get('error_description'); history.replaceState(null, '', '/'); }
else if (inviteToken && (inviteType === 'invite' || inviteType === 'recovery')) { sessionStorage.setItem(tokenKey, inviteToken); $('login-card').classList.add('hidden'); $('password-card').classList.remove('hidden'); if (inviteType === 'recovery') $('password-title').textContent = 'Reset your password'; }
else if (sessionStorage.getItem(tokenKey)) loadApp();
