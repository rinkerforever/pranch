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
call('/api/health').then((health) => { $('status').textContent = health.authConfigured ? 'Cloud service online' : 'Cloud service online · authentication setup pending'; }).catch(() => { $('status').textContent = 'Cloud service unavailable'; });
if (sessionStorage.getItem(tokenKey)) loadApp();
