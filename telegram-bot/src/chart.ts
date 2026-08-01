/**
 * Zero-dependency PNG line-chart renderer for Cloudflare Workers.
 *
 * ไม่มี canvas / ไม่มี lib ภายนอก — วาดลง buffer แบบ indexed-color (PNG type 3)
 * แล้ว encode เป็น PNG ด้วย deflate "stored" blocks (ไม่บีบอัดจริง แต่ถูกต้องตาม spec)
 *
 * ข้อความในรูปเป็น ASCII เท่านั้น (ฟอนต์ bitmap 5x7) — ชื่อห้องภาษาไทยให้ไปอยู่ใน
 * caption ของข้อความ Telegram แทน เพราะการฝังฟอนต์ไทยลง worker ไม่คุ้ม
 */

// ── Palette (PNG color type 3) ────────────────────────────────────────────────

export const COLOR = {
  BG: 0,
  GRID: 1,
  AXIS: 2,
  TEXT: 3,
  S1: 4, // 🔵 sky
  S2: 5, // 🟢 emerald
  S3: 6, // 🟡 amber
  S4: 7, // 🟣 violet
  DANGER: 8,
} as const;

const PALETTE: [number, number, number][] = [
  [15, 23, 42],    // 0 bg      slate-900
  [30, 41, 59],    // 1 grid    slate-800
  [100, 116, 139], // 2 axis    slate-500
  [226, 232, 240], // 3 text    slate-200
  [56, 189, 248],  // 4 sky-400
  [52, 211, 153],  // 5 emerald-400
  [251, 191, 36],  // 6 amber-400
  [167, 139, 250], // 7 violet-400
  [239, 68, 68],   // 8 red-500
];

export const SERIES_COLORS = [COLOR.S1, COLOR.S2, COLOR.S3, COLOR.S4];
/** emoji ที่ตรงกับสีเส้นแต่ละชุด — ใช้ทำ legend ใน caption */
export const SERIES_EMOJI = ["🔵", "🟢", "🟡", "🟣"];

// ── 5x7 bitmap font (ASCII subset) — column-major, bit0 = แถวบนสุด ──────────

const FONT: Record<string, number[]> = {
  " ": [0x00, 0x00, 0x00, 0x00, 0x00],
  ".": [0x00, 0x60, 0x60, 0x00, 0x00],
  ":": [0x00, 0x36, 0x36, 0x00, 0x00],
  "/": [0x20, 0x10, 0x08, 0x04, 0x02],
  "-": [0x08, 0x08, 0x08, 0x08, 0x08],
  "%": [0x23, 0x13, 0x08, 0x64, 0x62],
  "(": [0x00, 0x1c, 0x22, 0x41, 0x00],
  ")": [0x00, 0x41, 0x22, 0x1c, 0x00],
  "0": [0x3e, 0x51, 0x49, 0x45, 0x3e],
  "1": [0x00, 0x42, 0x7f, 0x40, 0x00],
  "2": [0x42, 0x61, 0x51, 0x49, 0x46],
  "3": [0x21, 0x41, 0x45, 0x4b, 0x31],
  "4": [0x18, 0x14, 0x12, 0x7f, 0x10],
  "5": [0x27, 0x45, 0x45, 0x45, 0x39],
  "6": [0x3c, 0x4a, 0x49, 0x49, 0x30],
  "7": [0x01, 0x71, 0x09, 0x05, 0x03],
  "8": [0x36, 0x49, 0x49, 0x49, 0x36],
  "9": [0x06, 0x49, 0x49, 0x29, 0x1e],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e],
  B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41],
  F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a],
  H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01],
  K: [0x7f, 0x08, 0x14, 0x22, 0x41],
  L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e],
  R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31],
  T: [0x01, 0x01, 0x7f, 0x01, 0x01],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
  W: [0x3f, 0x40, 0x38, 0x40, 0x3f],
  X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07],
  Z: [0x61, 0x51, 0x49, 0x45, 0x43],
};

