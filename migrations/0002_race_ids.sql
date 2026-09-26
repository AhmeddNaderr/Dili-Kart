-- Each race carries a client-made id, so a retried submission is never counted twice.
ALTER TABLE races ADD COLUMN rid TEXT;
CREATE UNIQUE INDEX races_rid ON races (rid);
