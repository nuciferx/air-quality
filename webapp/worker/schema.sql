CREATE TABLE IF NOT EXISTS readings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,          -- unix timestamp (seconds)
  device_id   TEXT    NOT NULL,
  device_name TEXT    NOT NULL,
  pm25        REAL,
  pm10        REAL,
  aqi         REAL,
  temperature REAL,
  humidity    REAL,
  power       INTEGER,                   -- 1=on, 0=off
  mode        INTEGER,                   -- 0=Auto 1=Sleep 2=Favorite (ตามรุ่น)
  filter_pct  REAL                       -- % ไส้กรองที่เหลือ
);

-- ตาราง production ถูกเพิ่ม mode/filter_pct ไว้ก่อนหน้าแล้ว ถ้า DB ไหนยังไม่มี:
--   ALTER TABLE readings ADD COLUMN mode INTEGER;
--   ALTER TABLE readings ADD COLUMN filter_pct REAL;

CREATE INDEX IF NOT EXISTS idx_readings_ts        ON readings(ts DESC);
CREATE INDEX IF NOT EXISTS idx_readings_device_ts ON readings(device_id, ts DESC);
