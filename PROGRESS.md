# Air Quality Project — Progress Log

อัพเดทล่าสุด: 2026-04-13

---

## 🏗️ Architecture Overview

```
Xiaomi Cloud API
      ↓
Cloudflare Worker (air-quality-api)   ← cron ทุก 5 นาที
      ↓                     ↓
  D1 Database          Auto-Control
  (readings)           (PM2.5 >= 35 → เปิดแรงสุด)
      ↓                     ↓
  Frontend          Telegram Alert
  (Next.js)
                    Telegram Bot (air-quality-bot)
                          ↓
                    Qwen AI API
```

### Devices
| ID | ห้อง | Model | Host | DID |
|----|------|-------|------|-----|
| `4lite` | ห้องทำงาน | zhimi.airp.rmb1 | sg | 873639853 |
| `maxpro` | ห้องนอนชั้น 2 | zhimi.airpurifier.sa2 | cn | 460764069 |
| `maxdown` | โถงชั้นล่าง | zhimi.airpurifier.sb1 | cn | 131590393 |
| `cat` | ห้องแมวชั้น 2 | zhimi.airpurifier.v7 | cn | 357231085 |

---

## ✅ Features

### Phase 1 — PM2.5 Logger (Google Sheets)
- `log_pm25.py` บันทึก PM2.5, temp, humidity ลง Google Sheets
- GitHub Action `log-pm25.yml` รันทุกชั่วโมง

### Phase 2 — Telegram Bot + Qwen AI
- Bot: @NuciferDataBot
- Worker: `air-quality-bot.ideaplanstudio.workers.dev`
- Webhook: `https://air-quality-bot.ideaplanstudio.workers.dev/webhook`

| คำสั่ง | ฟังก์ชัน |
|--------|---------|
| `/status` | สถานะทุกห้อง (PM2.5, temp, humidity, filter) |
| `/predict` | ทำนาย PM2.5 trend + วันเปลี่ยน filter |
| `/on [room]` | เปิดเครื่อง |
| `/off [room]` | ปิดเครื่อง |
| `/ai [ข้อความ]` | ถาม Qwen AI วิเคราะห์อากาศ |

### Phase 3 — Cloudflare Worker API
- Worker: `air-quality-api.ideaplanstudio.workers.dev`
- cron ทุก 5 นาที → บันทึกลง D1

| Method | Path | คำอธิบาย |
|--------|------|---------|
| GET | `/health` | health check |
| GET | `/api/devices` | ข้อมูลทุกเครื่อง realtime |
| GET | `/api/device/:id` | ข้อมูลเครื่องเดียว |
| GET | `/api/history?hours=24` | ประวัติจาก D1 |
| GET | `/api/history/stats?hours=24` | สถิติรายชั่วโมง |
| POST | `/api/control` | สั่งเปิด/ปิด/เปลี่ยน mode |
| POST | `/api/renew` | อัปเดต credentials ใน KV |
| GET | `/api/creds` | ดูสถานะ credentials |

### Phase 4 — Token Auto-Renew ✅ (แก้ไขแล้ว 2026-04-13)

**ปัญหาเดิม:** Auto-renew ใช้ 2FA polling → ต้องมีคน approve ใน 3 นาที → fail ทุกครั้ง

**แก้ไขแล้ว:** ใช้ `passToken` (long-lived, bypass 2FA ได้เลย)

```
auto-renew/renew_token_passtoken.py  ← script หลัก
.github/workflows/auto-renew.yml     ← รันทุก 25 วัน
```

**Flow:**
1. GitHub Action รัน script
2. ใช้ `XIAOMI_PASS_TOKEN` login → ได้ serviceToken + ssecurity ใหม่
3. POST `/api/renew` → อัปเดต KV
4. แจ้ง Telegram

**ถ้า passToken หมดอายุ (รหัส 70016):**
1. เปิด Chrome → login Xiaomi บนเว็บ
2. รัน `python3 get_token_passtoken.py` บน Mac
3. อัปเดต `XIAOMI_PASS_TOKEN` ใน GitHub Secrets

