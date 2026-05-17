# RUN_BOT_RENEW.md — `/renew` Telegram command (retroactive)

**Sprint:** 2026-05-17 bot-renew
**Status:** ✅ DONE — shipped same day
**Outcome:** PASS (end-to-end verified)

> เอกสารนี้สร้างย้อนหลังหลัง sprint จบ เพื่อ bootstrap sprint folder system ของ GTM Loop adoption sprint (ถัดไป) trail ฉบับเต็มอยู่ที่ artifact ของ invent loop — ลิงก์ด้านล่าง

---

## Goal

Telegram bot command `/renew` → fire `auto-renew.yml` ผ่าน GitHub `workflow_dispatch` → rotate Xiaomi CN token จากแชท ไม่ต้องเปิด Actions UI กดเอง

## Full trail (authoritative artifacts)

- **Invent decision (idea → GO):** `docs/invent/bot-renew.md` (Research / Frame / Diverge / Score / Spike PASS / Decision GO / Plan v2 / Dev shipped)
- **Plan v2:** `docs/invent/bot-renew.md` §"Plan (2026-05-17, v2 — authoritative)"
- **Spike:** `spikes/bot-renew/` (handler.ts + dry-run.mjs, 6 scenarios green)
- **Commit:** `804da0a feat(bot-renew): /renew Telegram command triggers auto-renew.yml`

## Surfaces changed

- `telegram-bot/src/index.ts` (+36 LoC net)
- `telegram-bot/wrangler.toml` (+1 var: `GH_REPO`)
- `IDEAS.md` (status flip)
- `docs/invent/bot-renew.md` (full invent trail + Plan + Dev)

## Secrets provisioned

- bot Worker: `GH_DISPATCH_TOKEN` (จาก `gh auth token`), `ALLOWED_CHAT_ID = 957180305`
- GitHub Actions: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (ที่หายไปแต่แรก ทำให้ workflow silent-skip Telegram 5 รอบก่อน)

## Smoke results

- Automated (bot-side): GET `/` → commands array มี `/renew` ✓ ; GET api `/health` 200 ✓
- End-to-end (manual): workflow run `25986998609` log: `TELEGRAM_BOT_TOKEN: ***` / `Worker /api/renew: 200` / `Telegram: 200` ✓
- Workflow's own ✅ message ส่งถึง owner chat สำเร็จ

## Deploy

- `npx wrangler deploy` (telegram-bot/) → version `d84019e1-e4f1-4a5a-af17-c0d0d60388a4`
- ไม่มี webapp redeploy, ไม่มี frontend redeploy

## GTM Loop mapping (retroactive)

| ขั้น GTM | bot-renew ทำอะไร |
|---|---|
| 1. Understanding Condition | research phase ใน `docs/invent/bot-renew.md` — เจอ `[[cn-token-short-ttl]]` memory + workflow_dispatch API + existing service binding |
| 2. Restoration | N/A (ไม่มี core workflow เสีย — เริ่มจาก green) |
| 3. Defect Factors Analysis | defect = "user ต้องเปิด GitHub Actions UI กด workflow_dispatch ระหว่าง weekly cron" — categorized เป็น UX gap |
| 4. Eliminating Factors of Defect | Approach B (Bot Dispatch + Trust Notify) เลือกจาก 4 options — diverge + score + spike |
| 5. Setting Condition | Plan v2 (file-by-file) + zero-deps preserved + ALLOWED_CHAT_ID gate ใส่ที่ webhook level (single-owner posture) |
| 6. Condition Kaizen | inline กับ Setting — ALLOWED_CHAT_ID gate ครอบ webhook ทุก message type (ไม่ใช่แค่ /renew) |
| 7. Condition Management | commit `804da0a` + IDEAS.md status flip `dev-done-shipped` + `docs/invent/bot-renew.md` §Dev section |

## Known gaps / follow-ups

- `[[cn-token-short-ttl]]` memory ล้าสมัย (weekly cron + bot-driven instant renew ปิด gap แล้ว) — pending update
- `GH_DISPATCH_TOKEN` ใช้ classic OAuth จาก `gh` (scope กว้าง) — สามารถ narrow เป็น fine-grained PAT ภายหลัง
- bot token อยู่ในประวัติแชท session — user เลือกที่จะไม่ revoke ทันที

## Why this sprint exists in `completed/` (not just `docs/invent/`)

- `docs/invent/bot-renew.md` = invent-loop output (idea → GO decision trail)
- `sprints/completed/2026-05-17-bot-renew/` = dev-loop output (implementation/ship record)
- ทั้งสองอย่างอยู่คู่กันได้ — GTM Loop adoption sprint (next door) จะใส่ pattern นี้เป็นมาตรฐาน
