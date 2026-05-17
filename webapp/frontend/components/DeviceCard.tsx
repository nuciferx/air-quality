"use client";

import { useState } from "react";
import { Device, pm25Color, pm25Label, sendControl, DEVICE_PROP_SPECS } from "@/lib/api";
import { Thermometer, Droplets, Filter, Power, Volume2, Lock } from "lucide-react";

interface DeviceCardProps {
  device: Device;
  onRefresh?: () => void;
}

interface ModeOption {
  label: string;
  value: number;
}

const DEVICE_MODES: Record<string, ModeOption[]> = {
  "4lite": [
    { label: "Auto",     value: 0 },
    { label: "Sleep",    value: 1 },
    { label: "Favorite", value: 2 },
    { label: "Fan",      value: 3 },
  ],
  maxpro: [
    { label: "Auto",  value: 0 },
    { label: "Sleep", value: 1 },
    { label: "Fav",   value: 2 },
    { label: "L1",    value: 3 },
    { label: "L2",    value: 4 },
    { label: "L3",    value: 5 },
  ],
  maxdown: [
    { label: "Auto",  value: 0 },
    { label: "Sleep", value: 1 },
    { label: "Fav",   value: 2 },
    { label: "L1",    value: 3 },
    { label: "L2",    value: 4 },
    { label: "L3",    value: 5 },
  ],
  cat: [
    { label: "Auto",  value: 0 },
    { label: "Sleep", value: 1 },
    { label: "Fav",   value: 2 },
  ],
};

function fmt(v: number | undefined, decimals = 0): string {
  if (v === undefined || v === null) return "—";
  return v.toFixed(decimals);
}

