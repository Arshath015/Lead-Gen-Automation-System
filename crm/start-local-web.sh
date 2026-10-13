#!/usr/bin/env bash
# Starts the Rapport CRM frontend dev server. Needs the API server (see
# start-local-api.sh) already running.
set -e
cd "$(dirname "$0")/artifacts/lead-crm"

export MSYS_NO_PATHCONV=1  # stops git-bash from mangling BASE_PATH="/" into a filesystem path
export PORT=5191
export BASE_PATH="/"
export LOCAL_API_PROXY_TARGET="http://localhost:4100"

pnpm run dev
