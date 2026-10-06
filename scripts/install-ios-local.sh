#!/usr/bin/env bash
# Build the mobile app in Release and install it on a connected iPhone, so the
# phone runs the same commit as a desktop app installed with
# install-desktop-local.sh. Signs with your own Apple team under the bundle ID
# in T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID (from the environment or the repo
# .env), and disables OTA updates so upstream's update channel cannot replace
# this build's JS. Installs as "T3 Code Preview" alongside any App Store copy.
#
# Usage: scripts/install-ios-local.sh [device name or UDID]
# Without an argument, Expo prompts for the device.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/apps/mobile"

export APP_VARIANT=preview
export T3CODE_IOS_PERSONAL_TEAM=1
export T3CODE_MOBILE_UPDATES_ENABLED=0
export EXPO_NO_GIT_STATUS=1

pnpm exec expo prebuild --clean --platform ios
pnpm exec expo run:ios --configuration Release --no-bundler --device ${1:+"$1"}
