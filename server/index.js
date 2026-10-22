import { createApp } from "./app.js";
import express from "express";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const production = process.env.NODE_ENV === "production";
const dbPath = process.env.DATABASE_PATH || "./data/tyresaathi.sqlite";
let setupKey = process.env.FLEET_SETUP_KEY || "";
if (production && !setupKey) {
  const keyPath = path.join(path.dirname(dbPath), "setup-key");
  mkdirSync(path.dirname(keyPath), { recursive: true });
  if (!existsSync(keyPath))
    writeFileSync(keyPath, randomBytes(24).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
  setupKey = readFileSync(keyPath, "utf8").trim();
}
const { app, db } = createApp({
  dbPath,
  production,
  setupKey,
  trustProxy: process.env.TRUST_PROXY === "1",
});
if (production) {
  app.use(express.static(path.resolve("dist"), { index: false }));
  app.get("/{*path}", (req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const server = app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log(
    `TyreSaathi ${production ? "production" : "development"} server listening on port ${process.env.PORT || 3000}`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
