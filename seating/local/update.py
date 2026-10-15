"""Update only seating from the owner's fixed GitHub release, after service is clear."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import subprocess
import tarfile
import tempfile
import time
import urllib.request

BASE='https://github.com/rinkerforever/pranch/releases/download/seating-pi-latest/'
ROOT=Path('/opt/pizza-ranch-seating')
DB=Path('/var/lib/pizza-ranch-seating/seating.sqlite')
LIMIT=60*1024*1024

def download(name,limit):
    request=urllib.request.Request(BASE+name,headers={'User-Agent':'PizzaRanchSeatingUpdater','Cache-Control':'no-cache'})
    with urllib.request.urlopen(request,timeout=60) as response:
        data=response.read(limit+1)
        if len(data)>limit: raise ValueError('Update exceeds size limit')
        return data

def clear_for_update():
    if not DB.exists(): return True
    with sqlite3.connect(f'file:{DB}?mode=ro',uri=True) as db:
        for (raw,) in db.execute('SELECT state_json FROM seating_state'):
            state=json.loads(raw)
            if any(p['status'] in ('waiting','seated','reserved') for p in state['parties']): return False
            if any(t['status'] in ('in_use','reserved') for t in state['tables']): return False
            if any(b['status'] in ('held','in_use') for b in state.get('roomBlocks',[])): return False
    return True

def unpack(data,destination):
    with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
        files=archive.getmembers()
        if len(files)>3000 or sum(f.size for f in files)>150*1024*1024: raise ValueError('Expanded update too large')
        for file in files:
            path=PurePosixPath(file.name)
            if path.is_absolute() or '..' in path.parts or '\\' in file.name or not (file.isfile() or file.isdir()): raise ValueError('Unsafe update archive')
        archive.extractall(destination,filter='data')
    for name in ('VERSION','local/install.sh','local/server.js','src/worker.js','public/index.html'):
        if not (destination/name).is_file(): raise ValueError('Incomplete seating update')

def main():
    if not Path('/etc/pizza-ranch-seating/seating.env').is_file(): print('Pair this Pi before enabling automatic seating updates.');return
    manifest=json.loads(download('seating-pi.json',4096))
    if not re.fullmatch('[a-f0-9]{40}',manifest['version']) or not re.fullmatch('[a-f0-9]{64}',manifest['sha256']): raise ValueError('Invalid update manifest')
    if (ROOT/'current/VERSION').read_text().strip()==manifest['version']: print('Seating is current.');return
    if not clear_for_update(): print('Seating update waiting until guests and room blocks are cleared.');return
    payload=download('seating-pi.tar.gz',LIMIT)
    if hashlib.sha256(payload).hexdigest()!=manifest['sha256']: raise ValueError('Update checksum mismatch; leaving current version running')
    with tempfile.TemporaryDirectory(prefix='seating-update-') as folder:
        source=Path(folder);unpack(payload,source)
        if (source/'VERSION').read_text().strip()!=manifest['version']: raise ValueError('Release version mismatch')
        subprocess.run(['/bin/bash','-n',str(source/'local/install.sh')],check=True)
        previous=(ROOT/'current').resolve()
        subprocess.run(['systemctl','stop','pizza-ranch-seating.service'],check=True)
        # Check again after stopping: a guest may have arrived while the package downloaded.
        if not clear_for_update(): subprocess.run(['systemctl','start','pizza-ranch-seating.service'],check=True);print('Update postponed for active service.');return
        backup=None
        if DB.exists():
            backup=DB.with_name('before-update.sqlite')
            with sqlite3.connect(DB) as src,sqlite3.connect(backup) as dst: src.backup(dst)
            os.chmod(backup,0o600)
        try:
            subprocess.run(['/bin/bash',str(source/'local/install.sh')],check=True,timeout=600)
            for _ in range(20):
                try:
                    with urllib.request.urlopen('http://127.0.0.1:8790/api/runtime',timeout=2) as response:
                        status=json.load(response)
                        if status.get('mode')=='local' and not status.get('requiresRecovery'): print('Seating updated to '+manifest['version']);return
                except OSError: pass
                time.sleep(1)
            raise RuntimeError('Updated seating service failed its health check')
        except Exception:
            subprocess.run(['systemctl','stop','pizza-ranch-seating.service'],check=False)
            temp=ROOT/'current.rollback';temp.symlink_to(previous);temp.replace(ROOT/'current')
            if backup:
                with sqlite3.connect(backup) as src,sqlite3.connect(DB) as dst: src.backup(dst)
            subprocess.run(['systemctl','start','pizza-ranch-seating.service'],check=False)
            raise

if __name__=='__main__':
    try: main()
    except Exception as error: print('Seating update not applied: '+str(error),flush=True);raise SystemExit(1)
