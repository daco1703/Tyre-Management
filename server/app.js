import express from "express";
import { defaultOwner } from "./default-owner.js";
import { defaultFleetName } from "../shared/defaults.js";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { normalizePublicOrigin } from "./config.js";
import { emptyState, applyAction, AppError } from "../shared/model.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const passwordHash = (password, salt) =>
  scryptSync(password, salt, 64).toString("hex");
const validPassword = (p) =>
  typeof p === "string" && p.length >= 10 && p.length <= 128;
const username = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
export function createApp({
  dbPath = "./data/tyresaathi.sqlite",
  production = false,
  trustProxy = false,
  publicOrigin = "",
} = {}) {
  const websiteOrigin = normalizePublicOrigin(publicOrigin);
  if (dbPath !== ":memory:")
    mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  if (!db.prepare("SELECT value FROM settings WHERE key=?").get("state"))
    db.prepare("INSERT INTO settings VALUES (?,?)").run(
      "state",
      JSON.stringify(emptyState()),
    );
  const setting = (key) =>
    db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value;
  const save = (key, value) =>
    db.prepare("INSERT OR REPLACE INTO settings VALUES (?,?)").run(key, value);
  // Seed exactly once. Never reset a changed password or replace existing owners.
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n === 0) {
      db.prepare(
        "INSERT INTO users (username,salt,hash,role) VALUES (?,?,?,?)",
      ).run(
        defaultOwner.username,
        defaultOwner.salt,
        defaultOwner.hash,
        "owner",
      );
      if (!setting("fleetName")) save("fleetName", defaultFleetName);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }
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
        origin !== websiteOrigin &&
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
  app.use("/api", (req, res, next) => {
    if (
      req.method === "POST" &&
      (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    )
      return res.status(400).json({ error: "invalidJson" });
    next();
  });
  const attempts = new Map();
  const authLimit = (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of attempts)
      if (value.until < now) attempts.delete(key);
    const key = req.ip;
    const a = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    a.count++;
    attempts.set(key, a);
    if (a.count > 30) return res.status(429).json({ error: "tooManyAttempts" });
    next();
  };
  const issueSession = (req, res, user, extras = {}) => {
    db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
      digest(token),
      user.id,
      Date.now() + 7 * 86400000,
    );
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
      fleetName: setting("fleetName"),
      ...(native ? { token } : {}),
      ...extras,
    });
  };
  const auth = (req, res, next) => {
    const bearer = req
      .get("authorization")
      ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const cookie = req
      .get("cookie")
      ?.match(/(?:^|;\s*)tyresaathi_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const token = bearer || cookie;
    if (!token) return res.status(401).json({ error: "unauthorized" });
    const u = db
      .prepare(
        "SELECT u.id,u.username,u.role,s.hash FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires>? AND u.active=1",
      )
      .get(digest(token), Date.now());
    if (!u) return res.status(401).json({ error: "unauthorized" });
    req.user = u;
    next();
  };
  const owner = (req, res, next) =>
    req.user.role === "owner"
      ? next()
      : res.status(403).json({ error: "ownerOnly" });
  app.get("/api/branding", (req, res) =>
    res.json(JSON.parse(setting("branding") || "{}")),
  );
  app.post("/api/branding", auth, owner, (req, res) => {
    const branding = JSON.parse(setting("branding") || "{}");
    for (const key of ["logo", "banner"]) {
      if (req.body[key] === undefined) continue;
      if (req.body[key] === null) {
        delete branding[key];
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
      branding[key] = req.body[key];
    }
    save("branding", JSON.stringify(branding));
    res.json(branding);
  });
  app.get("/api/health", (req, res) =>
    res.json({ ok: true, version: "1.8.1" }),
  );
  app.get("/api/bootstrap", (req, res) => res.json({ setupRequired: false }));
  app.post("/api/login", authLimit, (req, res) => {
    const name = username(req.body.username),
      password = req.body.password;
    if (typeof password !== "string" || password.length > 128)
      throw new AppError("loginFailed", 401);
    const user = db
      .prepare("SELECT * FROM users WHERE username=? AND active=1")
      .get(name);
    const hash = passwordHash(
      password,
      user?.salt || "invalid-user-timing-salt",
    );
    if (
      !user ||
      !timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.hash, "hex"))
    )
      throw new AppError("loginFailed", 401);
    issueSession(req, res, user);
  });
  app.get("/api/me", auth, (req, res) =>
    res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
      },
      fleetName: setting("fleetName"),
    }),
  );
  app.post("/api/logout", auth, (req, res) => {
    db.prepare("DELETE FROM sessions WHERE hash=?").run(req.user.hash);
    res.clearCookie("tyresaathi_session", {
      path: "/",
      secure: production,
      httpOnly: true,
      sameSite: "strict",
    });
    res.json({ ok: true });
  });
  // Each connected phone waits for the next committed revision. Mutations wake
  // all waiting clients immediately; timeouts re-check access and keep it live.
  const waiting = new Set();
  const stateNow = () => JSON.parse(setting("state"));
  function finish(client) {
    if (!waiting.delete(client)) return;
    clearTimeout(client.timer);
    if (client.res.destroyed) return;
    const valid = db
      .prepare(
        "SELECT s.hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>? AND u.active=1",
      )
      .get(client.req.user.hash, Date.now());
    if (!valid) client.res.status(401).json({ error: "unauthorized" });
    else client.res.json(stateNow());
  }
  function notify() {
    for (const client of [...waiting]) finish(client);
  }
  app.get("/api/updates", auth, (req, res) => {
    const revision = Number(req.query.revision);
    if (
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      !/^\d+$/.test(String(req.query.revision))
    )
      throw new AppError("invalidJson");
    const state = stateNow();
    if (revision !== state.revision) return res.json(state);
    const client = { req, res, timer: null };
    waiting.add(client);
    client.timer = setTimeout(() => finish(client), 10000);
    res.on("close", () => {
      waiting.delete(client);
      clearTimeout(client.timer);
    });
  });
  app.get("/api/state", auth, (req, res) =>
    res.json(JSON.parse(setting("state"))),
  );
  app.post("/api/actions", auth, (req, res) => {
    if (
      ["addVehicle", "importVehicles", "sellVehicle"].includes(req.body.kind) &&
      req.user.role !== "owner"
    )
      throw new AppError("ownerOnly", 403);
    db.exec("BEGIN IMMEDIATE");
    try {
      const state = JSON.parse(setting("state"));
      if (req.body.revision !== state.revision)
        throw new AppError("staleData", 409);
      const updated = applyAction(state, req.body, req.user.username);
      save("state", JSON.stringify(updated));
      db.exec("COMMIT");
      notify();
      res.json(updated);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
  app.get("/api/team", auth, owner, (req, res) =>
    res.json(
      db.prepare("SELECT id,username,role,active FROM users ORDER BY id").all(),
    ),
  );
  app.post("/api/team/create", auth, owner, authLimit, (req, res) => {
    const name = username(req.body.username),
      password = req.body.password;
    if (!/^[a-z0-9_.-]{3,40}$/.test(name) || !validPassword(password))
      throw new AppError("invalidCredentials");
    if (db.prepare("SELECT id FROM users WHERE username=?").get(name))
      throw new AppError("usernameTaken", 409);
    const salt = randomBytes(16).toString("hex");
    const result = db
      .prepare("INSERT INTO users (username,salt,hash,role) VALUES (?,?,?,?)")
      .run(name, salt, passwordHash(password, salt), "staff");
    res.status(201).json({
      id: Number(result.lastInsertRowid),
      username: name,
      role: "staff",
      active: 1,
    });
  });
  app.post("/api/team/deactivate", auth, owner, (req, res) => {
    const id = Number(req.body.id);
    const result = db
      .prepare("UPDATE users SET active=0 WHERE id=? AND role='staff'")
      .run(id);
    if (!result.changes) throw new AppError("userMissing");
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    notify();
    res.json({ ok: true });
  });
  app.post("/api/password", auth, authLimit, (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
    if (
      typeof req.body.currentPassword !== "string" ||
      req.body.currentPassword.length > 128 ||
      !validPassword(req.body.password)
    )
      throw new AppError("invalidCredentials");
    const hash = passwordHash(req.body.currentPassword, user.salt);
    if (
      !timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.hash, "hex"))
    )
      throw new AppError("loginFailed", 401);
    const salt = randomBytes(16).toString("hex");
    db.prepare("UPDATE users SET salt=?,hash=? WHERE id=?").run(
      salt,
      passwordHash(req.body.password, salt),
      user.id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=? AND hash<>?").run(
      user.id,
      req.user.hash,
    );
    notify();
    res.json({ ok: true });
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
    console.error("Request failed:", err.message);
    res.status(500).json({ error: "serverError" });
  });
  return { app, db };
}
