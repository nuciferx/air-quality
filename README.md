# Air Quality Monitor

ระบบติดตามคุณภาพอากาศ (PM2.5, อุณหภูมิ, ความชื้น) จาก Xiaomi Air Purifier 4 เครื่อง ผ่าน Cloudflare Worker API + Telegram Bot

## Architecture

```
Xiaomi Cloud API
      ↓
Cloudflare Worker (air-quality-api)   ← cron ทุก 5 นาที
      ↓                ↓
  D1 Database      Telegram Bot (air-quality-bot)
  (readings)            ↓
      ↓            Qwen AI API
  Frontend
  (Next.js)
```

## Devices

| ID | ห้อง | Model | Host | DID |
|----|------|-------|------|-----|
| `4lite` | ห้องทำงาน | zhimi.airp.rmb1 | sg | 873639853 |
| `maxpro` | ห้องนอนชั้น 2 | zhimi.airpurifier.sa2 | cn | 460764069 |
| `maxdown` | โถงชั้นล่าง | zhimi.airpurifier.sb1 | cn | 131590393 |
| `cat` | ห้องแมวชั้น 2 | zhimi.airpurifier.v7 | cn | 357231085 |

## Infrastructure

| Service | URL |
|---------|-----|
| API Worker | https://air-quality-api.ideaplanstudio.workers.dev |
| Telegram Bot | @NuciferDataBot |
| D1 Database | air-quality-db |

## API Endpoints

| Method | Path | คำอธิบาย |
|--------|------|---------|
| GET | `/health` | health check |
| GET | `/api/devices` | ข้อมูลทุกเครื่องแบบ realtime |
| GET | `/api/device/:id` | ข้อมูลเครื่องเดียว |
| GET | `/api/history?hours=24&device=all` | ประวัติจาก D1 |
| GET | `/api/history/stats?hours=24` | สถิติรายชั่วโมง |
| POST | `/api/control` | สั่งเปิด/ปิด/เปลี่ยน mode |
| POST | `/api/renew` | อัปเดต credentials ใน KV |
| GET | `/api/creds` | ดูสถานะ credentials |

### Control payload
```json
{
  "did": "873639853",
  "host": "sg",
  "siid": 2,
  "piid": 1,
  "value": true
}
```

## Token Auto-Renew

Xiaomi `serviceToken` หมดอายุทุก ~30 วัน ระบบ renew อัตโนมัติผ่าน GitHub Actions

**วิธีการ:** ใช้ `passToken` (long-lived, ไม่ต้องทำ 2FA)

```
.github/workflows/auto-renew.yml   → รันทุก 25 วัน
auto-renew/renew_token_passtoken.py → script หลัก
```

**GitHub Secrets ที่ต้องตั้ง:**

| Secret | คำอธิบาย |
|--------|---------|
| `XIAOMI_PASS_TOKEN` | passToken จาก Chrome cookies (long-lived) |
| `XIAOMI_USER_ID` | `1812498495` |
| `XIAOMI_EMAIL` | `nuciferx@gmail.com` |
| `WORKER_URL` | `https://air-quality-api.ideaplanstudio.workers.dev` |
| `WORKER_SECRET` | LOG_SECRET ของ Worker |
| `TELEGRAM_BOT_TOKEN` | Token ของ @NuciferDataBot |
| `TELEGRAM_CHAT_ID` | Chat ID สำหรับแจ้งเตือน |

### ถ้า passToken หมดอายุ
1. เปิด Chrome → login Xiaomi บนเว็บ
2. รัน `python3 get_token_passtoken.py` บน Mac
3. อัปเดต `XIAOMI_PASS_TOKEN` ใน GitHub Secrets

## Telegram Bot Commands

| คำสั่ง | ฟังก์ชัน |
|--------|---------|
| `/status` | สถานะทุกห้อง (PM2.5, temp, humidity, filter) |
| `/predict` | ทำนาย PM2.5 trend + วันเปลี่ยน filter |
| `/on [room]` | เปิดเครื่อง |
| `/off [room]` | ปิดเครื่อง |
| `/ai [ข้อความ]` | ถาม Qwen AI วิเคราะห์อากาศ |

Room IDs: `4lite`, `maxpro`, `maxdown`, `cat`

## Local Scripts

| ไฟล์ | ใช้ทำอะไร |
|------|---------|
| `get_token_passtoken.py` | ดึง passToken จาก Chrome → renew token → push wrangler |
| `get_token_browser.py` | เปิด browser login → push wrangler |
| `get_token2.py` | login ด้วย email/password + 2FA polling |
| `verify_pm25.py` | debug siid/piid ของแต่ละ device |
| `log_pm25.py` | บันทึก PM2.5 ลง Google Sheets |
| `auto-renew/renew_token_passtoken.py` | renew token ผ่าน passToken (ใช้ใน GitHub Actions) |

## Cloudflare Worker Secrets

```bash
# ตั้งค่า secrets ผ่าน wrangler
cd webapp/worker
npx wrangler secret put XIAOMI_USER_ID
npx wrangler secret put XIAOMI_SERVICE_TOKEN
npx wrangler secret put XIAOMI_SSECURITY
npx wrangler secret put LOG_SECRET
```

## Quick Fix: Token หมดอายุ

```bash
# รันบน Mac ที่มี Chrome login Xiaomi ไว้แล้ว
python3 get_token_passtoken.py

# script จะ:
# 1. ดึง passToken จาก Chrome
# 2. login → ได้ serviceToken + ssecurity ใหม่
# 3. push ขึ้น Cloudflare Worker secrets
# 4. เรียก /api/renew อัปเดต KV
```
