import { promises as fs } from "fs";
import path from "path";
import { Pool, type PoolClient } from "pg";
import type { Task, Contact, Deal, Note, Memory, Priority, OrchestratorStatus, AutomationRule, TriggerEvent, Identity, Vision, Objective, Brand, AppSettings, OnboardingForm, FormSubmission, Project } from "@/lib/types";

/**
 * Evolution OS persistence — the server's durable source of truth.
 *
 * Two interchangeable backends behind ONE interface (read / mutate):
 *   • Postgres  — used when DATABASE_URL is set (production / DigitalOcean).
 *     The whole brain is a single JSONB row; mutate() runs in a transaction
 *     with SELECT … FOR UPDATE so writes are atomic and serialized even across
 *     multiple processes/instances.
 *   • File      — used in local dev (no DATABASE_URL): a JSON file under .data/.
 *
 * Everything above this file (data service, mission engine, API routes) is
 * unchanged regardless of backend.
 */

// OAuth tokens persisted server-side so the mission worker can act as the user
// (Gmail / Calendar) without a browser session.
export type GoogleTokens = {
  access_token: string;
  refresh_token?: string;
  expiry: number;
  email?: string;
};

// Missions live in their own normalized tables (see migrations/001_missions.sql
// and lib/server/missionStore.ts). This blob holds only the smaller, read-mostly
// brain collections; they don't churn per mission step, so a single-row JSONB is
// still the right fit for them.
export type Shape = {
  brands: Brand[];           // multi-brand portfolio (UW Equity parent + subsidiaries)
  settings: AppSettings | null; // app-wide UI settings (active brand, …)
  onboardingForms: OnboardingForm[]; // brand-specific onboarding forms
  formSubmissions: FormSubmission[]; // onboarding submissions (bounded) → become leads
  identity: Identity | null; // who the user is + what they value (singleton)
  visions: Vision[];         // long-term futures being built
  objectives: Objective[];   // measurable outcomes supporting the visions
  memories: Memory[];
  notes: Note[];
  tasks: Task[];
  projects: Project[]; // brand-scopable initiatives (server-backed; feeds the portfolio dashboard)
  contacts: Contact[];
  deals: Deal[];
  priorities: Priority[]; // executive-assistant Priority Queue (rebuilt each kernel cycle)
  orchestrator: OrchestratorStatus | null; // continuous workflow orchestrator status
  automationRules: AutomationRule[]; // event-driven automation rules
  eventLog: TriggerEvent[]; // recent trigger fires (bounded)
  google: GoogleTokens | null;
  workerHeartbeat: number | null; // last time the mission worker ticked
};

const empty: Shape = {
  brands: [],
  settings: null,
  onboardingForms: [],
  formSubmissions: [],
  identity: null,
  visions: [],
  objectives: [],
  memories: [],
  notes: [],
  tasks: [],
  projects: [],
  contacts: [],
  deals: [],
  priorities: [],
  orchestrator: null,
  automationRules: [],
  eventLog: [],
  google: null,
  workerHeartbeat: null,
};
const merge = (state: any): Shape => ({ ...empty, ...(state || {}) });

const DATABASE_URL = process.env.DATABASE_URL || "";
export const USE_PG = Boolean(DATABASE_URL);
export const dbBackend = () => (USE_PG ? "postgres" : "file");

/* ===================== Postgres backend ===================== */
let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

/**
 * Strip `sslmode` from the connection string. node-postgres parses `sslmode`
 * out of the URL and uses it to build its OWN ssl config, which overrides the
 * `ssl` option we pass — so DigitalOcean's self-signed CA chain fails
 * verification. Removing it lets our explicit ssl config govern TLS.
 */
function stripSslmode(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return url.replace(/[?&]sslmode=[^&]*/gi, "").replace(/[?&]$/, "");
  }
}

export function getPool(): Pool {
  if (!pool) {
    const local = /@(localhost|127\.0\.0\.1)/.test(DATABASE_URL);
    pool = new Pool({
      connectionString: stripSslmode(DATABASE_URL),
      // DigitalOcean Managed Postgres requires TLS but uses a self-signed CA
      // chain; connect over TLS without chain verification.
      ssl: local ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const p = getPool();
      await p.query(
        `CREATE TABLE IF NOT EXISTS evolution_state (
           id INT PRIMARY KEY,
           state JSONB NOT NULL,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`
      );
      await p.query(
        `INSERT INTO evolution_state (id, state) VALUES (1, $1)
         ON CONFLICT (id) DO NOTHING`,
        [JSON.stringify(empty)]
      );
    })().catch((e) => {
      schemaReady = null; // allow retry on next call
      throw e;
    });
  }
  return schemaReady;
}

async function pgRead<T>(fn: (db: Shape) => T): Promise<T> {
  await ensureSchema();
  const { rows } = await getPool().query("SELECT state FROM evolution_state WHERE id = 1");
  return fn(merge(rows[0]?.state));
}

async function pgMutate<T>(fn: (db: Shape) => T): Promise<T> {
  await ensureSchema();
  const client: PoolClient = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT state FROM evolution_state WHERE id = 1 FOR UPDATE");
    const db = merge(rows[0]?.state);
    const result = fn(db);
    await client.query("UPDATE evolution_state SET state = $1, updated_at = now() WHERE id = 1", [
      JSON.stringify(db),
    ]);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/* ======================= File backend ======================= */
const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "evolution.json");
let writeChain: Promise<void> = Promise.resolve();

async function loadFile(): Promise<Shape> {
  try {
    return merge(JSON.parse(await fs.readFile(FILE, "utf8")));
  } catch {
    return structuredClone(empty);
  }
}
async function saveFile(db: Shape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, FILE);
}
async function fileRead<T>(fn: (db: Shape) => T): Promise<T> {
  return fn(await loadFile());
}
async function fileMutate<T>(fn: (db: Shape) => T): Promise<T> {
  let result!: T;
  writeChain = writeChain.then(async () => {
    const db = await loadFile();
    result = fn(db);
    await saveFile(db);
  });
  await writeChain;
  return result;
}

/* ===================== Public interface ===================== */
export async function read<T>(fn: (db: Shape) => T): Promise<T> {
  return USE_PG ? pgRead(fn) : fileRead(fn);
}
export async function mutate<T>(fn: (db: Shape) => T): Promise<T> {
  return USE_PG ? pgMutate(fn) : fileMutate(fn);
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/* ---- worker liveness (observability for the always-on runtime) ---- */
export async function setWorkerHeartbeat() {
  await mutate((db) => {
    db.workerHeartbeat = Date.now();
  });
}
export async function getWorkerHeartbeat() {
  return read((db) => db.workerHeartbeat ?? null);
}
