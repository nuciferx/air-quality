"""
Probe device_list for the S40 Pro vacuum (did 1191295215) using the RC4-drop1024
encrypted signing scheme (the one Mi Home uses for /app/home/device_list).
Goal: extract the LOCAL miIO token + localip + any field carrying wifi_sn, so we
can talk to the robot over LAN (python-miio) and finally unlock map decryption.

Read-only. Signing reimplemented per the standard Mi Home enc-rc4 flow
(same as PiotrMachowski/Xiaomi-cloud-tokens-extractor).
"""
import base64, hashlib, json, os, sys, time, requests
from Crypto.Cipher import ARC4

CREDS = json.load(open(os.path.join(os.path.dirname(__file__), "..", "creds.json")))
USER_ID = str(CREDS.get("userId") or CREDS.get("user_id"))
SERVICE_TOKEN = CREDS.get("serviceToken") or CREDS.get("service_token")
SSECURITY = CREDS["ssecurity"]
TARGET_DID = "1191295215"
# device lives on US; try a few regions in case device_list is region-scoped
HOSTS = {"us": "us.api.io.mi.com", "cn": "api.io.mi.com", "sg": "sg.api.io.mi.com"}


def gen_nonce():
    millis = int(time.time() * 1000)
    return base64.b64encode(os.urandom(8) + (millis // 60000).to_bytes(4, "big")).decode()


def signed_nonce(nonce):
    m = hashlib.sha256()
    m.update(base64.b64decode(SSECURITY))
    m.update(base64.b64decode(nonce))
    return base64.b64encode(m.digest()).decode()


def enc_signature(url, method, snonce, params):
    parts = [method.upper(), url.split("com")[1].replace("/app/", "/")]
    for k, v in params.items():
        parts.append(f"{k}={v}")
    parts.append(snonce)
    return base64.b64encode(hashlib.sha1("&".join(parts).encode()).digest()).decode()


def rc4(password_b64, data_bytes):
    c = ARC4.new(base64.b64decode(password_b64))
    c.encrypt(bytes(1024))  # drop first 1024
    return c.encrypt(data_bytes)


def enc_params(url, method, snonce, nonce, params):
    params["rc4_hash__"] = enc_signature(url, method, snonce, params)
    for k, v in params.items():
        params[k] = base64.b64encode(rc4(snonce, v.encode())).decode()
    params.update({"_nonce": nonce, "ssecurity": SSECURITY,
                   "signature": enc_signature(url, method, snonce, params)})
    return params


def device_list(host):
    url = f"https://{host}/app/home/device_list"
    nonce = gen_nonce()
    snonce = signed_nonce(nonce)
    params = {"data": json.dumps({"getVirtualModel": False, "getHuamiDevices": 0},
                                 separators=(",", ":"))}
    params = enc_params(url, "POST", snonce, nonce, params)
    r = requests.post(url, data=params, headers={
        "User-Agent": "Android-7.1.1-1.0.0-ONEPLUS A3010-136-XXXXXX APP/xiaomi.smarthome APPV/62830",
        "Accept-Encoding": "identity",
        "Content-Type": "application/x-www-form-urlencoded",
        "x-xiaomi-protocal-flag-cli": "PROTOCAL-HTTP2",
        "MIOT-ENCRYPT-ALGORITHM": "ENCRYPT-RC4",
    }, cookies={"userId": USER_ID, "serviceToken": SERVICE_TOKEN, "locale": "th_TH"}, timeout=20)
    decrypted = rc4(snonce, base64.b64decode(r.content))
    return json.loads(decrypted)


for region, host in HOSTS.items():
    try:
        res = device_list(host)
    except Exception as e:
        print(f"[{region}] {host} -> EXC {e}")
        continue
    lst = res.get("result", {}).get("list", []) if isinstance(res.get("result"), dict) else []
    dids = [d.get("did") for d in lst]
    print(f"[{region}] code={res.get('code')} msg={res.get('message')} n_devices={len(lst)}")
    for d in lst:
        if d.get("did") == TARGET_DID:
            print(f"\n=== ROBOT FOUND on region '{region}' ===")
            print(json.dumps(d, ensure_ascii=False, indent=2))
            print("\n=== KEY FIELDS ===")
            for k in ("did", "token", "localip", "mac", "ssid", "bssid", "model", "name", "extra"):
                print(f"  {k}: {d.get(k)}")
            sys.exit(0)
print("\nrobot not found in any region")
