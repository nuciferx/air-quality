---
name: aq-invent
description: |
  One-shot invention pass on a single air-quality idea — runs the 7-phase pipeline (PICK → RESEARCH → FRAME → DIVERGE → SCORE → SPIKE → CHECKPOINT) once and stops at the human checkpoint. Use when you want to deliberately develop a novel approach for an idea in `IDEAS.md` (queue section) WITHOUT looping into the next idea. For continuous operation across the whole invent backlog, use `/aq-invent-loop`.

  Trigger phrases (Thai): "/aq-invent", "ลองคิดวิธีใหม่", "วิจัย + ออกแบบ", "invent", "ประดิษฐ์ feature"
  Trigger phrases (English): "/aq-invent", "invent on idea", "research and design"

  Do NOT use for: capturing a fresh idea (use `/idea`), routine implementation (use `air-quality-planner`), or fixing a known bug (just edit the code directly).
---

# /aq-invent — One-shot invention pipeline (single idea)

Goal: take one idea from `IDEAS.md` `## Invent Backlog (queued)` and walk it to either `invent-done-go` (a real plan ready for `air-quality-planner`) or `invent-done-nogo` (closed with rationale). Output artifact = `docs/invent/<short-name>.md`. Halts at the human checkpoint — only the human decides GO / NOGO / RESHAPE.

This is the manual single-shot version. `/aq-invent-loop` chains it.

## Inputs

- Args: `idea_id` (queue id like `inv-2026-05-17-bot-renew`, OR a short slug). If empty: list queued candidates from `IDEAS.md` `## Invent Backlog (queued)` and ask which one.

## The 7 phases

### 1. PICK

- Read `IDEAS.md` `## Invent Backlog (queued)`. If status is already `invent-in-progress` for someone, ABORT — only one invent pass per idea at a time.
- Decide `short-name` (kebab case, ≤5 words). Artifact path = `docs/invent/<short-name>.md`. Create the folder if missing.
- Create `docs/invent/<short-name>.md` with stub sections: `## Frame`, `## Research`, `## Diverge`, `## Score`, `## Recommendation`, `## Spike`, `## Decision`.
- Flip the IDEAS.md entry's `Status:` to `invent-in-progress`.

### 2. RESEARCH (delegate to `aq-researcher`)

- Hand the agent: `idea_id`, `idea_summary`, `idea_body`, `tags`.
- Receive the 5-section research block + verdict (`PRIOR_ART_MATURE` / `PRIOR_ART_PARTIAL` / `GREENFIELD`).
- Paste verbatim into `docs/invent/<short-name>.md` under `## Research`.
- **If verdict = `PRIOR_ART_MATURE`** → SKIP phases 3-6. Go to phase 7 CHECKPOINT with a "use prior art" recommendation: write a plan that adopts the existing solution. WIN exit, not a failure.

### 3. FRAME

Write `## Frame` ≤1 page covering:
- **Problem** — concrete user pain in 2 sentences
- **Constraints** — must respect: Worker zero-deps / per-room auto-control invariant / bot uses service binding / secrets via `wrangler secret put` only / Thai user-facing text / 5-min cron + 15-min deadman
- **Forbidden surfaces this invent must avoid** — explicit list (the 5-point device-sync ring is forbidden in invents; that ring is touched only in ship sprints)
- **Success criteria** — how we'd know in spike if it works (concrete metric, e.g. "curl returns expected JSON in <2s", "Telegram receives ack within 45s")
- **Out of scope** — what we're explicitly NOT solving this pass

### 4. DIVERGE (delegate to `aq-inventor`)

- Hand the agent: `idea_id`, `frame` (the section just written), `research_report`, `target_approach_count=5`.
- Receive `## Diverge` (3-5 approaches on different axes) + `## Score` + `## Recommendation`.
- Paste verbatim.
- **If agent returns `INVENT_DESIGN_AMBIGUOUS`** → RESHAPE: tighten `## Frame` (usually narrower problem statement), then re-delegate. Allow 1 retry. Still ambiguous → emit `INVENT_DESIGN_AMBIGUOUS` and halt for human.

### 5. SCORE-VERIFY

The inventor already produced the score table. Verify:
- Top approach must have `forbidden_surface_touch: NO`
- Top approach must have `device_sync_impact: NO` (or escalate to user — touching the 5-point ring is a ship sprint, not an invent)
- Top approach must not require an `npm install` in `webapp/worker/`
- If any violation, re-rank to next safe approach and note the override in `## Score`.

### 6. SPIKE

Create `spikes/<short-name>/` containing:
- `handler.ts` — a single Web-Crypto / `fetch`-only TypeScript file exporting a fetch handler. Mounts as ONE extra route (e.g. `/spike/<short-name>`) when the user wires it temporarily into a local worker-dev run.
- `wrangler.toml` — minimal, references same D1+KV namespaces in **read-only** mode (or stubbed). NO production binding values copied here.
- `smoke.curl.sh` — curl commands the implementer runs against `http://localhost:8787/spike/<short-name>` to validate.
- `README.md` — what to run + what success looks like (= the `success_criteria` from Frame).

