---
name: idea
description: Research a feature idea for the air-quality project BEFORE writing any code. Produces a one-page decision doc (Build / Spike / Backlog / Drop) and optionally appends to IDEAS.md. Token-lean by design — does NOT re-explore the codebase; trusts CLAUDE.md / AGENTS.md / PROGRESS.md / IDEAS.md as ground truth.
---

# /idea — feature research workflow

ใช้ก่อนเขียนโค้ดทุกครั้งที่ idea ยังไม่ชัดว่าควรทำหรือเปล่า ปลายทางคือ **decision doc 1 หน้า** ไม่ใช่ implementation

## When to invoke

- ผู้ใช้พิมพ์ `/idea <ข้อความสั้น>` เช่น `/idea outdoor vs indoor card`
- ผู้ใช้เรียก `/idea` เปล่าๆ → ถามว่า idea คืออะไร 1 บรรทัด
- ผู้ใช้พูดว่า "ลองคิดดูว่าจะเพิ่ม X ดีไหม" / "สมควรทำ X ไหม"

## Token budget — ต้องประหยัด

**Do:**
- อ่านได้ทุกครั้ง: `CLAUDE.md`, `AGENTS.md` §3+§14, `IDEAS.md`, `PROGRESS.md`
- อ่านได้เมื่อจำเป็น: ส่วน symbol ที่ idea จะแตะตรงๆ (ใช้ Grep หาบรรทัด แล้ว Read แค่ช่วงนั้น)

**Don't:**
- ห้าม spawn Explore / general-purpose agent — ใช้ Grep/Read ตรงๆ
- ห้าม read ทั้งไฟล์ `webapp/worker/src/index.ts` (ใหญ่) เว้นแต่ idea ต้องการเข้าใจ logic เก่าจริงๆ
- ห้าม run `wrangler` / `curl` production endpoint เว้นแต่ idea ต้องอาศัยข้อมูลจริง — ถ้าต้องใช้ ให้เรียก agent `usage-analyst` แทน
- ห้าม implement แม้แต่ stub — ผลลัพธ์คือเอกสารเท่านั้น

## Workflow

### 1. Reframe (1–2 ประโยค)
แปลง idea เป็นรูป "ผู้ใช้ X อยากทำ Y เพราะ Z" ถ้า Z ไม่ชัดให้ถามผู้ใช้ก่อน

### 2. Check overlap
Grep ใน `IDEAS.md` + `PROGRESS.md` ว่ามี idea คล้ายกันหรือไม่ ถ้ามีให้บอกผู้ใช้และถามว่า extend ของเดิมหรือ idea ใหม่

### 3. Map surfaces
ระบุว่า idea จะแตะ surface ไหน (worker / frontend / bot / cron / d1 / kv / github-actions) — ยิ่งน้อย ยิ่ง cheap

### 4. Smallest provable version
"version เล็กที่สุดที่ทำให้รู้ว่า idea นี้คุ้ม" คืออะไร เช่น เพิ่ม 1 endpoint + log ผลใน Telegram 1 สัปดาห์ก่อนทำ UI

### 5. Cost & risk
- Effort เป็น "พักครึ่งวัน / 1–2 วัน / สัปดาห์+"
- Dependencies ใหม่ (เตือนถ้าจะเพิ่ม dep ลง worker — worker ต้อง zero-deps)
- Drop conditions: ใช้แล้วไม่ดูภายในกี่วัน/ไม่กดกี่ครั้งจะลบ

### 6. Verdict
หนึ่งใน 4:
- **Build** — clear win, ลงมือเลยได้ (แนะนำให้เรียก `air-quality-planner` ต่อ)
- **Spike** — ทำ throw-away prototype ก่อนเพื่อ validate
- **Backlog** — idea ดีแต่ priority ต่ำกว่าของอื่นที่ค้างอยู่
- **Drop** — ไม่คุ้ม / overlap / break invariant สำคัญ

## Output format (เคร่งครัด — ≤300 คำ)

```
# Idea: <ชื่อสั้น>

**Problem:** <1–2 ประโยค ผู้ใช้เจอปัญหาอะไร>
**Smallest version:** <1–2 ประโยค>
**Surfaces:** worker | frontend | bot | cron | d1 | kv | gh-actions  (เลือกที่แตะ)
**Effort:** <ครึ่งวัน | 1–2 วัน | สัปดาห์+>
**New deps:** <none | <ชื่อ + เหตุผล>>
**Risks:**
- <risk แรก — รวมถึงกฎที่อาจชน เช่น 5-point sync rule, zero-deps>
- <risk สอง>
**Overlap:** <ลิงก์เข้า IDEAS.md / PROGRESS.md ที่เคยพูดถึง — หรือ "none">
**Drop if:** <สัญญาณที่จะลบทิ้ง เช่น "ไม่กดใน 14 วัน">

**Verdict:** Build | Spike | Backlog | Drop
**Next step:** <คำสั่งตรงๆ — ปกติคือเรียก `air-quality-planner` หรือเขียน spike branch>
```

## After verdict

- **Build/Spike** → ถามผู้ใช้ว่าจะ append idea เข้า `IDEAS.md` หรือไม่ (ใต้หัวข้อ "## Backlog (researched)") ถ้าตกลงให้ append ด้วย Edit (ไม่ rewrite)
- **Backlog** → append เข้า `IDEAS.md` พร้อม verdict
- **Drop** → ไม่ต้อง append แต่บันทึก 1 บรรทัดใน `IDEAS.md` ใต้ "## Dropped (with reason)" เพื่อกัน idea เดิมวนกลับมาอีก

ห้ามแก้ `PROGRESS.md` จาก skill นี้ — `PROGRESS.md` reflect ของที่ ship แล้วเท่านั้น

## Anti-patterns

- เขียนเอกสารเกิน 300 คำ
- ฟังธงโดยไม่ check overlap → ผลคือเสนอ idea ที่มีอยู่แล้ว
- อนุมัติ "Build" โดยไม่บอก smallest version → ลงมือทำ feature เต็มทันทีเสีย token
- อ่าน source code ทั้งไฟล์เพื่อ "เข้าใจ context" — ใช้ CLAUDE.md/AGENTS.md ก่อน
