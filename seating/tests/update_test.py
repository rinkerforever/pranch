"""Verify manual updates without touching services or restaurant data."""
import hashlib
from contextlib import closing
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('seating_update',Path(__file__).parents[1]/'local/update.py')
update=importlib.util.module_from_spec(spec);spec.loader.exec_module(update)

class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.addCleanup(self.folder.cleanup)
        root=Path(self.folder.name);self.root=root/'code';(self.root/'current').mkdir(parents=True)
        (self.root/'current/VERSION').write_text('a'*40)
        self.env=root/'seating.env';self.env.touch();self.db=root/'seating.sqlite'
        with closing(sqlite3.connect(self.db)) as db,db:db.execute('CREATE TABLE guests(name TEXT)');db.execute("INSERT INTO guests VALUES('Saved party')")
        self.payload=b'verified release archive';self.manifest={'version':'b'*40,'sha256':hashlib.sha256(self.payload).hexdigest()}
        def unpack(data,destination):
            (destination/'VERSION').write_text(self.manifest['version']);(destination/'local').mkdir();(destination/'local/install.sh').touch()
        for mock in [patch.object(update,'ROOT',self.root),patch.object(update,'DB',self.db),
                     patch.object(update,'Path',side_effect=lambda p:self.env if str(p)=='/etc/pizza-ranch-seating/seating.env' else Path(p)),
                     patch.object(update,'download',side_effect=lambda name,limit:json.dumps(self.manifest).encode() if name.endswith('.json') else self.payload),
                     patch.object(update,'unpack',side_effect=unpack),patch.object(update,'clear_for_update',return_value=False),
                     patch.object(update.subprocess,'run'),patch.object(update.urllib.request,'urlopen',side_effect=lambda *a,**kw:io.BytesIO(b'{"mode":"local","requiresRecovery":false}'))]:
            result=mock.start();self.addCleanup(mock.stop)
            if mock.attribute=='run':self.commands=result
    def test_automatic_update_defers_for_active_service(self):
        update.main();self.commands.assert_not_called();self.assertFalse(self.db.with_name('before-update.sqlite').exists())
    def test_authorized_force_preserves_active_data_and_creates_backup(self):
        update.main(force=True)
        self.assertIn(['systemctl','stop','pizza-ranch-seating.service'],[call.args[0] for call in self.commands.call_args_list])
        for path in [self.db,self.db.with_name('before-update.sqlite')]:
            with closing(sqlite3.connect(path)) as db:self.assertEqual(db.execute('SELECT name FROM guests').fetchall(),[('Saved party',)])
    def test_force_still_rejects_a_bad_checksum_before_stopping_service(self):
        self.manifest['sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'checksum'):update.main(force=True)
        self.commands.assert_not_called()

if __name__=='__main__':unittest.main()
