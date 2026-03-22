"""
FastAPI backend for the Air Quality Dashboard.

Endpoints:
  GET  /api/devices          — fetch all 4 devices
  GET  /api/device/{id}      — fetch a single device
  POST /api/control          — set a property
  GET  /api/stream           — Server-Sent Events (30 s cadence)
  GET  /api/history          — last 24 h from Google Sheets
"""

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from xiaomi import DEVICE_MAP, DEVICES, fetch_device_props, get_micloud, set_device_prop
from sheets import get_recent_readings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# ── In-memory cache ───────────────────────────────────────────────────────────
_cache: dict[str, dict] = {}          # device_id → {values, fetched_at, online}
_cache_ttl = 25                        # seconds — slightly shorter than SSE cadence


# ── Startup background task ───────────────────────────────────────────────────

async def _background_poll():
    while True:
        try:
            await _refresh_all()
        except Exception as exc:
            log.error("Background poll error: %s", exc)
        await asyncio.sleep(30)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_background_poll())
    yield
    task.cancel()


app = FastAPI(title="Air Quality API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _refresh_all() -> list[dict]:
    loop   = asyncio.get_event_loop()
    mc     = await loop.run_in_executor(None, get_micloud)
    tasks  = [loop.run_in_executor(None, _fetch_one, mc, dev) for dev in DEVICES]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out = []
    for dev, res in zip(DEVICES, results):
        if isinstance(res, Exception):
            log.warning("Failed to fetch %s: %s", dev["id"], res)
            entry = {**_device_skeleton(dev), "online": False}
        else:
            entry = res
        _cache[dev["id"]] = entry
        out.append(entry)
    return out


def _fetch_one(mc, device: dict) -> dict:
    values = fetch_device_props(mc, device)
    return {
        "id":     device["id"],
        "name":   device["name"],
        "did":    device["did"],
        "host":   device["host"],
        "online": True,
        "values": values,
        "fetched_at": time.time(),
    }


def _device_skeleton(device: dict) -> dict:
    return {
        "id":         device["id"],
        "name":       device["name"],
        "did":        device["did"],
        "host":       device["host"],
        "online":     False,
        "values":     {},
        "fetched_at": time.time(),
    }


def _cached_or_skeleton(device: dict) -> dict:
    cached = _cache.get(device["id"])
    if cached:
        return cached
    return _device_skeleton(device)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/api/devices")
async def get_devices():
    if not _cache:
        data = await _refresh_all()
    else:
        data = [_cached_or_skeleton(d) for d in DEVICES]
    return {"devices": data}


@app.get("/api/device/{device_id}")
async def get_device(device_id: str):
    device = DEVICE_MAP.get(device_id)
    if not device:
        raise HTTPException(404, f"Unknown device id: {device_id}")

    loop   = asyncio.get_event_loop()
    mc     = await loop.run_in_executor(None, get_micloud)
    try:
        result = await loop.run_in_executor(None, _fetch_one, mc, device)
    except Exception as exc:
        log.error("Error fetching %s: %s", device_id, exc)
        raise HTTPException(502, str(exc))

    _cache[device_id] = result
    return result


class ControlRequest(BaseModel):
    did:   str
    host:  str
    siid:  int
    piid:  int
    value: Any


@app.post("/api/control")
async def control(req: ControlRequest):
    loop = asyncio.get_event_loop()
    mc   = await loop.run_in_executor(None, get_micloud)
    try:
        result = await loop.run_in_executor(
            None, set_device_prop, mc, req.did, req.host, req.siid, req.piid, req.value
        )
    except Exception as exc:
        log.error("Control error: %s", exc)
        raise HTTPException(502, str(exc))

    # Invalidate cache for this device so the next poll returns fresh data
    for dev in DEVICES:
        if dev["did"] == req.did:
            _cache.pop(dev["id"], None)
            break

    return {"ok": True, "result": result}


@app.get("/api/stream")
async def stream(request: Request):
    async def event_generator():
        while True:
            if await request.is_disconnected():
                break
            try:
                data = await _refresh_all()
                payload = json.dumps({"devices": data})
                yield f"data: {payload}\n\n"
            except Exception as exc:
                log.error("SSE error: %s", exc)
                yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            await asyncio.sleep(30)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/history")
async def history(hours: int = 24):
    loop = asyncio.get_event_loop()
    try:
        rows = await loop.run_in_executor(None, get_recent_readings, hours)
    except Exception as exc:
        log.error("Sheets error: %s", exc)
        raise HTTPException(502, str(exc))
    return {"rows": rows}


@app.get("/health")
async def health():
    return {"status": "ok"}
