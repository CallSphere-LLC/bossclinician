#!/usr/bin/env bash
# Rebuild the pinned AWS Roles Anywhere signing helper from its release tag with
# patched Go modules, for when a scanner finding lands before AWS cuts a release.
#
#   scripts/host/build-aws-signing-helper.sh v1.8.5 golang.org/x/crypto@v0.55.0 [module@version ...]
#
# Builds with upstream's own flags on this host (the bundle's private loader,
# libc and libresolv are this host's), scans the result, and prints its SHA256.
# It installs nothing: copy build/bin/aws_signing_helper into the bundle
# (/usr/local/share/callsphere/aws-helper-runtime), update manifest.json and the
# pinned hash in backend/Dockerfile together, then release through deploy-k3s.sh.
set -euo pipefail
tag="${1:?release tag, e.g. v1.8.5}"; shift
[[ $# -gt 0 ]] || { echo 'name at least one module@version to raise' >&2; exit 2; }
work="${AWS_HELPER_BUILD_DIR:-/var/tmp/aws-helper-build}"
rm -rf "$work" && mkdir -p "$work" && cd "$work"
git clone -q --depth 1 --branch "$tag" https://github.com/aws/rolesanywhere-credential-helper.git src
cd src
export GOFLAGS=-mod=mod GOTOOLCHAIN=auto
go get "$@"
go mod tidy
go mod verify
go build -buildmode=pie \
  -ldflags "-X 'github.com/aws/rolesanywhere-credential-helper/cmd.Version=${tag#v}' -linkmode=external -w -s" \
  -trimpath -o build/bin/aws_signing_helper main.go
./build/bin/aws_signing_helper version
trivy rootfs --scanners vuln --severity HIGH,CRITICAL --skip-version-check --exit-code 1 -q build/bin
sha256sum build/bin/aws_signing_helper
