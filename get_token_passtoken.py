"""
Use Chrome's saved passToken cookie to get fresh Xiaomi credentials.
passToken is a long-lived auth token → bypasses CAPTCHA + password login.
"""
import base64, hashlib, hmac, json, os, shutil, sqlite3, subprocess, sys, tempfile, time, requests
sys.stdout.reconfigure(encoding='utf-8')

EMAIL = "nuciferx@gmail.com"

# ── 1. Read passToken from Chrome cookies ────────────────────────────────────

def get_chrome_safe_storage_key():
    """Get Chrome Safe Storage password from macOS Keychain."""
    result = subprocess.run(
        ["security", "find-generic-password", "-s", "Chrome Safe Storage", "-a", "Chrome", "-w"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        # Try Google Chrome variant
        result = subprocess.run(
            ["security", "find-generic-password", "-s", "Chrome Safe Storage", "-w"],
            capture_output=True, text=True
        )
    return result.stdout.strip()

def derive_key(password):
    """Derive AES key from Chrome Safe Storage password (PBKDF2-SHA1)."""
    return hashlib.pbkdf2_hmac("sha1", password.encode(), b"saltysalt", 1003, dklen=16)

def decrypt_cookie(encrypted_value, key):
    """Decrypt Chrome cookie value.

    Chrome macOS format (v10): v10 + IV(16 bytes) + AES-128-CBC ciphertext
    The 16-byte IV is stored per-cookie right after the 'v10' prefix.
    """
    try:
        from Crypto.Cipher import AES
    except ImportError:
        try:
            from Cryptodome.Cipher import AES
        except ImportError:
            print("Need pycryptodome: pip3 install pycryptodome")
            return None

    if isinstance(encrypted_value, str):
        encrypted_value = encrypted_value.encode("latin-1")

    # Strip v10/v11 prefix (3 bytes)
    if encrypted_value[:3] in (b"v10", b"v11"):
        data = encrypted_value[3:]
    else:
        data = encrypted_value

    # Format: IV(16 bytes) + ciphertext
    iv         = data[:16]
    ciphertext = data[16:]

    cipher    = AES.new(key, AES.MODE_CBC, IV=iv)
    decrypted = cipher.decrypt(ciphertext)

    # Remove PKCS7 padding
    pad = decrypted[-1]
    if isinstance(pad, int) and 1 <= pad <= 16:
        decrypted = decrypted[:-pad]

    # Chrome prepends a 16-byte nonce to the plaintext before encrypting.
    # The first decrypted block is this nonce (looks like garbage). Skip it.
    if len(decrypted) > 16:
        decrypted = decrypted[16:]

    return decrypted.decode("utf-8", errors="replace").strip("\x00")

def read_xiaomi_cookies():
    """Read Xiaomi cookies from Chrome's SQLite database."""
    chrome_cookie_path = os.path.expanduser(
        "~/Library/Application Support/Google/Chrome/Default/Cookies"
    )
    if not os.path.exists(chrome_cookie_path):
        # Try Profile 1
        chrome_cookie_path = os.path.expanduser(
            "~/Library/Application Support/Google/Chrome/Profile 1/Cookies"
        )

    print(f"Reading cookies from: {chrome_cookie_path}")

    # Copy to temp (Chrome may lock the file)
    tmp = tempfile.mktemp(suffix=".db")
    shutil.copy2(chrome_cookie_path, tmp)

    try:
        conn = sqlite3.connect(tmp)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("""
            SELECT name, value, encrypted_value, host_key
            FROM cookies
            WHERE host_key LIKE '%xiaomi%' OR host_key LIKE '%mi.com%'
            ORDER BY host_key, name
        """)
        rows = c.fetchall()
        conn.close()
    finally:
        os.unlink(tmp)

    return rows

def get_passtoken():
    """Extract decrypted passToken from Chrome cookies."""
    password = get_chrome_safe_storage_key()
    if not password:
        print("Failed to get Chrome Safe Storage key from Keychain")
        return None, None

    print(f"Got Safe Storage key: {password[:10]}...")
    key = derive_key(password)

    rows = read_xiaomi_cookies()
    print(f"\nFound {len(rows)} Xiaomi cookies:")

    # Debug: show raw encrypted_value prefix for passToken
    for row in rows:
        if row["name"] == "passToken" and row["host_key"] == ".account.xiaomi.com":
            enc = bytes(row["encrypted_value"])
            print(f"  [DEBUG] passToken raw prefix: {enc[:32]}")
            print(f"  [DEBUG] passToken raw prefix hex: {enc[:32].hex()}")
            break

    cookies = {}
    for row in rows:
        name = row["name"]
        raw_val = row["value"]
        enc_val = row["encrypted_value"]
        host = row["host_key"]

        # Decrypt if encrypted
        if enc_val:
            try:
                val = decrypt_cookie(bytes(enc_val), key)
            except Exception as e:
                val = raw_val or f"[decrypt error: {e}]"
        else:
            val = raw_val

        print(f"  [{host}] {name} = {str(val)[:60]}...")
        cookies[name] = val

    pass_token = cookies.get("passToken")
    user_id_raw = cookies.get("userId", "")
    # Extract clean userId (digits only)
    import re
    user_id = re.search(r'\d{5,}', user_id_raw or "")
    user_id = user_id.group() if user_id else user_id_raw

    print(f"\npassToken: {str(pass_token)[:60] if pass_token else 'NOT FOUND'}...")
    print(f"userId:    {user_id}")

    return pass_token, user_id

# ── 2. Login with passToken ──────────────────────────────────────────────────

def clean_ascii(val):
    """Strip any non-ASCII/non-printable prefix from a decoded cookie value."""
    if not val:
        return val
    # Find first printable ASCII char (covers V1:... passToken, digits for userId, etc.)
    import re
    m = re.search(r'[A-Za-z0-9+/=:_\-]', val)
    return val[m.start():] if m else val

def login_with_passtoken(pass_token, user_id):
    """Use passToken to get fresh serviceToken + ssecurity (no CAPTCHA)."""
    pass_token = clean_ascii(pass_token)
    user_id    = clean_ascii(user_id) if user_id else user_id

    print(f"Using passToken: {pass_token[:50]}...")
    print(f"Using userId:    {user_id}")

    s = requests.Session()
    s.headers.update({"User-Agent": "APP/com.xiaomi.mihome APPV/6.0.103 iosV/14.4"})

    # Set passToken in session cookies
    s.cookies.set("passToken", pass_token, domain="account.xiaomi.com")
    if user_id:
        s.cookies.set("userId", user_id, domain="account.xiaomi.com")

    print("\n--- Step 1: serviceLogin ---")
    r1 = s.get("https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true")
    print(f"Status: {r1.status_code}")

    try:
        d1 = json.loads(r1.text.replace("&&&START&&&", "").lstrip("\n"))
    except json.JSONDecodeError:
        print("Response:", r1.text[:200])
        return None, None, None

    print(f"Code: {d1.get('code')}, _sign: {str(d1.get('_sign',''))[:30]}...")
    sign = d1.get("_sign", "")

    # If already logged in (code 0 with location), extract directly
    if d1.get("code") == 0 and d1.get("location"):
        print("Already authenticated! Following location...")
        location = d1["location"]
        ssecurity = d1.get("ssecurity", "")
        r_sts = s.get(location, allow_redirects=True)
        sts_cookies = {c.name: c.value for c in s.cookies}
        service_token = sts_cookies.get("serviceToken")
        user_id_final = sts_cookies.get("userId", user_id)
        print(f"serviceToken: {(service_token or '')[:40]}...")
        print(f"ssecurity: {ssecurity[:30] if ssecurity else 'from cookie: ' + str(sts_cookies.get('ssecurity',''))[:30]}")
        return user_id_final, service_token, ssecurity or sts_cookies.get("ssecurity")

    print("\n--- Step 2: serviceLoginAuth2 with _pass_token ---")
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
    print(f"Status: {r2.status_code}")

    try:
        d2 = json.loads(r2.text.replace("&&&START&&&", "").lstrip("\n"))
    except json.JSONDecodeError:
        print("Response:", r2.text[:300])
        return None, None, None

    print(f"Code: {d2.get('code')}, desc: {d2.get('desc', '')}")
    # Print all keys except notificationUrl (too long)
    for k, v in d2.items():
        if k not in ("notificationUrl",):
            print(f"  {k}: {str(v)[:80]}")

    code = d2.get("code")

    if code == 0:
        # Direct success
        location  = d2.get("location", "")
        ssecurity = d2.get("ssecurity", "")

        if not location:
            print("No location in response — unexpected")
            return None, None, None

        print(f"\n--- Step 3: Follow STS URL ---")
        print(f"Location: {location[:80]}...")
        r3 = s.get(location, allow_redirects=True)
        print(f"STS status: {r3.status_code}, final URL: {r3.url[:80]}")

        sts_cookies = {c.name: c.value for c in s.cookies}
        print(f"Cookies after STS: {list(sts_cookies.keys())}")

        service_token = sts_cookies.get("serviceToken")
        user_id_final = sts_cookies.get("userId", user_id)
        if not ssecurity:
            ssecurity = sts_cookies.get("ssecurity", "")

        return user_id_final, service_token, ssecurity

    elif code == 70016:
        # Token expired — need fresh login
        print("\n❌ passToken expired (70016). Need to login manually.")
        return None, None, None

    else:
        print(f"\n❌ Login failed: code={code}")
        return None, None, None

# ── 3. Verify credentials + fetch devices ────────────────────────────────────

def get_devices(user_id, service_token, ssecurity, country="cn"):
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

    nonce  = generate_nonce()
    snonce = signed_nonce(ssecurity, nonce)
    data   = '{"getVirtualModel":true,"getHuamiDevices":1}'
    path   = "/app/home/device_list"
    r = requests.post(f"https://{country}.api.io.mi.com{path}", data={
        "data": data, "_nonce": nonce,
        "signature": sign_request(path, data, snonce),
    }, headers={
        "User-Agent": "APP/com.xiaomi.mihome APPV/6.0.103",
        "Cookie": f"userId={user_id}; serviceToken={service_token}; locale=th_TH",
    })
    return r.json()

# ── Main ─────────────────────────────────────────────────────────────────────

print("=" * 60)
print("Xiaomi Token Refresh via passToken")
print("=" * 60)

# Step 1: Extract passToken from Chrome
pass_token, user_id = get_passtoken()

if not pass_token:
    print("\n❌ Could not extract passToken from Chrome cookies.")
    print("Make sure Chrome is closed or try running as admin.")
    sys.exit(1)

# Step 2: Login with passToken
print("\n" + "=" * 60)
user_id, service_token, ssecurity = login_with_passtoken(pass_token, user_id)

if not all([user_id, service_token, ssecurity]):
    print("\n❌ Failed to get credentials")
    sys.exit(1)

print(f"\n✅ Got credentials:")
print(f"   userId:       {user_id}")
print(f"   serviceToken: {service_token[:40]}...")
print(f"   ssecurity:    {ssecurity[:30]}")

# Step 3: Save
creds = {"userId": user_id, "serviceToken": service_token, "ssecurity": ssecurity}
with open("creds.json", "w") as f:
    json.dump(creds, f, indent=2)
print("\n✅ Saved to creds.json")

# Step 4: Verify with cn server
print("\n=== Testing cn server ===")
result = get_devices(user_id, service_token, ssecurity, "cn")
if result.get("code") == 0:
    devices = result.get("result", {}).get("list", [])
    print(f"✅ cn server works! {len(devices)} devices found:")
    for d in devices:
        print(f"  {d.get('name',''):<35} model={d.get('model','')} did={d.get('did','')}")
else:
    print(f"❌ cn server error: {result.get('message','')}")
    # Try sg
    print("\n=== Testing sg server ===")
    result = get_devices(user_id, service_token, ssecurity, "sg")
    if result.get("code") == 0:
        devices = result.get("result", {}).get("list", [])
        print(f"✅ sg server works! {len(devices)} devices found")
    else:
        print(f"❌ sg server error: {result}")

# Step 5: Update Cloudflare Worker secrets
print("\n=== Updating Cloudflare Worker secrets ===")
worker_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "webapp/worker")

for key, val in [
    ("XIAOMI_USER_ID", user_id),
    ("XIAOMI_SERVICE_TOKEN", service_token),
    ("XIAOMI_SSECURITY", ssecurity),
]:
    result = subprocess.run(
        f'echo "{val}" | npx wrangler secret put {key}',
        shell=True, cwd=worker_dir, capture_output=True, text=True
    )
    if result.returncode == 0:
        print(f"✅ {key} updated")
    else:
        print(f"❌ {key} failed: {result.stderr[:100]}")

print("\n=== Deploying Worker ===")
result = subprocess.run(
    "npx wrangler deploy",
    shell=True, cwd=worker_dir, capture_output=True, text=True
)
if result.returncode == 0:
    print("✅ Worker deployed!")
else:
    print("❌ Deploy failed:", result.stderr[:300])
