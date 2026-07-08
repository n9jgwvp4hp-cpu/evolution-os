import { promises as fs } from "fs";
import path from "path";
import type { PoolClient } from "pg";
import { getPool, USE_PG, ensureSchema, uid } from "@/lib/server/db";
import type { Mission, MissionStep, MissionApiMsg, MissionView } from "@/lib/missionTypes";

/**
 * Mission storage — normalized, row-scoped.
 *
 * Missions used to live inside the single `evolution_state` JSONB blob, so every
 * step append rewrote the WHOLE brain under one global `FOR UPDATE` lock — write
 * cost grew with total history and all mission writes serialized against each
 * other. This module moves them into dedicated tables (missions / mission_steps
 * / mission_api) where a write touches one row: independent missions no longer
 * contend, the worker's "what's due?" poll is an index scan instead of a
 * full-store read, and completion just deletes the api rows.
 *
 * Two backends behind one interface, mirroring lib/server/db.ts:
 *   • Postgres — when DATABASE_URL is set (production).
 *   • File     — local dev (.data/missions.json), single-process, whole-file
 *                writes serialized through a chain. Fine at dev scale.
 *
 * On first use against Postgres it creates the tables (idempotent) and backfills
 * any missions still in the legacy JSONB row, then drops that key — so existing
 * missions survive the cutover with no manual step.
 */

/* ============================ Postgres ============================ */

let ready: Promise<void> | null = null;

function initPg(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await ensureSchema(); // guarantees evolution_state exists for the backfill read
      const p = getPool();
      await p.query(`
        CREATE TABLE IF NOT EXISTS missions (
          id TEXT PRIMARY KEY,
          objective TEXT NOT NULL,
          status TEXT NOT NULL,
          result TEXT,
          qc_left INT NOT NULL DEFAULT 2,
          attempts INT NOT NULL DEFAULT 0,
          acknowledged BOOLEAN NOT NULL DEFAULT false,
          pending JSONB NOT NULL DEFAULT '[]'::jsonb,
          pending_decision BOOLEAN,
          scheduled_for BIGINT,
          recurrence_every_ms BIGINT,
          worker_id TEXT,
          lease_expires BIGINT,
          objective_id TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )`);
      // Columns for pre-existing deployments (missions table already created).
      await p.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS worker_id TEXT`);
      await p.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS lease_expires BIGINT`);
      await p.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS objective_id TEXT`);
      await p.query(`CREATE INDEX IF NOT EXISTS idx_missions_status_sched ON missions (status, scheduled_for)`);
      await p.query(`CREATE INDEX IF NOT EXISTS idx_missions_created ON missions (created_at DESC)`);
      await p.query(`CREATE INDEX IF NOT EXISTS idx_missions_lease ON missions (status, lease_expires)`);
      await p.query(`
        CREATE TABLE IF NOT EXISTS mission_steps (
          seq BIGSERIAL PRIMARY KEY,
          id TEXT NOT NULL,
          mission_id TEXT NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
          ts BIGINT NOT NULL,
          kind TEXT NOT NULL,
          text TEXT NOT NULL,
          detail TEXT
        )`);
      await p.query(`CREATE INDEX IF NOT EXISTS idx_steps_mission ON mission_steps (mission_id, seq)`);
      await p.query(`
        CREATE TABLE IF NOT EXISTS mission_api (
          seq BIGSERIAL PRIMARY KEY,
          mission_id TEXT NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT,
          tool_calls JSONB,
          tool_call_id TEXT
        )`);
      await p.query(`CREATE INDEX IF NOT EXISTS idx_api_mission ON mission_api (mission_id, seq)`);
      await backfillFromJsonb();
    })().catch((e) => {
      ready = null; // allow retry on next call
      throw e;
    });
  }
  return ready;
}

/** One-time migration: copy missions out of the legacy JSONB row into the new
 *  tables, then remove the key. Idempotent — only runs while the table is empty. */
async function backfillFromJsonb(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: cnt } = await client.query("SELECT count(*)::int AS n FROM missions");
    if (cnt[0].n > 0) { await client.query("COMMIT"); return; }
    const { rows } = await client.query(
      "SELECT state->'missions' AS missions FROM evolution_state WHERE id = 1 FOR UPDATE"
    );
    const legacy: Mission[] = Array.isArray(rows[0]?.missions) ? rows[0].missions : [];
    for (const m of legacy) await insertMissionTx(client, m);
    if (legacy.length) {
      await client.query("UPDATE evolution_state SET state = state - 'missions' WHERE id = 1");
    }
    await client.query("COMMIT");
    if (legacy.length) console.log(`[Evolution OS] migrated ${legacy.length} missions from JSONB → tables`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function insertMissionTx(client: PoolClient, m: Mission): Promise<void> {
  await client.query(
    `INSERT INTO missions
       (id, objective, status, result, qc_left, attempts, acknowledged, pending,
        pending_decision, scheduled_for, recurrence_every_ms, objective_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO NOTHING`,
    [
      m.id, m.objective, m.status, m.result ?? null, m.qcLeft ?? 2, m.attempts ?? 0,
      Boolean(m.acknowledged), JSON.stringify(m.pending ?? []),
      m.pendingDecision === undefined ? null : m.pendingDecision,
      m.scheduledFor ?? null, m.recurrence?.everyMs ?? null, m.objectiveId ?? null,
      m.createdAt, m.updatedAt,
    ]
  );
  for (const s of m.steps ?? []) {
    await client.query(
      `INSERT INTO mission_steps (id, mission_id, ts, kind, text, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
      [s.id, m.id, s.ts, s.kind, s.text, s.detail ?? null]
    );
  }
  for (const a of m.api ?? []) {
    await client.query(
      `INSERT INTO mission_api (mission_id, role, content, tool_calls, tool_call_id) VALUES ($1,$2,$3,$4,$5)`,
      [m.id, a.role, a.content ?? null, a.tool_calls ? JSON.stringify(a.tool_calls) : null, a.tool_call_id ?? null]
    );
  }
}

