# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> เอกสารนี้คือ **สรุปสำหรับ Claude Code** เท่านั้น — รายละเอียดละเอียดอยู่ใน `AGENTS.md`, `README.md`, `PROGRESS.md`, `IDEAS.md` อ่านเพิ่มก่อนแก้โค้ดที่ไม่ใช่งานเล็ก

---

## Repository in one sentence

Multi-purifier (Xiaomi × 4) air-quality monitor: **Cloudflare Worker** (TypeScript, zero deps) talks to Xiaomi MiCloud via reimplemented RC4 signing, logs to **D1**, exposes a REST/SSE API, runs **auto-control** on a 5-min cron, and is consumed by a **Next.js** dashboard (Vercel) and a separate **Telegram bot Worker** (also TypeScript). Token auto-renew runs in GitHub Actions every 25 days using a long-lived `passToken`.

```
Xiaomi MiCloud ─▶ air-quality-api (Worker + cron */5 min)
                    │            │
                    ├─▶ D1: readings
                    ├─▶ KV: creds, auto_room_state, system:*
                    ├─▶ Telegram (alerts, reports, deadman)
                    └─▶ HTTP/SSE  ──▶  Next.js (Vercel)
                                        ▲
GitHub Actions ─▶ /api/renew (passToken renew, every 25d)
GitHub Actions ─▶ /api/log   (hourly PM2.5 backup → D1)

Telegram ─▶ air-quality-bot Worker ──service-binding──▶ air-quality-api
                            └─▶ Qwen (DashScope) for /ai
```

There is **no Python server in production**. `webapp/backend/` (FastAPI) is legacy / dev-only. Root-level `*.py` scripts are local tooling (token renew, debug, hourly logger).

---

## Architecture you must keep in mind

### Single source of truth for devices
The 4 devices (`4lite`, `maxpro`, `maxdown`, `cat`) and their `siid/piid` mappings are duplicated across **5 places**. When you add/rename/remap a device you must update **all** of them or behavior diverges silently:

1. `webapp/worker/src/index.ts` → `DEVICES` array
2. `webapp/worker/src/index.ts` → `ROOM_THRESHOLDS`
3. `telegram-bot/src/index.ts` → `DEVICE_INFO`
4. `webapp/frontend/lib/api.ts` → `DEVICE_PROP_SPECS`
5. `webapp/frontend/components/DeviceCard.tsx` → `DEVICE_MODES`

Authoritative table lives in `AGENTS.md` §3 — verify against `verify_pm25.py` output, never guess.

### Host routing matters
`host: "sg"` → `https://sg.api.io.mi.com` (only `4lite`)
`host: "cn"` → `https://api.io.mi.com` (the other three)
Wrong host = empty results, not an error. If a CN device looks offline, check token before assuming hardware.

### Credential fallback chain
Worker reads Xiaomi creds in this order: **KV (`xiaomi_creds`) → Worker secrets → error**. If KV is stale, the Worker auto-syncs from secrets back into KV. That's why `/api/creds` reports a `source` field — use it when debugging "token expired" symptoms.

### Auto-control is per-room, not global
Each room has its own state under `auto_room_state:{id}` in KV. Default thresholds: `danger=40 µg/m³` (open + Favorite + alert), `safe=10 µg/m³` (back to Auto + clear alert). Escalation every 30 min. Don't refactor this into a "for-all-rooms" loop — that was the old behavior and was reverted.

### Service binding, not HTTP
`telegram-bot` calls `air-quality-api` via Cloudflare service binding (`AIR_QUALITY_API` in `telegram-bot/wrangler.toml`), not over the public URL. Both workers live in the same CF account; don't introduce a `fetch(WORKER_API_URL/...)` path for bot → api calls.

---

## Common commands

All commands are run from the repo root unless noted. Windows shell is **PowerShell**; chain with `;` not `&&`.

### Worker (`air-quality-api`)
```bash
cd webapp/worker
npm install
npx wrangler dev               # local at http://localhost:8787
npx wrangler deploy            # production deploy
npm run type-check             # tsc --noEmit
npx wrangler tail              # live logs
npx wrangler secret put XIAOMI_SERVICE_TOKEN    # rotate a secret
```

