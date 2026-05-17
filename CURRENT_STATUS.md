# CURRENT_STATUS.md

> Updated: 2026-05-17
> Phase: **A — production-stable** (monitoring + auto-control + bot + token health)

## One-line

Production stable; latest ship `bot-renew` (`/renew` Telegram command) `804da0a`; sprint `gtm-loop-adoption` **closed PASS** (docs/skill/agent restructure done, no production code); next sprint TBD per `NEXT_ACTION.md`.

## Quick pointers (small files first)

- [docs/status/LATEST_STATUS.md](docs/status/LATEST_STATUS.md) — feature-level current state
- [docs/status/NEXT_ACTIONS.md](docs/status/NEXT_ACTIONS.md) — what to do next, ordered
- [docs/status/TEST_BASELINE.md](docs/status/TEST_BASELINE.md) — last smoke results
- [docs/status/COMMIT_HISTORY.md](docs/status/COMMIT_HISTORY.md) — recent commits with context
- [docs/status/KNOWN_ISSUES.md](docs/status/KNOWN_ISSUES.md) — anomalies + workarounds

## Full files

- [NEXT_ACTION.md](NEXT_ACTION.md) — top-level next decision
- [log.md](log.md) — running session log
- [PROGRESS.md](PROGRESS.md) — phase history (Phase 1–5 shipped)
- [IDEAS.md](IDEAS.md) — feature backlog + invent queue + dropped
- [AGENTS.md](AGENTS.md) §16 — GTM Operating Loop (new)
- [docs/process/SPRINT_INDEX.md](docs/process/SPRINT_INDEX.md) — sprint dashboard

## Live URLs

- API: `https://air-quality-api.ideaplanstudio.workers.dev` ( `/health` 200 last check 2026-05-17 16:00 ICT )
- Bot: `https://air-quality-bot.ideaplanstudio.workers.dev` (version `d84019e1`)
- Dashboard: Vercel `air-quality-nucifer`

## Last smoke

- `/health` → `{"status":"ok"}` ✓
- `/api/devices` → 4 devices, pm25 > 0 ✓
- bot `/` → commands list includes `/renew` ✓
- workflow `auto-renew.yml` run `25986998609` → success + Telegram 200 ✓
