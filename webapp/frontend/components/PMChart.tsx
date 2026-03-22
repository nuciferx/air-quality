"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { HistoryRow } from "@/lib/api";
import { useMemo } from "react";

interface PMChartProps {
  rows: HistoryRow[];
}

const DEVICE_COLORS: Record<string, string> = {
  "4 Lite":       "#38bdf8",
  "MAX Pro":      "#a78bfa",
  "MAX ชั้นล่าง": "#fb923c",
  "แมว":          "#4ade80",
};

const FALLBACK_COLORS = ["#38bdf8", "#a78bfa", "#fb923c", "#4ade80", "#f472b6", "#facc15"];

export default function PMChart({ rows }: PMChartProps) {
  // Transform rows: pivot devices as keys on each timestamp bucket
  const { chartData, devices } = useMemo(() => {
    if (!rows.length) return { chartData: [], devices: [] };

    // Collect unique devices
    const deviceSet = new Set<string>(rows.map((r) => r.device));
    const devList   = Array.from(deviceSet);

    // Group by timestamp (round to minute)
    const byTime = new Map<string, Record<string, number | null>>();
    for (const row of rows) {
      const ts = row.timestamp.slice(0, 16); // YYYY-MM-DDTHH:MM
      if (!byTime.has(ts)) {
        byTime.set(ts, { time: ts as unknown as number });
      }
      const entry = byTime.get(ts)!;
      entry[row.device] = row.pm25 ?? null;
    }

    const sorted = Array.from(byTime.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);

    return { chartData: sorted, devices: devList };
  }, [rows]);

  function formatTime(t: string) {
    if (!t) return "";
    const date = new Date(t.replace("T", " ") + ":00Z");
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  if (!chartData.length) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="time"
          tickFormatter={formatTime}
          tick={{ fill: "#9ca3af", fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: "#9ca3af", fontSize: 11 }}
          label={{
            value: "PM2.5 µg/m³",
            angle: -90,
            position: "insideLeft",
            fill: "#6b7280",
            fontSize: 11,
          }}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: 8 }}
          labelStyle={{ color: "#e5e7eb" }}
          formatter={(value: number) => [`${value?.toFixed(1)} µg/m³`]}
          labelFormatter={formatTime}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#9ca3af" }} />
        {/* Reference lines for thresholds */}
        <ReferenceLine y={15} stroke="#22c55e" strokeDasharray="4 4" label={{ value: "15", fill: "#22c55e", fontSize: 10 }} />
        <ReferenceLine y={35} stroke="#eab308" strokeDasharray="4 4" label={{ value: "35", fill: "#eab308", fontSize: 10 }} />
        <ReferenceLine y={75} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "75", fill: "#ef4444", fontSize: 10 }} />

        {devices.map((dev, i) => (
          <Line
            key={dev}
            type="monotone"
            dataKey={dev}
            stroke={DEVICE_COLORS[dev] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
