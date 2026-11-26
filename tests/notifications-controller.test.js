import test from "node:test";
import assert from "node:assert/strict";
import { createNotificationController } from "../src/notifications.js";
import { localReminderPlan } from "../shared/notification-reminders.js";

const RANGE_MIN = 1100000000;
const RANGE_MAX = 1100999999;
const ALL = ["nsd", "inspection", "driverChange", "driverLicense"];
const NOW = new Date("2026-11-25T08:00:00.000Z");
const publicKey = (byte) =>
  Buffer.from([4, ...Array(64).fill(byte)]).toString("base64url");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("The test fixture did not reach its expected asynchronous stage");
}
function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}
function storedPreferences(storage) {
  return [...storage.values.values()].flatMap((stored) => {
    try {
      const value = JSON.parse(stored);
      return value && typeof value === "object" && !Array.isArray(value)
        ? [value]
        : [];
    } catch {
      return [];
    }
  });
}
function future(id = RANGE_MIN + 101, overrides = {}) {
  return {
    id,
    at: "2026-11-27T03:30:00.000Z",
    title: "Shepards Tyre Management",
    body: "2 reminders need attention.",
    data: { kind: "reminders", day: "2026-11-27" },
    ...overrides,
  };
}
function snapshot(overrides = {}) {
  return {
    state: { revision: 1, notifications: [future()] },
    user: { id: 7, username: "public-test-owner" },
    server: "https://fleet.example.test",
    lang: "en",
    categories: [...ALL],
    online: true,
    fresh: true,
    ...overrides,
  };
}
function backend(overrides = {}) {
  const calls = [];
  const hooks = {};
  const config = {
    web: { configured: true, vapidPublicKey: publicKey(1) },
    native: { android: false, ios: false },
    cronConfigured: true,
    remoteRemindersConfigured: true,
    ...overrides,
  };
  return {
    calls,
    config,
    hooks,
    request: async (path, body) => {
      calls.push({ path, body });
      if (hooks[path]) return hooks[path](body);
      if (path === "/notifications/status") return structuredClone(config);
      if (path === "/notifications/devices")
        return {
          deviceId: "public-test-device",
          kind: body.kind,
          remoteDeliveryConfigured: config.cronConfigured === true,
        };
      if (
        path === "/notifications/unsubscribe" ||
        path === "/notifications/test"
      )
        return { ok: true };
      assert.fail(`Unexpected fixture request: ${path}`);
    },
  };
}
function localPlugin({ permission = "granted" } = {}) {
  let allowed = permission;
  const pending = new Map([
    [42, { id: 42, title: "Unrelated app notification" }],
  ]);
  const delivered = new Map([[99, { id: 99 }]]);
  const handlers = new Map();
  const calls = {
    checks: 0,
    prompts: 0,
    schedules: [],
    cancels: [],
    removed: [],
  };
  const plugin = {
    checkPermissions: async () => {
      calls.checks++;
      return { display: allowed };
    },
    requestPermissions: () => {
      calls.prompts++;
      if (allowed !== "denied") allowed = "granted";
      return Promise.resolve({ display: allowed });
    },
    getPending: async () => ({ notifications: [...pending.values()] }),
    schedule: async ({ notifications }) => {
      calls.schedules.push(notifications);
      for (const item of notifications) pending.set(item.id, item);
    },
    cancel: async ({ notifications }) => {
      calls.cancels.push(notifications);
      for (const item of notifications) pending.delete(item.id);
    },
    getDeliveredNotifications: async () => ({
      notifications: [...delivered.values()],
    }),
    removeDeliveredNotifications: async ({ notifications }) => {
      calls.removed.push(notifications);
      for (const item of notifications) delivered.delete(item.id);
    },
    addListener: async (name, callback) => {
      handlers.set(name, callback);
      return { remove: async () => handlers.delete(name) };
    },
    createChannel: async () => {},
  };
  return { plugin, calls, pending, delivered, handlers };
}
function pushPlugin({ failRegistration = false } = {}) {
  const handlers = new Map();
  const calls = { register: 0, unregister: 0, prompts: 0 };
  const plugin = {
    checkPermissions: async () => ({ receive: "granted" }),
    requestPermissions: async () => {
      calls.prompts++;
      return { receive: "granted" };
    },
    addListener: async (name, callback) => {
      handlers.set(name, callback);
      return { remove: async () => handlers.delete(name) };
    },
    register: async () => {
      calls.register++;
      queueMicrotask(() =>
        failRegistration
          ? handlers.get("registrationError")?.({
              error: "public test failure",
            })
          : handlers.get("registration")?.({
              value: "public-test-native-token",
            }),
      );
    },
    unregister: async () => {
      calls.unregister++;
    },
  };
  return { plugin, calls, handlers };
}
function nativeFixture(options = {}) {
  const server = backend(options.config);
  const local = localPlugin(options.local);
  const push = pushPlugin(options.push);
  const plans = [];
  const storage = memoryStorage();
  const controllerOptions = {
    nativePlatform: "android",
    nativePushConfigured: false,
    request: server.request,
    storage,
    plugins: { local: local.plugin, push: push.plugin },
    now: () => new Date(NOW),
    timeoutMs: 150,
    plan: (state, settings) => {
      plans.push(settings);
      return {
        items: state.notifications || [],
        truncated: false,
        asOf: NOW.toISOString(),
      };
    },
    ...options.controller,
  };
  const controller = createNotificationController(controllerOptions);
  return { controller, controllerOptions, server, local, push, plans, storage };
}
function webFixture({
  permission = "granted",
  ios = false,
  standalone = true,
  config = {},
} = {}) {
  const server = backend(config),
    storage = memoryStorage();
  const calls = { prompts: 0, subscribes: [], unsubscribes: 0 };
  let subscription = null;
  const Notification = {
    permission,
    requestPermission: () => {
      calls.prompts++;
      Notification.permission = "granted";
      return Promise.resolve("granted");
    },
  };
  const makeSubscription = (key) => ({
    endpoint: "https://push.example.test/public-test-device",
    options: { applicationServerKey: key },
    toJSON: () => ({
      endpoint: "https://push.example.test/public-test-device",
      keys: { p256dh: "public-test-key", auth: "public-test-auth" },
    }),
    unsubscribe: async () => {
      calls.unsubscribes++;
      subscription = null;
      return true;
    },
  });
  const registration = {
    pushManager: {
      getSubscription: async () => subscription,
      subscribe: async (options) => {
        calls.subscribes.push(options);
        subscription = makeSubscription(options.applicationServerKey);
        return subscription;
      },
    },
  };
  const navigator = {
    onLine: true,
    userAgent: ios
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605.1.15"
      : "Mozilla/5.0 Chrome/131",
    serviceWorker: { addEventListener() {}, removeEventListener() {} },
  };
  const clock = { now: new Date(NOW) };
  const controllerOptions = {
    request: server.request,
    storage,
    Notification,
    navigator,
    PushManager: function PushManager() {},
    getRegistration: async () => registration,
    isStandalone: () => standalone,
    origin: "https://fleet.example.test",
    now: () => new Date(clock.now),
    timeoutMs: 150,
  };
  const controller = createNotificationController(controllerOptions);
  return {
    controller,
    controllerOptions,
    clock,
    server,
    storage,
    calls,
    Notification,
    registration,
    makeSubscription,
    get subscription() {
      return subscription;
    },
    set subscription(value) {
      subscription = value;
    },
  };
}

