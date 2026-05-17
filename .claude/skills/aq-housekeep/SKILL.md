---
name: aq-housekeep
description: Periodic housekeeping for the air-quality monorepo — reports orphan KV keys, stale D1 rows beyond retention window, dangling sprint folders in `sprints/active/` past 14 days, log.md entries older than 90 days, untracked files that look like artifacts. Read-only by default — produces a cleanup plan; user opts into mutations one-by-one. Use weekly or before a major sprint.
---

# /aq-housekeep — Project housekeeping

GTM Loop ขั้น 6 (Condition Kaizen) สำหรับงาน maintenance ที่ไม่ใช่ feature — ทำให้ repo + production storage สะอาด

## When to invoke

- ผู้ใช้พิมพ์ `/aq-housekeep` หรือ "เก็บกวาด" / "ทำความสะอาด project"
- หลังจบ sprint ใหญ่ (>3 features ship ใน 30 วัน)
- ทุกประมาณ 30 วันถ้าไม่เคยเรียก

## Scan targets (read-only first pass)

### 1. KV cleanup candidates
ใช้ `usage-analyst` agent หรือ `wrangler kv:key list --binding=CREDS_KV` / `--binding=BOT_KV` (ผ่าน wrangler.toml ที่ตั้ง preview/production):

- `auto_room_state:*` — ต้องมีไม่เกิน 4 keys (ละห้องละ 1) ถ้ามากกว่าแปลว่ามี device id เก่า
- `bot:last_location:*` — keys ที่ไม่ active ภายใน 30 วัน
- `bot:renew:cooldown:*` — keys ที่หมด TTL แต่ยังโผล่ (KV เก็บ key เปล่าหลัง expire)
- `system:last_*_alert_ts` — เก่ากว่า 7 วันแปลว่า alert ไม่ได้ trigger บ่อย → check ว่ายังจำเป็นต้องเก็บ history หรือไม่

### 2. D1 retention
```sql
SELECT COUNT(*), MIN(ts), MAX(ts) FROM readings;
```
- Worker เก็บ readings ใส่ตลอดทุก 5 นาที × 4 เครื่อง = 1152 row/วัน
- 90 วัน ≈ 100k rows = OK สำหรับ D1
- เกิน 365 วัน (≈ 420k rows) ควร archive หรือ drop

ไม่ drop เอง — แค่ flag

### 3. Sprint folder hygiene
- `sprints/active/*` ที่ยังเปิดเกิน 14 วัน → flag (sprint ค้าง = ผิด GTM ขั้น 7)
- `sprints/completed/*` ที่เก่ากว่า 90 วัน → suggest archive
- `sprints/archive/*` ที่เก่ากว่า 180 วัน → ok left alone but mention

### 4. Root file hygiene
- ไฟล์ `*.log` ที่ root → ต้อง `.gitignore` ครอบ
- ไฟล์ `*.tmp` / `*.bak` / `~$*` (Office lock) → suggest delete
- `creds.json` ที่ตำแหน่งผิด (ไม่ใช่ root) → flag
- `__pycache__/` หลายระดับ → suggest single root-level

### 5. log.md / docs/status truncation
- `log.md` > 5000 บรรทัด → suggest move entries เก่ากว่า 90 วันไป `docs/archive/log-YYYY-Qn.md`
- `docs/status/COMMIT_HISTORY.md` > 100 rows → same treatment

## Output format

```
HOUSEKEEPING — YYYY-MM-DD

📊 Scan summary
  KV:  <n> keys total, <n> stale candidates
  D1:  <n> readings rows (oldest <date>), <retention status>
  Sprints: <n> active (oldest <date>), <n> completed
  Root files: <n> potentially stale

🧹 Suggested cleanup (priority order)

[1] <action> — <reason>
    Command: <exact command, dry-run safe>
    Mutates: KV | D1 | filesystem | git
    Approval: ⚠️  REQUIRED (or "safe, just delete")

[2] <action> ...

(ถ้าไม่มีอะไรต้องทำ → "✅ Nothing to clean")
```

User picks each item by saying "do #1 #3" etc — main thread executes one at a time, never batches.

## Hard rules

- **Default = read-only.** Scan, report, suggest. Never delete on first call.
- **Mutations require explicit user approval per item.** "ลุยทีละข้อ" ไม่ใช่ "ลุยทั้งหมด"
- **Never drop D1 rows.** Maximum action = export to JSON + report. Drop is a separate sprint with backup plan.
- **Never wipe KV creds.** `xiaomi_creds` key is load-bearing; cleanup script must whitelist it.
- **Sprint folders are git-tracked.** Move = git mv, archive = git mv + commit. Never delete sprint folders without `git rm`.
- **No `find -delete`** ever. Always preview first with `ls` or `find` (no -delete).

## What you must NOT do

- ไม่ deploy, ไม่ rotate secrets
- ไม่ purge D1 (suggestion only)
- ไม่ delete log.md (truncate via archive, never delete)
- ไม่ touch `.git/` directory directly
- ไม่ run `git clean -fd` (รื้อ working tree)

## Handoffs

- KV mutations needed → `usage-analyst` (read first) → main thread (write per-key with explicit user nod)
- D1 archive → main thread + new sprint folder (`sprints/active/YYYY-MM-DD-d1-archive/`)
- Sprint folder archive → main thread, single commit per batch
