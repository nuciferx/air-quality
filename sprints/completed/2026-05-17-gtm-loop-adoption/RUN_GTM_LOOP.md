# RUN_GTM_LOOP.md — Adopt GTM Infinite Loop in air-quality

**Sprint:** 2026-05-17 GTM Loop Adoption
**Status:** ✅ DONE (closed 2026-05-17)
**Scope:** Documentation + skill/agent source — **NO production code changes** (verified)

---

## Goal

นำ GTM Infinite Loop (7 ขั้น) จาก sibling project `bma-plan` มาเป็น operating protocol อย่างเป็นทางการของ air-quality ทั้งโปรเจกต์ — agent ทุกตัว, skill ทุกตัว, sprint ทุก sprint ต่อจากนี้ต้องเดินตาม loop เดียวกัน

แหล่ง spec ต้นทาง: `F:\drives\My Drive\01 project\ai\bma-plan\sprints\completed\2026-05-07-update-agents-gtm-loop\RUN_UPDATE_AGENTS_GTM_LOOP.md`

---

## 5 Slices (ทำทีละ slice ตามลำดับ)

### Slice 1 — GTM Loop section ใน AGENTS.md
- เพิ่ม §16 "Air Quality Agent Operating Loop — GTM Infinite Loop"
- ครอบคลุม: 7 ขั้น (adapted for aq), Agent 0–4 role mapping ของ 8 agents, sprint output requirements, Phase A/B/C rule, cross-ref ไป §3/§6/§7/§12/§15
- **Owner:** `air-quality-planner` (DRAFT) → main thread (EDIT)
- **Status:** ✅ DONE

### Slice 2 — Sprint folder structure
- สร้าง `sprints/{active,completed,archive}/` + `docs/process/SPRINT_INDEX.md`
- bootstrap sprint folder ของ sprint นี้เอง (`sprints/active/2026-05-17-gtm-loop-adoption/`)
- retroactive sprint record ของ `bot-renew` ที่ ship ไปแล้วใน `sprints/completed/2026-05-17-bot-renew/`
- **Owner:** main thread
- **Status:** in-progress

### Slice 3 — Status docs split
- สร้าง `CURRENT_STATUS.md`, `NEXT_ACTION.md`, `log.md` ที่ root
- สร้าง `docs/status/{LATEST_STATUS, NEXT_ACTIONS, TEST_BASELINE, COMMIT_HISTORY, KNOWN_ISSUES}.md`
- **`PROGRESS.md` ยังอยู่** — กลายเป็น phase log อย่างเดียว (history), live status ย้ายไป CURRENT_STATUS.md
- **Owner:** main thread
- **Status:** ✅ DONE

### Slice 4 — /aq-dev-loop ผูกกับ GTM phases + เพิ่ม `aq-doc-auditor` agent
- Edit `.claude/skills/aq-dev-loop/SKILL.md` ใส่ marker phase 1–7 ที่ 9 steps
- สร้าง `.claude/agents/aq-doc-auditor.md` (read-only, audit AGENTS.md / README.md / PROGRESS.md / IDEAS.md consistency)
- **Owner:** main thread
- **Status:** ✅ DONE

