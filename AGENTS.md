# Agent Rules — Air Quality Monitor

เอกสารนี้คือกฎและแนวทางการพัฒนาโปรเจกต์ AI/ผู้ช่วย AI ต้องอ่านทุกครั้งก่อนแก้ไขโค้ด

---

## 1. Architecture Rules

- **Cloudflare Worker** (`webapp/worker/src/index.ts`) เป็น backend หลัก — **ไม่มี Python server ใน production**
- **Next.js 14** (`webapp/frontend/`) อยู่บน Vercel ใช้ App Router + TypeScript + Tailwind
- **Telegram Bot** (`telegram-bot/src/index.ts`) ใช้ service binding → Worker API (ไม่ใช่ HTTP)
- **D1** (`air-quality-db`) เป็น database หลัก — table: `readings`
- **KV** (`CREDS_KV` / `BOT_KV`) เก็บ credentials, auto-control state, bot state

---

## 2. Credential & Security Rules

- **ห้าม commit token/secrets/credentials ลง repository เด็ดขาด**
- Worker secrets ตั้งผ่าน `npx wrangler secret put <NAME>` เท่านั้น
- GitHub Secrets ตั้งใน repository settings
- Token auto-renew **ทุกวันจันทร์** (`0 2 * * 1` UTC = 09:00 ไทย) ใช้ `passToken` bypass 2FA
- Credential fallback ลำดับ: KV → secrets → error
- Token cycle: **SG ~30 วัน, CN ~7 วัน** — ต้อง renew อย่างน้อยรายสัปดาห์เพื่อไม่ให้ maxpro/maxdown/cat ตก
- Health check + alert ทุก 6 ชม. ถ้ามี device ที่ auth error

---

## 3. Device Configuration (สำคัญ)

### siid/piid Mapping — ห้ามเปลี่ยนถ้าไม่ได้ verify จริง

| Device | ID | Model | Host | DID | PM2.5 | Mode | Power | Hum | Temp | Filter | Buzz | Lock |
|--------|----|-------|------|-----|-------|------|-------|-----|------|--------|------|------|
| ห้องทำงาน | 4lite | rmb1 | sg | 873639853 | siid=3,piid=4 | siid=2,piid=4 | siid=2,piid=1 | siid=3,piid=1 | siid=3,piid=7 | siid=4,piid=1 | siid=6,piid=1 | siid=8,piid=1 |
| ห้องนอนชั้น2 | maxpro | sa2 | cn | 460764069 | siid=3,piid=2 | siid=2,piid=2 | siid=2,piid=1 | siid=3,piid=1 | siid=3,piid=3 | siid=4,piid=1 | siid=7,piid=1 | siid=8,piid=1 |
| โถงชั้นล่าง | maxdown | sb1 | cn | 131590393 | siid=3,piid=2 | siid=2,piid=2 | siid=2,piid=1 | siid=3,piid=1 | siid=3,piid=3 | siid=4,piid=1 | siid=7,piid=1 | siid=8,piid=1 |
| ห้องแมวชั้น2 | cat | v7 | cn | 357231085 | siid=3,piid=2 | siid=2,piid=2 | siid=2,piid=1 | siid=3,piid=1 | siid=3,piid=3 | siid=4,piid=1 | siid=6,piid=1 | siid=5,piid=1 |

### เพิ่ม/เปลี่ยน Device ต้องอัปเดต 5 จุด

1. `DEVICES` array — `webapp/worker/src/index.ts`
2. `DEVICE_INFO` — `telegram-bot/src/index.ts`
3. `DEVICE_PROP_SPECS` — `webapp/frontend/lib/api.ts`
4. `DEVICE_MODES` — `webapp/frontend/components/DeviceCard.tsx`
5. `ROOM_THRESHOLDS` — `webapp/worker/src/index.ts`

### Mode Values

