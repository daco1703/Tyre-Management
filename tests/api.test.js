import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { deploymentOptions } from "../server/config.js";
import { randomBytes, scryptSync } from "node:crypto";
import { spawnSync } from "node:child_process";
async function fixture(t, options = {}) {
  const { app, db } = createApp({ dbPath: ":memory:", ...options });
  // Test account only: exercise login using an already seeded owner.
  const salt = randomBytes(16).toString("hex");
  db.prepare(
    "UPDATE users SET username=?,salt=?,hash=? WHERE role='owner'",
  ).run(
    "owner",
    salt,
    scryptSync("correct-password-123", salt, 64).toString("hex"),
  );
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
  const owner = await req("/login", {
    username: "owner",
    password: "correct-password-123",
  });
  assert.equal(owner.status, 200);
  return { req, owner };
}
test("vehicle import is authenticated, atomic and revision checked", async (t) => {
  const { req, owner } = await fixture(t);
  const payload = {
    vehicles: [
      { registration: "IMPORT1", odometer: 100, hasSpare: true, name: "राम" },
      { registration: "IMPORT2", odometer: 0, hasSpare: false, name: "" },
    ],
  };
  assert.equal(
    (await req("/actions", { kind: "importVehicles", revision: 0, payload }))
      .status,
    401,
  );
  const bad = await req(
    "/actions",
    {
      kind: "importVehicles",
      revision: 0,
      payload: {
        vehicles: [
          payload.vehicles[0],
          { ...payload.vehicles[1], odometer: -1 },
        ],
      },
    },
    owner.cookie,
  );
  assert.equal(bad.status, 400);
  assert.equal(
    (await req("/state", undefined, owner.cookie)).data.vehicles.length,
    0,
  );
  const ok = await req(
    "/actions",
    { kind: "importVehicles", revision: 0, payload },
    owner.cookie,
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.data.vehicles.length, 2);
  assert.equal(ok.data.events.length, 2);
  assert.equal(
    (
      await req(
        "/actions",
        { kind: "importVehicles", revision: 0, payload },
        owner.cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await req(
        "/actions",
        { kind: "importVehicles", revision: 2, payload },
        owner.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (await req("/state", undefined, owner.cookie)).data.vehicles.length,
    2,
  );
});
test("a full 200-vehicle import with Hindi names fits the request limit", async (t) => {
  const { req, owner } = await fixture(t);
  const vehicles = Array.from({ length: 200 }, (_, i) => ({
    registration: "UTF" + i,
    name: "राम".repeat(30),
    odometer: 1000,
    hasSpare: false,
  }));
  const r = await req(
    "/actions",
    { kind: "importVehicles", revision: 0, payload: { vehicles } },
    owner.cookie,
  );
  assert.equal(r.status, 200);
  assert.equal(r.data.vehicles.length, 200);
  assert.equal(r.data.events.length, 200);
  assert.equal(r.data.vehicles[0].name, vehicles[0].name);
});
test("authenticated shared inventory, staff login and audit attribution", async (t) => {
  const { req, owner } = await fixture(t);
  assert.equal((await req("/state")).status, 401);
  await req(
    "/team/create",
    { username: "staff", password: "staff-password-123" },
    owner.cookie,
  );
  const staff = await req("/login", {
    username: "staff",
    password: "staff-password-123",
  });
  assert.equal(staff.status, 200);
  const added = await req(
    "/actions",
    {
      kind: "addTyre",
      revision: 0,
      payload: {
        serial: "X1",
        brand: "CEAT",
        size: "R20",
        type: "new",
        actor: "owner",
      },
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
test("public staff signup is disabled; removal revokes staff sessions", async (t) => {
  const { req, owner } = await fixture(t);
  await req(
    "/team/create",
    { username: "staff", password: "staff-password-123" },
    owner.cookie,
  );
  const staff = await req("/login", {
    username: "staff",
    password: "staff-password-123",
  });
  assert.equal(
    (
      await req("/register", {
        username: "staff2",
        password: "staff-password-123",
      })
    ).status,
    404,
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
test("production login needs no owner setup key and uses secure cookies", async (t) => {
  const { req, owner } = await fixture(t, {
    production: true,
  });
  assert.match(owner.headers.get("set-cookie"), /Secure/);
  assert.match(owner.headers.get("set-cookie"), /HttpOnly/);
  assert.deepEqual((await req("/bootstrap")).data, { setupRequired: false });
  assert.equal(
    (
      await req("/register", {
        username: "hijack",
        password: "a-valid-password",
      })
    ).status,
    404,
  );
});
test("JSON shape and body limits do not crash server", async (t) => {
  const { req, owner } = await fixture(t);
  assert.equal((await req("/actions", [], owner.cookie)).status, 400);
  assert.equal(
    (await req("/actions", { note: "x".repeat(300000) }, owner.cookie)).status,
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

test("new database seeds admin and fleet once; password changes survive restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "shepards-seed-"));
  const dbPath = join(dir, "test.sqlite");
  try {
    const first = createApp({ dbPath });
    const admin = first.db.prepare("SELECT * FROM users").get();
    assert.equal(admin.username, "admin");
    assert.equal(admin.role, "owner");
    assert.equal(
      first.db.prepare("SELECT value FROM settings WHERE key='fleetName'").get()
        .value,
      "Shepards Shipping Services",
    );
    first.db
      .prepare("UPDATE users SET hash=? WHERE id=?")
      .run("changed-hash", admin.id);
    first.db.close();
    const second = createApp({ dbPath });
    assert.equal(
      second.db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
      1,
    );
    assert.equal(
      second.db.prepare("SELECT hash FROM users WHERE id=?").get(admin.id).hash,
      "changed-hash",
    );
    second.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shared removal records mileage and scrap reason together; invalid reason rolls back odometer", async (t) => {
  const { req, owner } = await fixture(t);
  let state = (await req("/state", undefined, owner.cookie)).data;
  async function act(kind, payload) {
    const result = await req(
      "/actions",
      { kind, payload, revision: state.revision },
      owner.cookie,
    );
    if (result.status === 200) state = result.data;
    return result;
  }
  await act("addVehicle", {
    registration: "MH01AB1234",
    odometer: 1000,
    hasSpare: false,
  });
  await act("addTyre", {
    serial: "SCRAP-1",
    brand: "MRF",
    size: "R20",
    type: "used",
    distance: 5000,
  });
  const tyreId = state.tyres[0].id;
  await act("fit", {
    tyreId,
    vehicleId: state.vehicles[0].id,
    slot: "FL",
    odometer: 1000,
  });
  const before = structuredClone(state);
  assert.equal(
    (await act("remove", { tyreId, destination: "scrapped", odometer: 1700 }))
      .status,
    400,
  );
  assert.deepEqual((await req("/state", undefined, owner.cookie)).data, before);
  assert.equal(
    (
      await act("remove", {
        tyreId,
        destination: "scrapped",
        odometer: 1700,
        scrapReason: "other",
        scrapDetail: "Inspection rejected casing",
      })
    ).status,
    200,
  );
  assert.equal(state.tyres[0].status, "scrapped");
  assert.equal(state.events.at(-1).runningKm, 700);
  assert.equal(state.events.at(-1).totalKm, 5700);
  assert.equal(state.events.at(-1).actor, "owner");
  assert.equal(state.events.at(-1).scrapDetail, "Inspection rejected casing");
});

test("admin creates unique staff logins without replacing the admin session", async (t) => {
  const { req, owner } = await fixture(t);
  const account = {
    username: " New_Staff ",
    password: "individual-staff-password",
    role: "owner",
  };
  assert.equal((await req("/team/create", account)).status, 401);
  const created = await req("/team/create", account, owner.cookie);
  assert.equal(created.status, 201);
  assert.deepEqual(Object.keys(created.data).sort(), [
    "active",
    "id",
    "role",
    "username",
  ]);
  assert.equal(created.data.username, "new_staff");
  assert.equal(created.data.role, "staff");
  assert.equal(created.cookie, undefined);
  assert.equal(
    (await req("/me", undefined, owner.cookie)).data.user.role,
    "owner",
  );
  assert.equal(
    (
      await req(
        "/team/create",
        { ...account, username: "NEW_STAFF" },
        owner.cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (await req("/team/create", { ...account, username: "owner" }, owner.cookie))
      .status,
    409,
  );
  assert.equal(
    (
      await req(
        "/team/create",
        { ...account, username: "bad name" },
        owner.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (await req("/team/create", { ...account, password: "short" }, owner.cookie))
      .status,
    400,
  );
  const staff = await req("/login", {
    username: "new_staff",
    password: account.password,
  });
  assert.equal(staff.status, 200);
  assert.equal(
    (
      await req(
        "/team/create",
        { username: "another_staff", password: account.password },
        staff.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await req("/login", {
        username: "new_staff",
        password: "incorrect-password",
      })
    ).status,
    401,
  );
  assert.equal((await req("/team", undefined, owner.cookie)).data.length, 2);
  assert.equal(
    (await req("/team/deactivate", { id: created.data.id }, owner.cookie))
      .status,
    200,
  );
  assert.equal(
    (await req("/login", { username: "new_staff", password: account.password }))
      .status,
    401,
  );
  assert.equal((await req("/state", undefined, staff.cookie)).status, 401);
});

test("live updates deliver committed staff entries to concurrent users and revoke removed staff", async (t) => {
  const { req, owner } = await fixture(t);
  await req(
    "/team/create",
    { username: "live_staff", password: "live-staff-password" },
    owner.cookie,
  );
  const staff = await req("/login", {
    username: "live_staff",
    password: "live-staff-password",
  });
  assert.equal((await req("/updates?revision=0")).status, 401);
  assert.equal(
    (await req("/updates?revision=bad", undefined, owner.cookie)).status,
    400,
  );
  const ownerWaiting = req("/updates?revision=0", undefined, owner.cookie);
  const staffWaiting = req("/updates?revision=0", undefined, staff.cookie);
  await new Promise((r) => setTimeout(r, 30));
  const added = await req(
    "/actions",
    {
      kind: "addTyre",
      revision: 0,
      payload: { serial: "LIVE-1", brand: "CEAT", size: "R20", type: "new" },
    },
    staff.cookie,
  );
  assert.equal(added.status, 200);
  const [ownerUpdate, staffUpdate] = await Promise.all([
    ownerWaiting,
    staffWaiting,
  ]);
  assert.equal(ownerUpdate.status, 200);
  assert.deepEqual(ownerUpdate.data, added.data);
  assert.deepEqual(staffUpdate.data, added.data);
  assert.equal(ownerUpdate.data.events.at(-1).actor, "live_staff");
  assert.ok(ownerUpdate.data.events.at(-1).timestamp);
  const removedWaiting = req("/updates?revision=1", undefined, staff.cookie);
  await new Promise((r) => setTimeout(r, 30));
  await req("/team/deactivate", { id: staff.data.user.id }, owner.cookie);
  assert.equal((await removedWaiting).status, 401);
});

test("Render HTTPS browser login uses the public origin despite the internal HTTP host", async (t) => {
  const { req } = await fixture(t, {
    production: true,
    publicOrigin: "https://tyre-management.onrender.com/",
  });
  const logged = await req(
    "/login",
    { username: "owner", password: "correct-password-123" },
    undefined,
    {
      Origin: "https://tyre-management.onrender.com",
      Host: "internal-render-service:10000",
      "X-Forwarded-Proto": "https",
    },
  );
  assert.equal(logged.status, 200);
  assert.match(logged.headers.get("set-cookie"), /Secure/);
  assert.equal(logged.data.token, undefined);
  assert.equal((await req("/me", undefined, logged.cookie)).status, 200);
  assert.equal(
    (
      await req("/logout", {}, logged.cookie, {
        Origin: "https://tyre-management.onrender.com",
        Host: "internal-render-service:10000",
      })
    ).status,
    200,
  );
});

test("Render custom domain works behind an internal host with exact origin protection", async (t) => {
  const { req, owner } = await fixture(t, {
    production: true,
    ...deploymentOptions({
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://tyre-management.onrender.com/",
    }),
  });
  for (const origin of [
    "https://www.shepards-tyre-management.com",
    "https://tyre-management.onrender.com",
    "https://tyre-management-git-main-shepards.vercel.app",
  ]) {
    const logged = await req(
      "/login",
      { username: "owner", password: "correct-password-123" },
      undefined,
      { Origin: origin, Host: "internal-render-service:10000" },
    );
    assert.equal(logged.status, 200, origin);
    assert.match(logged.headers.get("set-cookie"), /Secure/);
    assert.equal(
      (
        await req("/logout", {}, logged.cookie, {
          Origin: origin,
          Host: "internal-render-service:10000",
        })
      ).status,
      200,
    );
  }
  for (const origin of [
    "http://www.shepards-tyre-management.com",
    "https://shepards-tyre-management.com",
    "https://www.shepards-tyre-management.com.evil.example",
    "https://other-project.vercel.app",
    "https://tyre-management-git-main-shepards.vercel.app.evil.example",
    "https://evil.example",
  ]) {
    const response = await req("/logout", {}, owner.cookie, {
      Origin: origin,
      Host: "internal-render-service:10000",
      "X-Forwarded-Host": new URL(origin).host,
      "X-Forwarded-Proto": "https",
    });
    assert.equal(response.status, 403, origin);
    assert.equal(response.data.error, "originDenied");
  }
  assert.equal((await req("/me", undefined, owner.cookie)).status, 200);
});

test("the company public origin permits only the fleet's exact Vercel preview", async (t) => {
  const { req } = await fixture(t, {
    production: true,
    ...deploymentOptions({
      RENDER: "true",
      PUBLIC_ORIGIN: "https://www.shepards-tyre-management.com",
    }),
  });
  const preview = "https://tyre-management-git-main-shepards.vercel.app";
  const logged = await req(
    "/login",
    { username: "owner", password: "correct-password-123" },
    undefined,
    { Origin: preview, Host: "internal-render-service:10000" },
  );
  assert.equal(logged.status, 200);
  assert.equal(
    (
      await req("/logout", {}, logged.cookie, {
        Origin: "https://another-project.vercel.app",
        Host: "internal-render-service:10000",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await req("/logout", {}, logged.cookie, {
        Origin: preview,
        Host: "internal-render-service:10000",
      })
    ).status,
    200,
  );
});

test("an explicit public origin disables the automatic company-domain fallback", async (t) => {
  const { req, owner } = await fixture(t, {
    ...deploymentOptions({
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://tyre-management.onrender.com",
      PUBLIC_ORIGIN: "https://another-fleet.example",
    }),
  });
  for (const origin of [
    "https://www.shepards-tyre-management.com",
    "https://tyre-management.onrender.com",
    "https://tyre-management-git-main-shepards.vercel.app",
  ])
    assert.equal(
      (
        await req("/logout", {}, owner.cookie, {
          Origin: origin,
          Host: "internal-render-service:10000",
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await req("/logout", {}, owner.cookie, {
        Origin: "https://another-fleet.example",
        Host: "internal-render-service:10000",
      })
    ).status,
    200,
  );
});

test("configured public origin still rejects foreign sites and forged forwarding headers", async (t) => {
  const { req, owner } = await fixture(t, {
    publicOrigin: "https://tyre-management.onrender.com",
  });
  for (const origin of [
    "https://evil.example",
    "https://tyre-management.onrender.com.evil.example",
    "http://tyre-management.onrender.com",
    "null",
  ]) {
    const result = await req("/logout", {}, owner.cookie, {
      Origin: origin,
      Host: "internal-render-service:10000",
      "X-Forwarded-Host": origin.replace(/^https?:\/\//, ""),
      "X-Forwarded-Proto": "https",
    });
    assert.equal(result.status, 403);
    assert.equal(result.data.error, "originDenied");
  }
  assert.equal((await req("/me", undefined, owner.cookie)).status, 200);
});

test("only admin can save company images; validation is atomic and public data contains only branding", async (t) => {
  const { req, owner } = await fixture(t);
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=";
  assert.deepEqual((await req("/branding")).data, {});
  assert.equal((await req("/branding", { logo: png })).status, 401);
  await req(
    "/team/create",
    { username: "image_staff", password: "image-staff-password" },
    owner.cookie,
  );
  const staff = await req("/login", {
    username: "image_staff",
    password: "image-staff-password",
  });
  assert.equal(
    (await req("/branding", { logo: png }, staff.cookie)).status,
    403,
  );
  assert.equal(
    (await req("/branding", { logo: png, banner: png }, owner.cookie)).status,
    200,
  );
  assert.deepEqual((await req("/branding")).data, { logo: png, banner: png });
  for (const bad of [
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/png;base64,YWJj",
    {},
    "https://evil.test/image.png",
  ]) {
    assert.equal(
      (await req("/branding", { logo: null, banner: bad }, owner.cookie))
        .status,
      400,
    );
    assert.deepEqual((await req("/branding")).data, { logo: png, banner: png });
  }
  assert.equal(
    (await req("/branding", { logo: null }, owner.cookie)).status,
    200,
  );
  assert.deepEqual((await req("/branding")).data, { banner: png });
});

test("vehicle creation/import are owner-only; staff can import tyres and sell with server attribution", async (t) => {
  const { req, owner } = await fixture(t);
  await req(
    "/team/create",
    { username: "operator", password: "operator-test-password" },
    owner.cookie,
  );
  const staff = await req("/login", {
    username: "operator",
    password: "operator-test-password",
  });
  for (const kind of ["addVehicle", "importVehicles"]) {
    assert.equal(
      (
        await req(
          "/actions",
          {
            kind,
            revision: 0,
            payload: {
              registration: "MH01AA1234",
              hasSpare: false,
              odometer: 0,
              vehicles: [
                { registration: "MH01AA1234", hasSpare: false, odometer: 0 },
              ],
              role: "owner",
            },
          },
          staff.cookie,
        )
      ).status,
      403,
    );
  }
  assert.equal((await req("/state", undefined, owner.cookie)).data.revision, 0);
  const added = await req(
    "/actions",
    {
      kind: "importTyres",
      revision: 0,
      payload: {
        tyres: [
          { serial: "0001", brand: "MRF", type: "new", construction: "radial" },
          {
            serial: "0002",
            brand: "Apollo",
            type: "remold",
            construction: "horse",
          },
        ],
      },
    },
    staff.cookie,
  );
  assert.equal(added.status, 200);
  assert.equal(added.data.revision, 2);
  assert.ok(added.data.events.every((e) => e.actor === "operator"));
  assert.equal(added.data.tyres[1].nsd.averagePercent, 100);
  const failed = await req(
    "/actions",
    {
      kind: "importTyres",
      revision: 2,
      payload: {
        tyres: [
          { serial: "OK", brand: "MRF" },
          { serial: "BAD", brand: "" },
        ],
      },
    },
    staff.cookie,
  );
  assert.equal(failed.status, 400);
  assert.equal((await req("/state", undefined, owner.cookie)).data.revision, 2);
  const sold = await req(
    "/actions",
    {
      kind: "sell",
      revision: 2,
      payload: {
        tyreId: added.data.tyres[0].id,
        actor: "owner",
        note: "Invoice 100",
      },
    },
    staff.cookie,
  );
  assert.equal(sold.status, 200);
  assert.equal(sold.data.events.at(-1).actor, "operator");
  assert.equal(sold.data.events.at(-1).tally.stock, 1);
  assert.equal(sold.data.events.at(-1).tally.sold, 1);
  assert.equal(
    (
      await req(
        "/actions",
        {
          kind: "sell",
          revision: 2,
          payload: { tyreId: added.data.tyres[0].id },
        },
        owner.cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await req(
        "/actions",
        {
          kind: "addVehicle",
          revision: 3,
          payload: { registration: "MH01AA1234", hasSpare: false, odometer: 0 },
        },
        owner.cookie,
      )
    ).status,
    200,
  );
});

test("only admin can sell a vehicle and fitted tyres; stale or invalid sales cannot alter shared inventory", async (t) => {
  const { req, owner } = await fixture(t);
  await req(
    "/team/create",
    { username: "sales_staff", password: "sales-test-password" },
    owner.cookie,
  );
  const staff = await req("/login", {
    username: "sales_staff",
    password: "sales-test-password",
  });
  async function act(kind, payload, who = owner) {
    const state = (await req("/state", undefined, owner.cookie)).data;
    return req(
      "/actions",
      { kind, payload, revision: state.revision },
      who.cookie,
    );
  }
  let added = await act("addVehicle", {
    registration: "MH01AA1234",
    hasSpare: true,
    odometer: 1000,
  });
  const vehicleId = added.data.vehicles[0].id;
  added = await act("addTyre", { serial: "S1", brand: "MRF", type: "new" });
  const tyreId = added.data.tyres[0].id;
  await act("fit", { vehicleId, tyreId, slot: "FR", odometer: 1000 });
  assert.equal(
    (
      await act(
        "sellVehicle",
        { vehicleId, odometer: 1500, role: "owner" },
        staff,
      )
    ).status,
    403,
  );
  assert.equal(
    (await act("sellVehicle", { vehicleId, odometer: 999 })).status,
    400,
  );
  let state = (await req("/state", undefined, owner.cookie)).data;
  assert.equal(state.vehicles[0].odometer, 1000);
  assert.equal(state.tyres[0].status, "installed");
  assert.equal(
    (
      await act("sellVehicle", {
        vehicleId,
        odometer: 1500,
        fitmentSnapshot: [],
      })
    ).status,
    409,
  );
  const revision = state.revision;
  const sold = await act("sellVehicle", {
    vehicleId,
    odometer: 1500,
    fitmentSnapshot: [{ tyreId, slot: "FR" }],
    note: "Vehicle invoice",
  });
  assert.equal(sold.status, 200);
  assert.equal(sold.data.tyres[0].status, "sold");
  assert.equal(sold.data.tyres[0].distance, 500);
  assert.equal(sold.data.events.at(-1).actor, "owner");
  assert.equal(
    (await req("/state", undefined, staff.cookie)).data.vehicles[0].status,
    "sold",
  );
  assert.equal(
    (
      await req(
        "/actions",
        {
          kind: "sellVehicle",
          payload: { vehicleId, odometer: 1500 },
          revision,
        },
        owner.cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (await act("sellVehicle", { vehicleId, odometer: 1500 })).status,
    400,
  );
  assert.equal(
    (
      await act(
        "inspectVehicle",
        { vehicleId, inspectedOn: "2026-10-29", allTyresChecked: true },
        staff,
      )
    ).status,
    400,
  );
});
