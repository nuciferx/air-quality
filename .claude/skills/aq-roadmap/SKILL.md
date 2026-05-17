---
name: aq-roadmap
description: |
  Project roadmap board for the air-quality project — shows where the project is at (shipped phases, in-flight inventions, dirty working tree) and what to develop next (queued ideas, recurring debt, open problems). Compact ≤300 words. Token-lean — does NOT re-explore code, trusts PROGRESS.md / IDEAS.md / docs/invent/ / MEMORY.md as ground truth.

  Trigger phrases (Thai): "/aq-roadmap", "ทำอะไรต่อดี", "โปรเจกต์ถึงไหน", "พัฒนาอะไรต่อ", "วางแผนต่อ", "เปิดโปรเจกต์", "อยากแก้ปัญหาอะไร"
  Trigger phrases (English): "/aq-roadmap", "what's next", "roadmap", "project state", "what to build next"

  Use AFTER `/aq-start` (operational health) when you want the strategic / planning view, not just "is prod alive". Hands off to `/aq-invent`, `/aq-invent-loop`, `air-quality-planner`, or `xiaomi-debugger` depending on what the user picks.
---

# /aq-roadmap — Project planning entry point

ใช้ตอบคำถาม "เปิดโปรเจกต์มาทำอะไรต่อดี" — แสดง shipped / in-flight / queued / open-problems / suggested-next ใน 1 หน้า ≤300 คำ

ไม่ใช่บทวิเคราะห์ ไม่ใช่ design doc — เป็นกระดาน 5 ช่องเพื่อให้ user เลือกเส้นทาง

## When to invoke

- ผู้ใช้พิมพ์ `/aq-roadmap`
- ผู้ใช้พูดว่า "พัฒนาอะไรต่อดี" / "โปรเจกต์ถึงไหน" / "อยากเริ่มงานใหม่ทำอะไร" / "เปิดโปรเจกต์มา"
- หลัง `/aq-start` แล้วผู้ใช้ยังไม่รู้จะลุยงานไหน

## Different from /aq-start

| `/aq-start` | `/aq-roadmap` |
|---|---|
| Operational health (cron, token, devices online) | Strategic state (phases done, in-flight, queued) |
| Sources: live curl + git status + GH Actions | Sources: PROGRESS.md + IDEAS.md + docs/invent/ + MEMORY.md |
| Output: production dashboard | Output: roadmap board |
| Handoff: usage-analyst / xiaomi-debugger / deploy-checker | Handoff: /aq-invent / air-quality-planner |

ถ้าผู้ใช้ถามทั้งสองมุม ให้รัน `/aq-start` ก่อน แล้วค่อย `/aq-roadmap`

## Token budget — strict

**Do (cheap, parallel):**
- Read `PROGRESS.md` — แต่อ่านแค่ส่วน Phase status table + ตารางที่เป็น checklist ของ feature (อย่าอ่านทั้งไฟล์ ใช้ `head -80` หรือ targeted Read)
- Read `IDEAS.md` — ดู `## Invent Backlog (queued)` + ค้นหา entries ที่ `Status:` field มีคำว่า `invent-in-progress` / `invent-queued` / `invent-done-go`
- Read `MEMORY.md` (เล็กมากอยู่แล้ว — list ทุก memory แล้วเลือกที่ flag ว่ายังมีข้อ action ค้าง)
- Bash: `ls docs/invent/ 2>/dev/null` (in-flight invent artifacts ถ้ามี)
- Bash: `git log --oneline -10 -- IDEAS.md PROGRESS.md` (เห็นแนวโน้ม recent decisions)
- Bash: `git status --short` (working tree dirty?)

**Don't:**
- ห้าม spawn Explore / general-purpose agent
- ห้าม read source code (`webapp/`, `telegram-bot/`, `*.py`) — ไม่ใช่งานของ skill นี้
- ห้ามรัน production curl / wrangler / d1 query / GH Actions — แตกต่างจาก `/aq-start`
- ห้ามใช้ endpoint ที่ต้อง `LOG_SECRET`
- ห้ามเขียนไฟล์ใหม่ / commit / push
- ห้ามเสนอ next step > 3 ข้อ

