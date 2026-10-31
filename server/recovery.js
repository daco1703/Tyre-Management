import { DatabaseSync } from "node:sqlite";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { defaultOwner } from "./default-owner.js";
import { createPostgresStore } from "./storage/postgres.js";
import { defaultFleetName } from "../shared/defaults.js";
import { emptyState } from "../shared/model.js";

export const RECOVERY_MARKER_KEY = "databaseImport";
const FORMAT = "shepards-database-backup";
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

class RecoveryError extends Error {
  constructor(message) {
    super(message);
    this.name = "RecoveryError";
  }
}

const invalid = () => {
  throw new RecoveryError(
    "The full database backup is invalid or unsupported.",
  );
};

// These files contain password hashes. Keep them private, outside source
// control, and retain an independent copy. Sessions and rate limits are never
// backed up; importing a backup revokes every existing session.
export function validateDatabaseBackup(backup) {
  if (
    !isObject(backup) ||
    backup.format !== FORMAT ||
    backup.version !== 1 ||
    typeof backup.createdAt !== "string" ||
    !Number.isFinite(Date.parse(backup.createdAt)) ||
    !Array.isArray(backup.users) ||
    !backup.users.length ||
    !Array.isArray(backup.settings)
  )
    invalid();
  const ids = new Set();
  const usernames = new Set();
  let activeOwner = false;
  const users = backup.users.map((user) => {
    if (
      !isObject(user) ||
      !Number.isSafeInteger(user.id) ||
      user.id < 1 ||
      user.id > 2147483647 ||
      typeof user.username !== "string" ||
      !/^[a-z0-9_.-]{3,40}$/.test(user.username) ||
      ids.has(user.id) ||
      usernames.has(user.username) ||
      typeof user.salt !== "string" ||
      !/^[a-f0-9]{32}$/i.test(user.salt) ||
      typeof user.hash !== "string" ||
      !/^[a-f0-9]{128}$/i.test(user.hash) ||
      !["owner", "staff"].includes(user.role) ||
      ![0, 1].includes(user.active)
    )
      invalid();
    ids.add(user.id);
    usernames.add(user.username);
    if (user.role === "owner" && user.active === 1) activeOwner = true;
    return {
      id: user.id,
      username: user.username,
      salt: user.salt,
      hash: user.hash,
      role: user.role,
      active: user.active,
    };
  });
  if (!activeOwner) invalid();
  const keys = new Set();
  const settings = backup.settings.map((setting) => {
    if (
      !isObject(setting) ||
      typeof setting.key !== "string" ||
      !setting.key.length ||
      keys.has(setting.key) ||
      typeof setting.value !== "string"
    )
      invalid();
    keys.add(setting.key);
    return { key: setting.key, value: setting.value };
  });
  if (!keys.has("state") || !keys.has("fleetName")) invalid();
  const fleetName = settings.find(
    (setting) => setting.key === "fleetName",
  ).value;
  if (!fleetName.trim()) invalid();
  let state;
  try {
    state = JSON.parse(
      settings.find((setting) => setting.key === "state").value,
    );
  } catch {
    invalid();
  }
  if (
    !isObject(state) ||
    state.version !== 1 ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !["vehicles", "tyres", "events"].every(
      (key) => Array.isArray(state[key]) && state[key].every(isObject),
    )
  )
    invalid();
  return {
    format: FORMAT,
    version: 1,
    createdAt: backup.createdAt,
    users,
    settings,
  };
}

export async function createDatabaseBackup(store) {
  return store.transaction(async (tx) =>
    validateDatabaseBackup({
      format: FORMAT,
      version: 1,
      createdAt: new Date().toISOString(),
      users: await tx.all(
        "SELECT id,username,salt,hash,role,active FROM users ORDER BY id",
      ),
      settings: await tx.all("SELECT key,value FROM settings ORDER BY key"),
    }),
  );
}

export function writeBackupFile(backup, destination) {
  const contents = `${JSON.stringify(validateDatabaseBackup(backup), null, 2)}\n`;
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  let fd;
  let completed = false;
  try {
    fd = openSync(
      destination,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    fchmodSync(fd, 0o600);
    writeFileSync(fd, contents, "utf8");
    fsyncSync(fd);
    completed = true;
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
      if (!completed) unlinkSync(destination);
    }
  }
}

function readRegularFile(source, operation) {
  const fd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile())
      throw new RecoveryError("The backup source must be a regular file.");
    return operation(fd);
  } finally {
    closeSync(fd);
  }
}

export function readBackupFile(source) {
  const contents = readRegularFile(source, (fd) => readFileSync(fd, "utf8"));
  let backup;
  try {
    backup = JSON.parse(contents);
  } catch {
    invalid();
  }
  return validateDatabaseBackup(backup);
}

// Supply a full SQLite backup made by server/backup.js, never the deployed
// live database or a fleet-data-only export. Read-only plus a read transaction
// keeps the integrity check, accounts and settings in one consistent snapshot.
export function readSqliteBackup(source) {
  readRegularFile(source, () => undefined);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec("BEGIN");
    const checked = db.prepare("PRAGMA quick_check").all();
    if (checked.length !== 1 || Object.values(checked[0])[0] !== "ok")
      invalid();
    const backup = validateDatabaseBackup({
      format: FORMAT,
      version: 1,
      createdAt: new Date().toISOString(),
      users: db
        .prepare(
          "SELECT id,username,salt,hash,role,active FROM users ORDER BY id",
        )
        .all(),
      settings: db.prepare("SELECT key,value FROM settings ORDER BY key").all(),
    });
    db.exec("COMMIT");
    return backup;
  } finally {
    db.close();
  }
}

