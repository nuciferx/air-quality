"use client";

import { useEffect, useState } from "react";
import { HistoryRow, fetchHistory } from "@/lib/api";
import PMChart from "@/components/PMChart";
import { RefreshCw, Loader2, Clock } from "lucide-react";

const HOUR_OPTIONS = [6, 12, 24, 48, 72];

function fmt(v: number | null, dec = 1): string {
  if (v === null || v === undefined) return "—";
  return v.toFixed(dec);
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function HistoryPage() {
  const [rows, setRows]       = useState<HistoryRow[]>([]);
  const [hours, setHours]     = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  async function load(h: number) {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory(h);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(hours);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function changeHours(h: number) {
    setHours(h);
    load(h);
  }

  // Last 20 rows reversed for the table (most recent first)
  const tableRows = [...rows].reverse().slice(0, 50);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">History</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            PM2.5 readings from Google Sheets — {rows.length} data points
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Time range buttons */}
          <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
            {HOUR_OPTIONS.map((h) => (
              <button
                key={h}
                onClick={() => changeHours(h)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  hours === h
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {h}h
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

      {/* Chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-4">PM2.5 Over Time</h2>
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={24} className="animate-spin text-blue-400" />
          </div>
        ) : (
          <PMChart rows={rows} />
        )}
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center gap-2">
          <Clock size={16} className="text-gray-400" />
          <h2 className="text-base font-semibold text-white">Recent Readings</h2>
          <span className="text-xs text-gray-500 ml-auto">Showing last {tableRows.length} of {rows.length}</span>
        </div>

        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 size={24} className="animate-spin text-blue-400" />
          </div>
        ) : tableRows.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No data for this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Time</th>
                  <th className="px-4 py-3 text-left">Device</th>
                  <th className="px-4 py-3 text-right">PM2.5</th>
                  <th className="px-4 py-3 text-right">AQI</th>
                  <th className="px-4 py-3 text-right">Temp</th>
                  <th className="px-4 py-3 text-right">Humidity</th>
                  <th className="px-4 py-3 text-right">PM10</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {tableRows.map((row, i) => {
                  const pm25 = row.pm25;
                  const pmColor =
                    pm25 === null   ? "text-gray-400"
                    : pm25 <= 15   ? "text-green-400"
                    : pm25 <= 35   ? "text-yellow-400"
                    : pm25 <= 75   ? "text-orange-400"
                    :                "text-red-400";

                  return (
                    <tr key={i} className="hover:bg-gray-800/40 transition-colors">
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                        {fmtTime(row.timestamp)}
                      </td>
                      <td className="px-4 py-3 font-medium text-white">{row.device}</td>
                      <td className={`px-4 py-3 text-right font-bold ${pmColor}`}>
                        {fmt(pm25)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">{fmt(row.aqi, 0)}</td>
                      <td className="px-4 py-3 text-right text-gray-300">{fmt(row.temperature)}°C</td>
                      <td className="px-4 py-3 text-right text-gray-300">{fmt(row.humidity, 0)}%</td>
                      <td className="px-4 py-3 text-right text-gray-300">{fmt(row.pm10)}</td>
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
