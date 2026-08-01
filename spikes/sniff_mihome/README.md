# Sniff Mi Home — recover S40 Pro (ov71gl) map key / wifi_sn

ทำไมต้อง sniff: cloud + LAN miIO **ตันหมดแล้ว** (ดู `../vacuum-map-extraction.md`).
ทั้ง `wifi_sn` และ inner-key model-tail ของ ov71gl ไม่เปิดเผยนอกแอป Mi Home.
ทางเดียวที่เหลือคือดูว่า **แอปใช้ค่าอะไร** ตอน render map.

## ของที่ต้องมี
- มือถือที่ลง Mi Home + เห็นแผนที่หุ่นได้ (วงเดียวกับ Mac ก็ได้)
- Mac เครื่องนี้ทำเป็น proxy (IP `192.168.1.193`)

## ขั้นตอน
1. ติดตั้ง mitmproxy ใน venv ที่มีอยู่แล้ว:
   ```
   spikes/.miio-venv/bin/pip install mitmproxy
   ```
2. รัน addon (headless เก็บ log):
   ```
   spikes/.miio-venv/bin/mitmdump -s spikes/sniff_mihome/capture_map.py --listen-port 8080
   ```
3. มือถือ: Settings → Wi-Fi → proxy = manual, host `192.168.1.193`, port `8080`
4. มือถือ: เปิด `http://mitm.it` ในเบราว์เซอร์ → ติดตั้ง + **trust** CA cert
   (Android 7+ ต้องลง cert เป็น *system* cert หรือใช้ rooted/modded APK — ดูข้อ "กำแพง")
5. เปิด Mi Home → เลือกหุ่น S40 Pro → เข้าหน้า **แผนที่** → pan/zoom + กดเริ่มทำความสะอาด
6. ดูผลใน `spikes/sniff_mihome/captured.log` — มองหาบรรทัด `[HIT]` ที่มี
   `wifi_sn` / key 32-hex / `mapKey` / `obj_name` / host `3irobotix`

## กำแพงที่อาจเจอ (cert pinning)
Mi Home **pin certificate** → mitmproxy อาจเห็นแค่ TLS handshake fail ไม่เห็น body
ทางแก้ (เรียงจากง่าย):
- ใช้ **modded Mi Home APK** ที่ปิด pinning (ค้น "Mi Home no ssl pinning")
- มือถือ **root + frida** + script unpin (`frida-multiple-unpinning`)
- ถ้า map ใช้ **3irobotix endpoint แยก** (ไม่ใช่ io.mi.com) อาจไม่ pin → ลองก่อน

ถ้าได้ค่า key/wifi_sn (+ model-tail ที่ถูก) แล้ว:
```
spikes/.miio-venv/bin/python spikes/decode_ijai_map.py \
    spikes/map_fresh.json out.png 1191295215 xiaomi.vacuum.ov71gl bc:09:b9:dc:29:95 1812498495 <wifi_sn>
```
