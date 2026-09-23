-- Additive E1 migration: existing owner, sessions and audit are preserved.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE installation ADD COLUMN institutional_id_required boolean NOT NULL DEFAULT false;
ALTER TABLE installation ADD COLUMN settings_version integer NOT NULL DEFAULT 1;
ALTER TABLE accounts ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE accounts ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE account_profiles ADD COLUMN institutional_id text UNIQUE;

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  token_hash text NOT NULL UNIQUE,
  channel text NOT NULL CHECK (channel IN ('MANUAL', 'EMAIL')),
  delivered_email text,
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK (channel <> 'EMAIL' OR delivered_email IS NOT NULL)
);
CREATE INDEX invitations_account ON invitations(account_id);

CREATE TABLE disciplines (
  id uuid PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1
);
CREATE TABLE locations (
  id uuid PRIMARY KEY, name text NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius double precision NOT NULL CHECK (radius > 0 AND radius < 'Infinity'::float8),
  geo_required boolean NOT NULL,
  precision_rule text NOT NULL DEFAULT 'CONSERVATIVE_V1' CHECK (precision_rule = 'CONSERVATIVE_V1'),
  version integer NOT NULL DEFAULT 1
);
CREATE TABLE offerings (
  id uuid PRIMARY KEY, discipline_id uuid NOT NULL REFERENCES disciplines(id),
  name text NOT NULL, term text NOT NULL, shift text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  attendance_mode text NOT NULL CHECK (attendance_mode IN ('PILOT', 'OFFICIAL')),
  version integer NOT NULL DEFAULT 1
);
CREATE TABLE offering_teachers (
  offering_id uuid NOT NULL REFERENCES offerings(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  PRIMARY KEY (offering_id, account_id)
);
CREATE TABLE enrollments (
  id uuid PRIMARY KEY, offering_id uuid NOT NULL REFERENCES offerings(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  enrolled_at timestamptz NOT NULL, ended_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  CHECK (ended_at IS NULL OR ended_at > enrolled_at),
  EXCLUDE USING gist (offering_id WITH =, account_id WITH =,
    tstzrange(enrolled_at, ended_at, '[)') WITH &&)
);
CREATE TABLE lessons (
  id uuid PRIMARY KEY, offering_id uuid NOT NULL REFERENCES offerings(id),
  location_id uuid NOT NULL REFERENCES locations(id), title text NOT NULL,
  description text NOT NULL DEFAULT '', starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  attendance_mode text NOT NULL CHECK (attendance_mode IN ('PILOT', 'OFFICIAL')),
  -- Foundations only; E1 never starts an attendance process.
  context_locked_at timestamptz, mode_locked_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  CHECK (ends_at > starts_at)
);
CREATE INDEX lessons_offering_start ON lessons(offering_id, starts_at);
CREATE INDEX enrollments_account ON enrollments(account_id);
