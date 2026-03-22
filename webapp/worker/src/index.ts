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
 */

export interface Env {
  XIAOMI_USER_ID: string;
  XIAOMI_SERVICE_TOKEN: string;
  XIAOMI_SSECURITY: string;
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
    id: "4lite",
    name: "4 Lite",
    did: "873639853",
    host: "sg",
    props: {
      pm25:  { siid: 9, piid: 10 },
      aqi:   { siid: 3, piid: 1  },
      temp:  { siid: 3, piid: 7  },
      hum:   { siid: 3, piid: 4  },
      pm10:  { siid: 9, piid: 11 },
      power: { siid: 2, piid: 1  },
      mode:  { siid: 2, piid: 4  },
      fan:   { siid: 2, piid: 11 },
      buzz:  { siid: 2, piid: 11 },
    },
  },
  {
    id: "maxpro",
    name: "MAX Pro",
    did: "460764069",
    host: "cn",
    props: {
      pm25:  { siid: 3, piid: 2  },
      aqi:   { siid: 3, piid: 1  },
      temp:  { siid: 3, piid: 3  },
      power: { siid: 2, piid: 1  },
      mode:  { siid: 2, piid: 4  },
      fan:   { siid: 2, piid: 11 },
      buzz:  { siid: 2, piid: 11 },
    },
  },
  {
    id: "maxdown",
    name: "MAX ชั้นล่าง",
    did: "131590393",
    host: "cn",
    props: {
      pm25:  { siid: 3, piid: 2  },
      aqi:   { siid: 3, piid: 1  },
      temp:  { siid: 3, piid: 3  },
      power: { siid: 2, piid: 1  },
      mode:  { siid: 2, piid: 4  },
      fan:   { siid: 2, piid: 11 },
      buzz:  { siid: 2, piid: 11 },
    },
  },
  {
    id: "cat",
    name: "แมว",
    did: "357231085",
    host: "cn",
    props: {
      pm25:  { siid: 3, piid: 2  },
      aqi:   { siid: 3, piid: 1  },
      temp:  { siid: 3, piid: 3  },
      power: { siid: 2, piid: 1  },
      mode:  { siid: 2, piid: 4  },
      fan:   { siid: 2, piid: 11 },
      buzz:  { siid: 2, piid: 11 },
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

// ── Request router ────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const creds: XiaomiCreds = {
      userId: env.XIAOMI_USER_ID,
      serviceToken: env.XIAOMI_SERVICE_TOKEN,
      ssecurity: env.XIAOMI_SSECURITY,
    };

    if (!creds.userId || !creds.serviceToken || !creds.ssecurity) {
      return errorResponse("Xiaomi credentials not configured", 500, origin);
    }

    const path = url.pathname;

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

    return errorResponse("Not found", 404, origin);
  },
};
