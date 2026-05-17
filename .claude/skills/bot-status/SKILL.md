---
name: bot-status
description: Compact status board for the Telegram bot (`telegram-bot/`) — health, last activity, command list, recent commits touching the bot, current secret/binding shape. Token-lean by design (≤200 words). Use when you want to "open the bot section" of the repo without re-exploring the codebase. Hands off to `telegram-bot-editor` agent for edits.
---

# /bot-status — Telegram bot section orientation

ใช้เพื่อ "เปิด section telegram-bot แล้วรู้ทันทีว่าอยู่ตรงไหน" — dashboard 1 หน้า ≤200 คำ ไม่ใช่บทวิเคราะห์

## When to invoke

- ผู้ใช้พิมพ์ `/bot-status`
- ผู้ใช้พูดว่า "เปิด bot", "บอทเป็นยังไง", "สถานะ telegram"

## Token budget — strict

**Do (cheap, parallel):**
- Bash: `git log --oneline -5 -- telegram-bot/`
- Bash: `git status --short telegram-bot/`
- Bash: `cd telegram-bot && wc -l src/index.ts`
- Grep: command list — `text === "/` in `telegram-bot/src/index.ts`
- Grep: binding/secret names in `telegram-bot/wrangler.toml`
- Bash: `curl -s -m 5 https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo` ONLY if the user has `$TELEGRAM_BOT_TOKEN` exported (skip otherwise — never hard-code)

**Don't:**
- ห้าม spawn Explore / general-purpose agent
- ห้าม read `telegram-bot/src/index.ts` ทั้งไฟล์ — Grep targeted ก็พอ
- ห้ามรัน `wrangler deploy` / `wrangler tail` (interactive / produces noise)
- ห้ามใช้ endpoint ที่ต้อง `LOG_SECRET`
- ห้ามเขียนไฟล์ใหม่ / commit / push

## Workflow

รัน parallel:

```bash
git log --oneline -5 -- telegram-bot/
git status --short telegram-bot/
wc -l telegram-bot/src/index.ts
grep -c 'text === "/' telegram-bot/src/index.ts        # command count
grep -oP 'text === "/\w+"' telegram-bot/src/index.ts | sort -u
grep -E 'binding|service|name' telegram-bot/wrangler.toml | head -10
```

## Output format (เคร่งครัด — ≤200 คำ)

```
# Telegram bot — Section Status (YYYY-MM-DD HH:MM)

## Shape
- Entry: telegram-bot/src/index.ts (<N> lines)
- Commands wired: /status /predict /on /off /weather /weather_home /token /ai /help
- Service binding to API: AIR_QUALITY_API ✓
- AI: DashScope (Qwen) via DASHSCOPE_API_KEY
- ALLOWED_CHAT_ID gate: ✓ on writes

## Recent activity
- Last 3 commits touching telegram-bot/:
  - <sha> — <title>
  - <sha> — <title>
  - <sha> — <title>
- Working tree: <clean | N changed under telegram-bot/>

## Webhook health (only if token available)
- URL: <webhook url> | pending_update_count: <n>

## Known constraints (do not violate)
- Bot ↔ API: service binding only (never public URL)
- DEVICE_INFO is 1 of 5 sync points — touch only via air-quality-planner
- Worker zero-deps still applies here

## Suggested next
1. Implement a bot-only change → use telegram-bot-editor agent
2. Cross-surface change (e.g. new endpoint + bot command) → use air-quality-planner first
```

ถ้ามี anomaly (working tree dirty + last commit >7d / webhook pending_update_count > 50) → ใส่ `🚨 ALERT:` บนสุด

## After output

จบที่ output อย่ายาว ห้ามตามด้วย "shall I do X?" ผู้ใช้จะบอกเอง

ถ้าผู้ใช้บอกจะแก้ — handoff ทันที:
- งานแก้บอท → `telegram-bot-editor` agent
- งานข้ามไป worker → `air-quality-planner` agent
- ก่อน deploy → `deploy-checker` agent

## Anti-patterns

- output เกิน 200 คำ
- อ่าน `telegram-bot/src/index.ts` ทั้งไฟล์
- รัน `wrangler tail` หรือ `wrangler deploy`
- เริ่มแก้โค้ดทันที — `/bot-status` จบที่ output เสมอ
