-- Evolution OS — normalized mission storage.
--
-- Replaces the single `evolution_state` JSONB blob (where every mission step
-- rewrote the ENTIRE brain under one global FOR UPDATE lock) with per-row
-- tables. Mission writes are now row-scoped: an INSERT of one step or api
-- message touches one row and never serializes against unrelated missions.
--
-- This DDL is the source of truth. It is applied idempotently at runtime by
-- lib/server/missionStore.ts (CREATE TABLE IF NOT EXISTS), so it also runs on
-- environments where migrations can't be executed from a developer machine
-- (the managed DB is firewalled to the app). The one-time backfill from the
-- legacy JSONB row is performed there too.

CREATE TABLE IF NOT EXISTS missions (
  id                  TEXT PRIMARY KEY,
  objective           TEXT   NOT NULL,
  status              TEXT   NOT NULL,          -- queued|running|needs_approval|done|failed
  result              TEXT,
  qc_left             INT    NOT NULL DEFAULT 2,
  attempts            INT    NOT NULL DEFAULT 0,
  acknowledged        BOOLEAN NOT NULL DEFAULT false,
  pending             JSONB  NOT NULL DEFAULT '[]'::jsonb,  -- approval queue for the current turn (small, transient)
  pending_decision    BOOLEAN,                 -- null = undecided, true/false = user's answer
  scheduled_for       BIGINT,                  -- epoch ms; NULL = run now
  recurrence_every_ms BIGINT,                  -- NULL = one-shot
  created_at          BIGINT NOT NULL,
  updated_at          BIGINT NOT NULL
);

-- The worker polls "queued and due" + "running" every 2s. This index makes that
-- an index scan instead of a full-table read of the whole store each tick.
CREATE INDEX IF NOT EXISTS idx_missions_status_sched ON missions (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_missions_created      ON missions (created_at DESC);

-- Progress/action/result lines shown in the UI. Append-only; ordered by seq.
CREATE TABLE IF NOT EXISTS mission_steps (
  seq         BIGSERIAL PRIMARY KEY,
  id          TEXT NOT NULL,
  mission_id  TEXT NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  ts          BIGINT NOT NULL,
  kind        TEXT NOT NULL,                    -- plan|progress|action|result|error
  text        TEXT NOT NULL,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_steps_mission ON mission_steps (mission_id, seq);

-- The model-conversation history that enables resume after a restart. Cleared
-- on completion (only needed in-flight). Append-only; ordered by seq.
CREATE TABLE IF NOT EXISTS mission_api (
  seq          BIGSERIAL PRIMARY KEY,
  mission_id   TEXT NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  role         TEXT NOT NULL,                   -- user|assistant|tool
  content      TEXT,
  tool_calls   JSONB,
  tool_call_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_mission ON mission_api (mission_id, seq);
