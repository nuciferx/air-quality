"""
Xiaomi Air Purifier PM2.5 Logger
Pulls device data from the Cloudflare Worker API and appends to Google Sheets.

Env vars required:
  WORKER_URL  — Worker URL (e.g. https://air-quality-api.ideaplanstudio.workers.dev)
  GCP_SA_KEY  — Google Service Account JSON string
  SHEET_ID    — Google Sheets spreadsheet ID
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone

import gspread
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)


def fetch_devices() -> list[dict]:
    worker_url = os.environ["WORKER_URL"].rstrip("/")
    r = requests.get(f"{worker_url}/api/devices", timeout=30)
    r.raise_for_status()
    return r.json()["devices"]


def build_row(device: dict) -> list:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    v = device.get("values", {})
    return [
        ts,
        device.get("name"),
        v.get("pm25"),
        v.get("temp"),
        v.get("hum"),
        v.get("power"),
    ]


def append_to_sheet(rows: list[list]):
    sa_key = json.loads(os.environ["GCP_SA_KEY"])
    sheet_id = os.environ["SHEET_ID"]
    gc = gspread.service_account_from_dict(sa_key)
    ws = gc.open_by_key(sheet_id).sheet1

    if not ws.row_values(1):
        ws.append_row(
            ["timestamp", "device", "aqi_pm25", "temperature", "humidity", "power"],
            value_input_option="USER_ENTERED",
        )

    for row in rows:
        ws.append_row(row, value_input_option="USER_ENTERED")
        log.info("Appended: %s", row)


def main():
    devices = fetch_devices()
    rows = []

    for device in devices:
        if not device.get("online"):
            log.warning("Offline: %s — skipping", device.get("name"))
            continue
        row = build_row(device)
        log.info("Row: %s", row)
        rows.append(row)

    if not rows:
        log.error("No data — aborting")
        sys.exit(1)

    append_to_sheet(rows)
    log.info("Done — %d row(s) written", len(rows))


if __name__ == "__main__":
    main()
