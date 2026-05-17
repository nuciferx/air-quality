/**
 * Telegram Bot for Air Quality Monitor
 *
 * Uses Qwen AI (free tier) to generate natural language responses
 * about air quality status, device control, and predictions.
 *
 * Secrets (set via: wrangler secret put <NAME>):
 *   TELEGRAM_BOT_TOKEN  — Telegram bot token from BotFather
 *   QWEN_API_KEY        — DashScope API key (free tier available)
 *   WORKER_API_SECRET   — LOG_SECRET from the main worker
 */

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  QWEN_API_KEY: string;
  WORKER_API_SECRET: string;
  QWEN_API_URL: string;
  QWEN_MODEL: string;
  WORKER_API_URL: string;
  AIR_QUALITY_API: { fetch: (req: Request) => Promise<Response> };
  BOT_KV: KVNamespace;
}

interface TelegramLocation {
  latitude: number;
  longitude: number;
}

interface StoredLocation extends TelegramLocation {
  label: string;
  updated_at: number;
}

interface WeatherSnapshot {
  label: string;
  currentTemp?: number;
  currentHumidity?: number;
  currentWind?: number;
  currentCode?: number;
  todayMax?: number;
  todayMin?: number;
  todayCode?: number;
  todayPrecipProbability?: number;
}

const REPORT_TIMEZONE = "Asia/Bangkok";
const HOME_LOCATION = {
  latitude: 13.7563,
  longitude: 100.5018,
  label: "บ้าน",
};

// ── Telegram API helpers ──────────────────────────────────────────────────────

async function telegramRequest(token: string, method: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function sendMessage(token: string, chatId: number, text: string, parseMode = "HTML"): Promise<Response> {
  return telegramRequest(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
  });
}

// ── Worker API helpers (via Service Binding) ──────────────────────────────────

async function apiGet(env: Env, path: string): Promise<Response> {
  const req = new Request(`https://air-quality-api.ideaplanstudio.workers.dev${path}`, {
    headers: { "Authorization": `Bearer ${env.WORKER_API_SECRET}` },
  });
  return env.AIR_QUALITY_API.fetch(req);
}

async function apiPost(env: Env, path: string, body: unknown): Promise<Response> {
  const req = new Request(`https://air-quality-api.ideaplanstudio.workers.dev${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.WORKER_API_SECRET}`,
    },
    body: JSON.stringify(body),
  });
  return env.AIR_QUALITY_API.fetch(req);
}

async function fetchDevices(env: Env): Promise<unknown> {
  try {
    const res = await apiGet(env, "/api/devices");
    if (res.ok) return res.json();
  } catch { /* fallthrough */ }

  // Fallback: latest readings from D1
  const res = await apiGet(env, "/api/history?hours=1");
  const data = await res.json() as { readings?: { device_id: string; device_name: string; pm25: number | null; temperature: number | null; humidity: number | null; power: number | null; ts: number }[] };

  const latest: Record<string, unknown> = {};
  for (const r of (data.readings || [])) {
    if (!latest[r.device_id]) {
      latest[r.device_id] = {
        id: r.device_id,
        name: r.device_name,
        online: true,
        values: { pm25: r.pm25, temp: r.temperature, hum: r.humidity, power: r.power === 1 },
        fetched_at: r.ts,
        source: "history",
      };
    }
  }
  return { devices: Object.values(latest) };
}

async function fetchHistoryStats(env: Env, hours = 24): Promise<unknown> {
  const res = await apiGet(env, `/api/history/stats?hours=${hours}`);
  return res.json();
}

async function fetchCredStatus(env: Env): Promise<{
  source?: string;
  workingSource?: string;
  updatedAt?: number | null;
  ageDays?: number | null;
  estimatedDaysLeft?: number | null;
}> {
  const res = await apiGet(env, "/api/creds");
  return res.json();
}

async function controlDevice(env: Env, did: string, host: string, siid: number, piid: number, value: boolean | number): Promise<unknown> {
  const res = await apiPost(env, "/api/control", { did, host, siid, piid, value });
  return res.json();
}

// ── Qwen AI ───────────────────────────────────────────────────────────────────

