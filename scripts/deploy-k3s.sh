#!/usr/bin/env bash
# Direct local-source release; does not fetch, commit or push Git.
# Redirected snapshots intentionally belong to the invoking user.
# shellcheck disable=SC2024
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-deploy}"
case "$mode" in deploy|stage) ;; *) echo 'usage: deploy-k3s.sh [stage|deploy]' >&2; exit 2;; esac
if [[ "$mode" == stage ]] && [[ "$(sudo -n kubectl -n bossclinician get svc boss-web -o jsonpath='{.spec.selector.app}')" == boss-app ]]; then
  echo 'Stage is only for the initial migration; use deploy for subsequent K3s releases.' >&2
  exit 2
fi
mkdir -p /run/lock/callsphere
exec 9>/run/lock/callsphere/build.lock
flock -w 1800 9
release="${APP_RELEASE:-$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)}"
[[ "$release" =~ ^[a-z0-9]([a-z0-9-]{0,89}[a-z0-9])?$ ]] || exit 2
for component in backend frontend ai gateway; do
  if docker image inspect "bossclinician-k3-$component:$release" >/dev/null 2>&1; then
    echo "Release $release already exists; choose a new immutable release ID." >&2
    exit 2
  fi
done
export BUILDX_BUILDER=default
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
python3 scripts/release-source-manifest.py > "$work/source-manifest.json"
source_hash=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sourceSha256"])' "$work/source-manifest.json")
echo "Building source SHA256: $source_hash"
# Extract only the public build key; never print or source secret env files.
public_key=$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["frontend"]["build"]["args"].get("VITE_STRIPE_PUBLISHABLE_KEY", ""))')
for target in api web; do
  component=backend; [[ "$target" == web ]] && component=frontend
  docker build --label "io.bossclinician.source-sha256=$source_hash" --target "$target" -f backend/Dockerfile --build-arg "APP_RELEASE=$release" --build-arg VITE_API_BASE=/api --build-arg "VITE_STRIPE_PUBLISHABLE_KEY=$public_key" -t "bossclinician-k3-$component:$release" .
done
docker build --label "io.bossclinician.source-sha256=$source_hash" -t "bossclinician-k3-ai:$release" ai
docker build --label "io.bossclinician.source-sha256=$source_hash" -f k8s/gateway.Dockerfile -t "bossclinician-k3-gateway:$release" .
python3 scripts/release-source-manifest.py > "$work/source-after-build.json"
if ! cmp -s "$work/source-manifest.json" "$work/source-after-build.json"; then
  echo 'Deployment source changed during build; refusing to roll out mixed source. Retry after edits finish.' >&2
  exit 1
fi
sudo -n install -d -m 755 "/var/lib/bossclinician/releases/$release"
sudo -n install -m 644 "$work/source-manifest.json" "/var/lib/bossclinician/releases/$release/source-manifest.json"
for component in backend frontend ai gateway; do
  docker save "bossclinician-k3-$component:$release" | sudo -n k3s ctr images import -
done
# Migrations run at API startup: preserve a consistent database backup first.
sudo -n install -d -m 700 /var/backups/bossclinician
backup="/var/backups/bossclinician/pre-k3s-$release.dump"
docker compose exec -T db pg_dump -U boss -d bossclinician -Fc | sudo -n tee "$backup" >/dev/null
sudo -n chmod 600 "$backup"
sudo -n test -s "$backup"
echo "Database backup saved: $backup"
# Only starts the private bridge. Existing Postgres and volumes are untouched.
docker compose -f docker-compose.yml -f k8s/docker-compose.data.yml up -d --no-deps db-bridge
sudo -n kubectl -n bossclinician get deployment boss-app -o json > "$work/previous-app.json" 2>/dev/null || true
sudo -n kubectl -n bossclinician get deployment boss-ai -o json > "$work/previous-ai.json" 2>/dev/null || true
for component in app ai; do
  if [[ -s "$work/previous-$component.json" ]]; then
    python3 - "$work/previous-$component.json" <<'PY_SNAPSHOT'
import json,sys
p=sys.argv[1]; o=json.load(open(p)); o.pop('status',None)
for key in ['uid','resourceVersion','generation','creationTimestamp','managedFields']: o['metadata'].pop(key,None)
with open(p,'w') as f: json.dump(o,f)
PY_SNAPSHOT
  fi
done
restore() {
  for component in app ai; do
    if [[ -s "$work/previous-$component.json" ]]; then
      sudo -n kubectl apply -f "$work/previous-$component.json" || true
      sudo -n kubectl -n bossclinician rollout status "deployment/boss-$component" --timeout=300s || true
    fi
  done
  echo 'Release failed; previous deployment restored where available.' >&2
}
trap 'restore' ERR
python3 scripts/deploy-k3s-render.py "$release" > "$work/workloads.json"
sudo -n kubectl apply -f "$work/workloads.json"
if ! sudo -n kubectl -n bossclinician rollout status deployment/boss-ai --timeout=600s || ! sudo -n kubectl -n bossclinician rollout status deployment/boss-app --timeout=600s; then
  for component in app ai; do
    if [[ -s "$work/previous-$component.json" ]]; then
      sudo -n kubectl apply -f "$work/previous-$component.json"
    fi
  done
  echo 'Rollout failed; previous deployment restored where available.' >&2
  exit 1
fi
preview=$(sudo -n kubectl -n bossclinician get service boss-web-preview -o jsonpath='{.spec.clusterIP}')
actual=$(curl -fsS --retry 15 --retry-delay 2 --retry-all-errors --max-time 15 -H 'Host: bossclinician.callsphere.site' "http://$preview/api/health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("release", ""))')
[[ "$actual" == "$release" ]] || { echo 'Release health mismatch' >&2; restore; exit 1; }
if [[ "$mode" == stage ]]; then
  trap - ERR
  echo "Staged release $release at http://$preview; production selector unchanged."
  exit 0
fi
scripts/k3s-cutover.sh "$release"
trap - ERR
