#!/usr/bin/env bash
# Build the desktop app and install it into /Applications, replacing any
# existing copy. Skips the build with --skip-build to just reinstall the
# most recent release/ artifact.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [ "$SKIP_BUILD" = false ]; then
  pnpm dist:desktop:dmg:arm64
fi

ZIP_PATH="$(ls -t release/T3-Code-*-arm64.zip 2>/dev/null | head -n 1 || true)"
if [ -z "$ZIP_PATH" ]; then
  echo "No release/T3-Code-*-arm64.zip found. Run without --skip-build first." >&2
  exit 1
fi

set +o pipefail
APP_NAME="$(unzip -Z1 "$ZIP_PATH" | head -n 1 | cut -d/ -f1)"
set -o pipefail
DEST="/Applications/$APP_NAME"

echo "Installing $APP_NAME from $(basename "$ZIP_PATH")..."

if [ -d "$DEST" ]; then
  rm -rf "$DEST"
fi

ditto -xk "$ZIP_PATH" /Applications/
xattr -cr "$DEST"

echo "Installed to $DEST"
