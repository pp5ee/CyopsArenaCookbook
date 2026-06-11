# CyOpsArenaCookbook — Agent Standards

> This is the single source of truth for the AI agent (Claude / Cursor / Codex / etc.) working in this repo. Read it before changing anything; keep it in sync with reality.

## What this is
A full-stack hackathon companion for CyOpsxMinimax:
- **Frontend** (`apps/web`): Vite + React 18 + TS + Tailwind + react-router + zustand + i18next.
- **Backend** (`apps/api`): Node 20 + Express + TS + `better-sqlite3` + zod + vitest.
- **Monorepo**: pnpm workspaces. Root `pnpm dev` runs both apps in parallel; Vite proxies `/api` to Express on `:4000`.

## Ground rules
- **Never commit secrets.** `.env` is gitignored. `.env.example` holds the canonical variable list with empty values. `secret-guard.sh` rejects any commit that adds a tracked `.env`.
- **Concurrency-safe credits.** Every credit mutation goes through a single SQL `UPDATE … WHERE balance >= ?` inside `BEGIN … COMMIT`. No app-level locks, no read-then-write. The ledger row is the lock.
- **No API-key leakage.** Logs and error responses are sanitized via a single `safeLlmError()` helper. The LLM service throws `LlmError`; routes translate to `502` with a redacted message.
- **Brainstorming skill is data, not prompt.** The full upstream skill text lives in `apps/api/src/services/brainstorming-skill.md`; a condensed copy is in `brainstorming-skill.embedded.md` for offline use. State-machine transitions include the cached text in the system prompt, never the model's prior answer alone.
- **Vote normalizer is forgiving.** Try `votes` → `vote_count` → `total_votes` → `data.votes`; if none parse, log a warning and skip the cycle. The poller must never crash the server.

## Conventions
- **TypeScript strict** in both packages; `tsc --noEmit` is the typecheck gate.
- **zod** at every API boundary (request body, response body, prompt front-matter, LLM JSON).
- **Tests** live next to code: `apps/api/test/*.test.ts` (vitest). Use `--run` in CI.
- **i18n** keys live in `apps/web/src/i18n/{en,zh}.json`; never hard-code user-facing strings.
- **No new top-level packages** without updating `pnpm-workspace.yaml` and the root `package.json` scripts.

## Build order (TDD)
1. Scaffold (this AC) → install, typecheck, `.env` ignored, pre-commit blocks `.env`.
2. SQLite migration + seed.
3. Credits service + concurrent-deduction test.
4. LLM service with model discovery + error mapping.
5. Vote poller + `/api/votes` + SSE.
6. Brainstorming state machine + `/api/prompt/*`.
7. Frontend: layout, i18n, Guide, Prompt Studio, Vote Ticker.
8. README + `docs/references/`.
9. End-to-end smoke via `agent-browser`.

## Commit & PR hygiene
- One AC per branch / commit when feasible.
- Commit message: `type(scope): summary` — types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`, `ci`.
- Every PR description must link the ACs it advances and paste the verification command output.

## Quick commands
```bash
pnpm install              # install all workspace deps
pnpm -r typecheck         # TS check both apps
pnpm dev                  # web on :5173, api on :4000 (vite proxy /api -> :4000)
pnpm test                 # vitest in both apps
pnpm --filter api migrate # apply SQLite migrations
pnpm --filter api seed    # seed initial 1000-credit row
```
