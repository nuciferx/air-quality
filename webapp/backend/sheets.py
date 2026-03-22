"""
Google Sheets reader — returns recent air-quality readings.
Credentials from (priority order):
  1. GCP_SA_KEY env var (JSON string)
  2. F:/ai/air-quality/creds.json → key "gcp_sa_key" (dict)
"""

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import gspread

log = logging.getLogger(__name__)

CREDS_PATH = Path(__file__).resolve().parents[2] / "creds.json"


def _get_sheet():
    sheet_id = os.environ.get("SHEET_ID")

    sa_key_raw = os.environ.get("GCP_SA_KEY")
    if sa_key_raw:
        sa_key = json.loads(sa_key_raw)
    else:
        if CREDS_PATH.exists():
            data     = json.loads(CREDS_PATH.read_text())
            sa_key   = data["gcp_sa_key"]
            sheet_id = sheet_id or data.get("sheet_id")
        else:
            raise RuntimeError(
                "Google Sheets credentials not found. Set GCP_SA_KEY and SHEET_ID env vars."
            )

    if not sheet_id:
        raise RuntimeError("SHEET_ID not set.")

    gc = gspread.service_account_from_dict(sa_key)
    return gc.open_by_key(sheet_id).sheet1


def get_recent_readings(hours: int = 24) -> list[dict[str, Any]]:
    """
    Return all rows from the sheet that fall within the last `hours` hours.
    Expected columns: timestamp, device, pm25_ugm3, aqi, temperature_c,
                      humidity_pct, pm10_ugm3, power
    """
    ws   = _get_sheet()
    rows = ws.get_all_records()  # list of dicts keyed by header row

    now    = datetime.now(timezone.utc)
    result = []

    for row in rows:
        ts_str = row.get("timestamp", "")
        try:
            ts = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S UTC").replace(tzinfo=timezone.utc)
        except ValueError:
            try:
                ts = datetime.fromisoformat(ts_str)
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
            except ValueError:
                continue

        if (now - ts).total_seconds() <= hours * 3600:
            result.append(
                {
                    "timestamp":    ts.isoformat(),
                    "device":       row.get("device", ""),
                    "pm25":         _num(row.get("pm25_ugm3")),
                    "aqi":          _num(row.get("aqi")),
                    "temperature":  _num(row.get("temperature_c")),
                    "humidity":     _num(row.get("humidity_pct")),
                    "pm10":         _num(row.get("pm10_ugm3")),
                }
            )

    return result


def _num(v: Any):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
