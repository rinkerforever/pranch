# Pizza Ranch Seating

Independent Cloudflare Worker for `seating.projectaimnet.com`. Reuses the existing Supabase Auth project, the Cloudflare D1 database's active user/location directory, and the existing R2 bucket under the `seating/` prefix. Kiosk Manager's application code is unchanged.

## Features

- 68 tables/booths transcribed from the supplied PDF, with individually rendered chairs and area-qualified table IDs.
- Full plan, dining room, section, and party room views; zoom and pan.
- Booth capacity is deliberately unset until a manager confirms it. The PDF's two-seat tables 10/11/12 on the left of the C/B divider belong to C; the booth 10 in the bottom row belongs to B.
- Open / in-use / cleaning, approved combinations, separation, seating party names and elapsed time.
- Waiting guests, size, notes, arrival time, edit/removal, and smallest-fitting available suggestions.
- Layout editor: position, number, area, type, orientation, capacity, allowed combinations, add/remove tables.
- PDF (first page), PNG, JPEG and WebP floor-plan upload. PDF renders locally to PNG before upload. Existing table positions remain for manual alignment; uploads are not automatically interpreted.
- Shared state polls every five seconds while Live floor is visible. Atomic D1 compare-and-swap rejects stale writes, including double seating.
- Supabase email/password login with HttpOnly Secure cookies and refresh; disabled accounts rejected server-side. Existing Kiosk Manager invitations/recovery continue to manage the shared credentials.
- System admins have full access; explicit per-location seating grants for manager / host / viewer.
- `?demo=1` is a clearly labeled, browser-local preview with sample data. It does not call production data APIs.

## Develop

```sh
pnpm install
pnpm run prepare-assets
pnpm run check
pnpm test
pnpm dev
```

Open `http://localhost:8787/?demo=1` to exercise the UI without live credentials. Local D1 is separate from production; the real login requires an active user directory and location records. Do not insert demo credentials into production.

## Deploy

Cloudflare Workers build configuration:

- Root directory: `seating`
- Build command: `node scripts/prepare-assets.js && node --test tests/*.test.js`
- Deploy command: `npx wrangler deploy`
- Worker name: `pizza-ranch-seating`
- Custom domain: `seating.projectaimnet.com`

Before the first production login, apply `migrations/0001_seating.sql` to the existing `pizza-ranch-control` D1 database. This adds only `seating_state` and `seating_grants`; it does not modify kiosk records. With an authorized CLI:

```sh
npx wrangler d1 execute pizza-ranch-control --remote --file migrations/0001_seating.sql
npx wrangler deploy
```

The checked-in Wrangler config contains the existing public Supabase URL and public anon key, plus D1/R2 identifiers. No service-role key is required by the seating Worker. The Worker only calls Supabase for identity; all seating authorization and writes happen server-side. Do not add the service-role key to browser assets.

After deployment, sign in with an existing system administrator account, select the restaurant, grant staff access, confirm booth capacities, and approve combinations that can physically be joined. All live tables start open and the waiting list starts empty.

## Verification

`node --test tests/*.test.js` verifies PDF seat counts, invalid capacities, authorization, disabled accounts, combination rules, party lifecycle, and competing writes against actual SQLite. Browser QA verifies rendered chair counts and guest/layout flows. Guest notes are rendered as text rather than HTML. Closed guest records are retained up to 24 hours (at most 200), with active parties retained independently.

## Operational limits

- An internet connection is required to save live changes. The interface reports failed or stale saves; it does not queue offline writes.
- Suggestions combine up to four approved tables; manual selection supports up to twelve.
- Combining sums configured capacities. Approve only combinations where that many usable seats remain; adjust capacities when the physical arrangement changes.
- Floor-plan replacement changes the background, not table positions or room filters. Use Full plan and the editor when adding a differently arranged restaurant.
- Maximum 200 tables, 200 waiting parties, party size 100, configured table capacity 20.
- API authorization and concurrency tests are automated; final end-to-end login with a real administrator must be verified after deployment.
