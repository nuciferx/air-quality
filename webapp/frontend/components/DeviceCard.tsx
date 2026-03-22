"use client";

import { Device, pm25Color, pm25Label } from "@/lib/api";
import AQIBar from "./AQIBar";
import { Thermometer, Droplets, Wind } from "lucide-react";

interface DeviceCardProps {
  device: Device;
}

function fmt(v: number | undefined, decimals = 0): string {
  if (v === undefined || v === null) return "—";
  return v.toFixed(decimals);
}

export default function DeviceCard({ device }: DeviceCardProps) {
  const { name, online, values } = device;
  const pm25 = values.pm25;
  const color = pm25Color(pm25);

  return (
    <div
      className={`
        relative rounded-2xl border p-5 flex flex-col gap-4 transition-all
        bg-gray-900 shadow-lg
        ${online ? "border-gray-700 hover:border-gray-500" : "border-gray-800 opacity-60"}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">{name}</h2>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full mt-1 inline-block ${
              online ? "bg-green-900 text-green-400" : "bg-gray-800 text-gray-500"
            }`}
          >
            {online ? "Online" : "Offline"}
          </span>
        </div>

        {/* PM2.5 big number */}
        <div className="text-right">
          <div
            className="text-4xl font-bold tabular-nums leading-none"
            style={{ color }}
          >
            {fmt(pm25)}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">PM2.5 µg/m³</div>
          <div className="text-xs font-medium mt-0.5" style={{ color }}>
            {pm25Label(pm25)}
          </div>
        </div>
      </div>

      {/* AQI bar */}
      <AQIBar value={values.aqi} />

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2">
        <Metric
          icon={<Thermometer size={14} className="text-orange-400" />}
          label="Temp"
          value={values.temp !== undefined ? `${fmt(values.temp, 1)}°C` : "—"}
        />
        <Metric
          icon={<Droplets size={14} className="text-blue-400" />}
          label="Humidity"
          value={values.hum !== undefined ? `${fmt(values.hum)}%` : "—"}
        />
        <Metric
          icon={<Wind size={14} className="text-purple-400" />}
          label="PM10"
          value={values.pm10 !== undefined ? `${fmt(values.pm10)}` : "—"}
        />
      </div>

      {/* Power indicator */}
      {values.power !== undefined && (
        <div className="absolute top-4 right-16">
          <div
            className={`w-2 h-2 rounded-full ${
              values.power ? "bg-green-400 shadow-[0_0_6px_#4ade80]" : "bg-gray-600"
            }`}
          />
        </div>
      )}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 bg-gray-800 rounded-xl p-2">
      <div className="flex items-center gap-1 text-gray-400">
        {icon}
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <span className="text-sm font-semibold text-white">{value}</span>
    </div>
  );
}