| ค่า | ความหมาย |
|-----|---------|
| 0 | Auto |
| 1 | Sleep |
| 2 | Favorite |
| 3 | Fan (4lite only) / Level 1 (max) |
| 4 | Level 2 (max) |
| 5 | Level 3 (max) |

---

## 4. API Contract

### Endpoint List

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/health` | Health check | — |
| GET | `/api/devices` | ทุกเครื่อง realtime | — |
| GET | `/api/device/:id` | เครื่องเดียว | — |
| GET | `/api/history?hours=24&device=all` | ประวัติจาก D1 | — |
| GET | `/api/history/stats?hours=24` | สถิติรายชั่วโมง | — |
| GET | `/api/stream` | SSE (poll ทุก 30s) | — |
| POST | `/api/control` | สั่งเปิด/ปิด/เปลี่ยน mode | — |
| POST | `/api/renew` | อัปเดต credentials ใน KV | LOG_SECRET |
| POST | `/api/log` | บันทึก readings จากภายนอก | LOG_SECRET |
| GET | `/api/creds` | สถานะ credentials | LOG_SECRET |

### Response Format

```json
// Success
{ "devices": [...] }
{ "ok": true, "result": {...} }
{ "readings": [...] }
{ "stats": [...] }

// Error
{ "error": "message" }
```

### Auth endpoints ใช้ `LOG_SECRET` ผ่าน header หรือ query

```
Authorization: Bearer <LOG_SECRET>
หรือ
?secret=<LOG_SECRET>
```

---

## 5. PM2.5 Thresholds & Colors

| Range (µg/m³) | Level | Color | Background |
|---------------|-------|-------|------------|
| 0–15 | Good | #22c55e | bg-green-500 |
| 16–35 | Fair | #eab308 | bg-yellow-500 |
| 36–75 | Moderate | #f97316 | bg-orange-500 |
| >75 | Poor | #ef4444 | bg-red-500 |

- PM2.5 progress bar: max 150 µg/m³
- Color functions: `pm25Color()`, `pm25Label()`, `pm25BgClass()` ใน `lib/api.ts`

---

## 6. Auto-Control Logic

- Rule **แยกตามห้อง** — ไม่รวมทุกห้องเป็นก้อนเดียว
- Danger threshold: **40 µg/m³** — เปิดเครื่อง +ตั้ง Favorite mode + ส่ง Telegram
- Safe threshold: **10 µg/m³** — เปลี่ยนกลับ Auto mode + ส่ง Telegram
- Escalation: ทุก **30 นาที** ถ้ายังเกิน threshold
- Deadman alert: cron เงียบเกิน **15 นาที**
- Token health alert: ทุก **6 ชม.** ถ้ามี device ที่ auth error

### KV State Keys

| Key Pattern | Value | Purpose |
|-------------|-------|---------|
| `xiaomi_creds` | JSON | Stored credentials |
| `auto_room_state:{id}` | JSON | Per-room control state |
| `system:last_cron_ts` | string | Deadman detection |
| `system:last_report_slot` | string | Scheduled report dedup |
| `system:last_deadman_alert_ts` | string | Deadman alert throttling |
| `system:last_token_alert_ts` | string | Token alert throttling |

---

## 7. Scheduled Reports

| เวลา (ไทย) | Content |
|-----------|---------|
| 08:00 | Indoor summary + Weather + Token status |
| 12:00 | Indoor summary + Token status |
| 17:00 | Indoor summary + Token status |
| 00:00 | Indoor summary + Token status |

- Timezone: `Asia/Bangkok`
- Anti-duplicate: `system:last_report_slot` ใน KV (format: `YYYY-MM-DDTHH:MM`)
- Weather: Open-Meteo API (free, no key needed)
- Weather default coords: WEATHER_LAT=13.7563, WEATHER_LON=100.5018

---

## 8. Telegram Bot

### Commands

| Command | Function |
|---------|----------|
| `/status` | สถานะทุกห้อง |
| `/predict` | ทำนาย PM2.5 trend + filter |
| `/on [room]` | เปิดเครื่อง (room: 4lite, maxpro, maxdown, cat) |
| `/off [room]` | ปิดเครื่อง |
| `/weather` | สภาพอากาศตำแหน่งล่าสุด |
| `/weather_home` | สภาพอากาศที่บ้าน |
| `/token` | สถานะโทเคน Xiaomi |
| `/ai [ข้อความ]` | ถาม Qwen AI วิเคราะห์อากาศ |
| `/help` | แสดงคำสั่ง |

### AI Config
- Model: `qwen-turbo` (DashScope API)
- System prompt: ภาษาไทย — วิเคราะห์อากาศจาก device data
- Max tokens: 500, temperature: 0.7

### Location
- รับ location จากผู้ใช้ → reverse geocode → เก็บใน `bot:last_location:{chatId}`
- `/weather` ใช้ position ล่าสุด, `/weather_home` ใช้พิกัดบ้าน

---

## 9. Token Renewal Workflow

### Manual (Mac)
```bash
python3 get_token_passtoken.py
```
- อ่าน passToken จาก Chrome cookies
- Login → ได้ serviceToken + ssecurity
- บันทึก `creds.json`
- อัปเดต Worker secrets + deploy

### Auto (GitHub Actions)
```bash
# Schedule: 0 2 */25 * *
python auto-renew/renew_token_passtoken.py
```
- ใช้ `XIAOMI_PASS_TOKEN` จาก GitHub Secrets
- Login → push to `/api/renew` → Telegram notification

### ถ้า passToken หมดอายุ (code 70016)
1. เปิด Chrome → login Xiaomi account.xiaomi.com
2. รัน `python3 get_token_passtoken.py`
3. อัปเดต `XIAOMI_PASS_TOKEN` ใน GitHub Secrets

---

## 10. Coding Conventions

### TypeScript
- Strict mode, ทุก function มี type annotation
- Interfaces มี JSDoc ถ้าซับซ้อน
- Error handling: try/catch at boundaries, never swallow errors
- ภาษาไทยใน UI messages และ Telegram outputs
- ภาษาไทยในโค้ด comments (ตามสไตล์ที่มี)

### Frontend (Next.js)
- `"use client"` สำหรับ interactive components
- App Router structure: `/app/{route}/page.tsx`
- Tailwind classes, Lucide icons
- Optimistic UI: local state ก่อน API response
- API client: ทุก endpoint ต้องมี wrapper ใน `/lib/api.ts`

### Naming
- Room names: `ห้องทำงาน`, `ห้องนอนชั้น 2`, `โถงชั้นล่าง`, `ห้องแมวชั้น 2`
- Device IDs: lowercase, no spaces (`4lite`, `maxpro`, `maxdown`, `cat`)
- KV keys: `snake_case` with prefix (`auto_room_state:`, `system:`, `bot:`)
- Env vars: UPPER_SNAKE_CASE (`XIAOMI_*`, `TELEGRAM_*`, `WORKER_*`, `QWEN_*`, `WEATHER_*`)
- Constants: UPPER_SNAKE_CASE

### Dependencies — ห้ามเพิ่มถ้าไม่จำเป็น
- Worker: **zero dependencies** (ใช้ Web Crypto API)
- Frontend: next, react, recharts, lucide-react, clsx, tailwind-merge
- Python: micloud, gspread, requests, pycryptodome

---

## 11. Component Patterns

- **DeviceCard**: card + controls + optimistic local state + refresh callback
- **SmallMetric**: icon + label + value (grid cell)
- **ToggleChip**: on/off chip สำหรับ buzz/lock
- 建新 page ต้องอยู่ใน `app/` directory และ import จาก `lib/api.ts`
-建新 component ต้องตาม Tailwind + Lucide pattern ที่มีอยู่

---

## 12. Deployment Rules

```bash
# Worker
cd webapp/worker && npx wrangler deploy

