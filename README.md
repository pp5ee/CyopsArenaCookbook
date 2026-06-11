# CyOpsArenaCookbook — Hackathon Companion

> One workspace, four pages, one credit pool. The **CyOpsArenaCookbook** gives CyOpsxMinimax hackathon participants the rules, a Brainstorming-skill-driven prompt generator, and a live vote ticker — all backed by a single global AI-credit pool that every participant draws from. **Dark cyberpunk theme** with deep navy/teal palette, neon cyan accents, and a full-viewport arena hero aesthetic.

## What problem does this solve?

The CyOpsxMinimax hackathon has two surfaces that fight for participants' time:

1. **The rulebook** — track categories, scoring rubric, prize structure, and the credit-pool mechanics are spread across multiple Google docs and Notion pages.
2. **CyOps itself** — the IDE consumes a *prompt* to generate a project, and most participants freeze at "where do I start?".

The CyOpsArenaCookbook packages both into a single thin web app:

- A **Guide** page that surfaces the rules, prize structure, and scoring rubric in three tabs.
- A **Prompt Studio** that walks the user through a Socratic brainstorm (driven by the upstream `obra/superpowers` *Brainstorming* skill) and ends with a CyOps-ready prompt block.
- A **Live Ticker** that polls the public Arena submissions endpoint and grants the global credit pool +100 per observed net-new vote.
- An **About** page that explains the system and points to the official rubric and brainstorming skill.

## Quick start

```bash
# 1. Install
pnpm install

# 2. Configure secrets
cp .env.example .env   # the scaffold already ships a placeholder
# edit .env and set OPENAI_API_KEY=sk-...

# 3. Run
pnpm dev               # web on :5173, api on :4000
```

Open <http://localhost:5173> for the web app and <http://localhost:4000/api/health> for the API.

## Architecture

```
                       Browser (React 18 + Vite 5 + Tailwind)
                          |
                          |  /api/* proxied in dev
                          v
                  Express 4  (apps/api, :4000)
                  +------------------------------------------------------+
                  |  routes/                                             |
                  |    /api/health                                       |
                  |    /api/credits     <- getBalance()                  |
                  |    /api/chat        <- LLM + deduct 20               |
                  |    /api/prompt/*    <- Socratic state machine         |
                  |    /api/votes       <- GET summary                    |
                  |    /api/votes/stream <- SSE (vote + credits)          |
                  +-----+---------------------+--------------------------+
                        |                     |
              services/                       jobs/
                credits.ts                      votePoller.ts
                llm.ts                          (every VOTE_POLL_MS)
                votes.ts                              |
                brainstorming.ts                       | fetch
                        |                             v
                        |                       token-ai.cysic.xyz
                        | GET /v1/models
                        v
              better-sqlite3  (apps/api/data/cookbook.sqlite, WAL)
                credit_ledger, chat_log, vote_snapshot, prompt_draft
```

The web is a static SPA in production; the API is one Node 20 process. The vote poller is a single in-flight timer (no overlap), so it never blocks request handlers. SSE is the realtime channel for the ticker UI; GET `/api/votes` polls every 5 s as a fallback.

## Pages

| Path | Purpose |
| --- | --- |
| `/` | Guide — rules, prizes, scoring (Rules / Prizes / Scoring tabs) |
| `/prompt` | Prompt Studio — pick a track or free-text your idea, chat with the AI, copy the final prompt |
| `/vote` | Live Ticker — current vote count, sparkline, right-side toast on every +vote |
| `/about` | About — what this app is, the official scoring rubric, and how the brainstorming skill works |

All UI strings are localized: `apps/web/src/i18n/{en,zh}.json` cover every page; the header `LangToggle` flips the language, persists the choice to `localStorage.cookbook.lang`, and updates `<html lang>`. The LLM-side brainstorm uses the chosen locale too — the system prompt explicitly tells the model to respond in `en` or `zh` as the user picked.

## Credit pool

