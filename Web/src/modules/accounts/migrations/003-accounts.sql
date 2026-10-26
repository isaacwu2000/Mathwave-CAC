CREATE TABLE IF NOT EXISTS mathwave_guests (
  owner_id text PRIMARY KEY,
  claimed_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mathwave_quota (
  owner_id text NOT NULL,
  period text NOT NULL,
  allowance_ms bigint NOT NULL CHECK (allowance_ms >= 0),
  used_ms bigint NOT NULL DEFAULT 0 CHECK (used_ms >= 0),
  reserved_ms bigint NOT NULL DEFAULT 0 CHECK (reserved_ms >= 0),
  PRIMARY KEY (owner_id, period)
);
CREATE TABLE IF NOT EXISTS mathwave_ai_usage (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  period text NOT NULL,
  ip_owner text,
  ip_period text,
  kind text NOT NULL,
  reserved_ms bigint NOT NULL,
  used_ms bigint,
  provider_usage jsonb,
  reported_ms bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
ALTER TABLE mathwave_ai_usage ADD COLUMN IF NOT EXISTS reported_ms bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS mathwave_ai_usage_owner ON mathwave_ai_usage(owner_id, period);
CREATE TABLE IF NOT EXISTS mathwave_deleted_accounts (
  owner_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE mathwave_deleted_accounts ADD COLUMN IF NOT EXISTS completed_at timestamptz;
CREATE TABLE IF NOT EXISTS mathwave_voice_sessions (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
