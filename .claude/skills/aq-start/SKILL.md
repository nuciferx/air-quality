---
name: aq-start
description: Session orientation for the air-quality project. Run at the start of a session (or when picking up after a break) to get a compact status board — production health, token age, pending tasks, recent commits, and any unresolved memories — without re-exploring the codebase. Token-lean by design.
---

# /aq-start — session orientation

ใช้เพื่อ "เปิด session แล้วรู้ทันทีว่าตอนนี้โปรเจกต์อยู่ตรงไหน" output คือ dashboard 1 หน้า ≤200 คำ ไม่ใช่บทวิเคราะห์

## When to invoke

- ผู้ใช้พิมพ์ `/aq-start`
- ผู้ใช้พูดว่า "เริ่มเลย" / "เปิดวันนี้มีอะไรต้องดู" / "สถานะตอนนี้" หลังกลับมาจากพักนาน
- session ใหม่ที่ผู้ใช้ยังไม่ระบุงานชัดเจน

## Token budget — strict

**Do (cheap, parallel):**
- Read `MEMORY.md` (already small, lists all memories — pull each one mentioned by `[[link]]` only if it's flagged actionable)
- Bash: `git status --short`, `git log --oneline -5`
- Bash: `find .git -name "desktop.ini" -type f | wc -l` (Google Drive pollution check — anything >0 needs cleanup)
- Bash (parallel): `curl -s https://air-quality-api.ideaplanstudio.workers.dev/health` and `curl -s https://air-quality-api.ideaplanstudio.workers.dev/api/devices | head -c 2000`
- Bash: `gh run list --workflow=auto-renew.yml -L 3 --json status,conclusion,createdAt 2>/dev/null` if `gh` available

**Don't:**
- ห้าม spawn Explore/Plan/general-purpose agent
- ห้าม read โค้ดใน `webapp/`, `telegram-bot/`, `*.py` — ถ้าจำเป็นจริงๆ ให้แนะนำเรียก `xiaomi-debugger` หรือ `usage-analyst` ทีหลัง
- ห้ามรัน `wrangler d1 execute` (ราคา + ช้า) — ถ้าต้องดูข้อมูลจริง แนะนำ `usage-analyst` agent แทน
- ห้ามใช้ endpoint ที่ต้อง `LOG_SECRET` (อาจหมุนใหม่ยังไม่ครบ) — เลือกเฉพาะ public endpoints
- ห้ามเขียนไฟล์ใหม่ / commit / push

## Workflow

รัน checks ทั้งหมด **parallel** ใน Bash batch เดียว (ประหยัด round-trip):

```bash
git status --short
git log --oneline -5
find .git -name "desktop.ini" -type f 2>/dev/null | wc -l
curl -s -m 5 https://air-quality-api.ideaplanstudio.workers.dev/health
curl -s -m 5 https://air-quality-api.ideaplanstudio.workers.dev/api/devices
gh run list --workflow=auto-renew.yml -L 3 2>/dev/null
```

อ่าน MEMORY.md เพื่อรู้ว่ามี memory อะไรบ้าง — แล้ว pull เฉพาะ memory ที่ดูเหมือนยัง "actionable" (เช่น มี deadline, มี TODO ติดอยู่)

## Output format (เคร่งครัด — ≤200 คำ)

```
# Air Quality — Session Start (YYYY-MM-DD HH:MM)

## Production
- API: <✓ alive | ✗ down> (last cron <X min ago>)
- Devices online: <n/4>  | avg PM2.5: <x.x>
- CN token renew: <day-since-last>d ago, next <day>
- Auto-renew workflow last run: <status, age>

## Repo
- Branch: master, ahead/behind: <state>
- Working tree: <clean | N changed>
- Last 3 commits: <SHA — title>
- ⚠️ .git pollution: <n desktop.ini files> (only show if >0)

## Active memories
- [[name]] — one-line hook
  (only list memories that contain unresolved items — skip purely-informational ones)

## Suggested next
1. <most concrete actionable thing, ≤1 line>
2. <second, optional>
```

ถ้ามี anomaly (e.g. cron silent >15 min / CN token >6d / Actions failed / desktop.ini polluting .git) → ใส่บรรทัด `🚨 ALERT:` บนสุดก่อน `## Production` พร้อมคำสั่งแก้ทันที

## After output

จบที่ output อย่ายาว ห้ามตามด้วย "shall I do X?" ผู้ใช้จะบอกเอง

ถ้าผู้ใช้ตอบมาว่าจะทำอะไรต่อ ค่อย handoff:
- งานวิเคราะห์ข้อมูลจริง → `usage-analyst` agent
- ปัญหา device/token → `xiaomi-debugger` agent
- วางแผน feature → `air-quality-planner` agent
- วิจัย idea ก่อนสร้าง → `/idea` skill
- ก่อน deploy → `deploy-checker` agent

## Anti-patterns

- output เกิน 200 คำ
- อ่าน source code "เพื่อความครบถ้วน"
- รัน D1 query "เผื่อใช้"
- สรุปทุก memory แม้ตัวที่ไม่มี action
- เสนอ next step ที่ผู้ใช้ไม่ได้ขอ (เกิน 2 ข้อ)
- เริ่มทำงานต่อทันที — `/aq-start` จบที่ output เสมอ