## Workflow

รัน parallel:

```bash
git status --short
git log --oneline -10 -- IDEAS.md PROGRESS.md
ls docs/invent/ 2>/dev/null
```

แล้วอ่าน PROGRESS.md (เน้น Phase table + done/in-progress markers), IDEAS.md (Invent Backlog queue + Dropped), MEMORY.md (unresolved hooks)

## Output format (เคร่งครัด — ≤300 คำ)

```
# Air Quality — Roadmap (YYYY-MM-DD)

## ✅ Shipped (from PROGRESS.md)
- Phase 1-N: <one-line summary of each — group consecutive phases>
- Latest landmark: <most recent shipped feature, with date>

## 🚧 In flight
- <invent-in-progress entries from IDEAS.md, with their docs/invent/<name>.md path>
- <artifacts in docs/invent/ that have no Decision section yet>
- <working tree changes? which surface (bot/worker/frontend)?>
- (ถ้าไม่มีงานค้าง → "(no work in flight)")

## 📋 Queued (top 3 by priority)
- <inv-id> — <title> [<p-high | p-med | p-low>, tags: <tag1 tag2>]
- <inv-id> — <title> [...]
- <inv-id> — <title> [...]
- (ถ้าคิวว่าง → "(invent backlog empty — capture more via /idea)")

## 🐛 Open problems / recurring debt
- <unresolved memory items with action implied — pull from MEMORY.md links>
- <known anomalies that keep biting: e.g. CN token TTL mismatch, manual renew clicks>
- (ถ้าไม่มี → "(no recurring debt logged)")

## 🎯 Suggested next (pick exactly one to start)
1. **Finish in-flight:** <name> — fastest path to value (path: docs/invent/<name>.md)
2. **Start next invent:** /aq-invent <top-queued-id> — or /aq-invent-loop to chain
3. **Pay down debt:** <concrete action e.g. "switch auto-renew cron to weekly in .github/workflows/auto-renew.yml">
```

ถ้ามีสัญญาณวิกฤต (in-flight > 14 วันไม่ commit / queue > 10 entries / dropped > queued = ทิศทางอาจผิด) → ใส่บรรทัด `🚨 SIGNAL:` บนสุดพร้อมคำแนะนำสั้น

## After output

จบที่ output ห้ามตามด้วย "shall I start X?" ผู้ใช้จะบอกเอง

ถ้าผู้ใช้ตอบมาว่าจะทำอะไรต่อ ค่อย handoff:
- "เอา idea ใหม่" → `/idea <text>` skill
- "ลุย invent ตัวที่ X" → `/aq-invent <id>` skill
- "วิ่ง loop หลายตัว" → `/aq-invent-loop` (หรือ `/loop /aq-invent-loop`)
- "ไอเดียผ่าน GO แล้ว วางแผน" → `air-quality-planner` agent
- "ปัญหา device / token" → `xiaomi-debugger` agent
- "ดูข้อมูลจริง D1/KV" → `usage-analyst` agent
- "ก่อน deploy" → `deploy-checker` agent

## Anti-patterns

- output เกิน 300 คำ
- อ่าน source code "เพื่อเข้าใจ context"
- รัน curl / wrangler ซ้ำกับ `/aq-start`
- list shipped phases เกิน 5 บรรทัด (group ให้สั้น)
- list queued เกิน 3 ตัว (ที่เหลืออ่านใน IDEAS.md เอง)
- เสนอ suggested next เกิน 3 ข้อ
- ตัดสินใจให้ผู้ใช้ว่าควรเลือกข้อไหน — แสดงเฉยๆ
- ผสม operational signals (cron, token) มาที่นี่ — นั่นเป็นงานของ `/aq-start`
