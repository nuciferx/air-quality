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

### LAN miIO ทดสอบแล้ว — ตันเหมือน cloud (2026-06-27)
ยิง miIO **ตรงไปที่หุ่น** `192.168.1.191` ด้วย local token `516966...4b52` (ดึงสดผ่าน
RC4 device_list — ดู `probe_vacuum_token.py`) ผ่าน python-miio 0.5.12 บนวง LAN เดียวกัน:
- `miIO.info` ตอบ ✅ แต่มีแค่ mac/uid/token/`ap`(ssid/bssid/rssi)/`netif` — **ไม่มี wifi_sn**
- `get_properties` common-params 2/24, 10/8, 15/6, 20/1 → `code:0 value:""` (**ว่างที่ firmware เอง** ไม่ใช่ cloud ซ่อน)
- legacy `get_prop[wifi_sn]`, `get_serial_number`, custom methods ทั้งหมด → `-9999 user ack timeout` (method ไม่มีบน fw 4.5.8_0053)
→ สรุป: option 1 (LAN) **exhausted**. common-params ที่ HA ijai ใช้ดึง wifi_sn (field[11]) ว่างเปล่าจริง
สคริปต์: `spikes/probe_vacuum_token.py` (RC4 device_list → token) + `spikes/probe_lan_miio.py` (LAN probe)

### Fresh-map forensics + reference-decoder audit (2026-06-27) — ยืนยัน firsthand
ดึง map สดครบ pipeline (`spikes/fetch_and_analyze_map.py`): LAN S10.P1 → `obj_name 1812498495/1191295215/0`
→ `get_interim_file_url_pro` (code 0 ok) → download. ผลวิเคราะห์ ciphertext:
- `version:2`, **7152 bytes, len%16==0** (block cipher), **entropy 7.974**, **ไม่ขึ้นต้น zlib 0x78** → เข้ารหัสจริง
- brute AES-wifi_sn ทุก candidate (empty, serial `67955/B2AE7F6NP05382` + ชิ้นส่วน, token-ascii, mac, ssid) → **fail หมด**

ตรวจ reference decoder ตัวล่าสุด **`Tarh-76/Python-package-vacuum-map-parser-ijai`** (อัปเดต ก.พ. 2026):
- `aes_decryptor.py` ใช้ scheme เดียวกันเป๊ะ: `gen_md5_key(wifi_sn, owner_id, device_id, model, mac)` → AES-128-ECB → `bytes.fromhex`
- `map_data_parser.py` รับ `wifi_sn` เป็น **kwarg** — ไม่มี logic หา wifi_sn ใหม่ (HA layer อ่านจาก device siid7/45 ซึ่ง ov71gl ว่าง)
- ⚠️ **subtlety**: `md5key()` pad model tail แค่ len 2→"00xx" / 3→"0xxx" (ให้ inner key = mac12+tail4 = 16B).
  tail ของ ov71gl = `ov71gl` (6 ตัว) → inner key 18B = **AES invalid**. `decode_ijai_map.py` ของเราเดา `[-4:]="71gl"`
  ซึ่งอาจผิด → ตอนนี้มี **2 unknown** (model-tail variant × wifi_sn) brute มืดพร้อมกันไม่ไหว

→ สรุปแน่นอน: **cloud + LAN exhausted**. ทั้ง key (wifi_sn) และ inner-key tail สำหรับ ov71gl ไม่เปิดเผยนอกแอป

### App-sniff ทำแล้ว (2026-06-27, iOS Mi Home 11.5.204) — **ไม่ pin!** แต่ทางตัน
mitmproxy (`spikes/sniff_mihome/`) จับ traffic iOS Mi Home ได้ครบ (TLS ไม่ pin บน iOS build นี้):
- **app ดาวน์โหลด map ciphertext ตัวเดียวกับเรา** จาก FDS `awsusor1.fds.api.xiaomi.com/3irobotic-ov71gl/<owner>/<did>/0`
  (presigned) แล้ว **decrypt เองในเครื่อง** → key ไม่วิ่งบนสาย
- app ลองโหลด `3irobotic-ov71gl/0Cloud_Management/para_config/para.config` → **404** (ไม่มี)
- app อ่าน `miotspec/prop/get` เหมือนเรา = common-params ว่าง → **app ก็ไม่ได้ wifi_sn จาก cloud**
- io.mi.com bodies เข้ารหัส RC4 ด้วย **ssecurity ของ session มือถือ** (คนละตัวกับ creds.json เรา) ถอดด้วย ssecurity เราออกมา garbage
- **replay** endpoint ที่ app ใช้ด้วย session เรา (ถอดได้): `device/deviceinfo`, `plugin/get_config_info_new`,
  `device/get_extra_data`, `home/local_device_list` → **ไม่มี wifi_sn / map key** สักตัว