// ── Canvas ────────────────────────────────────────────────────────────────────

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly px: Uint8Array;

  constructor(width: number, height: number, bg = COLOR.BG) {
    this.width = width;
    this.height = height;
    this.px = new Uint8Array(width * height).fill(bg);
  }

  set(x: number, y: number, color: number): void {
    const xi = x | 0;
    const yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return;
    this.px[yi * this.width + xi] = color;
  }

  hLine(x0: number, x1: number, y: number, color: number): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, color);
  }

  vLine(x: number, y0: number, y1: number, color: number): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, color);
  }

  /** เส้นประ — ใช้กับเส้น threshold */
  hLineDashed(x0: number, x1: number, y: number, color: number, on = 6, off = 5): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      if ((x - x0) % (on + off) < on) this.set(x, y, color);
    }
  }

  /** Bresenham + ความหนา (วาดซ้ำเยื้องขึ้น-ลง) */
  line(x0: number, y0: number, x1: number, y1: number, color: number, thickness = 2): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const xe = Math.round(x1);
    const ye = Math.round(y1);
    const dx = Math.abs(xe - x);
    const dy = -Math.abs(ye - y);
    const sx = x < xe ? 1 : -1;
    const sy = y < ye ? 1 : -1;
    let err = dx + dy;

    for (;;) {
      for (let t = 0; t < thickness; t++) this.set(x, y + t, color);
      if (x === xe && y === ye) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  /** ข้อความ ASCII (ตัวพิมพ์เล็กจะถูกแปลงเป็นพิมพ์ใหญ่) — scale = ขนาดพิกเซลต่อจุด */
  text(x: number, y: number, str: string, color: number, scale = 1): number {
    let cx = x;
    for (const raw of str.toUpperCase()) {
      const glyph = FONT[raw] ?? FONT[" "];
      for (let col = 0; col < 5; col++) {
        const bits = glyph[col];
        for (let row = 0; row < 7; row++) {
          if (!(bits & (1 << row))) continue;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              this.set(cx + col * scale + sx, y + row * scale + sy, color);
            }
          }
        }
      }
      cx += 6 * scale;
    }
    return cx - x;
  }
}

export function textWidth(str: string, scale = 1): number {
  return str.length * 6 * scale;
}

// ── PNG encoding ──────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);

  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