### Phase 5 — Auto-Control PM2.5 ✅ (ใหม่ 2026-04-13)

Worker cron ทุก 5 นาที ตรวจสอบ PM2.5 และควบคุมเครื่องอัตโนมัติ

| ระดับ | PM2.5 | Action |
|-------|-------|--------|
| 🔴 อันตราย | ≥ 35 µg/m³ | เปิดทุกเครื่อง Favorite mode (แรงสุด) + Telegram alert |
| 🟢 ปลอดภัย | < 15 µg/m³ | กลับ Auto mode + Telegram clear |

ใช้ KV key `auto_control_active` เก็บ state เพื่อไม่ส่งคำสั่งซ้ำ

---

## 🔑 Credentials & Tokens

```
Xiaomi userId:        1812498495
Xiaomi email:         nuciferx@gmail.com
Telegram Bot:         @NuciferDataBot
Telegram Token:       REDACTED_TELEGRAM_BOT_TOKEN
Telegram Chat ID:     957180305
Qwen API Key:         REDACTED_QWEN_API_KEY
LOG_SECRET:           REDACTED_LOG_SECRET
KV Namespace ID:      a90e28f34e0343aea38d28ebcd8f18d5
D1 Database ID:       17bc93e3-695c-4774-b616-f88b1e66c93b
```

---

## 📋 Infrastructure

### Cloudflare Workers
| Worker | URL | Cron |
|--------|-----|------|
| air-quality-api | air-quality-api.ideaplanstudio.workers.dev | */5 * * * * |
| air-quality-bot | air-quality-bot.ideaplanstudio.workers.dev | — |

### D1 Database
- Name: `air-quality-db`
- ID: `17bc93e3-695c-4774-b616-f88b1e66c93b`
- Schema: `readings (id, ts, device_id, device_name, pm25, pm10, aqi, temperature, humidity, power)`

### KV Namespaces
| Key | ค่า | ใช้สำหรับ |
|-----|-----|---------|
| `xiaomi_creds` | JSON | Xiaomi serviceToken + ssecurity |
| `auto_control_active` | `"0"` / `"1"` | state ของ auto-control |

### GitHub Secrets (auto-renew workflow)
| Secret | คำอธิบาย |
|--------|---------|
| `XIAOMI_PASS_TOKEN` | passToken จาก Chrome (long-lived) |
| `XIAOMI_USER_ID` | 1812498495 |
| `XIAOMI_EMAIL` | nuciferx@gmail.com |
| `WORKER_URL` | https://air-quality-api.ideaplanstudio.workers.dev |
| `WORKER_SECRET` | LOG_SECRET |
| `TELEGRAM_BOT_TOKEN` | token ของ bot |
| `TELEGRAM_CHAT_ID` | 957180305 |

### Cloudflare Worker Secrets (air-quality-api)
| Secret | ค่า |
|--------|-----|
| XIAOMI_USER_ID | 1812498495 |
| XIAOMI_SERVICE_TOKEN | (renew อัตโนมัติ) |
| XIAOMI_SSECURITY | (renew อัตโนมัติ) |
| LOG_SECRET | REDACTED_LOG_SECRET_DISPLAY |
| TELEGRAM_BOT_TOKEN | 8050429795:... |
| TELEGRAM_CHAT_ID | 957180305 |

---

## 🐛 Bug Fixes

| # | ปัญหา | แก้ไข |
|---|-------|-------|
| 1 | Humidity siid/piid ผิด | ใช้ siid=3, piid=1 |
| 2 | fan/buzz key ซ้ำกัน | แยก siid ตาม model |
| 3 | creds.json key mismatch | รองรับทั้ง 2 รูปแบบ |
| 4 | HistoryRow type หายไป | เพิ่ม export type |
| 5 | ชื่อห้องผิด | แก้ใน worker + frontend |
| 6 | aqi/humidity piid=1 ซ้ำ | ลบ aqi ออก |
| 7 | Token หมดอายุ auto-renew fail | เปลี่ยนเป็น passToken |
| 8 | KV ไม่อัปเดตหลัง renew secrets | เรียก `/api/renew` ทุกครั้ง |