### brute key ทั้งหมด fail (2026-06-27)
ทดกับ map จริง (oracle = zlib): wifi_sn="" × model-tail variants ({71gl,ov71,v71g,…}), token เป็น
inner_key/direct-key (token 16-byte ascii = "Qif2QUEzXIClbZKR"), md5(token/serial/did/mac) → **fail หมด**
สคริปต์: `fetch_and_analyze_map.py`, `replay_and_brute.py`, `brute_token_keys.py`

### ข้อสรุปใหม่ (แทนสมมุติฐาน wifi_sn เดิม)
reference decoder ijai สร้าง inner key = mac(12)+tail สำหรับ ov71gl ได้ **18 byte = AES invalid** →
**reference decode ov71gl ไม่ได้เลย**. รวมกับ key ที่ derive จากทุกแหล่งเรามี fail หมด → สรุปได้ว่า
**ov71gl `version:2` ใช้ scheme ใหม่ที่ไม่ใช่ wifi_sn-AES-ECB** และ wifi_sn ถูก cache ในแอปตั้งแต่ pairing
(ไม่วิ่งบนสายอีก) แหล่งความจริงเดียว = **โค้ด decrypt ในปลั๊กอิน/แอป หรือ app local storage**

### Windows + plugin-fetch audit (2026-06-27) — ปิด path "reverse plugin bundle" แบบ cheap
ย้ายงานมาเครื่อง **Windows 11** (วง LAN เดียวกับหุ่น — `ping 192.168.1.191` = 2ms local ✅; มือถือ .188 iOS
ไม่ตอบ ping ปกติ) เพื่อปลดกำแพง promiscuous-mode ของ Mac. firsthand วันนี้:
- เรียก `plugin/fetch_plugin` เอง (signing เรา, ทุก payload shape: latest_req models/plugin_type 1·3,
  +api_version/version_code) ที่ host **us** → `code:0` แต่ `latest_info: []` **ว่างทุกตัว**
- `plugin/get_support_models {models:[ov71gl]}` → **`plugin_id: 0`** = **ov71gl ไม่มีปลั๊กอินแยกให้ดาวน์โหลด**
  → map decrypt อยู่ใน **native renderer ฝังในแอป** (`tinyrender_ios_native`, เห็นใน app_config CDN) ไม่ใช่ bundle
- ใน app-sniff: body ของ `fetch_plugin`/io.mi.com ถูก RC4 ด้วย **ssecurity ของ session มือถือ** → ถอดด้วย
  creds.json เรา = garbage (ยืนยันว่า capture เดิมไม่เคยได้ URL ปลั๊กอินจริง)
→ สรุป: **"download ปลั๊กอินรุ่นนี้แล้ว grep หา key" ไม่มีจริง** — decrypt logic อยู่ในโค้ด native ที่ share
ทั้งแอป (ต้อง reverse ตัว Mi Home IPA / tinyrender lib เอง ไม่ใช่ bundle เล็กๆ)

### รอบ 2026-08-01 — ปิดทางเพิ่ม 4 ทาง แต่ได้ข้อมูล plaintext ชุดใหม่

ทดสอบผ่าน worker (`GET /api/vacuum/inspect`, prop probe) + LAN miIO **ขณะหุ่นกำลังกวาดจริง**
(ต่างจากรอบก่อนที่ทดสอบตอนหุ่นจอด):

**ปิดทางแล้ว:**
- ❌ **`vacuum_position` S10/P4 ว่างเปล่าแม้ตอนกำลังกวาด** — ทั้งผ่าน cloud และ LAN
  → แผน "poll พิกัดแล้ววาดเส้นทางเอง โดยไม่ต้องถอดรหัส" **เป็นไปไม่ได้** แอปอ่านตำแหน่งจากในไฟล์ map
- ❌ **trajectory slot 1 ไม่เคยมีไฟล์จริง** — `S10/P2` ชี้ `<uid>/<did>/1` แต่ FDS คืน `Object Not Found`
  ทั้งตอนจอด ตอนกวาด และหลังจบรอบ
