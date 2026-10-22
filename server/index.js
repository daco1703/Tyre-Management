import { createApp } from "./app.js";
import express from "express";
import path from "node:path";
import { deploymentOptions } from "./config.js";
const production = process.env.NODE_ENV === "production";
const dbPath = process.env.DATABASE_PATH || "./data/tyresaathi.sqlite";
const { app, db } = createApp({
  dbPath,
  production,
  ...deploymentOptions(process.env),
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
    `Shepards Tyre Management ${production ? "production" : "development"} server listening on port ${process.env.PORT || 3000}`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