/* map a mission DB row (+ optional children) into the domain Mission */
function rowToMission(r: any, steps: MissionStep[], api: MissionApiMsg[]): Mission {
  return {
    id: r.id,
    objective: r.objective,
    status: r.status,
    result: r.result ?? undefined,
    qcLeft: r.qc_left,
    attempts: r.attempts,
    acknowledged: r.acknowledged,
    pending: r.pending ?? [],
    pendingDecision: r.pending_decision, // null | true | false
    scheduledFor: r.scheduled_for != null ? Number(r.scheduled_for) : undefined,
    recurrence: r.recurrence_every_ms != null ? { everyMs: Number(r.recurrence_every_ms) } : undefined,
    objectiveId: r.objective_id ?? null,
    workerId: r.worker_id ?? undefined,
    leaseExpires: r.lease_expires != null ? Number(r.lease_expires) : undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    steps,
    api,
  };
}
const rowToStep = (r: any): MissionStep => ({ id: r.id, ts: Number(r.ts), kind: r.kind, text: r.text, detail: r.detail ?? undefined });
const rowToApi = (r: any): MissionApiMsg => ({ role: r.role, content: r.content, tool_calls: r.tool_calls ?? undefined, tool_call_id: r.tool_call_id ?? undefined });

// Domain field → column, with the value transform each needs. Drives dynamic patch.
const PATCH_COLS: Record<string, { col: string; val: (v: any) => any }> = {
  objective: { col: "objective", val: (v) => v },
  status: { col: "status", val: (v) => v },
  result: { col: "result", val: (v) => v ?? null },
  qcLeft: { col: "qc_left", val: (v) => v },
  attempts: { col: "attempts", val: (v) => v },
  acknowledged: { col: "acknowledged", val: (v) => Boolean(v) },
  pending: { col: "pending", val: (v) => JSON.stringify(v ?? []) },
  pendingDecision: { col: "pending_decision", val: (v) => (v === undefined ? null : v) },
  scheduledFor: { col: "scheduled_for", val: (v) => v ?? null },
  recurrence: { col: "recurrence_every_ms", val: (v) => v?.everyMs ?? null },
  objectiveId: { col: "objective_id", val: (v) => v ?? null },
};

