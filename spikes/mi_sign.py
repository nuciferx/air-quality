"""
Reusable Mi Home cloud signing (RC4-drop1024 / ENCRYPT-RC4 scheme).
Used to call /app/home/device_list and /app/v2/home/get_interim_file_url_pro
for the S40 Pro vacuum map spike. Read-only against the cloud.
"""
import base64, hashlib, json, os, time, requests
from Crypto.Cipher import ARC4

_CREDS = json.load(open(os.path.join(os.path.dirname(__file__), "..", "creds.json")))
USER_ID = str(_CREDS.get("userId") or _CREDS.get("user_id"))
SERVICE_TOKEN = _CREDS.get("serviceToken") or _CREDS.get("service_token")
SSECURITY = _CREDS["ssecurity"]


def _nonce():
    millis = int(time.time() * 1000)
    return base64.b64encode(os.urandom(8) + (millis // 60000).to_bytes(4, "big")).decode()


def _signed_nonce(nonce):
    m = hashlib.sha256()
    m.update(base64.b64decode(SSECURITY))
    m.update(base64.b64decode(nonce))
    return base64.b64encode(m.digest()).decode()


def _enc_sig(url, method, snonce, params):
    parts = [method.upper(), url.split("com")[1].replace("/app/", "/")]
    for k, v in params.items():
        parts.append(f"{k}={v}")
    parts.append(snonce)
    return base64.b64encode(hashlib.sha1("&".join(parts).encode()).digest()).decode()


def _rc4(password_b64, data_bytes):
    c = ARC4.new(base64.b64decode(password_b64))
    c.encrypt(bytes(1024))
    return c.encrypt(data_bytes)


def call(host, path, payload):
    """POST an encrypted Mi Home API call, return decrypted JSON dict."""
    url = f"https://{host}{path}"
    nonce = _nonce()
    snonce = _signed_nonce(nonce)
    params = {"data": json.dumps(payload, separators=(",", ":"))}
    params["rc4_hash__"] = _enc_sig(url, "POST", snonce, params)
    for k, v in params.items():
        params[k] = base64.b64encode(_rc4(snonce, v.encode())).decode()
    params.update({"_nonce": nonce, "ssecurity": SSECURITY,
                   "signature": _enc_sig(url, "POST", snonce, params)})
    r = requests.post(url, data=params, headers={
        "User-Agent": "Android-7.1.1-1.0.0-ONEPLUS A3010-136-XXXXXX APP/xiaomi.smarthome APPV/62830",
        "Accept-Encoding": "identity",
        "Content-Type": "application/x-www-form-urlencoded",
        "x-xiaomi-protocal-flag-cli": "PROTOCAL-HTTP2",
        "MIOT-ENCRYPT-ALGORITHM": "ENCRYPT-RC4",
    }, cookies={"userId": USER_ID, "serviceToken": SERVICE_TOKEN, "locale": "th_TH"}, timeout=20)
    return json.loads(_rc4(snonce, base64.b64decode(r.content)))
