# Air Quality Project — Progress Log

อัพเดทล่าสุด: 2026-08-01

---

## 🏗️ Architecture Overview

```
Xiaomi Cloud API
      ↓
Cloudflare Worker (air-quality-api)   ← cron ทุก 5 นาที
      ↓                     ↓
  D1 Database          Auto-Control
  (readings)           (PM2.5 > 40 → Favorite เฉพาะห้องนั้น)
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

### Sprint 2026-08-01 — เมนูควบคุมเครื่องฟอกใน Telegram
- คำสั่งใหม่ `/menu` (alias `/control`) — inline keyboard เทียบเท่า `DeviceCard.tsx` บนเว็บ
- เมนูหลัก: 1 ปุ่ม/ห้อง แสดง power icon + PM2.5 → กดเข้า panel ของห้องนั้น
- Panel ต่อเครื่อง: เปิด/ปิด, เลือกโหมด (ตาม `modes` ของแต่ละรุ่น), พัดลม ➖/➕ 1–14 (เฉพาะ `4lite` ตอน mode=Favorite เหมือน slider บนเว็บ), 🔔 buzz, 🔒 lock, 🔄 รีเฟรช, ⬅️ กลับเมนู
- `DEVICE_INFO` ในบอทขยายเป็น `PurifierSpec` (did/host/name/props siid+piid/modes) — sync กับ `DEVICE_PROP_SPECS` + `DEVICE_MODES` บนเว็บ
- webhook รับ `callback_query` แล้ว (gate `ALLOWED_CHAT_ID` เหมือน message), ตอบ `answerCallbackQuery` เป็น toast + `editMessageText` อัปเดตข้อความเดิม
- optimistic overlay หลังสั่งงาน (Xiaomi cloud มักคืนค่าเก่าทันทีหลัง prop/set)
- ไม่แตะ worker — ใช้ `POST /api/control` เดิมผ่าน service binding
- ปุ่ม Menu สีน้ำเงินในแช็ต: `BOT_COMMANDS` + endpoint `GET /set-commands` (เรียก `setMyCommands` scope = chat ของ `ALLOWED_CHAT_ID`) — ยิงซ้ำทุกครั้งที่เพิ่ม/แก้คำสั่ง
- `/on` / `/off` แบบไม่ใส่ห้อง → เปิดเมนูปุ่มกดแทน error
- กด **Favorite** = ฟอกแรงสุด — ตั้ง mode=2 แล้วดันพัดลมขึ้น `fanMax` ให้อัตโนมัติในรุ่นที่สั่งระดับพัดลมได้ (`4lite` fanMax=14, `maxpro` fanMax=9)
- ปุ่ม **🌪 ฟอกทั้งบ้าน** บนเมนูหลัก — ปุ่มเดียว: เปิด 4 เครื่อง + Favorite + พัดลมแรงสุด ยิง sequential แล้วรายงานผลรายห้อง (ตอบ callback ก่อนเริ่มกัน `query is too old`)
- worker: เพิ่ม prop `fan { siid: 9, piid: 11 }` ให้ `4lite` ใน `DEVICES` — เดิม `/api/devices` ไม่เคยคืนค่าพัดลม ทำให้ทั้ง slider บนเว็บและปุ่มในบอทไม่รู้ค่าปัจจุบัน

### Sprint 2026-08-01 (5) — ประวัติทำความสะอาดหุ่นดูดฝุ่น (ไม่ต้องถอดรหัสแผนที่)
ผลพลอยได้จาก spike แผนที่ — props plaintext ที่ไม่เคยถูกอ่านมาก่อน ใช้ทำ UI ได้ทันที:
- `/api/vacuum` เพิ่ม `clean_record`, `cloud_record`, `map_mgmt`, `room_info`, `progress`
- บอท `/vacuum` + `VacuumCard` แสดง: สะสม 101 รอบ · 80 ชม. · 2,979 ม² (เฉลี่ย 29.5 ม²/47 นาที
  ต่อรอบ) + วันเวลา/พื้นที่ของรอบล่าสุด + แถบความคืบหน้า % ระหว่างกำลังกวาด
- **หน่วยที่ถอดได้:** `clean_record.total_area` ÷1000 = ม² · `total_time` = นาที ·
  `cloud_record.label` = `"<นาที>_<ม²×1000>_..."` (ยืนยันกับรอบทดสอบจริง `00004_4030` = 4 นาที/4.03 ม²)

### Fix 2026-08-01 (4) — filter_pct/mode ไม่เคยถูกบันทึก + โหมดที่เครื่องไม่รับ
ทดสอบกับเครื่องจริง (สั่งแล้วอ่านค่ากลับ แล้วคืนค่าเดิม) — เจอ 4 เรื่อง:

1. **`mode` และ `filter_pct` ไม่เคยถูกเขียนลง D1** — ตาราง production มีคอลัมน์ทั้งคู่
   (ถูกเพิ่มไว้ก่อน) แต่ `INSERT` ทั้ง 2 จุด (cron + `/api/log`) ไม่มีคอลัมน์นี้ และ
   `schema.sql` ก็ไม่มี → `/api/history/stats` คืน `filter_pct: null` เสมอ ทำให้
   **การทำนายวันเปลี่ยนไส้กรองใน `/predict` ตายมาตั้งแต่แรก** — แก้ INSERT + schema แล้ว
2. **`maxpro` มีระดับพัดลม Favorite จริง** (`siid 9 / piid 1`, 0–9) — อ่านค่าได้ `9`
   → ปุ่มฟอกทั้งบ้านสั่งแรงสุดได้ 2 เครื่องแล้ว (`4lite` + `maxpro`)
3. **`maxdown` (sb1) ไม่มี** prop นั้น (`9/1` อ่านไม่ขึ้น) และ `2/2` **รับแค่ 0–2** —
   สั่ง `5` ได้ `code -704220043` แปลว่าปุ่ม **L1/L2/L3 ของ maxdown ตายมาตลอด** ตัดออกแล้ว
   เช่นเดียวกับปุ่ม **Fan (mode=3) ของ 4lite** ที่ถูกปฏิเสธด้วย code เดียวกัน
   (`maxpro` รับ `5` ได้ code 0 → L1–L3 ของตัวนี้ใช้ได้จริง เก็บไว้)
4. **`POST /api/control` รายงานผลผิด** — Xiaomi ตอบ `code:0` ที่ชั้นนอกเสมอ แม้เครื่อง
   จะปฏิเสธค่า ต้องดู `result[0].code` → เดิมบอท/เว็บขึ้น "✅ สำเร็จ" ทั้งที่ไม่มีอะไรเกิดขึ้น
   ตอนนี้คืน 502 พร้อม code จริงแทน

หมายเหตุที่ยังไม่ฟันธง: spec ของ sb1 บอกว่า `2/2` คือ fan-level (Low/Med/High) ส่วน mode
จริงอยู่ `2/3` (อ่านได้ค่า `3`) — ป้ายปุ่ม Auto/Sleep/Fav ของ maxdown จึงอาจไม่ตรงความหมาย
แต่พฤติกรรมยังถูก (2 = ลมแรงสุดที่รุ่นนี้ทำได้) เลยยังไม่แก้ semantics

### Sprint 2026-08-01 (3) — อ่านสมาร์ทซีน Mi Home (`GET /api/scenes`)
ก่อนหน้านี้ระบบไม่รู้เลยว่ามีอะไรตั้งเวลาไว้ในแอป Mi Home — ซีนพวกนั้นสั่งเครื่องได้
โดยที่ auto-control ไม่รู้ตัว (ชนกันได้)

- endpoint ใหม่ `GET /api/scenes` (ต้อง `LOG_SECRET`) — ถาม `/app/v2/homeroom/gethome`
  แล้ว `/app/scene/list` ทั้ง 3 host (ซีนผูกกับ region ของบ้าน เหมือน device list)
- `/app/appgateway/miot/appsceneservice/AppScene/GetSceneList` **คืน 404** กับบัญชีนี้ —
  ตัวที่ยังใช้ได้คือ `/app/scene/list` (body `{"home_id": <number>}`)
- `summarizeScene()` ย่อซีนดิบเหลือ: ชื่อ / เปิดใช้อยู่ไหม / cron ที่ทริกเกอร์ /
  คำสั่งที่ยิง + flag `touchesOurDevices` เมื่อซีนแตะ did ที่ระบบเราคุม

**ผลการสำรวจ (2026-08-01)** — บ้าน 3 หลัง (cn/sg/us) รวม 5 ซีน:
| host | ซีน | สถานะ | ทริกเกอร์ | สั่งอะไร |
|---|---|---|---|---|
| cn | 定时智能插座 | ปิด | — | — |
| cn | Mi Plug waterfall-Schedule on/off | **เปิดอยู่** | on `0 8 * * *` / off `0 0 * * *` | ปลั๊กน้ำตก (ไม่ใช่เครื่องฟอก) |
| sg | ตัวจับเวลา-Mi Air Purifier MAX on | ปิด | `30 2 9 3 *` (ครั้งเดียว) | `sb1.set_power=off` → โถงชั้นล่าง |
| sg | 米家空气净化器消息通知 | ปิด | — | แจ้งเตือนอย่างเดียว |
| sg | Schedule-Mi Air Purifier MAX to Favorite | ปิด | `30 7 * * *` | `sb1.set_power=on` → โถงชั้นล่าง |
| us | — | ไม่มีซีน (หุ่นดูดฝุ่นไม่ได้ตั้งเวลาไว้) | | |

สรุป: **ตอนนี้ไม่มีซีนไหนชนกับ auto-control** (2 ตัวที่แตะโถงชั้นล่าง `enable=0` ทั้งคู่)
ซีนพวกนี้ใช้คำสั่ง miio เก่า (`set_power`) ไม่ใช่ MIoT — สร้างไว้ตั้งแต่ 2018/2022

### Sprint 2026-08-01 (2) — กราฟสถิติใน Telegram (`/stats`)
- `telegram-bot/src/chart.ts` — **PNG renderer เขียนเอง zero-deps** (ไม่มี canvas/lib):
  indexed-color PNG (type 3) + deflate stored blocks + CRC32/Adler32 + ฟอนต์ bitmap 5×7
  ข้อความในรูปเป็น ASCII เท่านั้น (ไม่ฝังฟอนต์ไทย) ชื่อห้องไทยไปอยู่ใน caption แทน
- `/stats` (alias `/chart`, `/graph`) → กราฟเส้น 4 ห้องพร้อมกัน สลับได้ด้วยปุ่ม:
  🌫 PM2.5 / 🌡 อุณหภูมิ / 💧 ความชื้น × 24 ชม. / 7 วัน + 🔄 รีเฟรช
- ใช้ `editMessageMedia` (ข้อความรูปใช้ `editMessageText` ไม่ได้) ตอบ callback ก่อนวาด
- ข้อมูลจาก `/api/history/stats?hours=24|168` — D1 มีย้อนหลัง ~14 วัน ครบทุกเครื่อง
- สเกลแกน Y อิงข้อมูลจริงเท่านั้น ไม่เอา threshold 40 มาดันเพดาน (ไม่งั้นวันอากาศดี
  ค่า 0–8 จะแบนติดพื้น) — เส้นประแดงวาดเฉพาะตอนที่ยังอยู่ในกรอบ
- PM2.5 บังคับแกนเริ่ม 0 · อุณหภูมิ/ความชื้นซูมเข้าช่วงข้อมูล
- ขนาดรูป 820×420 ≈ 345 KB (PNG ไม่บีบอัด — ต่ำกว่าลิมิต Telegram 10 MB มาก)

### Fix 2026-08-01 — หน่วย/enum ของหุ่นดูดฝุ่นไม่ตรงกันทั้ง 3 ชั้น
ตรวจ API จริงเทียบเอกสารแล้วเจอ 4 จุดที่ payload ไม่ตรงกับที่โค้ดคาดไว้:
- `charging` เป็น enum (`1`ชาร์จ `2`ไม่ชาร์จ `3`ชาร์จไม่ได้) แต่บอทประกาศเป็น `boolean` แล้วเช็ก truthy → ค่า `2` ก็ขึ้น "กำลังชาร์จ" ตลอด → เพิ่ม `chargingLabel()`
- `clean_time` หน่วยวินาที แต่บอทพิมพ์ต่อท้ายว่า "นาที" → หาร 60 ก่อน (2640 → 44 นาที)
- `clean_area` หน่วยดิบ = 0.01 m² — บอทหาร 1,000,000 (ได้ 0.0), frontend แสดงดิบ (ได้ 3098 m²) → หาร 100 ทั้งคู่ (3098 → 30.98 m²) ยืนยันจาก 3098 m² ใน 44 นาที เป็นไปไม่ได้
- `vacuumStatusLabel` ของ frontend เป็น mapping ของ roborock (9 = spot clean) คนละชุดกับบอท + skill doc → ยึดชุด ijai ยืนยันจากของจริง `status=9 + battery=100 + charging=1` = ชาร์จเต็ม

### Sprint 2026-06-23 — Vacuum support + US host routing
- เพิ่ม host `us` → `https://us.api.io.mi.com` ใน `apiUrl()` (worker)
- เพิ่ม `VACUUMS` registry แยกจาก `DEVICES` — ไม่เข้า D1 / auto-control / deadman / SSE
- เพิ่ม `fetchVacuumProps()` + `invokeAction()` helpers (zero-deps, reuse RC4 signing)
- endpoint ใหม่: `GET /api/vacuum`, `POST /api/vacuum/action`
- Frontend: `Vacuum` interface + `getVacuums()` + `sendVacuumAction()` ใน `lib/api.ts`
- Component ใหม่: `VacuumCard.tsx` (battery, status ไทย, clean_area/time, life bars, action buttons)
- `page.tsx`: section "หุ่นยนต์ดูดฝุ่น" แยกใต้ grid เครื่องฟอก
- docs: `AGENTS.md` §3 host routing table + vacuum isolation note, §4 endpoint table; `README.md` device table + API table

### Phase 1 — PM2.5 Logger (Google Sheets)
- `log_pm25.py` บันทึก PM2.5, temp, humidity ลง Google Sheets
- GitHub Action `log-pm25.yml` รันทุกชั่วโมง

### Phase 2 — Telegram Bot + Qwen AI
- Bot: @NuciferDataBot
- Worker: `air-quality-bot.ideaplanstudio.workers.dev`
- Webhook: `https://air-quality-bot.ideaplanstudio.workers.dev/webhook`

| คำสั่ง | ฟังก์ชัน |
|--------|---------|
| `/menu` | เมนูปุ่มกดควบคุมเครื่องฟอก (power / mode / fan / buzz / lock) |
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
| 🔴 อันตราย | > 40 µg/m³ | เปิด **เฉพาะห้องนั้น** + Favorite + Telegram alert (กลับ Auto เมื่อ ≤ 10) |
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
| Auto-Control PM2.5 | ✅ เสร็จ | เปิด Favorite เฉพาะห้องที่ฝุ่นเกิน 40 |
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