/* ============================== File ============================== */

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "missions.json");
const LEGACY_FILE = path.join(DATA_DIR, "evolution.json");
let fileReady: Promise<void> | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function loadFile(): Promise<Mission[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return [];
  }
}
async function saveFile(list: Mission[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
  await fs.rename(tmp, FILE);
}
/** One-time dev migration: seed missions.json from the legacy evolution.json blob. */
function initFile(): Promise<void> {
  if (!fileReady) {
    fileReady = (async () => {
      try { await fs.access(FILE); return; } catch { /* not seeded yet */ }
      try {
        const blob = JSON.parse(await fs.readFile(LEGACY_FILE, "utf8"));
        if (Array.isArray(blob.missions) && blob.missions.length) {
          await saveFile(blob.missions);
          delete blob.missions;
          await fs.writeFile(LEGACY_FILE, JSON.stringify(blob, null, 2), "utf8");
        }
      } catch { /* no legacy data — start empty */ }
    })();
  }
  return fileReady;
}
/** Serialized read-modify-write of the whole file (dev is single-process). */
async function fileMutate<T>(fn: (list: Mission[]) => T): Promise<T> {
  await initFile();
  let result!: T;
  writeChain = writeChain.then(async () => {
    const list = await loadFile();
    result = fn(list);
    await saveFile(list);
  });
  await writeChain;
  return result;
}
async function fileRead<T>(fn: (list: Mission[]) => T): Promise<T> {
  await initFile();
  return fn(await loadFile());
}

/* ========================= Public interface ========================= */

export async function initMissionStore(): Promise<void> {
  if (USE_PG) await initPg();
  else await initFile();
}

/** Persist a fully-formed new mission (with its initial step + api message). */
export async function createMissionRow(m: Mission): Promise<Mission> {
  if (USE_PG) {
    await initPg();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await insertMissionTx(client, m);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return m;
  }
  await fileMutate((list) => { list.unshift(m); });
  return m;
}

/** Full mission incl. steps + api (used by the execution loop). */
export async function getMission(id: string): Promise<Mission | undefined> {
  if (USE_PG) {
    await initPg();
    const p = getPool();
    const { rows } = await p.query("SELECT * FROM missions WHERE id = $1", [id]);
    if (!rows[0]) return undefined;
    const [steps, api] = await Promise.all([
      p.query("SELECT * FROM mission_steps WHERE mission_id = $1 ORDER BY seq", [id]),
      p.query("SELECT * FROM mission_api WHERE mission_id = $1 ORDER BY seq", [id]),
    ]);
    return rowToMission(rows[0], steps.rows.map(rowToStep), api.rows.map(rowToApi));
  }
  return fileRead((list) => list.find((m) => m.id === id));
}

/** All missions as UI views (steps included, heavy api omitted), newest first. */
export async function listMissionViews(): Promise<MissionView[]> {
  if (USE_PG) {
    await initPg();
    const p = getPool();
    const { rows } = await p.query("SELECT * FROM missions ORDER BY created_at DESC");
    if (!rows.length) return [];
    const { rows: stepRows } = await p.query("SELECT * FROM mission_steps ORDER BY mission_id, seq");
    const byMission = new Map<string, MissionStep[]>();
    for (const s of stepRows) {
      const arr = byMission.get(s.mission_id) || [];
      arr.push(rowToStep(s));
      byMission.set(s.mission_id, arr);
    }
    return rows.map((r) => {
      const { api, workerId, leaseExpires, ...view } = rowToMission(r, byMission.get(r.id) || [], []);
      return view;
    });
  }
  return fileRead((list) =>
    [...list]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ api, workerId, leaseExpires, ...view }) => view)
  );
}

/**
 * Claimable candidates for the worker — the lightweight rows it may try to run:
 * queued-and-due missions, plus running missions whose lease has lapsed (their
 * worker died). Missions actively held by a live worker (valid lease) are
 * excluded, so workers don't fight over them. No steps/api loaded.
 */
export async function listRunnable(now: number): Promise<Array<{ id: string; status: string }>> {
  if (USE_PG) {
    await initPg();
    const { rows } = await getPool().query(
      `SELECT id, status FROM missions
        WHERE (status = 'queued'  AND (scheduled_for IS NULL OR scheduled_for <= $1))
           OR (status = 'running' AND (lease_expires IS NULL OR lease_expires <= $1))`,
      [now]
    );
    return rows;
  }
  return fileRead((list) =>
    list
      .filter(
        (m) =>
          (m.status === "queued" && (!m.scheduledFor || m.scheduledFor <= now)) ||
          (m.status === "running" && (!m.leaseExpires || m.leaseExpires <= now))
      )
      .map((m) => ({ id: m.id, status: m.status }))
  );
}

/**
 * Atomically claim a mission for `workerId`. Succeeds (returns true) only if the
 * mission is queued-and-due OR running with a lapsed lease — the SAME predicate
 * across processes, resolved by a single `UPDATE ... WHERE ... RETURNING`, so
 * Postgres row-locking guarantees exactly one worker wins. Sets the lease.
 */
