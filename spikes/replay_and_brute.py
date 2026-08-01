"""
(1) Replay the device-info / plugin-config endpoints the Mi Home app used, with
    OUR session (so we can decrypt the response), hunting for wifi_sn / map key.
(2) Brute the ijai inner-key model-tail with wifi_sn="" against the real map,
    using zlib.decompress as oracle.
"""
import base64, hashlib, json, zlib, itertools
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
import mi_sign

DID = "1191295215"; OWNER = "1812498495"; MAC = "bc:09:b9:dc:29:95"
MODEL = "xiaomi.vacuum.ov71gl"
HOST = "us.api.io.mi.com"; CORE = "us.core.api.io.mi.com"

print("=" * 60, "\n(1) REPLAY endpoints with our session\n", "=" * 60)
for host, path, payload in [
    (CORE, "/app/device/deviceinfo", {"did": DID}),
    (CORE, "/app/v2/plugin/get_config_info_new", {"did": DID, "model": MODEL}),
    (HOST, "/app/v2/device/get_extra_data", {"did": DID}),
    (CORE, "/app/v2/home/local_device_list", {"did": DID}),
]:
    try:
        res = mi_sign.call(host, path, payload)
        blob = json.dumps(res, ensure_ascii=False)
        hits = [k for k in ("wifi_sn", "wifiInfoSn", "wifi_info_sn", "wifiSn", "sn",
                            "mapKey", "map_key", "encryptKey", "key") if k.lower() in blob.lower()]
        print(f"\n{path}  code={res.get('code')}  interesting_keys={hits}")
        print(blob[:1200])
    except Exception as e:
        print(f"\n{path} -> ERR {type(e).__name__}: {str(e)[:120]}")

print("\n" + "=" * 60, "\n(2) BRUTE model-tail (wifi_sn='') vs real map\n", "=" * 60)
ct = base64.b64decode(json.load(open("map_fresh.json"))["data"])
pj = "".join(MAC.lower().split(":"))            # bc09b9dc2995  (12 chars)

def final_key_hex(inner: str, wifi_sn=""):
    joined = "+".join([wifi_sn, OWNER, DID]).encode()
    aesk = base64.b64encode(AES.new(inner.encode(), AES.MODE_ECB).encrypt(pad(joined, 16, "pkcs7"))).decode()
    return hashlib.md5(aesk.encode()).hexdigest()

def works(inner, wifi_sn=""):
    try:
        key = bytes.fromhex(final_key_hex(inner, wifi_sn))
        pt = unpad(AES.new(key, AES.MODE_ECB).decrypt(ct), 16, "pkcs7")
        return zlib.decompress(bytes.fromhex(pt.decode("utf-8")))
    except Exception:
        return None

# candidate 4-char tails (inner = pj + tail = 16 bytes)
tail = MODEL.split(".")[-1]    # ov71gl
tails = {tail[-4:], tail[:4], "ov71", "v71g", "71gl", "71GL", "OV71",
         tail[-2:].rjust(4, "0"), tail[-3:].rjust(4, "0"), "00" + tail[-2:]}
# also try inner = pj + full tail truncated/padded to 16 via the device-mac-only & model-only forms
inner_cands = {pj + t for t in tails}
inner_cands |= {(pj + tail)[:16], (pj + tail).ljust(16, "0")[:16]}
inner_cands |= {pj[:16], (pj + "0000")[:16]}

found = None
for inner in sorted(inner_cands):
    if len(inner) != 16:
        continue
    r = works(inner)
    print(f"  inner={inner!r:20} -> {'ZLIB OK %d' % len(r) if r else 'fail'}")
    if r:
        found = (inner, r); break

# also brute wifi_sn empty across a couple tails with brute 4-char alnum tail (cheap-ish: 36^4 too big;
# restrict to model-derived only above). If none, report.
if found:
    open("map_decoded.bin", "wb").write(found[1])
    print(f"\n*** MATCH inner_key={found[0]!r} wifi_sn='' -> map_decoded.bin ({len(found[1])}B) ***")
else:
    print("\nNo model-tail variant decrypts with wifi_sn='' -> key needs a real wifi_sn (app-side)")