test("construction, status and sync never prompt for OS permission or auto-enroll a device", async () => {
  const native = nativeFixture({ local: { permission: "prompt" } });
  assert.equal(native.controller.status().enabled, false);
  await native.controller.sync(snapshot());
  assert.equal(native.local.calls.prompts, 0);
  assert.equal(native.push.calls.register, 0);
  assert.equal(native.local.calls.schedules.length, 0);
  const web = webFixture({ permission: "default" });
  await web.controller.sync(snapshot());
  assert.equal(web.calls.prompts, 0);
  assert.equal(web.calls.subscribes.length, 0);
});

test("an unconfigured native app schedules phone reminders without ever calling Firebase registration or unregister", async () => {
  const f = nativeFixture({
    local: { permission: "prompt" },
    config: { native: { android: true, ios: false } },
  });
  const enabled = await f.controller.enable(snapshot());
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.delivery, "local");
  assert.equal(f.local.calls.prompts, 1);
  assert.equal(f.push.calls.register, 0);
  assert.equal(f.local.pending.has(future().id), true);
  const scheduled = f.local.pending.get(future().id);
  assert.ok(scheduled.schedule.at instanceof Date);
  assert.deepEqual(scheduled.extra, { kind: "reminders", day: "2026-11-27" });
  assert.equal(f.plans[0].catchUp, true);
  await f.controller.cleanup();
  assert.equal(f.push.calls.unregister, 0);
  assert.equal(f.local.pending.has(42), true);
  assert.equal(f.local.delivered.has(99), true);
  assert.ok(
    f.local.calls.cancels
      .flat()
      .every(({ id }) => id >= RANGE_MIN && id <= RANGE_MAX),
  );
});

