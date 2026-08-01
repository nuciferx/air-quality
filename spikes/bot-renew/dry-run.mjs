// Dry-run spike for handleRenew (approach B).
// Run with:  node spikes/bot-renew/dry-run.mjs
// Mocks: BOT_KV, fetch (GitHub API), Telegram send. Proves cooldown + gate + dispatch path without touching production.

const COOLDOWN_KEY = (chatId) => `bot:renew:cooldown:${chatId}`;
const COOLDOWN_TTL_S = 600;
const WORKFLOW_FILE = "auto-renew.yml";

function makeKV() {
  const store = new Map();
  return {
    async get(k) {
      const v = store.get(k);
      if (!v) return null;
      if (v.expireAt && v.expireAt < Date.now()) {
        store.delete(k);
        return null;
      }
      return v.value;
    },
    async put(k, value, opts = {}) {
      const expireAt = opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
      store.set(k, { value, expireAt });
    },
    _dump() {
      return Object.fromEntries([...store.entries()].map(([k, v]) => [k, v.value]));
    },
  };
}

function makeSend() {
  const messages = [];
  return {
    fn: async (chatId, text) => { messages.push({ chatId, text }); },
    messages,
  };
}

function makeFetchMock(scenario) {
  return async (url, opts) => {
    if (!url.includes("/actions/workflows/")) throw new Error("unexpected fetch: " + url);
    if (opts?.method !== "POST") throw new Error("expected POST, got " + opts?.method);
    if (!opts?.headers?.Authorization?.startsWith("Bearer ")) throw new Error("missing Bearer");
    if (scenario === "ok") return new Response(null, { status: 204 });
    if (scenario === "auth") return new Response("Bad credentials", { status: 401 });
    if (scenario === "404") return new Response("Not Found", { status: 404 });
    return new Response("server error", { status: 500 });
  };
}

async function handleRenew(env, chatId, send, now = () => Date.now()) {
  if (String(chatId) !== env.ALLOWED_CHAT_ID) return;
  const cooldownUntil = await env.BOT_KV.get(COOLDOWN_KEY(chatId));
  if (cooldownUntil) {
    const remainingS = Math.ceil((parseInt(cooldownUntil, 10) - now()) / 1000);
    if (remainingS > 0) {
      const m = Math.ceil(remainingS / 60);
      await send(chatId, `⏳ /renew อยู่ใน cooldown — ลองอีกครั้งใน ${m} นาที`);
      return;
    }
  }
  const url = `https://api.github.com/repos/${env.GH_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GH_DISPATCH_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "air-quality-bot",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "master" }),
  });
  if (res.status === 204) {
    await env.BOT_KV.put(COOLDOWN_KEY(chatId), String(now() + COOLDOWN_TTL_S * 1000), { expirationTtl: COOLDOWN_TTL_S });
    await send(chatId, `✅ เริ่ม renew token แล้ว — รอแจ้งเตือนอีกครั้งใน ~60 วินาที\nดู: https://github.com/${env.GH_REPO}/actions/workflows/${WORKFLOW_FILE}`);
    return;
  }
  if (res.status === 401 || res.status === 403) { await send(chatId, `❌ /renew ล้มเหลว: GitHub auth ปฏิเสธ (${res.status}) — เช็ค GH_DISPATCH_TOKEN`); return; }
  if (res.status === 404) { await send(chatId, `❌ /renew ล้มเหลว: ไม่พบ workflow ${WORKFLOW_FILE} — เช็ค GH_REPO`); return; }
  const body = await res.text().catch(() => "");
  await send(chatId, `❌ /renew ล้มเหลว: GitHub ${res.status} ${body.slice(0, 200)}`);
}

async function scenario(name, fn) {
  console.log(`\n— ${name}`);
  await fn();
}

async function main() {
  const ALLOWED = "957180305";
  const baseEnv = (kv) => ({ BOT_KV: kv, TELEGRAM_BOT_TOKEN: "x", ALLOWED_CHAT_ID: ALLOWED, GH_DISPATCH_TOKEN: "ghp_fake", GH_REPO: "nuciferx/air-quality" });

  await scenario("1) wrong chat id → silent drop", async () => {
    const kv = makeKV(); const s = makeSend(); globalThis.fetch = makeFetchMock("ok");
    await handleRenew(baseEnv(kv), 12345, s.fn);
    console.log("  messages:", s.messages.length, "(expect 0)");
    console.log("  kv:", kv._dump(), "(expect {})");
  });

  await scenario("2) allowed chat, no cooldown → dispatch ok → cooldown written", async () => {
    const kv = makeKV(); const s = makeSend(); globalThis.fetch = makeFetchMock("ok");
    await handleRenew(baseEnv(kv), Number(ALLOWED), s.fn);
    console.log("  reply:", s.messages[0]?.text?.split("\n")[0]);
    console.log("  cooldown set:", !!(await kv.get(COOLDOWN_KEY(Number(ALLOWED)))));
  });

  await scenario("3) immediate retry → blocked by cooldown", async () => {
    const kv = makeKV(); const s = makeSend(); globalThis.fetch = makeFetchMock("ok");
    await handleRenew(baseEnv(kv), Number(ALLOWED), s.fn);
    s.messages.length = 0;
    await handleRenew(baseEnv(kv), Number(ALLOWED), s.fn);
    console.log("  reply:", s.messages[0]?.text);
  });

  await scenario("4) auth fail (401) → user-visible error", async () => {
    const kv = makeKV(); const s = makeSend(); globalThis.fetch = makeFetchMock("auth");
    await handleRenew(baseEnv(kv), Number(ALLOWED), s.fn);
    console.log("  reply:", s.messages[0]?.text);
    console.log("  cooldown NOT written:", !(await kv.get(COOLDOWN_KEY(Number(ALLOWED)))));
  });

  await scenario("5) repo not found (404) → distinct error", async () => {
    const kv = makeKV(); const s = makeSend(); globalThis.fetch = makeFetchMock("404");
    await handleRenew(baseEnv(kv), Number(ALLOWED), s.fn);
    console.log("  reply:", s.messages[0]?.text);
  });

  await scenario("6) cooldown expires → can retry", async () => {
    const kv = makeKV(); const s = makeSend(); globalThis.fetch = makeFetchMock("ok");
    let t = 1_000_000_000;
    const now = () => t;
    await handleRenew(baseEnv(kv), Number(ALLOWED), s.fn, now);
    s.messages.length = 0;
    t += (COOLDOWN_TTL_S + 1) * 1000;
    await handleRenew(baseEnv(kv), Number(ALLOWED), s.fn, now);
    console.log("  reply after TTL:", s.messages[0]?.text?.split("\n")[0]);
  });
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
