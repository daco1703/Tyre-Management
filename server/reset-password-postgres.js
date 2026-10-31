import { randomBytes, scryptSync } from "node:crypto";
import { createRuntime } from "./runtime.js";

const name = process.argv[2]?.trim().toLowerCase();
const password = process.env.FLEET_ADMIN_PASSWORD;
if (
  (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) ||
  !name ||
  !password ||
  password.length < 10 ||
  password.length > 128
) {
  console.error(
    "Set DATABASE_URL and FLEET_ADMIN_PASSWORD securely, then run npm run reset-password:postgres -- <username>.",
  );
  process.exit(1);
}
const { store } = createRuntime({ serverless: true });
try {
  await store.transaction(async (tx) => {
    const user = await tx.get(
      "SELECT id FROM users WHERE username=? AND active=1",
      name,
    );
    if (!user) throw new Error("Active user not found");
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    await tx.run(
      "UPDATE users SET salt=?,hash=? WHERE id=?",
      salt,
      hash,
      user.id,
    );
    await tx.run("DELETE FROM sessions WHERE user_id=?", user.id);
  });
  console.log("Password reset; all sessions for this user have been revoked.");
} catch {
  console.error(
    "Password reset failed. Check the connection and active username.",
  );
  process.exitCode = 1;
} finally {
  await store.close();
}
