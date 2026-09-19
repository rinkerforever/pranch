const $ = (id) => document.getElementById(id);
const tokenKey = 'pranch-cloud-access';
async function call(path, options = {}) {
  const token = sessionStorage.getItem(tokenKey);
  const headers = { ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body) headers['content-type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function signedOut() { sessionStorage.removeItem(tokenKey); $('login-card').classList.remove('hidden'); $('app-card').classList.add('hidden'); }
async function loadApp() {
  try {
    const [{ profile }, { locations }] = await Promise.all([call('/api/session'), call('/api/locations')]);
    $('identity').textContent = `${profile.display_name || profile.email} · ${profile.global_role.replaceAll('_', ' ')}`;
    $('locations').replaceChildren(...locations.map((item) => {
      const row = document.createElement('div'); row.className = 'location';
      const name = document.createElement('strong'); name.textContent = item.name;
      const detail = document.createElement('span'); detail.textContent = item.slug;
      row.append(name, detail); return row;
    }));
    $('login-card').classList.add('hidden'); $('app-card').classList.remove('hidden');
  } catch { signedOut(); }
}
$('login').addEventListener('submit', async (event) => {
  event.preventDefault(); $('message').textContent = 'Signing in…';
  try {
    const result = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('email').value, password: $('password').value }) });
    sessionStorage.setItem(tokenKey, result.access_token); $('password').value = ''; $('message').textContent = ''; await loadApp();
  } catch (error) { $('message').textContent = error.message; }
});
$('logout').addEventListener('click', signedOut);
$('password-setup').addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = $('new-password').value;
  $('password-message').textContent = 'Saving password…';
  if (password !== $('confirm-password').value) {
    $('password-message').textContent = 'The passwords do not match.'; return;
  }
  try {
    await call('/api/auth/password', { method: 'POST', body: JSON.stringify({ password }) });
    history.replaceState(null, '', '/');
    $('new-password').value = ''; $('confirm-password').value = '';
    $('password-card').classList.add('hidden');
    await loadApp();
  } catch (error) { $('password-message').textContent = error.message; }
});
call('/api/health').then((health) => { $('status').textContent = health.authConfigured ? 'Cloud service online' : 'Cloud service online · authentication setup pending'; }).catch(() => { $('status').textContent = 'Cloud service unavailable'; });
const invite = new URLSearchParams(location.hash.slice(1));
const inviteToken = invite.get('access_token');
const inviteType = invite.get('type');
if (invite.get('error_description')) {
  $('message').textContent = invite.get('error_description');
  history.replaceState(null, '', '/');
} else if (inviteToken && (inviteType === 'invite' || inviteType === 'recovery')) {
  sessionStorage.setItem(tokenKey, inviteToken);
  $('login-card').classList.add('hidden'); $('app-card').classList.add('hidden'); $('password-card').classList.remove('hidden');
  if (inviteType === 'recovery') $('password-title').textContent = 'Reset your password';
} else if (sessionStorage.getItem(tokenKey)) loadApp();
