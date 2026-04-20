/**
 * Cloudflare Worker — Air Quality API
 *
 * Reimplements the micloud RC4-encrypted request protocol in TypeScript
 * so no Python server is needed. All Xiaomi MiCloud signing happens here.
 *
 * Secrets (set via: wrangler secret put <NAME>):
 *   XIAOMI_USER_ID        — numeric user id string
 *   XIAOMI_SERVICE_TOKEN  — serviceToken cookie value
 *   XIAOMI_SSECURITY      — base64-encoded ssecurity value
 *   LOG_SECRET            — shared secret for /api/log (set via: wrangler secret put LOG_SECRET)
 */

export interface Env {
  XIAOMI_USER_ID: string;
  XIAOMI_SERVICE_TOKEN: string;
  XIAOMI_SSECURITY: string;
  LOG_SECRET: string;
  DB: D1Database;
  CREDS_KV: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

// ── Device catalogue ──────────────────────────────────────────────────────────

interface PropSpec {
  siid: number;
  piid: number;
}

interface DeviceConfig {
  id: string;
  name: string;
  did: string;
  host: "sg" | "cn";
  props: Record<string, PropSpec>;
}

const DEVICES: DeviceConfig[] = [
  {
    // zhimi.airp.rmb1 — Xiaomi Air Purifier 4 Lite
    id: "4lite",
    name: "ห้องทำงาน",
    did: "873639853",
    host: "sg",
    props: {
      power:  { siid: 2, piid: 1  },  // bool
      mode:   { siid: 2, piid: 4  },  // 0=Auto 1=Sleep 2=Favorite 3=Fan
      hum:    { siid: 3, piid: 1  },  // %RH (verified: display matches)
      pm25:   { siid: 3, piid: 4  },  // µg/m³ (verified: display matches)
      temp:   { siid: 3, piid: 7  },  // °C
      filter: { siid: 4, piid: 1  },  // % remaining
      buzz:   { siid: 6, piid: 1  },  // bool
      lock:   { siid: 8, piid: 1  },  // bool (child lock)
    },
  },
  {
    // zhimi.airpurifier.sa2 — Xiaomi Air Purifier MAX Pro
    id: "maxpro",
    name: "ห้องนอนชั้น 2",
    did: "460764069",
    host: "cn",
    props: {
      power:  { siid: 2, piid: 1  },  // bool
      mode:   { siid: 2, piid: 2  },  // 0=Auto 1=Sleep 2=Favorite
      pm25:   { siid: 3, piid: 1  },  // AQI/PM2.5 (older models: aqi at piid:1)
      temp:   { siid: 3, piid: 3  },  // °C
      filter: { siid: 4, piid: 1  },  // % remaining
      buzz:   { siid: 7, piid: 1  },  // bool
      lock:   { siid: 8, piid: 1  },  // bool
    },
  },
  {
    // zhimi.airpurifier.sb1 — Xiaomi Air Purifier MAX (same mappings as sa2)
    id: "maxdown",
    name: "โถงชั้นล่าง",
    did: "131590393",
    host: "cn",
    props: {
      power:  { siid: 2, piid: 1  },
      mode:   { siid: 2, piid: 2  },
      pm25:   { siid: 3, piid: 1  },  // AQI/PM2.5
      temp:   { siid: 3, piid: 3  },  // °C
      filter: { siid: 4, piid: 1  },
      buzz:   { siid: 7, piid: 1  },
      lock:   { siid: 8, piid: 1  },
    },
  },
  {
    // zhimi.airpurifier.v7 — Xiaomi Air Purifier (cat room)
    id: "cat",
    name: "ห้องแมวชั้น 2",
    did: "357231085",
    host: "cn",
    props: {
      power:  { siid: 2, piid: 1  },
      mode:   { siid: 2, piid: 2  },
      pm25:   { siid: 3, piid: 1  },  // AQI/PM2.5
      temp:   { siid: 3, piid: 3  },  // °C
      filter: { siid: 4, piid: 1  },
      buzz:   { siid: 6, piid: 1  },
      lock:   { siid: 5, piid: 1  },
    },
  },
];

const DEVICE_MAP = new Map<string, DeviceConfig>(DEVICES.map((d) => [d.id, d]));

// ── URL helpers ───────────────────────────────────────────────────────────────

function apiUrl(host: "sg" | "cn", path: "/app/miotspec/prop/get" | "/app/miotspec/prop/set"): string {
  const base = host === "sg" ? "https://sg.api.io.mi.com" : "https://api.io.mi.com";
  return `${base}${path}`;
}

// ── Base64 helpers (Web Crypto compatible) ────────────────────────────────────

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str);
}

