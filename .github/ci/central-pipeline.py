#!/usr/bin/env python3
"""Run explicit application checks and immutable Docker builds on central CI."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request
import hashlib
import shutil
import time
import uuid


def safe_name(value):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', value):
        raise ValueError('Invalid application or service name')
    return value


def local_path(root, value):
    path = (root/value).resolve()
    if not path.is_relative_to(root):
        raise ValueError('Build input escapes the repository')
    if not path.exists():
        raise ValueError(f'Missing build input: {value}')
    return path


def normalize_checkout_modes(root):
    """Restore Git's tracked modes without exposing credentials in .git."""
    if not (root/'.git').exists():
        return
    entries = subprocess.check_output(['git', 'ls-files', '--stage', '-z'], cwd=root).split(b'\0')
    root.chmod(0o755)
    for entry in entries:
        if not entry:
            continue
        metadata, raw_path = entry.split(b'\t', 1)
        mode = metadata.split()[0]
        if mode not in (b'100644', b'100755'):
            continue
        path = root/os.fsdecode(raw_path)
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            continue
        path.chmod(0o755 if mode == b'100755' else 0o644)
        for parent in path.parents:
            if parent == root:
                break
            parent.chmod(0o755)


def prepare_named_context(specification, root):
    pins = json.loads(local_path(root, specification['pins']).read_text())['files']
    source = Path(specification['source'])
    files = {}
    for name, expected in pins.items():
        if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]*', name):
            raise ValueError('Invalid named-context filename')
        path = source/name
        if path.is_symlink() or not path.is_file():
            raise ValueError('Missing pinned public build helper')
        content = path.read_bytes()
        if len(content) != expected['bytes'] or hashlib.sha256(content).hexdigest() != expected['sha256']:
            raise ValueError('Public build helper does not match its committed hash')
        files[name] = content
    target = Path(tempfile.mkdtemp(prefix='ci-public-helper-', dir=os.environ.get('RUNNER_TEMP')))
    for name, content in files.items():
        (target/name).write_bytes(content)
        (target/name).chmod(0o755)
    (target/'manifest.json').write_text(json.dumps({'schema_version': 1, 'files': pins}, indent=2)+'\n')
    return target


def execute(profile, root, revision, run=subprocess.run):
    normalize_checkout_modes(root)
    contexts = {}
    try:
        for name, specification in profile.get('named_contexts', {}).items():
            safe_name(name)
            contexts[name] = prepare_named_context(specification, root)
        return execute_checks(profile, root, revision, run, contexts)
    finally:
        for target in contexts.values():
            shutil.rmtree(target)


