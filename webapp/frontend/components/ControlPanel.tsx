"use client";

import { useState } from "react";
import { Device, sendControl, DEVICE_PROP_SPECS } from "@/lib/api";
import { Power, Wind, Moon, Star, Zap, Volume2, VolumeX, Loader2 } from "lucide-react";

interface ControlPanelProps {
  device: Device;
  onRefresh: () => void;
}

// Xiaomi mode values (model-dependent; these match the common Air Purifier spec)
const MODES = [
  { label: "Auto",     value: 0, icon: <Wind size={16} /> },
  { label: "Sleep",    value: 1, icon: <Moon size={16} /> },
  { label: "Favorite", value: 2, icon: <Star size={16} /> },
  { label: "Fan",      value: 3, icon: <Zap size={16} /> },
];

type Loading = "power" | "mode" | "fan" | "buzz" | null;

export default function ControlPanel({ device, onRefresh }: ControlPanelProps) {
  const [loading, setLoading] = useState<Loading>(null);
  const [error, setError]     = useState<string | null>(null);

  const spec = DEVICE_PROP_SPECS[device.id];
  if (!spec) return <p className="text-gray-400">Unknown device</p>;

  const { did, host, props } = spec;
  const { values }           = device;

  async function ctrl(key: Loading, piid: number, siid: number, value: unknown) {
    setLoading(key);
    setError(null);
    try {
      await sendControl({ did, host, siid, piid, value: value as boolean | number | string });
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }

  const isPowered   = !!values.power;
  const currentMode = values.mode ?? -1;
  const fanSpeed    = values.fan ?? 1;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-900/50 border border-red-700 text-red-300 text-sm p-3">
          {error}
        </div>
      )}

      {/* Power toggle */}
      <div className="flex items-center justify-between bg-gray-800 rounded-xl p-4">
        <span className="font-medium text-white flex items-center gap-2">
          <Power size={18} className={isPowered ? "text-green-400" : "text-gray-500"} />
          Power
        </span>
        <button
          onClick={() => ctrl("power", props.power.piid, props.power.siid, !isPowered)}
          disabled={loading !== null}
          className={`
            relative inline-flex h-7 w-14 items-center rounded-full transition-colors
            ${isPowered ? "bg-green-500" : "bg-gray-600"}
            ${loading === "power" ? "opacity-50 cursor-wait" : "cursor-pointer"}
          `}
          aria-label="Toggle power"
        >
          {loading === "power" ? (
            <Loader2 size={14} className="animate-spin mx-auto text-white" />
          ) : (
            <span
              className={`
                inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform
                ${isPowered ? "translate-x-8" : "translate-x-1"}
              `}
            />
          )}
        </button>
      </div>

      {/* Mode buttons */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-2 uppercase tracking-wide">Mode</h3>
        <div className="grid grid-cols-4 gap-2">
          {MODES.map((m) => {
            const active = currentMode === m.value;
            return (
              <button
                key={m.value}
                onClick={() => ctrl("mode", props.mode.piid, props.mode.siid, m.value)}
                disabled={loading !== null || !isPowered}
                className={`
                  flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl text-xs font-medium
                  transition-all border
                  ${active
                    ? "bg-blue-600 border-blue-500 text-white shadow-[0_0_12px_rgba(59,130,246,0.4)]"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:border-gray-600"
                  }
                  ${(!isPowered || loading !== null) ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
                `}
              >
                {loading === "mode" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  m.icon
                )}
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Fan speed slider */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide">
            Fan Speed
          </h3>
          <span className="text-sm font-bold text-white tabular-nums">{fanSpeed}</span>
        </div>
        <div className="flex items-center gap-3">
          <Wind size={16} className="text-gray-500 shrink-0" />
          <input
            type="range"
            min={1}
            max={14}
            value={fanSpeed}
            disabled={loading !== null || !isPowered || currentMode !== 2}
            onChange={(e) =>
              ctrl("fan", props.fan.piid, props.fan.siid, parseInt(e.target.value, 10))
            }
            className={`
              w-full accent-blue-500 h-2 rounded-full appearance-none cursor-pointer
              ${(!isPowered || currentMode !== 2) ? "opacity-30 cursor-not-allowed" : ""}
            `}
          />
          <Wind size={20} className="text-blue-400 shrink-0" />
        </div>
        {currentMode !== 2 && isPowered && (
          <p className="text-xs text-gray-500 mt-1">Switch to Favorite mode to adjust fan speed</p>
        )}
      </div>

      {/* Buzzer toggle */}
      <div className="flex items-center justify-between bg-gray-800 rounded-xl p-4">
        <span className="font-medium text-white flex items-center gap-2">
          {values.buzz ? (
            <Volume2 size={18} className="text-yellow-400" />
          ) : (
            <VolumeX size={18} className="text-gray-500" />
          )}
          Buzzer
        </span>
        <button
          onClick={() => ctrl("buzz", props.buzz.piid, props.buzz.siid, !values.buzz)}
          disabled={loading !== null}
          className={`
            relative inline-flex h-7 w-14 items-center rounded-full transition-colors
            ${values.buzz ? "bg-yellow-500" : "bg-gray-600"}
            ${loading === "buzz" ? "opacity-50 cursor-wait" : "cursor-pointer"}
          `}
          aria-label="Toggle buzzer"
        >
          {loading === "buzz" ? (
            <Loader2 size={14} className="animate-spin mx-auto text-white" />
          ) : (
            <span
              className={`
                inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform
                ${values.buzz ? "translate-x-8" : "translate-x-1"}
              `}
            />
          )}
        </button>
      </div>
    </div>
  );
}
