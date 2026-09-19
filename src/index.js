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

const SOURCES = ['menu', 'ads', 'funzone', 'media'];
let schemaReady;

function ensureSchema(env) {
  if (!schemaReady) schemaReady = env.DB.exec(`
    CREATE TABLE IF NOT EXISTS location_pages (
      location_id TEXT PRIMARY KEY, menu_url TEXT NOT NULL, ads_url TEXT NOT NULL,
      funzone_url TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS displays (
      id TEXT PRIMARY KEY, location_id TEXT NOT NULL, name TEXT NOT NULL,
      desired_source TEXT NOT NULL DEFAULT 'menu', reported_source TEXT,
      pairing_code TEXT, pairing_expires_at TEXT, device_token_hash TEXT,
      last_seen TEXT, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS displays_location_idx ON displays(location_id);
  `);
  return schemaReady;
}

const pageDefaults = {
  menu_url: 'https://green-forest-07f346210.6.azurestaticapps.net/8300?type=menu-only',
  ads_url: 'https://green-forest-07f346210.6.azurestaticapps.net/8300?type=ads-only',
  funzone_url: 'https://green-forest-07f346210.6.azurestaticapps.net/8300?type=funzone-ads',
};

function validPageUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

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

async function locationRole(session, locationId, env) {
  if (session.profile.global_role === 'system_admin') return 'system_admin';
  const row = await env.DB.prepare('SELECT * FROM user_location_roles WHERE user_id=? AND location_id=?')
    .bind(session.user.id, locationId).first();
  return row?.role || null;
}

async function locationSnapshot(session, locationId, env) {
  const role = await locationRole(session, locationId, env);
  if (!role) return null;
  await ensureSchema(env);
  const location = await env.DB.prepare('SELECT id,name,slug,active FROM locations WHERE id=? AND active=1').bind(locationId).first();
  if (!location) return null;
  let pages = await env.DB.prepare('SELECT menu_url,ads_url,funzone_url,updated_at FROM location_pages WHERE location_id=?').bind(locationId).first();
  if (!pages) {
    pages = pageDefaults;
    await env.DB.prepare('INSERT INTO location_pages(location_id,menu_url,ads_url,funzone_url) VALUES(?,?,?,?)')
      .bind(locationId, pages.menu_url, pages.ads_url, pages.funzone_url).run();
  }
  const displays = (await env.DB.prepare(`SELECT id,name,desired_source,reported_source,last_seen,
    CASE WHEN pairing_code IS NOT NULL AND pairing_expires_at > CURRENT_TIMESTAMP THEN 1 ELSE 0 END pending
    FROM displays WHERE location_id=? AND active=1 ORDER BY name`).bind(locationId).all()).results || [];
  return { location, role, pages, displays };
}