---

## 📁 File Structure

```
air-quality/
├── .github/workflows/
│   ├── log-pm25.yml               # รัน log_pm25.py ทุกชั่วโมง
│   └── auto-renew.yml             # auto-renew token ทุก 25 วัน (passToken)
├── auto-renew/
│   ├── renew_token.py             # เก่า — ใช้ 2FA polling (deprecated)
│   └── renew_token_passtoken.py   # ใหม่ — ใช้ passToken ไม่ต้อง 2FA
├── webapp/
│   ├── worker/src/index.ts        # Cloudflare Worker API + cron + auto-control
│   └── frontend/                  # Next.js dashboard
├── telegram-bot/                  # Telegram + Qwen AI Bot
├── get_token_passtoken.py         # ดึง passToken จาก Chrome + renew manual
├── get_token_browser.py           # login ผ่าน browser + push wrangler
├── get_token2.py                  # login ด้วย email/password + 2FA
├── log_pm25.py                    # บันทึก PM2.5 ลง Google Sheets
├── verify_pm25.py                 # debug siid/piid ของแต่ละ device
├── README.md                      # คู่มือระบบ
├── IDEAS.md                       # ไอเดียปรับปรุงในอนาคต
└── PROGRESS.md                    # ไฟล์นี้
```

---

## 💡 Ideas Backlog

| Feature | สถานะ | คำอธิบาย |
|---------|-------|---------|
| Auto-Control PM2.5 | ✅ เสร็จ | เปิดแรงสุดเมื่อฝุ่นเกิน 35 |
| Alert Telegram | ✅ เสร็จ (รวมอยู่ใน auto-control) | แจ้งเมื่อฝุ่นเกิน/ลด |
| Morning Report | 🔲 ยังไม่ทำ | สรุปอากาศทุกเช้า 08:00 |
| Outdoor vs Indoor | 🔲 ยังไม่ทำ | เทียบฝุ่นนอก/ในบ้าน (AQICN API) |
| Auto off เมื่อปลอดภัย | 🔲 ยังไม่ทำ | ปิดเครื่องเมื่อ PM2.5 ต่ำมาก |

---

## 🗺️ Roadmap

| Phase | งาน | สถานะ |
|-------|-----|-------|
| 1 | PM2.5 Logger → Google Sheets | ✅ เสร็จ |
| 2 | Telegram Bot + Qwen AI | ✅ เสร็จ |
| 3 | Cloudflare Worker API + D1 | ✅ เสร็จ |
| 4 | Token Auto-Renew (passToken) | ✅ เสร็จ |
| 5 | Auto-Control PM2.5 | ✅ เสร็จ |
| 6 | Morning Report | 🔲 ยังไม่ทำ |
| 7 | Outdoor vs Indoor | 🔲 ยังไม่ทำ |

---

## ⚡ Quick Reference

### รัน manual renew
```bash
python3 get_token_passtoken.py
```

### ทดสอบ API
```bash
curl https://air-quality-api.ideaplanstudio.workers.dev/api/devices
```

### เปิด/ปิดทุกห้อง (manual)
```bash
# เปิด
for item in "873639853|sg" "460764069|cn" "131590393|cn" "357231085|cn"; do
  IFS='|' read -r did host <<< "$item"
  curl -s -X POST https://air-quality-api.ideaplanstudio.workers.dev/api/control \
    -H "Content-Type: application/json" \
    -d "{\"did\":\"$did\",\"host\":\"$host\",\"siid\":2,\"piid\":1,\"value\":true}"
done
```

### อัปเดต credentials หลัง renew
```bash
curl -X POST https://air-quality-api.ideaplanstudio.workers.dev/api/renew \
  -H "Authorization: Bearer REDACTED_LOG_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"userId":"...","serviceToken":"...","ssecurity":"..."}'
```
