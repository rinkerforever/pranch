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

const pageDefaults = {
  menu_url: 'https://green-forest-07f346210.6.azurestaticapps.net/8300?type=menu-only',
  ads_url: 'https://green-forest-07f346210.6.azurestaticapps.net/8300?type=ads-only',
  funzone_url: 'https://green-forest-07f346210.6.azurestaticapps.net/8300?type=funzone-ads',
  custom_pages: [],
};

function validPageUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

async function pagesFor(locationId, env) {
  const row = await env.DB.prepare(`SELECT configuration_json FROM configuration_revisions
    WHERE location_id=? ORDER BY revision DESC LIMIT 1`).bind(locationId).first();
  if (!row) return pageDefaults;
  try { return { ...pageDefaults, ...(JSON.parse(row.configuration_json).pages || {}) }; } catch { return pageDefaults; }
}

function publicSource(sourceType, sourceValue, pages = pageDefaults) {
  if (sourceType === 'custom_url') {
    const custom = (pages.custom_pages || []).find((page) => page.url === sourceValue);
    return custom ? `custom:${custom.id}` : 'menu';
  }
  return ({ menu:'menu', ads:'ads', funzone_ads:'funzone', playlist:'media' })[sourceType] || 'menu';
}

function databaseSource(source) {
  return ({ menu:'menu', ads:'ads', funzone:'funzone_ads', media:'playlist' })[source];
}

function configured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
}

function systemAdmin(session) { return session.profile.global_role === 'system_admin'; }

function slugify(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function cleanAssignments(value) {
  if (!Array.isArray(value)) return [];
  const allowedRoles = new Set(['location_manager','operator','viewer']);
  const allowedPermissions = new Set(['manage_displays','manage_pages','manage_content','manage_users']);
  return value.map((item) => ({ location_id:String(item.location_id || ''), role:String(item.role || ''),
    permissions:[...new Set(Array.isArray(item.permissions) ? item.permissions.filter((permission) => allowedPermissions.has(permission)) : [])] }))
    .filter((item) => item.location_id && allowedRoles.has(item.role));
}

async function replaceAssignments(userId, assignments, env) {
  const statements = [env.DB.prepare('DELETE FROM user_location_roles WHERE user_id=?').bind(userId)];
  for (const item of assignments) statements.push(env.DB.prepare(`INSERT INTO user_location_roles(user_id,location_id,role,permissions_json)
    VALUES(?,?,?,?)`).bind(userId,item.location_id,item.role,JSON.stringify(item.permissions)));
  await env.DB.batch(statements);
}

async function inviteUser(request, session, env) {
  if (!systemAdmin(session)) return json({ error:'System administrator access required.' },403);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error:'User invitations are not configured yet.' },503);
  let body; try { body = await request.json(); } catch { return json({ error:'Invalid request.' },400); }
  const email = String(body.email || '').trim().toLowerCase(); const displayName = String(body.display_name || '').trim();
  const assignments = cleanAssignments(body.assignments);
  if (!email.includes('@') || displayName.length < 2 || displayName.length > 80) return json({ error:'Enter a valid email and display name.' },400);
  if (!body.system_admin && !assignments.length) return json({ error:'Assign at least one location.' },400);
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/,'')}/auth/v1/invite?redirect_to=${encodeURIComponent(new URL(request.url).origin + '/accept-invite')}`, {
    method:'POST', headers:{ 'content-type':'application/json', apikey:env.SUPABASE_SERVICE_ROLE_KEY,
      authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }, body:JSON.stringify({ email, data:{ display_name:displayName } }),
  });
  const invited = await response.json();
  if (!response.ok) return json({ error:invited.msg || invited.message || 'Could not send the invitation.' },400);
  await env.DB.prepare(`INSERT INTO user_profiles(id,auth_user_id,email,display_name,system_admin,active)
    VALUES(?,?,?,?,?,1)`).bind(invited.id,invited.id,email,displayName,body.system_admin ? 1 : 0).run();
  await replaceAssignments(invited.id,assignments,env);
  return json({ ok:true, id:invited.id },201);
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

async function hasLocationPermission(session, locationId, permission, env) {
  if (systemAdmin(session)) return true;
  const row = await env.DB.prepare('SELECT role,permissions_json FROM user_location_roles WHERE user_id=? AND location_id=?')
    .bind(session.user.id,locationId).first();
  if (!row) return false;
  let permissions = []; try { permissions = JSON.parse(row.permissions_json || '[]'); } catch {}
  const defaults = row.role === 'location_manager' ? ['manage_displays','manage_pages','manage_content','manage_users']
    : row.role === 'operator' ? ['manage_displays','manage_content'] : [];
  return permissions.includes(permission) || defaults.includes(permission);
}

async function locationSnapshot(session, locationId, env) {
  const role = await locationRole(session, locationId, env);
  if (!role) return null;
  const location = await env.DB.prepare('SELECT id,name,slug,active FROM locations WHERE id=? AND active=1').bind(locationId).first();
  if (!location) return null;
  await env.DB.prepare(`UPDATE screens SET active=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE location_id=? AND device_id IS NULL AND id IN (SELECT id FROM enrollment_codes
    WHERE used_at IS NULL AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(locationId).run();
  const pages = await pagesFor(locationId, env);
  const rows = (await env.DB.prepare(`SELECT s.id,s.name,s.device_id,d.last_seen_at,d.status_json,a.source_type,a.source_value,
    CASE WHEN e.used_at IS NULL AND e.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE 0 END pending
    FROM screens s LEFT JOIN devices d ON d.id=s.device_id AND d.revoked_at IS NULL
    LEFT JOIN screen_assignments a ON a.screen_id=s.id LEFT JOIN enrollment_codes e ON e.id=s.id
    WHERE s.location_id=? AND s.active=1 ORDER BY s.name`).bind(locationId).all()).results || [];
  const displays = rows.map((row) => {
    let status = {}; try { status = JSON.parse(row.status_json || '{}'); } catch {}
    return { id:row.id, name:row.name, desired_source:publicSource(row.source_type,row.source_value,pages),
      reported_source:status.reported_source || null, last_seen:row.last_seen_at, pending:row.pending };
  });
  return { location, role, pages, displays };
}

