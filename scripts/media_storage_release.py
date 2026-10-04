"""Load explicitly provisioned non-secret S3 cutover state for future releases."""
import json,stat
from pathlib import Path
CONFIG=Path('/etc/bossclinician/media-storage.json')
EXPECTED={
 'MEDIA_STORAGE_STORE':'s3',
 'MEDIA_STORAGE_BUCKET':'bossclinician-media-662904411994-us-west-2',
 'MEDIA_STORAGE_REGION':'us-west-2',
 'MEDIA_STORAGE_ACCOUNT':'662904411994',
 'MEDIA_STORAGE_KMS_KEY':'arn:aws:kms:us-west-2:662904411994:key/eb2cb28e-b2ff-44d4-87ba-3768b98e5e40',
}
IDENTITY='/var/lib/postgresql/business-aws-identities/bossclinician/media'
def load(path=CONFIG):
 if path.is_symlink():raise RuntimeError("Symlink media configuration refused")
 if not path.exists():return None
 s=path.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022:raise RuntimeError('Protected media cutover configuration required')
 d=json.loads(path.read_text())
 if d!={'schemaVersion':1,'environment':EXPECTED,'identityHostPath':IDENTITY}:raise RuntimeError('Unexpected media cutover scope; refuse silent fallback')
 return d

def configure_backend(backend,volumes,state):
 if state is None:return
 if any(e.get('name','').startswith('AWS_') for e in backend.get('env',[])):
  raise RuntimeError('Generic AWS overrides are not part of media release configuration')
 backend.setdefault('volumeMounts',[]).append({'name':'boss-media-identity','mountPath':'/run/aws-identity','readOnly':True})
 volumes.append({'name':'boss-media-identity','hostPath':{'path':state['identityHostPath'],'type':'Directory'}})
