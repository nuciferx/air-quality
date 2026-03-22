"""
Xiaomi Air Purifier PM2.5 Logger
Pulls PM2.5, temperature, humidity from two Xiaomi air purifiers
and appends the data to Google Sheets.

Requires env vars:
  XIAOMI_EMAIL, XIAOMI_PASSWORD     — Mi Home account credentials
  GCP_SA_KEY                        — Google Service Account JSON (string)
  SHEET_ID                          — Google Sheets spreadsheet ID
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone

import gspread
from micloud import MiCloud

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Device definitions — update model codes if needed
# ---------------------------------------------------------------------------
DEVICES = [
    {"name": "4 Pro", "model": "zhimi.airp.vb4"},
    {"name": "4",     "model": "zhimi.airpurifier.mb5"},
]

# Property keys as used by Xiaomi MIoT spec
PROP_PM25   = "environment.air-quality-index"   # aqi / pm2.5
PROP_TEMP   = "environment.temperature"
PROP_HUMID  = "environment.relative-humidity"
PROP_MODE   = "air-purifier.mode"


def get_micloud_client() -> MiCloud:
    email    = os.environ["XIAOMI_EMAIL"]
    password = os.environ["XIAOMI_PASSWORD"]
    mc = MiCloud(email, password)
    mc.login()
    log.info("Logged in to Xiaomi Cloud")
    return mc


def fetch_device_status(mc: MiCloud, model: str) -> dict | None:
    """Return raw property dict for the first device matching *model*."""
    devices = mc.get_devices()
    match = next((d for d in devices if d.get("model") == model), None)
    if match is None:
        log.warning("Device not found: %s", model)
        return None

    did   = match["did"]
    token = match["token"]

    # Use micloud's get_props (cloud path — no local IP needed)
    props = mc.get_props(did, token, [PROP_PM25, PROP_TEMP, PROP_HUMID, PROP_MODE])
    return props


def extract_value(props: dict, key: str):
    """Pull a scalar value from the MiCloud property response."""
    for item in props.get("result", []):
        if item.get("siid") and item.get("piid"):
            # numeric siid/piid path — handled below
            pass
        if item.get("prop") == key or item.get("key") == key:
            return item.get("value")
    # Fallback: search by partial key match
    for item in props.get("result", []):
        if key.split(".")[-1] in str(item):
            return item.get("value")
    return None


def build_row(name: str, props: dict) -> list:
    ts      = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    pm25    = extract_value(props, PROP_PM25)
    temp    = extract_value(props, PROP_TEMP)
    humidity = extract_value(props, PROP_HUMID)
    mode    = extract_value(props, PROP_MODE)
    return [ts, name, pm25, temp, humidity, mode]


def append_to_sheet(rows: list[list]):
    sa_key = json.loads(os.environ["GCP_SA_KEY"])
    sheet_id = os.environ["SHEET_ID"]

    gc = gspread.service_account_from_dict(sa_key)
    sh = gc.open_by_key(sheet_id)
    ws = sh.sheet1

    # Add header row if sheet is empty
    if ws.row_count == 0 or not ws.row_values(1):
        ws.append_row(
            ["timestamp", "device", "pm25", "temperature", "humidity", "mode"],
            value_input_option="USER_ENTERED",
        )

    for row in rows:
        ws.append_row(row, value_input_option="USER_ENTERED")
        log.info("Appended row: %s", row)


def main():
    mc = get_micloud_client()

    rows = []
    for device in DEVICES:
        log.info("Fetching %s (%s)…", device["name"], device["model"])
        props = fetch_device_status(mc, device["model"])
        if props is None:
            log.error("Skipping %s — device not found in cloud", device["name"])
            continue
        row = build_row(device["name"], props)
        log.info("Row: %s", row)
        rows.append(row)

    if not rows:
        log.error("No data collected — aborting without writing to sheet")
        sys.exit(1)

    append_to_sheet(rows)
    log.info("Done — %d row(s) written", len(rows))


if __name__ == "__main__":
    main()
