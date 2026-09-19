#!/usr/bin/env bash
# Switch the existing public/admin ingress service only after preview is healthy.
# Redirected snapshots intentionally belong to the invoking user.
# shellcheck disable=SC2024
set -euo pipefail
cd "$(dirname "$0")/.."
release="${1:?release required}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
preview=$(sudo -n kubectl -n bossclinician get svc boss-web-preview -o jsonpath='{.spec.clusterIP}')
verify() {
  curl -fsS --max-time 30 -H 'Host: bossclinician.callsphere.site' "$1/api/health" | python3 -c 'import json,sys; assert json.load(sys.stdin).get("release") == sys.argv[1], "release mismatch"' "$release"
}
verify "http://$preview"
curl -fsS --max-time 30 -H 'Host: admin.bossclinician.callsphere.site' "http://$preview/admin" >/dev/null
sudo -n kubectl -n bossclinician get svc boss-web -o json > "$work/service.json"
sudo -n kubectl -n bossclinician get endpoints boss-web -o json > "$work/endpoints.json" 2>/dev/null || true
sudo -n kubectl -n bossclinician patch service boss-web --type merge -p '{"spec":{"selector":{"app":"boss-app"},"ports":[{"name":"http","port":80,"targetPort":8080,"protocol":"TCP"}]}}'
healthy=0
for _attempt in $(seq 1 15); do
  if verify 'https://bossclinician.callsphere.site' && curl -fsS --max-time 30 'https://admin.bossclinician.callsphere.site/admin' >/dev/null; then healthy=1; break; fi
  sleep 2
done
if [[ "$healthy" != 1 ]]; then
  python3 - "$work" <<'PY'
import json, subprocess, sys
from pathlib import Path
root=Path(sys.argv[1]); service=json.loads((root/'service.json').read_text())
spec=service['spec']; spec.setdefault('selector',None)
subprocess.run(['sudo','-n','kubectl','-n','bossclinician','patch','service','boss-web','--type','merge','-p',json.dumps({'spec':spec})],check=True)
ep=root/'endpoints.json'
if ep.stat().st_size and not spec.get('selector'):
    obj=json.loads(ep.read_text()); obj['metadata']={'name':'boss-web','namespace':'bossclinician'}
    subprocess.run(['sudo','-n','kubectl','apply','-f','-'],input=json.dumps(obj),text=True,check=True)
PY
  echo 'Public verification failed; service routing restored.' >&2
  exit 1
fi
sudo -n install -m 644 k8s/bossclinician-image-prune.service /etc/systemd/system/
sudo -n install -m 644 k8s/bossclinician-image-prune.timer /etc/systemd/system/
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now bossclinician-image-prune.timer
sudo -n python3 scripts/prune-k3s-images.py || echo 'WARN: retention failed; release remains healthy' >&2
echo "Live K3s release verified: $release"
