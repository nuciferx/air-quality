"use client";

import { useEffect, useState, useCallback } from "react";
import { Device, fetchAllDevices, fetchDevice } from "@/lib/api";
import ControlPanel from "@/components/ControlPanel";
import { RefreshCw, Loader2 } from "lucide-react";

export default function ControlPage() {
  const [devices, setDevices]     = useState<Device[]>([]);
  const [activeId, setActiveId]   = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const data = await fetchAllDevices();
      setDevices(data);
      if (!activeId && data.length > 0) setActiveId(data[0].id);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => {
    loadAll();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshActive() {
    if (!activeId) return;
    setRefreshing(true);
    try {
      const updated = await fetchDevice(activeId);
      setDevices((prev) => prev.map((d) => (d.id === activeId ? updated : d)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const activeDevice = devices.find((d) => d.id === activeId);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Control Panel</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage your air purifiers</p>
        </div>
        <button
          onClick={refreshActive}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-900/40 border border-red-800 text-red-300 p-4 text-sm">
          {error}
        </div>
      )}

      {/* Device tabs */}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading devices...
        </div>
      ) : (
        <>
          <div className="flex gap-2 border-b border-gray-800 pb-0 overflow-x-auto">
            {devices.map((d) => (
              <button
                key={d.id}
                onClick={() => setActiveId(d.id)}
                className={`
                  px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 whitespace-nowrap transition-colors
                  ${activeId === d.id
                    ? "text-blue-400 border-blue-500 bg-blue-950/30"
                    : "text-gray-400 border-transparent hover:text-gray-200 hover:bg-gray-800"
                  }
                `}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full mr-2 ${
                    d.online ? "bg-green-400" : "bg-gray-600"
                  }`}
                />
                {d.name}
              </button>
            ))}
          </div>

          {activeDevice ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-lg font-semibold text-white">{activeDevice.name}</h2>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      activeDevice.online
                        ? "bg-green-900 text-green-400"
                        : "bg-gray-800 text-gray-500"
                    }`}
                  >
                    {activeDevice.online ? "Online" : "Offline"}
                  </span>
                </div>
                {activeDevice.values.pm25 !== undefined && (
                  <div className="text-right">
                    <div className="text-2xl font-bold text-white tabular-nums">
                      {activeDevice.values.pm25}
                    </div>
                    <div className="text-xs text-gray-400">PM2.5 µg/m³</div>
                  </div>
                )}
              </div>

              <ControlPanel device={activeDevice} onRefresh={refreshActive} />
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Select a device to control</p>
          )}
        </>
      )}
    </div>
  );
}
