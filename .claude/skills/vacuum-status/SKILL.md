---
name: vacuum-status
description: Compact live status board for the Xiaomi S40 Pro robot vacuum (host `us`, model xiaomi.vacuum.ov71gl). Curls the public `/api/vacuum` endpoint and renders battery / cleaning state / consumables in Thai, plus the actions you can trigger via `/api/vacuum/action`. Token-lean (≤200 words). Use to "open the vacuum section" without re-exploring code. Hands off to `xiaomi-debugger` if offline/values wrong, `webapp-editor` for code, `telegram-bot-editor` for the `/vacuum` bot command.
---

# /vacuum-status — robot vacuum live board

ใช้เพื่อ "เปิดดูหุ่นดูดฝุ่นตอนนี้เป็นยังไง" — dashboard 1 หน้า ≤200 คำ ไม่ใช่บทวิเคราะห์
ต่างจาก `/webapp-status` (ดูโค้ด) — อันนี้ดู **สถานะหุ่นจริง** จาก API สด

## When to invoke

- ผู้ใช้พิมพ์ `/vacuum-status`
- ผู้ใช้พูดว่า "หุ่นดูดฝุ่นเป็นไง", "หุ่นกวาดถึงไหน", "แบตหุ่นเหลือเท่าไหร่", "เปิดดูหุ่น"

## Token budget — strict

**Do (cheap, parallel):**
- Bash: `curl -s -m 8 https://air-quality-api.ideaplanstudio.workers.dev/api/vacuum`
- Bash: `git log --oneline -3 -- webapp/worker/src/index.ts` (เฉพาะถ้าผู้ใช้ถามเรื่องการเปลี่ยนแปลงโค้ด)

**Don't:**
- ห้าม spawn Explore / general-purpose agent
- ห้าม read `webapp/worker/src/index.ts` ทั้งไฟล์ — endpoint คืนค่าครบแล้ว
- ห้าม curl device_list / ดึง token จาก KV / รัน wrangler — `/api/vacuum` พอ
- ห้ามยิง `POST /api/vacuum/action` เอง (เป็นคำสั่งจริงกับเครื่อง) — แค่บอกผู้ใช้ว่าสั่งได้ยังไง
- ห้ามเขียนไฟล์ใหม่ / commit / push

## Status code → ไทย (S2.P2 uint8)

`1`ว่าง `2`กำลังชาร์จ `3`พักชาร์จ `4`กำลังกวาด `5`หยุดชั่วคราว `6`กำลังกลับแท่น
`7`กำลังล้างม็อบ `9`ชาร์จเต็ม `10`กำลังสร้างแผนที่ `15`⚠️Error `16`กวาด+ถู `17`ถู `14`แท่นทำงาน
(ไม่รู้จัก → แสดงเลขดิบ) · charging: `1`ชาร์จอยู่ `2`ไม่ชาร์จ `3`ชาร์จไม่ได้

## หน่วยที่ต้องแปลงก่อนแสดง (verified 2026-08-01)

| field | หน่วยดิบ | แปลง |
|---|---|---|
| `clean_area` | 0.01 m² | ÷ 100 |
| `clean_time` | วินาที | ÷ 60 |
| `clean_record.total_area` | m² × 1000 | ÷ 1000 |
| `clean_record.total_time` | นาที | ÷ 60 = ชม. |
| `cloud_record.label` | `"<นาที>_<m²×1000>_..."` | field[1] ÷ 1000 |

`clean_record` / `cloud_record` / `map_mgmt` / `room_info` เป็น **JSON string** ต้อง parse ก่อน

## Output format (เคร่งครัด — ≤200 คำ)

```
# หุ่นดูดฝุ่น Xiaomi S40 Pro — สถานะ (YYYY-MM-DD HH:MM)

## ตอนนี้
- สถานะ: <ไทย> (code <n>) | online: <✓/✗>
- แบต: <n>% (<กำลังชาร์จ/ไม่ชาร์จ>)
- ทำความสะอาดล่าสุด: <clean_area> · <clean_time แปลงเป็นนาที>

## วัสดุสิ้นเปลือง
- แปรงหลัก <n>% · แปรงข้าง <n>% · ไส้กรอง <n>% · ผ้าม็อบ <n>%
  (เตือนถ้าตัวใด <20%)

## สั่งงานได้ (POST /api/vacuum/action — body {"did":"1191295215","action":"<x>"})
- start_sweep / stop / stop_and_charge / start_mop / sweep_mop / pause / continue / charge

## Suggested next
1. <เช่น "แบตต่ำ + ไม่ชาร์จ → สั่ง charge" หรือ "ไส้กรอง <20% → เปลี่ยน">
```

ถ้า `online:false` หรือ values ว่าง/เป็น `ERR(...)` → ใส่ `🚨 ALERT:` บนสุด + ชี้ว่าเป็น host `us` (region ใหม่) อาจ token/region — handoff `xiaomi-debugger`
ถ้า `/api/vacuum` คืน 404 → worker ยังไม่ได้ deploy เวอร์ชันที่มี endpoint นี้ → แนะนำ `deploy-checker`

## After output

จบที่ output อย่ายาว ห้ามตามด้วย "shall I do X?" ผู้ใช้จะบอกเอง

ถ้าผู้ใช้บอกจะทำต่อ — handoff:
- หุ่น offline / ค่าเพี้ยน / TOKEN → `xiaomi-debugger` agent
- แก้โค้ด endpoint/การ์ด vacuum → `webapp-editor` agent
- แก้คำสั่ง `/vacuum` ในบอท → `telegram-bot-editor` agent
- เรื่องดึง **แผนที่** → ยังเป็น spike ที่ยัง unsolved (ดู `spikes/vacuum-map-extraction.md`) อย่าเริ่มใหม่โดยไม่อ่านก่อน

## Anti-patterns

- output เกิน 200 คำ
- ยิง action จริงกับเครื่องเองโดยผู้ใช้ไม่ได้สั่ง
- ดึง token / device_list / รัน wrangler "เผื่อ"
- อ่าน worker source ทั้งไฟล์
- เริ่มแก้โค้ดทันที — `/vacuum-status` จบที่ output เสมอ
