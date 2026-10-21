# Pizza Ranch Seating

## iPad and local Pi mode

The app now supports Home Screen installation, a green table-ready alert, and an optional per-store Raspberry Pi server. Once paired, the Pi is the single seating authority: staff use local employee PINs, cloud users keep email/password sign-in, and public QR check-in closes automatically when the Pi cannot synchronize. Local staff can continue working during an internet outage while the Pi and staff Wi-Fi remain available. Cloud-only locations retain the existing cloud behavior.

See [local/DEPLOYMENT.md](local/DEPLOYMENT.md) for Waco installation, iPad certificate/Home Screen setup, offline authorization periods, GitHub update packages, and recovery. The existing kiosk display service and its updater remain independent. The cloud-only development/deployment details below apply to locations that have not paired a Pi.

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

## Fun Zone guest QR and 3-inch stickers

Select the restaurant, then **Settings → Guest check-in → Fun Zone stickers (3 inch)**. This creates a stable, location-specific QR link and opens a round, 3-inch printable sticker. Print at actual size with background graphics enabled. The same sticker can go on every table in that restaurant. It is separate from waitlist check-in and works even when the waitlist form is closed.

Prepared stickers can be printed before the Pi comes online. Open their supplied activation link while signed in and click **Activate this printed sticker** after the Pi reconnects. Activation uses the normal authority/version checks and will not replace a different existing QR key. The six-up Letter PDF is for full-sheet sticker paper, cut into circles; it is not aligned to a particular brand of precut labels. Its footer links to activation. `tools/make_funzone_stickers.py` builds a single 3-inch sticker and the Letter sheet from the prepared guest URL.

Guests scan, choose their full table number, and tap **We’re in the Fun Zone**. The existing occupied-table FunZone badge shows elapsed minutes. The seating status stays in use; combined tables update together. Guests tap **We’re back at our table**, or staff use the existing return control, to stop the timer. Repeated entry requests preserve the start time. Clearing a table clears the timer; reassignment carries the timer to the new table. A previously opened guest page cannot update a new seating at the same table.

The printed link grants only table Fun Zone updates and does not expose guest names or the waitlist. Treat copies as restaurant guest signage. Guest writes use the same version checks and Pi confirmation as staff writes; an offline paired restaurant refuses public updates. Staff can still use the local app. Older FunZone markers without a timestamp show no invented elapsed duration; the next check-in starts the clock.

## Verification

`node --test tests/*.test.js` verifies PDF seat counts, invalid capacities, authorization, disabled accounts, combination rules, party lifecycle, and competing writes against actual SQLite. Browser QA verifies rendered chair counts and guest/layout flows. Guest notes are rendered as text rather than HTML. Closed guest records are retained up to 24 hours (at most 200), with active parties retained independently.

## Operational limits

- An internet connection is required to save live changes. The interface reports failed or stale saves; it does not queue offline writes.
- Suggestions combine up to four approved tables; manual selection supports up to twelve.
- Combining sums configured capacities. Approve only combinations where that many usable seats remain; adjust capacities when the physical arrangement changes.
- Floor-plan replacement changes the background, not table positions or room filters. Use Full plan and the editor when adding a differently arranged restaurant.
- Maximum 200 tables, 200 waiting parties, party size 100, configured table capacity 20.
- API authorization and concurrency tests are automated; final end-to-end login with a real administrator must be verified after deployment.
# Party room tablet display

Managers enable **Settings → Party Display add-on** per restaurant (off by default). Open one of its room links on each tablet. Enabled rooms also have an **Open tablet display** link under Whole-room bookings. Production links use `https://partydisplay.projectaimnet.com/`; the same Worker serves this custom domain and routes its root to the display. A preview is available at `/room-display.html?demo=1`.

The screen shows the earliest upcoming reservation (including its date, party name and start/end times), counts down during the scheduled interval, then advances to the next reservation or the room's configured Open/Closed state. Combined bookings appear on each affected room. Reservation status takes priority over closure. Time labels use the tablet's timezone, so configure the tablet for the restaurant's timezone.

It reads seating updates every 10 seconds and ticks the countdown every second, correcting for device clock drift using server time. After 45 seconds without a successful refresh, it hides reservation details and asks guests to check with staff. It requests a screen wake lock where supported. The screen does not release tables or alter bookings; existing staff release/cleaning procedures still apply.

Tablet links carry a read-only restaurant display key in the URL fragment, sent to the API in a header. No staff login is needed on the display domain. The API only returns the requested room's status and current/next party names and times; it excludes notes, contact information, table data and staff credentials. Keep these links on restaurant tablets. Disabling the add-on revokes all its links, and re-enabling issues a new key. Local Pi restaurants use their synchronized cloud state; the display reports unavailable when the Pi is offline. Deploying the Worker registers the custom domain through Cloudflare; the zone must be in the deployment account.
