"""Create an iPad-installable profile containing only this Pi's public root certificate."""
import hashlib
from pathlib import Path
import plistlib
import ssl
import sys
import uuid

certificate=ssl.PEM_cert_to_DER_cert(Path(sys.argv[1]).read_text())
identifier='com.projectaimnet.seating.ca.'+hashlib.sha256(certificate).hexdigest()[:16]
payload={'PayloadType':'com.apple.security.root','PayloadVersion':1,'PayloadIdentifier':identifier+'.root','PayloadUUID':str(uuid.uuid5(uuid.NAMESPACE_URL,identifier+'.root')),'PayloadDisplayName':'Pizza Ranch local seating certificate','PayloadCertificateFileName':'Pizza-Ranch-Seating-Root.cer','PayloadContent':certificate}
profile={'PayloadType':'Configuration','PayloadVersion':1,'PayloadIdentifier':identifier,'PayloadUUID':str(uuid.uuid5(uuid.NAMESPACE_URL,identifier)),'PayloadDisplayName':'Pizza Ranch Seating - Local Wi-Fi','PayloadDescription':'Trust the restaurant Pi for local HTTPS seating. This profile contains only its public certificate; it does not enroll the iPad in device management.','PayloadOrganization':'Pizza Ranch','PayloadRemovalDisallowed':False,'PayloadContent':[payload]}
destination=Path(sys.argv[2]);destination.write_bytes(plistlib.dumps(profile))
