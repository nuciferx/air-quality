"use client";

import { useEffect, useState, useCallback } from "react";
import {
  HistoryReading,
  HistoryStat,
  fetchHistoryReadings,
  fetchHistoryStats,
} from "@/lib/api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { RefreshCw, Loader2, Clock, BarChart2 } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const HOUR_OPTIONS = [
  { label: "6h",  value: 6   },
  { label: "12h", value: 12  },
  { label: "24h", value: 24  },
  { label: "48h", value: 48  },
  { label: "7d",  value: 168 },
];

const DEVICE_COLORS: Record<string, string> = {
  "4lite":   "#22c55e",
  "maxpro":  "#3b82f6",
  "maxdown": "#f59e0b",
  "cat":     "#ec4899",
};

const DEVICE_NAMES: Record<string, string> = {
  "4lite":   "ห้องทำงานชั้น 2",
  "maxpro":  "ห้องนอนชั้น 2",
  "maxdown": "โถงชั้นล่าง",
  "cat":     "ห้องแมวชั้น 2",
};

const DEVICE_ORDER = ["4lite", "maxpro", "maxdown", "cat"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, dec = 1): string {
  if (v === null || v === undefined) return "—";
  return Number(v).toFixed(dec);
}

function fmtTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], {
    month: "short",
    day:   "numeric",
    hour:  "2-digit",
    minute:"2-digit",
  });
}

function fmtHour(iso: string): string {
  // iso = "2024-01-15T14:00:00" (UTC from SQLite)
  try {
    const d = new Date(iso + "Z"); // treat as UTC
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso.slice(11, 16);
  }
}

