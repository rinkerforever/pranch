#!/bin/bash
set -euo pipefail
if [ "$(id -u)" != 0 ]; then echo 'Run with sudo.'; exit 1; fi
FILE="$(realpath "${1:?Pass the downloaded seating-pi.env file}")"
python3 - "$FILE" <<'PY'
import re,sys
from pathlib import Path
from urllib.parse import urlsplit
values={}
for line in Path(sys.argv[1]).read_text().splitlines():
    if '=' not in line: raise SystemExit('Invalid configuration')
    k,v=line.split('=',1)
    if k in values or k not in {'SEATING_LOCATION_ID','SEATING_HUB_TOKEN','SEATING_CLOUD_URL','SEATING_LOCAL_URL','SEATING_DATA_DIR'}: raise SystemExit('Invalid configuration key')
    values[k]=v
if set(values)!={'SEATING_LOCATION_ID','SEATING_HUB_TOKEN','SEATING_CLOUD_URL','SEATING_LOCAL_URL','SEATING_DATA_DIR'}: raise SystemExit('Incomplete configuration')
if not re.fullmatch('[a-f0-9]{64}',values['SEATING_HUB_TOKEN']): raise SystemExit('Invalid pairing token')
if not re.fullmatch('[a-zA-Z0-9_-]{1,80}',values['SEATING_LOCATION_ID']): raise SystemExit('Invalid location')
for key in ('SEATING_CLOUD_URL','SEATING_LOCAL_URL'):
    url=urlsplit(values[key])
    if url.scheme!='https' or not url.hostname or url.username or url.password or url.path or url.query or url.fragment: raise SystemExit('Use HTTPS origins only')
if values['SEATING_CLOUD_URL']!='https://seating.projectaimnet.com': raise SystemExit('Unexpected cloud server')
if values['SEATING_DATA_DIR']!='/var/lib/pizza-ranch-seating': raise SystemExit('Unexpected data directory')
PY
if [ -e /etc/pizza-ranch-seating/seating.env ]; then echo 'Pairing already exists. Use administrator recovery rather than overwriting it.'; exit 1; fi
install -m 640 -o root -g pr-seating "$FILE" /etc/pizza-ranch-seating/seating.env
systemctl start pizza-ranch-seating.service
echo 'Pi configuration installed. Check the seating status before using it for guests.'
