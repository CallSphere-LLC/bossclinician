import { createApp } from "./app";
import { env } from "./config/env";
import { applySchema } from "./db/migrate";
import { runSeedIfEmpty } from "./seed/seed";
import { pool } from "./db/pool";

async function main(): Promise<void> {
  await applySchema();
  await runSeedIfEmpty();

  const app = createApp();
  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`bossclinician backend listening on :${env.port} (${env.nodeEnv})`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  void pool.end();
  process.exit(1);
});
