---
name: aq-dev-loop
description: |
  One iteration of the air-quality Semi-Auto Dev Loop — picks the next `invent-done-go` idea from `IDEAS.md`, plans it via `air-quality-planner`, implements via the right editor agent (`telegram-bot-editor` or `webapp-editor`), type-checks, and HALTS at the deploy gate so the user can run `deploy-checker` + `wrangler deploy` / `vercel --prod` themselves (production safety — `wrangler deploy` affects live cron + real devices). After deploy, runs smoke tests, marks shipped, loops to next. Designed to run via `/loop /aq-dev-loop` until the GO queue is exhausted.

  Trigger phrases (Thai): "dev loop", "รันลูป dev", "ทำต่อจนจบ", "วิ่ง loop", "พัฒนาต่อเอง"
  Trigger phrases (English): "dev loop", "run the dev loop", "build all GO ideas"

  Do NOT use for: a single targeted change (call `telegram-bot-editor` / `webapp-editor` directly), pre-GO inventions (use `/aq-invent` / `/aq-invent-loop` first), or urgent fixes (skip the loop, fix the code).
---

# /aq-dev-loop — Semi-Auto Dev Loop (one iteration)

Goal: drive air-quality implementation idea-by-idea — pick the next GO'd invent, plan, implement, type-check, halt at deploy gate for human review, smoke after deploy, loop. **One invocation = one shipped idea.** Run `/loop /aq-dev-loop` for continuous operation.

This is the downstream of `/aq-invent-loop`:

```
IDEAS.md "invent-done-go (→ docs/invent/<name>.md)"
              ↓
[/aq-dev-loop] ── plan ── code ── type-check ── 🛑 DEPLOY GATE 🛑 ── smoke ── shipped
                                                       ↑
                                                user deploys
```

**Why "semi-auto" not "full-auto":** every `wrangler deploy` affects the live cron `*/5 * * * *` and real Xiaomi devices in production. The user explicitly values uptime over speed (`CLAUDE.md`). Plan + code + type-check is automated; deploy is a human checkpoint. This is the core difference from `/bma-dev-loop` which is full-auto into a local app.

## The 9 steps (one iteration)

> Each step is annotated with its GTM phase per `AGENTS.md` §16. GTM 2 (Restoration) is the **implicit pre-condition** — production must be green before this loop runs (`/aq-start` to verify). If Phase A is red, do Restoration FIRST outside the loop. GTM 6 (Condition Kaizen) is opportunistic during step 2 PLAN — out-of-scope improvements get queued in `IDEAS.md`, not done inline.

1. **PICK** _(GTM 1 — Understanding Condition)_ — Read `IDEAS.md`. Find topmost entry with `Status: invent-done-go (→ docs/invent/<short-name>.md)`. If none → emit `DEV_LOOP_DONE` and stop. Flip status to `dev-in-progress`.

2. **PLAN** _(GTM 3 — Defect Factors Analysis)_ — Read `docs/invent/<short-name>.md`. Confirm `## Decision (GO)` exists. Delegate to `air-quality-planner` agent with the artifact as input. Receive a file-by-file plan. Append it as `## Plan (YYYY-MM-DD)` to the artifact. Planner classifies defect against the 10 categories in AGENTS.md §16.1 step 3.
   - If planner returns "needs human design choice" / "would touch 5-point sync ring" → **STOP** → `LOOP_STOP_NEEDS_HUMAN_PLAN`.

3. **DETERMINE SURFACE** _(GTM 4 — Eliminating Factors of Defect: setup)_ — From plan, identify which editor agent to use:
   - Plan touches `telegram-bot/` only → `telegram-bot-editor`
   - Plan touches `webapp/` only (worker and/or frontend) → `webapp-editor`
   - Plan touches both, OR `.github/workflows/`, OR root-level `*.py` → **STOP** → `LOOP_STOP_CROSS_SURFACE` (cross-surface ships need ordered manual deploy; do them as separate iterations or run `air-quality-planner` manually)

