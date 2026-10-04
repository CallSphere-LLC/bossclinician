import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import media_storage_release as m
class Tests(unittest.TestCase):
 def test_unconfigured_stays_local(self):
  with tempfile.TemporaryDirectory() as d:self.assertIsNone(m.load(Path(d)/'missing'))
 def test_scope_rejects_wrong_bucket_and_generic_keys(self):
  for mutate in [lambda d:d['environment'].update(MEDIA_STORAGE_BUCKET='wrong'),lambda d:d['environment'].update(AWS_PROFILE='wrong')]:
   with tempfile.TemporaryDirectory() as tmp:
    p=Path(tmp)/'config';d={'schemaVersion':1,'environment':dict(m.EXPECTED),'identityHostPath':m.IDENTITY};mutate(d);p.write_text(json.dumps(d));p.chmod(0o600)
    with patch.object(Path,'lstat',return_value=type('S',(),{'st_mode':0o100600,'st_uid':0})()):
     with self.assertRaises(RuntimeError):m.load(p)
 def test_identity_backend_only_and_read_only(self):
  backend={'volumeMounts':[]};volumes=[];m.configure_backend(backend,volumes,{'identityHostPath':m.IDENTITY})
  self.assertEqual(backend['volumeMounts'],[{'name':'boss-media-identity','mountPath':'/run/aws-identity','readOnly':True}]);self.assertEqual(volumes[0]['hostPath']['type'],'Directory')
 def test_valid_provisioned_state(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'config';d={'schemaVersion':1,'environment':m.EXPECTED,'identityHostPath':m.IDENTITY};p.write_text(json.dumps(d));p.chmod(0o600)
   with patch.object(Path,'lstat',return_value=type('S',(),{'st_mode':0o100600,'st_uid':0})()):self.assertEqual(m.load(p),d)
 def test_media_mount_does_not_accept_global_aws_override(self):
  with self.assertRaises(RuntimeError):m.configure_backend({'env':[{'name':'AWS_PROFILE','value':'wrong'}]},[],{'identityHostPath':m.IDENTITY})
if __name__=='__main__':unittest.main()