async function deviceApi(request, env, url) {
  await ensureSchema(env);
  if (url.pathname === '/api/device/pair' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
    const code = String(body.code || '').replace(/\D/g, '');
    const row = await env.DB.prepare(`SELECT id,location_id FROM displays
      WHERE pairing_code=? AND pairing_expires_at > CURRENT_TIMESTAMP AND active=1`).bind(code).first();
    if (!row) return json({ error: 'Pairing code is invalid or expired.' }, 400);
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
    await env.DB.prepare(`UPDATE displays SET device_token_hash=?,pairing_code=NULL,pairing_expires_at=NULL,last_seen=CURRENT_TIMESTAMP
      WHERE id=?`).bind(await sha256(token), row.id).run();
    return json({ device_id: row.id, device_token: token, location_id: row.location_id });
  }
  const token = (request.headers.get('authorization') || '').replace(/^Device\s+/i, '');
  if (!token) return json({ error: 'Device authentication required.' }, 401);
  const display = await env.DB.prepare('SELECT * FROM displays WHERE device_token_hash=? AND active=1').bind(await sha256(token)).first();
  if (!display) return json({ error: 'Device authentication failed.' }, 401);
  if (url.pathname === '/api/device/state' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
    const reported = SOURCES.includes(body.reported_source) ? body.reported_source : display.reported_source;
    await env.DB.prepare('UPDATE displays SET reported_source=?,last_seen=CURRENT_TIMESTAMP WHERE id=?').bind(reported, display.id).run();
  }
  if (url.pathname === '/api/device/state') {
    const pages = await env.DB.prepare('SELECT menu_url,ads_url,funzone_url FROM location_pages WHERE location_id=?').bind(display.location_id).first();
    return json({ device_id: display.id, location_id: display.location_id, desired_source: display.desired_source, pages: pages || pageDefaults });
  }
  return json({ error: 'Not found.' }, 404);
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
  if (url.pathname.startsWith('/api/device/')) return deviceApi(request, env, url);
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
  const match = url.pathname.match(/^\/api\/locations\/([^/]+)(?:\/(pages|displays))?(?:\/([^/]+))?$/);
  if (match) {
    const locationId = decodeURIComponent(match[1]);
    const section = match[2]; const itemId = match[3] && decodeURIComponent(match[3]);
    const role = await locationRole(session, locationId, env);
    if (!role) return json({ error: 'Location access denied.' }, 403);
    await ensureSchema(env);
    if (!section && request.method === 'GET') {
      const snapshot = await locationSnapshot(session, locationId, env);
      return snapshot ? json(snapshot) : json({ error: 'Location not found.' }, 404);
    }
    if (section === 'pages' && request.method === 'PUT') {
      if (!['system_admin', 'location_manager'].includes(role)) return json({ error: 'Manager access required.' }, 403);
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
      if (![body.menu_url, body.ads_url, body.funzone_url].every(validPageUrl)) return json({ error: 'All page addresses must be valid HTTPS URLs.' }, 400);
      await env.DB.prepare(`INSERT INTO location_pages(location_id,menu_url,ads_url,funzone_url,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(location_id) DO UPDATE SET menu_url=excluded.menu_url,ads_url=excluded.ads_url,funzone_url=excluded.funzone_url,updated_at=CURRENT_TIMESTAMP`)
        .bind(locationId, body.menu_url, body.ads_url, body.funzone_url).run();
      return json({ ok: true });
    }
    if (section === 'displays' && !itemId && request.method === 'POST') {
      if (!['system_admin', 'location_manager'].includes(role)) return json({ error: 'Manager access required.' }, 403);
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
      const name = String(body.name || '').trim();
      if (name.length < 2 || name.length > 80) return json({ error: 'Display name must be 2–80 characters.' }, 400);
      const id = crypto.randomUUID(); const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
      await env.DB.prepare(`INSERT INTO displays(id,location_id,name,pairing_code,pairing_expires_at)
        VALUES(?,?,?,?,datetime('now','+15 minutes'))`).bind(id, locationId, name, code).run();
      return json({ id, pairing_code: code, expires_in: 900 }, 201);
    }
    if (section === 'displays' && itemId && request.method === 'PATCH') {
      if (!['system_admin', 'location_manager', 'operator'].includes(role)) return json({ error: 'Display access denied.' }, 403);
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
      if (!SOURCES.includes(body.desired_source)) return json({ error: 'Unknown content source.' }, 400);
      await env.DB.prepare('UPDATE displays SET desired_source=? WHERE id=? AND location_id=? AND active=1').bind(body.desired_source, itemId, locationId).run();
      return json({ ok: true });
    }
    if (section === 'displays' && itemId && request.method === 'DELETE') {
      if (!['system_admin', 'location_manager'].includes(role)) return json({ error: 'Manager access required.' }, 403);
      await env.DB.prepare('UPDATE displays SET active=0,device_token_hash=NULL,pairing_code=NULL WHERE id=? AND location_id=?').bind(itemId, locationId).run();
      return json({ ok: true });
    }
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
