import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultOwner } from "../server/default-owner.js";
import { defaultFleetName } from "../shared/defaults.js";
import { emptyState } from "../shared/model.js";
import {
  RECOVERY_MARKER_KEY,
  createDatabaseBackup,
  importDatabaseBackup,
  openRecoveryPostgresStore,
  readBackupFile,
  readSqliteBackup,
  validateDatabaseBackup,
  writeBackupFile,
} from "../server/recovery.js";

const project = fileURLToPath(new URL("..", import.meta.url));
const postgresOnly = { skip: !process.env.TEST_DATABASE_URL, timeout: 45000 };
const password = "public-recovery-test-password";
function fixtureBackup() {
  const account = (id, username, role, active) => {
    const salt = String(id).padStart(32, "0");
    return {
      id,
      username,
      salt,
      hash: scryptSync(password, salt, 64).toString("hex"),
      role,
      active,
    };
  };
  return {
    format: "shepards-database-backup",
    version: 1,
    createdAt: "2026-10-31T12:00:00.000Z",
    users: [
      account(7, "recovery.owner", "owner", 1),
      account(12, "recovery.staff", "staff", 1),
      account(19, "recovery.removed", "staff", 0),
    ],
    settings: [
      { key: "fleetName", value: defaultFleetName },
      {
        key: "state",
        value: JSON.stringify({
          ...emptyState(),
          revision: 8,
          vehicles: [
            { id: "vehicle-test", registration: "RECOV123", driver: "राम" },
          ],
          tyres: [
            { id: "tyre-test", serial: "3E56665445677", status: "installed" },
          ],
          events: [
            { id: "event-test", kind: "addTyre", actor: "recovery.staff" },
          ],
        }),
      },
      { key: "branding", value: JSON.stringify({ test: "preserved setting" }) },
    ],
  };
}
function directory(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "tyre-recovery-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function sqliteFile(destination, backup) {
  const db = new DatabaseSync(destination);
  try {
    db.exec(
      "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, salt TEXT, hash TEXT, role TEXT, active INTEGER); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE sessions (hash TEXT, user_id INTEGER, expires INTEGER); CREATE TABLE rate_limits (key TEXT, count INTEGER, until INTEGER)",
    );
    for (const user of backup.users)
      db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?)").run(
        user.id,
        user.username,
        user.salt,
        user.hash,
        user.role,
        user.active,
      );
    for (const setting of backup.settings)
      db.prepare("INSERT INTO settings VALUES (?,?)").run(
        setting.key,
        setting.value,
      );
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
      "test-session-excluded",
      7,
      Date.now() + 100000,
    );
    db.prepare("INSERT INTO rate_limits VALUES (?,?,?)").run(
      "test-rate-excluded",
      20,
      Date.now() + 100000,
    );
  } finally {
    db.close();
  }
}
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const contents = (backup) => ({
  users: [...backup.users].sort((a, b) => a.id - b.id),
  settings: [...backup.settings].sort((a, b) => a.key.localeCompare(b.key)),
});

test("full backups capture accounts and settings within one storage transaction", async () => {
  const backup = fixtureBackup();
  let transactions = 0;
  const reads = [];
  const result = await createDatabaseBackup({
    transaction: async (operation) => {
      transactions++;
      return operation({
        all: async (sql) => {
          reads.push(sql);
          return sql.includes("FROM users") ? backup.users : backup.settings;
        },
      });
    },
  });
  assert.equal(transactions, 1);
  assert.equal(reads.length, 2);
  assert.deepEqual(contents(result), contents(backup));
  assert.equal(Object.hasOwn(result, "sessions"), false);
  assert.equal(Object.hasOwn(result, "rate_limits"), false);
});

test("backup files are exclusive, private and round-trip without overwriting files or symlinks", (t) => {
  const dir = directory(t),
    destination = path.join(dir, "private", "backup.json");
  const backup = fixtureBackup();
  writeBackupFile(backup, destination);
  assert.equal(statSync(destination).mode & 0o777, 0o600);
  assert.deepEqual(readBackupFile(destination), backup);
  const before = readFileSync(destination);
  assert.throws(() => writeBackupFile(backup, destination), { code: "EEXIST" });
  assert.equal(readFileSync(destination).equals(before), true);
  const link = path.join(dir, "backup-link.json");
  symlinkSync(destination, link);
  assert.throws(() => writeBackupFile(backup, link), { code: "EEXIST" });
  assert.throws(() => readBackupFile(link));
  assert.equal(readFileSync(destination).equals(before), true);
});

test("read-only SQLite migration reads the complete checked snapshot and leaves source bytes unchanged", (t) => {
  const source = path.join(directory(t), "full-backup.sqlite"),
    backup = fixtureBackup();
  sqliteFile(source, backup);
  const before = readFileSync(source);
  assert.deepEqual(contents(readSqliteBackup(source)), contents(backup));
  assert.equal(readFileSync(source).equals(before), true);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 1);
  } finally {
    db.close();
  }
});

