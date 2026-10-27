# Ready-party TV overlay

In the seating app, select the restaurant and open **Settings → Ready-party TV overlay**. A manager or administrator can enable or disable it for that location. It defaults off.

Cloud-managed displays assigned to **Menu** automatically receive a wrapper URL on their next normal synchronization. Ads, custom pages and uploaded media are not wrapped. The menu URL saved in the media controller stays unchanged. The existing cloud node notices the URL change; no media Pi package or SD-card rewrite is needed.

The banner shows staff-marked Ready or Called parties, with first name/last initial and party size. It rotates two names at a time every seven seconds, polls every three seconds, clears on failed requests, and expires data after fifteen seconds without a successful response. Seating/removing a party, marking them away, or returning them to waiting clears their announcement. Disabling the feature revokes the location display key; re-enabling creates a fresh key.

Deployment requires both cloud workers (media controller and seating app), including the media wrapper worker route in wrangler.jsonc. Restaurants running a local seating server also need the normal seating app update so that their local settings action understands the new option. The media wrapper reads the existing synchronized seating state in the shared database and hides announcements if the local seating hub is offline. No database migration is required.

Before rollout, verify a menu screen at its actual TV resolution and in the Pi’s Firefox. Other menu providers must permit iframe embedding. The setting is intended for cloud-managed media screens, not legacy standalone controllers.
