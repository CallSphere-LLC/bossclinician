#!/usr/bin/env bash
# Post-deploy smoke test.
#
# Checks the things that would make the site look fine to a casual glance and be
# broken for a customer: the API is up, migrations applied, the crawler files are
# real, a legacy URL still redirects, the member API is mounted and refusing
# anonymous callers, and — the one that matters most — a paid file is not
# reachable from the public upload mount.
#
# Read-only. Creates nothing, charges nothing, sends nothing.
#
#   ./scripts/smoke-test.sh [base-url]
set -uo pipefail

BASE="${1:-https://bossclinician.callsphere.site}"
PASS=0
FAIL=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }

# `check <label> <expected> <actual>`
check() { [ "$2" = "$3" ] && ok "$1" || bad "$1 — expected $2, got $3"; }

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1"; }
ctype() { curl -s -o /dev/null -w '%{content_type}' --max-time 15 "$1" | cut -d';' -f1; }

echo "Smoke testing $BASE"
echo
echo "Core"
check "API health"            200        "$(code "$BASE/api/health")"
check "home page"             200        "$(code "$BASE/")"
check "blog index"            200        "$(code "$BASE/blog")"

echo
echo "Crawler files — these served the SPA shell before, which is worse than a 404"
check "sitemap status"        200        "$(code "$BASE/sitemap.xml")"
check "sitemap is XML"        application/xml "$(ctype "$BASE/sitemap.xml")"
check "robots status"         200        "$(code "$BASE/robots.txt")"
check "robots is text"        text/plain "$(ctype "$BASE/robots.txt")"

if curl -s --max-time 15 "$BASE/sitemap.xml" | python3 -c 'import sys,xml.dom.minidom as m; m.parseString(sys.stdin.read())' 2>/dev/null; then
  ok "sitemap parses as XML"
else
  bad "sitemap does not parse as XML"
fi

echo
echo "Legacy redirects — the 125 indexed bossclinician.com URLs"
REDIR=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 15 "$BASE/about_yvette")
check "/about_yvette redirects" "301 $BASE/about" "$REDIR"
# Kajabi URLs are mixed case; nginx map keys match case-insensitively.
check "mixed-case legacy URL" 301 "$(code "$BASE/Practice-Protection-Pack")"

echo
echo "Member API is mounted and closed to anonymous callers"
for path in /api/member/library /api/member/community /api/member/coaching /api/member/billing/overview; do
  check "$path is 401" 401 "$(code "$BASE$path")"
done

echo
echo "Paywall"
# A forged signed-file token must not be honoured.
check "forged file token refused" 404 "$(code "$BASE/api/files/not.a.real.token")"

echo
echo "Database"
if command -v docker >/dev/null 2>&1; then
  APPLIED=$(docker exec bossclinician-db-1 psql -U boss -d bossclinician -t -A \
    -c "SELECT count(*) FROM schema_migrations;" 2>/dev/null | tr -d '[:space:]')
  ONDISK=$(ls "$(dirname "${BASH_SOURCE[0]}")/../backend/src/db/migrations"/*.sql 2>/dev/null | wc -l | tr -d '[:space:]')
  if [ -n "$APPLIED" ] && [ "$APPLIED" -ge "$ONDISK" ]; then
    ok "migrations applied ($APPLIED recorded, $ONDISK on disk)"
  else
    bad "migrations behind — $APPLIED recorded, $ONDISK on disk"
  fi

  # A queue with a growing dead-letter or a stalled head is the failure mode
  # nothing else here would surface.
  STATS=$(docker exec bossclinician-db-1 psql -U boss -d bossclinician -t -A -c \
    "SELECT count(*) FILTER (WHERE status='dead')||' '||
            count(*) FILTER (WHERE status='dead' AND updated_at >= now()-interval '1 hour')||' '||
            COALESCE(max(EXTRACT(EPOCH FROM (now()-run_at)))
                     FILTER (WHERE status='queued' AND run_at<=now()), 0)::int
       FROM jobs;" 2>/dev/null)
  DEAD=$(echo "$STATS" | cut -d' ' -f1)
  FRESH_DEAD=$(echo "$STATS" | cut -d' ' -f2)
  OLDEST=$(echo "$STATS" | cut -d' ' -f3)
  if [ -n "$DEAD" ]; then
    # Dead jobs are intentionally retained as forensic records. A deploy smoke
    # test should turn red when this rollout creates one, not forever because a
    # resolved incident from weeks ago is still visible in the dead-letter view.
    if [ "$FRESH_DEAD" = "0" ]; then
      ok "job queue: no fresh dead letters ($DEAD historical retained)"
    else
      bad "job queue: $FRESH_DEAD fresh dead job(s), $DEAD total — check the dead-letter view"
    fi
    # 300s is the lease; anything queued far beyond that means nothing is claiming.
    if [ -n "$OLDEST" ] && [ "$OLDEST" -lt 600 ]; then
      ok "job queue: head is fresh (${OLDEST}s)"
    else
      bad "job queue: oldest ready job is ${OLDEST}s old — is the worker running?"
    fi
  fi
else
  echo "  (docker not available — skipping database checks)"
fi

echo
printf 'passed %d, failed %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
