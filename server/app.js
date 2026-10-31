import express from "express";
import { createSqliteStore } from "./storage/sqlite.js";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { normalizePublicOrigin } from "./config.js";
import { applyAction, AppError } from "../shared/model.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const passwordHash = (password, salt) =>
  scryptSync(password, salt, 64).toString("hex");
const validPassword = (p) =>
  typeof p === "string" && p.length >= 10 && p.length <= 128;
const username = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
const setting = async (tx, key) =>
  (await tx.get("SELECT value FROM settings WHERE key=?", key))?.value;
const save = (tx, key, value) =>
  tx.run(
    "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    key,
    value,
  );
const sessionUser = (tx, hash) =>
  tx.get(
    "SELECT u.id,u.username,u.role,s.hash FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires>? AND u.active=1",
    hash,
    Date.now(),
  );

export function createApp({
  dbPath = "./data/tyresaathi.sqlite",
  production = false,
  trustProxy = false,
  publicOrigin = "",
  additionalPublicOrigins = [],
  store: providedStore = null,
  serverless = false,
} = {}) {
  if (serverless && !providedStore)
    throw new Error("Serverless hosting requires external database storage");
  const websiteOrigins = new Set(
    [publicOrigin, ...additionalPublicOrigins]
      .map(normalizePublicOrigin)
      .filter(Boolean),
  );
  const store = providedStore || createSqliteStore(dbPath);
  const distributed = serverless || store.kind === "postgres";
  const app = express();
  app.disable("x-powered-by");
  if (trustProxy) app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-Frame-Options", "DENY");
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: http://localhost:*; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    const origin = req.get("origin");
    const native = ["https://localhost", "capacitor://localhost"].includes(
      origin,
    );
    if (native) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(native ? 204 : 403);
    if (req.path.startsWith("/api/")) {
      res.set("Cache-Control", "no-store");
      if (
        req.method === "POST" &&
        origin &&
        !native &&
        !websiteOrigins.has(origin) &&
        origin !== `${req.protocol}://${req.get("host")}`
      )
        return res.status(403).json({ error: "originDenied" });
      if (req.method === "POST" && !req.is("application/json"))
        return res.status(415).json({ error: "jsonRequired" });
    }
    next();
  });
  app.use("/api/branding", express.json({ limit: "3mb" }));
  app.use(express.json({ limit: "256kb" }));
  app.use("/api", async (req, res, next) => {
    if (
      req.method === "POST" &&
      (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    )
      return res.status(400).json({ error: "invalidJson" });
    try {
      await store.initialize();
    } catch {
      return res.status(503).json({ error: "databaseUnavailable" });
    }
    next();
  });

  const authLimit = async (req, res, next) => {
    const now = Date.now();
    // Stored in the database so separate Vercel instances share the limit.
    const key = digest(`auth:${req.ip || "unknown"}`);
    const allowed = await store.transaction(async (tx) => {
      await tx.run("DELETE FROM rate_limits WHERE until < ?", now);
      const prior = await tx.get(
        "SELECT count,until FROM rate_limits WHERE key=?",
        key,
      );
      const count = (prior?.count || 0) + 1;
      await tx.run(
        "INSERT INTO rate_limits (key,count,until) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,until=excluded.until",
        key,
        count,
        Number(prior?.until || now + 15 * 60 * 1000),
      );
      return count <= 30;
    });
    if (!allowed) return res.status(429).json({ error: "tooManyAttempts" });
    next();
  };
  const auth = async (req, res, next) => {
    const bearer = req
      .get("authorization")
      ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const cookie = req
      .get("cookie")
      ?.match(/(?:^|;\s*)tyresaathi_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const token = bearer || cookie;
    if (!token) return res.status(401).json({ error: "unauthorized" });
    const user = await sessionUser(store, digest(token));
    if (!user) return res.status(401).json({ error: "unauthorized" });
    req.user = user;
    next();
  };
  const owner = (req, res, next) =>
    req.user.role === "owner"
      ? next()
      : res.status(403).json({ error: "ownerOnly" });
  const freshUser = async (tx, req, ownerOnly = false) => {
    // Every write repeats this inside its database transaction. Revoked or
    // expired sessions cannot keep writing from a different warm instance.
    const user = await sessionUser(tx, req.user.hash);
    if (!user) throw new AppError("unauthorized", 401);
    if (ownerOnly && user.role !== "owner")
      throw new AppError("ownerOnly", 403);
    return user;
  };
  const issueSession = (req, res, user, token, fleetName) => {
    res.cookie("tyresaathi_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: production,
      maxAge: 7 * 86400000,
      path: "/",
    });
    const native = ["https://localhost", "capacitor://localhost"].includes(
      req.get("origin"),
    );
    res.json({
      user: { id: user.id, username: user.username, role: user.role },
      fleetName,
      ...(native ? { token } : {}),
    });
  };

  app.get("/api/health", async (req, res) => {
    try {
      await store.get("SELECT 1 AS ok");
      res.json({ ok: true, version: "1.9.0" });
    } catch {
      res.status(503).json({ ok: false, error: "databaseUnavailable" });
    }
  });
  app.get("/api/bootstrap", (req, res) =>
    res.json({
      setupRequired: false,
      ...(distributed ? { updatesMode: "poll", pollIntervalMs: 5000 } : {}),
    }),
  );
  app.post("/api/login", authLimit, async (req, res) => {
    const name = username(req.body.username),
      password = req.body.password;
    if (typeof password !== "string" || password.length > 128)
      throw new AppError("loginFailed", 401);
    const token = randomBytes(32).toString("hex");
    const result = await store.transaction(async (tx) => {
      const user = await tx.get(
        "SELECT * FROM users WHERE username=? AND active=1",
        name,
      );
      const hash = passwordHash(
        password,
        user?.salt || "invalid-user-timing-salt",
      );
      if (
        !user ||
        !timingSafeEqual(
          Buffer.from(hash, "hex"),
          Buffer.from(user.hash, "hex"),
        )
      )
        throw new AppError("loginFailed", 401);
      await tx.run("DELETE FROM sessions WHERE expires < ?", Date.now());
      await tx.run(
        "INSERT INTO sessions (hash,user_id,expires) VALUES (?,?,?)",
        digest(token),
        user.id,
        Date.now() + 7 * 86400000,
      );
      return { user, fleetName: await setting(tx, "fleetName") };
    });
    issueSession(req, res, result.user, token, result.fleetName);
  });
  app.get("/api/me", auth, async (req, res) =>
    res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
      },
      fleetName: await setting(store, "fleetName"),
    }),
  );
  app.post("/api/logout", auth, async (req, res) => {
    await store.transaction(async (tx) => {
      await freshUser(tx, req);
      await tx.run("DELETE FROM sessions WHERE hash=?", req.user.hash);
    });
    res.clearCookie("tyresaathi_session", {
      path: "/",
      secure: production,
      httpOnly: true,
      sameSite: "strict",
    });
    res.json({ ok: true });
  });

  // Long-running SQLite installations retain immediate in-process updates.
  // PostgreSQL/Vercel reads authoritative committed state on every request.
  const waiting = new Set();
  const stateNow = async (tx = store) => JSON.parse(await setting(tx, "state"));
  async function finish(client) {
    if (!waiting.delete(client)) return;
    clearTimeout(client.timer);
    if (client.res.destroyed) return;
    try {
      if (!(await sessionUser(store, client.req.user.hash)))
        client.res.status(401).json({ error: "unauthorized" });
      else client.res.json(await stateNow());
    } catch {
      if (!client.res.destroyed)
        client.res.status(503).json({ error: "databaseUnavailable" });
    }
  }
  function notify() {
    for (const client of [...waiting]) void finish(client);
  }
  app.get("/api/updates", auth, async (req, res) => {
    const revision = Number(req.query.revision);
    if (
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      !/^\d+$/.test(String(req.query.revision))
    )
      throw new AppError("invalidJson");
    const state = await stateNow();
    if (revision !== state.revision || (distributed && req.query.poll === "1"))
      return res.json(state);
    if (distributed) {
      // Older APKs do not understand polling hints. Bound their unchanged
      // responses to eight seconds so they cannot spin in a hot request loop.
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          res.removeListener("close", done);
          resolve();
        };
        const timer = setTimeout(done, 8000);
        res.once("close", done);
      });
      if (res.destroyed) return;
      if (!(await sessionUser(store, req.user.hash)))
        return res.status(401).json({ error: "unauthorized" });
      return res.json(await stateNow());
    }
    const client = { req, res, timer: null };
    waiting.add(client);
    client.timer = setTimeout(() => void finish(client), 10000);
    res.on("close", () => {
      waiting.delete(client);
      clearTimeout(client.timer);
    });
  });
  app.get("/api/state", auth, async (req, res) => res.json(await stateNow()));
  app.post("/api/actions", auth, async (req, res) => {
    const updated = await store.transaction(async (tx) => {
      const user = await freshUser(tx, req);
      if (
        ["addVehicle", "importVehicles", "sellVehicle"].includes(
          req.body.kind,
        ) &&
        user.role !== "owner"
      )
        throw new AppError("ownerOnly", 403);
      const state = await stateNow(tx);
      if (req.body.revision !== state.revision)
        throw new AppError("staleData", 409);
      const next = applyAction(state, req.body, user.username);
      await save(tx, "state", JSON.stringify(next));
      return next;
    });
    notify();
    res.json(updated);
  });
  app.get("/api/team", auth, owner, async (req, res) =>
    res.json(
      await store.all("SELECT id,username,role,active FROM users ORDER BY id"),
    ),
  );
  app.post("/api/team/create", auth, owner, authLimit, async (req, res) => {
    const name = username(req.body.username),
      password = req.body.password;
    if (!/^[a-z0-9_.-]{3,40}$/.test(name) || !validPassword(password))
      throw new AppError("invalidCredentials");
    const salt = randomBytes(16).toString("hex"),
      hash = passwordHash(password, salt);
    const user = await store.transaction(async (tx) => {
      await freshUser(tx, req, true);
      if (await tx.get("SELECT id FROM users WHERE username=?", name))
        throw new AppError("usernameTaken", 409);
      return tx.get(
        "INSERT INTO users (username,salt,hash,role) VALUES (?,?,?,?) RETURNING id",
        name,
        salt,
        hash,
        "staff",
      );
    });
    res
      .status(201)
      .json({ id: Number(user.id), username: name, role: "staff", active: 1 });
  });
  app.post("/api/team/deactivate", auth, owner, async (req, res) => {
    await store.transaction(async (tx) => {
      await freshUser(tx, req, true);
      const result = await tx.run(
        "UPDATE users SET active=0 WHERE id=? AND role='staff'",
        Number(req.body.id),
      );
      if (!result.changes) throw new AppError("userMissing");
      await tx.run("DELETE FROM sessions WHERE user_id=?", Number(req.body.id));
    });
    notify();
    res.json({ ok: true });
  });
  app.post("/api/password", auth, authLimit, async (req, res) => {
    if (
      typeof req.body.currentPassword !== "string" ||
      req.body.currentPassword.length > 128 ||
      !validPassword(req.body.password)
    )
      throw new AppError("invalidCredentials");
    await store.transaction(async (tx) => {
      const session = await freshUser(tx, req);
      const user = await tx.get("SELECT * FROM users WHERE id=?", session.id);
      const hash = passwordHash(req.body.currentPassword, user.salt);
      if (
        !timingSafeEqual(
          Buffer.from(hash, "hex"),
          Buffer.from(user.hash, "hex"),
        )
      )
        throw new AppError("loginFailed", 401);
      const salt = randomBytes(16).toString("hex");
      await tx.run(
        "UPDATE users SET salt=?,hash=? WHERE id=?",
        salt,
        passwordHash(req.body.password, salt),
        user.id,
      );
      await tx.run(
        "DELETE FROM sessions WHERE user_id=? AND hash<>?",
        user.id,
        req.user.hash,
      );
    });
    notify();
    res.json({ ok: true });
  });

  app.get("/api/branding", async (req, res) =>
    res.json(JSON.parse((await setting(store, "branding")) || "{}")),
  );
  app.post("/api/branding", auth, owner, async (req, res) => {
    const patch = {};
    for (const key of ["logo", "banner"]) {
      if (req.body[key] === undefined) continue;
      if (req.body[key] === null) {
        patch[key] = null;
        continue;
      }
      if (typeof req.body[key] !== "string")
        throw new AppError("invalidBrandImage");
      const match =
        /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
          req.body[key],
        );
      if (!match) throw new AppError("invalidBrandImage");
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.length > 1024 * 1024 || bytes.toString("base64") !== match[2])
        throw new AppError("invalidBrandImage");
      const valid =
        match[1] === "png"
          ? bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
          : match[1] === "jpeg"
            ? bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))
            : bytes.toString("ascii", 0, 4) === "RIFF" &&
              bytes.toString("ascii", 8, 12) === "WEBP";
      if (!valid) throw new AppError("invalidBrandImage");
      patch[key] = req.body[key];
    }
    const branding = await store.transaction(async (tx) => {
      await freshUser(tx, req, true);
      const value = JSON.parse((await setting(tx, "branding")) || "{}");
      for (const [key, data] of Object.entries(patch)) {
        if (data === null) delete value[key];
        else value[key] = data;
      }
      await save(tx, "branding", JSON.stringify(value));
      return value;
    });
    res.json(branding);
  });
  app.use("/api", (req, res) => res.status(404).json({ error: "notFound" }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof AppError)
      return res.status(err.status).json({ error: err.code });
    if (err.type === "entity.parse.failed")
      return res.status(400).json({ error: "invalidJson" });
    if (err.type === "entity.too.large")
      return res.status(413).json({ error: "tooLarge" });
    // Provider errors may contain connection details. Never return/log them.
    console.error("Fleet request failed");
    res.status(500).json({ error: "serverError" });
  });
  return { app, db: store.db, store };
}
