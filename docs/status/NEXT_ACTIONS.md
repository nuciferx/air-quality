# NEXT_ACTIONS.md

> Updated: 2026-05-17

ดู `NEXT_ACTION.md` (root) สำหรับ top-level decision ปัจจุบัน เอกสารนี้คือรายการขยาย จัดลำดับตามความสำคัญและขนาด

## In progress (current sprint)

GTM Loop adoption — finish slice 3 → 4 → 5

## Queued (high priority)

1. **`/analyze` Telegram command (Phase B)** — verdict Build (ยังไม่ append IDEAS.md)
   - Surface: bot only
   - Effort: ครึ่งวัน
   - Trigger: `air-quality-planner` ตรง หรือ `/idea analyze` → append IDEAS.md
2. **Memory housekeeping** — update `cn-token-short-ttl` ว่า bot-renew + weekly cron ปิด gap แล้ว
   - Effort: 5 นาที
3. **Rotate `GH_DISPATCH_TOKEN`** → fine-grained PAT แทน gh classic OAuth
   - Effort: 10 นาที (BotFather pattern: สร้าง PAT → `wrangler secret put`)

## Queued (medium)

4. **Morning Report (IDEAS.md #2)** — daily 08:00 push สรุปคืนที่ผ่านมา + Qwen analysis
   - Surface: worker cron + bot service binding
   - Effort: 1 วัน
5. **Outdoor vs Indoor card (IDEAS.md #3)** — AQICN integration
   - Surface: frontend + worker (new endpoint)
   - Effort: 1-2 วัน

## Queued (low / exploratory)

6. **Adaptive thresholds** (Phase C) — auto tune `danger`/`safe` based on per-room baseline distribution
   - ต้องมีข้อมูลพอ ≥ 30 วันใน D1 ก่อน
7. **Multi-home support** (Phase C) — เผื่อย้ายบ้าน / เพิ่มบ้านที่ 2
8. **Predictive token renew** — Worker self-heal เมื่อ `/api/creds` ageDays > 5

## Stop / deferred (กำหนดล่วงหน้า ไม่ทำตอนนี้)

- 5-point device-sync ring refactor — defer until firmware update เปลี่ยน siid/piid
- Migrate auth from passToken → official OAuth — Xiaomi ยังไม่เปิดให้
- Worker dependencies (`npm install` ใน webapp/worker/) — strict zero-deps policy