export default function DeviceCard({ device, onRefresh }: DeviceCardProps) {
  const { id, name, online, values, did, host } = device;
  const pm25 = values.pm25;
  const color = pm25Color(pm25);

  const specs = DEVICE_PROP_SPECS[id];
  const modes = DEVICE_MODES[id] ?? [];

  // Optimistic local state for mode, fan, buzz, lock, power
  const [localMode, setLocalMode] = useState<number | undefined>(undefined);
  const [localFan, setLocalFan]   = useState<number | undefined>(undefined);
  const [localBuzz, setLocalBuzz] = useState<boolean | undefined>(undefined);
  const [localLock, setLocalLock] = useState<boolean | undefined>(undefined);
  const [localPower, setLocalPower] = useState<boolean | undefined>(undefined);
  const [sending, setSending] = useState(false);

  const effectiveMode  = localMode  ?? values.mode;
  const effectiveFan   = localFan   ?? values.fan;
  const effectiveBuzz  = localBuzz  ?? values.buzz;
  const effectiveLock  = localLock  ?? values.lock;
  const effectivePower = localPower ?? values.power;

  async function control(propKey: string, value: boolean | number) {
    if (!specs) return;
    const spec = specs.props[propKey];
    if (!spec) return;
    setSending(true);
    try {
      await sendControl({ did, host, siid: spec.siid, piid: spec.piid, value });
      onRefresh?.();
    } catch (e) {
      console.error("Control error:", e);
    } finally {
      setSending(false);
    }
  }

  async function handlePowerToggle() {
    const newVal = !(effectivePower ?? false);
    setLocalPower(newVal);
    await control("power", newVal);
  }

  async function handleMode(value: number) {
    setLocalMode(value);
    await control("mode", value);
  }

  async function handleFan(value: number) {
    setLocalFan(value);
    await control("fan", value);
  }

  async function handleBuzz() {
    const newVal = !(effectiveBuzz ?? false);
    setLocalBuzz(newVal);
    await control("buzz", newVal);
  }

  async function handleLock() {
    const newVal = !(effectiveLock ?? false);
    setLocalLock(newVal);
    await control("lock", newVal);
  }

  // Show fan slider only for 4lite when mode is Favorite (2)
  const showFanSlider = id === "4lite" && effectiveMode === 2;

  // PM2.5 progress bar — max at 150 µg/m³
  const pm25Pct = Math.min(100, ((pm25 ?? 0) / 150) * 100);

  return (
    <div
      className={`
        relative rounded-2xl border p-5 flex flex-col gap-3 transition-all
        bg-gray-900 shadow-lg
        ${online ? "border-gray-700 hover:border-gray-500" : "border-gray-800 opacity-60"}
      `}
    >
      {/* Header: name + power dot + power button */}
      <div className="flex items-start justify-between gap-2">
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
        <div className="flex items-center gap-2 shrink-0">
          {/* Power status dot */}
          {effectivePower !== undefined && (
            <div
              className={`w-2.5 h-2.5 rounded-full mt-0.5 ${
                effectivePower
                  ? "bg-green-400 shadow-[0_0_6px_#4ade80]"
                  : "bg-gray-600"
              }`}
            />
          )}
          {/* Power toggle button */}
          {specs?.props.power && (
            <button
              disabled={sending || !online}
              onClick={handlePowerToggle}
              title="Toggle power"
              className={`
                p-1.5 rounded-lg transition-colors
                ${effectivePower
                  ? "bg-green-800 hover:bg-green-700 text-green-300"
                  : "bg-gray-800 hover:bg-gray-700 text-gray-400"}
                disabled:opacity-40 disabled:cursor-not-allowed
              `}
            >
              <Power size={14} />
            </button>
          )}
        </div>
      </div>

      {/* PM2.5 big number + label */}
      <div className="flex items-end gap-3">
        <div>
          <div
            className="text-5xl font-bold tabular-nums leading-none"
            style={{ color }}
          >
            {fmt(pm25)}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">PM2.5 µg/m³</div>
        </div>
        <div className="mb-1 text-sm font-medium" style={{ color }}>
          {pm25Label(pm25)}
        </div>
      </div>

      {/* PM2.5 color progress bar */}
      <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pm25Pct}%`, backgroundColor: color }}
        />
      </div>

      {/* Metrics row: Temp, Humidity, Filter, AQI */}
      <div className="grid grid-cols-4 gap-1.5">
        <SmallMetric
          icon={<Thermometer size={12} className="text-orange-400" />}
          label="Temp"
          value={values.temp !== undefined ? `${fmt(values.temp, 1)}°` : "—"}
        />
        <SmallMetric
          icon={<Droplets size={12} className="text-blue-400" />}
          label="Hum"
          value={values.hum !== undefined ? `${fmt(values.hum)}%` : "—"}
        />
        <SmallMetric
          icon={<Filter size={12} className="text-purple-400" />}
          label="Filter"
          value={values.filter !== undefined ? `${fmt(values.filter)}%` : "—"}
        />
        {values.aqi !== undefined ? (
          <SmallMetric
            icon={<span className="text-[10px] text-yellow-400">AQI</span>}
            label="AQI"
            value={fmt(values.aqi)}
          />
        ) : (
          <div /> /* empty placeholder to keep grid aligned */
        )}
      </div>

      {/* Mode selector */}
      {modes.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Mode</div>
          <div className="flex flex-wrap gap-1">
            {modes.map((m) => (
              <button
                key={m.value}
                disabled={sending || !online}
                onClick={() => handleMode(m.value)}
                className={`
                  px-2 py-0.5 rounded-md text-xs font-medium transition-colors
                  ${effectiveMode === m.value
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"}
                  disabled:opacity-40 disabled:cursor-not-allowed
                `}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fan slider — 4lite only, when mode=Favorite */}
      {showFanSlider && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wide text-gray-500">Fan Level</span>
            <span className="text-xs font-semibold text-white">{effectiveFan ?? "—"}</span>
          </div>
          <input
            type="range"
            min={1}
            max={14}
            value={effectiveFan ?? 1}
            disabled={sending || !online}
            onChange={(e) => setLocalFan(Number(e.target.value))}
            onMouseUp={(e) => handleFan(Number((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => handleFan(Number((e.target as HTMLInputElement).value))}
            className="w-full accent-blue-500 disabled:opacity-40"
          />
        </div>
      )}

      {/* Bottom row: Buzz + Lock toggles */}
      <div className="flex gap-2 pt-1 border-t border-gray-800">
        {specs?.props.buzz && (
          <ToggleChip
            icon={<Volume2 size={11} />}
            label="Buzz"
            active={effectiveBuzz ?? false}
            disabled={sending || !online}
            onClick={handleBuzz}
          />
        )}
        {specs?.props.lock && (
          <ToggleChip
            icon={<Lock size={11} />}
            label="Lock"
            active={effectiveLock ?? false}
            disabled={sending || !online}
            onClick={handleLock}
          />
        )}
      </div>
    </div>
  );
}

function SmallMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 bg-gray-800 rounded-lg p-1.5">
      <div className="flex items-center gap-0.5 text-gray-400">
        {icon}
        <span className="text-[9px] uppercase tracking-wide">{label}</span>
      </div>
      <span className="text-xs font-semibold text-white">{value}</span>
    </div>
  );
}

function ToggleChip({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`
        flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors
        ${active
          ? "bg-amber-800 text-amber-300 hover:bg-amber-700"
          : "bg-gray-800 text-gray-500 hover:bg-gray-700"}
        disabled:opacity-40 disabled:cursor-not-allowed
      `}
    >
      {icon}
      {label}
    </button>
  );
}