function b64decode(s: string): Uint8Array {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── RC4 implementation (with 1024-byte drop, matching micloud) ─────────────────
//
// The micloud Python library does:
//   r = ARC4.new(key)
//   r.encrypt(bytes(1024))   # discard first 1024 keystream bytes
//   return r.encrypt(payload)
//
// This is RC4-drop1024.

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  // Key-scheduling algorithm (KSA)
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    const tmp = S[i]; S[i] = S[j]; S[j] = tmp;
  }

  // Pseudo-random generation algorithm (PRGA)
  let i2 = 0;
  let j2 = 0;

  // Drop 1024 bytes (match micloud ARC4 behaviour)
  for (let k = 0; k < 1024; k++) {
    i2 = (i2 + 1) & 0xff;
    j2 = (j2 + S[i2]) & 0xff;
    const tmp = S[i2]; S[i2] = S[j2]; S[j2] = tmp;
  }

  // Encrypt / decrypt data
  const out = new Uint8Array(data.length);
  for (let k = 0; k < data.length; k++) {
    i2 = (i2 + 1) & 0xff;
    j2 = (j2 + S[i2]) & 0xff;
    const tmp = S[i2]; S[i2] = S[j2]; S[j2] = tmp;
    out[k] = data[k] ^ S[(S[i2] + S[j2]) & 0xff];
  }
  return out;
}

// ── Xiaomi signing primitives ─────────────────────────────────────────────────

/**
 * gen_nonce() — matches micloud miutils.gen_nonce()
 *
 * Python:
 *   millis = int(round(time.time() * 1000))
 *   b = (random.getrandbits(64) - 2**63).to_bytes(8, 'big', signed=True)
 *   part2 = int(millis / 60000)
 *   b += part2.to_bytes(((part2.bit_length()+7)//8), 'big')
 *
 * Note: the second part is a variable-length big-endian encoding of
 * floor(millis/60000). We use 4 bytes (uint32 BE) which is sufficient
 * for many decades. The Python code uses variable length; 4 bytes is
 * equivalent as long as the value fits, which it does until year ~2439.
 */
async function genNonce(): Promise<string> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(8));
  const millis = Date.now();
  const minutesSinceEpoch = Math.floor(millis / 60000);

  // Encode minutesSinceEpoch as 4-byte big-endian uint32
  const timePart = new Uint8Array(4);
  const view = new DataView(timePart.buffer);
  view.setUint32(0, minutesSinceEpoch >>> 0, false); // big-endian

  const nonce = new Uint8Array(12);
  nonce.set(randomBytes, 0);
  nonce.set(timePart, 8);

  return b64encode(nonce);
}

/**
 * signed_nonce() — matches micloud miutils.signed_nonce()
 *
 * SHA256(b64decode(ssecurity) + b64decode(nonce)) → base64
 */
async function signedNonce(ssecurity: string, nonce: string): Promise<string> {
  const secBytes = b64decode(ssecurity);
  const nonceBytes = b64decode(nonce);

  const combined = new Uint8Array(secBytes.length + nonceBytes.length);
  combined.set(secBytes, 0);
  combined.set(nonceBytes, secBytes.length);

  const digest = await crypto.subtle.digest("SHA-256", combined);
  return b64encode(digest);
}

