# NEXT_ACTION.md

> Updated: 2026-05-17 16:30 ICT

## ตอนนี้ทำอะไรอยู่

(ไม่มี sprint active — รอ user เลือกอันต่อไป)

## sprint ล่าสุดที่ปิด

✅ **GTM Loop adoption** (2026-05-17) — ครบ 5 slices, ดู `sprints/completed/2026-05-17-gtm-loop-adoption/RUN_GTM_LOOP.md`

## รอ commit หรือไม่?

ใช่ — มีไฟล์ใหม่ + แก้ไข ยังไม่ commit:
- `AGENTS.md` (M — §16 GTM Loop)
- `.claude/skills/aq-dev-loop/SKILL.md` (M — GTM phase markers)
- `.claude/agents/aq-doc-auditor.md` (new)
- `.claude/skills/{aq-e2e,aq-housekeep,aq-check-forbidden}/SKILL.md` (new)
- `sprints/completed/{2026-05-17-bot-renew, 2026-05-17-gtm-loop-adoption}/RUN_*.md` (new)
- `docs/process/SPRINT_INDEX.md` (new)
- `CURRENT_STATUS.md`, `NEXT_ACTION.md`, `log.md` (new at root)
- `docs/status/{LATEST_STATUS, NEXT_ACTIONS, TEST_BASELINE, COMMIT_HISTORY, KNOWN_ISSUES}.md` (new)

User เลือกว่าจะ commit เป็น 1 commit (`feat(gtm-loop): adopt GTM Infinite Loop + sprint folder + status doc split`) หรือ split เป็น 5 commits ตาม slice

## ถัดไปหลัง sprint นี้จบ

ตัวเลือก (user เลือก):
- **`/analyze` Telegram command** — verdict Build, ยังไม่ append IDEAS.md → ถ้าจะลุย เรียก `/idea analyze` หรือ `air-quality-planner` ตรง
- **Morning Report (IDEAS.md #2)** — daily 08:00 summary scheduled push
- **Outdoor vs Indoor (IDEAS.md #3)** — AQICN integration
- **Memory housekeeping** — update `cn-token-short-ttl` ว่า bot-renew + weekly cron ปิด gap แล้ว
- **Rotate `GH_DISPATCH_TOKEN`** จาก classic OAuth → fine-grained PAT (single-repo)

## Phase gate check

Phase A (production stable) มี anomaly ค้างไหม?
- ❌ ไม่มี — `/health` ok, cron ทุก 5 นาที, token age = 0 (เพิ่ง renew)
- ✅ Phase B work (analytics/digest) เริ่มได้
