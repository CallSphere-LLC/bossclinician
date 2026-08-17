import { createApp } from "./app";
import { env } from "./config/env";
import { applySchema } from "./db/migrate";
import { runSeedIfEmpty } from "./seed/seed";
import { pool } from "./db/pool";
import { registerCoreHandlers } from "./jobs/handlers";
import { startWorker, stopWorker } from "./jobs/worker";

async function main(): Promise<void> {
  await applySchema();
  await runSeedIfEmpty();

  // Handlers are registered before the worker starts, so a job claimed in the
  // first tick already has somewhere to go.
  registerCoreHandlers();
  if (env.workerEnabled) startWorker();

  const app = createApp();
  const server = app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`bossclinician backend listening on :${env.port} (${env.nodeEnv})`);
  });

  // Stop claiming new work before the HTTP server closes. In-flight jobs are
  // left to finish; if the process dies first their leases lapse and another
  // worker reclaims them, which is what the lease is for.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      console.log(`[server] ${signal} received, shutting down`);
      stopWorker();
      server.close(() => void pool.end().then(() => process.exit(0)));
      // Docker sends SIGKILL after its grace period regardless; this makes sure
      // a hung connection does not hold the container open until then.
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  void pool.end();
  process.exit(1);
});