export async function claimMission(id: string, workerId: string, leaseMs: number): Promise<boolean> {
  const now = Date.now();
  const expires = now + leaseMs;
  if (USE_PG) {
    await initPg();
    const { rows } = await getPool().query(
      `UPDATE missions
          SET status = 'running', worker_id = $2, lease_expires = $3, updated_at = $4
        WHERE id = $1
          AND ( (status = 'queued'  AND (scheduled_for IS NULL OR scheduled_for <= $4))
             OR (status = 'running' AND (lease_expires IS NULL OR lease_expires <= $4)) )
        RETURNING id`,
      [id, workerId, expires, now]
    );
    return rows.length > 0;
  }
  return fileMutate((list) => {
    const m = list.find((x) => x.id === id);
    if (!m) return false;
    const dueQueued = m.status === "queued" && (!m.scheduledFor || m.scheduledFor <= now);
    const staleRunning = m.status === "running" && (!m.leaseExpires || m.leaseExpires <= now);
    if (!dueQueued && !staleRunning) return false;
    m.status = "running";
    m.workerId = workerId;
    m.leaseExpires = expires;
    m.updatedAt = now;
    return true;
  });
}

/**
 * Refresh the lease while a mission runs. Returns false if this worker no longer
 * owns it (another worker reclaimed a lapsed lease) — the caller must then STOP
 * to avoid two workers finishing the same mission.
 */
export async function extendLease(id: string, workerId: string, leaseMs: number): Promise<boolean> {
  const now = Date.now();
  const expires = now + leaseMs;
  if (USE_PG) {
    await initPg();
    const { rows } = await getPool().query(
      `UPDATE missions SET lease_expires = $3, updated_at = $4
        WHERE id = $1 AND worker_id = $2 AND status = 'running'
        RETURNING id`,
      [id, workerId, expires, now]
    );
    return rows.length > 0;
  }
  return fileMutate((list) => {
    const m = list.find((x) => x.id === id);
    if (!m || m.workerId !== workerId || m.status !== "running") return false;
    m.leaseExpires = expires;
    m.updatedAt = now;
    return true;
  });
}

/** Drop the lease once a mission leaves the running state (terminal or re-queued). */
export async function releaseLease(id: string): Promise<void> {
  if (USE_PG) {
    await initPg();
    await getPool().query("UPDATE missions SET worker_id = NULL, lease_expires = NULL WHERE id = $1", [id]);
    return;
  }
  await fileMutate((list) => {
    const m = list.find((x) => x.id === id);
    if (m) { m.workerId = undefined; m.leaseExpires = undefined; }
  });
}

/** Row-scoped patch — updates only the given fields (+ updated_at). */
export async function patchMission(id: string, p: Partial<Mission>): Promise<void> {
  const now = Date.now();
  if (USE_PG) {
    await initPg();
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(p)) {
      const spec = PATCH_COLS[k];
      if (!spec) continue; // steps/api/id/createdAt aren't patched here
      vals.push(spec.val(v));
      sets.push(`${spec.col} = $${vals.length}`);
    }
    vals.push(now);
    sets.push(`updated_at = $${vals.length}`);
    vals.push(id);
    await getPool().query(`UPDATE missions SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
    return;
  }
  await fileMutate((list) => {
    const m = list.find((x) => x.id === id);
    if (m) Object.assign(m, p, { updatedAt: now });
  });
}

export async function addStep(id: string, step: Omit<MissionStep, "id" | "ts">): Promise<void> {
  const full: MissionStep = { ...step, id: uid(), ts: Date.now() };
  if (USE_PG) {
    await initPg();
    await getPool().query(
      `INSERT INTO mission_steps (id, mission_id, ts, kind, text, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
      [full.id, id, full.ts, full.kind, full.text, full.detail ?? null]
    );
    await touch(id);
    return;
  }
  await fileMutate((list) => {
    const m = list.find((x) => x.id === id);
    if (m) { m.steps.push(full); m.updatedAt = full.ts; }
  });
}

export async function pushApi(id: string, msg: MissionApiMsg): Promise<void> {
  if (USE_PG) {
    await initPg();
    await getPool().query(
      `INSERT INTO mission_api (mission_id, role, content, tool_calls, tool_call_id) VALUES ($1,$2,$3,$4,$5)`,
      [id, msg.role, msg.content ?? null, msg.tool_calls ? JSON.stringify(msg.tool_calls) : null, msg.tool_call_id ?? null]
    );
    await touch(id);
    return;
  }
  await fileMutate((list) => {
    const m = list.find((x) => x.id === id);
    if (m) { m.api.push(msg); m.updatedAt = Date.now(); }
  });
}

