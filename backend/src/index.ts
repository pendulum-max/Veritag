import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { InMemoryRepository, PostgresRepository } from "./db/repository.js";

const config = loadConfig();
const useInMemory = process.env.USE_IN_MEMORY_DB === "true";
const repo = useInMemory ? new InMemoryRepository() : new PostgresRepository(config.databaseUrl);

const app = createApp({ config, repo });

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(
      `Veritag backend listening on http://localhost:${info.port} (${config.stellarNetwork})`,
    );
  },
);
