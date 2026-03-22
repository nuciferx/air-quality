# Air Quality Dashboard

A full-stack web app for monitoring and controlling 4 Xiaomi air purifiers.
No Python server required — the entire backend runs as a **Cloudflare Worker**.

| Layer | Technology | Hosting |
|-------|-----------|---------|
| API   | Cloudflare Worker (TypeScript) | Cloudflare (free tier) |
| Frontend | Next.js 14 (App Router + TypeScript + Tailwind) | Vercel |

---

## Architecture

```
Browser → Vercel (Next.js) → Cloudflare Worker → Xiaomi MiCloud API
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

## Deployment

### Step 1 — Authenticate with Cloudflare

```bash
wrangler login
```

### Step 2 — Set Xiaomi secrets in the Worker

```bash
cd webapp/worker
wrangler secret put XIAOMI_USER_ID
wrangler secret put XIAOMI_SERVICE_TOKEN
wrangler secret put XIAOMI_SSECURITY
```

Each command prompts for the value interactively (not stored in any file).

### Step 3 — Deploy the Worker

```bash
cd webapp/worker
npm install
wrangler deploy
```

Note the worker URL printed at the end, e.g.:
`https://air-quality-api.YOUR_SUBDOMAIN.workers.dev`

### Step 4 — Configure the frontend

Set the worker URL as an environment variable in Vercel:

```bash
cd webapp/frontend
vercel env add NEXT_PUBLIC_API_URL
# paste: https://air-quality-api.YOUR_SUBDOMAIN.workers.dev
```

Or set it in the Vercel dashboard under Project → Settings → Environment Variables.

### Step 5 — Deploy the frontend

```bash
cd webapp/frontend
npm install
vercel --prod
```

### One-command deploy (after initial setup)

```bash
cd webapp
bash deploy.sh
```

---

## Local Development

### Option A — Worker + Frontend (fully serverless)

```bash
# Terminal 1: run the worker locally
cd webapp/worker
npm install
wrangler dev
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
| GET | `/api/devices` | Fetch all 4 devices (live from Xiaomi) |
| GET | `/api/device/:id` | Fetch a single device by id |
| POST | `/api/control` | Set a property on a device |
| GET | `/api/stream` | Server-Sent Events — pushes device data every 30 s |
| GET | `/health` | Health check |

### POST /api/control body

```json
{
  "did":   "873639853",
  "host":  "sg",
  "siid":  2,
  "piid":  1,
  "value": true
}
```

`host` is either `"sg"` (Singapore server) or `"cn"` (China server).

---

## Pages

| URL | Description |
|-----|-------------|
| `/` | Dashboard — 4 device cards, auto-refreshes via SSE |
| `/control` | Control Panel — power, mode, fan speed, buzzer per device |
| `/history` | History — PM2.5 line chart + data table |

---

## Signing Protocol

The Worker reimplements the micloud RC4 signing protocol:

1. `genNonce()` — 8 random bytes + uint32 BE of `floor(Date.now()/60000)`, base64-encoded
2. `signedNonce(ssecurity, nonce)` — SHA-256 of `b64decode(ssecurity) ‖ b64decode(nonce)`, base64-encoded
3. `rc4(key, data)` — standard RC4 with **1024-byte drop** (matches PyCryptodome ARC4 + `encrypt(bytes(1024))` skip)
4. `generateEncParams(...)` — RC4-encrypts each param value, signs twice with SHA-1, adds `ssecurity` and `_nonce`
5. Response — RC4-decrypted with `b64decode(signedNonce(ssecurity, _nonce))`

All crypto uses the Web Crypto API (`crypto.subtle`) — no external dependencies.

---

## Credentials

Xiaomi credentials are stored as Cloudflare Worker secrets (never in source code):

| Secret | Description |
|--------|-------------|
| `XIAOMI_USER_ID` | Numeric Xiaomi user ID |
| `XIAOMI_SERVICE_TOKEN` | Long-lived session token from Mi Home app |
| `XIAOMI_SSECURITY` | Base64-encoded security key |

To rotate credentials: `wrangler secret put <NAME>` and `wrangler deploy`.
