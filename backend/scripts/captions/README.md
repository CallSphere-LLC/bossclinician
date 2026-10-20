# Lesson captions (QA sheet row 241)

`captions.mjs` writes English closed captions (WebVTT) for course lesson videos and
fills the lesson's plain-text transcript, using OpenAI `whisper-1`.

## What it does, per lesson with a video and an empty `captions_url`

1. Fingerprints the video in S3 (byte size + sha256 of the first and last MiB), so
   a video uploaded twice (courses 52 and 53 carry the same lessons as separate
   files) is transcribed once.
2. Downloads it from the media bucket to `/var/tmp/bc-1020/captions-tmp`, extracts
   mono 16 kHz 32 kbps mp3 audio, deletes the video.
3. A clip whose loudest sample is under -45 dB gets a header-only VTT (no API call:
   Whisper invents "Thank you." over silence).
4. Cuts the audio into pieces of at most 20 minutes, at a silence between minute 15
   and 20 of each piece, and sends each to `whisper-1` (`verbose_json`, segment +
   word timestamps, `language=en`, a domain prompt plus the tail of the previous
   piece). Each response is cached as `captions-cache/<fingerprint>/seg-N.json`
   before it is used, so a crash never re-bills a piece.
5. Adds each piece's offset back, drops segments that look invented over silence
   (`no_speech_prob`/`avg_logprob`), and re-flows into cues of at most two lines of
   42 characters and 7 seconds, timed from the word timestamps.
6. Validates the VTT (header, ordered, non-overlapping, line/length limits), stores
   it beside the video under the same scheme, SSE-KMS like every other media object:
   - `protected:<name>.mp4` -> `protected:<name>.vtt` (`media/protected/<name>.vtt`)
   - `/uploads/<name>.mp4` -> `/uploads/<name>.vtt` (`media/public/<name>.vtt`)
7. `UPDATE course_lessons SET captions_url = ..., transcript = <text if empty>
   WHERE id = ... AND captions_url = ''`. Nothing else in the row changes.

Lessons that already have `captions_url` are skipped, so it is safe to rerun.
Progress goes to `/var/tmp/bc-1020/captions.log`; a done/failed summary with billed
minutes to `/var/tmp/bc-1020/captions-summary.json`.

## Running it (server-64gbRam, as ubuntu)

Production shares the box, so always bound it:

```sh
cd ~/bc-sheet-1020
# one-time: AWS profile (the backend's Roles Anywhere identity; the cert dir is root-only)
sudo cat /var/lib/postgresql/business-aws-identities/bossclinician/media/aws-config.host \
  | sed 's#credential_process = /usr#credential_process = sudo -n /usr#' > /var/tmp/bc-1020/aws-config
chmod 600 /var/tmp/bc-1020/aws-config
# one-time: KMS key ARN and OpenAI key from the live backend secret (never echo them)
S=$(sudo kubectl -n bossclinician get deploy boss-app -o jsonpath='{.spec.template.spec.containers[0].envFrom[0].secretRef.name}')
sudo kubectl -n bossclinician get secret $S -o jsonpath='{.data.MEDIA_STORAGE_KMS_KEY}' | base64 -d > /var/tmp/bc-1020/kms-arn
(umask 077; sudo kubectl -n bossclinician get secret $S -o jsonpath='{.data.OPENAI_API_KEY}' | base64 -d > /var/tmp/bc-1020/openai.key)

# specific lessons, in the foreground
systemd-run --user --scope -p MemoryMax=3G -p CPUQuota=200% nice -n 10 \
  node backend/scripts/captions/captions.mjs --lessons 306,308

# everything still uncaptioned, in the background
systemd-run --user --unit=bc-captions -p MemoryMax=3G -p CPUQuota=200% -p Nice=10 \
  --working-directory=$PWD /usr/bin/node backend/scripts/captions/captions.mjs --all

node backend/scripts/captions/captions.mjs --check 306     # validate the stored VTT, print sample cues
node backend/scripts/captions/captions.mjs --all --dry-run # plan only

# a local file (marketing video), no S3 or DB
node backend/scripts/captions/captions.mjs --media frontend/public/videos/x.mp4 \
  --out frontend/public/videos/captions/x.en.vtt [--transcript x.txt]

shred -u /var/tmp/bc-1020/openai.key   # when done
```

Flags: `--limit N`, `--force-upload` (re-put a VTT object that already exists),
`--rebuild` (with `--all`/`--lessons`: re-cut lessons this script already captioned
from the cached transcription, e.g. after a change to the cue builder or filters; no
API calls for cached pieces; re-stores the VTT only if it changed and replaces the
transcript only while it is still exactly the previously generated one).

Whisper fills long silences (breaks in a live workshop) with a repeated "Okay." or
"Thank you." every 30 s; segments Whisper rates as probably-not-speech and runs of
three or more identical short segments are dropped.

Cost: whisper-1 is $0.006 per audio minute; deduplicated and cached pieces are free.

## Serving

Nothing new is needed on the server side. `library.ts` already signs
`captions_url` as kind `lesson-captions` (two-hour stream TTL, entitlement re-checked
per request by `downloads.ts`), and `serveStoredMedia` sets the Content-Type from the
extension, so `.vtt` goes out as `text/vtt`. A public `/uploads/...vtt` reference is
handed to the player unsigned, like the public video beside it. The links are
same-origin, so `<track>` needs no `crossorigin` attribute and no CORS headers.
