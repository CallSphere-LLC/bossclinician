#!/usr/bin/env bash
# Move this app's S3 objects from one AWS account to another.
#
# Written for the September 2026 move off the shared CallSphere account
# (381443104652) onto the app's own account (137808120879), but it takes the
# accounts as arguments and does not hardcode either.
#
# The copy and the delete are deliberately two separate invocations. A sync that
# deletes as it goes has no moment where both copies exist, and that moment is
# the only thing standing between a transient credential error and a bucket of
# recordings that are simply gone. So: copy, verify, look at the verification,
# and only then run again with --delete-source.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: migrate-s3-account.sh --from-profile P --from-bucket B \
                             --to-profile P --to-bucket B [--region R]
                             [--delete-source]

  --delete-source   Delete every object from the SOURCE bucket. Refuses unless
                    the destination already holds an identical key/size listing,
                    and prompts for the source bucket name to be typed back.
USAGE
  exit 2
}

from_profile=""; from_bucket=""; to_profile=""; to_bucket=""
region="us-east-1"; delete_source=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-profile) from_profile="$2"; shift 2;;
    --from-bucket)  from_bucket="$2";  shift 2;;
    --to-profile)   to_profile="$2";   shift 2;;
    --to-bucket)    to_bucket="$2";    shift 2;;
    --region)       region="$2";       shift 2;;
    --delete-source) delete_source=true; shift;;
    *) usage;;
  esac
done
[[ -n "$from_profile" && -n "$from_bucket" && -n "$to_profile" && -n "$to_bucket" ]] || usage

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT

# Say out loud which account each side is, before touching anything. A profile
# name is not evidence: the whole point of this script is that two accounts are
# in play and the wrong one is a data loss.
echo "Source: $from_bucket"
aws sts get-caller-identity --profile "$from_profile" --output text --query 'Account,Arn'
echo "Destination: $to_bucket"
aws sts get-caller-identity --profile "$to_profile" --output text --query 'Account,Arn'

if ! aws s3api head-bucket --bucket "$to_bucket" --profile "$to_profile" 2>/dev/null; then
  echo "Creating $to_bucket in $region"
  if [[ "$region" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$to_bucket" --profile "$to_profile" >/dev/null
  else
    aws s3api create-bucket --bucket "$to_bucket" --profile "$to_profile" \
      --region "$region" --create-bucket-configuration "LocationConstraint=$region" >/dev/null
  fi
  # These are recordings of people's voices and members' purchased files. The
  # bucket is private, encrypted and versioned from its first second, not after
  # the first upload.
  aws s3api put-public-access-block --bucket "$to_bucket" --profile "$to_profile" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
  aws s3api put-bucket-encryption --bucket "$to_bucket" --profile "$to_profile" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
  aws s3api put-bucket-versioning --bucket "$to_bucket" --profile "$to_profile" \
    --versioning-configuration Status=Enabled
fi

listing() { # bucket profile -> "size<TAB>key", sorted
  aws s3 ls "s3://$1" --recursive --profile "$2" \
    | awk '{ size=$3; $1=$2=$3=""; sub(/^ +/, ""); printf "%s\t%s\n", size, $0 }' | sort
}

if [[ "$delete_source" == false ]]; then
  # Cross-account copy without a trust relationship: down to this host, back up
  # to the other account. At 1.7MB that is free; if this ever carries the 573MB
  # of member uploads, grant the destination role read on the source bucket and
  # let S3 copy server side instead.
  aws s3 sync "s3://$from_bucket" "$work/objects" --profile "$from_profile" --only-show-errors
  aws s3 sync "$work/objects" "s3://$to_bucket" --profile "$to_profile" --only-show-errors
fi

listing "$from_bucket" "$from_profile" > "$work/source.txt"
listing "$to_bucket"   "$to_profile"   > "$work/dest.txt"
echo "Source objects:      $(wc -l < "$work/source.txt")"
echo "Destination objects: $(wc -l < "$work/dest.txt")"

if ! diff -q "$work/source.txt" "$work/dest.txt" >/dev/null; then
  echo 'Destination does not match source (key or size differs):' >&2
  diff "$work/source.txt" "$work/dest.txt" | head -40 >&2
  exit 1
fi
echo "Verified: every key present at the same size in $to_bucket."

if [[ "$delete_source" == true ]]; then
  echo
  echo "About to delete ALL $(wc -l < "$work/source.txt") objects from s3://$from_bucket."
  echo "The app must already be pointed at $to_bucket, or it will 404 recordings."
  read -r -p "Type the source bucket name to confirm: " typed
  [[ "$typed" == "$from_bucket" ]] || { echo 'Not confirmed; nothing deleted.' >&2; exit 1; }
  aws s3 rm "s3://$from_bucket" --recursive --profile "$from_profile"
  echo "Source emptied. The bucket itself is left in place; remove it by hand."
fi
