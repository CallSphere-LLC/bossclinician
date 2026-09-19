#!/usr/bin/env python3
"""Keep immutable browser modules available to tabs opened before a release."""
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

ARCHIVE = Path('/var/lib/bossclinician/browser-assets/assets')
PREFIX = 'bossclinician-k3-frontend:'

def merge_assets(source, destination, now=None):
    now = time.time() if now is None else now
    destination.mkdir(parents=True, exist_ok=True)
    count = 0
    for file in source.rglob('*'):
        if file.is_symlink():
            raise ValueError('Browser assets must not contain symlinks')
        if not file.is_file():
            continue
        target = destination / file.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if hashlib.sha256(file.read_bytes()).digest() != hashlib.sha256(target.read_bytes()).digest():
                raise ValueError(f'Immutable asset collision: {file.name}')
        else:
            temporary = target.with_name(target.name + '.tmp')
            shutil.copyfile(file, temporary)
            temporary.chmod(0o644)
            temporary.replace(target)
        os.utime(target, (now, now))
        count += 1
    return count

def prune_assets(destination, now=None):
    now = time.time() if now is None else now
    for file in destination.rglob('*'):
        if file.is_file() and file.stat().st_mtime < now - 30 * 86400:
            file.unlink()

def main():
    refs = subprocess.check_output(['docker','images','--format','{{.Repository}}:{{.Tag}}'], text=True).splitlines()
    refs = sorted({r for r in refs if re.fullmatch(r'bossclinician-k3-frontend:[a-z0-9][a-z0-9-]+',r)})
    if not refs:
        raise RuntimeError('No frontend images available to preserve')
    total = 0
    for ref in refs:
        container = subprocess.check_output(['docker','create',ref],text=True).strip()
        try:
            with tempfile.TemporaryDirectory(prefix='boss-browser-assets-') as work:
                subprocess.run(['docker','cp',f'{container}:/usr/share/nginx/html/assets',work],check=True,stdout=subprocess.DEVNULL)
                total += merge_assets(Path(work)/'assets',ARCHIVE)
        finally:
            subprocess.run(['docker','rm',container],check=True,stdout=subprocess.DEVNULL)
    # Current and rollback image files were just refreshed; only abandoned
    # hashes beyond the retention window can be removed.
    prune_assets(ARCHIVE)
    print(f'Preserved {total} browser assets from {len(refs)} frontend images')

if __name__ == '__main__':
    main()
