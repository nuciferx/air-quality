"""
Fetch all device readings from the CF Worker API, then POST them to /api/log
to persist in D1. Called by GitHub Actions every hour.

Required environment variable:
  LOG_SECRET  — shared secret that authenticates the /api/log request
"""

import os
import sys
import requests

API = "https://air-quality-api.ideaplanstudio.workers.dev"

def main():
    secret = os.environ.get("LOG_SECRET")
    if not secret:
        print("ERROR: LOG_SECRET environment variable not set", file=sys.stderr)
        sys.exit(1)

    # 1. Fetch current readings from the Worker (which holds the Xiaomi creds)
    devices_resp = requests.get(f"{API}/api/devices", timeout=30)
    devices_resp.raise_for_status()
    devices = devices_resp.json()["devices"]

    # 2. Build the readings payload
    readings = [
        {
            "device_id":   d["id"],
            "device_name": d["name"],
            "pm25":        d["values"].get("pm25"),
            "pm10":        d["values"].get("pm10"),
            "aqi":         d["values"].get("aqi"),
            "temperature": d["values"].get("temp"),
            "humidity":    d["values"].get("hum"),
            "power":       d["values"].get("power"),
        }
        for d in devices
    ]

    print(f"Fetched {len(readings)} device(s):")
    for r in readings:
        print(f"  {r['device_name']}: pm25={r['pm25']} aqi={r['aqi']} temp={r['temperature']} hum={r['humidity']}")

    # 3. POST to /api/log
    resp = requests.post(
        f"{API}/api/log",
        json={"secret": secret, "readings": readings},
        timeout=30,
    )
    resp.raise_for_status()
    result = resp.json()
    print(f"Logged: {result}")

if __name__ == "__main__":
    main()
