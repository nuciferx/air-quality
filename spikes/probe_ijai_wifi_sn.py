"""
Find the correct wifi_sn for ijai/3irobotix map decryption when the HA hard-coded
property (siid=7, piid=45) does NOT exist on your model (e.g. ov71gl / S40 Pro
returns -704040002 for 7/45).

Background
----------
The HA ijai extractor builds the AES key from:
    joined  = wifi_sn + "+" + owner_id + "+" + device_id
    inner   = mac(no colons, lower) + model_tail4         # "bc09b9dc2995" + "71gl"
    key_hex = md5( base64( AES-ECB(joined, inner) ) )
It obtains wifi_sn by calling ONE MIoT property that returns a long
COMMA-JOINED "common-params" status string, then taking field[11][:18].

On ijai.vacuum.v3 that string lived at service 7 / piid 45.
ov71gl has NO service 7. Its comma-joined "common-params" strings live at
(verified from the ov71gl MIoT spec):
    2/24  common-params
    10/8  common-params   <-- under the "Vacuum Map" service: most likely the map one
    15/6  common-params
    20/1  common-params   (Custom)
Other promising string props: 1/3 serial-number, 1/5 serial-no, 2/40
current-cleaning-config, 2/66 fault-ids, 10/4 vacuum-position.

Strategy
--------
We don't know which property, nor which comma-index, holds wifi_sn on ov71gl.
So: pull every candidate string property, then BRUTE-FORCE every comma-field
(and a few whole-string / serial fallbacks) as wifi_sn until zlib.decompress
succeeds on the real map. The field that decrypts is the answer.

This file is a TEMPLATE: plug your existing signed MiCloud request function into
`miot_get_props()` (you said you have a live token + signing script). Everything
else is ready.
"""

import base64
import hashlib
import zlib
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad

# ============================================================ FILL THESE IN
DID        = "1191295215"
MODEL      = "xiaomi.vacuum.ov71gl"
DEVICE_MAC = "bc:09:b9:dc:29:95"
OWNER_ID   = "1812498495"
HOST       = "cn"   # or "sg" — wherever this device lives

# The map file you already downloaded: {"version":2,"data":"<base64>"}
MAP_JSON_PATH = "map.json"   # path to the saved cloud map json

# Candidate (siid, piid) string properties to dump from the device.
# Order roughly by likelihood for ov71gl.
CANDIDATE_PROPS = [
    (10, 8),   # Vacuum-Map service common-params  <-- best bet
    (2, 24),   # Vacuum common-params
    (20, 1),   # Custom common-params
    (15, 6),   # Voice common-params
    (2, 40),   # current-cleaning-config
    (2, 66),   # fault-ids
    (10, 4),   # vacuum-position
    (1, 3),    # serial-number
    (1, 5),    # serial-no
    (2, 1),    # vacuum-frameware-version
    (10, 3),   # clean-record
    (7, 45),   # the original HA prop (will likely error on ov71gl, kept for completeness)
]


# ====================================================== KEY DERIVATION (verified)
def gen_key_hex(wifi_sn, owner_id, device_id, model, device_mac):
    pjstr = "".join(device_mac.lower().split(":"))
    tail = model.split(".")[-1]
    if len(tail) == 2:   tail = "00" + tail
    elif len(tail) == 3: tail = "0" + tail
    elif len(tail) > 4:  tail = tail[-4:]
    inner = pjstr + tail
    joined = "+".join([wifi_sn or "", owner_id or "", device_id or ""])
    cipher = AES.new(inner.encode(), AES.MODE_ECB)
    aeskey_b64 = base64.b64encode(
        cipher.encrypt(pad(joined.encode(), AES.block_size, "pkcs7"))).decode()
    return hashlib.md5(aeskey_b64.encode()).hexdigest()


def try_decrypt(data_b64, wifi_sn):
    """Return decompressed protobuf bytes if wifi_sn is correct, else None."""
    try:
        key = bytes.fromhex(gen_key_hex(wifi_sn, OWNER_ID, DID, MODEL, DEVICE_MAC))
        ct = base64.b64decode(data_b64)
        pt = unpad(AES.new(key, AES.MODE_ECB).decrypt(ct), AES.block_size, "pkcs7")
        zstream = bytes.fromhex(pt.decode("utf-8"))
        return zlib.decompress(zstream)
    except Exception:
        return None


# ============================================================ MIoT FETCH (YOU WIRE)
def miot_get_props(did, props):
    """
    props = [(siid, piid), ...]  ->  return {(siid,piid): value_or_None}

    Implement using YOUR live signed MiCloud call. The endpoint is:
       POST {api_base}/miotspec/prop/get
       data = {"params":[{"did": did, "siid": s, "piid": p}, ...]}
    Response: {"result":[{"did":..,"siid":s,"piid":p,"code":0,"value":<...>}, ...]}
    Keep only entries with code==0; map (siid,piid)->value.

    >>> Paste your signing/request code where marked. <<<
    """
    raise NotImplementedError(
        "Wire this to your signed MiCloud /miotspec/prop/get call. "
        "Request one (siid,piid) at a time (some firmwares reject batches), "
        "skip any with code != 0.")


# ============================================================ MAIN
def main():
    import json
    raw = json.load(open(MAP_JSON_PATH, "r", encoding="utf-8"))
    data_b64 = raw["data"]

    print("Fetching candidate string properties from device...")
    values = miot_get_props(DID, CANDIDATE_PROPS)

    # Build the universe of wifi_sn candidates.
    candidates = []   # (label, wifi_sn)
    for (s, p), val in values.items():
        if val is None:
            continue
        sval = str(val).replace('"', "")
        print(f"  {s}/{p} = {sval!r}")
        # whole value, first 18, and EVERY comma-field (raw + [:18])
        candidates.append((f"{s}/{p} whole", sval))
        candidates.append((f"{s}/{p} whole[:18]", sval[:18]))
        if "," in sval:
            for i, field in enumerate(sval.split(",")):
                f = field.replace('"', "")
                candidates.append((f"{s}/{p} field[{i}]", f))
                candidates.append((f"{s}/{p} field[{i}][:18]", f[:18]))

    # Always also try the empty-string fallback (some firmwares ship blank wifi_sn).
    candidates.append(("EMPTY", ""))

    print(f"\nBrute-forcing {len(candidates)} wifi_sn candidates against the map...")
    for label, wsn in candidates:
        proto = try_decrypt(data_b64, wsn)
        if proto is not None:
            print("\n=== MATCH ===")
            print(f"  source     : {label}")
            print(f"  wifi_sn    : {wsn!r}")
            print(f"  key_hex    : {gen_key_hex(wsn, OWNER_ID, DID, MODEL, DEVICE_MAC)}")
            print(f"  proto bytes: {len(proto)} (zlib OK)")
            return wsn
    print("\nNo candidate decrypted the map. Next steps:")
    print("  - Dump MORE properties (try every string-typed piid on services 1,2,10,20).")
    print("  - Also probe legacy miIO: {'method':'get_prop','params':['wifi_sn']} or")
    print("    {'method':'miIO.info'} (field 'ap.ssid'/'netif'/'wifi_sn').")
    print("  - Verify mac is the device's own mac (device_list.mac), not router BSSID.")
    return None


if __name__ == "__main__":
    main()
