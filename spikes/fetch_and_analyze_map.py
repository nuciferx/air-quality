"""
Fetch a FRESH map for the S40 Pro (ov71gl) and forensically analyze the
ciphertext, then test the documented ijai AES-wifi_sn pipeline end-to-end with
every plausible wifi_sn candidate. Goal: confirm or refute that version:2 / ov71gl
maps use the AES-128-ECB(wifi_sn-derived) scheme at all.

Pipeline order:
  LAN miIO  S10.P1 map_obj_name  ->  obj_name
  cloud     /app/v2/home/get_interim_file_url_pro {obj_name}  ->  presigned url
  GET url   ->  {"version":2,"data":"<base64>"}
  analyze + brute decrypt
"""
import base64, hashlib, json, os, sys, zlib, collections, math
import requests
from miio import Device
import mi_sign

IP = "192.168.1.191"
TOKEN = os.environ["VACUUM_LOCAL_TOKEN"]     # export before running
DID = "1191295215"
MODEL = "xiaomi.vacuum.ov71gl"
MAC = "bc:09:b9:dc:29:95"
OWNER = "1812498495"
HOST = "us.api.io.mi.com"

# ---- 1) map_obj_name via LAN ----
dev = Device(IP, TOKEN)
props = dev.send("get_properties", [{"did": DID, "siid": 10, "piid": 1}])
print("S10.P1 map_obj_name raw:", json.dumps(props, ensure_ascii=False))
raw = props[0].get("value")
obj_name = json.loads(raw)["obj_name"] if raw else None
print("obj_name:", obj_name)
if not obj_name:
    print("no obj_name — robot may have no live map; trigger a clean/map first"); sys.exit(1)

# ---- 2) presigned url via cloud (the _pro variant) ----
res = mi_sign.call(HOST, "/app/v2/home/get_interim_file_url_pro", {"obj_name": obj_name})
print("get_interim_file_url_pro:", res.get("code"), res.get("message"))
url = res.get("result", {}).get("url")
if not url:
    print("no url:", json.dumps(res, ensure_ascii=False)[:400]); sys.exit(1)

# ---- 3) download map json ----
mj = requests.get(url, timeout=20).json()
json.dump(mj, open("map_fresh.json", "w"))
data_b64 = mj["data"]
ct = base64.b64decode(data_b64)
print(f"\nmap version={mj.get('version')} ciphertext={len(ct)} bytes (b64 {len(data_b64)})")
print("first 32 bytes hex:", ct[:32].hex())
# entropy — encrypted data ~7.9+, plaintext/zlib lower in header
freq = collections.Counter(ct)
ent = -sum((c/len(ct))*math.log2(c/len(ct)) for c in freq.values())
print(f"Shannon entropy: {ent:.3f} bits/byte (AES ct ~7.99; raw zlib ~7.9; plain <6)")
print("len % 16 ==", len(ct) % 16, "(AES-ECB needs 0)")
print("starts with zlib magic 0x78?", ct[:1].hex() == "78")

# ---- 4) brute the AES-wifi_sn pipeline ----
def gen_key_hex(wifi_sn):
    pj = "".join(MAC.lower().split(":"))
    tail = MODEL.split(".")[-1][-4:]
    inner = (pj + tail).encode()
    joined = "+".join([wifi_sn or "", OWNER, DID]).encode()
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import pad
    aesk = base64.b64encode(AES.new(inner, AES.MODE_ECB).encrypt(pad(joined, 16, "pkcs7"))).decode()
    return hashlib.md5(aesk.encode()).hexdigest()

def try_decrypt(wifi_sn):
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import unpad
    try:
        key = bytes.fromhex(gen_key_hex(wifi_sn))
        pt = unpad(AES.new(key, AES.MODE_ECB).decrypt(ct), 16, "pkcs7")
        z = bytes.fromhex(pt.decode("utf-8"))
        return zlib.decompress(z)
    except Exception as e:
        return None

# candidates: empty, device serial fragments, known strings
SERIAL = "67955/B2AE7F6NP05382"
cands = ["", SERIAL, SERIAL.split("/")[1], SERIAL.split("/")[1][:18],
         SERIAL.replace("/", ""), "Qif2QUEzXIClbZKR", MAC.replace(":", ""),
         "NONE.2.4G"]
print("\n--- brute AES-wifi_sn pipeline ---")
hit = None
for w in cands:
    r = try_decrypt(w)
    print(f"  wifi_sn={w!r:30} -> {'ZLIB OK len=%d' % len(r) if r else 'fail'}")
    if r:
        hit = (w, r); break
if hit:
    open("map_decoded.bin", "wb").write(hit[1])
    print(f"\n*** MATCH wifi_sn={hit[0]!r} -> map_decoded.bin ***")
else:
    print("\nNo wifi_sn candidate decrypts -> scheme is NOT plain AES-wifi_sn for this map")
