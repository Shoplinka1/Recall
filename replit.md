# Recall

Recall turns a student's own learning material into grounded practice, weakness diagnosis, targeted retesting, and measurable progress.

## Run & Operate

- `PORT=8080 pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `PORT=23566 pnpm --filter @workspace/recall run dev` — run the Recall web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string; `PRIVATE_OBJECT_DIR`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, and `PUBLIC_OBJECT_SEARCH_PATHS` are required for private App Storage uploads
- Production billing requires `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, both Paystack plan codes, both exact NGN plan amounts, and a public `APP_URL`; the UI displays USD ($9.99/month or $99/year)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/recall` — the React/Vite web app and all user-facing routes
- `artifacts/api-server` — the Express API, demo provider, practice scoring, and recommendation routes
- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/db/src/schema/recall.ts` — relational schema for users, subjects, materials, concepts, questions, practice, mastery, and subscriptions
- `attached_assets/` — user-provided source briefs and assets

## Architecture decisions

- Recall's first build runs against grounded demo data so the complete learning loop can be explored without spending AI credits or connecting billing.
- The API contract is OpenAPI-first; generated React Query hooks are the frontend integration boundary.
- AI generation is behind a provider seam and the demo provider only returns questions with stored source excerpts.
- The relational schema is ready for persisted user-owned learning data while demo routes keep the initial experience deterministic.

## Product

Recall includes a premium landing page, demo workspace, dashboard recommendation, subjects, material library, grounded practice, confidence-aware answer review, results, weakness diagnosis, targeted practice, knowledge map, progress, mistakes, settings, billing, pricing, and trust pages.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`.
- The API server and web app are managed workflows; restart them through their existing workflow names after runtime changes.
- The initial experience is intentionally demo-safe. Real auth, object storage, AI provider credentials, and Paystack configuration should be connected before treating it as a production launch.
- Paystack checkout stays unavailable until server-side credentials, plan codes, NGN amounts, and `APP_URL` are configured; frontend state cannot mark a payment successful.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
