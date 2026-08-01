"""
LAN miIO probe for the S40 Pro (ov71gl) to find wifi_sn for map decryption.
Talks DIRECTLY to the robot at its localip (no cloud relay), so methods that
returned 'user ack timeout' via cloud may now answer.
"""
import json
from miio import Device

IP = "192.168.1.191"
# Local miIO token — pulled fresh via probe_vacuum_token.py (device_list .token field).
# Do NOT commit a real value; read from env so this file stays secret-free.
import os
TOKEN = os.environ.get("VACUUM_LOCAL_TOKEN", "")  # export VACUUM_LOCAL_TOKEN=<32hex>
DID = "1191295215"
assert len(TOKEN) == 32, "set VACUUM_LOCAL_TOKEN=<32-hex local token> (see probe_vacuum_token.py)"

dev = Device(IP, TOKEN)


def show(label, fn):
    try:
        print(f"\n### {label}")
        print(json.dumps(fn(), ensure_ascii=False, indent=2)[:2000])
    except Exception as e:
        print(f"   ERR: {type(e).__name__}: {str(e)[:160]}")


# 1) miIO.info — handshake + device info
show("miIO.info", lambda: dev.send("miIO.info"))

# 2) MIoT get_properties for all comma-joined 'common-params' candidates
CANDS = [(2, 24), (10, 8), (15, 6), (20, 1), (2, 40), (2, 66),
         (10, 4), (1, 3), (1, 5), (2, 1), (7, 45)]
params = [{"did": DID, "siid": s, "piid": p} for s, p in CANDS]
show("get_properties (common-params candidates)",
     lambda: dev.send("get_properties", params))

# 3) Legacy get_prop calls (vendor-specific, often LAN-only)
for key in (["wifi_sn"], ["sn"], ["serial_number"], ["device_sn"], ["S/N"]):
    show(f"get_prop {key}", lambda k=key: dev.send("get_prop", k))

for m in ("get_serial_number", "get_sn", "get_device_sn", "get_network_info",
          "get_wifi_status", "get_status"):
    show(m, lambda m=m: dev.send(m))
