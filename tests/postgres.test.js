import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const postgresOnly = { skip: !enabled, timeout: 45000 };
const username = "pg_test_owner";
const password = "pg-public-test-password-123";
const publicOrigin = "https://www.shepards-tyre-management.com";
const tyre = (serial) => ({
  serial,
  brand: "MRF",
  type: "new",
  construction: "radial",
});

// These integration tests need a disposable LOCAL PostgreSQL instance and a
// CREATEDB test role. Each test creates and drops its own random child database;
// the database named in TEST_DATABASE_URL is never initialized or mutated.
async function fixture(t, { frontend = false } = {}) {
  const controlUrl = new URL(process.env.TEST_DATABASE_URL);
  if (
    !["postgres:", "postgresql:"].includes(controlUrl.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(controlUrl.hostname)
  ) {
    throw new Error(
      "TEST_DATABASE_URL must use a disposable localhost PostgreSQL instance",
    );
  }
  const [
    { default: pg },
    { createApp },
    { createPostgresStore },
    { createVercelHandler },
  ] = await Promise.all([
    import("pg"),
    import("../server/app.js"),
    import("../server/storage/postgres.js"),
    import("../server/vercel-handler.js"),
  ]);
  const databaseName = `tyre_it_${process.pid}_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Pool({
    connectionString: controlUrl.toString(),
    ssl: false,
    max: 1,
  });
  const poolErrors = [];
  admin.on("error", (error) =>
    poolErrors.push(error.code || "admin-pool-error"),
  );
  const childUrl = new URL(controlUrl);
  childUrl.pathname = `/${databaseName}`;
  let created = false,
    control;
  const clients = new Set(),
    stores = new Set();
  t.after(async () => {
    const cleanup = [];
    try {
      cleanup.push(
        ...(await Promise.allSettled(
          [...clients].map((client) => client.close()),
        )),
      );
      cleanup.push(
        ...(await Promise.allSettled(
          [...stores].map((store) => store.close()),
        )),
      );
      if (control) cleanup.push(...(await Promise.allSettled([control.end()])));
    } finally {
      try {
        if (created) {
          // pg.Pool.end() can resolve before PostgreSQL finishes processing the
          // sockets' graceful disconnect. Do not FORCE-kill those closing test
          // connections, which can emit a misleading 57P01 idle-pool error.
          for (let attempt = 0; attempt < 50; attempt++) {
            try {
              await admin.query(`DROP DATABASE "${databaseName}"`);
              break;
            } catch (error) {
              if (error.code !== "55006" || attempt === 49) throw error;
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          }
        }
      } finally {
        await admin.end();
      }
    }
    const failures = cleanup
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length)
      throw new AggregateError(failures, "PostgreSQL test cleanup failed");
    assert.deepEqual(
      poolErrors,
      [],
      "Unexpected PostgreSQL test control-pool error",
    );
  });
  // The identifier contains only our constant prefix, process ID and random hex.
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  control = new pg.Pool({
    connectionString: childUrl.toString(),
    ssl: false,
    max: 1,
  });
  control.on("error", (error) =>
    poolErrors.push(error.code || "control-pool-error"),
  );
  const makeStore = () => {
    const store = createPostgresStore({
      connectionString: childUrl.toString(),
      ssl: false,
      max: 2,
    });
    stores.add(store);
    return store;
  };
  const firstStore = makeStore(),
    secondStore = makeStore();
  // Two cold instances must initialize the same fleet atomically, once.
  await Promise.all([firstStore.initialize(), secondStore.initialize()]);
  assert.equal(
    Number((await control.query("SELECT COUNT(*) AS n FROM users")).rows[0].n),
    1,
  );
  assert.equal(
    Number(
      (
        await control.query(
          "SELECT COUNT(*) AS n FROM settings WHERE key='state'",
        )
      ).rows[0].n,
    ),
    1,
  );
  // Override only the new, isolated test owner's credentials. No production
  // password or default-owner hash is read or printed by this suite.
  const salt = "public-pg-test-only-salt";
  await control.query(
    "UPDATE users SET username=$1,salt=$2,hash=$3 WHERE role='owner'",
    [username, salt, scryptSync(password, salt, 64).toString("hex")],
  );

  async function start(store = makeStore(), { frontend = false } = {}) {
    await store.initialize();
    const runtime = createApp({
      store,
      serverless: true,
      production: true,
      trustProxy: true,
      publicOrigin,
    });
    const handler = createVercelHandler({
      env: { VERCEL: "1", DATABASE_URL: childUrl.toString() },
      runtimeFactory: () => runtime,
    });
    let listener = handler;
    if (frontend) {
      const { default: express } = await import("express");
      const staticApp = express();
      const dist = fileURLToPath(new URL("../dist", import.meta.url));
      staticApp.use(express.static(dist, { index: false }));
      staticApp.get("/{*path}", (req, res) =>
        res.sendFile(join(dist, "index.html")),
      );
      listener = (req, res) => {
        const url = new URL(req.url, "http://isolated-test.internal");
        if (!url.pathname.startsWith("/api/")) return staticApp(req, res);
        // Exercise the platform's rewritten destination for real browser calls.
        const apiPath = url.pathname.slice("/api/".length);
        url.pathname = "/api/index";
        url.searchParams.set("__fleetPath", apiPath);
        req.url = url.pathname + url.search;
        return handler(req, res);
      };
    }
    const server = await new Promise((resolve) => {
      const listening = createServer(listener).listen(0, "127.0.0.1", () =>
        resolve(listening),
      );
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    let closed = false;
    const client = {
      store,
      base,
      async close() {
        if (closed) return;
        closed = true;
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await store.close();
      },
      async req(route, body, cookie, extraHeaders = {}) {
        const response = await fetch(base + "/api" + route, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...(cookie ? { Cookie: cookie } : {}),
            ...extraHeaders,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(8000),
        });
        return {
          status: response.status,
          data: await response.json(),
          cookie: response.headers.get("set-cookie")?.split(";")[0],
          headers: response.headers,
        };
      },
    };
    clients.add(client);
    return client;
  }
  const [a, b] = await Promise.all([
    start(firstStore, { frontend }),
    start(secondStore, { frontend }),
  ]);
  const login = async (
    client = a,
    name = username,
    secret = password,
    native = false,
  ) => {
    const result = await client.req(
      "/login",
      { username: name, password: secret },
      null,
      {
        Origin: native ? "https://localhost" : publicOrigin,
        "X-Forwarded-Proto": "https",
      },
    );
    assert.equal(result.status, 200);
    return result;
  };
  return { a, b, login, start, control };
}

test("Vercel without a configured external database returns JSON 503 and never creates a fallback SQLite file", async (t) => {
  const { createVercelHandler } = await import("../server/vercel-handler.js");
  const directory = mkdtempSync(join(tmpdir(), "tyre-vercel-missing-db-"));
  const fallback = join(directory, "must-not-create.sqlite");
  const handler = createVercelHandler({
    env: { VERCEL: "1", DATABASE_PATH: fallback },
  });
  const server = await new Promise((resolve) => {
    const listening = createServer(handler).listen(0, "127.0.0.1", () =>
      resolve(listening),
    );
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  for (const route of ["/api/health", "/api/index?__fleetPath=bootstrap"]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 503);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "databaseNotConfigured");
  }
  const preflight = await fetch(base + "/api/index?__fleetPath=login", {
    method: "OPTIONS",
    headers: {
      Origin: "https://localhost",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "https://localhost",
  );
  assert.match(
    preflight.headers.get("access-control-allow-headers"),
    /Authorization/,
  );
  assert.equal(existsSync(fallback), false);
  assert.equal(existsSync(fallback + "-wal"), false);
});

test("a warm Vercel handler retries database initialization after a transient connection failure", async (t) => {
  const { createVercelHandler } = await import("../server/vercel-handler.js");
  let initializations = 0,
    factories = 0;
  const handler = createVercelHandler({
    env: { VERCEL: "1" },
    runtimeFactory() {
      factories++;
      return {
        store: {
          async initialize() {
            initializations++;
            if (initializations === 1)
              throw new Error("isolated transient test failure");
          },
        },
        app(req, res) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, path: req.url }));
        },
      };
    },
  });
  const server = await new Promise((resolve) => {
    const listening = createServer(handler).listen(0, "127.0.0.1", () =>
      resolve(listening),
    );
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const failed = await fetch(base + "/api/index?__fleetPath=health");
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).error, "databaseUnavailable");
  const retry = await fetch(
    base + "/api/index?__fleetPath=updates&revision=7&poll=1",
  );
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), {
    ok: true,
    path: "/api/updates?revision=7&poll=1",
  });
  assert.equal(factories, 1);
  assert.equal(initializations, 2);
});

test(
  "PostgreSQL initializes once and preserves fleet, changed accounts and native sessions across cold instances",
  postgresOnly,
  async (t) => {
    const { a, b, login, start, control } = await fixture(t);
    const bootstrap = await a.req("/index?__fleetPath=bootstrap");
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.data.setupRequired, false);
    assert.equal(bootstrap.data.updatesMode, "poll");
    assert.equal(bootstrap.data.pollIntervalMs, 5000);
    const owner = await login(a);
    assert.match(owner.headers.get("set-cookie"), /Secure/);
    const added = await b.req(
      "/actions",
      {
        kind: "addVehicle",
        revision: 0,
        payload: {
          registration: "MH01PG1001",
          name: "मुंबई गैराज",
          hasSpare: true,
          odometer: 12000,
        },
      },
      owner.cookie,
    );
    assert.equal(added.status, 200);
    assert.equal(
      (await a.req("/state", undefined, owner.cookie)).data.vehicles[0].name,
      "मुंबई गैराज",
    );
    const changed = "changed-public-test-password";
    assert.equal(
      (
        await a.req(
          "/password",
          { currentPassword: password, password: changed },
          owner.cookie,
        )
      ).status,
      200,
    );
    const native = await b.req(
      "/index?__fleetPath=login",
      { username, password: changed },
      null,
      { Origin: "https://localhost" },
    );
    assert.equal(native.status, 200);
    assert.match(native.data.token, /^[a-f0-9]{64}$/);
    const nativeHeaders = {
      Origin: "https://localhost",
      Authorization: `Bearer ${native.data.token}`,
    };
    assert.equal(
      (await a.req("/me", undefined, null, nativeHeaders)).data.user.username,
      username,
    );
    await Promise.all([a.close(), b.close()]);
    const cold = await start();
    assert.equal(
      (await cold.req("/login", { username, password })).status,
      401,
    );
    await login(cold, username, changed);
    const state = await cold.req(
      "/index?__fleetPath=state",
      undefined,
      null,
      nativeHeaders,
    );
    assert.equal(state.status, 200);
    assert.equal(state.data.revision, added.data.revision);
    assert.equal(state.data.vehicles[0].registration, "MH01PG1001");
    assert.equal(
      Number(
        (await control.query("SELECT COUNT(*) AS n FROM users")).rows[0].n,
      ),
      1,
    );
  },
);

test(
  "PostgreSQL serializes revision and username races; invalid imports and vehicle sales leave no partial records",
  postgresOnly,
  async (t) => {
    const { a, b, login } = await fixture(t);
    const owner = await login(a);
    const race = await Promise.all([
      a.req(
        "/actions",
        { kind: "addTyre", revision: 0, payload: tyre("RACE-A") },
        owner.cookie,
      ),
      b.req(
        "/actions",
        { kind: "addTyre", revision: 0, payload: tyre("RACE-B") },
        owner.cookie,
      ),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    let state = (await b.req("/state", undefined, owner.cookie)).data;
    assert.equal(state.tyres.length, 1);
    assert.equal(state.events.length, 1);
    const beforeImport = structuredClone(state);
    const badImport = await a.req(
      "/actions",
      {
        kind: "importTyres",
        revision: state.revision,
        payload: {
          tyres: [
            tyre("PARTIAL-IMPORT"),
            { ...tyre("INVALID-IMPORT"), brand: "" },
          ],
        },
      },
      owner.cookie,
    );
    assert.equal(badImport.status, 400);
    assert.deepEqual(
      (await b.req("/state", undefined, owner.cookie)).data,
      beforeImport,
    );

    async function act(client, kind, payload) {
      const current = (await client.req("/state", undefined, owner.cookie))
        .data;
      const result = await client.req(
        "/actions",
        { kind, payload, revision: current.revision },
        owner.cookie,
      );
      assert.equal(result.status, 200);
      return result.data;
    }
    state = await act(a, "importTyres", {
      tyres: [tyre("SALE-ROAD"), tyre("SALE-SPARE"), tyre("KEEP-STOCK")],
    });
    state = await act(b, "addVehicle", {
      registration: "MH01PGSALE",
      hasSpare: true,
      odometer: 1000,
    });
    const vehicleId = state.vehicles[0].id;
    const roadId = state.tyres.find((t) => t.serial === "SALE-ROAD").id;
    const spareId = state.tyres.find((t) => t.serial === "SALE-SPARE").id;
    state = await act(a, "fit", {
      tyreId: roadId,
      vehicleId,
      slot: "FR",
      odometer: 1000,
    });
    state = await act(b, "fit", {
      tyreId: spareId,
      vehicleId,
      slot: "SP",
      odometer: 1000,
    });
    for (const [odometer, fitmentSnapshot, status] of [
      [999, undefined, 400],
      [1500, [], 409],
    ]) {
      const failed = await a.req(
        "/actions",
        {
          kind: "sellVehicle",
          revision: state.revision,
          payload: { vehicleId, odometer, fitmentSnapshot },
        },
        owner.cookie,
      );
      assert.equal(failed.status, status);
      assert.deepEqual(
        (await b.req("/state", undefined, owner.cookie)).data,
        state,
      );
    }
    const sold = await act(a, "sellVehicle", {
      vehicleId,
      odometer: 1500,
      fitmentSnapshot: [
        { tyreId: roadId, slot: "FR" },
        { tyreId: spareId, slot: "SP" },
      ],
      note: "Public test vehicle sale invoice",
    });
    assert.deepEqual(
      (await b.req("/state", undefined, owner.cookie)).data,
      sold,
    );
    assert.equal(sold.vehicles[0].status, "sold");
    assert.equal(sold.tyres.find((t) => t.id === roadId).distance, 500);
    assert.equal(sold.tyres.find((t) => t.id === spareId).distance, 0);
    assert.equal(sold.tyres.filter((t) => t.status === "sold").length, 2);
    assert.equal(
      sold.tyres.find((t) => t.serial === "KEEP-STOCK").status,
      "stock",
    );
    assert.equal(sold.events.filter((e) => e.kind === "sell").length, 2);
    const duplicates = await Promise.all([
      a.req(
        "/team/create",
        { username: "same_staff", password: "staff-public-password" },
        owner.cookie,
      ),
      b.req(
        "/team/create",
        { username: "same_staff", password: "staff-public-password" },
        owner.cookie,
      ),
    ]);
    assert.deepEqual(duplicates.map((r) => r.status).sort(), [201, 409]);
    assert.equal(
      (await a.req("/team", undefined, owner.cookie)).data.filter(
        (u) => u.username === "same_staff",
      ).length,
      1,
    );
  },
);

test(
  "PostgreSQL serverless polling sees other instances and immediately enforces shared staff revocation",
  postgresOnly,
  async (t) => {
    const { a, b, login } = await fixture(t);
    const owner = await login(a);
    assert.equal(
      (
        await a.req(
          "/team/create",
          { username: "pg_operator", password: "staff-public-password" },
          owner.cookie,
        )
      ).status,
      201,
    );
    const staff = await login(b, "pg_operator", "staff-public-password", true);
    const auth = {
      Origin: "https://localhost",
      Authorization: `Bearer ${staff.data.token}`,
    };
    const started = performance.now();
    const unchanged = await a.req(
      "/index?__fleetPath=updates&revision=0&poll=1",
      undefined,
      null,
      auth,
    );
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.data.revision, 0);
    assert.ok(
      performance.now() - started < 2000,
      "serverless polling held the HTTP request open",
    );
    const added = await b.req(
      "/actions",
      {
        kind: "addTyre",
        revision: 0,
        payload: { ...tyre("STAFF-PG"), actor: username },
      },
      null,
      auth,
    );
    assert.equal(added.status, 200);
    assert.equal(added.data.events[0].actor, "pg_operator");
    const update = await a.req(
      "/updates?revision=0&poll=1",
      undefined,
      owner.cookie,
    );
    assert.equal(update.status, 200);
    assert.equal(update.data.tyres[0].serial, "STAFF-PG");
    assert.equal((await b.req("/team", undefined, null, auth)).status, 403);
    assert.equal(
      (
        await b.req(
          "/actions",
          {
            kind: "addVehicle",
            revision: 1,
            payload: { registration: "NOADMIN", odometer: 0, hasSpare: false },
          },
          null,
          auth,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await a.req(
          "/team/deactivate",
          { id: staff.data.user.id },
          owner.cookie,
        )
      ).status,
      200,
    );
    assert.equal((await b.req("/me", undefined, null, auth)).status, 401);
    assert.equal(
      (await b.req("/updates?revision=1&poll=1", undefined, null, auth)).status,
      401,
    );
    assert.equal(
      (
        await b.req(
          "/actions",
          {
            kind: "addTyre",
            revision: added.data.revision,
            payload: tyre("REVOKED-MUST-NOT-SAVE"),
          },
          null,
          auth,
        )
      ).status,
      401,
    );
    assert.equal(
      (await a.req("/state", undefined, owner.cookie)).data.tyres.length,
      1,
    );
  },
);

test(
  "React clients use paced PostgreSQL serverless polling, share vehicle changes and stop polling after logout",
  {
    skip: !enabled || !process.env.BROWSER_PATH,
    timeout: 45000,
  },
  async (t) => {
    const { a, b } = await fixture(t, { frontend: true });
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      executablePath: process.env.BROWSER_PATH,
      headless: true,
      args: ["--no-sandbox"],
    });
    const errors = [],
      external = [];
    const requestTimes = [[], []];
    const pollModes = [];
    try {
      const pages = [];
      for (const [index, client] of [a, b].entries()) {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          serviceWorkers: "block",
        });
        await context.route("**/*", (route) => {
          if (new URL(route.request().url()).origin === client.base)
            return route.continue();
          external.push(route.request().url());
          return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => {
          const url = new URL(request.url());
          if (url.pathname === "/api/updates") {
            pollModes.push(url.searchParams.get("poll"));
            requestTimes[index].push(performance.now());
          }
        });
        await page.goto(client.base);
        await page.locator("input[name=username]").fill(username);
        await page.locator("input[name=password]").fill(password);
        await page
          .getByRole("button", { name: "Open my garage", exact: true })
          .click();
        await page
          .getByRole("heading", {
            name: "Your fleet, at a glance",
            exact: true,
          })
          .waitFor();
        await page
          .locator(".nav-items")
          .getByRole("button", { name: "Vehicles", exact: true })
          .click();
        pages.push(page);
      }
      for (
        let attempt = 0;
        attempt < 70 && requestTimes.some((calls) => calls.length === 0);
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(
        requestTimes.every((calls) => calls.length > 0),
        "React never started serverless update polling",
      );
      const before = requestTimes.map((calls) => calls.length);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      assert.ok(
        requestTimes.every((calls, index) => calls.length - before[index] <= 1),
        "serverless update requests are running in a hot loop",
      );

      await pages[0]
        .getByRole("button", { name: "Add vehicle", exact: true })
        .click();
      await pages[0]
        .locator("dialog input[name=registration]")
        .fill("MH01PGWEB1");
      await pages[0]
        .locator("dialog select[name=emissionClass]")
        .selectOption("BS6");
      await pages[0]
        .getByRole("button", { name: "Save record", exact: true })
        .click();
      await pages[0].locator("dialog").waitFor({ state: "detached" });
      await pages[1]
        .locator(".vehicle-card")
        .filter({ hasText: "MH01PGWEB1" })
        .waitFor({ timeout: 8000 });
      assert.ok(requestTimes[1].length >= 2);
      assert.ok(
        requestTimes[1][1] - requestTimes[1][0] >= 4500,
        "React did not respect the 5-second serverless poll interval",
      );
      const observerSession = await (
        await pages[1].request.get(b.base + "/api/me")
      ).json();
      assert.equal(observerSession.user.username, username);

      const artifacts = fileURLToPath(
        new URL("../artifacts/postgres-review", import.meta.url),
      );
      mkdirSync(artifacts, { recursive: true });
      await pages[1].screenshot({
        path: join(artifacts, "shared-vehicles.png"),
      });
      await pages[0]
        .locator(".nav-items")
        .getByRole("button", { name: "Team & settings", exact: true })
        .click();
      await pages[0]
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
      await pages[0].locator("input[name=password]").waitFor();
      const afterLogout = requestTimes[0].length;
      await new Promise((resolve) => setTimeout(resolve, 5500));
      assert.equal(
        requestTimes[0].length,
        afterLogout,
        "update polling continued after logout",
      );
      assert.deepEqual(errors, []);
      assert.ok(
        pollModes.every((mode) => mode === "1"),
        "React failed to request serverless polling mode",
      );
      assert.deepEqual(
        external,
        [],
        "integration browser attempted a non-local request",
      );
    } finally {
      // Stop every browser/poll before t.after closes its stores and test database.
      await browser.close();
    }
  },
);

test(
  "PostgreSQL password changes revoke other-instance sessions and every racing old-password login",
  postgresOnly,
  async (t) => {
    const { a, b, login } = await fixture(t);
    const owner = await login(a);
    const other = await login(b);
    let currentPassword = password;
    for (let i = 0; i < 6; i++) {
      const replacement = `new-public-pg-password-${i}`;
      // An old-password login may linearize before the password change and return
      // 200, but its token must be revoked when that password change completes.
      const [racingLogin, changed] = await Promise.all([
        b.req("/login", { username, password: currentPassword }),
        a.req(
          "/password",
          { currentPassword, password: replacement },
          owner.cookie,
        ),
      ]);
      assert.equal(changed.status, 200);
      assert.ok([200, 401].includes(racingLogin.status));
      if (racingLogin.status === 200)
        assert.equal(
          (await a.req("/me", undefined, racingLogin.cookie)).status,
          401,
          "an old-password login issued a session that survived its password change",
        );
      assert.equal((await b.req("/me", undefined, other.cookie)).status, 401);
      assert.equal((await b.req("/me", undefined, owner.cookie)).status, 200);
      assert.equal(
        (await b.req("/login", { username, password: currentPassword })).status,
        401,
      );
      await login(b, username, replacement);
      currentPassword = replacement;
    }
  },
);

test(
  "PostgreSQL authentication limits are shared between handlers and survive a cold instance",
  postgresOnly,
  async (t) => {
    const { a, b, start } = await fixture(t);
    const attempt = (client) =>
      client.req(
        "/login",
        {
          username,
          password: "incorrect-public-test-password",
        },
        null,
        { Origin: publicOrigin },
      );
    // Each handler receives fewer than 30 requests. Only the shared database
    // can enforce the combined limit for their identical source IP address.
    for (let i = 0; i < 30; i++) {
      const rejected = await attempt(i % 2 ? a : b);
      assert.equal(
        rejected.status,
        401,
        `attempt ${i + 1} should reject the password`,
      );
      assert.equal(rejected.data.error, "loginFailed");
    }
    const limited = await attempt(a);
    assert.equal(limited.status, 429);
    assert.equal(limited.data.error, "tooManyAttempts");
    assert.equal((await attempt(b)).status, 429);
    const cold = await start();
    assert.equal(
      (await attempt(cold)).status,
      429,
      "creating a new serverless instance bypassed the stored authentication limit",
    );
  },
);
