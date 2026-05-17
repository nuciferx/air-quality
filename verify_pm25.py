"""
Verify PM2.5 readings for all devices — especially the cat room.
Fetches raw property values from Xiaomi API and compares with what the worker returns.
"""
import json
import sys
import os
import time
import base64
import hashlib
import hmac

sys.stdout.reconfigure(encoding='utf-8')

# Try to load from creds.json
CREDS_FILE = os.path.join(os.path.dirname(__file__), "creds.json")
if os.path.exists(CREDS_FILE):
    with open(CREDS_FILE) as f:
        _creds = json.load(f)
    USER_ID = _creds.get("userId") or _creds.get("user_id")
    SERVICE_TOKEN = _creds.get("serviceToken") or _creds.get("service_token")
    SSECURITY = _creds["ssecurity"]
else:
    USER_ID = os.environ.get("XIAOMI_USER_ID")
    SERVICE_TOKEN = os.environ.get("XIAOMI_SERVICE_TOKEN")
    SSECURITY = os.environ.get("XIAOMI_SSECURITY")

if not all([USER_ID, SERVICE_TOKEN, SSECURITY]):
    print("ERROR: No credentials found. Set creds.json or env vars.")
    sys.exit(1)

DEVICES = [
    {"name": "ห้องนอนชั้น 2", "did": "873639853", "host": "sg.api.io.mi.com", "pm25_siid": 9, "pm25_piid": 11},
    {"name": "ห้องทำงานชั้น 2", "did": "460764069", "host": "api.io.mi.com", "pm25_siid": 3, "pm25_piid": 2},
    {"name": "โถงชั้นล่าง", "did": "131590393", "host": "api.io.mi.com", "pm25_siid": 3, "pm25_piid": 2},
    {"name": "ห้องแมวชั้น 2", "did": "357231085", "host": "api.io.mi.com", "pm25_siid": 3, "pm25_piid": 2},
]

ALL_PROPS = [
    {"siid": 2, "piid": 1,  "label": "power"},
    {"siid": 2, "piid": 2,  "label": "mode"},
    {"siid": 2, "piid": 4,  "label": "mode_alt"},
    {"siid": 3, "piid": 1,  "label": "aqi"},
    {"siid": 3, "piid": 2,  "label": "s3p2"},
    {"siid": 3, "piid": 3,  "label": "temp"},
    {"siid": 3, "piid": 4,  "label": "s3p4"},
    {"siid": 3, "piid": 5,  "label": "s3p5"},
    {"siid": 3, "piid": 6,  "label": "s3p6"},
    {"siid": 3, "piid": 7,  "label": "temp_alt"},
    {"siid": 3, "piid": 8,  "label": "s3p8"},
    {"siid": 4, "piid": 1,  "label": "filter"},
    {"siid": 9, "piid": 1,  "label": "s9p1"},
    {"siid": 9, "piid": 2,  "label": "s9p2"},
    {"siid": 9, "piid": 3,  "label": "s9p3"},
    {"siid": 9, "piid": 4,  "label": "s9p4"},
    {"siid": 9, "piid": 10, "label": "s9p10_pm10"},
    {"siid": 9, "piid": 11, "label": "s9p11_pm25"},
    {"siid": 9, "piid": 12, "label": "s9p12"},
    {"siid": 9, "piid": 13, "label": "s9p13"},
]


def generate_nonce():
    nonce = os.urandom(8) + int(time.time() / 60).to_bytes(4, "big")
    return base64.b64encode(nonce).decode()


def signed_nonce(ssec, nonce):
    m = hashlib.sha256()
    m.update(base64.b64decode(ssec.encode("utf-8")))
    m.update(base64.b64decode(nonce))
    return base64.b64encode(m.digest()).decode()


def sign_request(path, data, snonce):
    msg = f"{path}&{snonce}&{data}&{snonce}"
    mac = hmac.new(base64.b64decode(snonce.encode()), msg.encode(), hashlib.sha256)
    return base64.b64encode(mac.digest()).decode()


def fetch_props(did, host, props, country_hint="sg"):
    import requests
    nonce = generate_nonce()
    snonce = signed_nonce(SSECURITY, nonce)
    params_list = [{"did": did, "siid": p["siid"], "piid": p["piid"]} for p in props]
    data = json.dumps({"params": params_list}, separators=(",", ":"))
    path = "/app/miotspec/prop/get"
    url = f"https://{host}{path}"

    r = requests.post(url, data={
        "data": data,
        "_nonce": nonce,
        "signature": sign_request(path, data, snonce),
    }, headers={
        "User-Agent": "APP/com.xiaomi.mihome APPV/6.0.103",
        "x-xiaomi-protocal-flag-cli": "PROTOCAL-HTTP2",
        "Cookie": f"userId={USER_ID}; serviceToken={SERVICE_TOKEN}; locale=th_TH",
    }, timeout=15)

    result = r.json()
    if result.get("code") != 0:
        return None, result.get("message", "unknown error")

    values = {}
    for item in result.get("result", []):
        label = None
        for p in props:
            if p["siid"] == item["siid"] and p["piid"] == item["piid"]:
                label = p["label"]
                break
        if label:
            values[label] = item.get("value") if item.get("code") == 0 else f"ERROR({item.get('code')})"
    return values, None


def check_worker_api():
    """Check what the Cloudflare Worker returns for all devices."""
    import requests
    try:
        r = requests.get("https://air-quality-api.ideaplanstudio.workers.dev/api/devices", timeout=15)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f"Worker API error: {e}")
    return None


print("=" * 70)
print("Xiaomi PM2.5 Verification Tool")
print("=" * 70)

print("\n--- Direct API calls to Xiaomi ---\n")
for dev in DEVICES:
    print(f"📡 {dev['name']} (did={dev['did']}, host={dev['host']})")
    values, err = fetch_props(dev["did"], dev["host"], ALL_PROPS)
    if err:
        print(f"   ❌ Error: {err}")
    else:
        pm25 = values.get("pm25")
        pm25_alt = values.get("pm25_alt")
        hum = values.get("humidity")
        temp = values.get("temp")
        temp_alt = values.get("temp_alt")
        aqi = values.get("aqi")
        print(f"   PM2.5 (siid=3,piid=2): {pm25}")
        if pm25_alt is not None:
            print(f"   PM2.5 (siid=9,piid=11): {pm25_alt}")
        print(f"   AQI: {aqi}")
        print(f"   Temp (siid=3,piid=3): {temp}")
        if temp_alt is not None:
            print(f"   Temp (siid=3,piid=7): {temp_alt}")
        print(f"   Humidity (siid=3,piid=4): {hum}")
        print(f"   All values: {json.dumps(values, ensure_ascii=False)}")
    print()

print("\n--- Cloudflare Worker API ---\n")
worker_data = check_worker_api()
if worker_data:
    for dev in worker_data.get("devices", []):
        print(f"🌐 {dev['name']} (id={dev['id']}, online={dev['online']})")
        vals = dev.get("values", {})
        print(f"   pm25={vals.get('pm25')}, aqi={vals.get('aqi')}, temp={vals.get('temp')}, hum={vals.get('hum')}")
        print(f"   All: {json.dumps(vals, ensure_ascii=False)}")
        print()
else:
    print("   Could not reach worker API")

print("=" * 70)
print("Done")
