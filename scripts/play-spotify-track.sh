#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${SPOTIFY_ENV_FILE:-.env.local}"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  . "$ENV_FILE"
  set +a
fi

# Usage:
# ./scripts/play-spotify-track.sh
# Optionally override any variables with environment overrides:
#   SPOTIFY_ACCESS_TOKEN=... SPOTIFY_DEVICE_ID=... SPOTIFY_TRACK_URI=... ./scripts/play-spotify-track.sh

if [ -z "${SPOTIFY_ACCESS_TOKEN:-}" ] || [ -z "${SPOTIFY_DEVICE_ID:-}" ] || [ -z "${SPOTIFY_TRACK_URI:-}" ]; then
  cat <<'EOF'
Usage: ./scripts/play-spotify-track.sh

Environment variables (read from .env.local or override on the command line):
  SPOTIFY_ACCESS_TOKEN  - valid OAuth token with streaming/web-playback scopes
  SPOTIFY_DEVICE_ID     - the Spotify Connect device ID to play on
  SPOTIFY_TRACK_URI     - URI of the track you want to play, e.g. spotify:track:11dFghVXANMlKmJXsNCbNl

Set them in .env.local or pass overrides as environment variables when running the script.
EOF
  exit 1
fi

curl --fail -X PUT "https://api.spotify.com/v1/me/player/play?device_id=${SPOTIFY_DEVICE_ID}" \
  -H "Authorization: Bearer ${SPOTIFY_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"uris\":[\"${SPOTIFY_TRACK_URI}\"]}"

echo "Requested play of ${SPOTIFY_TRACK_URI} on device ${SPOTIFY_DEVICE_ID}."
