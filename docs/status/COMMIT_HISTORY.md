# COMMIT_HISTORY.md

> Updated: 2026-05-17

Recent commits พร้อม context ที่ใช้ใน sprint review เก่ากว่า 90 วันย้ายไป `docs/archive/`

| Date | SHA | Subject | Context |
|---|---|---|---|
| 2026-05-17 | `804da0a` | feat(bot-renew): /renew Telegram command triggers auto-renew.yml | Sprint `bot-renew` ship. bot Worker only (zero-deps). +36 LoC. Approach B (Bot Dispatch + Trust Notify). Webhook-level ALLOWED_CHAT_ID gate. Deploy: bot version `d84019e1`. |
| 2026-05-17 | `b5ac730` | feat: add /aq-start session orientation skill | tooling — `.claude/skills/aq-start/` |
| 2026-05-17 | `4985f72` | security: stop printing the Xiaomi password in get_token_browser.py | hardening — local tooling script |
| 2026-05-17 | `f0e6a1d` | feat: commit safe tooling scripts + README usage docs | tooling — root *.py scripts + README usage block |
| 2026-05-17 | `8d6be86` | feat: commit production webapp (Worker + Frontend) + Telegram bot | initial commit ของ production code wholesale |
| 2026-05-17 | `61cf32c` | chore: expand .gitignore to cover build artifacts and Windows junk | tooling |
| 2026-04-13 | (uncommitted then) | Phase 5 — Auto-control PM2.5 | per-room state, danger/safe thresholds |
| 2026-04-13 | (uncommitted then) | Phase 4 — Token auto-renew via passToken | bypass 2FA |
| earlier | | Phase 1–3 | Logger / Bot+Qwen / Worker+D1+cron |

## Notes

- ก่อน 2026-05-17 production code อยู่ใน local working tree เท่านั้น — `8d6be86` เป็น first commit ของ production source
- commit history ก่อน `8d6be86` คือ tooling-only commits จาก Claude Code sessions
- master branch ไม่มี remote push policy — commit เป็น checkpoint local เท่านั้น (per CLAUDE.md "Never push to a remote")