test("fleet-only exports, corrupted SQLite and malformed JSON are rejected", (t) => {
  const dir = directory(t),
    source = path.join(dir, "invalid.sqlite");
  writeFileSync(source, "not a SQLite database");
  assert.throws(() => readSqliteBackup(source));
  writeFileSync(
    path.join(dir, "fleet-only.json"),
    JSON.stringify(emptyState()),
  );
  assert.throws(
    () => readBackupFile(path.join(dir, "fleet-only.json")),
    /invalid or unsupported/,
  );
  writeFileSync(path.join(dir, "bad.json"), '{"format":');
  assert.throws(
    () => readBackupFile(path.join(dir, "bad.json")),
    /invalid or unsupported/,
  );
});

test("backup validation rejects ambiguous accounts, unusable credentials and invalid fleet state", async (t) => {
  const mutations = [
    [
      "unsupported format",
      (b) => {
        b.format = "fleet-data";
      },
    ],
    [
      "unsupported version",
      (b) => {
        b.version = 2;
      },
    ],
    [
      "duplicate account ID",
      (b) => {
        b.users[1].id = b.users[0].id;
      },
    ],
    [
      "duplicate username",
      (b) => {
        b.users[1].username = b.users[0].username;
      },
    ],
    [
      "invalid username",
      (b) => {
        b.users[0].username = "UPPER CASE";
      },
    ],
    [
      "non-integer ID",
      (b) => {
        b.users[0].id = 1.5;
      },
    ],
    [
      "out of range ID",
      (b) => {
        b.users[0].id = 2147483648;
      },
    ],
    [
      "unknown role",
      (b) => {
        b.users[1].role = "superadmin";
      },
    ],
    [
      "invalid active flag",
      (b) => {
        b.users[1].active = true;
      },
    ],
    [
      "no active owner",
      (b) => {
        b.users[0].active = 0;
      },
    ],
    [
      "invalid salt",
      (b) => {
        b.users[0].salt = "not-hex";
      },
    ],
    [
      "invalid hash",
      (b) => {
        b.users[0].hash = "ab";
      },
    ],
    [
      "duplicate setting",
      (b) => {
        b.settings.push(b.settings[0]);
      },
    ],
    [
      "non-string setting",
      (b) => {
        b.settings[0].value = {};
      },
    ],
    [
      "missing fleet",
      (b) => {
        b.settings = b.settings.filter((s) => s.key !== "fleetName");
      },
    ],
    [
      "missing state",
      (b) => {
        b.settings = b.settings.filter((s) => s.key !== "state");
      },
    ],
    [
      "malformed state",
      (b) => {
        b.settings.find((s) => s.key === "state").value = "{";
      },
    ],
    [
      "negative revision",
      (b) => {
        b.settings.find((s) => s.key === "state").value = JSON.stringify({
          ...emptyState(),
          revision: -1,
        });
      },
    ],
    [
      "invalid collection",
      (b) => {
        b.settings.find((s) => s.key === "state").value = JSON.stringify({
          ...emptyState(),
          tyres: {},
        });
      },
    ],
    [
      "invalid record",
      (b) => {
        b.settings.find((s) => s.key === "state").value = JSON.stringify({
          ...emptyState(),
          vehicles: [null],
        });
      },
    ],
  ];
  const original = fixtureBackup();
  for (const [name, mutate] of mutations)
    await t.test(name, async () => {
      const backup = structuredClone(original);
      mutate(backup);
      let transaction = false;
      await assert.rejects(
        importDatabaseBackup(
          {
            kind: "postgres",
            transaction: async () => {
              transaction = true;
            },
          },
          backup,
        ),
        /invalid or unsupported/,
      );
      assert.equal(transaction, false);
    });
});

