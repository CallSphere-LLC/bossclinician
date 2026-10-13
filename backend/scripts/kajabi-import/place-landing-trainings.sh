#!/usr/bin/env bash
# Kajabi landing-page trainings -> Boss Clinician media (migration 111).
#
#   /on-demand-audit-your-private-practice  Wistia 6hcqynp7xd  "Audit Proof Your Practice" (1080p, 4492 s)
#   /replay-documentation                   Wistia k6qwlw67nj  "The Do's & Don'ts of Clinical Documentation" (720p max, 13116 s)
#
# Wistia dies with the Kajabi account, so the files are copied here once:
#   1. download the best mp4 (<= 1080p) and the page posters into $WORK
#      (URLs from https://fast.wistia.com/embed/medias/<id>.json);
#   2. place them in the host upload volumes (the source tree the 10-04 S3
#      migration copied from, mounted in the pod at /app/uploads[-protected]);
#   3. upload each to the media bucket from inside the backend container with
#      S3MediaStore.putFile(..., createOnly = true): a key that already exists
#      is refused by S3 (IfNoneMatch "*"), so nothing is ever overwritten.
#
# Every key is new and carries the "landing-" prefix, so import.mjs (which owns
# "kajabi-<hash>") never mistakes them for its own. Migration 111 writes the
# media_assets / course / lesson rows that reference these exact names.
# No database writes, no deletes. Re-runnable: finished steps are skipped.
#
# Usage on server-64gbRam:  bash backend/scripts/kajabi-import/place-landing-trainings.sh
set -euo pipefail

WORK=${WORK:-/var/tmp/kajabi-trainings-1013}
PUBLIC=${UPLOAD_DIR:-/var/lib/docker/volumes/bossclinician_uploads_data/_data}
PROTECTED=${PROTECTED_UPLOAD_DIR:-/var/lib/docker/volumes/bossclinician_protected_uploads_data/_data}
NS=${NS:-bossclinician}
REPO=$(cd "$(dirname "$0")/../../.." && pwd)

W=https://embed-ssl.wistia.com/deliveries
K=https://kajabi-storefronts-production.kajabi-cdn.com/kajabi-storefronts-production/file-uploads/themes
# local name | source URL
DOWNLOADS=(
  "audit-1080p.mp4|$W/998c7a0327a62482e18e080995541f77a68c6fe7.bin"
  "replay-720p.mp4|$W/b23ae481268ffacfd15db925b6089cb827566e54.bin"
  "audit-poster.png|$K/2163586308/settings_images/6ab6323-808c-31a3-b7e-23cfcac7ad8_Facebook_Banner_from_Karen_39_.png"
  "replay-poster.jpg|$K/2164638722/settings_images/148e2-4a0e-0ed0-1a3e-16f3d30607_DosDonts_Documentation.jpg"
)
# local source | visibility | stored name | mime
PLACE=(
  "$WORK/audit-1080p.mp4|public|landing-audit-proof-on-demand-1080p.mp4|video/mp4"
  "$WORK/replay-720p.mp4|public|landing-dos-and-donts-documentation-replay-720p.mp4|video/mp4"
  "$WORK/audit-poster.png|public|landing-audit-proof-on-demand-poster.png|image/png"
  "$WORK/replay-poster.jpg|public|landing-dos-and-donts-documentation-replay-poster.jpg|image/jpeg"
  "$REPO/frontend/public/downloads/audit-proof-note-template.pdf|protected|landing-audit-proof-note-template.pdf|application/pdf"
  # The two worksheets the Do's & Don'ts workshop used live (her Google Docs, as on /dos-and-donts-ty).
  "$REPO/frontend/public/downloads/practice-progress-note-template.docx|protected|landing-practice-progress-note-template.docx|application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  "$REPO/frontend/public/downloads/practice-treatment-plan-template.docx|protected|landing-practice-treatment-plan-template.docx|application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)

mkdir -p "$WORK"
for d in "${DOWNLOADS[@]}"; do
  name=${d%%|*}; url=${d#*|}
  [ -s "$WORK/$name" ] && continue
  curl -sS --fail -L --retry 3 -o "$WORK/$name.part" "$url"
  mv "$WORK/$name.part" "$WORK/$name"
done

for f in "$WORK/audit-1080p.mp4" "$WORK/replay-720p.mp4"; do
  ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of csv=p=0 "$f" | tr '\n' ' '; echo " $f"
done

POD=$(sudo -n kubectl -n "$NS" get pod -l app=boss-app --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}')
for p in "${PLACE[@]}"; do
  IFS='|' read -r src vis name mime <<<"$p"
  if [ "$vis" = protected ]; then dir=$PROTECTED; ref="protected:$name"; inpod=/app/uploads-protected/$name; mode=640
  else dir=$PUBLIC; ref="/uploads/$name"; inpod=/app/uploads/$name; mode=644; fi
  if ! sudo -n test -s "$dir/$name"; then
    sudo -n test -d "$dir/.parts" || sudo -n install -d -o 1000 -g 1000 "$dir/.parts"
    sudo -n install -o 1000 -g 1000 -m "$mode" "$src" "$dir/.parts/$name.part"
    sudo -n mv -n "$dir/.parts/$name.part" "$dir/$name"
  fi
  sudo -n kubectl -n "$NS" exec "$POD" -c backend -- node -e '
    const { mediaStore } = require("/app/dist/services/objectStorage.js");
    const [ref, file, mime] = process.argv.slice(1);
    (async () => {
      const store = mediaStore();
      const have = await store.head(ref);
      if (have) { console.log(`exists ${ref} (${have.size} bytes)`); return; }
      await store.putFile(ref, file, mime, true);
      const now = await store.head(ref);
      console.log(`uploaded ${ref} (${now && now.size} bytes)`);
    })().catch((e) => { console.error(`FAILED ${ref}: ${e.message}`); process.exit(1); });
  ' "$ref" "$inpod" "$mime"
done
