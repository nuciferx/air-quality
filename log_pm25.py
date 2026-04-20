"""
Xiaomi Air Purifier PM2.5 Logger
Pulls readings from all air purifiers and POSTs them to the CF Worker /api/log.

Env vars (optional — falls back to creds.json):
  XIAOMI_USER_ID       — Xiaomi userId
  XIAOMI_SERVICE_TOKEN — Xiaomi serviceToken
  XIAOMI_SSECURITY     — Xiaomi ssecurity
  WORKER_URL           — CF Worker base URL (default: https://air-quality-api.ideaplanstudio.workers.dev)
  WORKER_SECRET        — shared LOG_SECRET for /api/log auth
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone

import requests
from micloud import MiCloud

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

WORKER_URL = os.environ.get("WORKER_URL", "https://air-quality-api.ideaplanstudio.workers.dev").rstrip("/")

# ── Device definitions ──────────────────────────────────────────────────────
DEVICES = [
    {
        # zhimi.airp.rmb1 — Xiaomi Air Purifier 4 Lite
        "id": "4lite",
        "name": "ห้องทำงาน",
        "did": "873639853",
        "host": "sg.api.io.mi.com",
        "props": [
            (2, 1, "power"),
            (2, 4, "mode"),
            (3, 1, "humidity"),
            (3, 4, "pm25"),
            (3, 7, "temperature"),
        ],
    },
    {
        # zhimi.airpurifier.sa2 — Xiaomi Air Purifier MAX Pro
        "id": "maxpro",
        "name": "ห้องนอนชั้น 2",
        "did": "460764069",
        "host": "api.io.mi.com",
        "props": [
            (2, 1, "power"),
            (2, 2, "mode"),
            (3, 1, "pm25"),
            (3, 3, "temperature"),
            (4, 1, "filter"),
        ],
    },
    {
        # zhimi.airpurifier.sb1 — Xiaomi Air Purifier MAX (downstairs)
        "id": "maxdown",
        "name": "โถงชั้นล่าง",
        "did": "131590393",
        "host": "api.io.mi.com",
        "props": [
            (2, 1, "power"),
            (2, 2, "mode"),
            (3, 1, "pm25"),
            (3, 3, "temperature"),
            (4, 1, "filter"),
        ],
    },
    {
        # zhimi.airpurifier.v7 — Xiaomi Air Purifier (cat room)
        "id": "cat",
        "name": "ห้องแมวชั้น 2",
        "did": "357231085",
        "host": "api.io.mi.com",
        "props": [
            (2, 1, "power"),
            (2, 2, "mode"),
            (3, 1, "pm25"),
            (3, 3, "temperature"),
            (4, 1, "filter"),
        ],
    },
]


def get_micloud() -> MiCloud:
    user_id = os.environ.get("XIAOMI_USER_ID")
    svc_tok = os.environ.get("XIAOMI_SERVICE_TOKEN")
    ssec    = os.environ.get("XIAOMI_SSECURITY")

    if not (user_id and svc_tok and ssec):
        creds_path = os.path.join(os.path.dirname(__file__), "creds.json")
        with open(creds_path) as f:
            data = json.load(f)
        user_id = user_id or data["userId"]
        svc_tok = svc_tok or data["serviceToken"]
        ssec    = ssec    or data["ssecurity"]

    mc = MiCloud(None, None)
    mc.user_id       = user_id
    mc.service_token = svc_tok
    mc.ssecurity     = ssec
    return mc


def fetch_props(mc: MiCloud, device: dict) -> dict:
    did   = device["did"]
    host  = device["host"]
    props = device["props"]
    url   = f"https://{host}/app/miotspec/prop/get"
    params_list = [{"did": did, "siid": s, "piid": p} for s, p, _ in props]
    raw    = mc.request(url, {"data": json.dumps({"params": params_list}, separators=(",", ":"))})
    result = json.loads(raw)
    row = {label: None for _, _, label in props}
    for item in result.get("result", []):
        if item.get("code") == 0:
            for s, p, label in props:
                if s == item["siid"] and p == item["piid"]:
                    row[label] = item["value"]
    return row


def post_to_worker(readings: list) -> bool:
    secret = os.environ.get("WORKER_SECRET")
    if not secret:
        creds_path = os.path.join(os.path.dirname(__file__), "creds.json")
        if os.path.exists(creds_path):
            with open(creds_path) as f:
                data = json.load(f)
            secret = data.get("worker_secret")

    if not secret:
        log.error("WORKER_SECRET not set — cannot post to Worker")
        return False

    url = f"{WORKER_URL}/api/log"
    resp = requests.post(url, json={"readings": readings}, headers={"Authorization": f"Bearer {secret}"}, timeout=30)
    if resp.ok:
        log.info("Worker: %s", resp.json())
        return True
    log.error("Worker error: %s %s", resp.status_code, resp.text[:200])
    return False


def main():
    mc       = get_micloud()
    readings = []

    for device in DEVICES:
        log.info("Fetching %s (did=%s)...", device["name"], device["did"])
        try:
            props = fetch_props(mc, device)
            reading = {
                "device_id":   device["id"],
                "device_name": device["name"],
                "pm25":        props.get("pm25"),
                "temperature": props.get("temperature"),
                "humidity":    props.get("humidity"),
                "power":       props.get("power"),
            }
            log.info("Reading: %s", reading)
            readings.append(reading)
        except Exception as e:
            log.error("Failed %s: %s", device["name"], e)

    if not readings:
        log.error("No data — aborting")
        sys.exit(1)

    success = post_to_worker(readings)
    if not success:
        sys.exit(1)

    log.info("Done — %d reading(s) posted", len(readings))


if __name__ == "__main__":
    main()
