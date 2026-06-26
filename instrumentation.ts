/**
 * Runs once when the server process starts. We launch the persistent mission
 * worker here so background execution begins as soon as Evolution OS is up and
 * keeps running for the life of the process — independent of any browser.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("@/lib/server/missionEngine");
    startWorker();
  }
}
