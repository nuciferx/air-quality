"""
Auto-renew Xiaomi MiCloud credentials — no browser needed.

Uses the same login flow as get_token2.py (API-based with 2FA polling).
After obtaining new credentials, POSTs them to the Cloudflare Worker's
/api/renew endpoint and optionally notifies via Telegram.

Env vars required:
  XIAOMI_EMAIL     — Xiaomi account email
  XIAOMI_PASSWORD  — Xiaomi account password
  WORKER_URL       — Worker URL (e.g. https://air-quality-api.ideaplanstudio.workers.dev)
  WORKER_SECRET    — LOG_SECRET value
  TELEGRAM_BOT_TOKEN — (optional) Telegram bot token
  TELEGRAM_CHAT_ID   — (optional) Telegram chat ID
"""
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import requests

sys.stdout.reconfigure(encoding="utf-8")

# ── Config ─────────────────────────────────────────────────────────────────────

EMAIL = os.environ.get("XIAOMI_EMAIL")
PASSWORD = os.environ.get("XIAOMI_PASSWORD")
WORKER_URL = os.environ.get("WORKER_URL", "").rstrip("/")
WORKER_SECRET = os.environ.get("WORKER_SECRET")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID")

# ── Helpers ────────────────────────────────────────────────────────────────────

def log(msg: str):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def md5(v: str) -> str:
    return hashlib.md5(v.encode()).hexdigest().upper()


def do_login(email: str, password: str):
    """
    Login to Xiaomi account. Returns (session, location, ssecurity) or (None, None, None).
    Supports 2FA by polling for up to 3 minutes.
    """
    s = requests.Session()
    s.headers.update({"User-Agent": "APP/com.xiaomi.mihome APPV/6.0.103 iosV/14.4"})

    # Step 1: Get _sign
    log("Getting login signature...")
    r1 = s.get("https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true")
    d1 = json.loads(r1.text.replace("&&&START&&&", "").lstrip("\n"))
    sign = d1.get("_sign")
    if not sign:
        log(f"Failed to get _sign: {d1}")
        return None, None, None

    # Step 2: Submit credentials
    log("Submitting credentials...")
    r2 = s.post("https://account.xiaomi.com/pass/serviceLoginAuth2", data={
        "_json": "true",
        "_sign": sign,
        "callback": "https://sts.api.io.mi.com/sts",
        "hash": md5(password),
        "qs": "%3Fsid%3Dxiaomiio%26_json%3Dtrue",
        "serviceParam": '{"checkSafePhone":false}',
        "sid": "xiaomiio",
        "user": email,
    })
    d2 = json.loads(r2.text.replace("&&&START&&&", "").lstrip("\n"))

    if d2.get("code") != 0:
        log(f"Login error: {d2.get('desc')}")
        return None, None, None

    location = d2.get("location", "")
    ssecurity = d2.get("ssecurity", "")

    if location:
        log("Login succeeded directly (no 2FA needed)")
        return s, location, ssecurity

    # Need 2FA — poll for approval
    notification = d2.get("notificationUrl", "")
    if notification:
        log(f"2FA URL: {notification}")
        # Write URL to file so external processes can read it immediately
        url_file = os.path.join(os.path.dirname(__file__), "..", ".2fa_url")
        with open(url_file, "w") as f:
            f.write(notification)
    log("2FA required. Open Mi Home app or the URL above to approve. Waiting (up to 3 min)...")
    for i in range(36):
        time.sleep(5)
        if i % 6 == 0:
            log(f"  Waiting... ({(i+1)*5}s)")

        r_poll = s.post("https://account.xiaomi.com/pass/serviceLoginAuth2", data={
            "_json": "true",
            "_sign": sign,
            "callback": "https://sts.api.io.mi.com/sts",
            "hash": md5(password),
            "qs": "%3Fsid%3Dxiaomiio%26_json%3Dtrue",
            "serviceParam": '{"checkSafePhone":false}',
            "sid": "xiaomiio",
            "user": email,
        })
        dp = json.loads(r_poll.text.replace("&&&START&&&", "").lstrip("\n"))
        log(f"  Poll response: code={dp.get('code')} desc={dp.get('desc')} loc={bool(dp.get('location'))}")
        loc = dp.get("location", "")
        ss = dp.get("ssecurity", "")
        if loc:
            log("2FA approved!")
            return s, loc, ss

    log("Timeout — 2FA not approved in 3 minutes")
    return None, None, None


