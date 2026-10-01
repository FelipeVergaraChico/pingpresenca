-- Empty in regular installations. Only the offline demo preparation creates a marker.
CREATE TABLE demo_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  generation uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  profiles jsonb NOT NULL,
  writes integer NOT NULL DEFAULT 0 CHECK (writes >= 0),
  sessions integer NOT NULL DEFAULT 0 CHECK (sessions >= 0)
);
