import { createRuntime } from "./runtime.js";

// The explicit rewrite parameter also works when the platform passes its
// destination URL instead of the original URL to a Node function.
export function restoreApiPath(req) {
  const url = new URL(req.url, "http://function.internal");
  const path = url.searchParams.get("__fleetPath");
  url.searchParams.delete("__fleetPath");
  if (url.pathname === "/api/index" && path !== null) {
    if (!/^[a-zA-Z0-9/_-]*$/.test(path)) return false;
    url.pathname = `/api/${path.replace(/^\/+/, "")}`;
  }
  req.url = `${url.pathname}${url.search}`;
  return true;
}

export function createVercelHandler({
  env = process.env,
  runtimeFactory = createRuntime,
} = {}) {
  let runtime;
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (["https://localhost", "capacitor://localhost"].includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        return res.end();
      }
    }
    try {
      if (!restoreApiPath(req)) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: "invalidRequest" }));
      }
      runtime ||= runtimeFactory({ env, serverless: true });
      await runtime.store.initialize();
      await new Promise((resolve, reject) => {
        const done = () => {
          res.removeListener("finish", done);
          res.removeListener("close", done);
          resolve();
        };
        res.once("finish", done);
        res.once("close", done);
        try {
          runtime.app(req, res);
        } catch (error) {
          res.removeListener("finish", done);
          res.removeListener("close", done);
          reject(error);
        }
      });
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          error:
            error.code === "databaseNotConfigured"
              ? "databaseNotConfigured"
              : "databaseUnavailable",
          version: "1.9.0",
        }),
      );
    }
  };
}