def execute_checks(profile, root, revision, run, contexts):
    app = safe_name(profile['app'])
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('A full Git commit SHA is required')
    images = []
    for check in profile.get('checks', []):
        print('CHECK:', check['name'], flush=True)
        directory = local_path(root, check.get('directory', '.'))
        run(['docker', 'run', '--rm', '-v', f'{root}:/repo', '-w', '/repo/'+str(directory.relative_to(root)),
             '-e', 'CI=true', '-e', 'NEXT_TELEMETRY_DISABLED=1', '-e', 'AWS_EC2_METADATA_DISABLED=true',
             check['image'], 'sh', '-ec', check['command']], check=True)
    for build in profile['builds']:
        name = safe_name(build['name'])
        context = local_path(root, build['context'])
        dockerfile = local_path(root, build['dockerfile'])
        tag = f'central-ci/{app}-{name}:{revision}'
        print('BUILD:', tag, flush=True)
        command = ['docker', 'build', '--label', f'org.opencontainers.image.revision={revision}',
                   '-t', tag, '-f', str(dockerfile)]
        if build.get('target'):
            command += ['--target', safe_name(build['target'])]
        for key, value in build.get('arguments', {}).items():
            if not re.fullmatch('[A-Z][A-Z0-9_]*', key):
                raise ValueError('Invalid build argument name')
            command += ['--build-arg', key+'='+str(value).replace('{revision}', revision)]
        for named in build.get('named_contexts', []):
            command += ['--build-context', f'{named}={contexts[named]}']
        run([*command, str(context)], check=True)
        images.append(tag)
        if build.get('runtime_check'):
            executable, *arguments = build['runtime_check']
            run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', executable,
                 tag, *arguments], check=True)
        if build.get('startup_check'):
            check = build['startup_check']
            container = 'central-ci-startup-'+uuid.uuid4().hex
            command = ['docker', 'run', '-d', '--name', container, '--network', 'none',
                       '--memory', '1g', '--cpus', '1', '--pids-limit', '256']
            for environment_name, value in check.get('environment', {}).items():
                command += ['-e', environment_name+'='+value]
            try:
                run([*command, tag], check=True, capture_output=True)
                deadline = time.monotonic()+60
                while True:
                    result = run(['docker', 'exec', container, *check['command']], capture_output=True)
                    if result.returncode == 0:
                        break
                    if time.monotonic() >= deadline:
                        raise RuntimeError('Isolated default-user startup probe failed: '+name)
                    time.sleep(2)
            finally:
                run(['docker', 'rm', '-f', container], check=False, capture_output=True)
        if build.get('test'):
            run(['docker', 'run', '--rm', '--user', '0', '--entrypoint', 'sh',
                 '-v', f'{root}:/repo:ro', '-w', '/repo/'+build.get('test_directory', build['context']),
                 '-e', 'PYTHONDONTWRITEBYTECODE=1', '-e', 'AWS_EC2_METADATA_DISABLED=true',
                 tag, '-ec', build['test']], check=True)
    return {'revision': revision, 'app': app, 'checks': 'passed', 'images': images}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('profile')
    parser.add_argument('--deploy-only', action='store_true')
    args = parser.parse_args()
    root = Path.cwd().resolve()
    profile = json.loads(Path(args.profile).read_text())
    revision = os.environ['GITHUB_SHA']
    if os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise ValueError('Only main may run the central release pipeline')
    if args.deploy_only:
        deploy(profile, root, revision)
        return
    receipt = execute(profile, root, revision)
    target = Path(os.environ.get('RUNNER_TEMP', tempfile.gettempdir())) / f"{profile['app']}-build-receipt.json"
    target.write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps(receipt), flush=True)


def deploy(profile, root, revision):
    safe_name(profile['app'])
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('A full Git commit SHA is required')
    validate = os.environ.get('GITHUB_TOKEN')
    repository = os.environ['GITHUB_REPOSITORY']
    request = urllib.request.Request(f'https://api.github.com/repos/{repository}/commits/main',
                                     headers={'Authorization': f'Bearer {validate}', 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        current = json.load(response)['sha']
    if current != revision:
        raise ValueError('A newer main commit exists; refusing a stale deployment')
    target = profile['deployment']
    safe_name(target['app'])
    if not re.fullmatch('ci-[A-Za-z0-9-]+', target['host']):
        raise ValueError('Invalid configured deployment host')
    ssh = ['ssh', '-F', '/srv/ci/runner/deploy-keys/ssh_config', target['host']]
    state = json.loads(subprocess.check_output([*ssh, 'preflight', target['app'], revision], text=True))
    if not state['deploy_enabled']:
        raise ValueError('Production source reconciliation is still required for '+target['app'])
    baseline = state.get('baseline_revision')
    if not baseline:
        raise ValueError('No verified baseline revision is configured')
    subprocess.run(['git', 'merge-base', '--is-ancestor', baseline, revision], cwd=root, check=True)
    changed = subprocess.check_output(['git', 'diff', '--name-only', baseline, revision], cwd=root, text=True).splitlines()
    protected = ('db/', 'deploy/', 'k8s/', 'ai/migrations/', 'scripts/migrate')
    if any(name.startswith(protected) for name in changed):
        raise ValueError('Schema or deployment configuration changed; a migration-aware release is required')
    images = [f"central-ci/{profile['app']}-{build['name']}:{revision}" for build in profile['builds']]
    producer = subprocess.Popen(['docker', 'save', *images], stdout=subprocess.PIPE)
    try:
        consumer = subprocess.run([*ssh, 'deploy', target['app'], revision], stdin=producer.stdout)
    finally:
        producer.stdout.close()
    produced = producer.wait()
    if produced or consumer.returncode:
        raise RuntimeError('Image transfer or deployment failed')


if __name__ == '__main__':
    main()
