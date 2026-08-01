"""
ดึง `wifi_sn` ของหุ่นดูดฝุ่นจาก app data ของ Mi Home บน Android
(ทางที่เหลืออยู่ทางเดียวที่ deterministic — cloud/LAN/app-sniff ตันหมด ดู vacuum-map-extraction.md)

ทำไม Android ไม่ใช่ iOS: APK ไม่ถูกเข้ารหัสแบบ IPA และดึง app data ได้ด้วย `adb backup`
โดยไม่ต้อง root/jailbreak (ถ้า Android ≤ 11 หรือแอปตั้ง allowBackup)

## วิธีใช้

1) เปิด Developer options + USB debugging บนมือถือ Android ที่ล็อกอิน Mi Home บัญชีเดียวกัน
2) ต่อสาย แล้ว:
       adb backup -f mihome.ab -noapk com.xiaomi.smarthome
   (กด "สำรองข้อมูลของฉัน" บนมือถือ ไม่ต้องใส่รหัสผ่าน)
3) python spikes/android_extract_wifi_sn.py mihome.ab

ถ้า `adb backup` ถูกบล็อก (Android 12+ / allowBackup=false) ทางสำรอง:
   - emulator ที่รูทได้ (Android Studio AVD ภาพ non-Google-Play) → ล็อกอิน Mi Home →
     `adb root; adb pull /data/data/com.xiaomi.smarthome`
   - แล้วรันสคริปต์นี้ชี้ไปที่โฟลเดอร์ที่ pull มาแทนไฟล์ .ab

สคริปต์นี้ **อ่านอย่างเดียว** ไม่แก้ไฟล์ในเครื่องมือถือ
"""
import json
import os
import re
import sqlite3
import sys
import tarfile
import zlib

sys.stdout.reconfigure(encoding="utf-8")

DID = "1191295215"
MODEL_HINT = "ov71gl"
# รูปแบบ wifi_sn ของ 3irobotix: ตัวอักษร/ตัวเลข ยาว ~16-18 ตัว (HA ijai ตัดที่ [:18])
SN_PATTERN = re.compile(rb"[A-Za-z0-9]{14,24}")
INTEREST = (b"wifi_sn", b"wifisn", b"wifi_serial", b"sn_code", DID.encode(), MODEL_HINT.encode())


def unpack_ab(path: str, out_tar: str) -> str:
    """.ab = 24-byte header + zlib stream ของ tar"""
    with open(path, "rb") as f:
        header = b""
        for _ in range(4):  # magic / version / compressed / encryption
            line = b""
            while (c := f.read(1)) not in (b"\n", b""):
                line += c
            header += line + b"\n"
        if b"none" not in header.lower() and b"AES" in header:
            sys.exit("backup ถูกเข้ารหัสด้วยรหัสผ่าน — สำรองใหม่โดยเว้นรหัสผ่านว่าง")
        data = zlib.decompress(f.read())
    with open(out_tar, "wb") as t:
        t.write(data)
    return out_tar


def scan_bytes(blob: bytes, label: str) -> None:
    for needle in INTEREST:
        for m in re.finditer(re.escape(needle), blob):
            lo = max(0, m.start() - 120)
            hi = min(len(blob), m.end() + 200)
            chunk = blob[lo:hi]
            printable = chunk.decode("utf-8", "replace").replace("\n", " ")
            print(f"[{label}] …{printable}…")
            print()


def scan_sqlite(path: str) -> None:
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        cur = con.cursor()
        tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        for t in tables:
            try:
                rows = cur.execute(f'SELECT * FROM "{t}"').fetchall()
            except sqlite3.DatabaseError:
                continue
            for row in rows:
                blob = " ".join(str(c) for c in row).encode("utf-8", "replace")
                if any(n in blob for n in INTEREST):
                    print(f"[sqlite {os.path.basename(path)}::{t}] {blob[:400].decode('utf-8','replace')}")
                    print()
        con.close()
    except Exception as exc:  # noqa: BLE001
        print(f"  (ข้าม {path}: {exc})")


def walk_dir(root: str) -> None:
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root)
            try:
                if name.endswith((".db", ".sqlite", ".sqlite3")):
                    scan_sqlite(full)
                    continue
                if os.path.getsize(full) > 40 * 1024 * 1024:
                    continue
                with open(full, "rb") as f:
                    blob = f.read()
                if any(n in blob for n in INTEREST):
                    scan_bytes(blob, rel)
            except Exception:  # noqa: BLE001, S110
                pass


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    target = sys.argv[1]

    if os.path.isdir(target):
        print(f"สแกนโฟลเดอร์ {target}")
        walk_dir(target)
        return

    if target.endswith(".ab"):
        tar_path = target[:-3] + ".tar"
        print(f"แตก {target} → {tar_path}")
        unpack_ab(target, tar_path)
        target = tar_path

    if tarfile.is_tarfile(target):
        out = target + ".extracted"
        print(f"แตก tar → {out}")
        with tarfile.open(target) as tf:
            tf.extractall(out, filter="data")
        walk_dir(out)
        return

    sys.exit("รองรับเฉพาะ .ab / .tar / โฟลเดอร์ที่ pull มา")


if __name__ == "__main__":
    main()
