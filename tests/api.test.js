import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { spawnSync } from "node:child_process";
async function fixture(t, options = {}) {
  const { app, db } = createApp({ dbPath: ":memory:", ...options });
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${srv.address().port}`;
  t.after(
    () =>
      new Promise((resolve) =>
        srv.close(() => {
          db.close();
          resolve();
        }),
      ),
  );
  const req = async (route, body, cookie, headers = {}) => {
    const response = await fetch(base + "/api" + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      headers: response.headers,
    };
  };
  const owner = await req("/register", {
    username: "owner",
    password: "correct-password-123",
    fleetName: "Test Fleet",
    setupKey: options.setupKey,
  });
  assert.equal(owner.status, 200);
  return { req, owner };
}
test("authenticated shared inventory, staff join and audit attribution", async (t) => {
  const { req, owner } = await fixture(t);
  assert.equal((await req("/state")).status, 401);
  const staff = await req("/register", {
    username: "staff",
    password: "staff-password-123",
    invite: owner.data.invite,
  });
  assert.equal(staff.status, 200);
  const added = await req(
    "/actions",
    {
      kind: "addTyre",
      revision: 0,
      payload: { serial: "X1", brand: "CEAT", size: "R20", type: "new" },
    },
    staff.cookie,
  );
  assert.equal(added.status, 200);
  const read = await req("/state", undefined, owner.cookie);
  assert.equal(read.data.tyres[0].serial, "X1");
  assert.equal(read.data.events[0].actor, "staff");
  assert.equal((await req("/team", undefined, staff.cookie)).status, 403);
});
test("stale revisions and racing staff cannot overwrite records", async (t) => {
  const { req, owner } = await fixture(t);
  const payload = { serial: "X1", brand: "CEAT", size: "R20", type: "new" };
  const results = await Promise.all([
    req("/actions", { kind: "addTyre", revision: 0, payload }, owner.cookie),
    req(
      "/actions",
      { kind: "addTyre", revision: 0, payload: { ...payload, serial: "X2" } },
      owner.cookie,
    ),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const state = (await req("/state", undefined, owner.cookie)).data;
  assert.equal(state.tyres.length, 1);
  assert.equal(state.events.length, 1);
});
test("invalid actions roll back and the next valid action still works", async (t) => {
  const { req, owner } = await fixture(t);
  const invalid = await req(
    "/actions",
    { kind: "fit", revision: 0, payload: { tyreId: "missing" } },
    owner.cookie,
  );
  assert.equal(invalid.status, 400);
  const valid = await req(
    "/actions",
    {
      kind: "addVehicle",
      revision: 0,
      payload: { registration: "RJ01A1", hasSpare: false, odometer: 0 },
    },
    owner.cookie,
  );
  assert.equal(valid.status, 200);
});
test("login, logout and session invalidation", async (t) => {
  const { req } = await fixture(t);
  assert.equal(
    (await req("/login", { username: "owner", password: "wrong" })).status,
    401,
  );
  const logged = await req("/login", {
    username: "owner",
    password: "correct-password-123",
  });
  assert.equal(logged.status, 200);
  assert.equal(
    (await req("/me", undefined, logged.cookie)).data.user.role,
    "owner",
  );
  assert.equal((await req("/logout", {}, logged.cookie)).status, 200);
  assert.equal((await req("/me", undefined, logged.cookie)).status, 401);
});
test("rotating invites expires old code; deactivation revokes staff sessions", async (t) => {
  const { req, owner } = await fixture(t);
  const staff = await req("/register", {
    username: "staff",
    password: "staff-password-123",
    invite: owner.data.invite,
  });
  await req("/team/invite", {}, owner.cookie);
  assert.equal(
    (
      await req("/register", {
        username: "staff2",
        password: "staff-password-123",
        invite: owner.data.invite,
      })
    ).status,
    403,
  );
  assert.equal(
    (await req("/team/deactivate", { id: owner.data.user.id }, owner.cookie))
      .status,
    400,
  );
  assert.equal(
    (await req("/team/deactivate", { id: staff.data.user.id }, owner.cookie))
      .status,
    200,
  );
  assert.equal((await req("/state", undefined, staff.cookie)).status, 401);
});
test("password change invalidates other sessions", async (t) => {
  const { req, owner } = await fixture(t);
  const other = await req("/login", {
    username: "owner",
    password: "correct-password-123",
  });
  assert.equal(
    (
      await req(
        "/password",
        {
          currentPassword: "correct-password-123",
          password: "new-password-123",
        },
        owner.cookie,
      )
    ).status,
    200,
  );
  assert.equal((await req("/me", undefined, other.cookie)).status, 401);
  assert.equal((await req("/me", undefined, owner.cookie)).status, 200);
  assert.equal(
    (
      await req("/login", {
        username: "owner",
        password: "correct-password-123",
      })
    ).status,
    401,
  );
  assert.equal(
    (await req("/login", { username: "owner", password: "new-password-123" }))
      .status,
    200,
  );
});
test("cross-origin changes rejected, Capacitor HTTPS origin supported with bearer auth", async (t) => {
  const { req, owner } = await fixture(t);
  assert.equal(
    (await req("/logout", {}, owner.cookie, { Origin: "https://evil.example" }))
      .status,
    403,
  );
  const native = await req(
    "/login",
    { username: "owner", password: "correct-password-123" },
    null,
    { Origin: "https://localhost" },
  );
  assert.equal(native.status, 200);
  assert.ok(native.data.token);
  assert.equal(
    native.headers.get("access-control-allow-origin"),
    "https://localhost",
  );
  const me = await req("/me", undefined, null, {
    Origin: "https://localhost",
    Authorization: `Bearer ${native.data.token}`,
  });
  assert.equal(me.status, 200);
  assert.equal(owner.data.token, undefined);
});
test("persistent database survives process/app restart", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tyresaathi-test-"));
  const dbPath = join(dir, "test.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = createApp({ dbPath });
  const state = {
    version: 1,
    revision: 9,
    tyres: [],
    vehicles: [],
    events: [],
  };
  first.db
    .prepare("UPDATE settings SET value=? WHERE key='state'")
    .run(JSON.stringify(state));
  first.db.close();
  const second = createApp({ dbPath });
  assert.deepEqual(
    JSON.parse(
      second.db.prepare("SELECT value FROM settings WHERE key='state'").get()
        .value,
    ),
    state,
  );
  second.db.close();
});
test("production owner setup requires configured key and secure cookies", async (t) => {
  const { req, owner } = await fixture(t, {
    production: true,
    setupKey: "test-only-key",
  });
  assert.match(owner.headers.get("set-cookie"), /Secure/);
  assert.match(owner.headers.get("set-cookie"), /HttpOnly/);
  assert.equal((await req("/bootstrap")).data.setupKeyRequired, true);
});
test("JSON shape and body limits do not crash server", async (t) => {
  const { req, owner } = await fixture(t);
  assert.equal((await req("/actions", [], owner.cookie)).status, 400);
  assert.equal(
    (await req("/actions", { note: "x".repeat(70000) }, owner.cookie)).status,
    413,
  );
  assert.equal((await req("/me", undefined, owner.cookie)).status, 200);
});
test("consistent full backup can restore accounts and fleet data; admin reset revokes sessions", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tyresaathi-recovery-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "live.sqlite"),
    destination = join(dir, "backup.sqlite");
  const { req, owner } = await fixture(t, { dbPath });
  await req(
    "/actions",
    {
      kind: "addVehicle",
      revision: 0,
      payload: { registration: "RJ01A1", odometer: 100, hasSpare: true },
    },
    owner.cookie,
  );
  const backed = spawnSync(
    process.execPath,
    ["server/backup.js", destination],
    { encoding: "utf8", env: { ...process.env, DATABASE_PATH: dbPath } },
  );
  assert.equal(backed.status, 0, backed.stderr);
  const restored = createApp({ dbPath: destination });
  assert.equal(
    restored.db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
    1,
  );
  assert.equal(
    JSON.parse(
      restored.db.prepare("SELECT value FROM settings WHERE key='state'").get()
        .value,
    ).vehicles[0].registration,
    "RJ01A1",
  );
  restored.db.close();
  const reset = spawnSync(
    process.execPath,
    ["server/reset-password.js", "owner"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_PATH: dbPath,
        FLEET_ADMIN_PASSWORD: "new-test-password-123",
      },
    },
  );
  assert.equal(reset.status, 0, reset.stderr);
  assert.equal((await req("/me", undefined, owner.cookie)).status, 401);
  assert.equal(
    (
      await req("/login", {
        username: "owner",
        password: "new-test-password-123",
      })
    ).status,
    200,
  );
});