test("live reconciliation removes completed reminders and updates category/language without requesting permission during sync", async () => {
  const f = nativeFixture();
  await f.controller.enable(snapshot());
  const changed = snapshot({
    lang: "hi",
    categories: ["nsd", "driverLicense"],
    state: {
      revision: 2,
      notifications: [
        future(RANGE_MIN + 102, { body: "दो रिमाइंडर देय हैं।" }),
      ],
    },
  });
  await f.controller.enable(changed);
  assert.equal(f.local.pending.has(RANGE_MIN + 101), false);
  assert.equal(f.local.pending.has(RANGE_MIN + 102), true);
  assert.deepEqual(f.plans.at(-1).categories, ["nsd", "driverLicense"]);
  assert.equal(f.plans.at(-1).language, "hi");
  const explicitPermissionRequests = f.local.calls.prompts;
  await f.controller.sync({
    ...changed,
    state: { revision: 3, notifications: [] },
  });
  assert.equal(f.plans.at(-1).catchUp, false);
  assert.equal(f.local.pending.has(RANGE_MIN + 102), false);
  assert.equal(f.local.pending.has(42), true);
  assert.equal(f.local.calls.prompts, explicitPermissionRequests);
});

test("a missing future alarm is restored, and turning reminders off then on creates a fresh schedule", async () => {
  const f = nativeFixture();
  await f.controller.enable(snapshot());
  f.local.pending.delete(future().id);
  await f.controller.sync(
    snapshot({ state: { revision: 2, notifications: [future()] } }),
  );
  assert.equal(
    f.local.pending.has(future().id),
    true,
    "future reminders must not disappear merely because a scheduling receipt exists",
  );
  await f.controller.disable();
  assert.equal(f.local.pending.has(future().id), false);
  await f.controller.enable(snapshot());
  assert.equal(
    f.local.pending.has(future().id),
    true,
    "explicit re-enable must not inherit receipts that suppress the new schedule",
  );
});

test("iPhone Safari requires a Home Screen installation before any permission prompt", async () => {
  const f = webFixture({ permission: "default", ios: true, standalone: false });
  const state = await f.controller.enable(snapshot());
  assert.equal(state.enabled, false);
  assert.equal(state.reason, "installRequired");
  assert.equal(f.calls.prompts, 0);
  assert.equal(f.calls.subscribes.length, 0);
});

test("deliberate web enable requests permission synchronously and enrolls a genuine PushManager subscription", async () => {
  const f = webFixture({ permission: "default" });
  const enabling = f.controller.enable(snapshot());
  assert.equal(
    f.calls.prompts,
    1,
    "permission must be requested within the click before asynchronous account/server work",
  );
  const enabled = await enabling;
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.delivery, "remote");
  assert.equal(f.calls.subscribes.length, 1);
  assert.equal(f.calls.subscribes[0].userVisibleOnly, true);
  assert.deepEqual(
    [...f.calls.subscribes[0].applicationServerKey],
    [...Buffer.from(publicKey(1), "base64url")],
  );
  const enrollment = f.server.calls.find(
    (call) => call.path === "/notifications/devices",
  ).body;
  assert.equal(enrollment.kind, "web");
  assert.deepEqual(enrollment.subscription, f.subscription.toJSON());
  assert.deepEqual(enrollment.categories, ALL);
  await f.controller.test();
  assert.deepEqual(
    f.server.calls.find((call) => call.path === "/notifications/test").body,
    { deviceId: "public-test-device" },
  );
});

