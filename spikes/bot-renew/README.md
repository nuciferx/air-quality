# Spike — bot-renew (approach B)

Proves the smallest version of `/renew` (Bot Dispatch + Trust Notify): GitHub `workflow_dispatch` from a Worker-shaped handler, KV cooldown gate, ALLOWED_CHAT_ID gate, distinct error replies. **Does not call real GitHub or Telegram.** Pure offline simulation.

## Files
- `handler.ts` — the proposed production-shape function. Single export, zero deps, uses only `fetch` + KV interface. ~70 lines. This is the artifact a planner can copy into `telegram-bot/src/index.ts` later.
- `dry-run.mjs` — runnable harness with a mocked `KVNamespace`, mocked `fetch`, and 6 scenarios. Walks the full state machine.

## Run

```bash
node spikes/bot-renew/dry-run.mjs
```

No network. No secrets. No production touch.

## Scenarios covered
1. Wrong chat id → silent drop (no message, no KV write).
2. Allowed chat, no cooldown → dispatch 204 → reply ✅ + cooldown TTL written.
3. Immediate retry → blocked by cooldown with remaining minutes.
4. GitHub 401 → distinct auth error reply, **no cooldown written** (failed attempts shouldn't lock the user out).
5. GitHub 404 → distinct "workflow not found" reply.
6. Cooldown TTL elapsed → next call dispatches again.

## What this spike does NOT prove
- That the real `auto-renew.yml` Telegram notification actually arrives within ~60s after dispatch. Verifying that requires running the workflow once (manual `workflow_dispatch` click) and observing — that's a deployment-side smoke, not a spike.
- That a fine-grained PAT with `actions:write` actually accepts the call. GitHub's docs say it does (`PRIOR_ART_PARTIAL` research). Verifying requires creating a real PAT.

## Confidence after spike
- The handler fits well under the ≤25-line / one-file budget claimed in `## Diverge B`. Actual handler in spike is ~70 lines because it includes type definitions and full error branches — the inline insertion into `telegram-bot/src/index.ts` (which already has `send()` + `BOT_KV` + types) will be ~30 lines net.
- All six branches return user-visible text (no silent failures except the wrong-chat-id gate, which is correct).
- Pre-dispatch cooldown check + post-success-only write means a failed dispatch doesn't burn the 10-minute cooldown.

## What the planner picks up from here
1. Inline `handleRenew` into the existing command router in `telegram-bot/src/index.ts`.
2. Reuse existing `send()` helper; reuse existing ALLOWED_CHAT_ID env.
3. Add `GH_DISPATCH_TOKEN` and `GH_REPO` to bot Env interface; `wrangler secret put GH_DISPATCH_TOKEN`; set `GH_REPO` via `[vars]` in `wrangler.toml` (not a secret).
4. Add `/renew` to `/help` text.
5. Type-check passes; deploy is a separate gate.
