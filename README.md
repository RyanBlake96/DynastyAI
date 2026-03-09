# Dynasty AI

A web-based dynasty fantasy football manager that connects to your Sleeper league and provides power rankings, roster analysis, trade recommendations, and more.

## Tech Stack

- **Frontend:** React (Vite) + TypeScript + Tailwind CSS v4
- **Backend:** Vercel Serverless Functions
- **Cache:** Upstash Redis (player values from three sources, refreshed daily)
- **Hosting:** Vercel

## Getting Started

### Prerequisites

- Node.js 22+
- A Vercel account (free Hobby plan works)

### Install

```bash
npm install
```

### Local Development

```bash
npm run dev
```

To run with serverless functions locally (requires Vercel project to be linked):

```bash
nocorrect npx vercel dev
```

### Build

```bash
npm run build
```

### Deploy

```bash
nocorrect npx vercel          # preview
nocorrect npx vercel --prod   # production
```

> **Note:** `nocorrect` is needed because zsh autocorrect maps `vercel` to `.vercel`.

## Project Structure

```
/src
  /components    — Reusable UI components
  /pages         — Page-level components
  /hooks         — Custom React hooks
  /utils         — Helper functions, algorithms, constants
  /types         — TypeScript type definitions
  /api           — Client-side API functions
/api             — Vercel serverless functions
  /sleeper       — Sleeper API proxy (user.ts, league.ts, players.ts)
  /values        — Player value endpoints (cached via Redis)
  /cron          — Daily value refresh job
  /_lib          — Shared server utilities (Redis client)
```

## API Endpoints

### Sleeper Proxy

| Endpoint | Description |
|---|---|
| `/api/sleeper/user?id=<username>` | User lookup |
| `/api/sleeper/user?id=<id>&resource=leagues` | User's leagues |
| `/api/sleeper/league?id=<id>` | League details |
| `/api/sleeper/league?id=<id>&resource=rosters` | League rosters |
| `/api/sleeper/league?id=<id>&resource=users` | League members |
| `/api/sleeper/league?id=<id>&resource=drafts` | League drafts |
| `/api/sleeper/league?id=<id>&resource=transactions&round=1` | Transactions |
| `/api/sleeper/league?id=<id>&resource=matchups&week=1` | Matchups |
| `/api/sleeper/league?id=<id>&resource=traded_picks` | Traded picks |
| `/api/sleeper/players` | All NFL players |

### Player Values

| Endpoint | Description |
|---|---|
| `/api/values?type=1qb` | Cached player values (1QB) |
| `/api/values?type=sf` | Cached player values (Superflex) |
| `/api/cron/refresh-values` | Daily cron to refresh values from KTC, FantasyCalc, DynastyProcess |

## Environment Variables

Set these in your Vercel project settings:

| Variable | Description |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Auto-set by Upstash Redis integration |
| `UPSTASH_REDIS_REST_TOKEN` | Auto-set by Upstash Redis integration |
| `CRON_SECRET` | Bearer token for cron endpoint auth |