test("missing server cron cannot be reported as enabled web reminders", async () => {
  const f = webFixture({
    config: { cronConfigured: false, remoteRemindersConfigured: false },
  });
  const result = await f.controller.enable(snapshot());
  assert.equal(result.enabled, false);
  assert.equal(result.delivery, "off");
  assert.equal(result.reason, "serverNotReady");
  assert.equal(f.calls.subscribes.length, 0);
});

test("logout cancels a permission flow in progress and cannot schedule alerts after cleanup", async () => {
  const f = nativeFixture({ local: { permission: "prompt" } });
  const permission = deferred();
  f.local.plugin.requestPermissions = () => {
    f.local.calls.prompts++;
    return permission.promise;
  };
  const enabling = f.controller.enable(snapshot());
  await until(() => f.local.calls.prompts === 1);
  const cleanup = f.controller.cleanup();
  permission.resolve({ display: "granted" });
  await Promise.all([enabling, cleanup]);
  assert.equal(f.controller.status().enabled, false);
  assert.equal(f.controller.status().delivery, "off");
  assert.equal(f.local.calls.schedules.length, 0);
  assert.equal(f.local.pending.has(42), true);
});

test("native remote enrollment cancels old phone alarms and notification actions route only inside the app", async () => {
  const navigation = [];
  const f = nativeFixture({
    config: { native: { android: true, ios: false } },
    controller: {
      nativePushConfigured: true,
      onNavigate: (target) => navigation.push(target),
    },
  });
  f.local.pending.set(RANGE_MIN + 88, { id: RANGE_MIN + 88 });
  const enabled = await f.controller.enable(snapshot());
  assert.equal(enabled.delivery, "remote");
  assert.equal(enabled.enabled, true);
  assert.equal(f.push.calls.register, 1);
  assert.equal(f.local.calls.schedules.length, 0);
  assert.equal(f.local.pending.has(RANGE_MIN + 88), false);
  assert.equal(f.local.pending.has(42), true);
  const enrollment = f.server.calls.find(
    (call) => call.path === "/notifications/devices",
  ).body;
  assert.equal(enrollment.kind, "android");
  assert.equal(enrollment.token, "public-test-native-token");
  f.push.handlers.get("pushNotificationActionPerformed")({
    notification: {
      data: { kind: "reminders", url: "https://untrusted.example.test" },
    },
  });
  f.push.handlers.get("pushNotificationActionPerformed")({
    notification: {
      data: { kind: "other", url: "https://untrusted.example.test" },
    },
  });
  assert.deepEqual(navigation, ["dashboard"]);
  await f.controller.cleanup();
  assert.equal(f.push.handlers.has("pushNotificationActionPerformed"), false);
});

test("native registration failure uses explicit local delivery without requiring Firebase", async () => {
  const f = nativeFixture({
    config: { native: { android: true, ios: false } },
    push: { failRegistration: true },
    controller: { nativePushConfigured: true },
  });
  const enabled = await f.controller.enable(snapshot());
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.delivery, "local");
  assert.equal(enabled.remoteAvailable, false);
  assert.equal(f.local.pending.has(future().id), true);
  assert.equal(f.push.calls.register, 1);
  assert.equal(f.push.calls.unregister, 1);
});

test("a failed remote enrollment cannot fall back when both server and OS revocation fail", async () => {
  const f = nativeFixture({
    config: { native: { android: true, ios: false } },
    controller: { nativePushConfigured: true },
  });
  f.server.hooks["/notifications/devices"] = async () => ({
    deviceId: "public-test-device",
    remoteDeliveryConfigured: false,
  });
  f.server.hooks["/notifications/unsubscribe"] = async () => {
    throw Object.assign(new Error("public test disconnect"), { status: 503 });
  };
  f.push.plugin.unregister = async () => {
    f.push.calls.unregister++;
    throw new Error("public OS revocation failure");
  };
  const result = await f.controller.enable(snapshot());
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "cleanupPending");
  assert.equal(
    f.local.calls.schedules.length,
    0,
    "remote/local delivery must not overlap when remote cleanup is uncertain",
  );
});

