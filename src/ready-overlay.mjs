// Only the device response gets a wrapper URL. Saved menu settings stay unchanged.
export async function overlayState(env, locationId) {
  const row = await env.DB.prepare('SELECT state_json FROM seating_state WHERE location_id=?').bind(locationId).first();
  return row ? JSON.parse(row.state_json) : null;
}

export function readyParties(state) {
  return (state?.parties || [])
    .filter(p => p.status === 'waiting' && p.attendance !== 'away' && (p.readyAt || p.calledAt))
    .sort((a,b) => Math.max(a.readyAt || 0,a.calledAt || 0) - Math.max(b.readyAt || 0,b.calledAt || 0))
    .map(p => {
      const words = String(p.name || '').trim().split(/\s+/);
      return {name: (words[0] || 'Guest') + (words.length > 1 ? ` ${Array.from(words.at(-1))[0]}.` : ''), size:p.size};
    });
}

export function overlayPages(pages, state, locationId, origin) {
  if (!state?.readyOverlay?.enabled || !state.readyOverlay.key) return pages;
  const hash = new URLSearchParams({location:locationId,key:state.readyOverlay.key,source:pages.menu_url});
  return {...pages,menu_url:`${origin}/ready-display.html#${hash}`};
}

export async function readyOverlayFeed(request, env, url, json) {
  if (request.method !== 'GET') return json({error:'Method not allowed.'},405);
  const id=url.searchParams.get('location');
  const location=await env.DB.prepare('SELECT id FROM locations WHERE id=? AND active=1').bind(id).first();
  if (!location) return json({error:'Location unavailable.'},404);
  const state=await overlayState(env,id);
  if (!state?.readyOverlay?.enabled || !state.readyOverlay.key || request.headers.get('x-ready-overlay-key') !== state.readyOverlay.key)
    return json({error:'Overlay disabled or link revoked.'},403);
  const hub=await env.DB.prepare('SELECT enabled,last_seen FROM seating_hubs WHERE location_id=?').bind(id).first();
  if (hub?.enabled && Date.now()-hub.last_seen>=15000) return json({error:'Seating connection unavailable.'},503);
  return json({parties:readyParties(state)});
}