async function askQwen(env: Env, prompt: string, context: string): Promise<string> {
  const res = await fetch(env.QWEN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.QWEN_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.QWEN_MODEL,
      messages: [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: context,
        },
      ],
      max_tokens: 500,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    return `⚠️ AI error: ${res.status}`;
  }

  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() || "ไม่ได้รับคำตอบจาก AI";
}

// ── Device info mapping ───────────────────────────────────────────────────────

const DEVICE_INFO: Record<string, { did: string; host: string }> = {
  "4lite": { did: "873639853", host: "sg" },
  "maxpro": { did: "460764069", host: "cn" },
  "maxdown": { did: "131590393", host: "cn" },
  "cat": { did: "357231085", host: "cn" },
};

function pm25Label(value: number | undefined): string {
  if (value === undefined || value === null) return "N/A";
  if (value <= 15) return "🟢 ดี";
  if (value <= 35) return "🟡 ปานกลาง";
  if (value <= 75) return "🟠 เริ่มมีผลต่อสุขภาพ";
  return "🔴 อันตราย";
}

function modeLabel(mode: number | undefined): string {
  switch (mode) {
    case 0: return "Auto";
    case 1: return "Sleep";
    case 2: return "Favorite";
    case 3: return "Level 1";
    case 4: return "Level 2";
    case 5: return "Level 3";
    default: return `Mode ${mode}`;
  }
}

function weatherCodeLabel(code?: number): string {
  switch (code) {
    case 0: return "ท้องฟ้าแจ่มใส";
    case 1:
    case 2:
    case 3: return "มีเมฆบางส่วน";
    case 45:
    case 48: return "มีหมอก";
    case 51:
    case 53:
    case 55: return "ฝนปรอย";
    case 61:
    case 63:
    case 65: return "ฝน";
    case 80:
    case 81:
    case 82: return "ฝนเป็นช่วง ๆ";
    case 95: return "พายุฝนฟ้าคะนอง";
    default: return "สภาพอากาศทั่วไป";
  }
}

function locationKey(chatId: number): string {
  return `bot:last_location:${chatId}`;
}

async function saveLatestLocation(env: Env, chatId: number, location: TelegramLocation, label = "ตำแหน่งล่าสุด"): Promise<void> {
  const payload: StoredLocation = {
    ...location,
    label,
    updated_at: Math.floor(Date.now() / 1000),
  };
  await env.BOT_KV.put(locationKey(chatId), JSON.stringify(payload));
}

async function loadLatestLocation(env: Env, chatId: number): Promise<StoredLocation | null> {
  const raw = await env.BOT_KV.get(locationKey(chatId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredLocation;
  } catch {
    return null;
  }
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const url = new URL("https://geocode.maps.co/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  try {
    const res = await fetch(url.toString(), { headers: { "User-Agent": "air-quality-bot" } });
    if (!res.ok) return "ตำแหน่งล่าสุด";
    const data = await res.json() as { display_name?: string; address?: Record<string, string> };
    return data.address?.suburb || data.address?.city || data.address?.state || data.display_name || "ตำแหน่งล่าสุด";
  } catch {
    return "ตำแหน่งล่าสุด";
  }
}

async function fetchWeather(location: { latitude: number; longitude: number; label: string }): Promise<WeatherSnapshot | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("timezone", REPORT_TIMEZONE);
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  url.searchParams.set("forecast_days", "1");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json() as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        weather_code?: number;
        wind_speed_10m?: number;
      };
      daily?: {
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
      };
    };
    return {
      label: location.label,
      currentTemp: data.current?.temperature_2m,
      currentHumidity: data.current?.relative_humidity_2m,
      currentWind: data.current?.wind_speed_10m,
      currentCode: data.current?.weather_code,
      todayMax: data.daily?.temperature_2m_max?.[0],
      todayMin: data.daily?.temperature_2m_min?.[0],
      todayCode: data.daily?.weather_code?.[0],
      todayPrecipProbability: data.daily?.precipitation_probability_max?.[0],
    };
  } catch {
    return null;
  }
}

