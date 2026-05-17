# LATEST_STATUS.md

> Updated: 2026-05-17

## Feature state

### Shipped & green
- **Phase 1 — Hourly PM2.5 logger** (Google Sheets → D1 via Worker)
- **Phase 2 — Telegram bot + Qwen AI** (@NuciferDataBot)
- **Phase 3 — Cloudflare Worker API + D1 + cron `*/5 min`**
- **Phase 4 — Token auto-renew via `passToken`** (no 2FA needed)
- **Phase 5 — Per-room auto-control** (danger ≥35 → Favorite + alert; safe <15 → Auto)
- **`/renew` Telegram command** (`804da0a`, 2026-05-17) — bot dispatches `auto-renew.yml` from chat

### In flight
- **GTM Loop adoption sprint** (`sprints/active/2026-05-17-gtm-loop-adoption/`) — slice 3 of 5

### Operational
- Auto-renew cron: weekly Mon 02:00 UTC = 09:00 ICT (was `*/25 days`, fixed earlier)
- Scheduled reports: 08:00 / 12:00 / 17:00 / 00:00 ICT
- Deadman alert: >15 min cron silence
- Token alert: every 6h if any auth error

## Component health (last check 2026-05-17 16:00 ICT)

| Component | Status | Last verified |
|---|---|---|
| Worker `air-quality-api` | ✅ healthy | `/health` 200 |
| Worker `air-quality-bot` | ✅ healthy (v `d84019e1`) | bot `/` 200, `/renew` working |
| Frontend (Vercel) | ✅ healthy | manual visit |
| D1 `air-quality-db` | ✅ healthy | recent rows in `readings` |
| KV (creds + bot + auto-control state) | ✅ healthy | service binding ok |
| GitHub Actions `auto-renew.yml` | ✅ healthy | run `25986998609` Telegram 200 |
| GitHub Actions `log-pm25.yml` | ✅ healthy | hourly logger active |

## Devices

| ID | Room | Host | Online? |
|---|---|---|---|
| 4lite | ห้องทำงาน | sg | ✅ |
| maxpro | ห้องนอนชั้น 2 | cn | ✅ |
| maxdown | โถงชั้นล่าง | cn | ✅ |
| cat | ห้องแมวชั้น 2 | cn | ✅ |
