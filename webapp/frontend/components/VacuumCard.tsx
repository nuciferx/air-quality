"use client";

import { useState } from "react";
import { Vacuum, sendVacuumAction } from "@/lib/api";
import { BatteryMedium, Clock, Grid2x2, PlayCircle, StopCircle, Home } from "lucide-react";

interface VacuumCardProps {
  vacuum: Vacuum;
  onRefresh?: () => void;
}

function vacuumStatusLabel(status: number | undefined): string {
  if (status === undefined || status === null) return "—";
  switch (status) {
    case 1:  return "เริ่มต้น";
    case 2:  return "กำลังหยุด/สแตนด์บาย";
    case 3:  return "หยุดชั่วคราว";
    case 4:  return "กำลังกวาด";
    case 5:  return "กำลังกลับแท่น";
    case 6:  return "กำลังกลับแท่น";
    case 7:  return "ชาร์จอยู่";
    case 8:  return "ข้อผิดพลาด";
    case 9:  return "กำลังทำ spot clean";
    case 10: return "ไม่ได้ใช้งาน";
    case 11: return "กำลังลาก";
    case 12: return "กำลังถอดออก";
    case 13: return "กำลังชาร์จ (error)";
    case 14: return "แผนที่ถูกแก้ไข";
    case 15: return "กำลัง update ดัสต์บ็อกซ์";
    case 16: return "pause ไม่ตอบสนอง";
    case 17: return "กำลังถอดออก (error)";
    case 18: return "กำลังกวาด (ห้ามรบกวน)";
    case 22: return "กำลังถูพื้น";
    case 23: return "กำลังถูพื้น + กวาด";
    case 26: return "กำลังทำความสะอาด";
    default: return `สถานะ ${status}`;
  }
}

function chargingLabel(charging: number | undefined): string {
  if (charging === undefined || charging === null) return "—";
  switch (charging) {
    case 1: return "ชาร์จอยู่";
    case 2: return "ไม่ได้ชาร์จ";
    case 3: return "ชาร์จไม่ได้";
    default: return `${charging}`;
  }
}

function fmt(v: number | undefined, decimals = 0): string {
  if (v === undefined || v === null) return "—";
  return v.toFixed(decimals);
}

function fmtMinutes(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  return `${m} นาที`;
}

function LifeBar({ label, pct }: { label: string; pct: number | undefined }) {
  const val = pct ?? 0;
  const color = val > 50 ? "#22c55e" : val > 20 ? "#eab308" : "#ef4444";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-[9px] text-gray-400 uppercase tracking-wide">
        <span>{label}</span>
        <span className="text-white font-semibold">{fmt(pct)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, val)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export default function VacuumCard({ vacuum, onRefresh }: VacuumCardProps) {
  const { name, did, online, values } = vacuum;
  const [sending, setSending] = useState(false);

  async function doAction(action: string) {
    setSending(true);
    try {
      await sendVacuumAction(did, action);
      onRefresh?.();
    } catch (e) {
      console.error("Vacuum action error:", e);
    } finally {
      setSending(false);
    }
  }

  const battery = values.battery;
  const battColor =
    battery === undefined ? "#6b7280"
    : battery > 50 ? "#22c55e"
    : battery > 20 ? "#eab308"
    : "#ef4444";

  return (
    <div
      className={`
        relative rounded-2xl border p-5 flex flex-col gap-3 transition-all
        bg-gray-900 shadow-lg
        ${online ? "border-gray-700 hover:border-gray-500" : "border-gray-800 opacity-60"}
      `}
    >
      {/* Header */}
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
        {/* Battery */}
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          <BatteryMedium size={16} style={{ color: battColor }} />
          <span className="text-sm font-bold" style={{ color: battColor }}>
            {fmt(battery)}%
          </span>
        </div>
      </div>

      {/* Status */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">สถานะ</div>
        <div className="text-sm font-semibold text-white">{vacuumStatusLabel(values.status)}</div>
        <div className="text-xs text-gray-500">{chargingLabel(values.charging)}</div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col items-start gap-0.5 bg-gray-800 rounded-lg p-1.5">
          <div className="flex items-center gap-0.5 text-gray-400">
            <Grid2x2 size={11} className="text-blue-400" />
            <span className="text-[9px] uppercase tracking-wide">พื้นที่</span>
          </div>
          <span className="text-xs font-semibold text-white">
            {values.clean_area !== undefined ? `${fmt(values.clean_area, 1)} m²` : "—"}
          </span>
        </div>
        <div className="flex flex-col items-start gap-0.5 bg-gray-800 rounded-lg p-1.5">
          <div className="flex items-center gap-0.5 text-gray-400">
            <Clock size={11} className="text-purple-400" />
            <span className="text-[9px] uppercase tracking-wide">เวลา</span>
          </div>
          <span className="text-xs font-semibold text-white">{fmtMinutes(values.clean_time)}</span>
        </div>
      </div>

      {/* Life bars */}
      <div className="flex flex-col gap-1.5 pt-1 border-t border-gray-800">
        <LifeBar label="แปรงหลัก" pct={values.main_brush_life} />
        <LifeBar label="แปรงข้าง" pct={values.side_brush_life} />
        <LifeBar label="ไส้กรอง" pct={values.filter_life} />
        <LifeBar label="ผ้าถู" pct={values.mop_life} />
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 pt-1 border-t border-gray-800">
        <button
          disabled={sending || !online}
          onClick={() => doAction("start_sweep")}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-green-900 text-green-300 hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <PlayCircle size={12} />
          เริ่มดูด
        </button>
        <button
          disabled={sending || !online}
          onClick={() => doAction("pause")}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-yellow-900 text-yellow-300 hover:bg-yellow-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <StopCircle size={12} />
          หยุด
        </button>
        <button
          disabled={sending || !online}
          onClick={() => doAction("stop_and_charge")}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-900 text-blue-300 hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Home size={12} />
          กลับแท่น
        </button>
      </div>
    </div>
  );
}
