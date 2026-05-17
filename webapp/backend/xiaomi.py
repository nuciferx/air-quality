"""
Xiaomi MiCloud wrapper — RC4-signed requests via the micloud library.
Credentials are loaded from (in priority order):
  1. Environment variables: XIAOMI_USER_ID, XIAOMI_SERVICE_TOKEN, XIAOMI_SSECURITY
  2. F:/ai/air-quality/creds.json  (local dev)
"""

import json
import logging
import os
from pathlib import Path
from typing import Any

from micloud import MiCloud

log = logging.getLogger(__name__)

CREDS_PATH = Path(__file__).resolve().parents[2] / "creds.json"

# ── Device catalogue ─────────────────────────────────────────────────────────

DEVICES = [
    {
        "id": "4lite",
        "name": "ห้องนอนชั้น 2",
        "did": "873639853",
        "host": "sg.api.io.mi.com",
        "props": {
            "pm25":  {"siid": 3, "piid": 4},
            "hum":   {"siid": 3, "piid": 1},
            "temp":  {"siid": 3, "piid": 7},
            "power": {"siid": 2, "piid": 1},
            "mode":  {"siid": 2, "piid": 4},
            "filter":{"siid": 4, "piid": 1},
            "buzz":  {"siid": 6, "piid": 1},
            "lock":  {"siid": 8, "piid": 1},
        },
    },
    {
        "id": "maxpro",
        "name": "ห้องทำงานชั้น 2",
        "did": "460764069",
        "host": "api.io.mi.com",
        "props": {
            "pm25":  {"siid": 3, "piid": 2},
            "aqi":   {"siid": 3, "piid": 1},
            "temp":  {"siid": 3, "piid": 3},
            "hum":   {"siid": 3, "piid": 4},
            "power": {"siid": 2, "piid": 1},
            "mode":  {"siid": 2, "piid": 4},
            "fan":   {"siid": 2, "piid": 11},
            "filter":{"siid": 4, "piid": 1},
            "buzz":  {"siid": 7, "piid": 1},
            "lock":  {"siid": 8, "piid": 1},
        },
    },
    {
        "id": "maxdown",
        "name": "โถงชั้นล่าง",
        "did": "131590393",
        "host": "api.io.mi.com",
        "props": {
            "pm25":  {"siid": 3, "piid": 2},
            "aqi":   {"siid": 3, "piid": 1},
            "temp":  {"siid": 3, "piid": 3},
            "hum":   {"siid": 3, "piid": 4},
            "power": {"siid": 2, "piid": 1},
            "mode":  {"siid": 2, "piid": 4},
            "fan":   {"siid": 2, "piid": 11},
            "filter":{"siid": 4, "piid": 1},
            "buzz":  {"siid": 7, "piid": 1},
            "lock":  {"siid": 8, "piid": 1},
        },
    },
    {
        "id": "cat",
        "name": "ห้องแมวชั้น 2",
        "did": "357231085",
        "host": "api.io.mi.com",
        "props": {
            "pm25":  {"siid": 3, "piid": 2},
            "aqi":   {"siid": 3, "piid": 1},
            "temp":  {"siid": 3, "piid": 3},
            "hum":   {"siid": 3, "piid": 4},
            "power": {"siid": 2, "piid": 1},
            "mode":  {"siid": 2, "piid": 4},
            "fan":   {"siid": 2, "piid": 11},
            "filter":{"siid": 4, "piid": 1},
            "buzz":  {"siid": 6, "piid": 1},
            "lock":  {"siid": 5, "piid": 1},
        },
    },
]

DEVICE_MAP: dict[str, dict] = {d["id"]: d for d in DEVICES}


# ── Credential loading ────────────────────────────────────────────────────────

def _load_creds() -> dict[str, str]:
    """Return creds dict with keys user_id, service_token, ssecurity."""
    user_id       = os.environ.get("XIAOMI_USER_ID")
    service_token = os.environ.get("XIAOMI_SERVICE_TOKEN")
    ssecurity     = os.environ.get("XIAOMI_SSECURITY")

    if user_id and service_token and ssecurity:
        return {"user_id": user_id, "service_token": service_token, "ssecurity": ssecurity}

    if CREDS_PATH.exists():
        try:
            data = json.loads(CREDS_PATH.read_text())
            return {
                "user_id":       data.get("user_id") or data.get("userId"),
                "service_token": data.get("service_token") or data.get("serviceToken"),
                "ssecurity":     data["ssecurity"],
            }
        except Exception as exc:
            log.warning("Could not parse %s: %s", CREDS_PATH, exc)

    raise RuntimeError(
        "Xiaomi credentials not found. Set XIAOMI_USER_ID / XIAOMI_SERVICE_TOKEN / "
        "XIAOMI_SSECURITY env vars or provide F:/ai/air-quality/creds.json."
    )


def get_micloud() -> MiCloud:
    creds = _load_creds()
    mc = MiCloud(None, None)
    mc.user_id       = creds["user_id"]
    mc.service_token = creds["service_token"]
    mc.ssecurity     = creds["ssecurity"]
    return mc


# ── Property fetch / set ──────────────────────────────────────────────────────

def fetch_device_props(mc: MiCloud, device: dict) -> dict[str, Any]:
    """Fetch all known props for a device; returns a flat dict of label → value."""
    did  = device["did"]
    host = device["host"]
    url  = f"https://{host}/app/miotspec/prop/get"

    prop_list = [
        {"did": did, "siid": spec["siid"], "piid": spec["piid"]}
        for spec in device["props"].values()
    ]
    raw    = mc.request(url, {"data": json.dumps({"params": prop_list}, separators=(",", ":"))})
    result = json.loads(raw)

    values: dict[str, Any] = {}
    for label, spec in device["props"].items():
        for item in result.get("result", []):
            if item.get("siid") == spec["siid"] and item.get("piid") == spec["piid"]:
                if item.get("code", 0) == 0:
                    values[label] = item["value"]
                break

    return values


def set_device_prop(mc: MiCloud, did: str, host: str, siid: int, piid: int, value: Any) -> dict:
    """Set a single property; returns the raw result list."""
    url = f"https://{host}/app/miotspec/prop/set"
    params = [{"did": did, "siid": siid, "piid": piid, "value": value}]
    raw    = mc.request(url, {"data": json.dumps({"params": params}, separators=(",", ":"))})
    return json.loads(raw)
