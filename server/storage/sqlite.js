import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { defaultOwner } from "../default-owner.js";
import { defaultFleetName } from "../../shared/defaults.js";
import { emptyState } from "../../shared/model.js";

// Keep local development and existing SQLite installations available. All
// accesses, including reads, join one queue: an async transaction must never
// yield its connection to another request between BEGIN and COMMIT.
export function createSqliteStore(dbPath = "./data/tyresaathi.sqlite") {
  if (dbPath !== ":memory:")
    mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until BIGINT NOT NULL);`);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING",
      ).run("state", JSON.stringify(emptyState()));
      if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n === 0) {
        db.prepare(
          "INSERT INTO users (username,salt,hash,role) VALUES (?,?,?,?)",
        ).run(
          defaultOwner.username,
          defaultOwner.salt,
          defaultOwner.hash,
          "owner",
        );
        db.prepare(
          "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING",
        ).run("fleetName", defaultFleetName);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    db.close();
    throw error;
  }

  let tail = Promise.resolve();
  let closed = false;
  let closePromise;
  const enqueue = (operation) => {
    const result = tail.then(() => {
      if (closed) throw new Error("Database storage is closed");
      return operation();
    });
    // A rejected request must not poison the queue for following requests.
    tail = result.catch(() => {});
    return result;
  };
  const queries = {
    kind: "sqlite",
    get: async (sql, ...params) => db.prepare(sql).get(...params),
    all: async (sql, ...params) => db.prepare(sql).all(...params),
    run: async (sql, ...params) => {
      const result = db.prepare(sql).run(...params);
      return { ...result, rowCount: Number(result.changes) };
    },
  };
  const store = {
    kind: "sqlite",
    // Compatibility for local recovery tools and isolated test fixtures only.
    // Application requests must use the queued methods below.
    db,
    initialize: async () => {
      if (closed) throw new Error("Database storage is closed");
    },
    get: (sql, ...params) => enqueue(() => queries.get(sql, ...params)),
    all: (sql, ...params) => enqueue(() => queries.all(sql, ...params)),
    run: (sql, ...params) => enqueue(() => queries.run(sql, ...params)),
    transaction: (operation) =>
      enqueue(async () => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = await operation(queries);
          db.exec("COMMIT");
          return result;
        } catch (error) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // Preserve the original operation failure.
          }
          throw error;
        }
      }),
    close: () => {
      if (!closePromise)
        closePromise = enqueue(() => {
          db.close();
          closed = true;
        });
      return closePromise;
    },
  };
  return store;
}
