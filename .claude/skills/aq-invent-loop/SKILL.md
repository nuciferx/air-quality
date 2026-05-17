---
name: aq-invent-loop
description: |
  One iteration of the air-quality Autonomous Invention Loop — picks the next `invent-queued` idea from `IDEAS.md` `## Invent Backlog (queued)`, runs the 7-phase invention pipeline (PICK → RESEARCH → FRAME → DIVERGE → SCORE → SPIKE → CHECKPOINT), and halts at the human checkpoint so the user can decide GO / NOGO / RESHAPE. After the user decides, the loop continues to the next idea. Designed to run via `/loop /aq-invent-loop` until the invent backlog is exhausted. Feeds the regular implementation flow by promoting GO ideas to `air-quality-planner`.

  Trigger phrases (Thai): "invent loop", "วิ่งลูปคิดวิธีใหม่", "loop ประดิษฐ์"
  Trigger phrases (English): "invent loop", "run the invent loop"

  Do NOT use for: one-off invention on a single idea (use `/aq-invent`), capturing new ideas (use `/idea`), or routine implementation (use `air-quality-planner`).
---

# /aq-invent-loop — Autonomous Invention Loop (one iteration)

Goal: drive air-quality invention idea-by-idea, **with a mandatory human checkpoint per idea**, until the invent backlog is exhausted. **One invocation = one idea taken to checkpoint.** Run `/loop /aq-invent-loop` for continuous operation across many ideas.

Source of truth for the queue: `IDEAS.md` `## Invent Backlog (queued)` — entries with `Status: invent-queued`.

This loop is the upstream of `air-quality-planner`:

```
/idea (capture) ─┐
                 ↓
IDEAS.md ── /aq-invent-loop ── invent-done-go ── air-quality-planner ── deploy
                 │
                 └── invent-done-nogo (closed, kept for reference)
```

## The 9 steps (one iteration)

1. **PICK** — Read `IDEAS.md` `## Invent Backlog (queued)`. Pick the topmost `invent-queued` entry (priority: `p-high` > tagged `experiment` > oldest first). If none exists → emit `INVENT_LOOP_DONE` and stop. Flip status to `invent-in-progress`.

2. **RESEARCH** — Delegate to `aq-researcher`. Paste output into `docs/invent/<short-name>.md` § Research. If verdict = `PRIOR_ART_MATURE` → SKIP to step 7 with "adopt prior art" recommendation (WIN exit).

3. **FRAME** — Write `## Frame` (problem / constraints / forbidden surfaces / success criteria / out-of-scope). ≤1 page. Air-quality forbidden surfaces in invents: the 5-point device-sync ring, per-room auto-control state machine, Worker zero-deps, service-binding (bot ↔ api), cron schedule + deadman threshold.

4. **DIVERGE** — Delegate to `aq-inventor` with the frame + research. Receive `## Diverge` + `## Score` + `## Recommendation`. If agent returns `INVENT_DESIGN_AMBIGUOUS` → re-sharpen `## Frame` ONCE, re-delegate. Still ambiguous → STOP with `INVENT_DESIGN_AMBIGUOUS`.

5. **SCORE-VERIFY** — Sanity-check the ranking:
   - Top approach must have `forbidden_surface_touch: NO`
   - Top approach must have `device_sync_impact: NO`
   - Top approach must not require `npm install` in `webapp/worker/`
   - If any violation, re-rank to next safe approach and note the override in `## Score`.

6. **SPIKE** — Build `spikes/<short-name>/` per `/aq-invent` § 6 rules. Try top approach. If fail, try fallback. If fail, try third. **3 fails → STOP with `LOOP_STOP_INVENT_DEAD_END`.** Record outcome in `## Spike`. Spike code NEVER touches `webapp/worker/src/index.ts` / `webapp/frontend/` / `telegram-bot/src/index.ts` / `.github/workflows/`.

