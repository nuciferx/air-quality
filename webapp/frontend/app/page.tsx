"use client";

import { useEffect, useState, useCallback } from "react";
import { Device, fetchAllDevices, subscribeToStream } from "@/lib/api";
import DeviceCard from "@/components/DeviceCard";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";

export default function DashboardPage() {
  const [devices, setDevices]     = useState<Device[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [sseOk, setSseOk]         = useState(true);

  const loadDevices = useCallback(async () => {
    try {
      const data = await fetchAllDevices();
      setDevices(data);
      setLastUpdate(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDevices();

    const cleanup = subscribeToStream(
      (incoming) => {
        setDevices(incoming);
        setLastUpdate(new Date());
        setSseOk(true);
        setError(null);
      },
      () => setSseOk(false)
    );

    return cleanup;
  }, [loadDevices]);

  const onlineCount = devices.filter((d) => d.online).length;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Air Quality Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {loading ? "Loading..." : `${onlineCount} / ${devices.length} devices online`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* SSE status */}
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            {sseOk ? (
              <Wifi size={14} className="text-green-400" />
            ) : (
              <WifiOff size={14} className="text-red-400" />
            )}
            {sseOk ? "Live" : "Reconnecting..."}
          </div>
          {lastUpdate && (
            <span className="text-xs text-gray-500">
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => { setLoading(true); loadDevices(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-900/40 border border-red-800 text-red-300 p-4 text-sm">
          {error}
        </div>
      )}

      {/* Device grid */}
      {loading && devices.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl border border-gray-800 bg-gray-900 p-5 h-48 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {devices.map((device) => (
            <DeviceCard key={device.id} device={device} />
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 pt-2 border-t border-gray-800">
        <span className="font-medium text-gray-400">PM2.5 Legend:</span>
        {[
          { color: "#22c55e", label: "Good (0–15 µg/m³)" },
          { color: "#eab308", label: "Fair (16–35 µg/m³)" },
          { color: "#f97316", label: "Moderate (36–75 µg/m³)" },
          { color: "#ef4444", label: "Poor (>75 µg/m³)" },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
