-- E3: preserve history when cancelling, plus purpose-specific recovery links.
ALTER TABLE lessons ADD COLUMN cancelled_at timestamptz;
ALTER TABLE lessons ADD COLUMN cancellation_reason text;
ALTER TABLE lessons ADD CONSTRAINT cancellation_context CHECK ((cancelled_at IS NULL) = (cancellation_reason IS NULL));

CREATE TABLE password_recoveries (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  token_hash text NOT NULL UNIQUE,
  initiated_by uuid REFERENCES accounts(id),
  authority text NOT NULL CHECK (authority IN ('ADMINISTRATIVE','OWNER','INFRASTRUCTURE')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX recovery_account ON password_recoveries(account_id);
