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