**Strict isolation rules:**
- NEVER deploy spike code. Spike NEVER reaches `wrangler deploy` / `vercel --prod`.
- Spike is run only via `npx wrangler dev` in the `spikes/` folder, or by the user temporarily adding `import { spike } from "../../../spikes/<name>/handler"` in a branch they don't push.
- Spike NEVER edits `webapp/worker/src/index.ts` / `webapp/frontend/` / `telegram-bot/src/index.ts` directly. If the spike requires patching one of those, halt with `LOOP_STOP_INVENT_TOUCHES_PROD_CODE`.
- Spike MAY read production via public endpoints (`/health`, `/api/devices`) — that's already public.
- Worker zero-deps applies inside `spikes/` too: no `npm install`.

Spike acceptance = the `success_criteria` from `## Frame` are demonstrably met when `bash smoke.curl.sh` is run against local worker-dev. Record outcome under `## Spike`:
- Approach attempted (A / B / C)
- Outcome (pass / fail) + ≤5 line rationale
- Curl output excerpt (≤10 lines)

**If first approach fails** → spike approach #2 (fallback). If that fails → approach #3. **3 failed spikes → STOP** with `LOOP_STOP_INVENT_DEAD_END`.

### 7. CHECKPOINT (human decides)

Print ≤15 lines to the user:

```
🧪 Invent pass complete: <short-name>
Research verdict: <MATURE / PARTIAL / GREENFIELD>
Approaches generated: <n>
Top approach: <name>
Spike outcome: <pass / fail→recovered-with-B / dead-end>

Doc: docs/invent/<short-name>.md
Spike: spikes/<short-name>/

Decide:
  GO     — promote to a real plan (I'll hand off to air-quality-planner)
  NOGO   — close with rationale (I'll record why)
  RESHAPE — frame is wrong; back to phase 3 with new framing
```

Ask the user. **Do not pick automatically.**

### 8. Apply decision

- **GO** → append `## Decision (GO)` to artifact with one-line takeaway. Update IDEAS.md entry to `invent-done-go (→ docs/invent/<short-name>.md)`. Suggest user run `air-quality-planner` agent next to produce file-by-file plan.
- **NOGO** → append `## Decision (NOGO)` with reason. Update IDEAS.md entry to `invent-done-nogo`. Artifact stays for future reference. Delete `spikes/<short-name>/` (it served its purpose) OR keep if user asks.
- **RESHAPE** → reset phases 3-6 in artifact (mark prior frame as `(v1, reshaped)`), keep phase 2 research. User specifies new framing; restart at phase 3.

### 9. Commit

One commit. Allowed paths:
- `docs/invent/<short-name>.md`
- `spikes/<short-name>/` (and any sibling files)
- `IDEAS.md` (status flip only — never rewrite other entries)

Forbidden paths in this commit (will fail safety check):
- `webapp/worker/src/index.ts`
- `webapp/frontend/**`
- `telegram-bot/src/index.ts`
- `.github/workflows/*.yml`
- `*.toml` (wrangler configs)
- `creds.json`, `*.2fa_url`, any `auto-renew/*.log`

Invention never touches production code — that's the ship phase, after GO + `air-quality-planner`.

Commit message: `invent(<short-name>): <GO|NOGO|PRIOR_ART> — <one-line takeaway>`

## Stop conditions

| # | Condition | Emit |
|---|---|---|
| 1 | Research verdict = MATURE → adopt prior art | `INVENT_DONE_PRIOR_ART` (WIN exit) |
| 2 | Inventor cannot reach 3 distinct approaches after 1 RESHAPE | `INVENT_DESIGN_AMBIGUOUS` |
| 3 | Every approach requires editing a forbidden surface | `INVENT_FORBIDDEN_REQUIRED` |
| 4 | Spike requires editing prod code paths | `LOOP_STOP_INVENT_TOUCHES_PROD_CODE` |
| 5 | 3 spike attempts fail | `LOOP_STOP_INVENT_DEAD_END` |
| 6 | Successful spike → human checkpoint reached | `INVENT_AT_CHECKPOINT` |

## Hard rules

- **No code in production paths during invention.** Spike lives in `spikes/<name>/` only. The pre-commit path check enforces this.
- **Schema-additive only** — new KV keys / new D1 columns OK; rename/remove is a separate ship sprint.
- **Human decides GO/NOGO/RESHAPE — never the skill.** This is the boundary from `air-quality-planner` (which produces plans on request, not verdicts).
- **Research-first is non-negotiable.** Even if user thinks the idea is novel, run phase 2 — it's haiku-cheap and often surfaces an API/library that saves a sprint.
- **Output budget:** ≤25 lines to user per phase update; the artifact `docs/invent/<short-name>.md` holds the detail.
- **Thai user-facing strings stay Thai** if the spike emits any Telegram message.
- **Never call `/api/creds` with `?secret=...`** during spike — use only public endpoints.