function formatWeather(snapshot: WeatherSnapshot, title: string): string {
  return `${title}\n` +
    `📍 ${snapshot.label}\n` +
    `ตอนนี้: ${snapshot.currentTemp ?? "—"}°C | RH ${snapshot.currentHumidity ?? "—"}% | ลม ${snapshot.currentWind ?? "—"} km/h | ${weatherCodeLabel(snapshot.currentCode)}\n` +
    `วันนี้: สูงสุด ${snapshot.todayMax ?? "—"}°C | ต่ำสุด ${snapshot.todayMin ?? "—"}°C | ฝน ${snapshot.todayPrecipProbability ?? "—"}% | ${weatherCodeLabel(snapshot.todayCode)}`;
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function handleStatus(env: Env, chatId: number): Promise<string> {
  const data = await fetchDevices(env) as { devices?: { id: string; name: string; online: boolean; values: Record<string, unknown>; fetched_at: number }[] };
  const devices = data.devices || [];

  let summary = "📊 <b>สถานะเครื่องฟอกอากาศ</b>\n";
  summary += `🕐 ${new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}\n\n`;

  for (const d of devices) {
    const v = d.values;
    const pm25 = v.pm25 as number | undefined;
    const temp = v.temp as number | undefined;
    const hum = v.hum as number | undefined;
    const power = v.power as boolean | undefined;
    const mode = v.mode as number | undefined;
    const filter = v.filter as number | undefined;

    summary += `<b>${d.name}</b> ${power ? "✅ เปิด" : "❌ ปิด"}\n`;
    if (power) {
      summary += `  PM2.5: ${pm25 ?? "—"} µg/m³ ${pm25 !== undefined ? pm25Label(pm25) : ""}\n`;
      summary += `  อุณหภูมิ: ${temp ?? "—"}°C`;
      if (hum !== undefined && hum !== null) summary += ` | ความชื้น: ${hum}%`;
      summary += `\n`;
      summary += `  โหมด: ${mode !== undefined ? modeLabel(mode) : "—"}`;
      if (filter !== undefined && filter !== null) summary += ` | Filter: ${filter}%`;
      summary += `\n`;
    }
    summary += "\n";
  }

  return summary;
}

async function handlePredict(env: Env, chatId: number): Promise<string> {
  const stats = await fetchHistoryStats(env, 24) as { stats?: { device_id: string; device_name: string; hour: string; pm25: number | null; temp: number | null; hum: number | null; filter_pct: number | null }[] };
  const statsData = stats.stats || [];

  if (statsData.length === 0) {
    return "⚠️ ยังไม่มีข้อมูลเพียงพอสำหรับการทำนาย\nต้องการข้อมูลอย่างน้อย 24 ชั่วโมง";
  }

  // Group by device and calculate trends
  const deviceStats: Record<string, { name: string; pm25Values: number[]; filterValues: number[] }> = {};
  for (const s of statsData) {
    if (!deviceStats[s.device_id]) {
      deviceStats[s.device_id] = { name: s.device_name, pm25Values: [], filterValues: [] };
    }
    if (s.pm25 !== null) deviceStats[s.device_id].pm25Values.push(s.pm25);
    if (s.filter_pct !== null) deviceStats[s.device_id].filterValues.push(s.filter_pct);
  }

  let prediction = "🔮 <b>การทำนาย</b>\n\n";

  for (const [id, ds] of Object.entries(deviceStats)) {
    prediction += `<b>${ds.name}</b>\n`;

    // PM2.5 trend (simple linear regression)
    if (ds.pm25Values.length >= 2) {
      const n = ds.pm25Values.length;
      const avg = ds.pm25Values.reduce((a, b) => a + b, 0) / n;
      const last3 = ds.pm25Values.slice(-3);
      const recentAvg = last3.reduce((a, b) => a + b, 0) / last3.length;
      const trend = recentAvg > avg ? "📈 เพิ่มขึ้น" : recentAvg < avg ? "📉 ลดลง" : "➡️ คงที่";
      prediction += `  PM2.5 เฉลี่ย 24 ชม.: ${avg.toFixed(1)} µg/m³ ${trend}\n`;
    }

    // Filter prediction
    if (ds.filterValues.length >= 2) {
      const first = ds.filterValues[0];
      const last = ds.filterValues[ds.filterValues.length - 1];
      const hours = ds.filterValues.length;
      const ratePerHour = (last - first) / hours;
      if (ratePerHour < 0) {
        const hoursLeft = last / Math.abs(ratePerHour);
        const daysLeft = Math.floor(hoursLeft / 24);
        const deathDate = new Date(Date.now() + daysLeft * 24 * 60 * 60 * 1000);
        prediction += `  Filter: ${last}% (เหลือ ~${daysLeft} วัน)`;
        if (daysLeft <= 7) prediction += " ⚠️ ใกล้หมด!";
        prediction += `\n`;
        prediction += `  📅 คาดว่าต้องเปลี่ยน: ${deathDate.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })}\n`;
      } else {
        prediction += `  Filter: ${last}%\n`;
      }
    }
    prediction += "\n";
  }

  return prediction;
}

async function handleControl(env: Env, chatId: number, deviceId: string, action: "on" | "off"): Promise<string> {
  const device = DEVICE_INFO[deviceId];
  if (!device) {
    return `❌ ไม่พบอุปกรณ์: ${deviceId}\nอุปกรณ์ที่รองรับ: ${Object.keys(DEVICE_INFO).join(", ")}`;
  }

  try {
    await controlDevice(env, device.did, device.host, 2, 1, action === "on");
    return action === "on"
      ? `✅ เปิดเครื่อง <b>${deviceId}</b> แล้ว`
      : `✅ ปิดเครื่อง <b>${deviceId}</b> แล้ว`;
  } catch (err) {
    return `❌ ควบคุมเครื่อง ${deviceId} ไม่สำเร็จ: ${String(err)}`;
  }
}

async function handleAI(env: Env, chatId: number, userMessage: string): Promise<string> {
  const devicesData = await fetchDevices(env);
  const context = JSON.stringify(devicesData, null, 2);

  const prompt = `คุณเป็นผู้ช่วยวิเคราะห์คุณภาพอากาศจากข้อมูลเครื่องฟอกอากาศ Xiaomi 4 เครื่อง
ตอบเป็นภาษาไทย ใช้ emoji ได้
ข้อมูลปัจจุบัน:
${context}

อธิบายสถานะ อากาศดีหรือไม่ มีห้องไหนต้องระวัง แนะนำการตั้งค่า`;

  return askQwen(env, prompt, userMessage);
}

async function handleWeatherHome(): Promise<string> {
  const weather = await fetchWeather(HOME_LOCATION);
  if (!weather) return "⚠️ ดึงสภาพอากาศที่บ้านไม่สำเร็จ";
  return formatWeather(weather, "🌤 <b>สภาพอากาศที่บ้าน</b>");
}

async function handleWeatherLatest(env: Env, chatId: number): Promise<string> {
  const latest = await loadLatestLocation(env, chatId);
  if (!latest) {
    return "📍 ยังไม่มีตำแหน่งล่าสุด\nส่ง location ให้บอทก่อน แล้วค่อยพิมพ์ /weather";
  }
  const weather = await fetchWeather(latest);
  if (!weather) return "⚠️ ดึงสภาพอากาศตามตำแหน่งล่าสุดไม่สำเร็จ";
  return formatWeather(weather, "📡 <b>สภาพอากาศตามตำแหน่งล่าสุด</b>");
}

async function handleTokenStatus(env: Env): Promise<string> {
  const status = await fetchCredStatus(env);
  return `🔑 <b>สถานะโทเคน Xiaomi</b>\n` +
    `source: ${status.source ?? "—"} | working: ${status.workingSource ?? "—"}\n` +
    `อัปเดตล่าสุด: ${status.updatedAt ? new Date(status.updatedAt * 1000).toLocaleString("th-TH", { timeZone: REPORT_TIMEZONE }) : "ไม่ทราบ"}\n` +
    `ผ่านมาแล้ว: ${status.ageDays ?? "—"} วัน\n` +
    `คาดว่าเหลือก่อนหมดอายุ: ${status.estimatedDaysLeft ?? "—"} วัน`;
}

// ── Webhook handler ───────────────────────────────────────────────────────────

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  let update: { message?: { chat: { id: number }; text?: string; location?: TelegramLocation; from?: { username?: string } } };
  try {
    update = await request.json();
  } catch {
    return new Response("OK");
  }
  const message = update.message;
  if (!message) return new Response("OK");

  const chatId = message.chat.id;
  const text = message.text?.trim();
  const username = message.from?.username;

  console.log(`Message from ${username}: ${text ?? "[location]"}`);

  let response: string;

  try {
    if (message.location) {
      const label = await reverseGeocode(message.location.latitude, message.location.longitude);
      await saveLatestLocation(env, chatId, message.location, label);
      response = `📍 บันทึกตำแหน่งล่าสุดแล้ว\n${label}\nพิมพ์ /weather เพื่อดูสภาพอากาศจุดนี้`;
    } else if (!text) {
      return new Response("OK");
    } else if (text === "/start" || text === "/help") {
    response = `🤖 <b>Air Quality Bot</b>

<b>คำสั่ง:</b>
/status — ดูสถานะทุกห้อง
/predict — ทำนาย PM2.5 + Filter
/on [room] — เปิดเครื่อง (4lite, maxpro, maxdown, cat)
/off [room] — ปิดเครื่อง
/weather — สภาพอากาศตำแหน่งล่าสุด
/weather_home — สภาพอากาศที่บ้าน
/token — สถานะโทเคน Xiaomi
/ai [ข้อความ] — ถาม AI เกี่ยวกับคุณภาพอากาศ
/help — แสดงคำสั่งนี้

<b>ห้อง:</b>
• 4lite — ห้องทำงาน
• maxpro — ห้องนอนชั้น 2
• maxdown — โถงชั้นล่าง
• cat — ห้องแมวชั้น 2

<b>ตำแหน่ง:</b>
ส่ง location มาในแช็ต แล้วใช้ /weather ได้`;
  } else if (text === "/status") {
    response = await handleStatus(env, chatId);
  } else if (text === "/predict") {
    response = await handlePredict(env, chatId);
  } else if (text === "/weather") {
    response = await handleWeatherLatest(env, chatId);
  } else if (text === "/weather_home") {
    response = await handleWeatherHome();
  } else if (text === "/token") {
    response = await handleTokenStatus(env);
  } else if (text.startsWith("/on ")) {
    const room = text.slice(4).trim();
    response = await handleControl(env, chatId, room, "on");
  } else if (text.startsWith("/off ")) {
    const room = text.slice(5).trim();
    response = await handleControl(env, chatId, room, "off");
  } else if (text.startsWith("/ai ")) {
    const query = text.slice(4).trim();
    response = await handleAI(env, chatId, query);
  } else if (text.startsWith("/")) {
    response = "❌ คำสั่งไม่ถูกต้อง พิมพ์ /help เพื่อดูคำสั่งทั้งหมด";
  } else {
    // Default: treat as AI query
    response = await handleAI(env, chatId, text);
  }
  } catch (err) {
    response = `⚠️ เกิดข้อผิดพลาด: ${String(err).substring(0, 200)}`;
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, response);
  return new Response("OK");
}

// ── Request router ────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // POST /webhook — Telegram webhook
    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhook(request, env);
    }

    // GET /set-webhook — Set webhook URL
    if (request.method === "GET" && url.pathname === "/set-webhook") {
      const webhookUrl = url.searchParams.get("url");
      if (!webhookUrl) {
        return new Response("Missing ?url= parameter", { status: 400 });
      }
      const res = await telegramRequest(env.TELEGRAM_BOT_TOKEN, "setWebhook", { url: webhookUrl });
      const data = await res.json();
      return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    }

    // GET / — Bot info
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(JSON.stringify({
        bot: "Air Quality Bot",
        commands: ["/status", "/predict", "/on", "/off", "/weather", "/weather_home", "/token", "/ai", "/help"],
      }), { headers: { "Content-Type": "application/json" } });
    }

    return new Response("Not found", { status: 404 });
  },
};
