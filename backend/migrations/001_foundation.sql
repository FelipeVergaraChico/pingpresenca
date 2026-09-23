CREATE TABLE installation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  name text NOT NULL,
  time_zone text NOT NULL,
  bootstrap_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Stable identifiers and credentials are separate from personal attributes.
CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE account_profiles (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE RESTRICT,
  name text NOT NULL,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  email_verified_at timestamptz
);
CREATE TABLE account_roles (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'PROFESSOR', 'STUDENT')),
  PRIMARY KEY (account_id, role)
);
CREATE UNIQUE INDEX one_owner_per_installation ON account_roles (role) WHERE role = 'OWNER';

CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX auth_sessions_account ON auth_sessions(account_id);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  actor_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL CHECK (actor_kind IN ('USER', 'SYSTEM', 'INFRASTRUCTURE')),
  actor_role text,
  action text NOT NULL,
  target_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_target_time ON audit_events(target_id, occurred_at);

-- The application adds corrections as events. A later retention policy requires
-- a deliberate privileged migration/procedure, never a generic API delete.
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
