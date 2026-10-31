import pg from "pg";
import { defaultOwner } from "../default-owner.js";
import { defaultFleetName } from "../../shared/defaults.js";
import { emptyState } from "../../shared/model.js";

const { Pool } = pg;
// Every fleet mutation and initialization shares this transaction-scoped lock.
// It serializes checks and writes across independent serverless instances.
const FLEET_TRANSACTION_LOCK = 173040086;

function connectionOptions(connectionString, ssl) {
  let url;
  try {
    url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname)
      throw new Error();
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    url.hostname.toLowerCase(),
  );
  if (ssl === false && !local)
    throw new Error("Remote PostgreSQL connections require verified TLS");
  if (
    ssl !== undefined &&
    ssl !== true &&
    ssl !== false &&
    (typeof ssl !== "object" || ssl === null)
  )
    throw new Error("Invalid PostgreSQL TLS configuration");
  if (ssl && typeof ssl === "object" && ssl.rejectUnauthorized === false)
    throw new Error("PostgreSQL certificate verification cannot be disabled");

  // node-postgres otherwise lets connection-string TLS flags replace the SSL
  // object. The supplied URL must not silently disable certificate validation.
  for (const key of [
    "ssl",
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "uselibpqcompat",
  ])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl:
      ssl === false
        ? false
        : { ...(typeof ssl === "object" ? ssl : {}), rejectUnauthorized: true },
  };
}

// Statements are trusted application constants, never user-supplied SQL. Skip
// quoted strings, quoted identifiers and comments when replacing placeholders.
export function postgresPlaceholders(sql) {
  let parameter = 0;
  return sql.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\r\n]*|\/\*[\s\S]*?\*\/|\?/g,
    (part) => (part === "?" ? `$${++parameter}` : part),
  );
}

function queryMethods(client) {
  const query = (sql, params) =>
    client.query(postgresPlaceholders(sql), params);
  return {
    kind: "postgres",
    get: async (sql, ...params) => (await query(sql, params)).rows[0],
    all: async (sql, ...params) => (await query(sql, params)).rows,
    run: async (sql, ...params) => {
      const result = await query(sql, params);
      return {
        changes: result.rowCount ?? 0,
        rowCount: result.rowCount ?? 0,
        rows: result.rows,
        lastInsertRowid: result.rows[0]?.id,
      };
    },
  };
}

export function createPostgresStore({ connectionString, ssl, max = 3 } = {}) {
  if (!Number.isSafeInteger(max) || max < 1 || max > 3)
    throw new Error("PostgreSQL pool size must be between 1 and 3");
  const pool = new Pool({
    ...connectionOptions(connectionString, ssl),
    max,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
    query_timeout: 15000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 15000,
    allowExitOnIdle: true,
    keepAlive: true,
    application_name: "shepards-tyre-management",
  });
  // An idle connection may be dropped by a provider between requests. The pool
  // discards it; the next operation reconnects. Do not print credentials/errors.
  pool.on("error", () => {});
  let initialization;
  let closed = false;
  let closePromise;

  async function withTransaction(operation) {
    const client = await pool.connect();
    let begun = false;
    let releaseError;
    try {
      await client.query("BEGIN");
      begun = true;
      await client.query("SELECT pg_advisory_xact_lock($1)", [
        FLEET_TRANSACTION_LOCK,
      ]);
      const result = await operation(client);
      await client.query("COMMIT");
      begun = false;
      return result;
    } catch (error) {
      if (begun) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          // Preserve the original operation/connection failure.
          // The protocol/transaction state is uncertain; discard this client.
          releaseError = rollbackError;
        }
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  async function initializeOnce() {
    await withTransaction(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires BIGINT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until BIGINT NOT NULL);
      `);
      await client.query(
        "INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT(key) DO NOTHING",
        ["state", JSON.stringify(emptyState())],
      );
      const users = await client.query("SELECT COUNT(*) AS n FROM users");
      if (Number(users.rows[0].n) === 0) {
        await client.query(
          "INSERT INTO users (username,salt,hash,role) VALUES ($1,$2,$3,$4)",
          [
            defaultOwner.username,
            defaultOwner.salt,
            defaultOwner.hash,
            "owner",
          ],
        );
        await client.query(
          "INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT(key) DO NOTHING",
          ["fleetName", defaultFleetName],
        );
      }
    });
  }

  function initialize() {
    if (closed) return Promise.reject(new Error("Database storage is closed"));
    if (!initialization)
      initialization = initializeOnce().catch((error) => {
        // Transient network failures must not poison a warm function forever.
        initialization = undefined;
        throw error;
      });
    return initialization;
  }

  const queries = queryMethods(pool);
  return {
    kind: "postgres",
    db: null,
    initialize,
    get: async (sql, ...params) => {
      await initialize();
      return queries.get(sql, ...params);
    },
    all: async (sql, ...params) => {
      await initialize();
      return queries.all(sql, ...params);
    },
    run: async (sql, ...params) => {
      await initialize();
      return queries.run(sql, ...params);
    },
    transaction: async (operation) => {
      await initialize();
      return withTransaction((client) => operation(queryMethods(client)));
    },
    close: () => {
      if (!closePromise) {
        closed = true;
        closePromise = (async () => {
          try {
            await initialization;
          } catch {
            // A failed initialization still needs its pool closed.
          }
          await pool.end();
        })();
      }
      return closePromise;
    },
  };
}
