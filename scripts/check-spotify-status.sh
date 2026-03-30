#!/usr/bin/env bash

HOST="${SPOTIFY_STATUS_HOST:-http://127.0.0.1:8000}"
VERCEL_URL="${SPOTIFY_VERCEL_STATUS_URL:-https://earprint-six.vercel.app}"
TRACK_URI="${SPOTIFY_TEST_URI:-spotify:track:11dFghVXANMlKmJXsNCbNl}"

check_status() {
  local url="$1/api/spotify/status"
  echo "Checking Spotify status at $url…"
  local resp
  resp=$(curl --silent "$url")
  if [ -z "$resp" ]; then
    echo "No response from $url"
    return 1
  fi

  local available retry_ms offline until next msg
  available=$(printf '%s' "$resp" | sed -n 's/.*"available":\([^,}]*\).*/\1/p')
  retry_ms=$(printf '%s' "$resp" | sed -n 's/.*"retryAfterMs":\([^,}]*\).*/\1/p')
  offline=$(printf '%s' "$resp" | sed -n 's/.*"offline":\([^,}]*\).*/\1/p')
  until=$(printf '%s' "$resp" | sed -n 's/.*"until":\([^,}]*\).*/\1/p')

  echo "Raw status: $resp"

  if [ "$available" = "true" ]; then
    echo "✅ Spotify is available now at $url."
    echo "   If you want to try playing a track, target $TRACK_URI."
  else
    local sec
    sec=$((retry_ms / 1000))
    if [ "$offline" = "true" ]; then
      msg="Spotify marked offline"
    else
      msg="Rate-limited"
    fi
    if [ -n "$until" ] && [ "$until" -gt 0 ]; then
      local next_time
      next_time=$(date -d "@$((until / 1000))" '+%T' 2>/dev/null || date -r $((until / 1000)) '+%T')
      echo "⚠️ $msg: wait another $sec seconds (until approx $next_time)."
    else
      echo "⚠️ $msg: wait another $sec seconds."
    fi
  fi
}

check_status "$HOST" || exit 1
check_status "$VERCEL_URL"
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
