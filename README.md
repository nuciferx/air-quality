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

## Known Good PM2.5 Mapping

ถ้าค่า PM2.5 เพี้ยน ให้ยึด mapping นี้เป็นค่าที่ใช้งานจริงของระบบปัจจุบันก่อน

| ID | ห้อง | Host | PM2.5 |
|----|------|------|-------|
| `4lite` | ห้องทำงาน | `sg` | `siid=3, piid=4` |
| `maxpro` | ห้องนอนชั้น 2 | `cn` | `siid=3, piid=2` |
| `maxdown` | โถงชั้นล่าง | `cn` | `siid=3, piid=2` |
| `cat` | ห้องแมวชั้น 2 | `cn` | `siid=3, piid=2` |

ไฟล์หลักที่ต้องเช็ก:

- `webapp/worker/src/index.ts`
- `webapp/backend/xiaomi.py`
- `verify_pm25.py`
- `webapp/README.md`

## PM2.5 Recovery Checklist

ถ้าค่า PM2.5 อ่านผิดหรือไม่ตรงกับในแอป Xiaomi ให้ทำตามนี้:

1. เช็ก mapping ใน `webapp/worker/src/index.ts` ว่ายังเป็นค่าตามตารางด้านบน
2. ยิง API จริง:
   - `curl https://air-quality-api.ideaplanstudio.workers.dev/api/devices`
   - `curl https://air-quality-api.ideaplanstudio.workers.dev/api/device/maxpro`
   - `curl https://air-quality-api.ideaplanstudio.workers.dev/api/device/maxdown`
   - `curl https://air-quality-api.ideaplanstudio.workers.dev/api/device/cat`
3. ถ้าค่า `cn` ไม่ขึ้นหรือขึ้นเป็น stale ให้เช็ก token ก่อน:
   - `python3 get_token_passtoken.py`
   - อัปเดต `XIAOMI_USER_ID`, `XIAOMI_SERVICE_TOKEN`, `XIAOMI_SSECURITY` ใน Cloudflare Worker secrets
   - deploy ใหม่ด้วย `cd webapp/worker && npx wrangler deploy`
4. ถ้าต้อง debug property ดิบจาก Xiaomi ให้ใช้ `python3 verify_pm25.py`
5. ถ้า production worker อ่านค่าได้แต่หน้าเว็บยังเพี้ยน ให้เช็ก type/client ที่:
   - `webapp/frontend/lib/api.ts`
   - `webapp/frontend/components/DeviceCard.tsx`
   - `webapp/frontend/app/control/page.tsx`

หมายเหตุ:

- ระบบปัจจุบันถูกตั้งให้ยอม fallback จาก KV credential ไปใช้ Worker secrets อัตโนมัติ ถ้า KV token หมดอายุ
- ถ้า `/api/device/:id` ขึ้น `TOKEN_EXPIRED` แต่ local `creds.json` ยังใช้ได้ แปลว่าฝั่ง production secrets/KV ไม่ได้อัปเดต

## Infrastructure

| Service | URL |
|---------|-----|
| API Worker | https://air-quality-api.ideaplanstudio.workers.dev |
| Telegram Bot | @NuciferDataBot |
| D1 Database | air-quality-db |

## Current Control Rules

ระบบ auto-control ปัจจุบันทำงานแยกแต่ละห้อง ไม่ได้รวมทุกห้องแล้ว

- ถ้าห้องใด `PM2.5 > 40`:
  - เปิดเฉพาะห้องนั้น
  - ตั้ง `mode = Favorite`
  - ส่ง Telegram แจ้งเตือนเฉพาะห้องนั้น
- ถ้าห้องใด `PM2.5 <= 10` และก่อนหน้านี้ถูกเปิดโดย auto-control:
  - เปลี่ยนเฉพาะห้องนั้นกลับ `mode = Auto`
  - ส่ง Telegram แจ้งว่าห้องนั้นกลับสู่ safe แล้ว
- ถ้าค่าสูงต่อเนื่อง จะมี escalation alert ซ้ำสำหรับห้องนั้น

หมายเหตุ:

- threshold ปัจจุบันตั้งแบบ default เป็น `danger = 40`, `safe = 10`
- state ของแต่ละห้องถูกเก็บแยกใน KV เพื่อจำว่าห้องใดถูกเปิดโดยระบบอัตโนมัติ

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

## Automation ที่ตั้งไว้ตอนนี้

### 1. Cloudflare Worker Cron

- ไฟล์: `webapp/worker/wrangler.toml`
- schedule: `*/5 * * * *`
- งานที่ทำ:
  - ดึงค่าจาก Xiaomi ทุก 5 นาที
  - บันทึกลง D1
  - ตรวจ PM2.5 เพื่อ auto-control แบบแยกห้อง
  - ส่ง Telegram alert เมื่อห้องใดเกิน threshold / กลับสู่ safe
  - ตรวจ deadman alert ถ้าระบบเงียบเกินเวลาที่กำหนด
  - ส่ง scheduled report ตามเวลาที่กำหนด

