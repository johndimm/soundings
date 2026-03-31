#!/usr/bin/env bash

# SPOTIFY_RESET_ENDPOINT=http://127.0.0.1:8000/api/spotify/reset-status
ENDPOINT="${SPOTIFY_RESET_ENDPOINT:-https://earprint-six.vercel.app/api/spotify/reset-status}"
RESET_KEY="${SPOTIFY_RESET_KEY:-secret}"

echo "Resetting Spotify status at $ENDPOINT"

RESP=$(curl --silent -X POST "$ENDPOINT" -H "x-reset-key: $RESET_KEY")
if [ -z "$RESP" ]; then
  echo "No response from $ENDPOINT"
  exit 1
fi

echo "Response: $RESP"