test("every change to a seeded destination blocks import before any deletion", async (t) => {
  const mutations = [
    [
      "changed password",
      (u) => {
        u[0].hash = "a".repeat(128);
      },
    ],
    [
      "changed salt",
      (u) => {
        u[0].salt = "b".repeat(32);
      },
    ],
    [
      "changed username",
      (u) => {
        u[0].username = "other.admin";
      },
    ],
    [
      "changed owner ID",
      (u) => {
        u[0].id = 2;
      },
    ],
    [
      "removed owner",
      (u) => {
        u[0].active = 0;
      },
    ],
    [
      "additional account",
      (u) => {
        u.push({ ...u[0], id: 2, username: "staff" });
      },
    ],
    [
      "changed fleet",
      (_u, s) => {
        s[1].value = "Other fleet";
      },
    ],
    [
      "changed revision",
      (_u, s) => {
        s[0].value = JSON.stringify({ ...emptyState(), revision: 1 });
      },
    ],
    [
      "fleet records",
      (_u, s) => {
        s[0].value = JSON.stringify({
          ...emptyState(),
          tyres: [{ id: "existing" }],
        });
      },
    ],
    [
      "extra state data",
      (_u, s) => {
        s[0].value = JSON.stringify({ ...emptyState(), unknown: true });
      },
    ],
    [
      "branding",
      (_u, s) => {
        s.push({ key: "branding", value: "{}" });
      },
    ],
    [
      "previous import marker",
      (_u, s) => {
        s.push({ key: RECOVERY_MARKER_KEY, value: "" });
      },
    ],
  ];
  const source = fixtureBackup();
  for (const [name, mutate] of mutations)
    await t.test(name, async () => {
      const users = [{ id: 1, ...defaultOwner, role: "owner", active: 1 }];
      const settings = [
        { key: "state", value: JSON.stringify(emptyState()) },
        { key: "fleetName", value: defaultFleetName },
      ];
      mutate(users, settings);
      let writes = 0;
      const store = {
        kind: "postgres",
        transaction: (operation) =>
          operation({
            all: async (sql) => (sql.includes("FROM users") ? users : settings),
            run: async () => {
              writes++;
            },
            get: async () => {
              writes++;
            },
          }),
      };
      await assert.rejects(
        importDatabaseBackup(store, source),
        /not a pristine/,
      );
      assert.equal(writes, 0);
    });
});