| Action | Delta |
| --- | --- |
| Each new vote observed on the live arena | **+100** |
| Each successful AI request (chat or prompt step) | **−20** |
| Server boot | starts at **1000** (configurable via `CREDIT_START`) |

The pool is a single ledger row mutated only through a guarded SQL `UPDATE … WHERE balance >= ?` inside a `BEGIN … COMMIT` transaction. Concurrent deductions never produce a negative balance. When the balance drops below 20 the route returns 402; the SSE stream emits a one-shot `credits` event on every threshold crossing so the UI flips to a paused state.

## Scoring rubric (baked into the prompt generator)

The CyOpsxMinimax AI judges score each project against these six dimensions. The weights are hard-coded into the brainstorming state machine's `DONE` step so the prompt you ship is already aligned with what the judges will be looking for.

| Dimension | Weight |
| --- | ---: |
| Implementation & Engineering Quality | 20% |
| Architecture & Complexity Fit | 16% |
| Deliverable Completeness | 20% |
| Project Copy & Documentation | 16% |
| AI/Agent Integration | 20% |
| Implementation Innovation | 8% |
| **Total** | **100%** |

## Recommended tracks

The Prompt Studio offers four pre-built track entries that bias the Socratic first question and shape the final rubric checklist:

| Track | One-liner |
| --- | --- |
| **Ship-a-Feature** | Close a real GitHub issue with a working PR that maintainers would actually want to merge. |
| **MCP Server Sprint** | Build a useful MCP server for real developer workflows, tools, or reusable primitives. |
| **Whole-Repo Refactor** | Modernize, migrate, or clean up a real codebase with measurable before / after improvements. |
| **The Resurrection** | Revive an abandoned, broken, or half-finished project and make it work again. |

## Environment

All configuration lives in `.env` (gitignored). See `.env.example` for the full list:

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | API listen port. |
| `DATABASE_FILE` | `data/cookbook.sqlite` | Anchored to the API package root. |
| `CORS_ORIGIN` | `http://localhost:5173` | The web dev server. |
| `OPENAI_BASE_URL` | `https://token-ai.cysic.xyz/v1` | OpenAI-compatible upstream. |
| `OPENAI_API_KEY` | (empty) | **Required.** Without it the LLM routes return 502. |
| `OPENAI_MODEL` | (empty) | Override the model picker. Otherwise `gpt-4o-mini` → `gpt-4o` → first id, cached in `apps/api/src/services/llm.selectedModel.txt`. |
| `SUBMISSIONS_URL` | (CyOps Arena) | Public live-arena JSON. |
| `VOTE_POLL_MS` | `60000` | How often the poller hits the arena. |
| `CREDIT_START` | `1000` | Seed balance. |
| `CREDIT_PER_VOTE` | `100` | Credits granted per net-new vote. |
| `CREDIT_PER_CHAT` | `20` | Credits deducted per AI request. |