test("blocked permission stays visibly off and never requests permission again automatically", async () => {
  const native = nativeFixture({ local: { permission: "denied" } });
  const denied = await native.controller.enable(snapshot());
  assert.equal(denied.enabled, false);
  assert.equal(denied.reason, "permissionDenied");
  const requestsAfterExplicitClick = native.local.calls.prompts;
  await native.controller.sync(snapshot());
  assert.equal(native.local.calls.prompts, requestsAfterExplicitClick);
  assert.equal(native.local.calls.schedules.length, 0);
  const web = webFixture({ permission: "denied" });
  const browserDenied = await web.controller.enable(snapshot());
  assert.equal(browserDenied.enabled, false);
  assert.equal(browserDenied.reason, "permissionDenied");
  assert.equal(web.calls.prompts, 0);
  assert.equal(web.calls.subscribes.length, 0);
});

test("offline snapshots preserve the last known local schedule while exposing that it is stale", async () => {
  const f = nativeFixture();
  await f.controller.enable(snapshot());
  const oldSync = f.controller.status().lastSyncedAt;
  const result = await f.controller.sync(
    snapshot({
      online: false,
      fresh: false,
      state: { revision: 2, notifications: [] },
    }),
  );
  assert.equal(result.delivery, "local");
  assert.equal(result.stale, true);
  assert.equal(result.reason, "offlineSnapshot");
  assert.equal(result.lastSyncedAt, oldSync);
  assert.equal(f.local.pending.has(future().id), true);
});

test("account or server changes never transfer notification consent to the next identity", async (t) => {
  for (const [name, change] of [
    ["another account", { user: { id: 8, username: "another-public-user" } }],
    ["another server", { server: "https://other-fleet.example.test" }],
  ])
    await t.test(name, async () => {
      const f = nativeFixture();
      await f.controller.enable(snapshot());
      const scheduleCount = f.local.calls.schedules.length;
      const result = await f.controller.sync(snapshot(change));
      assert.equal(result.enabled, false);
      assert.equal(result.delivery, "off");
      assert.equal(f.local.calls.schedules.length, scheduleCount);
      assert.equal(f.local.pending.has(future().id), false);
      assert.equal(f.local.pending.has(42), true);
    });
});

test("a persisted web preference may resume permission checks but never prompts during sync", async () => {
  const f = webFixture();
  await f.controller.enable(snapshot());
  f.Notification.permission = "default";
  const reopened = createNotificationController(f.controllerOptions);
  const result = await reopened.sync(snapshot());
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "permissionRequired");
  assert.equal(f.calls.prompts, 0);
  assert.equal(f.calls.subscribes.length, 1);
});

test("logout removes a server enrollment that completes while cleanup is waiting", async () => {
  const f = webFixture();
  const registration = deferred();
  f.server.hooks["/notifications/devices"] = () => registration.promise;
  const enabling = f.controller.enable(snapshot());
  await until(() =>
    f.server.calls.some((call) => call.path === "/notifications/devices"),
  );
  const cleanup = f.controller.cleanup();
  registration.resolve({
    deviceId: "late-public-test-device",
    remoteDeliveryConfigured: true,
  });
  await Promise.all([enabling, cleanup]);
  assert.equal(f.controller.status().enabled, false);
  assert.equal(f.controller.status().delivery, "off");
  assert.deepEqual(
    f.server.calls.find((call) => call.path === "/notifications/unsubscribe")
      .body,
    { deviceId: "late-public-test-device" },
  );
  assert.ok(f.calls.unsubscribes >= 1);
});

