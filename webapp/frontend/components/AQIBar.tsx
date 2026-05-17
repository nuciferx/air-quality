"use client";

interface AQIBarProps {
  value?: number;
  max?: number;
}

const SEGMENTS = [
  { label: "Good",      max: 50,  color: "#22c55e" },
  { label: "Moderate",  max: 100, color: "#eab308" },
  { label: "Unhealthy", max: 150, color: "#f97316" },
  { label: "Very Unhl", max: 200, color: "#ef4444" },
  { label: "Hazardous", max: 300, color: "#7c3aed" },
];

function aqiColor(value: number): string {
  if (value <= 50)  return "#22c55e";
  if (value <= 100) return "#eab308";
  if (value <= 150) return "#f97316";
  if (value <= 200) return "#ef4444";
  return "#7c3aed";
}

export default function AQIBar({ value, max = 300 }: AQIBarProps) {
  const safeVal = Math.min(value ?? 0, max);
  const pct = (safeVal / max) * 100;
  const color = value !== undefined ? aqiColor(value) : "#6b7280";

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>AQI</span>
        <span style={{ color }} className="font-semibold">
          {value !== undefined ? value : "—"}
        </span>
      </div>
      {/* gradient track */}
      <div className="relative h-2 rounded-full overflow-hidden bg-gray-700">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "linear-gradient(to right, #22c55e 0%, #eab308 33%, #f97316 55%, #ef4444 75%, #7c3aed 100%)",
          }}
        />
        {/* dark overlay from the right to show fill */}
        <div
          className="absolute top-0 right-0 h-full bg-gray-800 rounded-r-full transition-all duration-500"
          style={{ width: `${100 - pct}%` }}
        />
        {/* thumb */}
        {value !== undefined && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow transition-all duration-500"
            style={{ left: `calc(${pct}% - 5px)`, backgroundColor: color }}
          />
        )}
      </div>
      {/* segment labels */}
      <div className="flex justify-between mt-1">
        {SEGMENTS.map((s) => (
          <span key={s.label} className="text-[9px] text-gray-500" style={{ color: s.color }}>
            {s.max}
          </span>
        ))}
      </div>
    </div>
  );
}
