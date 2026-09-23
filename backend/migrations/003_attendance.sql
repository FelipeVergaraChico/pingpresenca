-- E2: one logical session per lesson; openings remain separate for E3 reopening.
ALTER TABLE installation ADD COLUMN attendance_minutes integer NOT NULL DEFAULT 10 CHECK (attendance_minutes BETWEEN 1 AND 1440);
ALTER TABLE installation ADD COLUMN attendance_settings_version integer NOT NULL DEFAULT 1;
CREATE TABLE attendance_sessions (
  id uuid PRIMARY KEY,
  lesson_id uuid NOT NULL UNIQUE REFERENCES lessons(id),
  first_closed_at timestamptz
);
CREATE TABLE attendance_openings (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES attendance_sessions(id),
  opened_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  snapshot jsonb NOT NULL,
  challenge_seed text NOT NULL,
  CHECK (expires_at > opened_at)
);
CREATE UNIQUE INDEX one_live_opening ON attendance_openings(session_id) WHERE closed_at IS NULL;
CREATE INDEX attendance_due ON attendance_openings(expires_at) WHERE closed_at IS NULL;
CREATE TABLE attendance_authorizations (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  opening_id uuid NOT NULL REFERENCES attendance_openings(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX attendance_authorization_account ON attendance_authorizations(account_id, opening_id);
CREATE TABLE attendance_attempts (
  id uuid PRIMARY KEY,
  authorization_id uuid NOT NULL UNIQUE REFERENCES attendance_authorizations(id),
  outcome text NOT NULL CHECK (outcome IN ('ACCEPTED','PENDING','REJECTED')),
  reason text NOT NULL,
  distance double precision CHECK (distance >= 0 AND distance < 'Infinity'::float8),
  accuracy double precision CHECK (accuracy >= 0 AND accuracy < 'Infinity'::float8),
  recorded_at timestamptz NOT NULL,
  resolution text CHECK (resolution IN ('SUPERSEDED','APPROVED','REJECTED')),
  resolved_at timestamptz,
  CHECK ((resolution IS NULL) = (resolved_at IS NULL))
);
CREATE TABLE attendance_records (
  lesson_id uuid NOT NULL REFERENCES lessons(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  status text NOT NULL CHECK (status IN ('PRESENT','ABSENT','PENDING')),
  source text NOT NULL CHECK (source IN ('AUTOMATIC','AUTO_CLOSE','MANUAL','PENDING_DECISION','CORRECTION')),
  manual boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (lesson_id, account_id)
);
-- Persistent, per-account/per-opening budget. No shared-IP identity assumption.
CREATE TABLE attendance_code_limits (
  opening_id uuid NOT NULL REFERENCES attendance_openings(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  bucket bigint NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (opening_id, account_id)
);
