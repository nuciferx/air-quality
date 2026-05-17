"""
Login Xiaomi manually in browser → intercept ssecurity from API response → update Cloudflare secrets.
"""
import json, os, sys, time, subprocess
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

EMAIL_HINT = os.environ.get("XIAOMI_EMAIL", "(set $XIAOMI_EMAIL to prefill)")

print("=" * 55)
print("LOGIN XIAOMI — ทำตามขั้นตอน:")
print(f"1. กรอก Email: {EMAIL_HINT}")
print("2. กรอก Password ของคุณเอง")
print("3. แก้ CAPTCHA ถ้ามี")
print("4. อนุมัติ 2FA บนมือถือ")
print("5. รอ browser redirect ไปหน้า home")
print("=" * 55)

captured = {"ssecurity": None}

def handle_response(response):
    if "serviceLoginAuth2" in response.url:
        try:
            text = response.text()
            text = text.replace("&&&START&&&", "").lstrip("\n")
            data = json.loads(text)
            ssec = data.get("ssecurity", "")
            if ssec:
                captured["ssecurity"] = ssec
                print(f"[intercept] ssecurity captured: {ssec[:20]}...")
        except:
            pass

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, args=["--window-size=900,700"])
    context = browser.new_context()
    page    = context.new_page()

    page.on("response", handle_response)

    # Go to login with STS callback
    page.goto("https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&callback=https://sts.api.io.mi.com/sts")

    print("\nรอ login... (รอสูงสุด 5 นาที)")

    # Wait for redirect away from login page (means login succeeded)
    try:
        page.wait_for_url(
            lambda url: "account.xiaomi.com" not in url,
            timeout=300_000
        )
        print(f"Redirected to: {page.url[:80]}")
    except:
        print("Still on login page, trying to grab cookies anyway...")

    time.sleep(3)

    # Grab all cookies
    all_cookies = {c["name"]: c["value"] for c in context.cookies()}
    print(f"\nCookies found: {list(all_cookies.keys())}")

    browser.close()

user_id       = all_cookies.get("userId")
service_token = all_cookies.get("serviceToken")
ssecurity     = captured["ssecurity"] or all_cookies.get("ssecurity")

print(f"\nuserId:       {user_id}")
print(f"serviceToken: {(service_token or '')[:30]}...")
print(f"ssecurity:    {(ssecurity or 'NOT FOUND')[:30]}")

if not all([user_id, service_token, ssecurity]):
    print("\n❌ Missing credentials!")
    sys.exit(1)

# Save creds
creds = {"userId": user_id, "serviceToken": service_token, "ssecurity": ssecurity}
with open("creds.json", "w") as f:
    json.dump(creds, f, indent=2)
print("\n✅ Saved to creds.json")

# Update Cloudflare Worker secrets
print("\nอัปเดต Cloudflare Worker secrets...")
worker_dir = "webapp/worker"

for key, val in [("XIAOMI_USER_ID", user_id), ("XIAOMI_SERVICE_TOKEN", service_token), ("XIAOMI_SSECURITY", ssecurity)]:
    result = subprocess.run(
        f'echo "{val}" | npx wrangler secret put {key}',
        shell=True, cwd=worker_dir, capture_output=True, text=True
    )
    if result.returncode == 0:
        print(f"✅ {key} updated")
    else:
        print(f"❌ {key} failed: {result.stderr[:100]}")

print("\nDeploy worker...")
result = subprocess.run(
    "npx wrangler deploy",
    shell=True, cwd=worker_dir, capture_output=True, text=True
)
if result.returncode == 0:
    print("✅ Worker deployed!")
else:
    print("❌ Deploy failed:", result.stderr[:200])
