# inv-2026-05-17-bot-renew — `/renew` command on Telegram bot

**Status:** invent-in-progress
**Created:** 2026-05-17
**Source:** IDEAS.md `## Invent Backlog (queued)`

---

## Research (2026-05-17)

Verdict: **PRIOR_ART_PARTIAL**

### 1. In-repo prior art
- `telegram-bot/src/index.ts` already has command routing (`/on`, `/off`, `/status`, `/predict`, `/ai`), ALLOWED_CHAT_ID gate, service-binding to `AIR_QUALITY_API`, `WORKER_API_SECRET` bearer auth, and `BOT_KV` namespace.
- KV cooldown / state pattern in use already (e.g. `bot:last_location:{chatId}` with TTL via `put({expirationTtl})`).
- No prior GitHub REST calls anywhere in `telegram-bot/`.
- Existing Telegram-sending pattern exists in Python side (`auto-renew/renew_token_passtoken.py`) — bot Worker has its own send helper already.

### 2. Library / API scan
| name | claim | viability |
|------|-------|-----------|
| GitHub REST `workflow_dispatch` | `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`. Auth: fine-grained PAT (`actions:write` on this repo) or classic PAT (`repo` scope). 204 on success, no body. | viable, zero-deps |
| GitHub REST runs poll | `GET /repos/{owner}/{repo}/actions/runs?event=workflow_dispatch&created=>{iso}&workflow_id={id}` → returns `status` + `conclusion`. Rate limit irrelevant (≤10 calls/renew, 5000/hr ceiling). | viable, zero-deps |
| Telegram `sendChatAction(typing)` | 5s active window, resend to extend. Optional UX nicety. | optional |
| Telegram `editMessageText` | Lets bot update a single message with progress states (⏳ → ✅/❌). | viable, zero-deps |

### 3. Xiaomi/MiCloud relevance
N/A — this idea doesn't touch MiCloud. It only orchestrates the existing `renew_token_passtoken.py` flow that already works.

### 4. Standards / domain
- **Auth recommendation:** fine-grained PAT (single-repo scope, `actions:write`, expirable) — lowest blast radius. Classic PAT works too but is over-scoped.
- **Poll budget:** 2–3 s interval × 30 polls = 60–90 s wall clock (renew takes ~30–60 s end-to-end).
- **Idempotency:** `workflow_dispatch` doesn't return a run ID. Must poll `actions/runs` filtered by `created >= now-30s` + `event=workflow_dispatch` + `workflow_id` to identify the run.

### 5. Competitor / adjacent
- Home Assistant / n8n / Zapier all have Telegram→GitHub flows, but as separate hosted services. No off-the-shelf "smart-home bot triggers CI for token renewal" found.

---

## Frame (v1, 2026-05-17)

### Problem
Xiaomi CN serviceToken expires in ~7 days, but `auto-renew.yml` cron is `0 2 */25 * *`. Between scheduled runs, CN devices (`maxpro`, `maxdown`, `cat`) go offline, and the user must (a) open https://github.com/.../actions/workflows/auto-renew.yml in a browser, (b) click `workflow_dispatch`, (c) wait ~60s, (d) confirm via the existing Telegram notification. That's 4 hops on a phone for a 2× monthly recurring chore.

### Goal (smallest version)
A `/renew` command in the Telegram bot that triggers `auto-renew.yml` and confirms outcome — no browser hop, ≤2 minutes wall clock from `/renew` to ✅/❌.

### Constraints (hard)
- **Worker zero-deps.** No `npm install` in `telegram-bot/`. Use `fetch` only.
- **ALLOWED_CHAT_ID gate.** Same pattern as `/on` / `/off` — non-owner chats get no response.
- **Bot stays bot.** Renewal logic lives in the existing Python workflow, NOT reimplemented in the bot. The bot is a remote control, nothing more.
- **Cooldown.** ≥10 min between `/renew` attempts per chat — `auto-renew.yml` is not idempotent-cheap (logs in to Xiaomi, rotates creds, restarts api Worker secrets).
- **Secret hygiene.** GitHub PAT lives in Worker secret only (`GH_DISPATCH_TOKEN`), never in `wrangler.toml [vars]`. Add to bot, not to api Worker.
- **Failure visibility.** GitHub auth fail / run timeout / `/api/renew` 500 must all reach the user with a distinguishable message — silent failure is worse than no command.

