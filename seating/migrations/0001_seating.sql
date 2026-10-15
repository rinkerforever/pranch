CREATE TABLE IF NOT EXISTS seating_state (
  location_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS seating_grants (
  user_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('host','manager','viewer')),
  PRIMARY KEY(user_id, location_id)
);
CREATE TABLE IF NOT EXISTS seating_hubs (
  location_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL DEFAULT 0,
  synced_version INTEGER NOT NULL DEFAULT -1,
  local_url TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS seating_commands (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  expected_version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  response_json TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS seating_commands_location ON seating_commands(location_id,status,created_at);
