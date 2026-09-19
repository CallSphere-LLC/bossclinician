#!/usr/bin/env python3
"""Render non-secret workloads; feed effective Compose env directly to kubectl."""
import json, os, subprocess, sys
from pathlib import Path

def run(*args, **kw):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kw).stdout

def apply(obj):
    run('sudo', '-n', 'kubectl', 'apply', '-f', '-', input=json.dumps(obj))

release = sys.argv[1]
ns = 'bossclinician'
node = run('sudo', '-n', 'kubectl', 'get', 'nodes', '-o', 'jsonpath={.items[0].metadata.name}').strip()
config = json.loads(run('docker', 'compose', 'config', '--format', 'json'))
for name in ('backend', 'ai'):
    env = {k: str(v) for k, v in config['services'][name]['environment'].items() if v is not None}
    if name == 'backend':
        # Credentials retain their Compose encoding; only change the DB address.
        env['DATABASE_URL'] = env['DATABASE_URL'].replace('@db:5432/', '@10.42.0.1:15432/')
        env['AI_BASE_URL'] = 'http://ai:8000'
        env['APP_RELEASE'] = release
    apply({'apiVersion': 'v1', 'kind': 'Secret', 'metadata': {'name': f'boss-{name}-env-{release}', 'namespace': ns}, 'immutable': True, 'type': 'Opaque', 'stringData': env})

def probe(port, path):
    return {'httpGet': {'port': port, 'path': path}, 'periodSeconds': 10, 'timeoutSeconds': 5, 'failureThreshold': 6}

def container(name, component, port, path, memory, env=False):
    c = {'name': name, 'image': f'docker.io/library/bossclinician-k3-{component}:{release}', 'imagePullPolicy': 'Never', 'ports': [{'containerPort': port}], 'resources': {'requests': {'cpu': '25m', 'memory': '32Mi'}, 'limits': {'memory': memory}}, 'securityContext': {'allowPrivilegeEscalation': False}, 'readinessProbe': probe(port,path), 'livenessProbe': probe(port,path), 'startupProbe': {**probe(port,path), 'failureThreshold': 60}}
    if env: c['envFrom'] = [{'secretRef': {'name': f'boss-{name}-env-{release}'}}]
    return c

backend = container('backend', 'backend', 4000, '/api/health', '1024Mi', True)
backend['volumeMounts'] = [{'name': 'uploads', 'mountPath': '/app/uploads'}, {'name': 'protected', 'mountPath': '/app/uploads-protected'}]
backend['securityContext']['runAsUser'] = 1000
backend['securityContext']['runAsNonRoot'] = True
volumes = []
for name, docker_name in [('uploads', 'bossclinician_uploads_data'), ('protected', 'bossclinician_protected_uploads_data')]:
    path = run('docker', 'volume', 'inspect', docker_name, '--format', '{{.Mountpoint}}').strip()
    volumes.append({'name': name, 'hostPath': {'path': path, 'type': 'Directory'}})

objects = []
frontend = container('frontend','frontend',80,'/index.html','96Mi')
frontend['volumeMounts'] = [{'name': 'browser-assets', 'mountPath': '/srv/browser-assets', 'readOnly': True}]
volumes.append({'name': 'browser-assets', 'hostPath': {'path': '/var/lib/bossclinician/browser-assets', 'type': 'Directory'}})
for name, containers, mounts in [
    ('boss-app', [backend, frontend, container('gateway','gateway',8080,'/api/health','96Mi')], volumes),
    ('boss-ai', [container('ai','ai',8000,'/health','512Mi',True)], [])
]:
    objects.append({'apiVersion':'apps/v1','kind':'Deployment','metadata':{'name':name,'namespace':ns},'spec':{'replicas':1,'revisionHistoryLimit':2,'progressDeadlineSeconds':600,'strategy':{'type':'RollingUpdate','rollingUpdate':{'maxUnavailable':0,'maxSurge':1}},'selector':{'matchLabels':{'app':name}},'template':{'metadata':{'labels':{'app':name},'annotations':{'bossclinician/release':release}},'spec':{'nodeSelector':{'kubernetes.io/hostname':node},'automountServiceAccountToken':False,'terminationGracePeriodSeconds':45,'containers':containers,'volumes':mounts}}}})
for name, selector, port, target in [('ai','boss-ai',8000,8000),('boss-web-preview','boss-app',80,8080)]:
    objects.append({'apiVersion':'v1','kind':'Service','metadata':{'name':name,'namespace':ns},'spec':{'selector':{'app':selector},'ports':[{'name':'http','port':port,'targetPort':target}]}})
print(json.dumps({'apiVersion':'v1','kind':'List','items':objects}))
