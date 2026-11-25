#!/bin/sh
# One-step launcher for the air-gapped machine: verifies the bundle against
# SHA256SUMS, then starts the cold-storage ceremony. Any arguments are passed
# through (e.g. ./coldprep.sh verify --kit dgb-watch-kit-xxxx.json).
set -eu
cd_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
dist="$cd_dir/dist"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js (v18 or newer) is required but was not found." >&2
  echo "No Node on this machine? Open dist/dgb-coldprep.html in a browser instead." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$dist" && sha256sum -c SHA256SUMS >/dev/null) || { echo "CHECKSUM MISMATCH in $dist - do not use this copy." >&2; exit 1; }
elif command -v shasum >/dev/null 2>&1; then
  (cd "$dist" && shasum -a 256 -c SHA256SUMS >/dev/null) || { echo "CHECKSUM MISMATCH in $dist - do not use this copy." >&2; exit 1; }
else
  echo "Warning: no sha256sum/shasum found; skipping the file integrity check." >&2
fi

exec node "$dist/dgb-coldprep.cjs" "$@"
