"""
Xiaomi Air Purifier PM2.5 Logger
Pulls AQI/PM2.5, temperature, humidity from all air purifiers (2 regions)
and appends data to Google Sheets.

Env vars required:
  XIAOMI_USER_ID       — Xiaomi userId
  XIAOMI_SERVICE_TOKEN — Xiaomi serviceToken
  XIAOMI_SSECURITY     — Xiaomi ssecurity
  GCP_SA_KEY           — Google Service Account JSON string
  SHEET_ID             — Google Sheets spreadsheet ID
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone

import gspread
from micloud import MiCloud

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# ── Device definitions ──────────────────────────────────────────────────────
DEVICES = [
    {"name": "4 Lite",        "did": "873639853", "host": "sg.api.io.mi.com"},
    {"name": "MAX/MAX Pro",   "did": "460764069", "host": "sg.api.io.mi.com"},
    {"name": "MAX ชั้นล่าง",  "did": "131590393", "host": "api.io.mi.com"},
    {"name": "แมว",           "did": "357231085", "host": "api.io.mi.com"},
]

# MIoT spec siid/piid for air purifiers
PROPS = [
    (2,  1,  "power"),
    (3,  1,  "aqi"),
    (3,  4,  "humidity"),
    (3,  7,  "temperature"),
]


def get_micloud() -> MiCloud:
    mc = MiCloud(None, None)
    mc.user_id       = os.environ["XIAOMI_USER_ID"]
    mc.service_token = os.environ["XIAOMI_SERVICE_TOKEN"]
    mc.ssecurity     = os.environ["XIAOMI_SSECURITY"]
    return mc


def fetch_props(mc: MiCloud, did: str, host: str) -> dict:
    url          = f"https://{host}/app/miotspec/prop/get"
    params_list  = [{"did": did, "siid": s, "piid": p} for s, p, _ in PROPS]
    raw          = mc.request(url, {"data": json.dumps({"params": params_list}, separators=(",", ":"))})
    result       = json.loads(raw)
    row = {label: None for _, _, label in PROPS}
    for item in result.get("result", []):
        if item.get("code") == 0:
            for s, p, label in PROPS:
                if s == item["siid"] and p == item["piid"]:
                    row[label] = item["value"]
    return row


def build_row(name: str, props: dict) -> list:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    return [ts, name, props.get("aqi"), props.get("temperature"), props.get("humidity"), props.get("power")]


def append_to_sheet(rows: list[list]):
    sa_key   = json.loads(os.environ["GCP_SA_KEY"])
    sheet_id = os.environ["SHEET_ID"]
    gc       = gspread.service_account_from_dict(sa_key)
    ws       = gc.open_by_key(sheet_id).sheet1

    if not ws.row_values(1):
        ws.append_row(["timestamp", "device", "aqi_pm25", "temperature", "humidity", "power"],
                      value_input_option="USER_ENTERED")

    for row in rows:
        ws.append_row(row, value_input_option="USER_ENTERED")
        log.info("Appended: %s", row)


def main():
    mc   = get_micloud()
    rows = []

    for device in DEVICES:
        log.info("Fetching %s (did=%s)...", device["name"], device["did"])
        try:
            props = fetch_props(mc, device["did"], device["host"])
            row   = build_row(device["name"], props)
            log.info("Row: %s", row)
            rows.append(row)
        except Exception as e:
            log.error("Failed %s: %s", device["name"], e)

    if not rows:
        log.error("No data — aborting")
        sys.exit(1)

    append_to_sheet(rows)
    log.info("Done — %d row(s) written", len(rows))


if __name__ == "__main__":
    main()
