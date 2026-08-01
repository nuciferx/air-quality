// Spike: standalone handleRenew() for the air-quality Telegram bot.
// Approach B — Bot Dispatch + Trust Notify.
// Never imported by production. Lives only to prove the shape + zero-deps + handler size budget.

export interface RenewEnv {
  BOT_KV: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  ALLOWED_CHAT_ID: string;
  GH_DISPATCH_TOKEN: string;
  GH_REPO: string;
}

const COOLDOWN_KEY = (chatId: number) => `bot:renew:cooldown:${chatId}`;
const COOLDOWN_TTL_S = 600;
const WORKFLOW_FILE = "auto-renew.yml";

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export async function handleRenew(
  env: RenewEnv,
  chatId: number,
  send: (chatId: number, text: string) => Promise<void>,
  now: () => number = () => Date.now(),
): Promise<void> {
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
    await env.BOT_KV.put(
      COOLDOWN_KEY(chatId),
      String(now() + COOLDOWN_TTL_S * 1000),
      { expirationTtl: COOLDOWN_TTL_S },
    );
    await send(
      chatId,
      `✅ เริ่ม renew token แล้ว — รอแจ้งเตือนอีกครั้งใน ~60 วินาที\nดู: https://github.com/${env.GH_REPO}/actions/workflows/${WORKFLOW_FILE}`,
    );
    return;
  }

  if (res.status === 401 || res.status === 403) {
    await send(chatId, `❌ /renew ล้มเหลว: GitHub auth ปฏิเสธ (${res.status}) — เช็ค GH_DISPATCH_TOKEN`);
    return;
  }
  if (res.status === 404) {
    await send(chatId, `❌ /renew ล้มเหลว: ไม่พบ workflow ${WORKFLOW_FILE} — เช็ค GH_REPO`);
    return;
  }
  const body = await res.text().catch(() => "");
  await send(chatId, `❌ /renew ล้มเหลว: GitHub ${res.status} ${body.slice(0, 200)}`);
}