test("VAPID rotation requires deliberate re-enrollment and then replaces the old subscription", async () => {
  const f = webFixture();
  await f.controller.enable(snapshot());
  f.server.config.web.vapidPublicKey = publicKey(2);
  f.clock.now = new Date(Number(NOW) + 61000);
  const changed = await f.controller.sync(
    snapshot({ state: { revision: 2, notifications: [] } }),
  );
  assert.equal(changed.enabled, false);
  assert.equal(changed.reason, "reEnrollmentRequired");
  assert.equal(
    f.calls.subscribes.length,
    1,
    "sync must not silently create a replacement subscription",
  );
  const enabled = await f.controller.enable(snapshot());
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.delivery, "remote");
  assert.ok(f.calls.unsubscribes >= 1);
  assert.equal(f.calls.subscribes.length, 2);
  assert.deepEqual(
    [...f.calls.subscribes.at(-1).applicationServerKey],
    [...Buffer.from(publicKey(2), "base64url")],
  );
});

test("real overdue plans retain one queued catch-up, do not repeat it after delivery, and keep future daily reminders", async () => {
  let clock = new Date(NOW);
  const f = nativeFixture({
    controller: { now: () => new Date(clock), plan: localReminderPlan },
  });
  const overdue = {
    revision: 1,
    vehicles: [],
    tyres: [],
    events: [],
    drivers: [
      {
        id: "public-overdue-driver",
        name: "Public test driver",
        dob: "1980-01-01",
        licenseNo: "PUBLIC-12345",
        licenseExpiry: "2026-11-20",
        active: true,
      },
    ],
  };
  const consent = snapshot({ state: overdue, categories: ["driverLicense"] });
  await f.controller.enable(consent);
  const catchUp = [...f.local.pending.values()].find(
    (item) => item.extra?.day === "2026-11-25",
  );
  assert.ok(
    catchUp,
    "explicit Enable schedules one immediate reminder for existing overdue work",
  );
  assert.ok(
    [...f.local.pending.values()].some(
      (item) => item.extra?.day > "2026-11-25",
    ),
    "daily phone reminders remain available while the app is closed",
  );
  assert.ok(f.local.calls.schedules.flat().length <= 50);
  clock = new Date(Number(NOW) + 1000);
  await f.controller.sync({ ...consent, state: { ...overdue, revision: 2 } });
  assert.equal(
    f.local.pending.has(catchUp.id),
    true,
    "an ordinary poll must not cancel a not-yet-delivered catch-up",
  );
  assert.equal(
    f.local.calls.schedules.flat().filter((item) => item.id === catchUp.id)
      .length,
    1,
  );
  f.local.pending.delete(catchUp.id);
  clock = new Date(Number(NOW) + 10000);
  await f.controller.sync({ ...consent, state: { ...overdue, revision: 3 } });
  assert.equal(f.local.pending.has(catchUp.id), false);
  assert.equal(
    f.local.calls.schedules.flat().filter((item) => item.id === catchUp.id)
      .length,
    1,
    "the already-delivered catch-up must not be queued a second time today",
  );
  assert.ok(
    [...f.local.pending.values()].some(
      (item) => item.extra?.day > "2026-11-25",
    ),
  );
  await f.controller.sync({
    ...consent,
    state: { ...overdue, revision: 4, drivers: [] },
  });
  assert.equal(
    [...f.local.pending.keys()].some(
      (id) => id >= RANGE_MIN && id <= RANGE_MAX,
    ),
    false,
  );
  assert.equal(f.local.pending.has(42), true);
});

test("rapid native cleanup followed by another user's explicit Enable cannot cancel the new user's schedule", async () => {
  const f = nativeFixture();
  await f.controller.enable(snapshot());
  const cancelGate = deferred();
  const originalCancel = f.local.plugin.cancel;
  let entered = false;
  f.local.plugin.cancel = async (options) => {
    if (!entered) {
      entered = true;
      await cancelGate.promise;
    }
    return originalCancel(options);
  };
  const cleanup = f.controller.cleanup();
  await until(() => entered);
  const next = f.controller.enable(
    snapshot({
      user: { id: 8 },
      categories: ["inspection"],
      state: { revision: 2, notifications: [future(RANGE_MIN + 202)] },
    }),
  );
  cancelGate.resolve();
  await Promise.all([cleanup, next]);
  assert.equal(f.controller.status().enabled, true);
  assert.equal(f.controller.status().delivery, "local");
  assert.deepEqual(f.controller.status().categories, ["inspection"]);
  assert.equal(f.local.pending.has(RANGE_MIN + 101), false);
  assert.equal(f.local.pending.has(RANGE_MIN + 202), true);
  assert.equal(f.local.pending.has(42), true);
});

