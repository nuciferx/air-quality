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
  power       INTEGER                    -- 1=on, 0=off
);

CREATE INDEX IF NOT EXISTS idx_readings_ts        ON readings(ts DESC);
CREATE INDEX IF NOT EXISTS idx_readings_device_ts ON readings(device_id, ts DESC);