### 2. GitHub Actions: Auto-Renew Xiaomi Token

- ไฟล์: `.github/workflows/auto-renew.yml`
- schedule: `0 2 */25 * *`
- งานที่ทำ:
  - รัน `auto-renew/renew_token_passtoken.py`
  - ใช้ `XIAOMI_PASS_TOKEN` renew token โดยไม่ต้อง 2FA
  - เรียก `/api/renew` เพื่ออัปเดต credential ใน worker

### 3. GitHub Actions: Log PM2.5

- ไฟล์: `.github/workflows/log-pm25.yml`
- schedule: `0 * * * *`
- งานที่ทำ:
  - รัน `python log_pm25.py`
  - ดึงค่าจาก Xiaomi
  - POST เข้า worker `/api/log`
  - เก็บค่าไว้เป็นประวัติใน D1 แบบรอบรายชั่วโมง

### 4. Telegram Bot

- service: `telegram-bot`
- config: `telegram-bot/wrangler.toml`
- งานที่ทำ:
  - รับคำสั่ง `/status`, `/predict`, `/on`, `/off`, `/weather`, `/weather_home`, `/token`, `/ai`
  - ใช้ service binding ไปหา `air-quality-api`
  - fallback ไปที่ `/api/history?hours=1` ถ้า `/api/devices` ใช้งานไม่ได้
  - จำพิกัดล่าสุดที่ผู้ใช้ส่ง location มาให้บอท

### 5. Scheduled Telegram Reports

- ส่งรายงานเวลาไทย `08:00`, `12:00`, `17:00`, `00:00`
- ทุกรอบมี:
  - ค่าคุณภาพอากาศในบ้านทุกห้อง
  - สถานะ token Xiaomi
- รอบ `08:00` เพิ่ม:
  - สภาพอากาศทั่วไปที่บ้าน
  - พยากรณ์อากาศของวัน

### 6. Token Status Monitoring

- endpoint: `GET /api/creds`
- bot command: `/token`
- ข้อมูลที่แสดง:
  - ใช้ credential source อะไรอยู่ (`kv` หรือ `secrets`)
  - token ถูกอัปเดตล่าสุดเมื่อไร
  - ผ่านมาแล้วกี่วัน
  - โดยประมาณเหลืออีกกี่วันก่อนครบ cycle ~30 วัน

## Telegram Bot Commands

| คำสั่ง | ฟังก์ชัน |
|--------|---------|
| `/status` | สถานะทุกห้อง (PM2.5, temp, humidity, filter) |
| `/predict` | ทำนาย PM2.5 trend + วันเปลี่ยน filter |
| `/on [room]` | เปิดเครื่อง |
| `/off [room]` | ปิดเครื่อง |
| `/weather_home` | ดูสภาพอากาศที่บ้าน |
| `/weather` | ดูสภาพอากาศจากตำแหน่งล่าสุดที่ส่งให้บอท |
| `/token` | ดูสถานะ token Xiaomi และอายุ token |
| `/ai [ข้อความ]` | ถาม Qwen AI วิเคราะห์อากาศ |

Room IDs: `4lite`, `maxpro`, `maxdown`, `cat`

หมายเหตุ:

- ถ้าต้องการให้ `/weather` ใช้งานได้ ต้องส่ง location ให้บอทใน Telegram อย่างน้อย 1 ครั้ง
- `/weather_home` ใช้พิกัดบ้านที่ตั้งไว้ใน worker/bot env

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

## Weather Config

ค่าที่ใช้สำหรับ weather report / weather bot:

- `WEATHER_LAT`
- `WEATHER_LON`
- `WEATHER_LABEL`

ระบบรองรับ 2 แบบ:

- `weather_home`: ใช้พิกัดบ้านคงที่จาก env
- `weather`: ใช้พิกัดล่าสุดที่ผู้ใช้ส่งให้บอท

ถ้ายังไม่ได้ตั้งค่าพิกัดบ้าน ให้เช็ก env ของ worker และ bot ก่อน

## Operational Notes

สิ่งที่ควรเช็กเมื่อระบบผิดปกติ:

1. `curl https://air-quality-api.ideaplanstudio.workers.dev/health`
2. `curl https://air-quality-api.ideaplanstudio.workers.dev/api/devices`
3. `curl https://air-quality-api.ideaplanstudio.workers.dev/api/creds`
4. เช็กว่า cron ยังรันทุก 5 นาที และ D1 ยังมีข้อมูลใหม่
5. เช็กว่า Telegram bot ยังตอบ `/status`, `/weather_home`, `/token`

ถ้า token ฝั่ง KV เสีย แต่ secrets ยังถูกต้อง:

- worker จะ fallback ไปใช้ secrets อัตโนมัติ
- จากนั้นจะพยายาม sync credential ที่ใช้งานได้กลับเข้า KV

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
