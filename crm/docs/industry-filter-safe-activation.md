# Leads multi-industry filter: code-only activation

## Scope and current status

This release activates the already-tested Leads filter UI and its shared backend
industry-matching helper. It does not need a database schema change, data
backfill, taxonomy rewrite, or Neon migration.

Preparation checks completed:

- Backend production build and typecheck passed.
- Frontend production build passed; 31 frontend tests passed.
- All 10 backend Industry-filter tests passed.
- Publishing schema inspection reported no difference, no SQL statements,
  no destructive changes, and no warnings. Recheck immediately before publishing.
- The existing published `/api/healthz` returned HTTP 200. This establishes
  availability of the old release, not activation of the new filter.
- A read-only production query captured a baseline for all 932 lead records.
  Only count, timestamp, and whole-record fingerprint are saved locally in
  `.local/verification/industry-activation-baseline.json`; no individual lead
  details are stored. Re-run its SELECT after activation to compare the full
  production leads table, allowing for independently confirmed user changes.
- No API restart, publishing action, database migration, seed, wipe, or data
  maintenance operation was performed during this preparation.
- `DATABASE_URL` was neither read nor changed.

The existing unrelated frontend typecheck error in Deal Revenue remains outside
this release. Artifact-specific production builds pass; do not replace the
configured builds with the workspace-wide build to bypass that issue.

## Required production environment

These non-secret settings have been saved in the production environment:

```text
NODE_ENV=production
DISABLE_AUTO_SEED=true
RUN_STARTUP_MIGRATIONS=false
RUN_STARTUP_MAINTENANCE=false
WIPE_DB_ON_START=false
```

The API artifact also specifies `NODE_ENV=production` and
`DISABLE_AUTO_SEED=true` in its production run configuration.

Production must run the compiled API using the existing command:

```sh
node --enable-source-maps artifacts/api-server/dist/index.mjs
```

Do NOT run `pnpm --filter @workspace/api-server run dev` for this activation.
That script forces development mode, in which the existing startup code enables
migrations and maintenance regardless of the production protections above.
Restarting a workspace workflow is not a production deployment.

With the required production flags, the existing startup guards skip:

- `runMigrations`
- `ensureDefaultStages`
- Notification-preferences backfill
- Lead follow-up-date reconciliation
- Finance-role resynchronization
- Super-admin and demo-data seeders
- Database wipe

The normal follow-up reminder scheduler remains unchanged. It is an existing
operational feature, not a startup backfill, and this release does not disable
it or modify its behavior.

## Before publishing

1. Confirm the five production settings above in Publishing/Secrets. Keep the
   existing database configuration and `DATABASE_URL` unchanged.
2. Confirm the artifact build commands are still only:
   - `pnpm --filter @workspace/api-server run build`
   - `pnpm --filter @workspace/lead-crm run build`
   Neither invokes the application entry point or database migrations.
3. Recheck the publishing database plan. It must contain **zero SQL statements**.
   If the publishing UI proposes any schema change, provisioning/copy operation,
   database replacement, migration, seed, truncate, or maintenance operation,
   STOP and obtain approval. Do not accept even additive database changes as
   part of this feature.
4. Refresh the whole-table baseline above if publishing is delayed. Also capture
   a read-only API baseline under the authenticated production user and
   workspace that will be used for verification: all visible lead IDs, total
   count, industries, and a canonical fingerprint of lead-record fields.
   Retrieve all list pages; do not compare only the first page. Keep raw lead
   records out of logs and project files. Use a quiet verification window so
   concurrent user changes cannot be mistaken for an activation side effect.
5. Publish through Replit's user-controlled Publish action. Do not perform the
   separate Neon migration or change the production database target.

## After publishing: read-only acceptance checks

Use an authenticated production session with the same user/workspace/scope as
the baseline. Do not create or edit leads to manufacture test fixtures. All
requests below are GET requests; URL-encode the `industry` parameter.

1. **Startup logs and health**
   - Confirm `/api/healthz` returns HTTP 200.
   - Confirm startup reports migrations disabled, data maintenance disabled,
     and automatic seeding skipped.
   - Stop if logs show a migration, wipe, seed, reconciliation, or backfill
     executing. A health response alone does not prove these safeguards.
2. **Single-industry compatibility**
   - Request `/api/leads?industry=Manufacturing&page=1&limit=100`.
   - Retrieve every page and compare IDs against baseline rows whose industry
     equals `Manufacturing`, case-insensitively and exactly.
   - Repeat with lowercase `manufacturing`; results must be identical.
3. **Multi-industry OR**
   - Request `/api/leads` with:
     `industry=["Manufacturing","Engineering","IT Services & Consulting"]`.
   - Retrieve every page. IDs and total must equal the union of the three
     individual exact-match result sets, with no duplicate IDs.
   - Require at least two selected industries to have real baseline matches.
     If those example industries lack data, use two or three existing distinct
     industries in the same format. Empty results alone do not prove OR support.
   - Repeat with mixed-case selection strings.
4. **All Industries**
   - Remove the industry parameter entirely.
   - Total and complete IDs must match the unfiltered baseline.
   - In the UI, All Industries clears checkboxes and restores these results.
5. **Legacy values**
   - Select an existing legacy baseline value, for example `Telecom` or `SaaS`.
   - Verify its old scalar query still returns only exact case-insensitive
     matches. `Telecom` must not include `Telecommunications`.
   - Combine that value with an existing standardized industry using the JSON
     string-array encoding and verify their union.
   - If no legacy rows are available in scope, report that live legacy coverage
     is unavailable; do not create rows or claim live coverage from unit tests.
6. **Exports**
   - GET `/api/leads/export` without filters and with the scalar and JSON-array
     industry filters above.
   - The currently active export route returns JSON `{leads,total}` consumed
     by the existing frontend export flow.
   - Compare complete export IDs and totals against the corresponding list
     results under the same filters. Verify the UI's existing downloaded export
     contains the same selected result set.
7. **Data preservation**
   - Re-read all unfiltered pages in the same scope.
   - Compare count, IDs, original industries, and canonical lead-record
     fingerprint to the baseline. No industry normalization/backfill is
     permitted. Investigate any difference before attributing it to the release.
   - Scoped API verification does not certify records outside that user's
     visibility. If whole-database assurance is required, separately use
     approved read-only production queries; never run a data repair.

If any required check cannot be completed because of authentication, absent
sample data, concurrent changes, or unavailable logs, report it explicitly as
unverified. Do not substitute mocked browser responses for live verification.

## Rollback and stop conditions

If activation fails, stop further rollout and use a reviewed code-only rollback
to the prior published build, retaining the same database and safe startup
flags. Do not restore, wipe, migrate, or replace the database as a rollback for
this filter. Any production schema or maintenance requirement needs separate
approval. The Neon database migration remains a separate subsequent task.