4. **BUILD** _(GTM 4 — Eliminating Factors of Defect: apply)_ — Delegate to the chosen editor agent with the plan. Agent edits files, runs:
   - For `telegram-bot-editor`: `cd telegram-bot && npm run type-check` (or `npx tsc --noEmit`)
   - For `webapp-editor`: `cd webapp/worker && npm run type-check` AND/OR `cd webapp/frontend && npm run build`
   Receive back: file list (with line ranges), type-check/build result, any required `wrangler secret put` / `wrangler d1 execute` commands.

5. **VERIFY** _(GTM 4 — Eliminating Factors of Defect: regression guard)_ — If type-check / build fails, ONE surgical retry via the same editor agent (pass the error message). Still failing → **STOP** → `LOOP_STOP_BUILD_FAILED`.

6. **DEPLOY GATE (HUMAN CHECKPOINT)** _(GTM 4 → 5 transition: commit point)_ — **HALT here.** Print ≤15-line summary:

   ```
   🚢 Ready to deploy: <short-name>
   Surface: <bot | worker | frontend | worker+frontend>
   Files changed: <count>
   Type-check / build: ✓

   Pre-deploy required:
     - <wrangler secret put X>  (if any)
     - <wrangler d1 execute ... schema.sql>  (if any)

   Deploy commands (in order):
     1. <e.g. cd webapp/worker && npx wrangler deploy>
     2. <e.g. cd webapp/frontend && npx vercel --prod>

   Suggest: run `deploy-checker` agent first → run commands above → reply here with:
     "deployed"   — I'll run smoke tests and mark shipped
     "rollback"   — I'll `git revert` and mark dev-rollback
     "reshape"    — frame the diff differently; back to step 2
   ```

   Wait for the user. **Do NOT run deploy commands yourself.**

7. **APPLY DECISION** _(GTM 5 — Setting Condition)_ :
   - **deployed** → Run smoke tests:
     ```bash
     curl -s -m 5 https://air-quality-api.ideaplanstudio.workers.dev/health
     curl -s -m 5 https://air-quality-api.ideaplanstudio.workers.dev/api/devices | head -c 1500
     # if bot change: send a test message via TELEGRAM_BOT_TOKEN to ALLOWED_CHAT_ID
     ```
     If pass → mark IDEAS.md entry `dev-done-shipped (deployed YYYY-MM-DD, sha <short>)`. Append `## Dev (YYYY-MM-DD) — shipped` to artifact.
     If smoke fails → **STOP** → `LOOP_STOP_SMOKE_FAILED` (handoff: `xiaomi-debugger`).
   - **rollback** → run `git revert HEAD --no-edit`. Mark entry `dev-rollback`. Append `## Dev (YYYY-MM-DD) — rolled back: <reason>` to artifact. The user can re-queue or `/aq-invent` to reshape.
   - **reshape** → mark current plan section as `(v1, reshaped)`, restart at step 2 with user's new framing.

8. **COMMIT** _(GTM 5 — Setting Condition: lock in)_ — One commit. Message: `feat(<short-name>): <one-line takeaway>` (or `fix:` / `chore:` as fits). Allowed paths:
   - The files the editor agent changed (worker / frontend / bot — whichever surface)
   - `docs/invent/<short-name>.md` (Plan + Dev sections)
   - `IDEAS.md` (status flip only)
   - `webapp/worker/schema.sql` (only if step 4 added a column)

   Forbidden paths: `creds.json`, `*.2fa_url`, anything in `auto-renew/*.log`, `nucifer-data-sheet-api-*.json`, anything matching `.gitignore` patterns. Pre-commit safety check enforces this.

