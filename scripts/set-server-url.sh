#!/usr/bin/env bash
# Patch all platform BuildConfigs with the given SERVER_URL before building.
# Usage: ./scripts/set-server-url.sh https://messenger.example.com
# In CI: export SERVER_URL=... and let each platform's build system read it.
#
# Android/Desktop read SERVER_URL env var at Gradle build time.
# iOS requires patching BuildConfig.swift (SPM has no build-time env injection).

set -euo pipefail

URL="${1:-${SERVER_URL:-}}"

if [[ -z "$URL" ]]; then
  echo "Usage: $0 <server-url>  or  export SERVER_URL=... before building" >&2
  exit 1
fi

if [[ ! "$URL" =~ ^https?:// ]]; then
  echo "Error: URL must start with http:// or https://" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# iOS: patch BuildConfig.swift
IOS_CONFIG="$REPO_ROOT/apps/mobile/ios/Sources/Messenger/BuildConfig.swift"
sed -i.bak "s|static let defaultServerUrl = \".*\"|static let defaultServerUrl = \"$URL\"|" "$IOS_CONFIG"
rm -f "${IOS_CONFIG}.bak"
echo "iOS:     patched $IOS_CONFIG"

# Android + Desktop: set env var (used by Gradle at compile time)
export SERVER_URL="$URL"
echo "Android: SERVER_URL=$SERVER_URL (use with: cd apps/mobile/android && ./gradlew assembleRelease)"
echo "Desktop: SERVER_URL=$SERVER_URL (use with: cd apps/desktop && ./gradlew packageDistributionForCurrentOS)"
echo "Web:     VITE_SERVER_URL=$SERVER_URL (use with: cd client && VITE_SERVER_URL=\"$URL\" npm run build)"
echo ""
echo "Done. Remember to build each platform in this shell session."