async function touch(id: string): Promise<void> {
  await getPool().query("UPDATE missions SET updated_at = $2 WHERE id = $1", [id, Date.now()]);
}

/** Drop the model-conversation history for a mission (kept only in-flight). */
export async function clearApi(id: string): Promise<void> {
  if (USE_PG) {
    await initPg();
    await getPool().query("DELETE FROM mission_api WHERE mission_id = $1", [id]);
    return;
  }
  await fileMutate((list) => {
    const m = list.find((x) => x.id === id);
    if (m) m.api = [];
  });
}

/** Boot maintenance: clear api history from already-terminal missions. */
export async function trimTerminalApi(): Promise<void> {
  if (USE_PG) {
    await initPg();
    await getPool().query(
      "DELETE FROM mission_api WHERE mission_id IN (SELECT id FROM missions WHERE status IN ('done','failed'))"
    );
    return;
  }
  await fileMutate((list) => {
    for (const m of list) if ((m.status === "done" || m.status === "failed") && m.api.length) m.api = [];
  });
}

/** Cancel: stop recurrence, clear the approval queue, finalize as done-seen. */
export async function cancelMissionRow(id: string): Promise<void> {
  if (USE_PG) {
    await initPg();
    await getPool().query(
      `UPDATE missions
          SET recurrence_every_ms = NULL,
              pending = '[]'::jsonb,
              worker_id = NULL,
              lease_expires = NULL,
              status = CASE WHEN status = 'done' THEN status ELSE 'done' END,
              result = CASE WHEN status = 'done' THEN result
                            ELSE COALESCE(result || ' ', '') || '(canceled)' END,
              acknowledged = CASE WHEN status = 'done' THEN acknowledged ELSE true END,
              updated_at = $2
        WHERE id = $1`,
      [id, Date.now()]
    );
    return;
  }
  await fileMutate((list) => {
    const m = list.find((x) => x.id === id);
    if (!m) return;
    m.recurrence = undefined;
    m.pending = [];
    m.workerId = undefined;
    m.leaseExpires = undefined;
    if (m.status !== "done") {
      m.status = "done";
      m.result = (m.result ? m.result + " " : "") + "(canceled)";
      m.acknowledged = true;
    }
    m.updatedAt = Date.now();
  });
}

/** Bounded growth: keep all active missions + the most recent terminal ones up
 *  to `cap`; delete older terminal missions (steps/api cascade away). */
export async function pruneMissions(cap: number): Promise<void> {
  if (USE_PG) {
    await initPg();
    await getPool().query(
      `WITH ranked AS (
         SELECT id, row_number() OVER (ORDER BY created_at DESC) AS rn
           FROM missions WHERE status IN ('done','failed')
       ),
       active AS (SELECT count(*)::int AS n FROM missions WHERE status NOT IN ('done','failed'))
       DELETE FROM missions
        WHERE id IN (SELECT id FROM ranked, active WHERE rn > GREATEST($1 - active.n, 0))`,
      [cap]
    );
    return;
  }
  await fileMutate((list) => {
    if (list.length <= cap) return;
    const terminal = (m: Mission) => m.status === "done" || m.status === "failed";
    const active = list.filter((m) => !terminal(m));
    const done = list.filter(terminal).sort((a, b) => b.createdAt - a.createdAt);
    const keep = done.slice(0, Math.max(0, cap - active.length));
    const kept = new Set([...active, ...keep].map((m) => m.id));
    for (let i = list.length - 1; i >= 0; i--) if (!kept.has(list[i].id)) list.splice(i, 1);
  });
}

/** Health/observability: status histogram + retained api-message count. */
export async function missionStats(): Promise<{ counts: Record<string, number>; apiMsgs: number }> {
  if (USE_PG) {
    await initPg();
    const p = getPool();
    const [{ rows: statusRows }, { rows: apiRows }] = await Promise.all([
      p.query("SELECT status, count(*)::int AS n FROM missions GROUP BY status"),
      p.query("SELECT count(*)::int AS n FROM mission_api"),
    ]);
    const counts: Record<string, number> = {};
    for (const r of statusRows) counts[r.status] = r.n;
    return { counts, apiMsgs: apiRows[0].n };
  }
  return fileRead((list) => {
    const counts: Record<string, number> = {};
    let apiMsgs = 0;
    for (const m of list) {
      counts[m.status] = (counts[m.status] || 0) + 1;
      apiMsgs += m.api?.length || 0;
    }
    return { counts, apiMsgs };
  });
}
