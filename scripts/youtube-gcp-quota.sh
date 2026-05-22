#!/usr/bin/env bash
# Fetch YouTube Data API v3 quota credits used today from Google Cloud Monitoring.
# Matches GCP Console → APIs → YouTube Data API v3 → Quotas → "Queries per day".
#
# Prerequisites:
#   gcloud auth login
#   GCP_PROJECT_ID = project that owns YOUTUBE_API_KEY
#   Cloud Monitoring API enabled; roles/monitoring.viewer on the project
#
# Usage:
#   GCP_PROJECT_ID=my-project ./scripts/youtube-gcp-quota.sh
#   ./scripts/youtube-gcp-quota.sh my-project

set -euo pipefail

PROJECT="${1:-${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}}"
if [[ -z "${PROJECT}" || "${PROJECT}" == "(unset)" ]]; then
  echo "Set GCP_PROJECT_ID or pass project id as first argument." >&2
  exit 1
fi

command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required." >&2; exit 1; }

TOKEN="$(gcloud auth print-access-token 2>/dev/null)" || {
  echo "Run: gcloud auth login" >&2
  exit 1
}

read -r START END < <(python3 <<'PY'
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

pt = ZoneInfo("America/Los_Angeles")
now_pt = datetime.now(pt)
start = now_pt.replace(hour=0, minute=0, second=0, microsecond=0)
end = datetime.now(timezone.utc)
print(start.isoformat(), end.strftime("%Y-%m-%dT%H:%M:%SZ"))
PY
)

FILTER='metric.type="serviceruntime.googleapis.com/quota/rate/net_usage" AND resource.labels.service="youtube.googleapis.com"'
ENC_FILTER="$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "${FILTER}")"
ENC_START="$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "${START}")"
ENC_END="$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "${END}")"

URL="https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries"
URL+="?filter=${ENC_FILTER}&interval.startTime=${ENC_START}&interval.endTime=${ENC_END}"

RESP="$(curl -sS -H "Authorization: Bearer ${TOKEN}" "${URL}")"

if echo "${RESP}" | jq -e '.error' >/dev/null 2>&1; then
  echo "${RESP}" | jq .
  exit 1
fi

# Latest point per series; take max across series (same as console "current usage").
CREDITS="$(echo "${RESP}" | jq '
  [(.timeSeries // [])[]
    | (.points | sort_by(.interval.endTime) | last | .value | (.int64Value // .doubleValue // 0) | tonumber)
  ]
  | if length == 0 then 0 else max end
')"

SERIES_COUNT="$(echo "${RESP}" | jq '(.timeSeries // []) | length')"

echo "project: ${PROJECT}"
echo "interval: ${START} → ${END}"
echo "timeSeries: ${SERIES_COUNT}"
echo "creditsUsed (GCP): ${CREDITS}"
echo "creditsRemaining (of 110000): $((110000 - CREDITS))"

if [[ "${SERIES_COUNT}" -eq 0 ]]; then
  echo >&2
  echo "No data. Wrong project, Monitoring API off, or no YouTube usage on this project." >&2
  exit 2
fi
