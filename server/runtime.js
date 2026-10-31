import { createApp } from "./app.js";
import { createPostgresStore } from "./storage/postgres.js";
import { deploymentOptions } from "./config.js";

export function createRuntime({
  env = process.env,
  serverless = env.VERCEL === "1",
} = {}) {
  let store;
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL;
  if (databaseUrl) {
    let local = false;
    try {
      local = ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(databaseUrl).hostname,
      );
    } catch {}
    store = createPostgresStore({
      connectionString: databaseUrl,
      ...(local ? { ssl: false } : {}),
    });
  } else if (serverless) {
    const error = new Error(
      "A PostgreSQL database must be connected in Vercel",
    );
    error.code = "databaseNotConfigured";
    throw error;
  }
  return createApp({
    ...(store
      ? { store }
      : { dbPath: env.DATABASE_PATH || "./data/tyresaathi.sqlite" }),
    serverless,
    production: serverless || env.NODE_ENV === "production",
    ...deploymentOptions(env),
  });
}