> **Operator note:** this scaffold ships a placeholder `OPENAI_API_KEY` in `.env`. The real key must be supplied by the operator (manually edit `.env`, or wire it through your platform's secret manager). Never commit the real key — the `secret-guard.sh` pre-commit hook will reject it.

## Database

The API uses a local SQLite file (`apps/api/data/cookbook.sqlite`). On every server boot (`pnpm --filter @cookbook/api dev` or `start`) the migration runner applies any pending SQL files in `apps/api/src/db/migrations/`, then the seed step inserts the starting `CREDIT_START` (default 1000) credit row if the ledger is empty. Both steps are idempotent.

You can also run them by hand:

```bash
pnpm --filter @cookbook/api migrate
pnpm --filter @cookbook/api seed
```

Tables:

- `credit_ledger(id, balance, delta, reason, ref, created_at)` — single global pool. Deductions use an in-place UPDATE on the latest row; grants insert a new row.
- `chat_log(id, session_id, role, content, tokens_in, tokens_out, latency_ms, created_at)` — audit trail for every LLM call.
- `vote_snapshot(id, votes, raw_json, observed_at)` — every poll cycle records the raw upstream response.
- `prompt_draft(id, track, answers_json, prompt, created_at)` — persisted on every `DONE` step of the brainstorm.

## How the Brainstorming Skill Works

The Prompt Studio is driven by the upstream `obra/superpowers` **Brainstorming** skill, a Socratic state machine that asks one question at a time and walks you through six steps before emitting a CyOps-ready prompt:

```
INTENT → CONTEXT → CONSTRAINTS → APPROACHES → DESIGN → REFINE → DONE
```

Each transition is one LLM call. The system prompt bundles the cached skill text, the running transcript, the chosen track, the rubric weights, and the user's locale. The `DONE` transition is forced to emit JSON that matches a zod schema; the route wraps that JSON into the CyOps front-matter + Markdown block:

```yaml
---
track: <ship-a-feature | mcp-server | whole-repo-refactor | resurrection>
target_audience: <string>
success_criteria:
  - <bullet>
rubric_checklist:
  implementation_engineering_quality: 20
  architecture_complexity_fit: 16
  deliverable_completeness: 20
  project_copy_documentation: 16
  ai_agent_integration: 20
  implementation_innovation: 8
---
# <project title>
## Problem
...
## Users
...
## Solution
...
## Approach
...
## Tradeoffs
...
## Self-score against rubric
...
```

The full upstream skill is cached at `apps/api/src/services/brainstorming-skill.md` (re-fetched by `apps/api/scripts/fetch-brainstorming-skill.sh` using `agent-browser`, with a `curl`+`python3` fallback). A condensed offline copy lives at `brainstorming-skill.embedded.md`.

Every brainstorm step (other than the first fixed Socratic seed) costs 20 credits. On LLM failure the route refunds the 20 credits via `recordGrant()` so failed calls don't deduct.

## Stack

- **Frontend**: Vite 5 + React 18 + TypeScript + Tailwind + react-router + zustand + i18next. Custom `arena` color palette (bg: `#0A0E17`, accent: `#06B6D4`, surface: `#111827`) with neon glow utilities.
- **Backend**: Node 20 + Express + TypeScript + `better-sqlite3` + zod + vitest.
- **Monorepo**: pnpm workspaces. `pnpm dev` runs both apps in parallel; Vite proxies `/api/*` to Express on `:4000`.
- **LLM**: OpenAI-compatible client at `https://token-ai.cysic.xyz/v1`.

## Reference evidence

The `docs/references/` directory contains:

- `AI-scoring-breakdown.md` — verbatim copy of the project scoring rubric.
- `RecommendedTrackCategories-Scoring-rubric.md` — verbatim copy of the official four tracks + rubric.
- `brainstorming-skill.md` — cached copy of the upstream `obra/superpowers` Brainstorming skill.
- `arena-screenshot.png` — screenshot of the live CyOps Arena submissions page (captured by `agent-browser`).
- `research-notes.md` — rubric dimension → cookbook feature mapping.

## Deploy

- **Frontend (Vercel)**: connect the repo, set the project root to `apps/web`, build command `pnpm --filter web build`, output `dist`. Use `VITE_API_BASE_URL` to point at the backend.
- **Backend (any small VM)**: needs a long-lived Node process, a persistent disk for `apps/api/data/cookbook.sqlite`, and outbound HTTPS to `token-ai.cysic.xyz`. Render / Fly.io / Railway / a $5 VPS all work.

## Not implemented (yet)

- No user accounts, no per-user credit balances — one global pool.
- No direct posting of submissions to the CyOpsxMinimax arena API.
- No production HTTPS / Docker / monitoring — `pnpm dev` is the demo path.
- No persistent brainstorm session state — the in-memory session map clears on server restart (a new `start` call gets a new `sessionId`). The final `DONE` prompt IS persisted to `prompt_draft` for audit.
- No user-facing billing or top-up — credits are granted only by observed net-new votes.
- No CI / GitHub Actions workflow — `pnpm -r typecheck` and `pnpm -r test` are run by hand (and by the harness).

## License

Hackathon project — internal use.