test("CLI failures do not print connection credentials or backup account contents", (t) => {
  const result = spawnSync(
    process.execPath,
    ["server/backup-postgres.js", path.join(directory(t), "backup.json")],
    {
      cwd: project,
      env: { ...process.env, DATABASE_URL: "not-a-url-CONNECTION_SECRET" },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(
    `${result.stdout}${result.stderr}`.includes("CONNECTION_SECRET"),
    false,
  );
  assert.match(result.stderr, /PostgreSQL connection URL/);
});

// Only child databases created by this fixture are changed or dropped. The
// database named in TEST_DATABASE_URL is used solely for CREATE/DROP DATABASE.
async function postgresFixture(t) {
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error(
      "TEST_DATABASE_URL must refer to disposable loopback PostgreSQL",
    );
  const { default: pg } = await import("pg");
  const admin = new pg.Pool({
    connectionString: url.toString(),
    ssl: false,
    max: 1,
  });
  const name = `tyre_recovery_${process.pid}_${randomBytes(6).toString("hex")}`;
  const child = new URL(url);
  child.pathname = `/${name}`;
  const stores = [];
  let created = false;
  t.after(async () => {
    try {
      await Promise.all(stores.map((store) => store.close()));
    } finally {
      try {
        if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  });
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const makeStore = () => {
    const store = openRecoveryPostgresStore(child.toString());
    stores.push(store);
    return store;
  };
  const store = makeStore();
  await store.initialize();
  return { store, makeStore, url: child.toString() };
}

test(
  "PostgreSQL import preserves accounts, hashes, inactive staff, all settings and ID sequence; sessions are revoked",
  postgresOnly,
  async (t) => {
    const { store } = await postgresFixture(t);
    await store.run(
      "INSERT INTO sessions (hash,user_id,expires) VALUES (?,?,?)",
      "public-old-session",
      1,
      Date.now() + 100000,
    );
    await store.run(
      "INSERT INTO rate_limits (key,count,until) VALUES (?,?,?)",
      "public-old-rate",
      5,
      Date.now() + 100000,
    );
    const backup = fixtureBackup();
    await importDatabaseBackup(store, backup);
    const restored = await createDatabaseBackup(store);
    assert.deepEqual(restored.users, backup.users);
    assert.deepEqual(
      restored.settings
        .filter((s) => s.key !== RECOVERY_MARKER_KEY)
        .sort((a, b) => a.key.localeCompare(b.key)),
      [...backup.settings].sort((a, b) => a.key.localeCompare(b.key)),
    );
    for (const user of restored.users)
      assert.equal(
        scryptSync(password, user.salt, 64).toString("hex") === user.hash,
        true,
      );
    assert.equal(
      Number((await store.get("SELECT COUNT(*) AS n FROM sessions")).n),
      0,
    );
    assert.equal(
      Number((await store.get("SELECT COUNT(*) AS n FROM rate_limits")).n),
      0,
    );
    const inserted = await store.get(
      "INSERT INTO users (username,salt,hash,role) VALUES (?,?,?,?) RETURNING id",
      "sequence.staff",
      backup.users[1].salt,
      backup.users[1].hash,
      "staff",
    );
    assert.equal(inserted.id, 20);
    await assert.rejects(importDatabaseBackup(store, backup), /not a pristine/);
  },
);

test(
  "PostgreSQL import rolls back every table if a write fails after accounts were replaced",
  postgresOnly,
  async (t) => {
    const { store } = await postgresFixture(t);
    const before = digest(contents(await createDatabaseBackup(store)));
    const failing = {
      kind: "postgres",
      transaction: (operation) =>
        store.transaction((tx) =>
          operation({
            ...tx,
            run: async (sql, ...params) => {
              if (sql.startsWith("INSERT INTO settings"))
                throw new Error("public-injected-write-failure");
              return tx.run(sql, ...params);
            },
          }),
        ),
    };
    await assert.rejects(
      importDatabaseBackup(failing, fixtureBackup()),
      /public-injected/,
    );
    assert.equal(digest(contents(await createDatabaseBackup(store))), before);
    assert.equal(
      await store.get(
        "SELECT value FROM settings WHERE key=?",
        RECOVERY_MARKER_KEY,
      ),
      undefined,
    );
  },
);

test(
  "concurrent imports cannot overwrite even an otherwise-empty imported database",
  postgresOnly,
  async (t) => {
    const { store, makeStore } = await postgresFixture(t);
    const original = await createDatabaseBackup(store);
    const outcomes = await Promise.allSettled([
      importDatabaseBackup(store, original),
      importDatabaseBackup(makeStore(), original),
    ]);
    assert.equal(
      outcomes.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = outcomes.find((result) => result.status === "rejected");
    assert.match(rejected.reason.message, /not a pristine/);
    assert.ok(
      await store.get(
        "SELECT value FROM settings WHERE key=?",
        RECOVERY_MARKER_KEY,
      ),
    );
  },
);

test(
  "PostgreSQL backup accounts and fleet revision cannot straddle a concurrent writer",
  postgresOnly,
  async (t) => {
    const { store, makeStore } = await postgresFixture(t);
    const writer = makeStore();
    let signalRead, releaseRead;
    const read = new Promise((resolve) => {
      signalRead = resolve;
    });
    const release = new Promise((resolve) => {
      releaseRead = resolve;
    });
    const reader = {
      transaction: (operation) =>
        store.transaction((tx) =>
          operation({
            ...tx,
            all: async (sql, ...params) => {
              const rows = await tx.all(sql, ...params);
              if (sql.includes("FROM users")) {
                signalRead();
                await release;
              }
              return rows;
            },
          }),
        ),
    };
    const snapshot = createDatabaseBackup(reader);
    await read;
    let writerDone = false;
    const writing = writer.transaction(async (tx) => {
      await tx.run(
        "UPDATE users SET username=? WHERE id=?",
        "changed.owner",
        1,
      );
      await tx.run(
        "UPDATE settings SET value=? WHERE key=?",
        JSON.stringify({ ...emptyState(), revision: 1 }),
        "state",
      );
      writerDone = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(writerDone, false);
    } finally {
      releaseRead();
    }
    const old = await snapshot;
    await writing;
    assert.equal(old.users[0].username, defaultOwner.username);
    assert.equal(
      JSON.parse(old.settings.find((s) => s.key === "state").value).revision,
      0,
    );
    const current = await createDatabaseBackup(store);
    assert.equal(current.users[0].username, "changed.owner");
    assert.equal(
      JSON.parse(current.settings.find((s) => s.key === "state").value)
        .revision,
      1,
    );
  },
);

test(
  "migration, PostgreSQL backup and restore CLIs round-trip a full SQLite backup",
  postgresOnly,
  async (t) => {
    const first = await postgresFixture(t),
      second = await postgresFixture(t);
    const dir = directory(t),
      sqlite = path.join(dir, "full-sqlite-backup.sqlite"),
      json = path.join(dir, "full-database-backup.json");
    const backup = fixtureBackup();
    sqliteFile(sqlite, backup);
    const run = (script, argument, url) =>
      execFileSync(process.execPath, [`server/${script}.js`, argument], {
        cwd: project,
        env: { ...process.env, DATABASE_URL: url },
        encoding: "utf8",
        timeout: 20000,
      });
    assert.match(
      run("migrate-postgres", sqlite, first.url),
      /import completed/,
    );
    assert.match(run("backup-postgres", json, first.url), /backup completed/);
    assert.equal(statSync(json).mode & 0o777, 0o600);
    assert.match(
      run("restore-postgres", json, second.url),
      /sessions were revoked/,
    );
    const restored = await createDatabaseBackup(second.store);
    assert.deepEqual(restored.users, backup.users);
    assert.equal(
      restored.settings.find((s) => s.key === "state").value,
      backup.settings.find((s) => s.key === "state").value,
    );
    assert.equal(
      restored.settings.find((s) => s.key === "branding").value,
      backup.settings.find((s) => s.key === "branding").value,
    );
  },
);
