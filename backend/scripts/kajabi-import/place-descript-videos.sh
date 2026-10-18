#!/usr/bin/env bash
# Two Descript recordings -> Boss Clinician media (migration 122). QA sheet
# rows 93 and 94, 15 Oct 2026.
#
#   share.descript.com/view/Z8lLBnUYfkk  "How to Prepare for a Private Practice of Your Own"
#       -> /uploads/landing-practice-prep-training-720p.mp4   (/preparing-for-pp-video)
#   share.descript.com/view/bN8cgjQ1QqX  "How to Create a Private Practice That Supports
#       Your Income, Energy and Future" (the Freedom Masterclass)
#       -> /uploads/landing-freedom-masterclass-720p.mp4      (/watch-now)
#
# Same shape as place-landing-trainings.sh (migration 111):
#   1. take each published Descript project's download (a 1080p H.264 MP4 with
#      the moov atom at the end) and re-encode it once to a 720p H.264/AAC MP4
#      with +faststart, so it starts playing before it has finished loading —
#      the recordings are slides with a webcam bubble, ~75 MB and ~106 MB;
#   2. place each in the host upload volume (mounted in the pod at /app/uploads);
#   3. upload each to the media bucket from inside the backend container with
#      S3MediaStore.putFile(..., createOnly = true): a key that already exists
#      is refused by S3, so nothing is ever overwritten.
#
# Run this BEFORE migration 122 is applied: the migration points the
# masterclass setting and two media_assets rows at these exact names.
# No database writes, no deletes. Re-runnable: finished steps are skipped.
#
# Usage on server-64gbRam:  bash backend/scripts/kajabi-import/place-descript-videos.sh
set -euo pipefail

WORK=${WORK:-/var/tmp/bc-1017/video}
PUBLIC=${UPLOAD_DIR:-/var/lib/docker/volumes/bossclinician_uploads_data/_data}
NS=${NS:-bossclinician}

# local name | Descript share id
SOURCES=(
  "descript1|Z8lLBnUYfkk"
  "descript2|bN8cgjQ1QqX"
)
# local file | stored name
PLACE=(
  "$WORK/descript1-720.mp4|landing-practice-prep-training-720p.mp4"
  "$WORK/descript2-720.mp4|landing-freedom-masterclass-720p.mp4"
)

mkdir -p "$WORK"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"
for s in "${SOURCES[@]}"; do
  name=${s%%|*}; id=${s#*|}
  if [ ! -s "$WORK/$name-720.mp4" ]; then
    if [ ! -s "$WORK/$name.raw" ]; then
      # The share page carries a signed download link for the published project.
      url=$(curl -sS --fail -L -A "$UA" "https://share.descript.com/view/$id" \
        | grep -oE 'https://api\.descript\.com/v2/published_projects/[^"]+/download\?[^"]+' | head -1 | sed 's/&amp;/\&/g')
      [ -n "$url" ] || { echo "no download link on share page $id" >&2; exit 1; }
      curl -sS --fail -L --retry 3 -o "$WORK/$name.raw.part" "$url"
      mv "$WORK/$name.raw.part" "$WORK/$name.raw"
    fi
    nice -n 10 ffmpeg -nostdin -hide_banner -loglevel error -y -i "$WORK/$name.raw" \
      -map 0:v:0 -map 0:a:0 -vf "scale=-2:720" -c:v libx264 -preset medium -crf 24 \
      -profile:v high -pix_fmt yuv420p -threads 8 -c:a aac -b:a 128k -ac 2 \
      -movflags +faststart "$WORK/$name-720.part.mp4"
    mv "$WORK/$name-720.part.mp4" "$WORK/$name-720.mp4"
  fi
  ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height -of csv=p=0 "$WORK/$name-720.mp4" | tr '\n' ' '; echo " $name"
done

POD=$(sudo -n kubectl -n "$NS" get pod -l app=boss-app --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}')
for p in "${PLACE[@]}"; do
  IFS='|' read -r src name <<<"$p"
  ref="/uploads/$name"; inpod=/app/uploads/$name
  if ! sudo -n test -s "$PUBLIC/$name"; then
    sudo -n test -d "$PUBLIC/.parts" || sudo -n install -d -o 1000 -g 1000 "$PUBLIC/.parts"
    sudo -n install -o 1000 -g 1000 -m 644 "$src" "$PUBLIC/.parts/$name.part"
    sudo -n mv -n "$PUBLIC/.parts/$name.part" "$PUBLIC/$name"
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
  ' "$ref" "$inpod" "video/mp4"
done
