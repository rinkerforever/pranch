#!/bin/bash
set -euo pipefail
# Installs only the seating services. Existing display services and their data are untouched.
if [ "$(id -u)" != 0 ]; then echo 'Run with sudo.' >&2; exit 1; fi
ROOT=/opt/pizza-ranch-seating
SOURCE="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(tr -d '\r\n' < "$SOURCE/VERSION")"
[[ "$VERSION" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid release version'; exit 1; }
install -d -m 755 "$ROOT/releases" /etc/pizza-ranch-seating
for NAME in pr-seating pr-seating-web; do id "$NAME" >/dev/null 2>&1 || useradd --system --home-dir "/var/lib/pizza-ranch-$NAME" --shell /usr/sbin/nologin "$NAME"; done
install -d -m 700 -o pr-seating -g pr-seating /var/lib/pizza-ranch-seating
install -d -m 700 -o pr-seating-web -g pr-seating-web /var/lib/pizza-ranch-seating-web
if [ ! -x "$ROOT/node/bin/node" ]; then
  WORK="$(mktemp -d)"; trap 'rm -rf -- "$WORK"' EXIT
  case "$(dpkg --print-architecture)" in armhf) SERIES=22; ARCH=armv7l;; arm64) SERIES=24; ARCH=arm64;; amd64) SERIES=24; ARCH=x64;; *) echo 'Unsupported Pi architecture'; exit 1;; esac
  curl --fail --silent --show-error --location "https://nodejs.org/dist/latest-v$SERIES.x/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
  FILE="$(awk -v suffix="-linux-$ARCH.tar.xz" 'index($2,suffix) && substr($2,length($2)-length(suffix)+1)==suffix {print $2}' "$WORK/SHASUMS256.txt")"
  [[ "$FILE" =~ ^node-v[0-9.]+-linux-(armv7l|arm64|x64)\.tar\.xz$ ]] || { echo 'No supported official Node build found'; exit 1; }
  curl --fail --silent --show-error --location "https://nodejs.org/dist/latest-v$SERIES.x/$FILE" -o "$WORK/$FILE"
  (cd "$WORK"; grep "  $FILE\$" SHASUMS256.txt | sha256sum --check --status)
  install -d "$ROOT/node"; tar -xJf "$WORK/$FILE" -C "$ROOT/node" --strip-components=1
fi
if [ ! -x "$ROOT/web/usr/bin/caddy" ]; then
  WORK="${WORK:-$(mktemp -d)}"; trap 'rm -rf -- "$WORK"' EXIT
  (cd "$WORK"; apt-get download caddy); install -d "$ROOT/web"
  DEB="$(find "$WORK" -maxdepth 1 -name 'caddy_*.deb' -print -quit)"; test -n "$DEB"; dpkg-deb -x "$DEB" "$ROOT/web"
fi
DEST="$ROOT/releases/$VERSION"
if [ ! -d "$DEST" ]; then install -d "$DEST"; cp -a "$SOURCE/." "$DEST/"; chown -R root:root "$DEST"; chmod -R go-w "$DEST"; fi
chmod -R a+rX,go-w "$DEST"
"$ROOT/node/bin/node" --check "$DEST/local/server.js"
"$ROOT/node/bin/node" --input-type=module -e 'import {DatabaseSync} from "node:sqlite"; const d=new DatabaseSync(":memory:"); d.exec("SELECT 1"); d.close();'
ln -sfn "$DEST" "$ROOT/current.new"; mv -Tf "$ROOT/current.new" "$ROOT/current"
for FILE in pizza-ranch-seating.service pizza-ranch-seating-web.service pizza-ranch-seating-update.service pizza-ranch-seating-update.timer; do install -m 644 "$DEST/local/$FILE" "/etc/systemd/system/$FILE"; done
if [ ! -f /etc/pizza-ranch-seating/Caddyfile ]; then
  HOST="$(hostname | tr '[:upper:]' '[:lower:]').local"
  cat > /etc/pizza-ranch-seating/Caddyfile <<EOF
{
  admin off
  auto_https disable_redirects
  skip_install_trust
  storage file_system {
    root /var/lib/pizza-ranch-seating-web
  }
}
https://$HOST:8443 {
  @outside not remote_ip private_ranges
  respond @outside "Staff network only" 403
  tls internal
  reverse_proxy 127.0.0.1:8790
}
http://:8081 {
  @outside not remote_ip private_ranges
  respond @outside "Staff network only" 403
  handle /seating-root.crt {
    rewrite * /pki/authorities/local/root.crt
    root * /var/lib/pizza-ranch-seating-web
    header Content-Type application/x-x509-ca-cert
    file_server
  }
  handle {
    respond "Seating certificate setup only" 404
  }
}
EOF
fi
if ! grep -q '/seating.mobileconfig' /etc/pizza-ranch-seating/Caddyfile; then
  python3 - <<'PY'
from pathlib import Path
path=Path('/etc/pizza-ranch-seating/Caddyfile')
text=path.read_text()
marker='  handle /seating-root.crt {'
if marker not in text: raise SystemExit('Certificate route missing; review the local HTTPS configuration')
route='  handle /seating.mobileconfig {\n    rewrite * /public/seating.mobileconfig\n    root * /var/lib/pizza-ranch-seating-web\n    header Content-Type application/x-apple-aspen-config\n    file_server\n  }\n'
path.write_text(text.replace(marker,route+marker,1))
PY
fi
chown -R pr-seating-web:pr-seating-web /var/lib/pizza-ranch-seating-web
runuser -u pr-seating-web -- env HOME=/var/lib/pizza-ranch-seating-web "$ROOT/web/usr/bin/caddy" validate --config /etc/pizza-ranch-seating/Caddyfile --adapter caddyfile
install -d -m 755 -o pr-seating-web -g pr-seating-web /var/lib/pizza-ranch-seating-web/public
python3 "$DEST/local/make-profile.py" /var/lib/pizza-ranch-seating-web/pki/authorities/local/root.crt /var/lib/pizza-ranch-seating-web/public/seating.mobileconfig
chown pr-seating-web:pr-seating-web /var/lib/pizza-ranch-seating-web/public/seating.mobileconfig
chmod 644 /var/lib/pizza-ranch-seating-web/public/seating.mobileconfig
systemctl daemon-reload
systemctl enable pizza-ranch-seating.service pizza-ranch-seating-web.service pizza-ranch-seating-update.timer
systemctl restart pizza-ranch-seating-web.service
if [ -f /etc/pizza-ranch-seating/seating.env ]; then systemctl restart pizza-ranch-seating.service; fi
systemctl start pizza-ranch-seating-update.timer
echo "Seating installed. Complete store pairing and iPad certificate setup. Existing display service has not been restarted."
