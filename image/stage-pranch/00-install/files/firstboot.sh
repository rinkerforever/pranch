#!/bin/bash
set -Eeuo pipefail

state=/var/lib/pizza-ranch-firstboot
archive="$state/Pizza-Ranch-Kiosk.zip"
fallback=/usr/local/lib/pizza-ranch-firstboot/Pizza-Ranch-Kiosk.zip
release=https://raw.githubusercontent.com/rinkerforever/pranch/main/Pizza-Ranch-Kiosk.zip
install -d -m 700 "$state"

machine="$(cat /etc/machine-id)"
if [[ -n "$machine" ]]; then
  hostname="pr-display-${machine:0:6}"
  hostnamectl set-hostname "$hostname"
  printf '%s\n' "$hostname" > /etc/hostname
fi

# Prefer the newest GitHub release. The baked copy lets an already-downloaded
# image remain recoverable if GitHub is briefly unavailable.
if curl --fail --location --silent --show-error --retry 10 --retry-delay 6 \
    --connect-timeout 15 --max-time 300 -H 'Cache-Control: no-cache' \
    "$release" -o "$archive.download"; then
  mv "$archive.download" "$archive"
else
  cp "$fallback" "$archive"
fi

rm -rf "$state/extracted"
install -d -m 700 "$state/extracted"
python3 - "$archive" "$state/extracted" <<'PY'
from pathlib import Path, PurePosixPath
import stat, sys, zipfile
archive, destination = map(Path, sys.argv[1:])
with zipfile.ZipFile(archive) as release:
    entries = release.infolist()
    if len(entries) > 2000 or sum(item.file_size for item in entries) > 32 * 1024 * 1024:
        raise SystemExit('Release archive exceeds safety limits')
    for item in entries:
        path = PurePosixPath(item.filename)
        mode = item.external_attr >> 16
        if (path.is_absolute() or '..' in path.parts or '\\' in item.orig_filename
                or not path.parts or path.parts[0] != 'pizza-ranch' or stat.S_ISLNK(mode)):
            raise SystemExit('Unsafe release archive')
    release.extractall(destination)
root = destination / 'pizza-ranch'
for required in ('install.sh', 'ranch/cloud_node.py', 'deploy/pizza-ranch-cloud-node.service'):
    if not (root / required).is_file():
        raise SystemExit('Release is missing ' + required)
PY

export SUDO_USER=pranch RANCH_TIMEZONE=America/Chicago
bash "$state/extracted/pizza-ranch/install.sh" cloud-display
touch "$state/complete"
systemctl disable pizza-ranch-firstboot.service
systemctl reboot