### Frontend (`air-quality-dashboard`)
```bash
cd webapp/frontend
npm install
npm run dev                    # next dev (port 3000)
npm run build                  # next build (must pass before deploy)
npm run lint
npx vercel --prod              # deploy to Vercel (project: air-quality-nucifer)
```
Local dev against local Worker: `$env:NEXT_PUBLIC_API_URL = "http://localhost:8787"; npm run dev`

### Telegram bot (`air-quality-bot`)
```bash
cd telegram-bot
npx wrangler dev
npx wrangler deploy
```

### D1 (database is `air-quality-db`)
```bash
cd webapp/worker
npx wrangler d1 execute air-quality-db --remote --file=schema.sql       # apply schema
npx wrangler d1 execute air-quality-db --remote --command "SELECT device_id, COUNT(*) FROM readings GROUP BY device_id"
```

### Health & smoke tests
```bash
curl https://air-quality-api.ideaplanstudio.workers.dev/health
curl https://air-quality-api.ideaplanstudio.workers.dev/api/devices
curl https://air-quality-api.ideaplanstudio.workers.dev/api/creds   # needs ?secret=LOG_SECRET
python verify_pm25.py          # dump raw siid/piid per device (Mac/Linux preferred)
```

### Token renew (manual, when auto-renew fails)
Must run on Mac with Chrome already logged in to Xiaomi:
```bash
python3 get_token_passtoken.py
```
This reads `passToken` from Chrome cookies, logs in, writes `creds.json`, pushes to Worker secrets, and calls `/api/renew`.

---

## Editing rules (the non-obvious ones)

- **Worker must stay zero-dependency.** Use Web Crypto API (`crypto.subtle`) for all hashing/signing. No `npm install` in `webapp/worker/`.
- **Never commit `creds.json`, `.2fa_url`, `nucifer-data-sheet-api-*.json`, `renew.log`, or anything under `auto-renew/` that contains tokens.** `.gitignore` covers most `*.json` already.
- **Secrets go through `wrangler secret put` only.** Never under `[vars]` in `wrangler.toml`.
- **After rotating a secret you must `wrangler deploy`** — secrets aren't picked up until next deploy.
- **Thai text in UI, Telegram outputs, and code comments is intentional** — follow the existing style. Don't translate to English.
- **Cron drift / deadman:** the Worker logs `system:last_cron_ts` to KV and self-alerts if silent >15 min. Don't add competing cron jobs or change the schedule (`*/5 * * * *`) without updating the deadman threshold.
- **Scheduled reports** at Asia/Bangkok 08:00 / 12:00 / 17:00 / 00:00 use `system:last_report_slot` for de-dup. Touching the schedule means touching the slot format too.
- **`*.py` files at the repo root are tooling, not library code** — they import from each other loosely. When fixing one, grep for its name before refactoring its function signatures.

---

## Specialized subagents for this repo

Custom agents live under `.claude/agents/`. Invoke via the Agent tool with `subagent_type` set to the agent's name. They exist because this project has a few traps that generic exploration keeps re-discovering.

| Agent | When to use |
|-------|-------------|
| `air-quality-planner` | Multi-file feature work — anything that touches more than one of {worker, frontend, bot, GitHub Actions}. Knows the 5-point device-sync rule and the auto-control state model, so it produces plans that won't drift between layers. |
| `xiaomi-debugger` | Symptoms like "PM2.5 wrong / zero / stale", "TOKEN_EXPIRED", "device offline", "/api/devices empty". Walks the recovery checklist (host → creds source → siid/piid → `verify_pm25.py` → KV vs secrets) instead of guessing. |
| `deploy-checker` | Before any `wrangler deploy` / `vercel --prod`. Verifies secrets present, `type-check`/`build` passes, schema applied, and which worker(s) need redeploy after the change. |
| `usage-analyst` | Read-only D1/KV queries to back idea decisions with numbers. "Is auto-control firing too often?", "which room hits 40 most?", "is the bot actually being used?" Refuses any mutation. |

## Skills

| Skill | Trigger | Purpose |
|-------|---------|---------|
| `/idea` | `/idea <text>` or "ลองคิดดูว่าจะเพิ่ม X ดีไหม" | Produces a ≤300-word decision doc (Build / Spike / Backlog / Drop) without writing code. Trusts `CLAUDE.md` + `AGENTS.md` + `IDEAS.md` + `PROGRESS.md` instead of re-exploring — token-lean. After Build verdict, hand off to `air-quality-planner`; use `usage-analyst` first if you need data evidence. |
