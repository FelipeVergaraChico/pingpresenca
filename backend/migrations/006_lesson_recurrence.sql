CREATE TABLE lesson_generations (
  id uuid PRIMARY KEY,
  offering_id uuid NOT NULL REFERENCES offerings(id),
  request_hash text NOT NULL,
  rule jsonb NOT NULL,
  time_zone text NOT NULL,
  result jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(offering_id, request_hash)
);
-- Original occurrence identity survives rescheduling, cancellation and future deletion.
CREATE TABLE generated_occurrences (
  offering_id uuid NOT NULL REFERENCES offerings(id),
  original_start timestamptz NOT NULL,
  generation_id uuid NOT NULL REFERENCES lesson_generations(id),
  lesson_id uuid REFERENCES lessons(id) ON DELETE SET NULL,
  PRIMARY KEY(offering_id, original_start)
);