async function requirePristineTarget(tx) {
  const users = await tx.all(
    "SELECT id,username,salt,hash,role,active FROM users ORDER BY id",
  );
  const settings = await tx.all("SELECT key,value FROM settings ORDER BY key");
  let state;
  try {
    state = JSON.parse(settings.find((row) => row.key === "state")?.value);
  } catch {
    /* A malformed target is also an existing, non-pristine database. */
  }
  if (
    users.length !== 1 ||
    users[0].id !== 1 ||
    users[0].username !== defaultOwner.username ||
    users[0].salt !== defaultOwner.salt ||
    users[0].hash !== defaultOwner.hash ||
    users[0].role !== "owner" ||
    users[0].active !== 1 ||
    settings.length !== 2 ||
    settings.find((row) => row.key === "fleetName")?.value !==
      defaultFleetName ||
    !isDeepStrictEqual(state, emptyState())
  )
    throw new RecoveryError(
      "Import refused: the destination database is not a pristine new installation.",
    );
}

export async function importDatabaseBackup(store, source) {
  if (store.kind !== "postgres")
    throw new RecoveryError(
      "Recovery imports require a PostgreSQL destination.",
    );
  // Copy validated scalar fields before awaiting anything. A caller cannot
  // mutate the source object between validation and the transaction's writes.
  const backup = validateDatabaseBackup(source);
  return store.transaction(async (tx) => {
    await requirePristineTarget(tx);
    await tx.run("DELETE FROM sessions");
    await tx.run("DELETE FROM rate_limits");
    await tx.run("DELETE FROM users");
    await tx.run("DELETE FROM settings");
    for (const user of backup.users)
      await tx.run(
        "INSERT INTO users (id,username,salt,hash,role,active) VALUES (?,?,?,?,?,?)",
        user.id,
        user.username,
        user.salt,
        user.hash,
        user.role,
        user.active,
      );
    for (const setting of backup.settings)
      await tx.run(
        "INSERT INTO settings (key,value) VALUES (?,?)",
        setting.key,
        setting.value,
      );
    await tx.run(
      "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING",
      RECOVERY_MARKER_KEY,
      JSON.stringify({
        format: FORMAT,
        version: 1,
        importedAt: new Date().toISOString(),
      }),
    );
    await tx.get(
      "SELECT setval(pg_get_serial_sequence('users','id'), ?, true)",
      backup.users.reduce((max, user) => Math.max(max, user.id), 0),
    );
    return { users: backup.users.length, settings: backup.settings.length };
  });
}

export function openRecoveryPostgresStore(connectionString) {
  if (!connectionString)
    throw new RecoveryError(
      "DATABASE_URL must name the external PostgreSQL database.",
    );
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new RecoveryError(
      "DATABASE_URL must be a PostgreSQL connection URL.",
    );
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    url.hostname.toLowerCase(),
  );
  return createPostgresStore({
    connectionString,
    ...(local ? { ssl: false } : {}),
  });
}

function isDeployedSqlitePath(source) {
  const live = process.env.DATABASE_PATH || "./data/tyresaathi.sqlite";
  if (path.resolve(source) === path.resolve(live)) return true;
  try {
    return realpathSync(source) === realpathSync(live);
  } catch {
    return false;
  }
}

// Provider errors can contain connection URLs, query parameters and hashes.
// CLI output deliberately contains only fixed text and safe validation errors.
export async function runRecoveryCommand(command) {
  const argument = process.argv[2];
  const file =
    command === "backup"
      ? "backup-postgres"
      : command === "migrate"
        ? "migrate-postgres"
        : "restore-postgres";
  let store;
  try {
    if (!argument || process.argv.length !== 3)
      throw new RecoveryError(
        `Usage: DATABASE_URL=... node server/${file}.js ${command === "backup" ? "/new/private/backup.json" : command === "migrate" ? "/path/full-sqlite-backup.sqlite" : "/path/full-database-backup.json"}`,
      );
    let backup;
    if (command === "migrate") {
      if (isDeployedSqlitePath(argument))
        throw new RecoveryError(
          "Use a separate full SQLite backup, never the deployed live database.",
        );
      backup = readSqliteBackup(argument);
    } else if (command === "restore") backup = readBackupFile(argument);
    store = openRecoveryPostgresStore(process.env.DATABASE_URL);
    if (command === "backup") {
      writeBackupFile(await createDatabaseBackup(store), argument);
      console.log(
        "Full PostgreSQL backup completed. Keep this private file outside the server. Sessions and rate limits are excluded.",
      );
    } else {
      await importDatabaseBackup(store, backup);
      console.log(
        "Database import completed. Accounts and fleet records were preserved. All sessions were revoked; users must sign in again.",
      );
    }
  } catch (error) {
    console.error(
      error instanceof RecoveryError
        ? error.message
        : "Recovery operation failed. Check the connection, source backup and file permissions. Existing destination files are never overwritten.",
    );
    process.exitCode = 1;
  } finally {
    try {
      await store?.close();
    } catch {
      console.error("Recovery database connection could not close cleanly.");
      process.exitCode = 1;
    }
  }
}