/**
 * gen_enc_signature() — matches micloud miutils.gen_enc_signature()
 *
 * Python:
 *   signature_params = [method.upper(), url.split("com")[1].replace("/app/", "/")]
 *   for k, v in params.items(): signature_params.append(f"{k}={v}")
 *   signature_params.append(signed_nonce)
 *   signature_string = "&".join(signature_params)
 *   return base64.b64encode(hashlib.sha1(signature_string.encode()).digest()).decode()
 *
 * Note: the url path is everything after "com", with "/app/" replaced by "/".
 * For "https://sg.api.io.mi.com/app/miotspec/prop/get" →
 *   split("com")[1] = "/app/miotspec/prop/get"
 *   replace("/app/", "/") = "/miotspec/prop/get"
 */
async function genEncSignature(
  url: string,
  method: string,
  snonce: string,
  params: Record<string, string>
): Promise<string> {
  const pathPart = url.split("com")[1].replace("/app/", "/");
  const parts: string[] = [method.toUpperCase(), pathPart];
  for (const [k, v] of Object.entries(params)) {
    parts.push(`${k}=${v}`);
  }
  parts.push(snonce);

  const signString = parts.join("&");
  const encoded = new TextEncoder().encode(signString);
  const digest = await crypto.subtle.digest("SHA-1", encoded);
  return b64encode(digest);
}

/**
 * generate_enc_params() — matches micloud miutils.generate_enc_params()
 *
 * 1. Compute rc4_hash__ signature over initial params
 * 2. Add rc4_hash__ to params
 * 3. RC4-encrypt every param value (with signed_nonce as key)
 * 4. Add signature (second enc signature over encrypted params), ssecurity, _nonce
 */
async function generateEncParams(
  url: string,
  snonce: string,
  nonce: string,
  params: Record<string, string>,
  ssecurity: string
): Promise<Record<string, string>> {
  const rc4Key = b64decode(snonce);

  // Step 1: compute rc4_hash__ over original params
  const rc4Hash = await genEncSignature(url, "POST", snonce, params);

  // Step 2: add rc4_hash__ to params, then encrypt all values
  const withHash: Record<string, string> = { ...params, rc4_hash__: rc4Hash };
  const encrypted: Record<string, string> = {};
  for (const [k, v] of Object.entries(withHash)) {
    const plaintext = new TextEncoder().encode(v);
    const ciphertext = rc4(rc4Key, plaintext);
    encrypted[k] = b64encode(ciphertext);
  }

  // Step 3: compute signature over encrypted params
  const signature = await genEncSignature(url, "POST", snonce, encrypted);

  return {
    ...encrypted,
    signature,
    ssecurity,
    _nonce: nonce,
  };
}

/**
 * decrypt_rc4() — matches micloud miutils.decrypt_rc4()
 *
 * Key: b64decode(signedNonce)
 * Payload: b64decode(responseText) — then RC4-decrypt with 1024-byte drop
 */
