# Air Quality Dashboard

A full-stack web app for monitoring and controlling 4 Xiaomi air purifiers.
No Python server required — the entire backend runs as a **Cloudflare Worker**.

| Layer | Technology | Hosting |
|-------|-----------|---------|
| API   | Cloudflare Worker (TypeScript) | Cloudflare (free tier) |
| Frontend | Next.js 14 (App Router + TypeScript + Tailwind) | Vercel |
| History | Google Sheets (append via Sheets REST API) | Google |

---

## Live URLs

| Service | URL |
|---------|-----|
| Frontend | https://air-quality-nucifer.vercel.app |
| Worker API | https://air-quality-api.ideaplanstudio.workers.dev |
| Google Sheet | https://docs.google.com/spreadsheets/d/1Gi1A-6YHoVOyvaDy_jk3eARSlmTWqRrDrOXVamm4O_Y |

Vercel project: `nuciferxs-projects / air-quality-nucifer`
Cloudflare account: `ideaplanstudio@gmail.com`

---

## Architecture

```
Browser → Vercel (Next.js) → Cloudflare Worker → Xiaomi MiCloud API
                                    ↓ (cron every 5 min)
                              Google Sheets (history log)
```

The Cloudflare Worker reimplements the micloud RC4-encrypted signing protocol
in TypeScript using the Web Crypto API. No Python, no pip, no uvicorn.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Worker + frontend build |
| npm | 9+ | Package manager |
| wrangler | 3+ | Deploy Cloudflare Worker (`npm i -g wrangler`) |
| Vercel CLI | latest | Deploy frontend (`npm i -g vercel`) |

---

## Deployment (new machine setup)

### Step 1 — Authenticate

```bash
# Cloudflare
cd webapp/worker
npx wrangler login

# Vercel
cd webapp/frontend
npx vercel login
```

### Step 2 — Set Cloudflare Worker secrets

```bash
cd webapp/worker
npx wrangler secret put XIAOMI_USER_ID
npx wrangler secret put XIAOMI_SERVICE_TOKEN
npx wrangler secret put XIAOMI_SSECURITY
npx wrangler secret put GCP_SA_KEY      # full JSON content of GCP service account key
npx wrangler secret put SHEET_ID        # Google Sheet ID (from the sheet URL)
```

Values are in `F:\Other computers\My Laptop\ai\air-quality\creds.json` (Xiaomi)
and `F:\Other computers\My Laptop\ai\air-quality\nucifer-data-sheet-api-cbfb9be2a194.json` (GCP).

`SHEET_ID` = `1Gi1A-6YHoVOyvaDy_jk3eARSlmTWqRrDrOXVamm4O_Y`

### Step 3 — Deploy the Worker

```bash
cd webapp/worker
npm install
npx wrangler deploy
```

Worker URL: `https://air-quality-api.ideaplanstudio.workers.dev`

### Step 4 — Link frontend to Vercel project

```bash
cd webapp/frontend
npx vercel link --project air-quality-nucifer --scope nuciferxs-projects --yes
```

### Step 5 — Set frontend env var

```bash
npx vercel env add NEXT_PUBLIC_API_URL production --value "https://air-quality-api.ideaplanstudio.workers.dev" --yes
```

### Step 6 — Deploy the frontend

```bash
npx vercel --prod --yes
```

---

## Local Development

### Option A — Worker + Frontend (fully serverless)

```bash
# Terminal 1: run the worker locally
cd webapp/worker
npm install
npx wrangler dev
# Worker available at http://localhost:8787

# Terminal 2: run the frontend pointing at local worker
cd webapp/frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8787 npm run dev
```

### Option B — Legacy FastAPI backend (Python)

```bash
# Terminal 1: FastAPI
cd webapp/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Terminal 2: frontend (no NEXT_PUBLIC_API_URL → proxies to localhost:8000)
cd webapp/frontend
npm install
npm run dev
```

---

## API Reference

