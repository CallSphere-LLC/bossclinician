"""Image GC must protect current/rollback workloads and unrelated applications."""
import contextlib
import io
import json
import runpy
import unittest
from unittest.mock import patch
from helpers import REPO_ROOT

PREFIX = 'docker.io/library/bossclinician-k3-backend:'

class RetentionTests(unittest.TestCase):
    def simulate(self, workload_tags=(), container_tags=(), dry=False):
        refs = [PREFIX+f'202609{i:02d}' for i in range(1, 8)]
        refs += ['docker.io/library/other-production:old']
        workloads = {'items': [{'spec': {'template': {'spec': {'containers': [{'image': PREFIX+t}]}}}} for t in workload_tags]}
        def output(cmd, text=True):
            if cmd[0] == 'kubectl': return json.dumps(workloads)
            if cmd[:3] == ('docker', 'ps', '-aq'): return '\n'.join(container_tags)
            if cmd[:2] == ('docker', 'inspect'): return json.dumps([{'Config': {'Image': PREFIX+t}} for t in container_tags])
            if cmd[0] == 'k3s': return '\n'.join(refs)
            if cmd[:2] == ('docker', 'images'): return '\n'.join(r.removeprefix('docker.io/library/') for r in refs)
            raise AssertionError(cmd)
        with patch('subprocess.check_output', side_effect=output), patch('subprocess.run') as mutate, patch('sys.argv', ['prune']+(['--dry-run'] if dry else [])), contextlib.redirect_stdout(io.StringIO()):
            runpy.run_path(str(REPO_ROOT/'scripts/prune-k3s-images.py'), run_name='__main__')
        return [call.args[0] for call in mutate.call_args_list]

    def test_retains_workload_and_previous_replicaset_images(self):
        calls=self.simulate(['20260901','20260903'])
        removed={c[-1] for c in calls}
        self.assertIn(PREFIX+'20260902',removed)
        self.assertNotIn(PREFIX+'20260901',removed)
        self.assertNotIn(PREFIX+'20260903',removed)
        for tag in ['20260905','20260906','20260907']:
            self.assertNotIn(PREFIX+tag,removed)

    def test_retains_stopped_docker_container_image(self):
        self.assertFalse(any('20260901' in c[-1] for c in self.simulate(container_tags=['20260901'])))

    def test_never_removes_other_apps_or_forces_removal(self):
        for cmd in self.simulate():
            self.assertNotIn('other-production',cmd[-1])
            self.assertNotIn('--force',cmd)
            self.assertNotIn('prune',cmd)

    def test_dry_run_has_no_mutations(self):
        self.assertEqual(self.simulate(dry=True),[])