function decryptRc4(snonce: string, responseText: string): string {
  const key = b64decode(snonce);
  const ciphertext = b64decode(responseText);
  const plaintext = rc4(key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ── Core Xiaomi request ───────────────────────────────────────────────────────

interface XiaomiCreds {
  userId: string;
  serviceToken: string;
  ssecurity: string;
}

async function xiaomiRequest(
  url: string,
  dataJson: string,
  creds: XiaomiCreds
): Promise<unknown> {
  const { userId, serviceToken, ssecurity } = creds;

  const nonce = await genNonce();
  const snonce = await signedNonce(ssecurity, nonce);

  const params: Record<string, string> = { data: dataJson };
  const encParams = await generateEncParams(url, snonce, nonce, params, ssecurity);

  // Build URL-encoded body
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(encParams)) {
    body.append(k, v);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "APP/com.xiaomi.mihome APPV/6.0.103",
      "Accept-Encoding": "identity",
      "x-xiaomi-protocal-flag-cli": "PROTOCAL-HTTP2",
      "MIOT-ENCRYPT-ALGORITHM": "ENCRYPT-RC4",
      Cookie: `userId=${userId}; serviceToken=${serviceToken}; yetAnotherServiceToken=${serviceToken}; locale=th_TH`,
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    if (isTokenExpiredError(errText) || response.status === 401 || response.status === 403) {
      throw new Error(`TOKEN_EXPIRED: ${response.status} ${errText.substring(0, 200)}`);
    }
    throw new Error(`Xiaomi API error: ${response.status} ${response.statusText}`);
  }

  const responseText = await response.text();

  // Decrypt with the signed_nonce derived from _nonce that was actually sent
  const actualNonce = encParams["_nonce"];
  const decryptSnonce = await signedNonce(ssecurity, actualNonce);
  const decrypted = decryptRc4(decryptSnonce, responseText);

  return JSON.parse(decrypted);
}

// ── Device data helpers ───────────────────────────────────────────────────────

interface PropResult {
  did: string;
  siid: number;
  piid: number;
  code: number;
  value?: unknown;
}

async function fetchDeviceProps(
  device: DeviceConfig,
  creds: XiaomiCreds
): Promise<Record<string, unknown>> {
  const url = apiUrl(device.host, "/app/miotspec/prop/get");
  const propList = Object.values(device.props).map((spec) => ({
    did: device.did,
    siid: spec.siid,
    piid: spec.piid,
  }));

  const dataJson = JSON.stringify({ params: propList });
  const result = (await xiaomiRequest(url, dataJson, creds)) as {
    result?: PropResult[];
  };

  const values: Record<string, unknown> = {};
  for (const [label, spec] of Object.entries(device.props)) {
    const item = result.result?.find(
      (r) => r.siid === spec.siid && r.piid === spec.piid
    );
    if (item && item.code === 0) {
      values[label] = item.value;
    }
  }
  return values;
}

function deviceSkeleton(device: DeviceConfig, online = false) {
  return {
    id: device.id,
    name: device.name,
    did: device.did,
    host: device.host,
    online,
    values: {} as Record<string, unknown>,
    fetched_at: Date.now() / 1000,
  };
}

async function fetchOneDevice(device: DeviceConfig, creds: XiaomiCreds) {
  const values = await fetchDeviceProps(device, creds);
  return {
    id: device.id,
    name: device.name,
    did: device.did,
    host: device.host,
    online: true,
    values,
    fetched_at: Date.now() / 1000,
  };
}

// ── CORS headers ──────────────────────────────────────────────────────────────

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

function errorResponse(message: string, status: number, origin: string | null = null): Response {
  return jsonResponse({ error: message }, status, origin);
}

// ── In-memory cache ───────────────────────────────────────────────────────────
//
// Cloudflare Workers don't share memory between requests, but for the SSE
// stream (which runs in a single request) we hold state in closure.
// For regular GET requests we have no persistent cache — each request hits
// Xiaomi. The cache below is request-scoped: used to avoid duplicate fetches
// within one /api/devices call.

// ── Auto-control thresholds ───────────────────────────────────────────────────

const PM25_DANGER = 35;  // µg/m³ — เกินนี้ → เปิดแรงสุดทุกเครื่อง
const PM25_SAFE   = 15;  // µg/m³ — ต่ำกว่านี้ → กลับ Auto mode

// ── Telegram helper ───────────────────────────────────────────────────────────

async function sendTelegram(env: Env, message: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
      }),
    });
  } catch {
    // Telegram failure should not break the main flow
  }
}

// ── Auto-control: set power + mode for all devices ───────────────────────────

