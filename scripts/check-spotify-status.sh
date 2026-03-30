#!/usr/bin/env bash

HOST="${SPOTIFY_STATUS_HOST:-http://127.0.0.1:8000}"
STATUS_URL="$HOST/api/spotify/status"
TRACK_URI="${SPOTIFY_TEST_URI:-spotify:track:11dFghVXANMlKmJXsNCbNl}"

echo "Checking Spotify status at $STATUS_URL…"

RESP=$(curl --silent "$STATUS_URL")
if [ -z "$RESP" ]; then
  echo "No response from $STATUS_URL"
  exit 1
fi

AVAILABLE=$(printf '%s' "$RESP" | sed -n 's/.*"available":\([^,}]*\).*/\1/p')
RETRY_MS=$(printf '%s' "$RESP" | sed -n 's/.*"retryAfterMs":\([^,}]*\).*/\1/p')
OFFLINE=$(printf '%s' "$RESP" | sed -n 's/.*"offline":\([^,}]*\).*/\1/p')
UNTIL=$(printf '%s' "$RESP" | sed -n 's/.*"until":\([^,}]*\).*/\1/p')

if [ "$AVAILABLE" = "true" ]; then
  echo "Spotify is available now."
  echo "If you want to try playing a track, use the UI or target $TRACK_URI."
else
  SEC=$((RETRY_MS / 1000))
  if [ "$OFFLINE" = "true" ]; then
    msg="Spotify marked offline"
  else
    msg="Rate-limited"
  fi
  if [ -n "$UNTIL" ]; then
    NEXT=$(date -d "@$((UNTIL / 1000))" '+%T' 2>/dev/null || date -r $((UNTIL / 1000)) '+%T')
    echo "$msg: wait another $SEC seconds (until approx $NEXT)."
  else
    echo "$msg: wait another $SEC seconds."
  fi
fi

echo "Raw status: $RESP"