All endpoints are served by the Cloudflare Worker.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/devices` | Fetch all devices (live from Xiaomi) |
| GET | `/api/device/:id` | Fetch a single device by id |
| POST | `/api/control` | Set a property on a device |
| GET | `/api/stream` | Server-Sent Events — pushes device data every 30 s |
| GET | `/api/history?hours=N` | History rows from Google Sheets (default 24h) |
| GET | `/health` | Health check |

### POST /api/control body

```json
{
  "did":   "873639853",
  "host":  "sg.api.io.mi.com",
  "siid":  2,
  "piid":  1,
  "value": true
}
```

---

## Pages

| URL | Description |
|-----|-------------|
| `/` | Dashboard — device cards with inline controls, auto-refreshes via SSE |
| `/history` | History — PM2.5 line chart + data table (from Google Sheets) |

---

## Devices & Property Mappings (siid/piid)

> Source: miot-spec.org — confirmed by live `/api/debug-props` on each device.

### 4 Lite — `zhimi.airp.rmb1` (did: 873639853, host: sg.api.io.mi.com)

| Property | siid | piid | Notes |
|----------|------|------|-------|
| power    | 2    | 1    | bool |
| mode     | 2    | 4    | 0=Auto, 1=Sleep, 2=Favorite, 3=Fan |
| pm25     | 3    | 4    | µg/m³ |
| hum      | 3    | 1    | % |
| temp     | 3    | 7    | °C |
| filter   | 4    | 1    | % remaining |
| fan      | 9    | 11   | Favorite Level 1–14 |
| buzz     | 6    | 1    | bool |
| lock     | 8    | 1    | bool (child lock) |

### MAX Pro — `zhimi.airpurifier.sa2` (did: 460764069, host: api.io.mi.com)

| Property | siid | piid | Notes |
|----------|------|------|-------|
| power    | 2    | 1    | bool |
| mode     | 2    | 2    | 0=Auto, 1=Sleep, 2=Favorite, 3=L1, 4=L2, 5=L3 |
| pm25     | 3    | 2    | µg/m³ |
| hum      | 3    | 1    | % |
| temp     | 3    | 3    | °C |
| filter   | 4    | 1    | % remaining |
| buzz     | 7    | 1    | bool |
| lock     | 8    | 1    | bool |

### MAX ชั้นล่าง — `zhimi.airpurifier.sb1` (did: 131590393, host: api.io.mi.com)

Same mappings as MAX Pro above.

### แมว — `zhimi.airpurifier.v7` (did: 357231085, host: api.io.mi.com)

| Property | siid | piid | Notes |
|----------|------|------|-------|
| power    | 2    | 1    | bool |
| mode     | 2    | 2    | 0=Auto, 1=Sleep, 2=Favorite |
| pm25     | 3    | 2    | µg/m³ |
| hum      | 3    | 1    | % |
| temp     | 3    | 3    | °C |
| filter   | 4    | 1    | % remaining |
| buzz     | 6    | 1    | bool |
| lock     | 5    | 1    | bool |

---

## Google Sheets History Logging

The Worker cron (`*/5 * * * *`) calls `logDevicesToSheets` which:

1. Fetches all device readings from Xiaomi
2. Generates a Google OAuth2 token via RS256 JWT (Web Crypto API) using the GCP service account key
3. Appends a row per device to the Google Sheet

Sheet columns: `timestamp | device | pm25 | aqi | temperature | humidity | pm10`

The GCP service account (`nucifer-data-sheet-api@...`) must have **Editor** access on the sheet.

---

## Signing Protocol (MiCloud)

The Worker reimplements the micloud RC4 signing protocol:

1. `genNonce()` — 8 random bytes + uint32 BE of `floor(Date.now()/60000)`, base64-encoded
2. `signedNonce(ssecurity, nonce)` — SHA-256 of `b64decode(ssecurity) ‖ b64decode(nonce)`, base64-encoded
3. `rc4(key, data)` — standard RC4 with **1024-byte drop** (matches PyCryptodome ARC4 + `encrypt(bytes(1024))` skip)
4. `generateEncParams(...)` — RC4-encrypts each param value, signs twice with SHA-1, adds `ssecurity` and `_nonce`
5. Response — RC4-decrypted with `b64decode(signedNonce(ssecurity, _nonce))`

All crypto uses the Web Crypto API (`crypto.subtle`) — no external dependencies.

---

## Credentials

### Cloudflare Worker Secrets

| Secret | Description |
|--------|-------------|
| `XIAOMI_USER_ID` | Numeric Xiaomi user ID |
| `XIAOMI_SERVICE_TOKEN` | Long-lived session token from Mi Home app |
| `XIAOMI_SSECURITY` | Base64-encoded security key |
| `GCP_SA_KEY` | Full JSON of GCP service account key (for Sheets) |
| `SHEET_ID` | Google Sheet ID |

To rotate: `npx wrangler secret put <NAME>` then `npx wrangler deploy`

### Vercel Environment Variables

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://air-quality-api.ideaplanstudio.workers.dev` |

---

## Notes

- **Python micloud library fails on new machines** — DNS resolution for `sg.api.io.mi.com` may not work via the Python library on Windows. The Cloudflare Worker approach bypasses this entirely.
- **Sheet name is "ชีต1"** (Thai locale default), not "Sheet1". The worker fetches the sheet name dynamically from the metadata API before appending rows.
- **4 Lite fan slider** only appears in the dashboard when mode = Favorite (2), since fan speed control only applies in that mode.
