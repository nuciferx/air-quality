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

interface RefLine {
  value: number;
  color: string;
}

interface HistoryChartProps {
  rows: HistoryRow[];
  metric: keyof Pick<HistoryRow, "pm25" | "temperature" | "humidity" | "aqi" | "pm10">;
  unit: string;
  label: string;
  refLines?: RefLine[];
  yDomain?: [number | "auto", number | "auto"];
}

const DEVICE_COLORS: Record<string, string> = {
  "ห้องนอนชั้น 2":   "#a78bfa",
  "ห้องทำงานชั้น 2": "#38bdf8",
  "โถงชั้นล่าง":      "#fb923c",
  "ห้องแมวชั้น 2":   "#4ade80",
};

const FALLBACK_COLORS = ["#38bdf8", "#a78bfa", "#fb923c", "#4ade80", "#f472b6", "#facc15"];

export default function HistoryChart({ rows, metric, unit, label, refLines = [], yDomain }: HistoryChartProps) {
  const { chartData, devices } = useMemo(() => {
    if (!rows.length) return { chartData: [], devices: [] };

    const deviceSet = new Set<string>(rows.map((r) => r.device_name));
    const devList   = Array.from(deviceSet);

    const byTime = new Map<string, Record<string, number | null>>();
    for (const row of rows) {
      const ts = new Date(row.ts * 1000).toISOString().slice(0, 16);
      if (!byTime.has(ts)) byTime.set(ts, { time: ts as unknown as number });
      const entry = byTime.get(ts)!;
      entry[row.device_name] = row[metric] ?? null;
    }

    const sorted = Array.from(byTime.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);

    return { chartData: sorted, devices: devList };
  }, [rows, metric]);

  function formatTime(t: string) {
    if (!t) return "";
    const date = new Date(t.replace("T", " ") + ":00Z");
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  if (!chartData.length) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">No data available</div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="time"
          tickFormatter={formatTime}
          tick={{ fill: "#9ca3af", fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={yDomain}
          tick={{ fill: "#9ca3af", fontSize: 11 }}
          label={{ value: label, angle: -90, position: "insideLeft", fill: "#6b7280", fontSize: 11 }}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: 8 }}
          labelStyle={{ color: "#e5e7eb" }}
          formatter={(value: number) => [`${value?.toFixed(1)} ${unit}`]}
          labelFormatter={formatTime}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#9ca3af" }} />
        {refLines.map((r) => (
          <ReferenceLine
            key={r.value}
            y={r.value}
            stroke={r.color}
            strokeDasharray="4 4"
            label={{ value: String(r.value), fill: r.color, fontSize: 10 }}
          />
        ))}
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
