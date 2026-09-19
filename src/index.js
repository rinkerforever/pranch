const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

const securityHeaders = {
  'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function configured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
}

async function supabaseUser(request, env) {
  if (!configured(env)) return null;
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { authorization, apikey: env.SUPABASE_PUBLISHABLE_KEY },
  });
  if (!response.ok) return null;
  return response.json();
}

async function profileFor(user, env) {
  if (!user) return null;
  const profile = await env.DB.prepare(`
    SELECT id, auth_user_id, email, display_name, system_admin, active
    FROM user_profiles WHERE auth_user_id = ? AND active = 1
  `).bind(user.id).first();
  if (profile) profile.global_role = profile.system_admin ? 'system_admin' : 'location_user';
  return profile;
}

async function requireUser(request, env) {
  const user = await supabaseUser(request, env);
  const profile = await profileFor(user, env);
  return profile ? { user, profile } : null;
}

async function login(request, env) {
  if (!configured(env)) return json({ error: 'Authentication is not configured yet.' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password || password.length > 256) return json({ error: 'Email and password are required.' }, 400);
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: env.SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ email, password }),
  });
  const result = await response.json();
  if (!response.ok) return json({ error: 'The email or password is incorrect.' }, 401);
  const profile = await profileFor(result.user, env);
  if (!profile) return json({ error: 'This account has not been activated for Pizza Ranch.' }, 403);
  return json({ access_token: result.access_token, refresh_token: result.refresh_token,
    expires_in: result.expires_in, profile });
}

async function updatePassword(request, env) {
  if (!configured(env)) return json({ error: 'Authentication is not configured yet.' }, 503);
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'The invitation or reset link is invalid.' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const password = String(body.password || '');
  if (password.length < 12 || password.length > 128) {
    return json({ error: 'Use a password between 12 and 128 characters.' }, 400);
  }
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    method: 'PUT',
    headers: { authorization, apikey: env.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) return json({ error: 'This invitation or reset link has expired. Request a new link.' }, 401);
  const user = await response.json();
  const profile = await profileFor(user, env);
  if (!profile) return json({ error: 'This account has not been activated for Pizza Ranch.' }, 403);
  return json({ profile });
}

async function api(request, env, url) {
  if (url.pathname === '/api/health') {
    return json({ ok: true, service: 'pizza-ranch-control', authConfigured: configured(env) });
  }
  if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(request, env);
  if (url.pathname === '/api/auth/password' && request.method === 'POST') return updatePassword(request, env);
  const session = await requireUser(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (url.pathname === '/api/session') return json({ profile: session.profile });
  if (url.pathname === '/api/locations' && request.method === 'GET') {
    const admin = session.profile.global_role === 'system_admin';
    const query = admin
      ? env.DB.prepare('SELECT id, name, slug, active FROM locations WHERE active=1 ORDER BY name')
      : env.DB.prepare(`SELECT l.id,l.name,l.slug,l.active FROM locations l
          JOIN user_location_roles r ON r.location_id=l.id
          WHERE r.user_id=? AND l.active=1 ORDER BY l.name`).bind(session.user.id);
    return json({ locations: (await query.all()).results || [] });
  }
  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      let response;
      if (url.pathname.startsWith('/api/')) response = await api(request, env, url);
      else response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      console.error(error);
      return json({ error: 'Service temporarily unavailable.' }, 500, securityHeaders);
    }
  },
};
