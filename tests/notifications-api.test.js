import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.js";
import { createSqliteStore } from "../server/storage/sqlite.js";
import {
  createDatabaseBackup,
  readSqliteBackup,
  validateDatabaseBackup,
} from "../server/recovery.js";
import { notificationRegistryKey } from "../server/notifications.js";
import { emptyState } from "../shared/model.js";

const password = "public-notifications-test-password";
const cronSecret = "public-test-only-cron-secret-123456";
const key = createECDH("prime256v1");
key.generateKeys();
const subscription = (id) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/test-${id}`,
  keys: {
    p256dh: key.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  },
});
const device = (id, patch = {}) => ({
  kind: "web",
  language: "en",
  categories: ["driverLicense"],
  subscription: subscription(id),
  ...patch,
});
const dueState = () => ({
  ...emptyState(),
  drivers: [
    {
      id: "driver-private-id",
      name: "Private Driver Name",
      dob: "1980-01-01",
      licenseNo: "PRIVATE-LICENSE-123",
      licenseExpiry: "2020-01-01",
      active: true,
    },
  ],
});

async function fixture(
  t,
  {
    env = { CRON_SECRET: cronSecret },
    sender = async () => ({ ok: true }),
  } = {},
) {
  const temp = mkdtempSync(path.join(tmpdir(), "shepards-notifications-"));
  const dbPath = path.join(temp, "isolated.sqlite");
  const store = createSqliteStore(dbPath),
    servers = [];
  let now = Date.parse("2026-11-25T03:30:00Z");
  const salt = randomBytes(16).toString("hex"),
    hash = scryptSync(password, salt, 64).toString("hex");
  await store.run(
    "UPDATE users SET username=?,salt=?,hash=? WHERE role='owner'",
    "notification_owner",
    salt,
    hash,
  );
  await store.run(
    "UPDATE settings SET value=? WHERE key='state'",
    JSON.stringify(dueState()),
  );
  t.after(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await store.close();
    rmSync(temp, { recursive: true, force: true });
  });
  async function instance() {
    const { app } = createApp({
      store,
      notifications: { env, sender, clock: () => now },
    });
    const server = await new Promise((resolve) => {
      const running = app.listen(0, "127.0.0.1", () => resolve(running));
    });
    servers.push(server);
    const base = `http://127.0.0.1:${server.address().port}`;
    return async (route, body, cookie, headers = {}) => {
      const response = await fetch(base + "/api" + route, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
      });
      return {
        status: response.status,
        data: await response.json(),
        cookie: response.headers.get("set-cookie")?.split(";")[0],
      };
    };
  }
  const req = await instance();
  const login = async (name = "notification_owner", secret = password) => {
    const result = await req("/login", { username: name, password: secret });
    assert.equal(result.status, 200);
    return result;
  };
  const owner = await login();
  assert.equal(
    (
      await req(
        "/team/create",
        { username: "notification_staff", password },
        owner.cookie,
      )
    ).status,
    201,
  );
  const staff = await login("notification_staff");
  const register = async (payload, who = owner, request = req) => {
    const response = await request(
      "/notifications/devices",
      payload,
      who.cookie,
    );
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
  };
  const registry = async () =>
    JSON.parse(
      (
        await store.get(
          "SELECT value FROM settings WHERE key=?",
          notificationRegistryKey,
        )
      ).value,
    );
  const dispatch = (request = req) =>
    request("/notifications/dispatch", undefined, null, {
      Authorization: `Bearer ${cronSecret}`,
    });
  return {
    req,
    store,
    dbPath,
    temp,
    owner,
    staff,
    login,
    register,
    registry,
    dispatch,
    instance,
    salt,
    hash,
    advance: (milliseconds) => {
      now += milliseconds;
    },
  };
}

