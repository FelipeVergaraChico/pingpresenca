-- An EMAIL invitation is unusable until the server has acknowledged SMTP submission.
ALTER TABLE invitations ADD COLUMN delivered_at timestamptz;
ALTER TABLE invitations ADD CONSTRAINT invitations_delivery_channel
  CHECK (delivered_at IS NULL OR channel = 'EMAIL');