### Forbidden surfaces (must not touch in this invent)
- 5-point device-sync ring (`DEVICES`, `ROOM_THRESHOLDS`, `DEVICE_INFO`, `DEVICE_PROP_SPECS`, `DEVICE_MODES`) — `/renew` has nothing to do with devices.
- Per-room auto-control state machine (`auto_room_state:{id}`) — unrelated.
- Cron schedule + deadman threshold — unrelated (cron debate is a separate, independent shortcut path: just flip to weekly).
- Service binding `AIR_QUALITY_API` — `/renew` calls GitHub, not the api Worker (api Worker is already wired into `auto-renew.yml` for the post-renew `POST /api/renew`).
- `auto-renew/renew_token_passtoken.py` — unchanged. Don't rewrite in TS.

### Success criteria
1. From a phone Telegram chat, user types `/renew` and within 90 s receives ✅ (token rotated, `/api/creds` ageDays = 0) or ❌ with a reason (auth, timeout, workflow-failed).
2. Second `/renew` within 10 min returns "⏳ cooldown, try again in N min" without invoking GitHub.
3. Non-owner chat IDs receive nothing (same as `/on`).
4. No new code path edits any file in `webapp/` or `auto-renew/`.
5. Bot type-check passes; bot Worker still zero-deps.

### Out of scope
- Auto-detecting "creds are stale, run renew myself" (would belong on api Worker as a self-healing cron, separate idea).
- Renewing on a schedule different from current (cron change is a separate, independent decision).
- Showing the run logs in the bot reply — link to the run is enough.
- Rotating the GitHub PAT itself (manual quarterly rotation is acceptable).

---

## Diverge (2026-05-17)

### Approach A — Bot Dispatch + Poll
- **Primary axis:** Polling vs push (bot owns the poll loop)
- **Sketch:**
  ```
  /renew → cooldown check (KV bot:renew:cooldown:{chatId} TTL 600s)
  → POST /repos/.../workflows/auto-renew.yml/dispatches
     Authorization: Bearer GH_DISPATCH_TOKEN
  → reply "⏳ รอ workflow..." + capture ts_now
  → loop ≤30× / 3s: GET actions/runs?event=workflow_dispatch&created=>ts_now
     until run.status==completed → reply ✅/❌ + run_url
  → timeout 90s → reply "⏳ ยังไม่เสร็จ ดู: {run_url}"
  ```
- **Files touched:** `telegram-bot/src/index.ts` (~60 lines: handler + Env), no workflow change
- **Forbidden surface touch?** NO  |  **Device-sync impact?** NO  |  **`npm install`?** NO
- **New secrets:** `GH_DISPATCH_TOKEN` on bot Worker

### Approach B — Bot Dispatch + Trust Notify
- **Primary axis:** UX progression (fire-and-forget; rely on existing Telegram notification from `auto-renew.yml`)
- **Sketch:**
  ```
  /renew → cooldown check
  → POST workflow_dispatch → 204 or error
  → reply once: "✅ เริ่ม workflow แล้ว — รอแจ้งเตือนอีกครั้งใน ~60s"
  → auto-renew.yml already Telegrams success/failure on its own
  ```
- **Files touched:** `telegram-bot/src/index.ts` (~25 lines), no workflow change
- **Forbidden surface touch?** NO  |  **Device-sync impact?** NO  |  **`npm install`?** NO
- **New secrets:** `GH_DISPATCH_TOKEN` on bot Worker

### Approach C — Renew Proxy on api Worker
- **Primary axis:** Compute location (PAT lives on api Worker, bot proxies via service binding)
- **Sketch:**
  ```
  /renew → bot apiPost("/api/renew-dispatch") via service binding
  api Worker /api/renew-dispatch: reads GH_DISPATCH_TOKEN, POSTs workflow_dispatch, returns 202
  bot replies "⏳ workflow started"
  ```
- **Files touched:** `webapp/worker/src/index.ts` (~15 lines new route), `telegram-bot/src/index.ts` (~10 lines)
- **Forbidden surface touch?** NO  |  **Device-sync impact?** NO  |  **`npm install`?** NO
- **New secrets:** `GH_DISPATCH_TOKEN` on api Worker (not bot)

