CREATE TABLE IF NOT EXISTS devices (
  device_key TEXT PRIMARY KEY,
  device_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
