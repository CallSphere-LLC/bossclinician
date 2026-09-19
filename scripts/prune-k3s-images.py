#!/usr/bin/env python3
"""Remove only Boss K3 image refs unused by all cluster workloads or containers.

Retain the newest three release tags per component plus every referenced image,
including scaled-down ReplicaSets for rollback. Never prune volumes or caches.
"""
import argparse, json, subprocess
from collections import defaultdict
parser=argparse.ArgumentParser(); parser.add_argument('--dry-run',action='store_true'); args=parser.parse_args()
def run(*cmd): return subprocess.check_output(cmd,text=True)
def normalize(ref):
    if '/' not in ref: return 'docker.io/library/'+ref
    return ref
protected=set()
def collect(obj):
    if isinstance(obj,dict):
        for key,value in obj.items():
            if key=='image' and isinstance(value,str): protected.add(normalize(value))
            else: collect(value)
    elif isinstance(obj,list):
        for value in obj: collect(value)
collect(json.loads(run('kubectl','get','pods,deployments,statefulsets,daemonsets,replicasets,jobs,cronjobs','-A','-o','json')))
ids=run('docker','ps','-aq').split()
if ids:
    for c in json.loads(run('docker','inspect',*ids)): protected.add(normalize(c['Config']['Image']))
refs=run('k3s','ctr','images','list','-q').split()
docker_refs=run('docker','images','--format','{{.Repository}}:{{.Tag}}').split()
allrefs=set(refs)|{normalize(r) for r in docker_refs}
groups=defaultdict(list)
for ref in allrefs:
    if ref.startswith('docker.io/library/bossclinician-k3-') and '@' not in ref:
        groups[ref.rsplit(':',1)[0]].append(ref)
for items in groups.values(): protected.update(sorted(items,reverse=True)[:3])
for ref in sorted(set().union(*[set(x) for x in groups.values()]) if groups else set()):
    if ref in protected: continue
    print(('Would remove ' if args.dry_run else 'Remove ')+ref)
    if not args.dry_run:
        if ref in refs: subprocess.run(['k3s','ctr','images','rm',ref],check=True)
        short=ref.removeprefix('docker.io/library/')
        if short in docker_refs or ref in docker_refs:
            subprocess.run(['docker','image','rm',short],check=True)
print(f'Retention checked {sum(map(len,groups.values()))} Boss K3 refs; kept current workloads, containers and three newest tags per component.')