test("a restored server registry requires explicit enrollment retry with the stale device ID removed", async () => {
  const f = webFixture();
  await f.controller.enable(snapshot());
  f.server.hooks["/notifications/devices"] = async (body) => {
    if (body.deviceId)
      throw Object.assign(new Error("public missing test registration"), {
        status: 404,
      });
    return {
      deviceId: "public-restored-device",
      kind: "web",
      remoteDeliveryConfigured: true,
    };
  };
  const syncing = await f.controller.sync(
    // A language preference change requires an upsert. An unrelated fleet
    // revision should use the cached registration without probing the server.
    snapshot({ lang: "hi", state: { revision: 2, notifications: [] } }),
  );
  assert.equal(syncing.enabled, false);
  assert.equal(syncing.reason, "reEnrollmentRequired");
  const enabled = await f.controller.enable(snapshot({ lang: "hi" }));
  assert.equal(enabled.enabled, true);
  const lastEnrollment = f.server.calls
    .filter((call) => call.path === "/notifications/devices")
    .at(-1);
  assert.equal(Object.hasOwn(lastEnrollment.body, "deviceId"), false);
  await f.controller.test();
  assert.deepEqual(
    f.server.calls.filter((call) => call.path === "/notifications/test").at(-1)
      .body,
    { deviceId: "public-restored-device" },
  );
});

test("native cleanup keeps the server binding pending when backend removal fails despite unregister resolving", async () => {
  const f = nativeFixture({
    config: { native: { android: true, ios: false } },
    controller: { nativePushConfigured: true },
  });
  await f.controller.enable(snapshot());
  f.local.pending.set(RANGE_MIN + 55, { id: RANGE_MIN + 55 });
  f.server.hooks["/notifications/unsubscribe"] = async () => {
    throw Object.assign(new Error("public offline backend"), { status: 503 });
  };
  const result = await f.controller.cleanup();
  assert.equal(result.enabled, false);
  assert.equal(result.delivery, "off");
  assert.equal(result.reason, "cleanupPending");
  assert.equal(f.push.calls.unregister, 1);
  assert.equal(f.local.pending.has(RANGE_MIN + 55), false);
  assert.equal(f.local.pending.has(42), true);
  assert.ok(
    storedPreferences(f.storage).some(
      (value) => value.deviceId === "public-test-device",
    ),
    "native unregister does not prove provider token revocation, so backend removal must remain retryable",
  );
});

test("web cleanup succeeds offline when PushManager confirms the subscription was removed", async () => {
  const f = webFixture();
  await f.controller.enable(snapshot());
  f.server.hooks["/notifications/unsubscribe"] = async () => {
    throw Object.assign(new Error("public offline backend"), { status: 503 });
  };
  const result = await f.controller.cleanup();
  assert.equal(result.enabled, false);
  assert.equal(result.delivery, "off");
  assert.equal(result.reason, "notEnabled");
  assert.equal(f.calls.unsubscribes, 1);
  assert.equal(f.subscription, null);
  for (const value of storedPreferences(f.storage)) {
    assert.equal(
      value.deviceId ?? null,
      null,
      "an unsubscribed browser endpoint must not retain the old registration ID",
    );
  }
});

test("unchanged remote preferences do not re-register on every synchronized fleet revision", async (t) => {
  for (const platform of ["native", "web"])
    await t.test(platform, async () => {
      const f =
        platform === "native"
          ? nativeFixture({
              config: { native: { android: true, ios: false } },
              controller: { nativePushConfigured: true },
            })
          : webFixture();
      await f.controller.enable(snapshot());
      const enrollments = f.server.calls.filter(
        (call) => call.path === "/notifications/devices",
      ).length;
      const registrations =
        platform === "native"
          ? f.push.calls.register
          : f.calls.subscribes.length;
      for (let revision = 2; revision <= 6; revision++)
        await f.controller.sync(
          snapshot({ state: { revision, notifications: [] } }),
        );
      assert.equal(f.controller.status().enabled, true);
      assert.equal(f.controller.status().delivery, "remote");
      assert.equal(
        f.server.calls.filter((call) => call.path === "/notifications/devices")
          .length,
        enrollments,
        "fleet changes do not require another unchanged device enrollment",
      );
      assert.equal(
        platform === "native"
          ? f.push.calls.register
          : f.calls.subscribes.length,
        registrations,
        "an unchanged subscription or native token should be reused",
      );
    });
});

