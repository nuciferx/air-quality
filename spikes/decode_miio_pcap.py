"""
Decode the captured miIO LAN pcap (UDP 54321) using the device token.
Reading a pcap file needs no socket/promisc, so this runs WITHOUT sudo.

    VACUUM_LOCAL_TOKEN=<32hex> spikes/.miio-venv/bin/python spikes/decode_miio_pcap.py [pcap]
"""
import os, sys, json
from scapy.all import rdpcap, UDP, IP, Raw
from miio.protocol import Message

PCAP = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "miio_lan.pcap")
TOKEN = bytes.fromhex(os.environ["VACUUM_LOCAL_TOKEN"])
ROBOT = "192.168.1.191"
OUT = os.path.join(os.path.dirname(__file__), "miio_lan_decoded.log")

pkts = rdpcap(PCAP)
print(f"[*] {len(pkts)} packets in {os.path.basename(PCAP)}")
out = open(OUT, "w", encoding="utf-8")
shown = 0
for p in pkts:
    if not (p.haslayer(UDP) and p.haslayer(Raw)):
        continue
    raw = bytes(p[Raw].load)
    if len(raw) < 32 or raw[:2] != b"\x21\x31":
        continue
    src = p[IP].src
    arrow = "ROBOT->APP" if src == ROBOT else "APP->ROBOT"
    try:
        m = Message.parse(raw, token=TOKEN)
        val = m.data.value
        if not val:
            continue  # hello/keepalive, no body
        txt = val.decode("utf-8", "replace") if isinstance(val, (bytes, bytearray)) else json.dumps(val, ensure_ascii=False)
    except Exception as e:
        txt = f"(decrypt fail: {e}) hdr={raw[:32].hex()}"
    low = txt.lower()
    flag = " <<< wifi/key!" if any(k in low for k in ("wifi", "sn", "mapkey", "map_key", "encrypt", "secret", "key")) else ""
    line = f"[{arrow}]{flag} {txt}"
    print(line[:600] + ("…" if len(line) > 600 else "") + "\n")
    out.write(line + "\n")
    shown += 1
out.close()
print(f"[*] {shown} decoded miIO bodies -> {OUT}")
if shown == 0:
    print("[!] zero LAN miIO bodies -> the app likely talks to the robot via CLOUD RELAY, not LAN.")
