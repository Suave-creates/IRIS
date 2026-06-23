# IRIS — Executive OS

A multi-tenant, approval-gated executive intelligence layer. IRIS reads across a
user's connected tools, assembles ranked context, and proposes actions that
**never execute without explicit approval**. Backed by MySQL and the Anthropic API.

> Implementation of the approved `IRIS.dc.html` design. Built as a **modular
> monolith**: one TypeScript backend + React frontend, MySQL as the system of
> record, with pluggable adapters (cache / queue / vector / storage) that scale
> to the full reference topology later.

## Repository layout

```
iris/
├─ shared/   @iris/shared  — types, constants, the API error contract
├─ server/   @iris/server  — Fastify API, MySQL, migrations, context engine, connectors
├─ web/      @iris/web      — React + Vite SPA (the design system + all 14 views)
└─ .env                     — configuration & secrets (never committed)
```

## Prerequisites

- **Node.js ≥ 20** (developed on Node 24)
- **MySQL 8** with a database named `IRIS`
- An **Anthropic API key**
- A **Google OAuth client** (for SSO sign-in + Google connectors)

## Setup

```bash
# 1. Install all workspaces
npm install

# 2. Configure environment
cp .env.example .env        # then fill in DB, ANTHROPIC_API_KEY, GOOGLE_* …

# 3. Apply database migrations
npm run db:migrate

# 4. Run everything (shared watcher + API + web) in one terminal
npm run dev
```

- Web dev server: <http://localhost:5173> (proxies `/api` → the backend)
- API: <http://localhost:8080> · health at `/health`, readiness at `/api/health/ready`

## Scripts (run from the repo root)

| Script | Description |
| --- | --- |
| `npm run dev` | Run shared (watch) + server + web concurrently |
| `npm run build` | Build shared → server → web |
| `npm run typecheck` | Type-check every workspace |
| `npm run lint` | ESLint across the monorepo |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:status` | Show applied / pending migrations |
| `npm run db:seed` | Seed a demo tenant + owner (local/password testing) |

## Configuration

All configuration is environment-driven and validated at boot (`server/src/config/env.ts`).
See [`.env.example`](./.env.example) for the full list. Notable keys:

- `DB_*` — MySQL connection (database `IRIS`)
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` — the AI / context engine
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — SSO **and** Google connectors (one OAuth client, incremental scopes)
- `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY` — session signing and connector-token encryption

## Milestones

| | Milestone | Status |
| --- | --- | --- |
| M0 | Foundations + design-system port | ✅ |
| M1 | Google SSO auth + tenancy + RBAC | ✅ |
| M2 | Data model + live views | ◻ |
| M3 | Context Engine + Claude core | ◻ |
| M4 | Connector framework + workers | ◻ |
| M5 | Monitoring, logging, hardening, Docker, docs | ◻ |
