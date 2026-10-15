# Waco local seating deployment

The Pi is the single seating authority for its assigned store after activation. Each iPad connects directly to the Pi over staff Wi-Fi. Internet loss closes public QR check-in; staff continue working through the Pi. The existing display service on port 8080 and its updater are separate.

## Pi at 192.168.50.18

The inspected Pi has 8 GB RAM, a 64-bit kernel, and **32-bit armhf Raspberry Pi OS 13**. It already runs `pizza-ranch-cloud-node.service`. Do not reimage it. The installer uses an isolated official Node 22 runtime for armhf (Node 24 for arm64), with checksums from nodejs.org. It extracts the distro's Caddy package without changing the existing web/display service. Seating listens on loopback 8790, local HTTPS 8443, and certificate setup 8081.

The planned staff URL is **https://pizzaranchdisplay.local:8443**. Reserve the Pi's IP in the router. Staff Wi-Fi must allow clients to reach the Pi and allow local hostname discovery. Do not forward ports 8443, 8081 or 8790 to the internet. Remote staff use https://seating.projectaimnet.com and their cloud email/password.

## Install the verified release

GitHub builds `.github/workflows/seating-pi.yml` when seating changes reach `main`. It tests the app and publishes `seating-pi.tar.gz` plus a SHA-256 manifest under the `seating-pi-latest` release. The package includes browser PDF support and runtime dependencies, so restarting seating does not need internet or a package registry.

On the Pi, download both files from the fixed repository release, verify the archive against the manifest, extract into a new temporary directory, and run `sudo bash local/install.sh` from the extracted release. The installer creates separate service users and keeps code under `/opt/pizza-ranch-seating`; writable data stays under `/var/lib/pizza-ranch-seating`.

## Pair Waco once

1. A system administrator opens the cloud seating app, selects **Waco**, then **Local server**.
2. Register `https://pizzaranchdisplay.local:8443` and download `seating-pi.env`. This contains a private pairing secret; it is not an iPad file or GitHub asset.
3. Transfer that file to the Pi privately, then run `sudo bash /opt/pizza-ranch-seating/current/local/pair.sh /path/to/seating-pi.env`. Remove the transfer copy afterward.
4. The Pi imports the current Waco layout, image, guests and room bookings. Activation checks the cloud version before switching authority; if service changed during import, it retries from the latest version.
5. Confirm the cloud reports the Pi online and the local app shows the expected Waco tables before starting service. Once active, never bootstrap a second Pi with the same configuration.

## Prepare each iPad

1. Connect to staff Wi-Fi. In Safari visit `http://192.168.50.18:8081/seating.mobileconfig` and download the seating certificate profile. It contains only the Pi's public root certificate and does not enroll the iPad in device management.
2. The device owner installs the profile in **Settings > General > VPN & Device Management**, then enables trust for the seating root in **Settings > General > About > Certificate Trust Settings**. This is a deliberate trust change; do it only for this restaurant's Pi. Do not bypass Safari certificate warnings.
3. Open `https://pizzaranchdisplay.local:8443`. Choose **Set or renew my local PIN** and verify the employee's Kiosk Manager email/password online. Choose a unique 4-digit PIN. Passwords are used for verification and are not stored on the Pi.
4. Sign in with that PIN. In Safari choose **Share > Add to Home Screen**, enable **Open as Web App** if shown, and name it **PR Seating**.

PINs last 30 days; the Pi must refresh the active staff directory online within 7 days. PIN login and local writes require no internet during that authorization period. Five login attempts per minute are allowed across the station. **Lock / switch employee** ends the local session. Remote cloud login never accepts a PIN. Staff permissions and disabled accounts are refreshed when the Pi reconnects; changes cannot reach it during an outage.

## Connection and QR behavior

- A confirmed local write is saved synchronously in SQLite before success is returned. Multiple devices use the same version check; a competing change is rejected for review.
- The cloud forwards proposed changes to the Pi instead of independently writing a second seating chart. Requests expire; expired requests cannot suddenly apply after reconnection. Stored command receipts prevent reapplication after a lost reply or Pi restart.
- The Pi sends its saved state and command results to the cloud approximately every 1.5 seconds. The cloud marks it offline after 10 seconds without a completed synchronization. An in-flight QR request must be confirmed by the Pi before the guest sees success. A connection can fail during that detection window, so the guest is instructed to confirm with the host if no confirmation arrives.
- Public QR forms opened before the outage are also rejected on submit. QR settings remain saved; check-in resumes when the Pi has synchronized and is responding, provided staff left check-in enabled.
- Local host check-in, equipment requests, tables, combinations, room bookings and ready alerts continue over staff Wi-Fi. A device that loses access to the Pi cannot make changes. The app shell is cached; authenticated API data and PINs are never cached by the service worker.
- A slow green edge pulse and guest banner identify newly ready parties. Acknowledge, seat the party or lose the available fit to stop it. Reduced-motion devices use a steady indication.

## Updates and recovery

The seating updater checks GitHub every 15 minutes. It postpones installation while any guest is waiting/seated/reserved, any table is in use/held, or any room block is active. It rechecks after stopping seating, backs up SQLite, validates the new release, restarts only seating, and rolls back code/database if health checks fail. The display updater still watches its existing kiosk ZIP.

Keep the Pi and router on reliable power; a USB SSD is preferable for long-term database storage. Preserve `/etc/pizza-ranch-seating/seating.env`, the seating database/media, and `/var/lib/pizza-ranch-seating-web` in a private full backup. The last directory contains the local certificate authority; losing it requires repeating certificate setup on iPads. Do not put any of these files in GitHub.

Restoring an old database that is behind the cloud locks seating for administrator recovery. It must not automatically overwrite newer cloud data. Initial recovery is an administrator task; there is no automatic switch to an independent cloud writer.

Useful checks: `systemctl status pizza-ranch-seating pizza-ranch-seating-web`, `journalctl -u pizza-ranch-seating -n 50`, and `journalctl -u pizza-ranch-seating-update -n 50`. The runtime endpoint reports connection state without exposing tokens or PINs.

## Immediate GitHub updates
For an administrator-requested immediate update, use `sudo flock /run/lock/pizza-ranch-seating-update.lock python3 /opt/pizza-ranch-seating/current/local/update.py --force`. This briefly restarts seating even during service. It preserves the database and retains archive verification, backup, health checks, and rollback. The scheduled timer continues to wait for clear service. Deploy code through the GitHub release rather than editing the installed Pi files.

## Pilot acceptance

Use two real iPads: add a guest from one and observe it on the other; race two parties for the same table; test PIN lockout and role restrictions; unplug only the internet uplink while keeping Wi-Fi/ethernet powered; verify public QR submissions fail and host additions continue; reconnect and verify no duplicates or lost updates; restart the Pi and confirm saved state; test room cleanup, pulse acknowledgment and Home Screen launch in both orientations. Browser emulation does not replace these device/network checks.
