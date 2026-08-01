"""
Exhaustive-ish brute of the ov71gl map key using the DEVICE TOKEN as a seed.
The local token decodes to exactly 16 ASCII chars -> a natural AES-128 key/inner-key.
Test against the real downloaded map; oracle = zlib.decompress succeeds.
"""
import base64, hashlib, json, zlib, os
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad

DID = "1191295215"; OWNER = "1812498495"; MAC = "bc:09:b9:dc:29:95"
MODEL = "xiaomi.vacuum.ov71gl"
TOKEN_HEX = os.environ["VACUUM_LOCAL_TOKEN"]               # 32 hex
TOKEN_BYTES = bytes.fromhex(TOKEN_HEX)                     # 16 bytes
TOKEN_ASCII = TOKEN_BYTES.decode("latin1")                # "Qif2QUEzXIClbZKR"
SERIAL = "67955/B2AE7F6NP05382"
pj = "".join(MAC.lower().split(":"))

ct = base64.b64decode(json.load(open("map_fresh.json"))["data"])


def oracle(pt_bytes):
    """pt_bytes is the AES plaintext; ijai expects ascii-hex -> zlib. Also try raw zlib."""
    try:
        return zlib.decompress(bytes.fromhex(pt_bytes.decode("utf-8")))
    except Exception:
        pass
    try:
        return zlib.decompress(pt_bytes)        # in case no hex layer
    except Exception:
        return None


def aes_ecb_try(key16):
    if len(key16) != 16:
        return None
    try:
        pt = unpad(AES.new(key16, AES.MODE_ECB).decrypt(ct), 16, "pkcs7")
    except Exception:
        try:
            pt = AES.new(key16, AES.MODE_ECB).decrypt(ct)   # no padding
        except Exception:
            return None
    return oracle(pt)


def md5_hex(s):
    return hashlib.md5(s.encode() if isinstance(s, str) else s).hexdigest()


def ijai_key(wifi_sn, inner):
    """final 16-byte key = bytes.fromhex(md5( base64( AES-ECB(joined, inner) ) ))"""
    joined = "+".join([wifi_sn, OWNER, DID]).encode()
    aesk = base64.b64encode(AES.new(inner.encode() if isinstance(inner, str) else inner,
                                    AES.MODE_ECB).encrypt(pad(joined, 16, "pkcs7"))).decode()
    return bytes.fromhex(md5_hex(aesk))


# ---- direct AES-key candidates (key fed straight to AES-ECB(map)) ----
direct = {
    "token_bytes": TOKEN_BYTES,
    "token_ascii": TOKEN_ASCII.encode(),
    "md5(token_hex)": bytes.fromhex(md5_hex(TOKEN_HEX)),
    "md5(token_ascii)": bytes.fromhex(md5_hex(TOKEN_ASCII)),
    "md5(token_bytes)": bytes.fromhex(md5_hex(TOKEN_BYTES)),
    "md5(serial)": bytes.fromhex(md5_hex(SERIAL)),
    "md5(did)": bytes.fromhex(md5_hex(DID)),
    "md5(mac)": bytes.fromhex(md5_hex(pj)),
}
print("--- direct AES-128-ECB key candidates ---")
hit = None
for name, k in direct.items():
    r = aes_ecb_try(k)
    print(f"  {name:18} -> {'ZLIB OK %d' % len(r) if r else 'fail'}")
    if r: hit = (name, r); break

# ---- ijai-scheme with token as inner_key, various wifi_sn ----
if not hit:
    print("--- ijai scheme: inner_key in {token, mac+tail}, wifi_sn in {set} ---")
    inners = {TOKEN_ASCII, TOKEN_BYTES.hex()[:16], pj + "71gl", pj + "ov71",
              TOKEN_HEX[:16], TOKEN_HEX[-16:]}
    inners = {i for i in inners if len(i) == 16}
    wifis = ["", TOKEN_ASCII, TOKEN_HEX, SERIAL, SERIAL.split("/")[1], DID]
    for inner in sorted(inners):
        for w in wifis:
            try:
                r = aes_ecb_try(ijai_key(w, inner))
            except Exception:
                r = None
            if r:
                hit = (f"ijai inner={inner!r} wifi_sn={w!r}", r); break
            print(f"  inner={inner!r:18} wifi={w[:12]!r:14} -> {'OK' if r else 'fail'}")
        if hit: break

if hit:
    open("map_decoded.bin", "wb").write(hit[1])
    print(f"\n*** MATCH {hit[0]} -> map_decoded.bin ({len(hit[1])}B) ***")
else:
    print("\nNo token-seeded key decrypts the map.")
