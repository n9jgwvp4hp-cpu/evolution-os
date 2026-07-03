-- Evolution OS — mission execution leases (cross-process atomic claiming).
--
-- Adds a lease to each mission so more than one worker process can run missions
-- safely. A worker claims a mission with a single atomic UPDATE ... WHERE ...
-- RETURNING (Postgres row-locking guarantees exactly one winner), stamps its
-- worker_id and a lease_expires deadline, and refreshes the lease each turn. If
-- a worker dies, its mission's lease lapses and any worker may reclaim it — so
-- work is never stranded on a crashed instance.
--
-- Applied idempotently at runtime by lib/server/missionStore.ts.

ALTER TABLE missions ADD COLUMN IF NOT EXISTS worker_id    TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS lease_expires BIGINT;

-- Speeds the reclaim scan for running missions whose lease has lapsed.
CREATE INDEX IF NOT EXISTS idx_missions_lease ON missions (status, lease_expires);
