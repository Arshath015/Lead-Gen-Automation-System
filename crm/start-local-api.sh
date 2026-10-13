#!/usr/bin/env bash
# Starts the Rapport CRM API server against the local embedded Postgres
# (see ../localdb-tool/start.mjs). Run that first if it isn't already up.
set -e
cd "$(dirname "$0")/artifacts/api-server"

export DATABASE_URL="postgres://postgres:postgres@localhost:5544/crm"
export PORT=4100
export NODE_ENV=development
# Real accounts already exist in the DB — never re-run the admin/demo-data
# seeders (the demo seeder re-creates its 22 fake leads any time the leads
# table has fewer than 10 rows, which it otherwise would on every restart).
export DISABLE_AUTO_SEED=true
# No real Resend account wired up yet locally — this only needs to be a
# non-empty string so the SDK's constructor doesn't throw; it's never a
# recipient your actual data gets emailed to from a local dev run.
export RESEND_API_KEY="${RESEND_API_KEY:-re_local_dev_placeholder_not_real}"

pnpm run build && pnpm run start