9. **LOOP** _(GTM 7 — Condition Management)_ — Update `IDEAS.md` status (done in step 7). Append `docs/status/COMMIT_HISTORY.md` row + smoke result to `docs/status/TEST_BASELINE.md` (per AGENTS.md §16.3). Update `log.md` + `CURRENT_STATUS.md` + `NEXT_ACTION.md`. If sprint folder exists for this idea, move `sprints/active/<...>/` → `sprints/completed/<...>/`. Emit `DEV_LOOP_ITERATION_DONE` with ≤3-line summary (idea shipped, surface, sha). The `/loop` wrapper re-invokes for next.

## Stop conditions (halt, report, wait for user)

| # | Condition | Emit |
|---|---|---|
| 1 | No `invent-done-go` entries in IDEAS.md | `DEV_LOOP_DONE` |
| 2 | Planner can't produce safe plan (touches sync ring / needs design choice) | `LOOP_STOP_NEEDS_HUMAN_PLAN` |
| 3 | Cross-surface change (worker + bot, or includes gh-actions / root `*.py`) | `LOOP_STOP_CROSS_SURFACE` |
| 4 | Build / type-check fails after one retry | `LOOP_STOP_BUILD_FAILED` |
| 5 | User chose `rollback` or `reshape` at deploy gate | (no stop — loop continues on next firing) |
| 6 | Smoke tests fail after `deployed` | `LOOP_STOP_SMOKE_FAILED` |
| 7 | At deploy gate, waiting for user | `DEV_AT_DEPLOY_GATE` (always — by design) |

Stop conditions 1, 2, 3, 4, 6 require the user to investigate before restarting `/loop /aq-dev-loop`. Condition 7 is the normal end-of-iteration: user replies `deployed`/`rollback`/`reshape` then loop continues on next firing.

## Hard rules

- **One iteration = one shipped feature = one commit.** Never bundle features.
- **Never run `wrangler deploy` / `vercel --prod` yourself.** The deploy gate is non-negotiable — air-quality production runs cron `*/5 * * * *` on whatever is on master. Every deploy affects real devices. Human approves.
- **Never bypass `deploy-checker`.** Its checks (type-check passes, schema applied, secrets present, no `*.json` creds staged) are mandatory pre-flight before any deploy.
- **Smoke test required after `deployed`.** Even if user confirms — verify via curl `/health` + `/api/devices`. Halt if smoke fails; don't loop on.
- **Cross-surface ships → STOP.** Worker+bot+frontend changes in one sprint need ordered deploy + KV consistency consideration; run them as separate iterations or hand off to `air-quality-planner` manually.
- **Never edit the 5-point device-sync ring inside a dev-loop iteration.** That ring is its own dedicated sprint that requires verifying `verify_pm25.py` first — escalate to user.
- **Schema is additive only** — new D1 columns + new KV keys OK; rename/drop is a separate sprint with migration plan.
- **Worker zero-deps applies through the whole loop** — editor agents enforce, but verify nothing slipped in.
- **Thai user-facing strings stay Thai.** Plan + commit messages in English are fine.
- **Never push to a remote** — repo doesn't auto-push; user controls when to share.

## Output budget per iteration

≤30 lines user-facing per iteration. Detail lives in `docs/invent/<short-name>.md` `## Plan` + `## Dev` sections. The deploy-gate summary is the longest user-facing block (≤15 lines) — keep iteration reports tight so the trail stays readable over many runs.

## Handoffs

- `LOOP_STOP_NEEDS_HUMAN_PLAN` → user invokes `air-quality-planner` manually with custom guidance
- `LOOP_STOP_CROSS_SURFACE` → user splits into 2 separate IDEAS.md entries (one per surface) OR plans manually with `air-quality-planner`
- `LOOP_STOP_BUILD_FAILED` → user inspects the error; possibly invokes the editor agent directly with a fix hint
- `LOOP_STOP_SMOKE_FAILED` → user invokes `xiaomi-debugger` (most likely cause: token / siid / cron drift)
- `DEV_LOOP_DONE` → user runs `/aq-roadmap` to see what's next, or `/aq-invent-loop` to convert more queued ideas to GO
- After `deployed` smoke pass → suggest user run `/aq-start` periodically to catch post-deploy drift