async function deviceApi(request, env, url) {
  if (url.pathname === '/api/device/pair' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
    const code = String(body.code || '').replace(/\D/g, '');
    const row = await env.DB.prepare(`SELECT e.id,s.location_id,s.name FROM enrollment_codes e JOIN screens s ON s.id=e.id
      WHERE e.code_hash=? AND e.used_at IS NULL AND e.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') AND s.active=1`)
      .bind(await sha256(code)).first();
    if (!row) return json({ error: 'Pairing code is invalid or expired.' }, 400);
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
    const deviceId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO devices(id,location_id,name,device_type,credential_hash,last_seen_at)
        VALUES(?,?,?,'display',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(deviceId,row.location_id,row.name,await sha256(token)),
      env.DB.prepare(`UPDATE screens SET device_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).bind(deviceId,row.id),
      env.DB.prepare(`UPDATE enrollment_codes SET used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).bind(row.id),
    ]);
    return json({ device_id: deviceId, screen_id: row.id, device_token: token, location_id: row.location_id });
  }
  const token = (request.headers.get('authorization') || '').replace(/^Device\s+/i, '');
  if (!token) return json({ error: 'Device authentication required.' }, 401);
  const display = await env.DB.prepare(`SELECT d.id device_id,d.location_id,s.id screen_id,a.source_type,a.source_value
    FROM devices d JOIN screens s ON s.device_id=d.id LEFT JOIN screen_assignments a ON a.screen_id=s.id
    WHERE d.credential_hash=? AND d.revoked_at IS NULL AND s.active=1`).bind(await sha256(token)).first();
  if (!display) return json({ error: 'Device authentication failed.' }, 401);
  if (url.pathname === '/api/device/state' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
    const reported = SOURCES.includes(body.reported_source) ? body.reported_source : null;
    await env.DB.prepare(`UPDATE devices SET status_json=?,last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).bind(JSON.stringify({ reported_source:reported }),display.device_id).run();
  }
  if (url.pathname === '/api/device/state') {
    const pages = await pagesFor(display.location_id,env);
    return json({ device_id:display.device_id, screen_id:display.screen_id, location_id:display.location_id,
      desired_source:publicSource(display.source_type,display.source_value,pages), pages });
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
  if (url.pathname === '/api/session') return json({ profile: session.profile, userInvitesConfigured:Boolean(env.SUPABASE_SERVICE_ROLE_KEY) });
  if (url.pathname === '/api/locations' && request.method === 'GET') {
    const admin = session.profile.global_role === 'system_admin';
    const query = admin
      ? env.DB.prepare('SELECT id, name, slug, active FROM locations WHERE active=1 ORDER BY name')
      : env.DB.prepare(`SELECT l.id,l.name,l.slug,l.active FROM locations l
          JOIN user_location_roles r ON r.location_id=l.id
          WHERE r.user_id=? AND l.active=1 ORDER BY l.name`).bind(session.user.id);
    return json({ locations: (await query.all()).results || [] });
  }
  if (url.pathname === '/api/locations' && request.method === 'POST') {
    if (!systemAdmin(session)) return json({ error:'System administrator access required.' },403);
    let body; try { body = await request.json(); } catch { return json({ error:'Invalid request.' },400); }
    const name = String(body.name || '').trim(); let slug = slugify(body.slug || name);
    if (name.length < 2 || name.length > 80 || slug.length < 2) return json({ error:'Enter a location name between 2 and 80 characters.' },400);
    const duplicate = await env.DB.prepare('SELECT id FROM locations WHERE slug=? OR lower(name)=lower(?)').bind(slug,name).first();
    if (duplicate) return json({ error:'A location with that name already exists.' },409);
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO locations(id,name,slug,active) VALUES(?,?,?,1)').bind(id,name,slug),
      env.DB.prepare(`INSERT INTO configuration_revisions(id,location_id,revision,configuration_json,created_by)
        VALUES(?,?,1,?,?)`).bind(crypto.randomUUID(),id,JSON.stringify({ pages:pageDefaults }),session.profile.id),
    ]);
    return json({ id,name,slug,active:1 },201);
  }
  if (url.pathname === '/api/admin/users' && request.method === 'GET') {
    if (!systemAdmin(session)) return json({ error:'System administrator access required.' },403);
    const users = (await env.DB.prepare(`SELECT id,email,display_name,system_admin,active,created_at
      FROM user_profiles ORDER BY display_name,email`).all()).results || [];
    const roles = (await env.DB.prepare(`SELECT user_id,location_id,role,permissions_json FROM user_location_roles`).all()).results || [];
    for (const user of users) user.assignments = roles.filter((role) => role.user_id === user.id).map((role) => {
      let permissions = []; try { permissions = JSON.parse(role.permissions_json || '[]'); } catch {}
      return { location_id:role.location_id, role:role.role, permissions };
    });
    return json({ users, invitationsConfigured:Boolean(env.SUPABASE_SERVICE_ROLE_KEY) });
  }
  if (url.pathname === '/api/admin/users' && request.method === 'POST') return inviteUser(request,session,env);
  const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch && request.method === 'PATCH') {
    if (!systemAdmin(session)) return json({ error:'System administrator access required.' },403);
    let body; try { body = await request.json(); } catch { return json({ error:'Invalid request.' },400); }
    const userId = decodeURIComponent(userMatch[1]); const displayName = String(body.display_name || '').trim();
    if (displayName.length < 2 || displayName.length > 80) return json({ error:'Display name must be 2–80 characters.' },400);
    if (userId === session.profile.id && (!body.active || !body.system_admin)) return json({ error:'You cannot disable or demote your own administrator account.' },400);
    const assignments = cleanAssignments(body.assignments);
    if (!body.system_admin && !assignments.length) return json({ error:'Assign at least one location.' },400);
    await env.DB.prepare(`UPDATE user_profiles SET display_name=?,system_admin=?,active=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
      .bind(displayName,body.system_admin ? 1 : 0,body.active ? 1 : 0,userId).run();
    await replaceAssignments(userId,assignments,env); return json({ ok:true });
  }
  const match = url.pathname.match(/^\/api\/locations\/([^/]+)(?:\/(pages|displays))?(?:\/([^/]+))?$/);
  if (match) {
    const locationId = decodeURIComponent(match[1]);
    const section = match[2]; const itemId = match[3] && decodeURIComponent(match[3]);
    const role = await locationRole(session, locationId, env);
    if (!role) return json({ error: 'Location access denied.' }, 403);
    if (!section && request.method === 'GET') {
      const snapshot = await locationSnapshot(session, locationId, env);
      return snapshot ? json(snapshot) : json({ error: 'Location not found.' }, 404);
    }
    if (!section && request.method === 'PATCH') {
      if (!systemAdmin(session)) return json({ error:'System administrator access required.' },403);
      let body; try { body = await request.json(); } catch { return json({ error:'Invalid request.' },400); }
      const name = String(body.name || '').trim(); if (name.length < 2 || name.length > 80) return json({ error:'Location name must be 2–80 characters.' },400);
      if (locationId === 'tyler' && !body.active) return json({ error:'The default Tyler location cannot be deactivated.' },400);
      await env.DB.prepare(`UPDATE locations SET name=?,active=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
        .bind(name,body.active ? 1 : 0,locationId).run(); return json({ ok:true });
    }
    if (section === 'pages' && request.method === 'PUT') {
      if (!await hasLocationPermission(session,locationId,'manage_pages',env)) return json({ error: 'Page-management permission required.' }, 403);
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
      const customPages = Array.isArray(body.custom_pages) ? body.custom_pages : [];
      if (customPages.length > 50) return json({ error: 'A location can have up to 50 custom pages.' }, 400);
      const cleanCustom = customPages.map((page) => ({ id:String(page.id || crypto.randomUUID()).slice(0,80), name:String(page.name || '').trim(), url:String(page.url || '').trim() }));
      if (![body.menu_url, body.ads_url, body.funzone_url].every(validPageUrl) || cleanCustom.some((page) => page.name.length < 1 || page.name.length > 80 || !validPageUrl(page.url))) return json({ error: 'Every page needs a name and valid HTTPS address.' }, 400);
      if (new Set(cleanCustom.map((page) => page.id)).size !== cleanCustom.length) return json({ error: 'Custom page identifiers must be unique.' }, 400);
      const previousPages = await pagesFor(locationId,env);
      const current = await env.DB.prepare('SELECT COALESCE(MAX(revision),0) revision FROM configuration_revisions WHERE location_id=?').bind(locationId).first();
      await env.DB.prepare(`INSERT INTO configuration_revisions(id,location_id,revision,configuration_json,created_by)
        VALUES(?,?,?,?,?)`).bind(crypto.randomUUID(),locationId,current.revision+1,
        JSON.stringify({ pages:{ menu_url:body.menu_url, ads_url:body.ads_url, funzone_url:body.funzone_url, custom_pages:cleanCustom } }),session.profile.id).run();
      const retainedUrls = new Set(cleanCustom.map((page) => page.url));
      for (const removed of (previousPages.custom_pages || []).filter((page) => !retainedUrls.has(page.url))) {
        await env.DB.prepare(`UPDATE screen_assignments SET source_type='menu',source_value=?,desired_revision=desired_revision+1,
          updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE source_type='custom_url' AND source_value=?
          AND screen_id IN (SELECT id FROM screens WHERE location_id=?)`).bind(body.menu_url,session.profile.id,removed.url,locationId).run();
      }
      return json({ ok: true });
    }
    if (section === 'displays' && !itemId && request.method === 'POST') {
      if (!await hasLocationPermission(session,locationId,'manage_displays',env)) return json({ error: 'Display-management permission required.' }, 403);
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
      const name = String(body.name || '').trim();
      if (name.length < 2 || name.length > 80) return json({ error: 'Display name must be 2–80 characters.' }, 400);
      const id = crypto.randomUUID(); const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
      await env.DB.batch([
        env.DB.prepare('INSERT INTO screens(id,location_id,name) VALUES(?,?,?)').bind(id,locationId,name),
        env.DB.prepare(`INSERT INTO enrollment_codes(id,code_hash,requested_device_name,expires_at)
          VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+15 minutes'))`).bind(id,await sha256(code),name),
        env.DB.prepare(`INSERT INTO screen_assignments(screen_id,source_type,source_value,desired_revision,updated_by)
          VALUES(?,'menu','',1,?)`).bind(id,session.profile.id),
      ]);
      return json({ id, pairing_code: code, expires_in: 900 }, 201);
    }
    if (section === 'displays' && itemId && request.method === 'PATCH') {
      if (!await hasLocationPermission(session,locationId,'manage_content',env)) return json({ error: 'Content-management permission required.' }, 403);
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
      const requestedSource = String(body.desired_source || '');
      if (!SOURCES.includes(requestedSource) && !requestedSource.startsWith('custom:')) return json({ error: 'Unknown content source.' }, 400);
      const screen = await env.DB.prepare('SELECT id FROM screens WHERE id=? AND location_id=? AND active=1').bind(itemId,locationId).first();
      if (!screen) return json({ error: 'Display not found.' }, 404);
      const pages = await pagesFor(locationId,env); let type; let value;
      if (requestedSource.startsWith('custom:')) {
        const page = (pages.custom_pages || []).find((item) => item.id === requestedSource.slice(7));
        if (!page) return json({ error: 'Custom page not found.' }, 400);
        type = 'custom_url'; value = page.url;
      } else { type = databaseSource(requestedSource); value = ({ menu:pages.menu_url, ads:pages.ads_url, funzone:pages.funzone_url, media:'' })[requestedSource]; }
      await env.DB.prepare(`INSERT INTO screen_assignments(screen_id,source_type,source_value,desired_revision,updated_by)
        VALUES(?,?,?,?,?) ON CONFLICT(screen_id) DO UPDATE SET source_type=excluded.source_type,source_value=excluded.source_value,
        desired_revision=screen_assignments.desired_revision+1,updated_by=excluded.updated_by,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
        .bind(itemId,type,value,1,session.profile.id).run();
      return json({ ok: true });
    }
    if (section === 'displays' && itemId && request.method === 'DELETE') {
      if (!await hasLocationPermission(session,locationId,'manage_displays',env)) return json({ error: 'Display-management permission required.' }, 403);
      const row = await env.DB.prepare('SELECT device_id FROM screens WHERE id=? AND location_id=?').bind(itemId,locationId).first();
      if (row?.device_id) await env.DB.prepare(`UPDATE devices SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).bind(row.device_id).run();
      await env.DB.prepare(`UPDATE screens SET active=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND location_id=?`).bind(itemId,locationId).run();
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
