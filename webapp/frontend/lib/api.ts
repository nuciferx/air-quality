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
  aqi?: number;
  temp?: number;
  hum?: number;
  pm10?: number;
  power?: boolean;
  mode?: number;
  fan?: number;
  buzz?: boolean;
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

export interface HistoryRow {
  timestamp: string;
  device: string;
  pm25: number | null;
  aqi: number | null;
  temperature: number | null;
  humidity: number | null;
  pm10: number | null;
}

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
  const data = await apiFetch<{ rows: HistoryRow[] }>(`/api/history?hours=${hours}`);
  return data.rows;
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
    host: "sg.api.io.mi.com",
    props: {
      power: { siid: 2, piid: 1 },
      mode:  { siid: 2, piid: 4 },
      fan:   { siid: 2, piid: 11 },
      buzz:  { siid: 2, piid: 11 },
    },
  },
  maxpro: {
    did: "460764069",
    host: "api.io.mi.com",
    props: {
      power: { siid: 2, piid: 1 },
      mode:  { siid: 2, piid: 4 },
      fan:   { siid: 2, piid: 11 },
      buzz:  { siid: 2, piid: 11 },
    },
  },
  maxdown: {
    did: "131590393",
    host: "api.io.mi.com",
    props: {
      power: { siid: 2, piid: 1 },
      mode:  { siid: 2, piid: 4 },
      fan:   { siid: 2, piid: 11 },
      buzz:  { siid: 2, piid: 11 },
    },
  },
  cat: {
    did: "357231085",
    host: "api.io.mi.com",
    props: {
      power: { siid: 2, piid: 1 },
      mode:  { siid: 2, piid: 4 },
      fan:   { siid: 2, piid: 11 },
      buzz:  { siid: 2, piid: 11 },
    },
  },
};