test("notification status generates one durable public VAPID key and reports missing cron/native configuration honestly", async (t) => {
  const f = await fixture(t, { env: {} });
  assert.equal((await f.req("/notifications/status")).status, 401);
  const other = await f.instance();
  const [a, b] = await Promise.all([
    f.req("/notifications/status", undefined, f.owner.cookie),
    other("/notifications/status", undefined, f.staff.cookie),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.data.web.vapidPublicKey, b.data.web.vapidPublicKey);
  assert.equal(Buffer.from(a.data.web.vapidPublicKey, "base64url").length, 65);
  assert.deepEqual(a.data.native, { android: false, ios: false });
  assert.equal(a.data.web.configured, true);
  assert.equal(a.data.cronConfigured, false);
  assert.equal(a.data.remoteRemindersConfigured, false);
  const registry = await f.registry();
  assert.equal(Buffer.from(registry.vapid.privateKey, "base64url").length, 32);
  for (const route of ["/state", "/bootstrap", "/updates?revision=999"]) {
    const result = await f.req(route, undefined, f.owner.cookie);
    const exported = JSON.stringify(result.data);
    assert.ok(!exported.includes(registry.vapid.privateKey));
    assert.ok(!exported.includes(notificationRegistryKey));
  }
  assert.equal((await f.req("/notifications/dispatch")).status, 503);
});

test("enrollment validates outbound destinations/preferences, limits devices and scopes IDs to their authenticated owner", async (t) => {
  const f = await fixture(t);
  const payload = device("owner");
  assert.equal((await f.req("/notifications/devices", payload)).status, 401);
  const own = await f.register(payload);
  for (const bad of [
    device("bad", {
      subscription: {
        ...payload.subscription,
        endpoint: "https://127.0.0.1/private",
      },
    }),
    device("bad", { categories: ["unknown"] }),
    device("bad", { language: "xx" }),
    device("bad", {
      subscription: {
        ...payload.subscription,
        keys: { ...payload.subscription.keys, auth: "bad" },
      },
    }),
  ])
    assert.equal(
      (await f.req("/notifications/devices", bad, f.owner.cookie)).status,
      400,
    );
  assert.equal(
    (
      await f.req(
        "/notifications/devices",
        { ...device("foreign"), deviceId: own.deviceId },
        f.staff.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await f.req(
        "/notifications/test",
        { deviceId: own.deviceId },
        f.staff.cookie,
      )
    ).status,
    404,
  );
  await f.req(
    "/notifications/unsubscribe",
    { deviceId: own.deviceId },
    f.staff.cookie,
  );
  assert.equal((await f.registry()).devices.length, 1);
  const updated = await f.register({
    ...payload,
    deviceId: own.deviceId,
    language: "hi",
    categories: [],
  });
  assert.equal(updated.deviceId, own.deviceId);
  assert.equal((await f.registry()).devices.length, 1);
  for (let i = 0; i < 4; i++) await f.register(device(`extra-${i}`));
  assert.equal(
    (await f.req("/notifications/devices", device("sixth"), f.owner.cookie))
      .status,
    409,
  );
  await f.req(
    "/notifications/unsubscribe",
    { deviceId: own.deviceId },
    f.owner.cookie,
  );
  assert.equal((await f.registry()).devices.length, 4);
  const native = await f.register(
    {
      kind: "android",
      token: "public_test_native_token_123456789",
      language: "en",
      categories: ["nsd"],
    },
    f.staff,
  );
  assert.equal(native.remoteDeliveryConfigured, false);
  assert.equal(
    (
      await f.req(
        "/notifications/test",
        { deviceId: native.deviceId },
        f.staff.cookie,
      )
    ).status,
    503,
  );
});

test("manual test sends only a generic payload to the current user's enrolled device and is rate limited", async (t) => {
  const sent = [];
  const f = await fixture(t, {
    sender: async (target, payload, options) => {
      sent.push({ target, payload, options });
      return { ok: true };
    },
  });
  const own = await f.register(device("manual"));
  assert.equal(
    (
      await f.req(
        "/notifications/test",
        { deviceId: own.deviceId, body: "Do not accept caller content" },
        f.owner.cookie,
      )
    ).status,
    200,
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.body, "Notifications are working.");
  assert.equal(sent[0].options.timeoutMs, 8000);
  assert.equal(
    (
      await f.req(
        "/notifications/test",
        { deviceId: own.deviceId },
        f.owner.cookie,
      )
    ).status,
    429,
  );
  assert.ok(!JSON.stringify(sent[0].payload).includes("PRIVATE-LICENSE"));
});

test("parallel cold service instances lease each device once per India day and natural session expiry does not revoke consent", async (t) => {
  let release, began;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const sent = [];
  const f = await fixture(t, {
    sender: async (target, payload) => {
      sent.push({ target, payload });
      began();
      await gate;
      return { ok: true };
    },
  });
  await f.register(device("daily"), f.staff);
  await f.store.run(
    "UPDATE sessions SET expires=0 WHERE user_id=?",
    f.staff.data.user.id,
  );
  const other = await f.instance();
  assert.equal((await f.req("/notifications/dispatch")).status, 401);
  assert.equal(
    (
      await f.req("/notifications/dispatch", undefined, null, {
        Authorization: "Bearer incorrect",
      })
    ).status,
    401,
  );
  const first = f.dispatch();
  await started;
  const parallel = await f.dispatch(other);
  assert.equal(parallel.status, 200);
  assert.equal(parallel.data.sent, 0);
  release();
  assert.equal((await first).data.sent, 1);
  assert.equal((await f.dispatch()).data.sent, 0);
  assert.equal(sent.length, 1);
  const text = JSON.stringify(sent[0].payload);
  assert.ok(
    !text.includes("Private Driver Name") && !text.includes("PRIVATE-LICENSE"),
  );
  assert.equal(sent[0].payload.tag, "shepards-reminders-2026-11-25");
  f.advance(86400000);
  assert.equal((await f.dispatch()).data.sent, 1);
  assert.equal(sent.length, 2);
});

test("transient failures retry on the next invocation, dead subscriptions and inactive users are removed, expired leases recover", async (t) => {
  let mode = "transient",
    calls = 0;
  const f = await fixture(t, {
    sender: async () => {
      calls++;
      return mode === "ok"
        ? { ok: true }
        : {
            ok: false,
            permanent: mode === "dead",
            status: mode === "dead" ? 410 : 503,
          };
    },
  });
  const own = await f.register(device("retry"));
  const failed = await f.dispatch();
  assert.equal(failed.data.failed, 1);
  assert.equal(failed.data.remaining, 1);
  mode = "ok";
  const success = await f.dispatch();
  assert.equal(success.data.sent, 1);
  assert.equal(success.data.remaining, 0);
  f.advance(86400000);
  mode = "dead";
  assert.equal((await f.dispatch()).data.removed, 1);
  assert.equal((await f.registry()).devices.length, 0);
  await f.register(device("expired-claim"));
  const registry = await f.registry();
  registry.devices[0].claim = { id: randomUUID(), day: "2026-11-26", until: 1 };
  await f.store.run(
    "UPDATE settings SET value=? WHERE key=?",
    JSON.stringify(registry),
    notificationRegistryKey,
  );
  mode = "ok";
  assert.equal((await f.dispatch()).data.sent, 1);
  const inactive = await f.register(device("inactive"), f.staff);
  await f.store.run(
    "UPDATE users SET active=0 WHERE id=?",
    f.staff.data.user.id,
  );
  const before = calls;
  assert.equal((await f.dispatch()).data.removed, 1);
  assert.equal(calls, before);
  assert.ok(
    !(await f.registry()).devices.some(
      (entry) => entry.id === inactive.deviceId || entry.id === own.deviceId,
    ),
  );
  await f.register(device("tampered-endpoint"));
  const tampered = await f.registry();
  tampered.devices.at(-1).subscription.endpoint = "https://127.0.0.1/internal";
  await f.store.run(
    "UPDATE settings SET value=? WHERE key=?",
    JSON.stringify(tampered),
    notificationRegistryKey,
  );
  const beforeInvalid = calls;
  assert.equal((await f.dispatch()).data.removed, 1);
  assert.equal(
    calls,
    beforeInvalid,
    "dispatch sent to a destination that failed revalidation",
  );
});

test("logout removes its session binding, password changes remove other bindings and staff removal clears all staff devices", async (t) => {
  const f = await fixture(t);
  const a = await f.register(device("login-a"));
  const second = await f.login();
  const b = await f.register(device("login-b"), second);
  await f.req("/logout", {}, f.owner.cookie);
  assert.deepEqual(
    (await f.registry()).devices.map((entry) => entry.id),
    [b.deviceId],
  );
  const third = await f.login();
  await f.register(device("login-c"), third);
  assert.equal(
    (
      await f.req(
        "/password",
        { currentPassword: password, password: "replacement-public-password" },
        second.cookie,
      )
    ).status,
    200,
  );
  assert.deepEqual(
    (await f.registry()).devices.map((entry) => entry.id),
    [b.deviceId],
  );
  const staffDevice = await f.register(device("staff"), f.staff);
  assert.equal(
    (
      await f.req(
        "/team/deactivate",
        { id: f.staff.data.user.id },
        second.cookie,
      )
    ).status,
    200,
  );
  assert.ok(
    !(await f.registry()).devices.some((entry) =>
      [a.deviceId, staffDevice.deviceId].includes(entry.id),
    ),
  );
});

test("an expired or deleted session token can only revoke its original device binding, never authenticate or remove a rebound device", async (t) => {
  const f = await fixture(t);
  const token = (session) => session.cookie.split("=")[1];
  const headers = (raw) => ({
    Authorization: `Bearer ${raw}`,
    Origin: "https://localhost",
  });
  const first = await f.register(device("expired-first"));
  const secondSession = await f.login();
  const second = await f.register(device("expired-second"), secondSession);
  await f.store.run(
    "UPDATE sessions SET expires=0 WHERE user_id=?",
    f.owner.data.user.id,
  );
  const original = headers(token(f.owner)),
    unrelated = headers(token(secondSession));
  assert.equal((await f.req("/state", undefined, null, original)).status, 401);
  assert.equal(
    (await f.req("/notifications/status", undefined, null, original)).status,
    401,
  );
  assert.equal(
    (
      await f.req(
        "/notifications/devices",
        device("must-not-enroll"),
        null,
        original,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await f.req(
        "/notifications/test",
        { deviceId: first.deviceId },
        null,
        original,
      )
    ).status,
    401,
  );
  assert.equal(
    (await f.req("/notifications/unsubscribe", { deviceId: first.deviceId }))
      .status,
    401,
  );
  assert.equal(
    (
      await f.req(
        "/notifications/unsubscribe",
        { deviceId: first.deviceId },
        null,
        unrelated,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await f.req(
        "/notifications/unsubscribe",
        { deviceId: first.deviceId },
        f.staff.cookie,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await f.req(
        "/notifications/unsubscribe",
        { deviceId: first.deviceId },
        null,
        { ...original, Origin: "https://foreign.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.req("/notifications/unsubscribe", [], null, original)).status,
    400,
  );
  assert.equal((await f.registry()).devices.length, 2);
  const removed = await f.req(
    "/notifications/unsubscribe",
    { deviceId: first.deviceId },
    null,
    original,
  );
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.data, { ok: true });
  assert.deepEqual(
    (await f.registry()).devices.map((entry) => entry.id),
    [second.deviceId],
  );
  assert.equal(
    (
      await f.req(
        "/notifications/unsubscribe",
        { deviceId: first.deviceId },
        null,
        original,
      )
    ).status,
    200,
  );
  assert.equal((await f.req("/state", undefined, null, original)).status, 401);

  await f.store.run(
    "DELETE FROM sessions WHERE user_id=?",
    f.owner.data.user.id,
  );
  assert.equal(
    (
      await f.req(
        "/notifications/unsubscribe",
        { deviceId: second.deviceId },
        null,
        unrelated,
      )
    ).status,
    200,
  );
  assert.equal((await f.registry()).devices.length, 0);

  const oldSession = await f.login(),
    sameDestination = device("rebound");
  const rebound = await f.register(sameDestination, oldSession);
  await f.store.run(
    "DELETE FROM sessions WHERE user_id=?",
    f.owner.data.user.id,
  );
  const current = await f.login();
  await f.register({ ...sameDestination, deviceId: rebound.deviceId }, current);
  assert.equal(
    (
      await f.req(
        "/notifications/unsubscribe",
        { deviceId: rebound.deviceId },
        null,
        headers(token(oldSession)),
      )
    ).status,
    401,
  );
  assert.equal((await f.registry()).devices.length, 1);
  assert.equal(
    (
      await f.req(
        "/notifications/unsubscribe",
        { deviceId: rebound.deviceId },
        current.cookie,
      )
    ).status,
    200,
  );
  assert.equal((await f.registry()).devices.length, 0);
});

test("notification secrets and consents are excluded from full JSON and SQLite backups while source records remain intact", async (t) => {
  const f = await fixture(t);
  await f.register(device("backup"));
  const registry = await f.registry();
  const backup = await createDatabaseBackup(f.store);
  assert.ok(
    !backup.settings.some((setting) => setting.key === notificationRegistryKey),
  );
  const old = {
    ...backup,
    settings: [
      ...backup.settings,
      { key: notificationRegistryKey, value: JSON.stringify(registry) },
    ],
  };
  assert.ok(
    !validateDatabaseBackup(old).settings.some(
      (setting) => setting.key === notificationRegistryKey,
    ),
  );
  const copyPath = path.join(f.temp, "backup.sqlite");
  const result = spawnSync(process.execPath, ["server/backup.js", copyPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_PATH: f.dbPath,
      DATABASE_URL: "",
      POSTGRES_URL: "",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const copy = new DatabaseSync(copyPath, { readOnly: true });
  try {
    assert.equal(
      copy
        .prepare("SELECT value FROM settings WHERE key=?")
        .get(notificationRegistryKey),
      undefined,
    );
  } finally {
    copy.close();
  }
  assert.ok(
    !readFileSync(copyPath).includes(Buffer.from(registry.vapid.privateKey)),
    "deleted key bytes survived in the backup freelist",
  );
  assert.ok(
    !readSqliteBackup(copyPath).settings.some(
      (setting) => setting.key === notificationRegistryKey,
    ),
  );
  assert.deepEqual(await f.registry(), registry);
  assert.deepEqual(
    JSON.parse(
      (await f.store.get("SELECT value FROM settings WHERE key='state'")).value,
    ),
    dueState(),
  );
});

test(
  "a bounded batch dispatcher drains 500 enrolled destinations without exceeding 20 concurrent provider calls",
  { timeout: 30000 },
  async (t) => {
    let active = 0,
      maximum = 0,
      calls = 0;
    const f = await fixture(t, {
      sender: async () => {
        calls++;
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        return { ok: true };
      },
    });
    await f.req("/notifications/status", undefined, f.owner.cookie);
    const registry = await f.registry(),
      endpoint = subscription("template");
    for (let i = 0; i < 100; i++) {
      const user = await f.store.get(
        "INSERT INTO users (username,salt,hash,role) VALUES (?,?,?,?) RETURNING id",
        `batch_user_${i}`,
        f.salt,
        f.hash,
        "staff",
      );
      for (let j = 0; j < 5; j++)
        registry.devices.push({
          id: randomUUID(),
          userId: user.id,
          kind: "web",
          subscription: {
            ...endpoint,
            endpoint: `https://fcm.googleapis.com/fcm/send/batch-${i}-${j}`,
          },
          language: "en",
          categories: ["driverLicense"],
          enrolledBySessionHash: "a".repeat(64),
        });
    }
    await f.store.run(
      "UPDATE settings SET value=? WHERE key=?",
      JSON.stringify(registry),
      notificationRegistryKey,
    );
    const result = await f.dispatch();
    assert.equal(result.status, 200);
    assert.equal(result.data.sent, 500);
    assert.equal(result.data.remaining, 0);
    assert.equal(calls, 500);
    assert.equal(maximum, 20);
    assert.ok(
      (await f.registry()).devices.every(
        (entry) => entry.lastSuccessDay === "2026-11-25" && !entry.claim,
      ),
    );
  },
);

test("a check completed during a running dispatch clears reminders before the next batch", async (t) => {
  let f,
    calls = 0;
  f = await fixture(t, {
    sender: async () => {
      calls++;
      if (calls === 20)
        await f.store.run(
          "UPDATE settings SET value=? WHERE key='state'",
          JSON.stringify(emptyState()),
        );
      return { ok: true };
    },
  });
  await f.req("/notifications/status", undefined, f.owner.cookie);
  const registry = await f.registry(),
    endpoint = subscription("fresh-batch");
  for (let i = 0; i < 5; i++) {
    const user = await f.store.get(
      "INSERT INTO users (username,salt,hash,role) VALUES (?,?,?,?) RETURNING id",
      `fresh_user_${i}`,
      f.salt,
      f.hash,
      "staff",
    );
    for (let j = 0; j < 5; j++)
      registry.devices.push({
        id: randomUUID(),
        userId: user.id,
        kind: "web",
        subscription: {
          ...endpoint,
          endpoint: `https://fcm.googleapis.com/fcm/send/fresh-${i}-${j}`,
        },
        language: "en",
        categories: ["driverLicense"],
        enrolledBySessionHash: "a".repeat(64),
      });
  }
  await f.store.run(
    "UPDATE settings SET value=? WHERE key=?",
    JSON.stringify(registry),
    notificationRegistryKey,
  );
  const result = await f.dispatch();
  assert.equal(result.status, 200);
  assert.equal(result.data.sent, 20);
  assert.equal(result.data.skipped, 5);
  assert.equal(result.data.remaining, 0);
  assert.equal(calls, 20);
});
