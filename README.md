# Cypress Arena Cookbook — Hackathon Companion

> One workspace, four pages, one credit pool. The **CyOpsArenaCookbook** gives CyOpsxMinimax hackathon participants the rules, a Brainstorming-skill-driven prompt generator, and a live vote ticker — all backed by a single global AI-credit pool.

## Quick start

```bash
# 1. Install
pnpm install

# 2. Configure secrets
cp .env.example .env   # already done for you in this scaffold
# edit .env and set OPENAI_API_KEY=sk-...

# 3. Run
pnpm dev               # web on :5173, api on :4000
```

Open <http://localhost:5173> for the web app and <http://localhost:4000/api/health> for the API.

## Pages

| Path | Purpose |
| --- | --- |
| `/` | Guide — rules, prizes, scoring (Rules / Prizes / Scoring tabs) |
| `/prompt` | Prompt Studio — pick a track or free-text your idea, chat with the AI, copy the final prompt |
| `/vote` | Live Ticker — current vote count, sparkline, right-side toast on every +vote |
| `/about` | About — what this app is, who built it, and the official scoring rubric |

## Credit pool

| Action | Delta |
| --- | --- |
| Each new vote observed on the live arena | **+100** |
| Each successful AI request (chat or prompt step) | **−20** |
| Server boot | starts at **1000** (configurable via `CREDIT_START`) |

The pool is a single ledger row mutated only through a guarded SQL `UPDATE … WHERE balance >= ?`. Concurrent deductions never produce a negative balance.

## Environment

All configuration lives in `.env` (gitignored). See `.env.example` for the full list. The most important variable is `OPENAI_API_KEY` — without it the LLM routes return `502`.

## Stack

- **Frontend**: Vite 5 + React 18 + TypeScript + Tailwind + react-router + zustand + i18next.
- **Backend**: Node 20 + Express + TypeScript + `better-sqlite3` + zod + vitest.
- **Monorepo**: pnpm workspaces. `pnpm dev` runs both apps in parallel; Vite proxies `/api/*` to Express on `:4000`.

## Deploy

- **Frontend (Vercel)**: connect the repo, set the project root to `apps/web`, build command `pnpm --filter web build`, output `dist`. Use `VITE_API_BASE_URL` to point at the backend.
- **Backend (any small VM)**: needs a long-lived Node process, a persistent disk for `apps/api/data/cookbook.sqlite`, and outbound HTTPS to `token-ai.cysic.xyz`. Render / Fly.io / Railway / a $5 VPS all work.

## Not implemented (yet)

- No user accounts, no per-user credit balances — one global pool.
- No direct posting to the CyOpsxMinimax arena API.
- No production HTTPS / Docker / monitoring — `pnpm dev` is the demo path.

## License

Hackathon project — internal use.
