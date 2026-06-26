import { promises as fs } from "fs";
import path from "path";
import type { Mission } from "@/lib/missionTypes";
import type { Task, Contact, Deal, Note, Memory } from "@/lib/types";

/**
 * Evolution OS persistence — the server's durable source of truth.
 *
 * A small file-backed store under `.data/`. Every read/write goes to disk so
 * that all server contexts share one consistent view: the background worker
 * (started from instrumentation.ts) and the API route handlers run in separate
 * module graphs, so an in-memory cache would diverge — the file is the truth.
 * Writes are serialized and atomic (temp file + rename).
 *
 * Intentionally swappable: the same interface can be backed by Postgres when
 * Evolution is deployed for 24/7 always-on execution.
 */

export type Shape = {
  missions: Mission[];
  memories: Memory[];
  notes: Note[];
  tasks: Task[];
  contacts: Contact[];
  deals: Deal[];
};

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "evolution.json");
const empty: Shape = { missions: [], memories: [], notes: [], tasks: [], contacts: [], deals: [] };

let writeChain: Promise<void> = Promise.resolve();

async function loadRaw(): Promise<Shape> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return { ...empty, ...JSON.parse(raw) };
  } catch {
    return structuredClone(empty);
  }
}

async function saveRaw(db: Shape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, FILE);
}

/** Read a fresh snapshot from disk. */
export async function read<T>(fn: (db: Shape) => T): Promise<T> {
  return fn(await loadRaw());
}

/** Serialized read-modify-write against the file. */
export async function mutate<T>(fn: (db: Shape) => T): Promise<T> {
  let result!: T;
  writeChain = writeChain.then(async () => {
    const db = await loadRaw();
    result = fn(db);
    await saveRaw(db);
  });
  await writeChain;
  return result;
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/* ---- mission helpers ---- */
export async function getMission(id: string) {
  return read((db) => db.missions.find((m) => m.id === id));
}
export async function listMissions() {
  return read((db) => [...db.missions].sort((a, b) => b.createdAt - a.createdAt));
}
