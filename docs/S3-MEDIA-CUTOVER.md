# Boss Clinician media storage cutover

The default remains local. No database URL rewrite or entitlement migration is required.

## Runtime configuration

```
MEDIA_STORAGE_STORE=s3
MEDIA_STORAGE_BUCKET=bossclinician-media-662904411994-us-west-2
MEDIA_STORAGE_REGION=us-west-2
MEDIA_STORAGE_ACCOUNT=662904411994
MEDIA_STORAGE_KMS_KEY=arn:aws:kms:us-west-2:662904411994:key/eb2cb28e-b2ff-44d4-87ba-3768b98e5e40
VOICE_RECORDING_STORE=local
AWS_PROFILE=bossclinician-media
AWS_CONFIG_FILE=/run/aws-identity/aws-config
```

`VOICE_RECORDING_STORE=local` retains the existing recording-key and signed admin route contract. With `MEDIA_STORAGE_STORE=s3`, this path sends finalized recordings through the new shared media adapter; it does not retain completed audio on disk. Do not select the older standalone `VOICE_RECORDING_STORE=s3` adapter for this rollout.

Mount only the dedicated Boss media Roles Anywhere identity read-only into the backend. The current backend UID and pod fsGroup are 1000. Include the separately verified `aws_signing_helper` in the candidate image and verify its libc compatibility. Never bake private identity keys into an image. Preserve the live security Dockerfile/deployment changes when assembling the candidate; this isolated worktree does not incorporate those unrelated live edits.

The role needs `GetObject`, `GetObjectVersion`, `PutObject`, `DeleteObject`, and `AbortMultipartUpload` on `media/*`, plus its KMS permissions. The adapter pins reads to the version returned by HEAD and uses If-Match. Runtime ListBucket is limited to the `media/*` prefix. Historical version deletion remains denied. All object writes/MPU creation explicitly supply SSE-KMS headers and the configured key. Bucket defaults alone are not relied upon.

## Object mapping

| Existing source | S3 key |
| --- | --- |
| Public upload root / relative file | `media/public/<relative file>` |
| Protected upload root / relative file | `media/protected/<relative file>` |
| Protected root / voice-recordings / relative file | `media/protected/voice-recordings/<relative file>` |

Database `/uploads/<key>` and `protected:<key>` values remain unchanged. Voice recording keys retain their existing `protected:<shard>/<id>.<extension>` format; the dedicated recording route maps them to the `voice-recordings` subdirectory.

Copy only completed regular files. Do not publish `.parts`, `.joining`, symlinks, device files or FIFO files. Validate every relative key against `objectKey` before rollout; invalid historical filenames require an explicit compatibility plan, not silent omission. Record source size/checksum and destination version/checksum in a protected migration manifest, and verify complete coverage before enabling the flag. No migration or source deletion is performed by this code change.

## Delivery and writes

Public URLs stay under `/uploads/`. Protected streams, downloads and admin previews stay behind existing authentication, signed tokens, account checks and entitlement/refund checks. Byte ranges and HEAD are proxied to private S3 objects; protected delivery never redirects to an independently usable S3 URL.

Media, avatars, community attachments, form attachments, receipt logos, certificate artwork/PDFs and finalized recordings use the adapter. Checkout deliverability checks consult S3 too. Receipt/logo reads remain bounded and confined to configured storage; arbitrary URL fetching is not introduced.

Resumable uploads and recording chunks still use temporary local staging. A completed upload is put in S3 before its database reference is published, and staging is removed only after publication succeeds. Large files use sequential 16 MiB multipart pieces. Failed multipart uploads are aborted best-effort; configure a bucket lifecycle for abandoned incomplete multipart uploads as a crash-recovery backstop. A database failure after object creation can leave an unreferenced version; reconcile it with a grace period and the migration/upload ledger rather than deleting content speculatively.

Do not remove the staging volumes: in-progress sessions need their existing files and expiry/retry behavior. Finalized voice audio uploads before its chunks are removed; repeat finalization can find the completed S3 object if the database update previously failed.

## Rollout and rollback

1. Build/review a candidate with the dedicated identity helper and preserved live security Dockerfile changes. Run it against synthetic data first.
2. Copy completed public/protected files, verify counts/bytes/checksums and missing-reference coverage, then repeat a quiesced final delta. Keep originals.
3. Enable S3 mode only after that coverage passes; verify public images, authenticated paid video seeks/downloads, refunds, receipts, certificate revocation, upload/replace/delete and voice playback.
4. Remove original completed files only after application and restore evidence passes, under a separately reviewed migration action.

After new S3 writes, merely setting the flag back to local is **not** a complete rollback: the old local tree lacks new/updated objects. Rehydrate the current S3 object state (including deletions) into the appropriate local roots before switching back, or keep the S3-capable backend version while rolling back unrelated changes. Preserve PostgreSQL entitlements and stable references throughout.

## Verification

Typecheck passes. Full unit suite: 1548 passed, 354 database tests skipped when no test database is configured. Separate real PostgreSQL/HTTP S3 fixtures: 41 passed across protected access, interrupted/resumed upload, protected form submission/admin preview, receipt branding/PDF, avatar replacement and owner/revoked certificate delivery. Original local-mode paid/upload/form/receipt database fixtures: 39 passed. Thirteen adapter tests cover KMS/account validation, traversal, bounded reads, Range/HEAD, bounded multipart, version evidence, staging mutation detection and abort/retry, receipt validation and historical recording keys. SDK transport is synthetic in these tests; live AWS identity/range/multipart proofs and deployed browser checks are separate operational evidence.

Missing-object HEAD handling requires `s3:ListBucket` on this bucket with `s3:prefix` restricted to `media/*`. On HEAD 403 the adapter lists only the exact object prefix with MaxKeys=1; it treats absence as missing and preserves denial for an existing object or denied listing.

Build backend with `docker build --build-context aws_identity_helper=<directory-containing-the-pinned-public-helper-runtime-bundle> --target api -f backend/Dockerfile ...`. The image remains Alpine and includes a separately pinned private glibc loader/libc/libresolv for the helper; no host libc is replaced. The runtime still removes npm/npx as in the live security baseline. Never provide the workload identity directory as a build context.

The gated `backend/scripts/migrate-media-to-s3.ts` runs as UID1000 against read-only source mounts under `/run/boss-media-source/{public,protected}`. Its ledger is private on encrypted pgdata. It only creates absent keys with S3 conditional writes, verifies existing keys without replacing them, independently streams each pinned version back and compares SHA256, and checks source identity/stability. Every source is preserved. A failed or interrupted run can be retried after checking the exact owned lock; it never treats a partial manifest as cutover coverage.

Deployment script accepts `AWS_HELPER_BUILD_CONTEXT`, default `/usr/local/share/callsphere/aws-helper-runtime`. The Dockerfile copies only the five explicitly named public files and validates each pinned hash before checking the helper executable.

Actual scoped workload identity proof passed as UID/GID1000: 17MiB encrypted multipart, version-pinned whole-file SHA256, HTTP Range/HEAD, delete-marker and missing-key handling. The two additional final unit cases prove HEAD403/list denial distinction and conditional create-only migration writes; final focused adapter suite13/13 and PostgreSQL S3 integration suite41/41 passed. No production app rollout is implied by these tests.

The media SDK explicitly uses `credential_process` from fixed profile `bossclinician-media` in `/run/aws-identity/aws-config`; inherited AWS static keys, AWS_PROFILE, shared credentials and unrelated SES credentials cannot select its identity. Existing SES configuration remains intact.
