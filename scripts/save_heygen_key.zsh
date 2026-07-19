#!/bin/zsh

set -euo pipefail

script_dir=${0:A:h}
repo_root=${script_dir:h}
target="$repo_root/work/secrets/heygen.env"

mkdir -p "${target:h}"
umask 077

print -n -- "Paste the NEW HeyGen key, then press Enter: "
IFS= read -r -s api_key
print

if [[ -z "$api_key" || "$api_key" != sk_* || "$api_key" == *[[:space:]]* ]]; then
  unset api_key
  print -u2 -- "Not saved: the value does not look like a valid HeyGen key."
  exit 1
fi

print -r -- "HEYGEN_API_KEY=$api_key" > "$target"
unset api_key
chmod 600 "$target"

print -- "Saved securely to work/secrets/heygen.env."
