"""
Auto-renew Xiaomi credentials using passToken — no 2FA required.

passToken is a long-lived token that bypasses password + 2FA.
Store it as XIAOMI_PASS_TOKEN in GitHub Secrets.

Env vars required:
  XIAOMI_PASS_TOKEN  — passToken from Xiaomi account (long-lived)
  XIAOMI_USER_ID     — numeric user id
  WORKER_URL         — Worker URL (e.g. https://air-quality-api.ideaplanstudio.workers.dev)
  WORKER_SECRET      — LOG_SECRET value
  TELEGRAM_BOT_TOKEN — (optional)
  TELEGRAM_CHAT_ID   — (optional)
"""
import base64, hashlib, hmac, json, os, re, sys, time, requests
sys.stdout.reconfigure(encoding="utf-8")

PASS_TOKEN    = os.environ.get("XIAOMI_PASS_TOKEN")
USER_ID       = os.environ.get("XIAOMI_USER_ID", "1812498495")
EMAIL         = os.environ.get("XIAOMI_EMAIL", "nuciferx@gmail.com")
WORKER_URL    = os.environ.get("WORKER_URL", "").rstrip("/")
WORKER_SECRET = os.environ.get("WORKER_SECRET")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID")


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def telegram(msg):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": msg, "parse_mode": "HTML"},
            timeout=10,
        )
        log(f"Telegram: {r.status_code}")
    except Exception as e:
        log(f"Telegram error: {e}")


def clean(val):
    if not val:
        return val
    m = re.search(r"[A-Za-z0-9+/=:_\-]", val)
    return val[m.start():] if m else val


def login_with_passtoken(pass_token, user_id):
    pass_token = clean(pass_token)
    user_id    = clean(user_id) if user_id else user_id

    s = requests.Session()
    s.headers.update({"User-Agent": "APP/com.xiaomi.mihome APPV/6.0.103 iosV/14.4"})
    s.cookies.set("passToken", pass_token, domain="account.xiaomi.com")
    if user_id:
        s.cookies.set("userId", user_id, domain="account.xiaomi.com")

    log("Step 1: serviceLogin...")
    r1 = s.get("https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true")
    d1 = json.loads(r1.text.replace("&&&START&&&", "").lstrip("\n"))
    sign = d1.get("_sign", "")

    # Already authenticated via passToken cookie
    if d1.get("code") == 0 and d1.get("location"):
        log("Already authenticated via passToken!")
        location  = d1["location"]
        ssecurity = d1.get("ssecurity", "")
        r_sts = s.get(location, allow_redirects=True)
        sts_cookies   = {c.name: c.value for c in s.cookies}
        service_token = sts_cookies.get("serviceToken")
        user_id_final = sts_cookies.get("userId", user_id)
        if not ssecurity:
            ssecurity = sts_cookies.get("ssecurity", "")
        return user_id_final, service_token, ssecurity

    log("Step 2: serviceLoginAuth2 with _pass_token...")
    r2 = s.post("https://account.xiaomi.com/pass/serviceLoginAuth2", data={
        "_json":        "true",
        "_sign":        sign,
        "_pass_token":  pass_token,
        "callback":     "https://sts.api.io.mi.com/sts",
        "qs":           "%3Fsid%3Dxiaomiio%26_json%3Dtrue",
        "serviceParam": '{"checkSafePhone":false}',
        "sid":          "xiaomiio",
        "user":         EMAIL,
    })
    d2 = json.loads(r2.text.replace("&&&START&&&", "").lstrip("\n"))
    log(f"Code: {d2.get('code')}, desc: {d2.get('desc', '')}")

    if d2.get("code") == 0:
        location  = d2.get("location", "")
        ssecurity = d2.get("ssecurity", "")
        if not location:
            return None, None, None
        log("Step 3: Following STS URL...")
        r3 = s.get(location, allow_redirects=True)
        sts_cookies   = {c.name: c.value for c in s.cookies}
        service_token = sts_cookies.get("serviceToken")
        user_id_final = sts_cookies.get("userId", user_id)
        if not ssecurity:
            ssecurity = sts_cookies.get("ssecurity", "")
        return user_id_final, service_token, ssecurity

    elif d2.get("code") == 70016:
        log("❌ passToken expired (70016) — need to re-login on Chrome and update XIAOMI_PASS_TOKEN secret")
        return None, None, None
    else:
        log(f"❌ Login failed: code={d2.get('code')}")
        return None, None, None


def push_to_worker(user_id, service_token, ssecurity):
    if not WORKER_URL or not WORKER_SECRET:
        log("WORKER_URL/WORKER_SECRET not set — skipping push")
        return False
    r = requests.post(
        f"{WORKER_URL}/api/renew",
        headers={"Authorization": f"Bearer {WORKER_SECRET}"},
        json={"userId": user_id, "serviceToken": service_token, "ssecurity": ssecurity},
        timeout=15,
    )
    log(f"Worker /api/renew: {r.status_code} {r.text[:100]}")
    return r.status_code == 200


# ── Main ──────────────────────────────────────────────────────────────────────

log("=" * 60)
log("Xiaomi Token Auto-Renew via passToken")
log("=" * 60)

if not PASS_TOKEN:
    log("❌ XIAOMI_PASS_TOKEN env var required")
    telegram("❌ <b>Token Auto-Renew FAILED</b>\nXIAOMI_PASS_TOKEN not set")
    sys.exit(1)

user_id, service_token, ssecurity = login_with_passtoken(PASS_TOKEN, USER_ID)

if not all([user_id, service_token, ssecurity]):
    log("❌ Failed to get credentials")
    telegram("❌ <b>Token Auto-Renew FAILED</b>\npassToken expired? Re-login on Chrome and update secret.")
    sys.exit(1)

log(f"✅ userId: {user_id}")
log(f"✅ serviceToken: {service_token[:30]}...")
log(f"✅ ssecurity: {ssecurity}")

ok = push_to_worker(user_id, service_token, ssecurity)
if ok:
    log("✅ Credentials pushed to Worker KV")
    telegram("✅ <b>Token Auto-Renew SUCCESS</b>\nCredentials updated via passToken (no 2FA needed)")
else:
    log("❌ Failed to push to Worker")
    telegram("❌ <b>Token Auto-Renew FAILED</b>\nCould not push credentials to Worker")
    sys.exit(1)
