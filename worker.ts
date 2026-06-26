/**
 * Evolution OS — dedicated always-on worker.
 *
 * Run this as its own process/component so mission execution is fully decoupled
 * from the web tier and from every user device. It executes missions 24/7 while
 * the web service stays stateless (set DISABLE_WORKER=true on web).
 *
 * Local:       npm run worker
 * Production:  a DigitalOcean App Platform "Worker" component (see .do/app.yaml)
 */
// Load local env (.env.local) for `npm run worker`. In production the platform
// injects env vars, the file is absent, and this is a harmless no-op (dotenv
// never overrides existing process.env).
import { config as loadEnv } from "dotenv";
import { startWorker } from "@/lib/server/missionEngine";

loadEnv({ path: ".env.local" });
loadEnv(); // also pick up a plain .env if present

console.log("[Evolution OS] dedicated worker booting…");
startWorker();

// Keep the process alive indefinitely.
const keepAlive = setInterval(() => {}, 1 << 30);

function shutdown(signal: string) {
  console.log(`[Evolution OS] worker received ${signal}; shutting down.`);
  clearInterval(keepAlive);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (e) => console.error("[worker] unhandledRejection", e));