7. **CHECKPOINT** — **HALT here.** Print ≤15-line summary (artifact + spike paths, verdict, top approach, spike outcome) and ask: `GO` / `NOGO` / `RESHAPE`. Loop does not proceed until the user answers.

   - **GO** → append `## Decision (GO)` to artifact + flip IDEAS.md entry to `invent-done-go (→ docs/invent/<short-name>.md)`. Suggest user run `air-quality-planner` next.
   - **NOGO** → append `## Decision (NOGO)` + flip IDEAS.md entry to `invent-done-nogo`. Optionally delete `spikes/<short-name>/`.
   - **RESHAPE** → restart at step 3 with new framing from user. Mark prior frame in artifact as `(v1, reshaped)`.

8. **COMMIT** — One commit. Allowed paths:
   - `docs/invent/<short-name>.md`
   - `spikes/<short-name>/`
   - `IDEAS.md` (status flip only)

   Forbidden paths (will fail safety check): `webapp/worker/src/index.ts`, `webapp/frontend/**`, `telegram-bot/src/index.ts`, `.github/workflows/*.yml`, `*.toml`, secrets/creds files. Invention never touches the live app — that's the post-GO ship phase.

   Commit message: `invent(<short-name>): <GO|NOGO|PRIOR_ART> — <one-line takeaway>`

9. **LOOP** — Emit `INVENT_LOOP_ITERATION_DONE` with ≤3-line summary (idea done, decision, what's next from queue). The `/loop` wrapper re-invokes for the next idea.

## Stop conditions (halt, report, wait for user)

| # | Condition | Emit |
|---|---|---|
| 1 | `IDEAS.md` `## Invent Backlog (queued)` empty | `INVENT_LOOP_DONE` |
| 2 | Inventor can't produce ≥3 distinct approaches after 1 RESHAPE | `INVENT_DESIGN_AMBIGUOUS` |
| 3 | Every approach requires editing a forbidden surface | `INVENT_FORBIDDEN_REQUIRED` |
| 4 | Spike requires patching production code paths | `LOOP_STOP_INVENT_TOUCHES_PROD_CODE` |
| 5 | 3 spike attempts all fail | `LOOP_STOP_INVENT_DEAD_END` |
| 6 | Budget: one idea > 3 reshape rounds | `LOOP_STOP_INVENT_BUDGET` |
| 7 | Reached human checkpoint successfully | `INVENT_AT_CHECKPOINT` (always — by design) |

Stop conditions 1–6 require the user to investigate before restarting `/loop /aq-invent-loop`. Stop condition 7 is the normal end-of-iteration: user answers GO/NOGO/RESHAPE then loop continues automatically on next firing.

## Rules

- **One iteration = one idea = one commit at checkpoint resolution.** Never bundle ideas.
- **Human always decides GO/NOGO/RESHAPE.** This is the explicit difference from a hypothetical full-auto dev loop. Invention requires human risk-taking — the loop never auto-promotes a spike.
- **Never touch the live app during invention.** Spike lives in `spikes/`, full stop. The pre-commit path check enforces this.
- **Schema is additive only.** Any KV/D1 schema change proposed must be backward-compatible — no renames/removes during invent.
- **Worker zero-deps still applies inside `spikes/`.** No `npm install`.
- **Research-first is non-negotiable.** Even for "obviously novel" ideas, run phase 2 — haiku-cheap, often saves a whole spike by surfacing an API.
- **The implementation pipeline reads only `invent-done-go` items.** Raw `invent-queued` items are NOT eligible for `air-quality-planner` — they must pass through this loop first.

## Output budget per iteration

≤30 lines user-facing per iteration. Detail lives in `docs/invent/<short-name>.md`. User should read every iteration's report in under 30 seconds and decide GO/NOGO/RESHAPE without re-deriving context.

## Handoffs

- On GO → suggest user run `air-quality-planner` agent with the invent artifact as input.
- On NOGO + repeated similar failures (≥2 in last 5 iterations on same surface) → suggest user run `/aq-start` or `usage-analyst` to revisit whether the framing direction is right.
- On `INVENT_LOOP_DONE` → suggest user run `/idea` to capture more ideas, or hand off to ship sprints via `air-quality-planner` + `deploy-checker`.
