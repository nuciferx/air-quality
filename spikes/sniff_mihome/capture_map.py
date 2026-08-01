"""
mitmproxy addon — capture Mi Home / 3irobotix traffic relevant to the S40 Pro
(ov71gl) map, to recover the decryption key / wifi_sn that cloud+LAN don't expose.

Run:
    mitmproxy -s spikes/sniff_mihome/capture_map.py
    # or headless:
    mitmdump  -s spikes/sniff_mihome/capture_map.py

Then on the phone (same proxy), open Mi Home -> the vacuum -> the live MAP view,
pan/zoom, start a clean. Interesting flows are flagged [HIT] and the full
request+response is appended to spikes/sniff_mihome/captured.log.

Look in captured.log for any of: wifi_sn, a 32-hex key, mapKey, encryptKey,
obj_name, get_interim_file_url, or a 3irobotix host returning the decoded map.
"""
import os, json, base64, hashlib
from urllib.parse import parse_qs
from mitmproxy import http
from Crypto.Cipher import ARC4

DID = "1191295215"
OUT = os.path.join(os.path.dirname(__file__), "captured.log")

# --- RC4 decryption of Mi Home ENCRYPT-RC4 bodies (we have ssecurity) ---
_CREDS = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "creds.json")))
SSECURITY = _CREDS["ssecurity"]


def _signed_nonce(nonce_b64: str) -> str:
    m = hashlib.sha256()
    m.update(base64.b64decode(SSECURITY))
    m.update(base64.b64decode(nonce_b64))
    return base64.b64encode(m.digest()).decode()


def _rc4(pw_b64: str, data: bytes) -> bytes:
    c = ARC4.new(base64.b64decode(pw_b64))
    c.encrypt(bytes(1024))
    return c.encrypt(data)


def _decrypt_flow(flow: http.HTTPFlow):
    """Return (decrypted_request_data, decrypted_response_text) or (None, None)."""
    try:
        form = parse_qs(flow.request.get_text(strict=False) or "")
        nonce = form.get("_nonce", [None])[0]
        if not nonce:
            return None, None
        sn = _signed_nonce(nonce)
        req_data = form.get("data", [None])[0]
        dreq = _rc4(sn, base64.b64decode(req_data)).decode("utf-8", "replace") if req_data else None
        dresp = None
        if flow.response and flow.response.content:
            dresp = _rc4(sn, base64.b64decode(flow.response.content)).decode("utf-8", "replace")
        return dreq, dresp
    except Exception as e:
        return f"(decrypt err: {e})", None
# substrings that make a flow interesting
NEEDLES = [
    DID, "1812498495",                 # did / owner
    "wifi_sn", "wifi_info_sn", "wifisn",
    "map_obj_name", "obj_name", "interim_file", "get_interim",
    "mapkey", "map_key", "encryptkey", "encrypt_key", "decryptkey",
    "3irobot", "ijai", "ov71gl", "rrmapfile", "RobotMap",
]
HOST_HINTS = ["io.mi.com", "3irobot", "3irobotic", "miot", "mijia"]


def _interesting(flow: http.HTTPFlow) -> bool:
    host = flow.request.pretty_host.lower()
    if any(h in host for h in HOST_HINTS):
        return True
    blob = (flow.request.pretty_url + " " +
            (flow.request.get_text(strict=False) or "")).lower()
    return any(n in blob for n in NEEDLES)


def response(flow: http.HTTPFlow) -> None:
    host = flow.request.pretty_host.lower()
    is_mi = "io.mi.com" in host
    dreq = dresp = None
    if is_mi:
        dreq, dresp = _decrypt_flow(flow)   # RC4-decrypt with ssecurity

    # decide interest using DECRYPTED text when available
    raw_resp = flow.response.get_text(strict=False) or ""
    search_blob = (flow.request.pretty_url + " " + (dreq or "") + " " +
                   (dresp or raw_resp)).lower()
    interesting = (any(h in host for h in HOST_HINTS) or
                   any(n in search_blob for n in NEEDLES))
    if not interesting:
        return

    hot = [n for n in NEEDLES if n in search_blob]
    # extra-loud flag if a wifi_sn-ish token shows up in decrypted content
    wifi_hot = any(k in (dreq or "")+(dresp or "") for k in ("wifi_sn", "wifiInfoSn", "wifi_info_sn", "wifiSn"))
    tag = "WIFI!" if wifi_hot else ("HIT" if hot else "host")
    body_out = dresp if dresp is not None else raw_resp
    req_out = dreq if dreq is not None else (flow.request.get_text(strict=False) or "")
    line = (
        f"\n===== [{tag}] {flow.request.method} {flow.request.pretty_url}\n"
        f"matched: {hot}  (decrypted={is_mi})\n"
        f"--- req (decrypted) ---\n{req_out[:4000]}\n"
        f"--- resp status {flow.response.status_code} (decrypted) ---\n{body_out[:12000]}\n"
    )
    with open(OUT, "a", encoding="utf-8") as f:
        f.write(line)
    print(f"[{tag}] {flow.request.pretty_host}  matched={hot}")
