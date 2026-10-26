CREATE TABLE IF NOT EXISTS math_audio_voice_negotiations (
  owner_id text PRIMARY KEY,
  lease_id text NOT NULL,
  expires_at timestamptz NOT NULL
);
