#!/usr/bin/env bash
# Build the desktop app and install it locally, replacing any existing copy.
# Picks the install method from the host OS: macOS unpacks the .app into
# /Applications, Linux drops the AppImage in ~/Applications (override with
# T3_APPIMAGE_DIR) and registers a desktop entry under ~/.local/share.
# Skips the build with --skip-build to just reinstall the most recent
# release/ artifact.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Set by the Linux path. The trap outlives the function that fills it in, so
# this cannot be a local.
WORK_DIR=""
cleanup() {
  if [ -n "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

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

install_macos() {
  if [ "$SKIP_BUILD" = false ]; then
    pnpm dist:desktop:dmg:arm64
  fi

  local zip_path
  zip_path="$(ls -t release/T3-Code-*-arm64.zip 2>/dev/null | head -n 1 || true)"
  if [ -z "$zip_path" ]; then
    echo "No release/T3-Code-*-arm64.zip found. Run without --skip-build first." >&2
    exit 1
  fi

  set +o pipefail
  local app_name
  app_name="$(unzip -Z1 "$zip_path" | head -n 1 | cut -d/ -f1)"
  set -o pipefail
  local dest="/Applications/$app_name"

  echo "Installing $app_name from $(basename "$zip_path")..."

  if [ -d "$dest" ]; then
    rm -rf "$dest"
  fi

  ditto -xk "$zip_path" /Applications/
  xattr -cr "$dest"

  echo "Installed to $dest"
}

install_linux() {
  local arch
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *)
      echo "Unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac

  if [ "$SKIP_BUILD" = false ]; then
    # dist:desktop:linux pins x64, so drive the builder directly to cover arm64.
    node scripts/build-desktop-artifact.ts --platform linux --target AppImage --arch "$arch"
  fi

  # electron-builder renders ${arch} as the AppImage spelling (x86_64), which
  # does not match the --arch flag, so match on extension and take the newest.
  local appimage
  appimage="$(ls -t release/T3-Code-*.AppImage 2>/dev/null | head -n 1 || true)"
  if [ -z "$appimage" ]; then
    echo "No release/T3-Code-*.AppImage found. Run without --skip-build first." >&2
    exit 1
  fi

  # ~/Applications is the AppImage convention on atomic Fedora desktops like
  # Bluefin. Everything here lands under $HOME, which is /var/home, so it
  # survives image updates and rebases -- unlike anything layered into /usr.
  local app_dir="${T3_APPIMAGE_DIR:-$HOME/Applications}"
  local data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
  local desktop_dir="$data_dir/applications"
  local icon_dir="$data_dir/icons"
  # A version-free filename keeps the desktop entry and the t3code:// handler
  # the app registers at startup pointing at a path that survives a rebuild.
  local dest="$app_dir/T3-Code.AppImage"

  mkdir -p "$app_dir" "$desktop_dir" "$icon_dir"

  echo "Installing $(basename "$appimage") to $dest..."

  # Stage then rename so a running instance keeps its current inode rather
  # than having the mounted image truncated underneath it.
  cp "$appimage" "$dest.new"
  chmod 755 "$dest.new"
  mv -f "$dest.new" "$dest"

  WORK_DIR="$(mktemp -d)"

  # The AppImage already carries the entry electron-builder generated, with the
  # channel-correct Name, StartupWMClass and the x-scheme-handler MimeTypes.
  # Reuse it instead of restating that metadata here, where it would drift.
  (cd "$WORK_DIR" && "$dest" --appimage-extract '*.desktop' >/dev/null && "$dest" --appimage-extract '*.png' >/dev/null)

  local src_desktop
  src_desktop="$(ls "$WORK_DIR"/squashfs-root/*.desktop 2>/dev/null | head -n 1 || true)"
  if [ -z "$src_desktop" ]; then
    echo "Could not extract a desktop entry from $dest." >&2
    exit 1
  fi

  local icon_name
  icon_name="$(sed -n 's/^Icon=//p' "$src_desktop" | head -n 1)"

  # The icon at the image root is a symlink into usr/share/icons and the
  # extract patterns do not match across directories, so the first pass only
  # produced a dangling link. Resolve it and pull the target out separately.
  local src_icon="$WORK_DIR/squashfs-root/$icon_name.png"
  if [ -L "$src_icon" ] && [ ! -f "$src_icon" ]; then
    local icon_rel
    icon_rel="$(readlink "$src_icon")"
    (cd "$WORK_DIR" && "$dest" --appimage-extract "$icon_rel" >/dev/null)
  fi
  if [ ! -f "$src_icon" ]; then
    echo "Could not extract an icon from $dest." >&2
    exit 1
  fi

  local icon_path="$icon_dir/$icon_name.png"
  install -m 644 "$src_icon" "$icon_path"

  # Exec runs AppRun, which only exists inside the mounted image, and Icon
  # names a theme entry we never install, so both become absolute paths here.
  # Only the program token is replaced: the arguments carry --no-sandbox,
  # which Electron needs because its SUID helper cannot work from squashfs.
  local desktop_path="$desktop_dir/$icon_name.desktop"
  sed -e "s|^Exec=[^ ]*|Exec=\"$dest\"|" \
    -e "s|^Icon=.*|Icon=$icon_path|" \
    "$src_desktop" >"$desktop_path"

  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$desktop_dir" || true
  fi

  echo "Installed to $dest"
  echo "Desktop entry: $desktop_path"
}

case "$(uname -s)" in
  Darwin) install_macos ;;
  Linux) install_linux ;;
  *)
    echo "Unsupported platform: $(uname -s)" >&2
    exit 1
    ;;
esac
