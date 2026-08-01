"use client";

import { useState } from "react";
import { Vacuum, sendVacuumAction } from "@/lib/api";
import { BatteryMedium, Clock, Grid2x2, PlayCircle, StopCircle, Home } from "lucide-react";

interface VacuumCardProps {
  vacuum: Vacuum;
  onRefresh?: () => void;
}

// S2.P2 (xiaomi.vacuum.ov71gl / ijai) — ชุดเดียวกับ telegram-bot + .claude/skills/vacuum-status
// ยืนยันจากของจริง: status=9 + battery=100 + charging=1 → "ชาร์จเต็ม"
// (ชุดเดิมที่นี่เป็น mapping ของ roborock ทำให้ 9 กลายเป็น "spot clean" ผิดมาตลอด)
function vacuumStatusLabel(status: number | undefined): string {
  if (status === undefined || status === null) return "—";
  switch (status) {
    case 1:  return "ว่าง";
    case 2:  return "กำลังชาร์จ";
    case 3:  return "พักชาร์จ";
    case 4:  return "กำลังกวาด";
    case 5:  return "หยุดชั่วคราว";
    case 6:  return "กำลังกลับแท่น";
    case 7:  return "กำลังล้างม็อบ";
    case 9:  return "ชาร์จเต็ม";
    case 10: return "กำลังสร้างแผนที่";
    case 14: return "แท่นทำงาน";
    case 15: return "⚠️ Error";
    case 16: return "กวาด + ถู";
    case 17: return "กำลังถู";
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

/** ประวัติทำความสะอาดจาก prop plaintext (S10/P3 + S10/P15) — ไม่ต้องถอดรหัสไฟล์แผนที่ */
function CleanHistory({ clean, cloud }: { clean?: string; cloud?: string }) {
  const parse = <T,>(raw?: string): T | null => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

  const rec = parse<{ total_time?: number; total_area?: number; total_count?: number }>(clean);
  const last = parse<{ label?: string; stime?: number }>(cloud);
  if (!rec?.total_count && !last?.stime) return null;

  const hours = rec?.total_time !== undefined ? Math.round(rec.total_time / 60) : null;
  const sqm = rec?.total_area !== undefined ? Math.round(rec.total_area / 1000) : null;
  const lastArea = Number(last?.label?.split("_")[1]);
  const lastWhen = last?.stime
    ? new Date(last.stime * 1000).toLocaleString("th-TH", {
        timeZone: "Asia/Bangkok",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="pt-1 border-t border-gray-800 text-[11px] text-gray-400 flex flex-col gap-0.5">
      {rec?.total_count !== undefined && (
        <div>
          สะสม <span className="text-white font-semibold">{rec.total_count}</span> รอบ
          {hours !== null && <> · {hours.toLocaleString("th-TH")} ชม.</>}
          {sqm !== null && <> · {sqm.toLocaleString("th-TH")} m²</>}
        </div>
      )}
      {lastWhen && (
        <div>
          รอบล่าสุด {lastWhen}
          {Number.isFinite(lastArea) && <> · {(lastArea / 1000).toFixed(1)} m²</>}
        </div>
      )}
    </div>
  );
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
            {values.clean_area !== undefined ? `${fmt(values.clean_area / 100, 1)} m²` : "—"}
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

      {/* ความคืบหน้ารอบปัจจุบัน — โชว์เฉพาะตอนกำลังกวาด/ถู */}
      {values.progress !== undefined && [4, 16, 17].includes(values.status ?? -1) && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wide text-gray-500">ความคืบหน้า</span>
            <span className="text-xs font-semibold text-white">{values.progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-cyan-400 transition-all duration-500"
              style={{ width: `${Math.min(100, values.progress)}%` }}
            />
          </div>
        </div>
      )}

      {/* ประวัติสะสม — จาก clean_record (plaintext ไม่ต้องถอดรหัสแผนที่) */}
      <CleanHistory clean={values.clean_record} cloud={values.cloud_record} />

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
