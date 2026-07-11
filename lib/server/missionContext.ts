import { AsyncLocalStorage } from "async_hooks";

/**
 * Per-execution mission context.
 *
 * A mission carries a `brandId` (and often a `contactId`). Tools, however, are
 * invoked with only their own arguments — they don't know which brand they're
 * acting for. This AsyncLocalStorage lets the mission engine wrap a run so that
 * anything it calls (notably getServerAccessToken → the correct brand's Gmail /
 * Calendar OAuth token) can read the active brand without threading it through
 * every signature. Concurrency-safe: each mission run gets its own store.
 */
export type MissionContext = { brandId?: string | null; contactId?: string | null };

const als = new AsyncLocalStorage<MissionContext>();

export function runWithMissionContext<T>(ctx: MissionContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export function getMissionContext(): MissionContext | undefined {
  return als.getStore();
}
