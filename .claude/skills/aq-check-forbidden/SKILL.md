---
name: aq-check-forbidden
description: Pre-commit guard — scans staged AND unstaged files for forbidden patterns (creds.json, *.2fa_url, GCP service-account JSON, auto-renew logs, env files with secrets, Telegram/GitHub tokens inlined in code, 5-point device-sync drift between worker/bot/frontend). Read-only — blocks bad commits via report, never modifies. Use before every `git commit` (auto-called by `/aq-dev-loop` step 8 COMMIT).
---

# /aq-check-forbidden — Pre-commit forbidden-pattern guard

GTM Loop ขั้น 5 (Setting Condition) sub-step — ก่อน lock-in commit ต้องตรวจว่าไม่มี secret หรือ drift หลุดเข้าไป

## When to invoke

- ก่อน `git commit` ทุกครั้ง (อัตโนมัติจาก `/aq-dev-loop` step 8)
- ผู้ใช้พิมพ์ `/aq-check-forbidden` หรือ "ตรวจก่อน commit"
- หลัง resolve merge conflict (อาจจะ accidentally stage secret)

## Forbidden patterns (block hard)

### Files — ห้าม commit เด็ดขาด
```
creds.json
*creds*.json (ยกเว้น sample/example)
nucifer-data-sheet-api-*.json
*.2fa_url
.2fa_url
renew.log
auto-renew/*.log
auto-renew/*.json
.env (ไม่ใช่ .env.example)
.env.local
.env.production
*.pem
*.key (ยกเว้น .public-key)
```

### Content patterns — grep ใน staged + unstaged diff
| Pattern | Description |
|---|---|
| `[0-9]{9,11}:AA[A-Za-z0-9_-]{30,}` | Telegram bot token |
| `gho_[A-Za-z0-9]{36}` | GitHub OAuth user-to-server token |
| `ghp_[A-Za-z0-9]{36}` | GitHub classic PAT |
| `github_pat_[A-Za-z0-9_]+` | GitHub fine-grained PAT |
| `sk-[A-Za-z0-9]{48}` | OpenAI / generic API key shape |
| `sk-ant-[A-Za-z0-9_-]+` | Anthropic API key |
| `eyJ[A-Za-z0-9_-]{100,}` | JWT (worth flagging — often config leak) |
| `[A-Za-z0-9+/]{40}=` ใน `wrangler.toml [vars]` | base64-shaped value under [vars] block (must be secret, not var) |
| `XIAOMI_PASS_TOKEN\s*=\s*"?[A-Za-z0-9]` | Hard-coded Xiaomi pass token |
| `passToken\s*=\s*"[A-Za-z0-9]` | same — different casing |

### 5-point device-sync drift (per AGENTS.md §3)
For each device id (`4lite`, `maxpro`, `maxdown`, `cat`), grep these 5 files:
1. `webapp/worker/src/index.ts` (DEVICES + ROOM_THRESHOLDS)
2. `telegram-bot/src/index.ts` (DEVICE_INFO)
3. `webapp/frontend/lib/api.ts` (DEVICE_PROP_SPECS)
4. `webapp/frontend/components/DeviceCard.tsx` (DEVICE_MODES)

If staged diff touches ANY of these 5 files, all 5 must agree on the device list. Mismatch = block.

### Worker zero-deps violation
If staged diff adds `webapp/worker/package.json` `dependencies` (not devDeps) → block. Worker must stay zero-deps per AGENTS.md §10.

## Procedure

```bash
git diff --cached --name-only         # files staged for commit
git diff --name-only                  # files modified but not staged (warn only)
git diff --cached -U0                 # full content of staged hunks

# For each forbidden filename → fail
# For each content pattern in staged diff → fail
# For each 5-point file touched → cross-verify
```

## Output format

```
PRE-COMMIT GUARD — YYYY-MM-DD HH:MM

✅ Allowed
  - <file>: <reason it's safe>

❌ Forbidden (block commit)
  - <file>: <pattern matched>
    Action: unstage with `git restore --staged <file>` + add to .gitignore if missing
  - <file>:<line>: <secret pattern detected>
    Action: rotate secret (BotFather/wrangler), then `git restore <file>` + retry

⚠️  Warn (review but not blocking)
  - <file>: <reason — e.g. unstaged secret-shaped string in dev branch>

Verdict: BLOCK | ALLOW | ALLOW_WITH_WARNINGS
```

## What happens after BLOCK

- main thread / dev-loop step 8 sees `BLOCK` → does NOT commit
- User reads suggested actions → fixes (unstage / rotate / sync) → re-runs `/aq-check-forbidden`
- Only ALLOW (no warns) and ALLOW_WITH_WARNINGS proceed to commit

## Hard rules

- **Never auto-rotate a secret.** Only flag; rotation is user's call (BotFather click, fine-grained PAT regenerate, etc.) because it has external blast.
- **Never auto-unstage.** Only suggest the `git restore --staged` command. User runs it.
- **Never edit `.gitignore` automatically.** Only suggest entries.
- **Never read file contents that match forbidden filenames** — they likely contain the secret; just confirm presence, don't dump body to context.

## Anti-patterns

- เช็คเฉพาะไฟล์ staged แล้วลืม unstaged (secret อาจยัง pollute working tree)
- รัน `git diff` แล้ว print ทั้ง diff (จะมี secret หลุดเข้า context — แค่ระบุ line:column พอ)
- report yes/no อย่างเดียวโดยไม่บอก fix path
- consider `*.example` / `*.sample` / `*.template` เป็น forbidden (ยกเว้นได้ — ตามหลัก secret-by-pattern)

## Handoffs

- BLOCK on file → user unstages + commits to .gitignore
- BLOCK on content pattern → user rotates secret then unstages content
- BLOCK on 5-point sync drift → `xiaomi-debugger` หรือ `air-quality-planner` (ดูว่าตั้งใจเปลี่ยน device list หรือ accidental drift)
- BLOCK on worker dep added → `webapp-editor` ลบ dep ออก + ย้าย logic ไปใช้ Web Crypto API หรือ inline
