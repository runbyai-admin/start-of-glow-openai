#!/usr/bin/env bash
# Deploy a Start of Glow build to its stable URL.
#
#   ./deploy.sh claude     -> https://app.electricity.studio/glow/claude/
#   ./deploy.sh openai     -> https://app.electricity.studio/glow/openai/
#   ./deploy.sh grok       -> https://app.electricity.studio/glow/grok/
#   ./deploy.sh main       -> https://app.electricity.studio/glow/   (the champion)
#
# Contestants deploy their own slot only; `main` is the owner's, published by
# the winner-merge flow. Everything is static - there is no service to restart.
set -euo pipefail

SLOT="${1:-}"
REMOTE="${REMOTE:-nexus}"
BASE_URL="${BASE_URL:-https://app.electricity.studio/glow}"

case "$SLOT" in
  main)   DIR="glow";        URL="$BASE_URL/" ;;
  claude) DIR="glow-claude"; URL="$BASE_URL/claude/" ;;
  openai) DIR="glow-openai"; URL="$BASE_URL/openai/" ;;
  grok)   DIR="glow-grok";   URL="$BASE_URL/grok/" ;;
  *)
    echo "usage: ./deploy.sh <main|claude|openai|grok>" >&2
    exit 2
    ;;
esac

TARGET="${TARGET:-/opt/nexus/www/$DIR}"
cd "$(dirname "$0")"

echo "==> check"
npm run --silent check

echo "==> build"
npm run --silent build
test -f dist/index.html || { echo "build produced no dist/index.html" >&2; exit 1; }

echo "==> rsync -> $REMOTE:$TARGET/"
rsync -az --delete --checksum --chmod=D755,F644 dist/ "$REMOTE:$TARGET/"

echo "==> verify $URL"
code=$(curl -s -o /dev/null -w '%{http_code}' "$URL")
if [ "$code" != "200" ]; then
  echo "verify FAILED: $URL returned $code" >&2
  exit 1
fi
if ! curl -s "$URL" | grep -q "Start of Glow"; then
  echo "verify FAILED: $URL did not serve the game page" >&2
  exit 1
fi
echo "deployed: $URL"
