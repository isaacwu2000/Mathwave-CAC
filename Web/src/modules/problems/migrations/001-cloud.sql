CREATE TABLE IF NOT EXISTS math_audio_notebooks (
  owner_id text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0,
  notebook jsonb NOT NULL,
  clarification jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS math_audio_requests (
  owner_id text NOT NULL REFERENCES math_audio_notebooks(owner_id),
  request_id text NOT NULL,
  request text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, request_id)
);
