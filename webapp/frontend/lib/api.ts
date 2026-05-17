/**
 * Typed API client for the Air Quality API.
 *
 * In production the API is a Cloudflare Worker. Set NEXT_PUBLIC_API_URL to
 * the worker URL (e.g. https://air-quality-api.YOUR_SUBDOMAIN.workers.dev).
 *
 * In local development either:
 *   a) Point NEXT_PUBLIC_API_URL at a locally running `wrangler dev` instance, or
 *   b) Leave it unset — Next.js will proxy /api/* to localhost:8000 (legacy
 *      FastAPI backend) via the rewrites in next.config.js.
 */

const API_BASE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "")
    : "";

export interface DeviceValues {
  pm25?: number;
  pm10?: number;
  aqi?: number;
  temp?: number;
  hum?: number;
  power?: boolean;
  mode?: number;
  fan?: number;    // 4lite only: Favorite Level 1–14
  buzz?: boolean;
  lock?: boolean;
  filter?: number; // % remaining
}

export interface Device {
  id: string;
  name: string;
  did: string;
  host: string;
  online: boolean;
  values: DeviceValues;
  fetched_at: number;
}

/** Raw reading row returned by GET /api/history */
export interface HistoryReading {
  id?: number;
  ts: number;
  device_id: string;
  device_name: string;
  pm25: number | null;
  pm10: number | null;
  aqi: number | null;
  temperature: number | null;
  humidity: number | null;
  power: number | null;
  mode: number | null;
  filter_pct: number | null;
}

/** Hourly-averaged stat row returned by GET /api/history/stats */
export interface HistoryStat {
  device_id: string;
  device_name: string;
  hour: string; // ISO datetime string e.g. "2024-01-15T14:00:00"
  pm25: number | null;
  temp: number | null;
  hum: number | null;
  filter_pct: number | null;
  count: number;
}

/** Row returned by GET /api/history (alias for HistoryReading) */
export type HistoryRow = HistoryReading;

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Devices ───────────────────────────────────────────────────────────────────

export async function fetchAllDevices(): Promise<Device[]> {
  const data = await apiFetch<{ devices: Device[] }>("/api/devices");
  return data.devices;
}

export async function fetchDevice(id: string): Promise<Device> {
  return apiFetch<Device>(`/api/device/${id}`);
}

// ── Control ───────────────────────────────────────────────────────────────────

export interface ControlPayload {
  did: string;
  host: string;
  siid: number;
  piid: number;
  value: boolean | number | string;
}

export async function sendControl(payload: ControlPayload): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ── History ───────────────────────────────────────────────────────────────────

export async function fetchHistory(hours = 24): Promise<HistoryRow[]> {
  const data = await apiFetch<{ rows?: HistoryRow[]; readings?: HistoryRow[] }>(
    `/api/history?hours=${hours}`
  );
  return data.readings ?? data.rows ?? [];
}

export async function fetchHistoryReadings(hours = 24, device = "all"): Promise<HistoryReading[]> {
  const data = await apiFetch<{ readings: HistoryReading[] }>(
    `/api/history?hours=${hours}&device=${device}`
  );
  return data.readings;
}

export async function fetchHistoryStats(hours = 24): Promise<HistoryStat[]> {
  const data = await apiFetch<{ stats: HistoryStat[] }>(`/api/history/stats?hours=${hours}`);
  return data.stats;
}

// ── SSE helper ────────────────────────────────────────────────────────────────

/**
 * Open a Server-Sent Events connection to /api/stream.
 * Returns a cleanup function — call it to close the connection.
 */
export function subscribeToStream(
  onDevices: (devices: Device[]) => void,
  onError?: (err: Event) => void
): () => void {
  const streamUrl = `${API_BASE}/api/stream`;
  const es = new EventSource(streamUrl);

  es.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as { devices: Device[]; error?: string };
      if (payload.devices) {
        onDevices(payload.devices);
      }
    } catch {
      // ignore parse errors
    }
  };

  if (onError) {
    es.onerror = onError;
  }

  return () => es.close();
}

// ── PM2.5 colour helper ───────────────────────────────────────────────────────

export function pm25Color(value: number | undefined): string {
  if (value === undefined || value === null) return "#6b7280"; // gray
  if (value <= 15) return "#22c55e";   // green
  if (value <= 35) return "#eab308";   // yellow
  if (value <= 75) return "#f97316";   // orange
  return "#ef4444";                    // red
}

export function pm25Label(value: number | undefined): string {
  if (value === undefined || value === null) return "N/A";
  if (value <= 15) return "Good";
  if (value <= 35) return "Fair";
  if (value <= 75) return "Moderate";
  return "Poor";
}

export function pm25BgClass(value: number | undefined): string {
  if (value === undefined || value === null) return "bg-gray-500";
  if (value <= 15) return "bg-green-500";
  if (value <= 35) return "bg-yellow-500";
  if (value <= 75) return "bg-orange-500";
  return "bg-red-500";
}

// ── Device prop specs (mirrors backend DEVICES) ───────────────────────────────

export const DEVICE_PROP_SPECS: Record<
  string,
  { host: string; did: string; props: Record<string, { siid: number; piid: number }> }
> = {
  "4lite": {
    did: "873639853",
    host: "sg",
    props: {
      power:  { siid: 2, piid: 1  },
      mode:   { siid: 2, piid: 4  },
      fan:    { siid: 9, piid: 11 },
      buzz:   { siid: 6, piid: 1  },
      lock:   { siid: 8, piid: 1  },
    },
  },
  maxpro: {
    did: "460764069",
    host: "cn",
    props: {
      power:  { siid: 2, piid: 1 },
      mode:   { siid: 2, piid: 2 },
      buzz:   { siid: 7, piid: 1 },
      lock:   { siid: 8, piid: 1 },
    },
  },
  maxdown: {
    did: "131590393",
    host: "cn",
    props: {
      power:  { siid: 2, piid: 1 },
      mode:   { siid: 2, piid: 2 },
      buzz:   { siid: 7, piid: 1 },
      lock:   { siid: 8, piid: 1 },
    },
  },
  cat: {
    did: "357231085",
    host: "cn",
    props: {
      power:  { siid: 2, piid: 1 },
      mode:   { siid: 2, piid: 2 },
      buzz:   { siid: 6, piid: 1 },
      lock:   { siid: 5, piid: 1 },
    },
  },
};
