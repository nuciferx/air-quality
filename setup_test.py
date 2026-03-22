"""
Local setup & test script — run this ONCE on your machine before pushing to GitHub.
It will:
  1. Connect to Xiaomi Cloud and list all devices
  2. Show raw property keys for each air purifier
  3. Test writing a dummy row to Google Sheets

Usage:
  pip install micloud gspread
  python setup_test.py
"""

import json
import sys

# ─── FILL THESE IN ────────────────────────────────────────────────────────────
XIAOMI_EMAIL    = ""          # your Mi Home email
XIAOMI_PASSWORD = ""          # your Mi Home password
GCP_SA_KEY_FILE = ""          # path to downloaded service-account JSON file
SHEET_ID        = ""          # Google Sheet ID from the URL
# ──────────────────────────────────────────────────────────────────────────────

TARGET_MODELS = {"zhimi.airp.vb4", "zhimi.airpurifier.mb5"}


def test_xiaomi():
    print("\n=== XIAOMI CLOUD ===")
    try:
        from micloud import MiCloud
    except ImportError:
        print("ERROR: run  pip install micloud")
        sys.exit(1)

    mc = MiCloud(XIAOMI_EMAIL, XIAOMI_PASSWORD)
    mc.login()
    devices = mc.get_devices()
    print(f"Found {len(devices)} device(s) in your Mi Home account\n")

    matched = []
    for d in devices:
        marker = " <<<" if d.get("model") in TARGET_MODELS else ""
        print(f"  {d.get('name'):<30} model={d.get('model')}{marker}")
        if d.get("model") in TARGET_MODELS:
            matched.append(d)

    if not matched:
        print("\nWARNING: none of the target models found — check model codes in log_pm25.py")
        return mc, matched

    print(f"\n=== PROPERTY KEYS for matched devices ===")
    for d in matched:
        print(f"\n--- {d['name']} ({d['model']}) ---")
        try:
            props = mc.get_props(d["did"], d["token"], [])
            print(json.dumps(props, indent=2, ensure_ascii=False))
        except Exception as e:
            print(f"  ERROR fetching props: {e}")

    return mc, matched


def test_sheets():
    print("\n=== GOOGLE SHEETS ===")
    if not GCP_SA_KEY_FILE or not SHEET_ID:
        print("SKIP — GCP_SA_KEY_FILE or SHEET_ID not set")
        return

    try:
        import gspread
    except ImportError:
        print("ERROR: run  pip install gspread")
        sys.exit(1)

    with open(GCP_SA_KEY_FILE) as f:
        sa_key = json.load(f)

    gc = gspread.service_account_from_dict(sa_key)
    sh = gc.open_by_key(SHEET_ID)
    ws = sh.sheet1

    # Ensure header row exists
    if not ws.row_values(1):
        ws.append_row(["timestamp", "device", "pm25", "temperature", "humidity", "mode"])
        print("Header row created")

    ws.append_row(["TEST", "setup_test.py", 0, 0, 0, "test"])
    print("Test row written successfully — check your Google Sheet")


if __name__ == "__main__":
    if not XIAOMI_EMAIL:
        print("Fill in XIAOMI_EMAIL, XIAOMI_PASSWORD (and optionally GCP_SA_KEY_FILE, SHEET_ID) at the top of this file first.")
        sys.exit(1)

    test_xiaomi()
    test_sheets()
    print("\nDone.")
