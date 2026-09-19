#!/usr/bin/env python3
"""Hash actual deployment inputs, including new/uncommitted files, without secrets."""
import hashlib
import json
import subprocess
from pathlib import Path

root=Path(__file__).resolve().parents[1]
paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=root).decode().split('\0')
roots={'backend','frontend','ai','shared','nginx','k8s','scripts'}
files={}
for name in sorted(set(paths)):
    path=Path(name)
    if not name or (path.parts[0] not in roots and name not in {'.dockerignore','docker-compose.yml'}): continue
    if any(part=='.env' or part.startswith('.env.') or part in {'node_modules','dist','dist-dev','__pycache__'} for part in path.parts): continue
    full=root/path
    if full.is_file(): files[name]=hashlib.sha256(full.read_bytes()).hexdigest()
canonical=''.join(f'{name}\0{digest}\n' for name,digest in files.items()).encode()
print(json.dumps({'sourceSha256':hashlib.sha256(canonical).hexdigest(),'files':files},indent=2,sort_keys=True))
