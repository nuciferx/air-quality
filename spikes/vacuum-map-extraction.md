# Spike: ดึงแผนที่หุ่นดูดฝุ่น Xiaomi S40 Pro (xiaomi.vacuum.ov71gl)

สถานะ: **ดึงไฟล์แผนที่ออกมาได้แล้ว** ✅ / **decrypt + render เป็นภาพ = ยังไม่เสร็จ** ⚠️

## สิ่งที่ unlock แล้ว (ตัว blocker หลัก แก้ได้)

แผนที่ดาวน์โหลดได้ผ่าน endpoint **`/app/v2/home/get_interim_file_url_pro`** (สำคัญ: ต้องมี suffix `_pro`
สำหรับรุ่นใหม่ — ตัวธรรมดา `get_interim_file_url` คืน `invalid config for fds`) ยิงที่ host **US**
(`us.api.io.mi.com`) เท่านั้น (cn/sg คืน `invalid device`).

ขั้นตอน:
1. prop/get S10.P1 `map_obj_name` → ได้ JSON `{"index":...,"obj_name":"<userId>/<did>/<slot>"}`
   (slot 0 = live map, ดูเพิ่มจาก S10.P5 `map_management` ที่ลิสต์ map ที่บันทึก)
2. POST `get_interim_file_url_pro` body `{"obj_name":"1812498495/1191295215/0"}` (signing RC4-drop1024 เดิม)
   → `code:0 ok`, `result.url` = presigned download URL
3. GET url → ได้ JSON wrapper `{"version":2,"data":"<base64>"}`

ไฟล์ตัวอย่างที่ดึงได้: `map_us_0.bin` (slot0, 2031B), `map_us_2.bin` (slot2, 1859B)
สคริปต์: `scratchpad/probe_vacuum.py` + `enum_devices2.py` (signing)

## หุ่นนี้คือ ijai / 3irobotix (ไม่ใช่ dreame)

bucket = `3irobotic-ov71gl` → parser ที่ถูกคือ **ijai** (fork `tooljose88/...-Ijai-Support`)
ไม่ใช่ dreame. Decoder สำเร็จรูป (verified roundtrip) = `spikes/decode_ijai_map.py`

### Pipeline (จาก source ijai)
1. `{"version":2,"data":b64}` → base64decode = AES ciphertext
2. **AES-128-ECB** decrypt + unpad pkcs7 → ASCII-hex text
3. `bytes.fromhex(text)` → zlib stream → `zlib.decompress` → **protobuf RobotMap**
4. `mapHead.sizeX/sizeY` + `mapData.mapData` (1 byte/pixel) → render

### Key derivation (ijai/aes_decryptor.py)
```
inner_key = mac(lower,no-colon) + model_tail4   # "bc09b9dc2995"+"71gl" = 16B ✅
joined    = wifi_sn + "+" + owner_id + "+" + device_id
map_key   = md5( base64( AES-128-ECB(joined, inner_key) ) ).hexdigest()   # 16B
```

### inputs ยืนยันแล้ว (ยกเว้น 1 ตัว)
| input | ค่า | สถานะ |
|---|---|---|
| device_id (did) | 1191295215 | ✅ |
| model | xiaomi.vacuum.ov71gl | ✅ |
| device_mac | bc:09:b9:dc:29:95 (จาก miIO.info/device_list) | ✅ |
| owner_id (uid) | 1812498495 | ✅ |
| **wifi_sn** | **???** | ❌ **กำแพง** |

## กำแพงจริง: `wifi_sn` ไม่ถูก expose ผ่าน cloud บน ov71gl

HA ijai อ่าน wifi_sn จาก MIoT `get_property_by(siid=7, piid=45)` → split(",")[11][:18]
**แต่ ov71gl ไม่มี service 7** (คืน `-704040002`). ตรวจครบแล้ว wifi_sn ไม่อยู่ที่:
- MIoT string props ทั้ง 38 ตัว (common-params S2P24/S10P8/S15P6/S20P1 = ว่างหมด, มีแต่ Serial S1P5="67955/B2AE7F6NP05382")
- `miIO.info` (มี mac/uid/token/netif แต่ไม่มี wifi_sn)
- miIO custom methods (`get_prop[wifi_sn]`, `get_serial_number` ฯลฯ → device `user ack timeout`)
- device_list `extra` (มีแค่ fw/pincode flags)

brute แล้ว: serial ทุกแบบ, token (hex+ascii), mac variants, สลับ owner/did order, + key-scheme อื่น
(token เป็น key ตรง, md5(token), md5(serial)...) → **decrypt ไม่ผ่านสักตัว** (zlib/padding fail)

### cloud exhausted (scan แบบ oracle-driven แล้ว — 2026-06-23)
นอกจากที่ list ข้างบน ยัง scan **siid 1-22 × piid 1-52** (รวม private props เกินสเปก) แล้ว
field-brute ทุก comma/slash field กับ map จริง (oracle = zlib decompress สำเร็จ) → **NONE decrypt**.
รวมถึง `getsetting`(all keys+"all"), `get_user_device_data`, `device_list_page`, `full_device_list`,
`device_info`(404) → ทั้งหมดไม่มี wifi_sn. สรุป: **cloud ตันสนิท** สำหรับ ov71gl

### ทางปลดล็อกที่เหลือ (ต้องนอกเหนือ cloud API)
1. **อ่าน wifi_sn จาก device บน LAN** — miIO local protocol ที่ IP 192.168.1.191 ด้วย token
   `516966...4b52` (ต้องอยู่วงเดียวกับหุ่น / รัน python-miio `miiocli`)
2. **Sniff Mi Home app** — ดู request ที่ app ส่ง map decode (มี wifi_sn/key)
3. หา 3irobotix-specific cloud method ที่คืน wifi_sn (ต้อง reverse app protocol)

→ เมื่อได้ wifi_sn: `python spikes/decode_ijai_map.py map.json out.png <did> <model> <mac> <owner_id> <wifi_sn>`

อ้างอิง:
- tooljose88/HA-...-Ijai-Support (`ijai/aes_decryptor.py`, `map_data_parser.py`)
- PiotrMachowski Xiaomi-Cloud-Map-Extractor issue #714 (`get_interim_file_url_pro`, ijai.vacuum.v3)