def get_sts_cookies(session, location: str):
    """Follow the STS redirect and extract cookies."""
    log("Following STS redirect...")
    r = session.get(location, allow_redirects=True)
    cookies = {c.name: c.value for c in session.cookies}
    return cookies


def send_to_worker(creds: dict) -> bool:
    """POST new credentials to the worker /api/renew endpoint."""
    url = f"{WORKER_URL}/api/renew?secret={WORKER_SECRET}"
    log(f"Sending credentials to worker...")

    resp = requests.post(url, json=creds, timeout=30)
    log(f"Worker response: {resp.status_code} {resp.text[:300]}")

    return resp.status_code == 200


def send_telegram(message: str):
    """Send a message to Telegram."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        log("Telegram not configured, skipping")
        return

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        resp = requests.post(url, json={
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "HTML",
        }, timeout=15)
        log(f"Telegram: {resp.status_code}")
    except Exception as e:
        log(f"Telegram error: {e}")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    if not EMAIL or not PASSWORD:
        log("ERROR: XIAOMI_EMAIL and XIAOMI_PASSWORD env vars required")
        sys.exit(1)

    if not WORKER_URL or not WORKER_SECRET:
        log("ERROR: WORKER_URL and WORKER_SECRET env vars required")
        sys.exit(1)

    log("=" * 60)
    log("Xiaomi Token Auto-Renew")
    log("=" * 60)

    # Login
    session, location, ssecurity = do_login(EMAIL, PASSWORD)
    if not location:
        msg = "❌ <b>Token Auto-Renew FAILED</b>\nCould not login to Xiaomi account. Check credentials or approve 2FA in Mi Home app."
        log(msg)
        send_telegram(msg)
        sys.exit(1)

    # Get cookies
    cookies = get_sts_cookies(session, location)

    user_id = cookies.get("userId")
    service_token = cookies.get("serviceToken")

    if not all([user_id, service_token, ssecurity]):
        msg = (
            "❌ <b>Token Auto-Renew FAILED</b>\n"
            f"Missing cookies after login:\n"
            f"userId: {bool(user_id)}\n"
            f"serviceToken: {bool(service_token)}\n"
            f"ssecurity: {bool(ssecurity)}\n"
            f"Available keys: {list(cookies.keys())}"
        )
        log(msg)
        send_telegram(msg)
        sys.exit(1)

    creds = {
        "userId": user_id,
        "serviceToken": service_token,
        "ssecurity": ssecurity,
    }

    # Save locally
    creds_file = os.path.join(os.path.dirname(__file__), "..", "creds.json")
    with open(creds_file, "w") as f:
        json.dump(creds, f, indent=2)
    log(f"Saved to {creds_file}")

    # Send to worker
    success = send_to_worker(creds)

    # Telegram notification
    if success:
        msg = (
            "✅ <b>Token Auto-Renew Success!</b>\n"
            f"🕐 {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"👤 userId: <code>{user_id}</code>\n"
            f"🔑 serviceToken: <code>{service_token[:20]}...</code>\n"
            f"Credentials stored in Cloudflare KV"
        )
        send_telegram(msg)
        log("✅ Done!")
    else:
        msg = (
            "❌ <b>Token Auto-Renew FAILED</b>\n"
            f"🕐 {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"Worker rejected the new credentials"
        )
        send_telegram(msg)
        sys.exit(1)


if __name__ == "__main__":
    main()