async function setAllDevices(
  creds: XiaomiCreds,
  power: boolean,
  mode: number   // 0=Auto  2=Favorite (แรงสุด)
): Promise<void> {
  await Promise.allSettled(
    DEVICES.map(async (device) => {
      const modeSpec = device.props["mode"];
      const powerSpec = device.props["power"];
      const url = apiUrl(device.host, "/app/miotspec/prop/set");

      const props = [{ did: device.did, siid: powerSpec.siid, piid: powerSpec.piid, value: power }];
      if (power && modeSpec) {
        props.push({ did: device.did, siid: modeSpec.siid, piid: modeSpec.piid, value: mode });
      }

      await xiaomiRequest(url, JSON.stringify({ params: props }), creds);
    })
  );
}

// ── Auto-control logic (called from cron) ─────────────────────────────────────

async function checkAndControl(
  env: Env,
  creds: XiaomiCreds,
  devices: Array<{ name: string; online: boolean; values: Record<string, unknown> }>
): Promise<void> {
  // รวบรวม PM2.5 ทุกห้องที่ online
  const pm25Values = devices
    .filter((d) => d.online && typeof d.values.pm25 === "number")
    .map((d) => ({ name: d.name, pm25: d.values.pm25 as number }));

  if (pm25Values.length === 0) return;

  const maxPm25  = Math.max(...pm25Values.map((d) => d.pm25));
  const worstRoom = pm25Values.find((d) => d.pm25 === maxPm25)!;

  // อ่าน state ปัจจุบันจาก KV
  const stateRaw   = await env.CREDS_KV.get("auto_control_active").catch(() => null);
  const isActive   = stateRaw === "1";

  if (maxPm25 >= PM25_DANGER && !isActive) {
    // 🔴 เกิน threshold → เปิดแรงสุด
    await setAllDevices(creds, true, 2);
    await env.CREDS_KV.put("auto_control_active", "1");

    const lines = pm25Values.map((d) => `  ${d.name}: ${d.pm25} µg/m³`).join("\n");
    await sendTelegram(env,
      `🔴 <b>ฝุ่นเกินมาตรฐาน!</b>\n\n${lines}\n\n` +
      `⚡ เปิดเครื่องกรองอากาศแรงสุดทุกห้องแล้ว\n` +
      `(จะกลับ Auto เมื่อ PM2.5 &lt; ${PM25_SAFE} µg/m³)`
    );

  } else if (maxPm25 < PM25_SAFE && isActive) {
    // 🟢 ปลอดภัยแล้ว → กลับ Auto mode
    await setAllDevices(creds, true, 0);
    await env.CREDS_KV.put("auto_control_active", "0");

    const lines = pm25Values.map((d) => `  ${d.name}: ${d.pm25} µg/m³`).join("\n");
    await sendTelegram(env,
      `🟢 <b>อากาศปลอดภัยแล้ว</b>\n\n${lines}\n\n` +
      `✅ กลับ Auto mode ทุกห้องแล้ว`
    );
  }
}

// ── D1 logging helper ─────────────────────────────────────────────────────────

