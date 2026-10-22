import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
const source = process.env.DATABASE_PATH || "./data/tyresaathi.sqlite";
const username = process.argv[2]?.trim().toLowerCase();
const password = process.env.FLEET_ADMIN_PASSWORD;
if (
  !existsSync(source) ||
  !username ||
  !password ||
  password.length < 10 ||
  password.length > 128
) {
  console.error(
    "Usage: set FLEET_ADMIN_PASSWORD securely (10–128 characters), then node server/reset-password.js <username>. DATABASE_PATH defaults to ./data/tyresaathi.sqlite.",
  );
  process.exit(1);
}
const db = new DatabaseSync(source);
try {
  const user = db
    .prepare("SELECT id FROM users WHERE username=? AND active=1")
    .get(username);
  if (!user) throw Error("Active user not found");
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE users SET salt=?,hash=? WHERE id=?").run(
      salt,
      hash,
      user.id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  console.log("Password reset; all sessions for this user have been revoked.");
} finally {
  db.close();
}
