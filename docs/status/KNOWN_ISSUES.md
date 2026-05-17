# KNOWN_ISSUES.md

> Updated: 2026-05-17

ปัญหาที่รู้แต่ยังไม่แก้ + workaround เก่ากว่า 90 วันย้ายไป `docs/archive/`

## Active

### 1. `GH_DISPATCH_TOKEN` ใช้ classic OAuth scope กว้างกว่าจำเป็น
- **Symptom:** `/renew` ทำงานปกติ แต่ token (`gho_*`) มี scope `repo+workflow+gist+read:org` (designed: fine-grained PAT, `actions:write` only)
- **Risk:** ถ้า bot Worker secret รั่ว → ครอบ user's repo ทั้งหมด แทนที่จะแค่ `nuciferx/air-quality`
- **Workaround:** none — ใช้ได้ปกติ, blast radius ยังจำกัดตาม wrangler secret hygiene
- **Fix path:** สร้าง fine-grained PAT (`https://github.com/settings/personal-access-tokens/new`) + `wrangler secret put GH_DISPATCH_TOKEN` แทน
- **Priority:** low (no observed incident)

### 2. `cn-token-short-ttl` memory ล้าสมัย
- **Symptom:** memory file `cn_token_short_ttl.md` ใน Claude Code memory ยังบอกว่า "user has to manually trigger GitHub Action between scheduled runs" — แต่ตอนนี้ weekly cron + `/renew` bot command ปิด gap แล้ว
- **Workaround:** อ่าน `docs/invent/bot-renew.md` แทน
- **Fix path:** edit memory entry — note ว่า bot-driven renew คือ primary fix path ตอนนี้
- **Priority:** low (memory entry, ไม่กระทบ production)

### 3. ไม่มี `package.json` ใน `telegram-bot/`
- **Symptom:** `cd telegram-bot && npm run type-check` ล้มเหลว เพราะไม่มี `package.json`
- **Why:** เจตนา — bot Worker zero-deps stance, ไม่ install อะไรเลย
- **Workaround:** ใช้ tsc จาก `webapp/worker/node_modules/.bin/tsc` ข้ามไป type-check (เห็นใน `log.md` 2026-05-17)
- **Priority:** low — ใช้งานได้ผ่าน workaround

### 4. bot token อยู่ในประวัติแชท session (2026-05-17)
- **Symptom:** `8050429795:AAFE…` แปะในแชทกับ Claude Code → อยู่ใน Anthropic logs
- **Workaround:** user เลือกไม่ revoke ทันที (accepted risk — bot ใช้แค่ Telegram, fine-grained scope)
- **Fix path:** BotFather → `/revoke` → token ใหม่ → `wrangler secret put TELEGRAM_BOT_TOKEN` (bot Worker) + `gh secret set TELEGRAM_BOT_TOKEN` (GH Actions) ทั้งคู่
- **Priority:** medium (security trade-off, accepted by user)

## Recently resolved

### `auto-renew.yml` silent-skip Telegram (5 รอบก่อน 2026-05-17)
- **Was:** GH secrets `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` ไม่เคยถูกตั้ง → workflow runs สำเร็จ rotate token แต่ไม่ส่ง Telegram
- **Fixed:** `gh secret set` ทั้ง 2 ตัว, verified via workflow run `25986998609` log: `Telegram: 200`
- **Lesson:** ตรวจ GH secrets list ก่อนสรุปว่า workflow Telegram คอนฟิกครบ — ไม่มี runtime error ถ้า secret หาย, แค่ silent skip
