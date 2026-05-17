# TEST_BASELINE.md

> Updated: 2026-05-17 16:00 ICT

aq repo ไม่มี automated test framework (ตามนโยบาย token-frugal + zero-deps) — baseline ผ่าน manual smoke + curl + workflow log

## Last smoke pass — 2026-05-17 (post bot-renew ship)

### API Worker (`air-quality-api`)
```
GET /health
→ HTTP 200 {"status":"ok"}

GET /api/devices
→ HTTP 200, 4 devices, all pm25 > 0
```

### Bot Worker (`air-quality-bot`)
```
GET /
→ HTTP 200 {"bot":"Air Quality Bot","commands":["/status","/predict","/on","/off","/weather","/weather_home","/token","/ai","/renew","/help"]}
```

### Bot-renew end-to-end
```
Trigger:    gh workflow run auto-renew.yml --ref master
Run ID:     25986998609
Duration:   17s
Status:     completed/success
Log lines:
  TELEGRAM_BOT_TOKEN: ***
  TELEGRAM_CHAT_ID: ***
  Worker /api/renew: 200 {"ok":true,"message":"Credentials updated and verified",...}
  Telegram: 200
```

### Bot type-check
```
cd webapp/worker
./node_modules/.bin/tsc --noEmit ... ../../telegram-bot/src/index.ts --strict --skipLibCheck
EXIT=0
```

## Standing smoke set (run before any ship)

ทุก deploy ต้องผ่าน 4 smoke ขั้นต่ำ:
1. `curl /health` → 200
2. `curl /api/devices` → 4 devices, pm25 > 0
3. bot `/help` ตอบเร็ว < 2s จาก owner chat
4. workflow last run ภายใน 1 ชม. → success

## Regression watch list

- 5-point device-sync ring (`AGENTS.md` §3) — ตรวจ verify_pm25.py output เทียบกับ DEVICES array
- Cron `*/5 * * * *` → `system:last_cron_ts` ≤ 5 นาที
- Token age `/api/creds` → `ageDays` ≤ 7 (CN), ≤ 30 (SG)
- Auto-control state `auto_room_state:{id}` → ไม่ค้างใน escalation loop