/** zlib stream ที่ใช้ deflate "stored" blocks — ไม่บีบอัด แต่ decode ได้ทุกที่ */
function zlibStored(raw: Uint8Array): Uint8Array {
  const MAX = 65535;
  const blocks: Uint8Array[] = [];
  for (let off = 0; off < raw.length; off += MAX) {
    const len = Math.min(MAX, raw.length - off);
    const final = off + len >= raw.length ? 1 : 0;
    const header = new Uint8Array(5);
    header[0] = final;
    header[1] = len & 0xff;
    header[2] = (len >>> 8) & 0xff;
    header[3] = ~len & 0xff;
    header[4] = (~len >>> 8) & 0xff;
    blocks.push(header, raw.subarray(off, off + len));
  }

  const size = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(2 + size + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let pos = 2;
  for (const b of blocks) { out.set(b, pos); pos += b.length; }
  out.set(u32(adler32(raw)), pos);
  return out;
}

function encodePng(canvas: Canvas): Uint8Array {
  const { width, height, px } = canvas;

  // scanline: filter byte (0 = None) + pixel indices
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    raw.set(px.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 3;  // color type: indexed
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const plte = new Uint8Array(PALETTE.length * 3);
  PALETTE.forEach(([r, g, b], i) => {
    plte[i * 3] = r;
    plte[i * 3 + 1] = g;
    plte[i * 3 + 2] = b;
  });

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { png.set(p, pos); pos += p.length; }
  return png;
}

// ── Line chart ────────────────────────────────────────────────────────────────

export interface Series {
  /** index ใน SERIES_COLORS */
  colorIndex: number;
  /** null = ไม่มีข้อมูลชั่วโมงนั้น (เว้นช่องว่าง ไม่ลากเส้นข้าม) */
  points: (number | null)[];
}

export interface ChartOptions {
  /** ASCII เท่านั้น เช่น "PM2.5 - 24H" */
  title: string;
  /** ASCII เช่น "UG/M3", "C", "%" */
  unit: string;
  series: Series[];
  /** ป้ายแกน X: ตำแหน่ง index ของจุด + ข้อความ ASCII */
  xLabels: { index: number; text: string }[];
  /** เส้นประแนวนอน (เช่น threshold 40 µg/m³) — วาดเฉพาะเมื่ออยู่ในช่วงแกน */
  threshold?: number;
  /** true = แกนเริ่มที่ 0 เสมอ (ค่าฝุ่น) · false = ซูมเข้าช่วงข้อมูล (อุณหภูมิ/ความชื้น) */
  zeroBase?: boolean;
  width?: number;
  height?: number;
}

/** ปัดขั้นแกน Y ให้เป็นเลขกลม ๆ (1 / 2 / 2.5 / 5 / 10 × 10^n) */
function niceStep(rough: number): number {
  if (!(rough > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

export function renderLineChart(opts: ChartOptions): Uint8Array {
  const width = opts.width ?? 820;
  const height = opts.height ?? 420;
  const cv = new Canvas(width, height);

  const padL = 56;
  const padR = 18;
  const padT = 38;
  const padB = 34;
  const x0 = padL;
  const x1 = width - padR;
  const y0 = padT;
  const y1 = height - padB;

  const values = opts.series.flatMap((s) => s.points).filter((v): v is number => v !== null);
  const rawMax = values.length > 0 ? Math.max(...values) : 10;
  const rawMin = values.length > 0 ? Math.min(...values) : 0;

  // สเกลอิงข้อมูลจริงเท่านั้น — ไม่เอา threshold มาดันเพดาน ไม่งั้นวันอากาศดี
  // เส้นจะแบนติดพื้นจนอ่านไม่ออก (threshold จะถูกวาดเฉพาะเมื่อยังอยู่ในช่วง)
  let lo: number;
  let hi: number;
  if (opts.zeroBase) {
    lo = 0;
    hi = Math.max(rawMax * 1.15, 1);
  } else {
    const pad = Math.max(1, (rawMax - rawMin) * 0.2);
    lo = rawMin - pad;
    hi = rawMax + pad;
  }
  const step = niceStep((hi - lo) / 4);
  const yMin = Math.max(opts.zeroBase ? 0 : -Infinity, Math.floor(lo / step) * step);
  const yMax = Math.ceil(hi / step) * step;
  const span = Math.max(step, yMax - yMin);

  const count = Math.max(1, opts.series[0]?.points.length ?? 1);
  const xOf = (i: number) => x0 + (count === 1 ? 0 : ((x1 - x0) * i) / (count - 1));
  const yOf = (v: number) => y1 - ((v - yMin) / span) * (y1 - y0);

  // กริดแนวนอนทุก step + ป้ายค่า
  for (let value = yMin; value <= yMax + 1e-9; value += step) {
    const y = Math.round(yOf(value));
    cv.hLine(x0, x1, y, COLOR.GRID);
    const label = value >= 100 ? String(Math.round(value)) : value.toFixed(value % 1 === 0 ? 0 : 1);
    cv.text(x0 - 10 - textWidth(label), y - 3, label, COLOR.AXIS);
  }

  // แกน
  cv.vLine(x0, y0, y1, COLOR.AXIS);
  cv.hLine(x0, x1, y1, COLOR.AXIS);

  // เส้น threshold
  if (opts.threshold !== undefined && opts.threshold >= yMin && opts.threshold <= yMax) {
    cv.hLineDashed(x0, x1, Math.round(yOf(opts.threshold)), COLOR.DANGER);
  }

  // ป้ายแกน X
  for (const { index, text } of opts.xLabels) {
    const x = Math.round(xOf(index));
    cv.vLine(x, y1, y1 + 4, COLOR.AXIS);
    cv.text(x - textWidth(text) / 2, y1 + 10, text, COLOR.AXIS);
  }

  // เส้นข้อมูล
  for (const s of opts.series) {
    const color = SERIES_COLORS[s.colorIndex % SERIES_COLORS.length];
    let prev: { x: number; y: number } | null = null;
    for (let i = 0; i < s.points.length; i++) {
      const v = s.points[i];
      if (v === null) { prev = null; continue; }
      const p = { x: xOf(i), y: yOf(v) };
      if (prev) cv.line(prev.x, prev.y, p.x, p.y, color);
      else if (s.points.length === 1) cv.line(p.x, p.y, p.x, p.y, color);
      prev = p;
    }
  }

  // หัวเรื่อง + หน่วย
  cv.text(14, 12, opts.title, COLOR.TEXT, 2);
  cv.text(x1 - textWidth(opts.unit), 16, opts.unit, COLOR.AXIS);

  return encodePng(cv);
}