### Approach D — Workflow Callback Push
- **Primary axis:** Trigger (push model — workflow calls back into the bot)
- **Sketch:**
  ```
  /renew → bot dispatches workflow, stores chatId in KV
  auto-renew.yml adds final step: curl POST bot/notify {chat_id, text}
  bot /notify route: verify X-Notify-Secret, sendMessage
  ```
- **Files touched:** `telegram-bot/src/index.ts` (~30 lines + new `/notify` route), `.github/workflows/auto-renew.yml` (1 curl step)
- **Forbidden surface touch?** NO  |  **Device-sync impact?** NO  |  **`npm install`?** NO
- **New secrets:** `BOT_NOTIFY_SECRET` (bot + GH Actions), `GH_DISPATCH_TOKEN` (bot)

## Score

| Approach | smallest-version | reversibility | obs-debug | failure-mode | code-bloat | latency-to-confirm | total |
|---|---|---|---|---|---|---|---|
| A — Bot Dispatch + Poll | 3 | 5 | 5 | 4 | 3 | 5 | **25** |
| B — Bot Dispatch + Trust Notify | 5 | 5 | 4 | 3 | 5 | 3 | **25** |
| C — Renew Proxy on api Worker | 3 | 4 | 4 | 4 | 3 | 3 | 21 |
| D — Workflow Callback Push | 2 | 3 | 3 | 2 | 3 | 4 | 17 |

## Recommendation

**Primary: B — Bot Dispatch + Trust Notify.** Smallest possible diff (~25 lines, one file), zero workflow / api Worker changes. The existing `auto-renew.yml` already sends Telegram success/failure — bot only needs to fire dispatch + place a "started" ack in front.

**Fallback: A — Bot Dispatch + Poll.** Strict superset of B (same PAT, same KV key). Spike B first; if workflow's own Telegram message proves an unreliable confirmation signal, upgrade to A.

## Score-Verify (2026-05-17)

Top approach: **B**.

| check | requirement | result |
|---|---|---|
| forbidden_surface_touch | NO | ✓ NO (no device-sync, no auto-control, no cron, no service binding to api, no Python script edit) |
| device_sync_impact | NO | ✓ NO |
| `npm install` in `webapp/worker/` | NO | ✓ NO (zero-deps preserved; bot Worker only) |

No override needed. **B confirmed.**

## Spike (2026-05-17) — outcome: PASS

**Path:** `spikes/bot-renew/`
- `handler.ts` — proposed production-shape `handleRenew()` (~70 lines incl. types). Single export, zero deps, uses only `fetch` + `KVNamespace`.
- `dry-run.mjs` — runnable harness with mocked KV + fetch + 6 scenarios. No network, no secrets, no production touch.

**Run:** `node spikes/bot-renew/dry-run.mjs`