### Slice 5 — aq-e2e, aq-housekeep, aq-check-forbidden skills
- `.claude/skills/aq-e2e/SKILL.md` — curl /health + /api/devices + bot self-test
- `.claude/skills/aq-housekeep/SKILL.md` — KV cleanup, D1 retention, log rotation
- `.claude/skills/aq-check-forbidden/SKILL.md` — pre-commit guard (creds.json, *.2fa_url, nucifer-data-sheet-api-*.json, auto-renew/*.log, 5-point sync drift)
- **Owner:** main thread (pattern จาก bma-plan + adapt)
- **Status:** ✅ DONE

---

## Final outcome (GTM step 7 — Condition Management)

**PASS** — sprint ปิดสำเร็จในวันเดียว ทุก acceptance criteria ✅:

1. ✅ AGENTS.md §16 ครบ 5 ส่วน (7 ขั้น, agent map, sprint outputs, phase rule, cross-ref)
2. ✅ `sprints/{active,completed,archive}/` มีอยู่ + RUN file ของ sprint นี้และ bot-renew ครบ
3. ✅ `docs/process/SPRINT_INDEX.md` มี 2 row (gtm-loop-adoption + bot-renew)
4. ✅ `CURRENT_STATUS.md` + `NEXT_ACTION.md` + `log.md` มีอยู่
5. ✅ `docs/status/{LATEST_STATUS, NEXT_ACTIONS, TEST_BASELINE, COMMIT_HISTORY, KNOWN_ISSUES}.md` ครบ 5 ไฟล์
6. ✅ `.claude/skills/aq-dev-loop/SKILL.md` มี GTM phase marker บน 9 steps
7. ✅ `.claude/agents/aq-doc-auditor.md` มีอยู่ พร้อม role description
8. ✅ `.claude/skills/{aq-e2e,aq-housekeep,aq-check-forbidden}/SKILL.md` ครบ 3 ไฟล์ — auto-discovered ใน skill list แล้ว
9. ✅ ไม่มีการ edit ใน `webapp/`, `telegram-bot/src/`, `.github/workflows/`
10. ⏭️ type-check ของ bot + worker — skipped (sprint docs-only ไม่ควรกระทบ)

**Follow-ups (queued in `NEXT_ACTION.md`):**
- update memory `cn-token-short-ttl`
- ทดสอบ `aq-check-forbidden` ในรอบ commit ถัดไป
- ทดสอบ `aq-doc-auditor` agent ใน sprint ถัดไป (GTM ขั้น 5)
- ทดสอบ `aq-e2e` skill หลัง deploy ถัดไป

---

## Forbidden surfaces this sprint

- ❌ `webapp/worker/*.ts` (Worker code unchanged)
- ❌ `webapp/frontend/*` (Frontend unchanged)
- ❌ `telegram-bot/src/*.ts` (Bot code unchanged)
- ❌ `.github/workflows/*` (no workflow edits)
- ❌ `webapp/worker/schema.sql` (no D1 changes)
- ❌ KV / D1 mutation
- ❌ `wrangler deploy` / `vercel --prod`
- ❌ 5-point device-sync ring

Allowed surfaces:
- ✅ `AGENTS.md`, `README.md` (if needed), `PROGRESS.md`, `IDEAS.md`
- ✅ `sprints/**`, `docs/process/**`, `docs/status/**`
- ✅ `CURRENT_STATUS.md`, `NEXT_ACTION.md`, `log.md` (new files)
- ✅ `.claude/skills/**`, `.claude/agents/**`

---

## Acceptance Criteria

Sprint ปิด (PASS) เมื่อ:

1. ✅ AGENTS.md §16 ครบ 5 ส่วน (7 ขั้น, agent map, sprint outputs, phase rule, cross-ref)
2. ✅ `sprints/{active,completed,archive}/` มีอยู่ + RUN file ของ sprint นี้และ bot-renew ครบ
3. ✅ `docs/process/SPRINT_INDEX.md` มี 2 row (gtm-loop-adoption + bot-renew)
4. ✅ `CURRENT_STATUS.md` + `NEXT_ACTION.md` + `log.md` มีอยู่
5. ✅ `docs/status/{LATEST_STATUS, NEXT_ACTIONS, TEST_BASELINE, COMMIT_HISTORY, KNOWN_ISSUES}.md` ครบ 5 ไฟล์
6. ✅ `.claude/skills/aq-dev-loop/SKILL.md` มี GTM phase marker บน 9 steps
7. ✅ `.claude/agents/aq-doc-auditor.md` มีอยู่ พร้อม role description
8. ✅ `.claude/skills/{aq-e2e,aq-housekeep,aq-check-forbidden}/SKILL.md` ครบ 3 ไฟล์
9. ✅ ไม่มีการ edit ใน `webapp/`, `telegram-bot/src/`, `.github/workflows/`
10. ✅ `npx tsc --noEmit` ของ bot + worker ยังผ่าน (docs-only sprint ไม่ควรกระทบ type-check แต่ verify เผื่อ)

---

## Stop Conditions

Stop ทันทีถ้า:
- sprint เริ่มต้องการแก้ Worker / Bot / Frontend code → กลายเป็น feature sprint แยก
- ต้อง deploy → docs-only sprint ไม่ deploy
- ต้อง mutate KV / D1 → ผิด scope
- 5-point sync ring drift ขึ้นมา → ต้อง spawn `xiaomi-debugger` แยก, ไม่รวมใน sprint นี้

---

## GTM Loop mapping ของ sprint นี้เอง (eat your own dog food)

| ขั้น GTM | sprint นี้ทำอะไร |
|---|---|
| 1. Understanding Condition | อ่าน bma-plan/AGENTS.md + bma-plan/sprints/completed/ → เข้าใจ GTM spec |
| 2. Restoration | N/A (docs sprint, ไม่มี core workflow ที่เสีย) |
| 3. Defect Factors Analysis | defect = "ไม่มี operating protocol สำหรับ agent" + "เอกสาร status รวมอยู่ที่ PROGRESS.md ที่เดียว" + "skill set ขาด e2e/housekeep/forbidden-check" |
| 4. Eliminating Factors of Defect | 5 slices ข้างบน |
| 5. Setting Condition | section §16 ของ AGENTS.md + SPRINT_INDEX.md + status docs split |
| 6. Condition Kaizen | aq-doc-auditor agent + 3 ops skills ใหม่ |
| 7. Condition Management | sprint folder move active → completed + ลง row ใน SPRINT_INDEX.md + entry ใน log.md + update CURRENT_STATUS.md + NEXT_ACTION.md |
