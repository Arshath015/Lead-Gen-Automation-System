# Rapport — Lead CRM

A full-featured Lead CRM for sales teams with role-based access (Admin/Manager/BD), lead lifecycle management, follow-ups, bulk operations, dashboard with charts, audit trail, CSV import, and reports.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at /api)
- `pnpm --filter @workspace/lead-crm run dev` — run the frontend (port from $PORT)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run seed` — seed default pipeline stages

- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — session cookie secret

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, Replit Auth (OIDC/PKCE)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod, `drizzle-zod`
- API codegen: Orval (from OpenAPI spec at `lib/api-spec/openapi.yaml`)
- Frontend: React + Vite + Wouter + React Query + Recharts
- Build: esbuild (CJS bundle) for API, Vite for frontend

## Where things live

- `lib/api-spec/openapi.yaml` — source-of-truth API spec
- `lib/db/src/schema/` — Drizzle ORM schema (users, stages, leads, followups, notes, activities, audit)
- `lib/api-client-react/src/generated/` — Orval-generated React Query hooks
- `lib/api-zod/src/generated/` — Orval-generated Zod schemas for server validation
- `artifacts/api-server/src/routes/` — Express route handlers (auth, users, stages, leads, followups, notes, activities, dashboard, reports, audit)
- `artifacts/lead-crm/src/` — React frontend

## Architecture decisions

- The `usersTable` uses UUID `id` (Replit's sub claim) + serial `numId` (integer for API). All API integer IDs map to `numId`.
- `AuthUser` type is derived from the Orval-generated `GetCurrentUserResponse` Zod schema in `lib/api-zod/src/index.ts`.
- The Express `User` interface is declared explicitly in `authMiddleware.ts` (not via `extends AuthUser`) to avoid Zod-inferred type extension issues.
- Sessions store the full `AuthUser` object (including `role`) to avoid per-request DB lookups except on `/auth/user` which always re-fetches from DB.
- Mobile Zod schemas (`ExchangeMobileAuthorizationCodeBody` etc.) are defined inline in `auth.ts` since they weren't added to the OpenAPI spec.
- `lib/replit-auth-web` needs `vite` as a dev dependency for `import.meta.env` type support.

## Product

- **Dashboard** — pipeline stats, stage breakdown chart, conversion funnel, recent activity
- **Leads** — searchable/filterable list, bulk actions (stage change, assign, delete), CSV import
- **Lead Detail** — full info, inline notes, follow-ups with status, activity timeline, stage drag/assign
- **Reports** — monthly growth, leads by industry/location/status, user performance (admin/manager)
- **Users** — team member management (admin only)
- **Audit Log** — full change history (admin only)
- **Role-based access** — Admin: full access; Manager: all leads + reports; BD: own leads only

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always run `pnpm run typecheck:libs` before typechecking artifacts — lib declarations must be built first
- After changing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` then `pnpm run typecheck:libs`
- Do not use `pnpm dev` at the workspace root — use workflow restarts
- `zod/v4` import path doesn't work in non-lib packages; use `zod` directly (add as a dep)
- The `p = {}` fallback pattern breaks TypeScript narrowing — use `parsed.data?.field ?? default` instead

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
