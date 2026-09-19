import importlib.util
from pathlib import Path
import tempfile
import unittest
from helpers import REPO_ROOT
spec=importlib.util.spec_from_file_location('browser_assets',REPO_ROOT/'scripts/retain-browser-assets.py')
assets=importlib.util.module_from_spec(spec);spec.loader.exec_module(assets)
class BrowserAssetTests(unittest.TestCase):
    def test_preserves_previous_hashes_and_refreshes_current_assets(self):
        with tempfile.TemporaryDirectory() as work:
            root=Path(work);source=root/'source';dest=root/'dest';source.mkdir()
            (source/'old.js').write_text('old');assets.merge_assets(source,dest,1)
            (source/'old.js').unlink();(source/'new.js').write_text('new')
            assets.merge_assets(source,dest,2)
            self.assertEqual((dest/'old.js').read_text(),'old')
            self.assertEqual((dest/'new.js').read_text(),'new')
            assets.merge_assets(source,dest,31*86400)
            assets.prune_assets(dest,31*86400)
            self.assertFalse((dest/'old.js').exists())
            self.assertTrue((dest/'new.js').exists())
    def test_refuses_to_replace_an_immutable_file(self):
        with tempfile.TemporaryDirectory() as work:
            root=Path(work);source=root/'source';dest=root/'dest';source.mkdir()
            (source/'same.js').write_text('original');assets.merge_assets(source,dest)
            (source/'same.js').write_text('different')
            with self.assertRaises(ValueError):assets.merge_assets(source,dest)
            self.assertEqual((dest/'same.js').read_text(),'original')
    def test_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as work:
            root=Path(work);source=root/'source';source.mkdir();(source/'link').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):assets.merge_assets(source,root/'dest')