- ❌ **ไม่มี thumbnail/ภาพ render สำเร็จรูป** — ลอง `<uid>/<did>/0.png|0.jpg|thumb|4|5` → Object Not Found หมด
- ❌ **cloud clean record `.bin` ดึงไม่ได้ด้วย API ที่รู้จัก** — `S10/P15` ชี้
  `2026/08/02/<uid>/<did>_001050835.bin` แต่ `get_interim_file_url(_pro)` ตอบ `-6 invalid object name`
  (validate ว่า obj_name ต้องเป็น `<uid>/<did>/<n>` เท่านั้น) · `/app/v2/home/get_file_url`,
  `/app/v2/home/get_clean_record_file_url` → 404 (ไม่มี endpoint)
- ❌ ไม่มี decoder สาธารณะรองรับ `version:2` (ค้น 2026-08-01: PiotrMachowski #714, tooljose88 fork,
  ha_xiaomi_home #1539 — issue S40 Pro ยังไม่มีคนตอบ)

**ได้ข้อมูล plaintext ชุดใหม่ (spike เดิมไล่แต่ common-params เลยไม่เคยอ่าน):**
| prop | เนื้อหา |
|---|---|
| `S10/P3 clean_record` | ประวัติสะสม — `total_time` 4791 นาที, `total_area` 2975410, `total_count` 100 + `history_list` |
| `S10/P15 cloud_record` | รอบล่าสุด: label `"<นาที>_<พื้นที่×10>_..."` (ยืนยันกับรอบทดสอบ: `00004_4030` = 4 นาที / 4.03 m²) |
| `S10/P5 map_mgmt` | มี **4 map slot** (0/2/3 มีไฟล์จริง ทั้งหมด `version:2` เข้ารหัส) |
| `S2/P16 room_info` | `{"rooms":[{"id":3,"name":""}],"map_uid":2}` |
| `S2/P40 cur_cfg`, `S2/P89 progress` | โหมด/ความคืบหน้ารอบปัจจุบัน |

→ props พวกนี้ถูกเพิ่มเข้า `/api/vacuum` แล้ว (ใช้ทำหน้าประวัติทำความสะอาดได้ทันทีโดยไม่ต้องถอดรหัส)

### ทางที่เหลือ (re-ranked 2026-08-01)
**A. Android app data** (ทางเดียวที่ deterministic และไม่ต้องแตะหุ่น) — สคริปต์พร้อมแล้ว:
`spikes/android_extract_wifi_sn.py` รับ `adb backup` (.ab) / tar / โฟลเดอร์ที่ pull มา แล้วสแกนหา
`wifi_sn` ทั้งใน sqlite และไฟล์ดิบ · Android ง่ายกว่า iOS มาก (APK ไม่เข้ารหัส, `adb backup` ไม่ต้อง root)
ถ้า Android 12+ บล็อก backup → ใช้ emulator ที่รูทได้แล้ว `adb pull /data/data/com.xiaomi.smarthome`

**B. Frida hook `Cipher.init`** บน emulator — ดักคีย์ AES ตอน runtime (ปลดโดยไม่ต้องรู้ wifi_sn)

**C. ทดสอบล็อกอินเครื่องใหม่** — ถ้าแผนที่ขึ้นบนเครื่องที่ไม่เคย pair แปลว่า key material ดึงจาก cloud ได้
(ล้มสมมุติฐาน "cache ตั้งแต่ pairing") → เป้าหมายเปลี่ยนเป็นจับ traffic ตอน first-load **โดยไม่ต้องล้างหุ่น**

**D. (ของเดิม) reverse Mi Home native renderer / จับ traffic ตอน pairing**

### ทางที่เหลือ (re-ranked 2026-06-27 หลังปิด cheap-plugin path)
1. **ดึง wifi_sn จาก app local storage** (iOS Mi Home container — jailbreak หรือ encrypted-backup extract) —
   **deterministic ถ้าได้ container** (wifi_sn ถูก cache ตั้งแต่ pairing) ต้องเข้าถึงเครื่อง/iTunes backup
2. **จับ pairing traffic** (reset+pair หุ่นใหม่ผ่าน proxy) — ช่วง provision เป็น**จังหวะเดียวที่ key/wifi_sn
   อาจวิ่งบนสาย** · เสี่ยง: ล้าง map/ห้อง/config หุ่นทิ้ง · ต้องมือถือ+proxy พร้อม
3. **Reverse Mi Home native renderer** (tinyrender) จาก decrypted IPA — payoff สูงสุด (ปลด scheme ทั้งหมด)
   แต่ R.E. หนัก ต้องมี IPA ที่ decrypt แล้ว + เครื่องมือ disasm
4. **LAN MITM (ตอนนี้ทำได้บน Windows แล้ว)** — แต่ app-sniff พิสูจน์แล้วว่า key **decrypt local ไม่วิ่งบนสาย**
   ตอนใช้งานปกติ → payoff ต่ำ (ได้แค่ยืนยันชื่อ method) เว้นแต่ใช้คู่กับ path 2 (จับตอน pairing)
→ ได้ key/wifi_sn แล้ว: `decode_ijai_map.py map_fresh.json out.png <did> <model> <mac> <owner_id> <wifi_sn>`

> หมายเหตุ: pipeline **ดาวน์โหลด map สด ใช้งานได้สมบูรณ์** (`fetch_and_analyze_map.py`) — เหลือแค่ปลดรหัส

### LAN miIO sniff: ยืนยันแอปใช้ LAN จริง แต่ macOS บล็อก (2026-06-27)
**ค้นพบสำคัญ:** ดัก UDP 54321 (passive tcpdump) ตอนเปิดแผนที่ → เห็นมือถือ (.188) **broadcast miIO hello
discovery** (`21310020`+0xff, did=ffffffff) 15 ครั้ง → **แอปคุยกับหุ่นผ่าน LAN miIO จริง** ไม่ใช่ cloud relay ล้วน
การอ่าน prop จริงเป็น **unicast** (.188↔.191) ซึ่งบน switched Wi-Fi มองไม่เห็นถ้าไม่ MITM

**กำแพง macOS:** จะ MITM (ARP-spoof) ให้เห็น unicast — แต่ **บน Wi-Fi en0 ของ macOS ตั้ง promiscuous mode ไม่ได้**
(`Errno 102`) ทำให้ **scapy, bettercap พังหมด** (ทั้งคู่ต้อง promisc ตอน init), dsniff/arpspoof ก็ไม่มีใน brew
→ ทำ LAN MITM บน Mac เครื่องนี้ไม่ได้

**ทำไม LAN ถึงเป็นความหวัง:** miIO LAN เข้ารหัสด้วย **device token ซึ่งเรามี** (`516966…`) — ต่างจาก HTTPS ที่ใช้
ssecurity ของมือถือ (ถอดไม่ได้) ดังนั้นถ้าจับ unicast miIO ได้ **เราถอดอ่าน method+params+result ได้ 100%**
จะเห็นเป๊ะว่าแอปเรียก method ไหนดึง wifi_sn/map-key (ตัวที่ cloud/LAN-probe ของเราเรียกแล้ว timeout เพราะเดาชื่อผิด)

**▶ ทำต่อบน Windows/Linux (หรือ Mac + USB-Ethernet/USB-Wi-Fi ที่ promisc ได้):**
1. ต่อเครื่องวง LAN เดียวกับหุ่น (.191) + มือถือ (.188)
2. ARP-spoof 2 ฝั่ง: Windows = `Ettercap`/`bettercap` ได้เลย · Linux = `arpspoof -i <if> -t <phone> <robot>` + `-r`
   (เปิด ip_forward: `sysctl -w net.ipv4.ip_forward=1`)
3. จับ: `tcpdump -i <if> -w miio_lan.pcap 'udp port 54321 and host 192.168.1.191 and host 192.168.1.188'`
   (Wireshark ก็ได้) → เปิดแผนที่ในแอป pan/zoom + เริ่มทำความสะอาด
4. ก๊อป pcap กลับมา → ถอดด้วย **`spikes/decode_miio_pcap.py`** (พร้อมแล้ว):
   `VACUUM_LOCAL_TOKEN=<32hex token> python spikes/decode_miio_pcap.py miio_lan.pcap`
   (token: ดึงสดด้วย `python spikes/probe_vacuum_token.py` — field `token`)
5. อ่าน method ที่แอปใช้ → เรียก method นั้นเองผ่าน python-miio (`probe_lan_miio.py`) → ได้ wifi_sn/key → decode map
สคริปต์ที่เกี่ยวข้องอยู่ใน `spikes/` หมดแล้ว (token ดึงสดด้วย `probe_vacuum_token.py`)

> ⚠️ setup: เปิด passwordless sudo ไว้ที่ `/etc/sudoers.d/claude-vacuum` (bettercap/tcpdump/sysctl/pkill)
> ถ้าไม่ใช้ต่อแล้วลบทิ้งได้: `sudo rm /etc/sudoers.d/claude-vacuum`

อ้างอิง:
- **Tarh-76/Python-package-vacuum-map-parser-ijai** (decoder ล่าสุด, scheme ยืนยัน 2026-06-27)
- tooljose88/HA-...-Ijai-Support (`ijai/aes_decryptor.py`, `map_data_parser.py`)
- PiotrMachowski Xiaomi-Cloud-Map-Extractor issue #714 (`get_interim_file_url_pro`, ijai.vacuum.v3)