**Scenarios proven (all green):**
1. Wrong chat id → silent drop (no message, no KV write) ✓
2. Allowed chat, no cooldown → dispatch 204 → ✅ reply + cooldown TTL written ✓
3. Immediate retry → cooldown blocks with remaining minutes (10) ✓
4. GitHub 401 → distinct auth error reply, **cooldown not written** (failed attempt doesn't lock the user out) ✓
5. GitHub 404 → distinct "workflow not found" reply ✓
6. Cooldown TTL elapses → next call dispatches again ✓

**Observed limits:**
- Net insertion size into `telegram-bot/src/index.ts` ≈ 30 LoC (since `send()`, `BOT_KV`, types already exist). Inside the ≤25-line claim ballpark.
- New config surface: `GH_DISPATCH_TOKEN` (secret), `GH_REPO` (var in `wrangler.toml`).
- No fallback to A needed yet — `auto-renew.yml` already Telegrams its own outcome.

**Not proven by the spike (deferred to deploy-side smoke):**
- That a real fine-grained PAT (`actions:write`, single-repo) is accepted by GitHub (docs say yes).
- That the workflow's existing Telegram notification arrives within ~60s post-dispatch (will be checked by manual `workflow_dispatch` once before merge).

## Decision (GO) — 2026-05-17

**Verdict:** GO with approach B (Bot Dispatch + Trust Notify).

**Why:** spike proved all 6 scenarios offline; net diff ≤30 LoC in one file (`telegram-bot/src/index.ts`); zero changes to forbidden surfaces; existing `auto-renew.yml` Telegram notification covers the outcome confirmation. Fallback A (poll loop) reachable later as strict superset if trust-notify proves insufficient.

**Next:** `air-quality-planner` agent → `telegram-bot-editor` agent → human deploy gate → smoke.

**Deploy notes carried forward to planner:**
- New secret: `wrangler secret put GH_DISPATCH_TOKEN` (fine-grained PAT, `actions:write` on `nuciferx/air-quality` only).
- New `[vars]` entry: `GH_REPO = "nuciferx/air-quality"` in `telegram-bot/wrangler.toml`.
- Smoke after deploy: send `/renew` from the allowed chat once; verify ✅ ack arrives; verify workflow's own ✅/❌ Telegram message arrives within ~90s; verify `/api/creds` ageDays == 0 afterward.

---

## Plan (2026-05-17, v1 — superseded by v2 below)

> User picked global webhook gate (option 1) instead of /renew-only gate (option 2). v1 is preserved for trail. v2 is the authoritative plan.

### 0. Ambiguities surfaced

1. **`ALLOWED_CHAT_ID` does not exist in `telegram-bot/src/index.ts` today.** The invent artifact + constraints repeatedly cite "same pattern as `/on`, `/off`" — but those handlers (lines 515–520) have no chat-ID gate. **Default chosen:** introduce the gate inline only for `/renew` (read `env.ALLOWED_CHAT_ID` as a new optional `[vars]` numeric string; if unset, allow all; if set, silent-drop non-matching `chatId`). Adds 1 line to `Env` and ~2 lines at the handler entry. Does **not** retrofit `/on`/`/off` (out of scope for this invent).
2. **Final line budget.** Spike claimed ~30 LoC; the inline gate above keeps total insertion at ≤30 LoC because `send()` / `BOT_KV` / KV-TTL pattern already exist.

### 1. Goal
Add `/renew` to the Telegram bot so the owner can fire `auto-renew.yml` via `workflow_dispatch` from chat, with a 10-minute per-chat cooldown, trusting the workflow's own Telegram notification for the outcome.

### 2. Surfaces touched
- **bot** — new command handler, `/help` entry, root `commands:` array, two new `Env` fields.
- **secrets** — one new bot secret `GH_DISPATCH_TOKEN` (fine-grained PAT, `actions:write` on `nuciferx/air-quality`).
- No worker / frontend / Actions / D1 / Python edits.

### 3. File-by-file changes

**Worker (bot only)**

1. `telegram-bot/src/index.ts` — `Env` interface (lines 13–22): add `GH_DISPATCH_TOKEN: string;` and `GH_REPO: string;` (and `ALLOWED_CHAT_ID?: string;` per ambiguity #1). Sits next to existing `BOT_KV: KVNamespace;`.
2. Same file — insert `async function handleRenew(env: Env, chatId: number): Promise<string>` directly **after `handleTokenStatus`** (after line 454, before the `// ── Webhook handler ──` banner). Body: read `bot:renew:cooldown:{chatId}` from `BOT_KV` → if present, return cooldown reply with remaining minutes. Otherwise POST to `https://api.github.com/repos/{GH_REPO}/actions/workflows/auto-renew.yml/dispatches` with `Authorization: Bearer GH_DISPATCH_TOKEN`. On 204 → write cooldown key (TTL 600) + return ✅ ack. On 401/403 → distinct auth error reply, **no** KV write. On 404 → "workflow ไม่พบ", no KV write. Else → generic failure with status code, no KV write.
3. Same file — webhook routing block (lines 483–529): add `} else if (text === "/renew") { response = await handleRenew(env, chatId);` between `/token` and `/on `. Gate via `ALLOWED_CHAT_ID` inside `handleRenew`; return empty string for blocked → webhook treats empty as silent-drop (`if (!response) return new Response("OK");` guard before line 534).
4. Same file — `/help` text block (lines 484–504): add `/renew — หมุนโทเคน Xiaomi (cooldown 10 นาที)` between `/token` and `/ai`.
5. Same file — root GET `/` response `commands:` array (line 564): append `"/renew"` before `"/help"`.

**Config**

6. `telegram-bot/wrangler.toml` — under existing `[vars]` (lines 5–8) append `GH_REPO = "nuciferx/air-quality"`. `BOT_KV` binding already present — no change. Optionally also `ALLOWED_CHAT_ID = "<chat-id>"` (or leave commented out).

### 4. Schema / KV / secrets diffs

- **KV (`BOT_KV`)** — new key `bot:renew:cooldown:{chatId}`, value `"1"`, `expirationTtl: 600`. Writer: `handleRenew()` on GitHub 204 only. Reader: `handleRenew()` at entry. Mirrors `bot:last_location:{chatId}` pattern.
- **Worker secrets (bot only):** `GH_DISPATCH_TOKEN` — fine-grained PAT, `actions:write` on `nuciferx/air-quality`. Via `wrangler secret put`, never `[vars]`.
- **D1:** no changes. **Schema:** no changes.

### 5. Deploy order

From `telegram-bot/`:
1. `npx wrangler secret put GH_DISPATCH_TOKEN` — paste PAT. Required first; deploy without it = 401 from GitHub.
2. `npx wrangler deploy` — picks up new `[vars] GH_REPO`, new secret, new handler.

No `wrangler d1 execute`. No Vercel. No api Worker redeploy.

### 6. Verification

1. From owner Telegram chat: `/renew` → expect within ~2s `✅ เริ่ม workflow แล้ว — รอแจ้งเตือนอีกครั้งใน ~60 วินาที`.
2. Immediately send `/renew` again → cooldown reply, no GitHub call.
3. `gh run list --workflow=auto-renew.yml -L 1 --repo nuciferx/air-quality` → top row `workflow_dispatch` event, started <1 min ago.
4. Wait ~60–90s for `auto-renew.yml`'s own ✅/❌ Telegram message.
5. `curl "https://air-quality-api.ideaplanstudio.workers.dev/api/creds?secret=$LOG_SECRET"` → `ageDays` = 0, `updatedAt` < 2 min ago.
6. `npx wrangler tail` during step 1 → one log `Message from <user>: /renew`, no error.
7. (If `ALLOWED_CHAT_ID` set) `/renew` from another chat → zero reply.

### 7. Risks & rollback

- **Deploy without secret:** GitHub 401 → auth-error reply, no cooldown lock → retry-able. Fix: set secret + redeploy.
- **`GH_REPO` typo:** GitHub 404 → distinct reply, no lock. Fix: edit `wrangler.toml`, redeploy.
- **PAT expires:** same 401 path. Quarterly rotation per invent artifact.
- **Workflow Telegram notification fails silently:** user sees only the "started" ack. Fallback to Approach A (poll) is strict superset, addable later without schema/secret churn.
- **Cooldown key orphaned:** TTL 600s self-clears.
- **Rollback:** (a) `git revert` + redeploy, OR (b) `wrangler secret delete GH_DISPATCH_TOKEN` + redeploy → `/renew` fails closed at dispatch without breaking other commands. Either restores prior behavior; no KV cleanup.

---

## Plan (2026-05-17, v2 — authoritative)

### Pre-flight reality check
Most of the spike code has already landed in `telegram-bot/src/index.ts`. Verified by planner at planning time:
- `Env` (lines 13–25) already declares `GH_DISPATCH_TOKEN: string;`, `GH_REPO: string;`, `ALLOWED_CHAT_ID?: string;` (currently optional).
- `handleRenew()` exists at lines 459–483 with workflow_dispatch + cooldown + status-code branches matching the spike.
- `/renew` wired in router at lines 545–546.
- `/help` text lists `/renew` at line 523.
- `commands` array in `GET /` info route (line 597) already includes `/renew`.
- `wrangler.toml` line 9 has `GH_REPO = "nuciferx/air-quality"` and line 10 has a commented-out `ALLOWED_CHAT_ID` hint.

Remaining deltas: switch to global-gate posture + provision the two secrets.

### Files to edit
1. `telegram-bot/src/index.ts`
   - `Env` interface, line 24 — change `ALLOWED_CHAT_ID?: string;` → required `ALLOWED_CHAT_ID: string;`.
   - `handleWebhook`, immediately after line 497 (`const chatId = message.chat.id;`) — insert global gate: `if (String(chatId) !== env.ALLOWED_CHAT_ID) return new Response("OK");`. Place BEFORE `const text = message.text?.trim();` so location messages and all other types are dropped too.
   - `handleRenew`, line 460 — remove the inline `if (env.ALLOWED_CHAT_ID && String(chatId) !== env.ALLOWED_CHAT_ID) return "";` guard. Redundant once webhook gate is in place.
   - No changes to `/help`, router `/renew` case, or `commands` array — already in place.

2. `telegram-bot/wrangler.toml`
   - Line 10 — delete the `# ALLOWED_CHAT_ID = "..."` commented-out hint. Value lives in secrets now; stale comment invites a future reader to put it under `[vars]` by mistake.

### New secrets (from `telegram-bot/`)
- `npx wrangler secret put GH_DISPATCH_TOKEN` — fine-grained PAT, `actions:write` on `nuciferx/air-quality` only.
- `npx wrangler secret put ALLOWED_CHAT_ID` — string `"957180305"` (Telegram chat IDs can exceed `Number.MAX_SAFE_INTEGER`; never parse to Number).

### Validation
- `cd telegram-bot && npx tsc --noEmit` must pass (main risk: `ALLOWED_CHAT_ID?` → required).
- Zero changes to D1, KV bindings, service binding. No webapp redeploy.

### Out of plan (do NOT touch)
- `webapp/worker/`, `webapp/frontend/`, `auto-renew/`, `.github/workflows/`
- 5-point device-sync ring
- Per-command gates (rely on the single webhook-level gate)

### Deploy order
1. `wrangler secret put GH_DISPATCH_TOKEN` (in `telegram-bot/`)
2. `wrangler secret put ALLOWED_CHAT_ID`
3. Edit `src/index.ts` + `wrangler.toml` per above
4. `npx tsc --noEmit`
5. `npx wrangler deploy`
6. Smoke: `/renew` from owner chat → ✅ ack within ~2s; `auto-renew.yml`'s own Telegram message within ~60–90s; `/renew` again immediately → cooldown reply; `/help` from a non-owner chat (second TG account, if available) → silent.

### Risks
- **Existing non-owner chats stop working immediately** post-deploy. Accepted (single-owner posture).
- Bot Worker has no cron trigger (verified — `wrangler.toml` has no `[triggers]`), so webhook gate cannot block a system message.
- Bot ack ("✅ เริ่ม workflow แล้ว...") will be followed ~60s later by `auto-renew.yml`'s own message. Intended Trust-Notify UX, not a bug.

---

## Dev (2026-05-17) — shipped

**Deployed:** bot Worker version `d84019e1-e4f1-4a5a-af17-c0d0d60388a4` at https://air-quality-bot.ideaplanstudio.workers.dev

**Files touched:**
- `telegram-bot/src/index.ts` (+36 LoC net): `Env` adds `GH_DISPATCH_TOKEN`/`GH_REPO`/`ALLOWED_CHAT_ID`; new `handleRenew()` (lines 459–482); webhook-level chat-ID gate (lines 496–499); `/renew` router case; `/help` text; `commands` array.
- `telegram-bot/wrangler.toml` (+1 var): `GH_REPO = "nuciferx/air-quality"`.

**Secrets provisioned (bot Worker):**
- `ALLOWED_CHAT_ID` = `957180305` — set via piped `echo`.
- `GH_DISPATCH_TOKEN` = `gh auth token` (classic OAuth scopes `repo`/`workflow`/`gist`/`read:org`). Wider than the fine-grained PAT originally specified; tradeoff accepted for time-to-ship. Can be narrowed later via `wrangler secret put GH_DISPATCH_TOKEN` with a new fine-grained PAT scoped `actions:write` on `nuciferx/air-quality` only.

**Bot-side smoke (automated, both green):**
- `GET https://air-quality-bot.ideaplanstudio.workers.dev/` → commands array includes `/renew` ✓
- `GET https://air-quality-api.ideaplanstudio.workers.dev/health` → `{"status":"ok"}` ✓ (no api Worker redeploy required)

**End-to-end smoke (pending user from owner Telegram chat):**
- `/help` → expect `/renew` line in menu
- `/renew` → expect `✅ เริ่ม workflow แล้ว…` within ~2s
- `/renew` immediately again → expect `⏳ cooldown…`
- `auto-renew.yml` should appear in Actions UI within ~60–90s, ref=master, event=workflow_dispatch
- `/api/creds?secret=…` → `ageDays` drops to `0` after workflow completes
- Non-owner chat → silent drop

**Follow-ups:**
- Update memory `[[cn-token-short-ttl]]` — weekly cron + bot-driven instant renew now close the gap; old fix list is obsolete.
- (optional) Rotate `GH_DISPATCH_TOKEN` to a fine-grained PAT for narrower blast radius.