function fmtHourFull(iso: string): string {
  try {
    const d = new Date(iso + "Z");
    return d.toLocaleString([], {
      month:  "short",
      day:    "numeric",
      hour:   "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ── Chart data transform ──────────────────────────────────────────────────────

/**
 * Pivot stats rows into an array of objects keyed by hour, with one property
 * per device. E.g.:
 *   [ { hour: "14:00", "4lite": 12.3, "maxpro": 8.7, ... }, ... ]
 */
function pivotStats(
  stats: HistoryStat[],
  field: keyof Pick<HistoryStat, "pm25" | "temp" | "hum">
): Array<Record<string, string | number | null>> {
  const hourMap = new Map<string, Record<string, string | number | null>>();

  for (const row of stats) {
    if (!hourMap.has(row.hour)) {
      hourMap.set(row.hour, { hour: row.hour, label: fmtHour(row.hour) });
    }
    const entry = hourMap.get(row.hour)!;
    const val = row[field];
    entry[row.device_id] = val !== null && val !== undefined ? Number(val.toFixed(1)) : null;
  }

  return Array.from(hourMap.values());
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number | null; color: string }>;
  label?: string;
  unit?: string;
  fullHourMap?: Map<string, string>;
}

function DarkTooltip({ active, payload, label, unit = "", fullHourMap }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const title = label && fullHourMap ? (fullHourMap.get(label) ?? label) : label;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-400 mb-1">{title}</p>
      {payload.map((p) =>
        p.value !== null && p.value !== undefined ? (
          <p key={p.dataKey} style={{ color: p.color }}>
            {p.dataKey}: <span className="font-bold">{p.value}{unit}</span>
          </p>
        ) : null
      )}
    </div>
  );
}

// ── Stats cards ───────────────────────────────────────────────────────────────

interface DeviceStats {
  device_id: string;
  device_name: string;
  avgPm25: number | null;
  maxPm25: number | null;
  avgTemp: number | null;
}

function computeDeviceStats(readings: HistoryReading[]): DeviceStats[] {
  const byDevice = new Map<string, HistoryReading[]>();
  for (const r of readings) {
    if (!byDevice.has(r.device_id)) byDevice.set(r.device_id, []);
    byDevice.get(r.device_id)!.push(r);
  }

  const result: DeviceStats[] = [];
  for (const id of DEVICE_ORDER) {
    const rows = byDevice.get(id) ?? [];
    const pm25vals = rows.map((r) => r.pm25).filter((v): v is number => v !== null);
    const tempvals = rows.map((r) => r.temperature).filter((v): v is number => v !== null);
    result.push({
      device_id:   id,
      device_name: rows[0]?.device_name ?? id,
      avgPm25: pm25vals.length ? pm25vals.reduce((a, b) => a + b, 0) / pm25vals.length : null,
      maxPm25: pm25vals.length ? Math.max(...pm25vals) : null,
      avgTemp: tempvals.length ? tempvals.reduce((a, b) => a + b, 0) / tempvals.length : null,
    });
  }
  return result;
}

// ── Chart wrapper ─────────────────────────────────────────────────────────────

interface ChartCardProps {
  title: string;
  data: Array<Record<string, string | number | null>>;
  devices: string[];
  unit?: string;
  referenceLines?: Array<{ y: number; color: string; label: string }>;
  fullHourMap: Map<string, string>;
  note?: string;
}

function ChartCard({ title, data, devices, unit = "", referenceLines, fullHourMap, note }: ChartCardProps) {
  const visibleDevices = devices.filter((id) =>
    data.some((row) => row[id] !== null && row[id] !== undefined)
  );

  return (
    <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {note && <span className="text-xs text-gray-500">{note}</span>}
      </div>
      {visibleDevices.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
          No data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="label"
              tick={{ fill: "#64748b", fontSize: 11 }}
              angle={-45}
              textAnchor="end"
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 11 }}
              width={40}
            />
            <Tooltip
              content={
                <DarkTooltip unit={unit} fullHourMap={fullHourMap} />
              }
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: "#94a3b8", paddingTop: 8 }}
            />
            {referenceLines?.map((rl) => (
              <ReferenceLine
                key={rl.y}
                y={rl.y}
                stroke={rl.color}
                strokeDasharray="4 3"
                label={{ value: rl.label, fill: rl.color, fontSize: 10, position: "insideTopRight" }}
              />
            ))}
            {visibleDevices.map((id) => (
              <Line
                key={id}
                type="monotone"
                dataKey={id}
                stroke={DEVICE_COLORS[id] ?? "#6b7280"}
                strokeWidth={2}
                dot={false}
                connectNulls
                name={DEVICE_NAMES[id] ?? id}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const [readings, setReadings] = useState<HistoryReading[]>([]);
  const [stats,    setStats]    = useState<HistoryStat[]>([]);
  const [hours,    setHours]    = useState(24);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const load = useCallback(async (h: number) => {
    setLoading(true);
    setError(null);
    try {
      const [r, s] = await Promise.all([
        fetchHistoryReadings(h),
        fetchHistoryStats(h),
      ]);
      setReadings(r);
      setStats(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(hours);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function changeHours(h: number) {
    setHours(h);
    load(h);
  }

  // ── Chart data
  const pm25Data = pivotStats(stats, "pm25");
  const tempData = pivotStats(stats, "temp");
  const humData  = pivotStats(stats, "hum");

  // Map label → full datetime for tooltip
  const fullHourMap = new Map<string, string>(
    pm25Data.map((row) => [String(row.label), fmtHourFull(String(row.hour))])
  );

  const pm25RefLines = [
    { y: 15,  color: "#22c55e", label: "Good" },
    { y: 35,  color: "#eab308", label: "Fair" },
    { y: 75,  color: "#f97316", label: "Moderate" },
  ];

  // ── Stats cards
  const deviceStats = computeDeviceStats(readings);

  // ── Table: last 50 readings, most recent first
  const tableRows = [...readings]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 50);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">History</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            D1 database — {readings.length} readings in last {hours >= 168 ? "7d" : `${hours}h`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Time range tabs */}
          <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
            {HOUR_OPTIONS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => changeHours(value)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  hours === value
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => load(hours)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-900/40 border border-red-800 text-red-300 p-4 text-sm">
          {error}
        </div>
      )}

      {/* Stats cards */}
      {!loading && deviceStats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {deviceStats.map((ds) => {
            const color = DEVICE_COLORS[ds.device_id] ?? "#6b7280";
            const pmColor =
              ds.avgPm25 === null ? "text-gray-400"
              : ds.avgPm25 <= 15  ? "text-green-400"
              : ds.avgPm25 <= 35  ? "text-yellow-400"
              : ds.avgPm25 <= 75  ? "text-orange-400"
              :                     "text-red-400";
            return (
              <div
                key={ds.device_id}
                className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-4"
                style={{ borderLeftColor: color, borderLeftWidth: 3 }}
              >
                <p className="text-xs text-gray-500 mb-2 font-medium">{ds.device_name}</p>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Avg PM2.5</span>
                    <span className={`text-sm font-bold ${pmColor}`}>
                      {fmt(ds.avgPm25)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Max PM2.5</span>
                    <span className="text-sm font-semibold text-white">
                      {fmt(ds.maxPm25)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Avg Temp</span>
                    <span className="text-sm text-gray-300">
                      {ds.avgTemp !== null ? `${fmt(ds.avgTemp)}°C` : "—"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Charts */}
      {loading && stats.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={28} className="animate-spin text-blue-400" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <BarChart2 size={14} />
            <span>Hourly averages</span>
          </div>

          {/* PM2.5 chart */}
          <ChartCard
            title="PM2.5 Over Time"
            data={pm25Data}
            devices={DEVICE_ORDER}
            unit=" µg/m³"
            referenceLines={pm25RefLines}
            fullHourMap={fullHourMap}
          />

          {/* Temperature chart */}
          <ChartCard
            title="Temperature Over Time"
            data={tempData}
            devices={DEVICE_ORDER}
            unit="°C"
            fullHourMap={fullHourMap}
          />

          {/* Humidity chart */}
          <ChartCard
            title="Humidity Over Time"
            data={humData}
            devices={DEVICE_ORDER}
            unit="%"
            fullHourMap={fullHourMap}
          />
        </div>
      )}

      {/* Data table */}
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e293b] flex items-center gap-2">
          <Clock size={16} className="text-gray-400" />
          <h2 className="text-base font-semibold text-white">Recent Readings</h2>
          <span className="text-xs text-gray-500 ml-auto">
            Showing last {tableRows.length} of {readings.length}
          </span>
        </div>

        {loading && readings.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 size={24} className="animate-spin text-blue-400" />
          </div>
        ) : tableRows.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            No data for this period
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e293b] text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Time</th>
                  <th className="px-4 py-3 text-left">Device</th>
                  <th className="px-4 py-3 text-right">PM2.5</th>
                  <th className="px-4 py-3 text-right">Temp</th>
                  <th className="px-4 py-3 text-right">Humidity</th>
                  <th className="px-4 py-3 text-right">Filter</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e293b]">
                {tableRows.map((row, i) => {
                  const pm25 = row.pm25;
                  const pmColor =
                    pm25 === null  ? "text-gray-400"
                    : pm25 <= 15  ? "text-green-400"
                    : pm25 <= 35  ? "text-yellow-400"
                    : pm25 <= 75  ? "text-orange-400"
                    :               "text-red-400";
                  const filterColor =
                    row.filter_pct === null    ? "text-gray-400"
                    : row.filter_pct > 30      ? "text-green-400"
                    : row.filter_pct > 10      ? "text-yellow-400"
                    :                            "text-red-400";
                  const dotColor = DEVICE_COLORS[row.device_id] ?? "#6b7280";
                  return (
                    <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                        {fmtTs(row.ts)}
                      </td>
                      <td className="px-4 py-3 font-medium text-white">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: dotColor }}
                          />
                          {row.device_name}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right font-bold ${pmColor}`}>
                        {fmt(pm25)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {row.temperature !== null ? `${fmt(row.temperature)}°C` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {row.humidity !== null ? `${fmt(row.humidity, 0)}%` : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right ${filterColor}`}>
                        {row.filter_pct !== null ? `${row.filter_pct}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
