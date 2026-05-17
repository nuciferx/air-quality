---
name: webapp-status
description: Compact status board for the webapp — Cloudflare Worker (`webapp/worker/`, API + cron + auto-control) AND Next.js frontend (`webapp/frontend/`, Vercel dashboard). Reports health, recent activity, endpoint surface, key bindings, recent commits per layer. Token-lean by design (≤200 words). Use when you want to "open the webapp section" without re-exploring the codebase. Hands off to `webapp-editor` agent for edits.
---

# /webapp-status — Webapp section orientation

ใช้เพื่อ "เปิด section webapp (worker + frontend) แล้วรู้ทันทีว่าอยู่ตรงไหน" — dashboard 1 หน้า ≤200 คำ

## When to invoke

- ผู้ใช้พิมพ์ `/webapp-status`
- ผู้ใช้พูดว่า "เปิด webapp", "API กับ dashboard เป็นยังไง", "เปิด worker"

## Token budget — strict

**Do (cheap, parallel):**
- Bash: `git log --oneline -5 -- webapp/`
- Bash: `git status --short webapp/`
- Bash: `wc -l webapp/worker/src/index.ts`
- Grep: endpoint list — `path === "/api/` or `request.method === "POST" && path === "/api/` in `webapp/worker/src/index.ts`
- Grep: KV key patterns — `system:|auto_room_state|xiaomi_creds` in `webapp/worker/src/index.ts`
- Bash (parallel): `curl -s -m 5 https://air-quality-api.ideaplanstudio.workers.dev/health` and `curl -s -m 5 https://air-quality-api.ideaplanstudio.workers.dev/api/devices | head -c 800`
- Bash: `ls webapp/frontend/app/ webapp/frontend/components/ 2>/dev/null | head -15`

**Don't:**
- ห้าม spawn Explore / general-purpose agent
- ห้าม read `webapp/worker/src/index.ts` ทั้งไฟล์ — Grep targeted เท่านั้น
- ห้ามรัน `wrangler d1 execute` / `wrangler kv:key get` — ใช้ `usage-analyst` agent ถ้าต้องข้อมูลจริง
- ห้ามใช้ endpoint ที่ต้อง `LOG_SECRET`
- ห้ามเขียนไฟล์ใหม่ / commit / push

## Workflow

รัน parallel:

```bash
git log --oneline -5 -- webapp/
git status --short webapp/
wc -l webapp/worker/src/index.ts
grep -oE 'path === "/(api/[^"]+|health)"' webapp/worker/src/index.ts | sort -u
grep -oE '"(auto_room_state|system:[a-z_]+|xiaomi_creds)' webapp/worker/src/index.ts | sort -u | head -10
ls webapp/frontend/app/ webapp/frontend/components/ 2>/dev/null
curl -s -m 5 https://air-quality-api.ideaplanstudio.workers.dev/health
curl -s -m 5 https://air-quality-api.ideaplanstudio.workers.dev/api/devices | head -c 800
```

## Output format (เคร่งครัด — ≤200 คำ)

```
# Webapp — Section Status (YYYY-MM-DD HH:MM)

## Worker (webapp/worker/)
- Entry: src/index.ts (<N> lines), zero deps
- Health: <✓ alive | ✗ down>
- Endpoints: /health, /api/devices, /api/device/:id, /api/control, /api/history, /api/stream (SSE), /api/renew, /api/creds, /api/log ... <n total>
- Cron: */5 * * * * (last_cron_ts <X min ago>)
- KV keys live: auto_room_state:*, system:last_cron_ts, system:last_report_slot, xiaomi_creds

## Frontend (webapp/frontend/)
- Next.js 14 App Router
- Pages: app/page.tsx (+ <list other pages>)
- Components: DeviceCard, <list 2-3 others>

## Recent activity
- Last 3 commits touching webapp/:
  - <sha> — <title>
- Working tree: <clean | N changed under webapp/>

## Known constraints (do not violate)
- Worker zero-deps (Web Crypto only)
- Auto-control per-room (no for-all-rooms refactor)
- DEVICES + ROOM_THRESHOLDS are 2 of 5 sync points — touching means 5-file change
- Secrets via wrangler secret put only

## Suggested next
1. Worker/Frontend-only change → use webapp-editor agent
2. Cross-surface (touches bot or GH Actions) → use air-quality-planner first
```

ถ้ามี anomaly (API down / last_cron_ts >15 min / working tree dirty + last commit >7d) → ใส่ `🚨 ALERT:` บนสุด

## After output

จบที่ output อย่ายาว ห้ามตามด้วย "shall I do X?" ผู้ใช้จะบอกเอง

ถ้าผู้ใช้บอกจะแก้ — handoff:
- แก้ worker หรือ frontend → `webapp-editor` agent
- ดูข้อมูล D1/KV จริง → `usage-analyst` agent
- ปัญหา Xiaomi/token → `xiaomi-debugger` agent
- ข้ามไป bot → `air-quality-planner` (cross-surface)
- ก่อน deploy → `deploy-checker` agent

## Anti-patterns

- output เกิน 200 คำ
- อ่าน `webapp/worker/src/index.ts` ทั้งไฟล์ "เพื่อความครบถ้วน"
- รัน `wrangler d1 execute` "เผื่อใช้"
- เริ่มแก้โค้ดทันที — `/webapp-status` จบที่ output เสมอ
