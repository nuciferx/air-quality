---
name: aq-e2e
description: End-to-end smoke test for the air-quality production stack — curl `/health` + `/api/devices` + `/api/creds`, ping Telegram bot info endpoint, optionally trigger and verify auto-renew workflow round-trip. Returns a green/red checklist with timing. Read-only against production (no deploy, no KV mutation). Use right after `wrangler deploy` (per GTM step 7 APPLY DECISION) or whenever the user says "smoke ที / e2e ที / ตรวจ prod ทีว่าใช้ได้ไหม".
---

# /aq-e2e — End-to-end smoke test

GTM Loop ขั้นที่ 4 (regression guard) + ขั้นที่ 7 (Condition Management evidence) ใช้ทุกครั้งหลัง deploy + ทุกครั้งที่ user สงสัยว่า prod เพี้ยน

## When to invoke

- Right after `wrangler deploy` / `vercel --prod` — main thread call โดยอัตโนมัติ
- ผู้ใช้พิมพ์ `/aq-e2e` หรือพูด "smoke ที" / "ตรวจ prod ที"
- ก่อนปิด sprint ทุกครั้งที่ GTM ขั้น 7 ต้องใส่ smoke evidence

## What you check (≤6 probes, ≤30s total)

### 1. API Worker health (timeout 5s)
```bash
curl -s -m 5 https://air-quality-api.ideaplanstudio.workers.dev/health
```
Pass: `{"status":"ok"}` Fail: anything else (404, 5xx, empty)

### 2. API Worker device readout (timeout 8s)
```bash
curl -s -m 8 https://air-quality-api.ideaplanstudio.workers.dev/api/devices
```
Pass: array length = 4, every device has `pm25 ≥ 0`, no `error` field on any device. Fail: missing device / all pm25 = 0 / `auth_error`.

### 3. Bot Worker info (timeout 5s)
```bash
curl -s -m 5 https://air-quality-bot.ideaplanstudio.workers.dev/
```
Pass: `commands` array contains canonical list (`/status`, `/predict`, `/on`, `/off`, `/weather`, `/weather_home`, `/token`, `/renew`, `/ai`, `/help`). Fail: command list trimmed/missing.

### 4. Token age (timeout 5s, requires LOG_SECRET)
```bash
curl -s -m 5 "https://air-quality-api.ideaplanstudio.workers.dev/api/creds?secret=$LOG_SECRET"
```
Pass: `ageDays ≤ 7` (CN tokens). Fail: `ageDays > 7` (token stale, devices about to drop).

### 5. Cron heartbeat (KV `system:last_cron_ts`)
Read indirectly via `/api/devices` `lastUpdate` field — should be within 6 minutes (cron `*/5`). Fail: > 10 min stale.

### 6. (Optional) auto-renew workflow round-trip
Only run if user passes `--full` or smoke-after-renew-fix scenario. Triggers `gh workflow run auto-renew.yml`, polls until completed, checks log for `Telegram: 200`.

## Output format (≤15 lines)

```
E2E SMOKE — YYYY-MM-DD HH:MM ICT
  /health            ✅ 200 (124ms)
  /api/devices       ✅ 4 devices, pm25 [12, 8, 22, 30]
  bot /              ✅ commands has /renew (98ms)
  /api/creds         ✅ ageDays=0
  cron last tick     ✅ 2m ago
  (full mode skipped)

Overall: ✅ GREEN
```

หรือถ้าเจอปัญหา:

```
E2E SMOKE — YYYY-MM-DD HH:MM ICT
  /health            ✅ 200
  /api/devices       ❌ maxpro: "auth_error" (others ok)
  bot /              ✅ ok
  /api/creds         ⚠️  ageDays=8 (CN tokens stale)
  cron last tick     ✅ 3m ago

Overall: 🔴 RED — token chain broken
Suggested handoff: xiaomi-debugger (auth_error + ageDays>7)
```

## Handoffs

- All green → continue GTM step 7 (mark sprint PASS, append `docs/status/TEST_BASELINE.md`)
- Red on `/api/devices` or `/api/creds` → `xiaomi-debugger` agent
- Red on bot `/` (command missing) → `telegram-bot-editor` (likely partial deploy)
- Red on cron heartbeat → `usage-analyst` (check `system:last_cron_ts` KV directly)

## What you must NOT do

- ไม่ deploy, ไม่ `wrangler secret put`, ไม่ mutate KV/D1
- ไม่ส่ง Telegram message จริงไป user chat (ใช้ bot `/` endpoint แทน — info-only, no chat write)
- ไม่ pull D1 readings ทั้งหมด (ใช้ `/api/devices` realtime แทน — cheap)
- ไม่ run `npm install` หรือสร้าง dependencies — สอดคล้องนโยบาย zero-deps

## Anti-patterns

- รัน probe เกิน 6 ตัว
- timeout > 10s ต่อ probe (อย่างเร็วต้องจบใน 30s รวม)
- format output เป็น prose ยาว — ใช้ checklist เท่านั้น
- บอก user "deploy รัน wrangler deploy" — นั่นเป็นหน้าที่ของ deploy-checker + dev loop