# Frontend
cd webapp/frontend && npx vercel --prod

# Telegram Bot
cd telegram-bot && npx wrangler deploy
```

- Secrets ตั้งผ่าน `wrangler secret put` เท่านั้น (ห้ามใส่ใน `wrangler.toml` [vars])
- Deploy ใหม่ทุกครั้งหลังเปลี่ยน secret
- Frontend ENV: `NEXT_PUBLIC_API_URL` = worker URL

---

## 13. Debug & Troubleshooting

### Health Check Sequence
```bash
curl https://air-quality-api.ideaplanstudio.workers.dev/health
curl https://air-quality-api.ideaplanstudio.workers.dev/api/devices
curl https://air-quality-api.ideaplanstudio.workers.dev/api/creds
```

### PM2.5 Debug
```bash
python3 verify_pm25.py   # ตรวจสอบ siid/piid ทุก device
```

### Token Renew
```bash
python3 get_token_passtoken.py   # manual renew (Mac + Chrome)
```

### Common Issues
| ปัญา | สาเหตุ | วิธีแก้ |
|------|--------|--------|
| PM2.5 = 0/ผิด | siid/piid ผิด | เช็ก DEVICES array + verify_pm25.py |
| TOKEN_EXPIRED | Token หมดอายุ | รัน get_token_passtoken.py |
| KV ไม่ sync | Renew แล้วไม่เรียก /api/renew | เช็ก auto-renew script |
| Worker fallback secrets | KV token เสีย | ระบบ sync อัตโนมัติ |
| Frontend ไม่แสดง | NEXT_PUBLIC_API_URL ผิด | เช็ก Vercel env vars |

---

## 14. File Map (สำคัญ — ต้องอัปเดต)

| ไฟล์ | หน้าที่ | แก้ไขเมื่อ |
|------|--------|-----------|
| `webapp/worker/src/index.ts` | Worker API + cron + auto-control | เพิ่ม endpoint, เปลี่ยน device, เปลี่ยน logic |
| `webapp/frontend/lib/api.ts` | API client types + functions | เพิ่ม endpoint, เปลี่ยน device props |
| `webapp/frontend/app/page.tsx` | Dashboard page | เปลี่ยน UI layout |
| `webapp/frontend/app/history/page.tsx` | History page | เปลี่ยน chart/table |
| `webapp/frontend/components/DeviceCard.tsx` | Device card + controls | เปลี่ยน device UI/controls |
| `telegram-bot/src/index.ts` | Telegram webhook + commands | เพิ่ม command, เปลี่ยน bot logic |
| `auto-renew/renew_token_passtoken.py` | GitHub Actions token renew | เปลี่ยน auth flow |
| `get_token_passtoken.py` | Manual token renew (Mac) | เปลี่ยน cookie reader |
| `verify_pm25.py` | Debug siid/piid | เปลี่ยน device/props |
| `.github/workflows/auto-renew.yml` | Token renew schedule | เปลี่ยน schedule/secrets |
| `.github/workflows/log-pm25.yml` | Hourly PM2.5 log | เปลี่ยน schedule |
| `webapp/worker/wrangler.toml` | Worker config (D1 + KV + cron) | เปลี่ยน database/KV/cron |
| `telegram-bot/wrangler.toml` | Bot config (service binding + KV) | เปลี่ยน service binding |

---

## 15. ห้ามทำ

- ห้ามเปลี่ยน device ID (4lite, maxpro, maxdown, cat) โดยไม่อัปเดตทุกที่
- ห้ามเปลี่ยน siid/piid โดยไม่ verify_pm25.py ก่อน
- ห้ามเพิ่ม npm package โดยไม่เช็กว่าจำเป็น (worker ต้อง zero deps)
- ห้าม hardcode token/secrets ในโค้ด
- ห้ามลบ scheduled reports โดยไม่บอก
- ห้ามเปลี่ยน auto-control thresholds โดยไม่อัปเดตทั้ง worker + README + IDEAS
