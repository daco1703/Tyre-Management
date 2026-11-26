import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import path from "node:path";
const source = process.env.DATABASE_PATH || "./data/tyresaathi.sqlite";
if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
  console.error(
    "PostgreSQL is configured. Use npm run backup:postgres -- /new/path/backup.json instead of the SQLite backup command.",
  );
  process.exit(1);
}
const destination = process.argv[2];
if (!destination || !existsSync(source) || existsSync(destination)) {
  console.error(
    "Usage: DATABASE_PATH=/path/to/live.sqlite node server/backup.js /new/path/backup.sqlite\nSource must exist; destination must not already exist.",
  );
  process.exit(1);
}
mkdirSync(path.dirname(destination), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try {
  const previousMask = process.umask(0o077);
  try {
    await backup(db, destination);
  } finally {
    process.umask(previousMask);
  }
  chmodSync(destination, 0o600);
  // Strip notification credentials and consent only from the completed COPY.
  // The source database, fleet records and accounts are never changed here.
  const copy = new DatabaseSync(destination);
  try {
    copy.exec("PRAGMA secure_delete=ON");
    copy
      .prepare("DELETE FROM settings WHERE key=?")
      .run("notificationRegistry");
    copy.exec("VACUUM; PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    copy.close();
  }
  console.log(
    "Database backup completed. Store it outside the server as well.",
  );
} finally {
  db.close();
}
