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
├─ web/      @iris/web      — React + Vite SPA (the design system + all 16 views)
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
| `npm run db:seed` | Create a local tenant + owner account (for password sign-in testing; no content) |

## Configuration

All configuration is environment-driven and validated at boot (`server/src/config/env.ts`).
See [`.env.example`](./.env.example) for the full list. Notable keys:

- `DB_*` — MySQL connection (database `IRIS`)
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` — the AI / context engine
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — SSO **and** Google connectors (one OAuth client, incremental scopes)
- `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY` — session signing and connector-token encryption

## People & Context + Meeting Intelligence

Two linked modules implement the *People & Meetings* design handoff
(`design_handoff_extracted/design_handoff_people_meetings/`):

- **People & Context** (`/people`) — an editable weekly-engagement roster.
  Engagement (score, status, trend, last interaction) is **derived, never
  stored**: `server/src/modules/people/people.derive.ts` ports the approved
  prototype's algorithms verbatim (stable name hash, cadence buckets,
  synthetic June interactions) and layers real `engagement_events` on top.
  `GET /api/people/:id/context` returns the full drawer payload (AI relationship
  summary, interaction calendar, timeline, topics, actions, files, insights).
- **Meeting Intelligence** (`/meetings`) — a premium-grade pipeline:
  - **Capture**: the recorder records real audio (MediaRecorder) on two
    channels — your microphone, and any ongoing call's tab audio via
    "Connect call audio" — while the browser speech engine streams a live
    preview. Language selector covers English (India), Hindi + English
    (code-switching) and English (US).
  - **Transcription**: server-side **Whisper Large-v3** (local
    `server/whisper/` Python venv, CPU int8 — accuracy over speed; the
    browser preview is the automatic fallback). Segments are timestamped;
    channels are merged chronologically.
  - **Identity**: your channel carries your real name; remote segments are
    attributed to actual people by Claude from conversational evidence plus
    the linked Google Calendar event's live attendee list, with
    "Unknown Speaker A/B" as the honest floor — capture labels never appear.
    Matched people (full name → unambiguous first name → email) receive
    engagement boosts and context memories.
  - **Intelligence**: grounded extraction (summary, topics, actions with
    owners/due dates, decisions, risks, follow-ups), **artifacts** actually
    referenced (docs/repos/tickets/links — shown in the meeting and on each
    participant's Files tab), and **carryovers** computed against the last
    8 meetings' context. Hard anti-hallucination rules: absent → empty.
  - `GET /api/meetings/live` detects calendar meetings happening now;
    `DELETE /api/meetings/:id` removes a note and its engagement history.
    A bot that *joins* calls (Gemini/Fireflies style) requires dedicated
    meeting-bot infrastructure and remains out of scope.
- **The link** — finalizing a recording upserts one `engagement_events` row
  per matched participant (unique per person+meeting: re-processing replaces,
  never stacks), mirrors the meeting onto the calendar, writes `contact`
  memories, and feeds the context engine (`gather.ts` includes recent
  meetings). The web layer invalidates `['people']` when the meeting mutation
  settles, so boosts (+N pill, Rising trend, "Today", calendar dot, drawer
  banner) appear immediately and survive reload.

All dates are **live**: `server/src/lib/design-frame.ts` derives every label
(weekdays, "Today"/"3d ago", the drawer's month calendar) from the real current
date, and meetings are stamped with their actual start time.

**No seed data.** IRIS ships without demo content: new tenants start empty and
every view renders a proper empty state until real data arrives. People are
added in the UI — one at a time, or in bulk via **Bulk add** on the People
view, which parses pasted weekly-planner entries (`{n:'…', c:'Direct',
f:'Operations', l:'BWD', d:[1,3]}`), a JSON array, or an entire planner HTML
file, previews the parse, and imports everyone new in one request
(`POST /api/people/bulk`; existing names are skipped). All legacy demo rows
were purged on 2026-07-03.

## Milestones

| | Milestone | Status |
| --- | --- | --- |
| M0 | Foundations + design-system port | ✅ |
| M1 | Google SSO auth + tenancy + RBAC | ✅ |
| M2 | Data model + live views | ✅ |
| M3 | Context Engine + Claude core (chat, approval execution, memory, Lens) | ✅ |
| M4 | Connector framework + Google integration + workers + Sync Everything | ✅ |
| M5 | Monitoring, logging, hardening, Docker, docs | ◻ |