async function logDevicesToD1(env: Env): Promise<void> {
  const creds = await loadCreds(env);
  if (!creds) return;

  const results = await Promise.allSettled(DEVICES.map((d) => fetchOneDevice(d, creds)));
  const ts = Math.floor(Date.now() / 1000);

  const devices = results.map((r, i) =>
    r.status === "fulfilled" ? r.value : { ...DEVICES[i], online: false, values: {}, fetched_at: ts }
  );

  // บันทึก D1
  const stmt = env.DB.prepare(
    `INSERT INTO readings (ts, device_id, device_name, pm25, pm10, aqi, temperature, humidity, power)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const inserts = devices
    .filter((d) => d.online)
    .map((d) =>
      stmt.bind(
        ts,
        d.id,
        d.name,
        d.values.pm25   ?? null,
        d.values.pm10   ?? null,
        d.values.aqi    ?? null,
        d.values.temp   ?? null,
        d.values.hum    ?? null,
        d.values.power  != null ? (d.values.power ? 1 : 0) : null,
      )
    );

  if (inserts.length > 0) await env.DB.batch(inserts);

  // ตรวจสอบ PM2.5 และควบคุมอัตโนมัติ
  await checkAndControl(env, creds, devices);
}

// ── Credential management (KV-backed with fallback to secrets) ────────────────

interface StoredCreds {
  userId: string;
  serviceToken: string;
  ssecurity: string;
  updatedAt: number; // unix timestamp
}

async function loadCreds(env: Env): Promise<XiaomiCreds | null> {
  // Try KV first
  if (env.CREDS_KV) {
    try {
      const raw = await env.CREDS_KV.get("xiaomi_creds");
      if (raw) {
        const parsed = JSON.parse(raw) as StoredCreds;
        return {
          userId: parsed.userId,
          serviceToken: parsed.serviceToken,
          ssecurity: parsed.ssecurity,
        };
      }
    } catch {
      // KV read failed, fall through to secrets
    }
  }

  // Fallback to wrangler secrets
  if (env.XIAOMI_USER_ID && env.XIAOMI_SERVICE_TOKEN && env.XIAOMI_SSECURITY) {
    return {
      userId: env.XIAOMI_USER_ID,
      serviceToken: env.XIAOMI_SERVICE_TOKEN,
      ssecurity: env.XIAOMI_SSECURITY,
    };
  }

  return null;
}

function isTokenExpiredError(responseText: string): boolean {
  // Xiaomi returns various indicators when token is expired
  const lower = responseText.toLowerCase();
  return (
    lower.includes("token") ||
    lower.includes("auth") ||
    lower.includes("login") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden")
  );
}

async function saveCredsToKV(env: Env, creds: XiaomiCreds): Promise<boolean> {
  if (!env.CREDS_KV) return false;
  try {
    const stored: StoredCreds = {
      userId: creds.userId,
      serviceToken: creds.serviceToken,
      ssecurity: creds.ssecurity,
      updatedAt: Math.floor(Date.now() / 1000),
    };
    await env.CREDS_KV.put("xiaomi_creds", JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

// ── Request router ────────────────────────────────────────────────────────────

export default {
  // Cron trigger: log all devices to D1 every 5 minutes
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(logDevicesToD1(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const path = url.pathname;

    // GET /api/history?hours=24&device=all
    if (request.method === "GET" && path === "/api/history") {
      const hours  = parseInt(url.searchParams.get("hours")  ?? "24",  10) || 24;
      const device = url.searchParams.get("device") ?? "all";
      const since  = Math.floor(Date.now() / 1000) - hours * 3600;

      const result = device === "all"
        ? await env.DB.prepare(
            `SELECT * FROM readings WHERE ts > ? ORDER BY ts DESC LIMIT 2000`
          ).bind(since).all()
        : await env.DB.prepare(
            `SELECT * FROM readings WHERE ts > ? AND device_id = ? ORDER BY ts DESC LIMIT 2000`
          ).bind(since, device).all();

      return jsonResponse({ readings: result.results }, 200, origin);
    }

    // GET /api/history/stats?hours=24
    if (request.method === "GET" && path === "/api/history/stats") {
      const hours = parseInt(url.searchParams.get("hours") ?? "24", 10) || 24;
      const since = Math.floor(Date.now() / 1000) - hours * 3600;

      const result = await env.DB.prepare(
        `SELECT
           device_id,
           device_name,
           strftime('%Y-%m-%dT%H:00:00', datetime(ts, 'unixepoch')) AS hour,
           ROUND(AVG(pm25), 1)        AS pm25,
           ROUND(AVG(temperature), 1) AS temp,
           ROUND(AVG(humidity), 1)    AS hum,
           ROUND(AVG(filter_pct), 0)  AS filter_pct,
           COUNT(*)                   AS count
         FROM readings
         WHERE ts > ?
         GROUP BY device_id, hour
         ORDER BY hour ASC`
      ).bind(since).all();

      return jsonResponse({ stats: result.results }, 200, origin);
    }

    const creds = await loadCreds(env);

    if (!creds) {
      return errorResponse("Xiaomi credentials not configured", 500, origin);
    }

    // GET /api/devices
    if (request.method === "GET" && path === "/api/devices") {
      try {
        const results = await Promise.allSettled(
          DEVICES.map((d) => fetchOneDevice(d, creds))
        );
        const devices = results.map((r, i) => {
          if (r.status === "fulfilled") return r.value;
          console.error(`Failed to fetch ${DEVICES[i].id}: ${r.reason}`);
          return deviceSkeleton(DEVICES[i], false);
        });
        return jsonResponse({ devices }, 200, origin);
      } catch (err) {
        return errorResponse(String(err), 502, origin);
      }
    }

    // GET /api/device/:id
    const deviceMatch = path.match(/^\/api\/device\/([^/]+)$/);
    if (request.method === "GET" && deviceMatch) {
      const deviceId = deviceMatch[1];
      const device = DEVICE_MAP.get(deviceId);
      if (!device) {
        return errorResponse(`Unknown device id: ${deviceId}`, 404, origin);
      }
      try {
        const result = await fetchOneDevice(device, creds);
        return jsonResponse(result, 200, origin);
      } catch (err) {
        return errorResponse(String(err), 502, origin);
      }
    }

    // POST /api/control
    if (request.method === "POST" && path === "/api/control") {
      let body: { did?: string; host?: string; siid?: number; piid?: number; value?: unknown };
      try {
        body = await request.json();
      } catch {
        return errorResponse("Invalid JSON body", 400, origin);
      }

      const { did, host, siid, piid, value } = body;
      if (!did || !host || siid === undefined || piid === undefined || value === undefined) {
        return errorResponse("Missing required fields: did, host, siid, piid, value", 400, origin);
      }

      // Derive the host enum from the full hostname or short key
      let hostEnum: "sg" | "cn";
      if (host === "sg" || host.startsWith("sg.")) {
        hostEnum = "sg";
      } else {
        hostEnum = "cn";
      }

      const controlUrl = apiUrl(hostEnum, "/app/miotspec/prop/set");
      const params = [{ did, siid, piid, value }];
      const dataJson = JSON.stringify({ params });

      try {
        const result = await xiaomiRequest(controlUrl, dataJson, creds);
        return jsonResponse({ ok: true, result }, 200, origin);
      } catch (err) {
        return errorResponse(String(err), 502, origin);
      }
    }

    // GET /api/stream — Server-Sent Events, poll all devices every 30 s
    if (request.method === "GET" && path === "/api/stream") {
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const sendEvent = async (data: unknown) => {
        const payload = `data: ${JSON.stringify(data)}\n\n`;
        await writer.write(encoder.encode(payload));
      };

      // Run the polling loop in the background (Cloudflare ctx.waitUntil is not
      // available here, but the stream keeps the worker alive for its duration).
      (async () => {
        try {
          while (true) {
            const results = await Promise.allSettled(
              DEVICES.map((d) => fetchOneDevice(d, creds))
            );
            const devices = results.map((r, i) => {
              if (r.status === "fulfilled") return r.value;
              return deviceSkeleton(DEVICES[i], false);
            });
            await sendEvent({ devices });
            // Wait 30 seconds before next poll
            await new Promise<void>((resolve) => setTimeout(resolve, 30_000));
          }
        } catch {
          // Client disconnected or worker hit CPU limit — close stream
          await writer.close().catch(() => undefined);
        }
      })();

      return new Response(readable, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
          ...corsHeaders(origin),
        },
      });
    }

    // GET /health
    if (request.method === "GET" && path === "/health") {
      return jsonResponse({ status: "ok" }, 200, origin);
    }

    // POST /api/renew — Update credentials (called by GitHub Action or manually)
    if (request.method === "POST" && path === "/api/renew") {
      const authHeader = request.headers.get("Authorization");
      const secret = url.searchParams.get("secret");
      if (secret !== env.LOG_SECRET && authHeader !== `Bearer ${env.LOG_SECRET}`) {
        return errorResponse("Unauthorized", 401, origin);
      }

      let body: { userId?: string; serviceToken?: string; ssecurity?: string };
      try {
        body = await request.json();
      } catch {
        return errorResponse("Invalid JSON body", 400, origin);
      }

      if (!body.userId || !body.serviceToken || !body.ssecurity) {
        return errorResponse("Missing required fields: userId, serviceToken, ssecurity", 400, origin);
      }

      const newCreds: XiaomiCreds = {
        userId: body.userId,
        serviceToken: body.serviceToken,
        ssecurity: body.ssecurity,
      };

      // Test the new credentials by fetching one device
      try {
        await fetchOneDevice(DEVICES[0], newCreds);
        await saveCredsToKV(env, newCreds);
        return jsonResponse({ ok: true, message: "Credentials updated and verified", updatedAt: Date.now() }, 200, origin);
      } catch (err) {
        return errorResponse(`Credentials verification failed: ${String(err)}`, 422, origin);
      }
    }

    // POST /api/log — Accept readings from external sources (Python scripts) and write to D1
    if (request.method === "POST" && path === "/api/log") {
      const authHeader = request.headers.get("Authorization");
      const secret = url.searchParams.get("secret");
      if (secret !== env.LOG_SECRET && authHeader !== `Bearer ${env.LOG_SECRET}`) {
        return errorResponse("Unauthorized", 401, origin);
      }

      let body: { readings?: Array<{
        device_id: string; device_name: string;
        pm25?: number | null; pm10?: number | null; aqi?: number | null;
        temperature?: number | null; humidity?: number | null; power?: boolean | null;
      }> };
      try {
        body = await request.json();
      } catch {
        return errorResponse("Invalid JSON body", 400, origin);
      }

      if (!body.readings || !Array.isArray(body.readings)) {
        return errorResponse("Missing required field: readings (array)", 400, origin);
      }

      const ts = Math.floor(Date.now() / 1000);
      const stmt = env.DB.prepare(
        `INSERT INTO readings (ts, device_id, device_name, pm25, pm10, aqi, temperature, humidity, power)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const inserts = body.readings.map((r) =>
        stmt.bind(
          ts,
          r.device_id,
          r.device_name,
          r.pm25    ?? null,
          r.pm10    ?? null,
          r.aqi     ?? null,
          r.temperature ?? null,
          r.humidity    ?? null,
          r.power != null ? (r.power ? 1 : 0) : null,
        )
      );

      if (inserts.length > 0) await env.DB.batch(inserts);
      return jsonResponse({ ok: true, count: inserts.length, ts }, 200, origin);
    }

    // GET /api/creds — Show credential status (when last updated, source)
    if (request.method === "GET" && path === "/api/creds") {
      const authHeader = request.headers.get("Authorization");
      const secret = url.searchParams.get("secret");
      if (secret !== env.LOG_SECRET && authHeader !== `Bearer ${env.LOG_SECRET}`) {
        return errorResponse("Unauthorized", 401, origin);
      }

      let source = "secrets";
      let updatedAt: number | null = null;
      if (env.CREDS_KV) {
        try {
          const raw = await env.CREDS_KV.get("xiaomi_creds");
          if (raw) {
            const parsed = JSON.parse(raw) as StoredCreds;
            source = "kv";
            updatedAt = parsed.updatedAt;
          }
        } catch {
          // ignore
        }
      }

      return jsonResponse({ source, updatedAt, userId: (await loadCreds(env))?.userId ?? null }, 200, origin);
    }

    return errorResponse("Not found", 404, origin);
  },
};
