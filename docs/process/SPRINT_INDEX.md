# SPRINT_INDEX.md

ดัชนี sprint ทั้งหมดของ air-quality เริ่มต้น 2026-05-17 (ก่อนหน้านี้ shipping ผ่าน `PROGRESS.md` phase log อย่างเดียว — ไม่มี sprint folder)

| Date | Sprint | Status | Location | Notes |
|---|---|---|---|---|
| 2026-05-17 | bot-renew (`/renew` Telegram command) | DONE | `sprints/completed/2026-05-17-bot-renew/` | Trail เต็มอยู่ที่ `docs/invent/bot-renew.md` ; sprint record ที่นี่ retroactive เพื่อ bootstrap sprint folder system |
| 2026-05-17 | GTM Loop adoption | DONE | `sprints/completed/2026-05-17-gtm-loop-adoption/` | นำ GTM Infinite Loop จาก bma-plan มาเป็น operating protocol — AGENTS.md §16 + sprint folders + status docs + dev-loop GTM annotation + aq-doc-auditor + aq-e2e/housekeep/check-forbidden skills (docs/skill only, no production code) |

## Status values

- `DONE` — sprint จบสำเร็จ, ship แล้ว (ถ้า production), หรือ docs ลงล็อกแล้ว (ถ้า docs sprint)
- `IN_PROGRESS` — กำลังเดิน slice
- `PENDING` — วางแผนแล้วยังไม่เริ่ม
- `SUPERSEDED` — ถูกแทนที่ด้วย sprint ถัดไป (ย้ายไป `sprints/archive/`)
- `ARCHIVED` — เก็บไว้อ้างอิงเฉยๆ

## Sprint anatomy (ตาม §16.3 ของ AGENTS.md)

`sprints/<active|completed|archive>/<YYYY-MM-DD>-<slug>/`
- `RUN_<UPPER_SNAKE>.md` — sprint plan / final record (mandatory)
- (optional) screenshot / log dump / additional artifacts

## Cross-reference

- Decision trail สำหรับ idea ก่อน sprint — `docs/invent/<slug>.md` (invent loop output)
- Live production status — `CURRENT_STATUS.md` (root)
- Next action — `NEXT_ACTION.md` (root)
- Running log — `log.md` (root)
- Phase history — `PROGRESS.md` (root)