test("a restarted app cancels the previous account's phone alarms before adopting a different account", async () => {
  const f = nativeFixture();
  await f.controller.enable(snapshot());
  assert.equal(f.local.pending.has(future().id), true);
  // Simulate a new JS runtime: device storage and OS alarms survive, while
  // in-memory controller identity/listeners do not.
  f.local.handlers.clear();
  const reopened = createNotificationController(f.controllerOptions);
  const result = await reopened.sync(
    snapshot({ user: { id: 8, username: "public-next-account" } }),
  );
  assert.equal(result.enabled, false);
  assert.equal(result.delivery, "off");
  assert.equal(
    f.local.pending.has(future().id),
    false,
    "an old account's alarms must not survive account adoption after restart",
  );
  assert.equal(f.local.pending.has(42), true);
  assert.equal(f.push.calls.register, 0);
});

test("cleanup on an untouched controller performs no native bridge calls or backend requests", async () => {
  const calls = [];
  const forbidden = new Proxy(
    {},
    {
      get: (_target, method) => () => {
        calls.push(method);
        throw new Error("Unexpected bridge access");
      },
    },
  );
  const f = nativeFixture({
    controller: {
      plugins: { local: forbidden, push: forbidden },
      nativePushConfigured: () => {
        calls.push("config");
        return false;
      },
    },
  });
  const result = await f.controller.cleanup();
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "notEnabled");
  assert.deepEqual(calls, []);
  assert.deepEqual(f.server.calls, []);
});

test("native token refresh uses an absolute one-hour TTL even while fleet revisions keep arriving", async () => {
  const clock = { now: new Date(NOW) };
  const f = nativeFixture({
    config: { native: { android: true, ios: false } },
    controller: { nativePushConfigured: true, now: () => clock.now },
  });
  await f.controller.enable(snapshot());
  assert.equal(f.push.calls.register, 1);
  for (const minutes of [30, 59]) {
    clock.now = new Date(Number(NOW) + minutes * 60000);
    await f.controller.sync(
      snapshot({ state: { revision: minutes, notifications: [] } }),
    );
    assert.equal(
      f.push.calls.register,
      1,
      "ordinary revisions reuse the registered token",
    );
  }
  clock.now = new Date(Number(NOW) + 61 * 60000);
  await f.controller.sync(
    snapshot({ state: { revision: 61, notifications: [] } }),
  );
  assert.equal(
    f.push.calls.register,
    2,
    "the original token must be refreshed after an hour",
  );
  await f.controller.cleanup();
});

test("Capacitor plugin proxies are never assimilated as promises", async (t) => {
  for (const delivery of ["local", "remote"])
    await t.test(delivery, async () => {
      const f = nativeFixture({
        config: { native: { android: delivery === "remote", ios: false } },
        controller: { nativePushConfigured: delivery === "remote" },
      });
      const thenReads = [];
      const proxy = (api, name) =>
        new Proxy(api, {
          get(target, key, receiver) {
            if (key === "then") {
              thenReads.push(name);
              throw new Error(`The ${name} plugin does not implement then()`);
            }
            return Reflect.get(target, key, receiver);
          },
        });
      const controller = createNotificationController({
        ...f.controllerOptions,
        plugins: {
          local: proxy(f.local.plugin, "LocalNotifications"),
          push: proxy(f.push.plugin, "PushNotifications"),
        },
      });
      const enabled = await controller.enable(snapshot());
      assert.equal(enabled.enabled, true);
      assert.equal(enabled.delivery, delivery);
      await controller.test();
      await controller.cleanup();
      assert.deepEqual(
        thenReads,
        [],
        "native APIs must be called directly on the plugin proxy",
      );
    });
});
