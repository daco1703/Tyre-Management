const { chromium } = require("playwright");
const { spawn, spawnSync } = require("node:child_process");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

// This server and every account/record are disposable fixtures. Provider and
// external-database environment variables are cleared: no live fleet or real
// push provider is contacted by the suite.
const root = path.resolve(__dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "shepards-notifications-ui-"));
const base = `http://127.0.0.1:${process.env.NOTIFICATIONS_TEST_PORT || 3160}`;
const artifacts = path.join(root, "artifacts/notifications-review");
mkdirSync(artifacts, { recursive: true });
const environment = {
  ...process.env,
  DATABASE_URL: "",
  POSTGRES_URL: "",
  VERCEL: "0",
  DATABASE_PATH: path.join(temp, "notifications.sqlite"),
  PUBLIC_ORIGIN: "",
  TRUST_PROXY: "0",
  CRON_SECRET: "",
  VAPID_PUBLIC_KEY: "",
  VAPID_PRIVATE_KEY: "",
  VAPID_SUBJECT: "",
  FCM_SERVICE_ACCOUNT: "",
  APNS_KEY: "",
  APNS_TEAM_ID: "",
  APNS_KEY_ID: "",
  APNS_TOPIC: "",
  APNS_ENVIRONMENT: "",
};
const password = "public-notifications-ui-password";
const seeded = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
  import {createApp} from './server/app.js';
  import {emptyState,dayKey} from './shared/model.js';
  import {scryptSync} from 'node:crypto';
  const {db}=createApp({dbPath:process.env.DATABASE_PATH});
  const salt='public-notifications-ui-salt', hash=scryptSync('public-notifications-ui-password',salt,64).toString('hex');
  db.prepare("UPDATE users SET username=?,salt=?,hash=? WHERE role='owner'").run('notifications_owner',salt,hash);
  db.prepare("INSERT INTO users (username,salt,hash,role,active) VALUES (?,?,?,?,?)").run('notifications_staff',salt,hash,'staff',1);
  const yesterday=new Date(dayKey()+'T12:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);
  const state=emptyState();
  state.drivers=[{id:'public-notification-driver',name:'Public Notification Driver',dob:'1985-01-01',licenseNo:'PUBLIC-12345',licenseExpiry:yesterday.toISOString().slice(0,10),active:true}];
  db.prepare("UPDATE settings SET value=? WHERE key='state'").run(JSON.stringify(state));db.close();
`,
  ],
  { cwd: root, env: environment, encoding: "utf8" },
);
assert.equal(seeded.status, 0, seeded.stderr);
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: root,
  env: { ...environment, NODE_ENV: "production", PORT: new URL(base).port },
  stdio: "pipe",
});
let logs = "",
  browser,
  page,
  dictionaries,
  locale = "en";
const errors = [],
  checks = [];
server.stdout.on("data", (data) => {
  logs += data;
});
server.stderr.on("data", (data) => {
  logs += data;
});
const t = (key) => dictionaries[locale][key] || dictionaries.en[key] || key;
async function login(context, username = "notifications_owner") {
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  locale = "en";
  await page.goto(base);
  await page.locator("input[name=username]").fill(username);
  await page.locator("input[name=password]").fill(password);
  await page
    .getByRole("button", { name: t("submitLogin"), exact: true })
    .click();
  await page
    .getByRole("heading", { name: t("fleetOverview"), exact: true })
    .waitFor();
}
async function settings() {
  if (await page.locator(".mobile-nav-items").isVisible())
    await page.locator(".mobile-settings:visible").click();
  else
    await page
      .locator(".sidebar .nav-items")
      .getByRole("button", { name: t("settings"), exact: true })
      .click();
  await page.getByTestId("notification-settings").waitFor();
}
async function language(next) {
  if (locale === next) return;
  await page.locator(".language-switch:visible").first().click();
  await page.waitForFunction(
    (lang) => document.documentElement.lang === lang,
    next,
  );
  locale = next;
}
const card = () => page.getByTestId("notification-settings");
async function reason(key) {
  await card()
    .locator('p[role="status"]')
    .filter({ hasText: t(`notificationReason_${key}`) })
    .waitFor();
}
async function layout(label, screenshot) {
  await page.evaluate(() => document.fonts.ready);
  const geometry = await card().evaluate((el) => {
    const small = [...el.querySelectorAll("button,.notification-category")]
      .filter((node) => node.getClientRects().length)
      .flatMap((node) => {
        const r = node.getBoundingClientRect();
        return r.width < 43.5 || r.height < 43.5
          ? [{ tag: node.tagName, width: r.width, height: r.height }]
          : [];
      });
    return {
      overflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
      small,
      inputs: [...el.querySelectorAll("input")].map((node) =>
        parseFloat(getComputedStyle(node).fontSize),
      ),
    };
  });
  assert.equal(
    geometry.overflow,
    false,
    `${label}: page overflows horizontally`,
  );
  assert.deepEqual(
    geometry.small,
    [],
    `${label}: effective touch targets smaller than 44px`,
  );
  assert.ok(
    geometry.inputs.every((font) => font >= 16),
    `${label}: input text below 16px`,
  );
  if (screenshot) {
    await card().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -90));
    await page.screenshot({
      path: path.join(artifacts, `${screenshot}.png`),
      fullPage: false,
    });
  }
  checks.push(label);
}

async function nativeContext() {
  const canonical = "https://www.shepards-tyre-management.com";
  const context = await browser.newContext({
    viewport: { width: 375, height: 900 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  });
  await context.addInitScript((server) => {
    window.CapacitorCustomPlatform = { name: "android" };
    localStorage.setItem("ts-server", JSON.stringify(server));
    localStorage.setItem("ts-lang", JSON.stringify("en"));
    localStorage.removeItem("ts-token");
    const bridge = (window.notificationBridge = {
      permission: "prompt",
      requests: 0,
      schedules: [],
      cancels: [],
      pushCalls: 0,
      pending: new Map([
        [42, { id: 42, title: "Unrelated fixture notification" }],
      ]),
      listeners: new Map(),
      nextId: 0,
      calls: [],
    });
    const methods = (names) =>
      names.map((name) => ({ name, rtype: "promise" }));
    const events = [
      { name: "addListener", rtype: "callback" },
      { name: "removeListener", rtype: "promise" },
    ];
    window.Capacitor = {
      PluginHeaders: [
        { name: "App", methods: [...events, ...methods(["exitApp"])] },
        { name: "NotificationConfig", methods: methods(["getStatus"]) },
        {
          name: "LocalNotifications",
          methods: [
            ...events,
            ...methods([
              "checkPermissions",
              "requestPermissions",
              "getPending",
              "schedule",
              "cancel",
              "createChannel",
              "getDeliveredNotifications",
              "removeDeliveredNotifications",
            ]),
          ],
        },
        {
          name: "PushNotifications",
          methods: [
            ...events,
            ...methods([
              "checkPermissions",
              "requestPermissions",
              "register",
              "unregister",
            ]),
          ],
        },
      ],
      nativeCallback(plugin, method, options, callback) {
        bridge.calls.push(`${plugin}.${method}`);
        if (method !== "addListener")
          throw new Error("Unexpected fixture callback");
        const id = String(++bridge.nextId);
        bridge.listeners.set(id, {
          plugin,
          event: options.eventName,
          callback,
        });
        return id;
      },
      async nativePromise(plugin, method, options) {
        bridge.calls.push(`${plugin}.${method}`);
        if (method === "removeListener") {
          bridge.listeners.delete(options.callbackId);
          return;
        }
        if (plugin === "App" && method === "exitApp") return;
        if (plugin === "NotificationConfig") return { configured: false };
        if (plugin === "PushNotifications") {
          bridge.pushCalls++;
          throw new Error(
            "Firebase must not be used in this unconfigured fixture",
          );
        }
        if (plugin !== "LocalNotifications")
          throw new Error("Unexpected native fixture plugin");
        if (method === "checkPermissions")
          return { display: bridge.permission };
        if (method === "requestPermissions") {
          bridge.requests++;
          bridge.permission = "granted";
          return { display: "granted" };
        }
        if (method === "getPending")
          return { notifications: [...bridge.pending.values()] };
        if (method === "schedule") {
          bridge.schedules.push(options.notifications);
          for (const item of options.notifications)
            bridge.pending.set(item.id, item);
          return;
        }
        if (method === "cancel") {
          bridge.cancels.push(options.notifications);
          for (const item of options.notifications)
            bridge.pending.delete(item.id);
          return;
        }
        if (method === "getDeliveredNotifications")
          return { notifications: [] };
        return {};
      },
    };
    window.openFixtureNotification = () => {
      const item = [...bridge.pending.values()].find(
        (entry) => entry.id >= 1100000000,
      );
      const listener = [...bridge.listeners.values()].find(
        (entry) =>
          entry.plugin === "LocalNotifications" &&
          entry.event === "localNotificationActionPerformed",
      );
      if (!item || !listener)
        throw new Error("Notification action listener missing");
      listener.callback({
        notification: {
          ...item,
          extra: { kind: "reminders", url: "https://untrusted.example.test" },
        },
      });
    };
  }, canonical);
  const unexpected = [],
    traffic = [],
    statuses = [];
  await context.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== canonical) {
      unexpected.push(request.url());
      return route.abort();
    }
    const cors = {
      "access-control-allow-origin": base,
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    traffic.push({
      path: url.pathname,
      bearer: /^Bearer [a-f0-9]{64}$/.test(
        request.headers().authorization || "",
      ),
    });
    try {
      const response = await context.request.fetch(
        base + url.pathname + url.search,
        {
          method: request.method(),
          headers: {
            "content-type": "application/json",
            origin: "https://localhost",
            cookie: "",
            ...(request.headers().authorization
              ? { authorization: request.headers().authorization }
              : {}),
          },
          ...(request.postData() ? { data: request.postData() } : {}),
        },
      );
      if (url.pathname === "/api/notifications/status" && response.ok())
        statuses.push(await response.json());
      await route.fulfill({
        response,
        headers: { ...response.headers(), ...cors },
      });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  return { context, unexpected, traffic, statuses };
}
async function nativeLocalFlow() {
  const f = await nativeContext();
  await login(f.context);
  await settings();
  assert.equal(await card().locator('input[type="checkbox"]').count(), 4);
  assert.equal(
    await page.evaluate(() => notificationBridge.requests),
    0,
    "login and settings must not prompt",
  );
  assert.equal(
    await page.evaluate(() => notificationBridge.schedules.length),
    0,
  );
  await card().getByTestId("enable-notifications").click();
  const diagnostic = setTimeout(async () => {
    try {
      console.log(
        "Native enable diagnostic",
        JSON.stringify(
          await page.evaluate(() => ({
            bridge: {
              calls: notificationBridge.calls,
              permission: notificationBridge.permission,
              requests: notificationBridge.requests,
              schedules: notificationBridge.schedules.length,
            },
            status: document.querySelector(
              '[data-testid="notification-settings"] p[role="status"]',
            )?.textContent,
            actions: [
              ...document.querySelectorAll(
                '[data-testid="notification-settings"] button',
              ),
            ].map((el) => el.textContent),
          })),
        ),
        "API",
        JSON.stringify(f.traffic.map(({ path }) => path)),
        "errors",
        JSON.stringify(errors),
      );
    } catch {}
  }, 5000);
  try {
    await reason("localScheduled");
  } finally {
    clearTimeout(diagnostic);
  }
  assert.equal(await page.evaluate(() => notificationBridge.requests), 1);
  assert.ok(await page.evaluate(() => notificationBridge.pending.size > 1));
  assert.ok(
    f.statuses.some(
      (status) =>
        status.cronConfigured === false && status.native.android === false,
    ),
  );
  assert.equal(await page.evaluate(() => notificationBridge.pushCalls), 0);
  console.log("Checked native local opt-in without Firebase");
  assert.equal(
    (await card().locator(".notification-delivery-label").textContent()).trim(),
    t("notificationModeLocal"),
  );
  await layout(
    "native explicit local opt-in, no Firebase",
    "native-local-en-375",
  );
  await card().getByTestId("test-notifications").click();
  await reason("testSent");
  assert.equal(
    await page.evaluate(() => notificationBridge.pending.has(1100999999)),
    true,
  );
  await page.evaluate(() => openFixtureNotification());
  await page
    .getByRole("heading", { name: t("fleetOverview"), exact: true })
    .waitFor();
  await settings();
  await card().locator('input[name="category-driverLicense"]').uncheck();
  await card().getByTestId("enable-notifications").click();
  await reason("localScheduled");
  assert.equal(
    await page.evaluate(() =>
      [...notificationBridge.pending.keys()].some(
        (id) => id >= 1100000000 && id < 1100999999,
      ),
    ),
    false,
    "deselecting the only due category cancels its scheduled digests",
  );
  await card().locator('input[name="category-driverLicense"]').check();
  await card().getByTestId("enable-notifications").click();
  await reason("localScheduled");
  await language("hi");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => {
    document.documentElement.dataset.ui = "ios";
  });
  await layout(
    "native categories, Hindi/dark phone",
    "native-local-hi-dark-375",
  );
  await page.setViewportSize({ width: 834, height: 1100 });
  await layout(
    "native notification settings, iPad-width dark",
    "native-local-hi-dark-834",
  );
  await card().getByTestId("disable-notifications").click();
  await reason("notEnabled");
  assert.equal(
    await page.evaluate(() =>
      [...notificationBridge.pending.keys()].some((id) => id >= 1100000000),
    ),
    false,
  );
  await card().getByTestId("enable-notifications").click();
  await reason("localScheduled");
  await page.getByRole("button", { name: t("signOut"), exact: true }).click();
  await page.locator("input[name=password]").waitFor();
  assert.equal(
    await page.evaluate(() =>
      [...notificationBridge.pending.keys()].some((id) => id >= 1100000000),
    ),
    false,
    "logout removes old-account phone alerts",
  );
  assert.equal(
    await page.evaluate(() => notificationBridge.pending.has(42)),
    true,
  );
  assert.equal(await page.evaluate(() => notificationBridge.pushCalls), 0);
  assert.ok(
    f.traffic.some(
      (request) => request.path === "/api/state" && request.bearer,
    ),
  );
  assert.deepEqual(f.unexpected, []);
  checks.push(
    "native own-device test/action/category save/disable/logout cleanup",
  );
  console.log("Checked native test, action, categories, disable and logout");
  await f.context.close();
}

async function browserGuards() {
  for (const mode of ["unsupported", "iphone", "denied"]) {
    const context = await browser.newContext({
      viewport: { width: 375, height: 900 },
      serviceWorkers: "block",
      ...(mode === "iphone"
        ? {
            isMobile: true,
            hasTouch: true,
            userAgent:
              "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
          }
        : {}),
    });
    await context.addInitScript((mode) => {
      window.notificationPermissionRequests = 0;
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value:
          mode === "unsupported"
            ? undefined
            : {
                permission: mode === "denied" ? "denied" : "default",
                requestPermission: () => {
                  window.notificationPermissionRequests++;
                  return Promise.resolve("denied");
                },
              },
      });
      Object.defineProperty(window, "PushManager", {
        configurable: true,
        value: function PushManager() {},
      });
      if (mode === "iphone")
        Object.defineProperty(navigator, "standalone", {
          configurable: true,
          value: false,
        });
    }, mode);
    if (mode === "denied") {
      // Isolate permission-denied UX from the deliberately unconfigured real
      // cron service. No subscription/enrollment can occur with denied access.
      await context.route("**/api/notifications/status", (route) =>
        route.fulfill({
          json: {
            web: { configured: true, vapidPublicKey: "BA".padEnd(87, "A") },
            native: { android: false, ios: false },
            cronConfigured: true,
            remoteRemindersConfigured: true,
          },
        }),
      );
    }
    await login(context, "notifications_staff");
    await settings();
    assert.equal(
      await card().locator('input[type="checkbox"]').count(),
      4,
      "staff can choose their own device reminders",
    );
    assert.equal(await page.evaluate(() => notificationPermissionRequests), 0);
    await card().getByTestId("enable-notifications").click();
    await reason(
      mode === "iphone"
        ? "installRequired"
        : mode === "denied"
          ? "permissionDenied"
          : "unsupported",
    );
    assert.equal(await page.evaluate(() => notificationPermissionRequests), 0);
    assert.equal(
      (
        await card().locator(".notification-delivery-label").textContent()
      ).trim(),
      t("notificationModeOff"),
    );
    if (mode === "iphone") {
      await language("hi");
      assert.equal(
        await card().locator(".notification-install-help li").count(),
        3,
      );
      assert.match(
        await card().locator(".notification-install-help").textContent(),
        /[\u0900-\u097f]/u,
      );
    }
    await layout(
      `browser ${mode} guard, staff controls`,
      mode === "iphone" ? "iphone-install-hi-375" : undefined,
    );
    console.log(`Checked browser notification guard: ${mode}`);
    await context.close();
  }
}
async function main() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 79)
      throw new Error(`Notification fixture server failed: ${logs}`);
  }
  dictionaries = await import("../src/i18n.js");
  browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_PATH ||
      (existsSync(chromium.executablePath())
        ? chromium.executablePath()
        : "/usr/bin/chromium"),
    headless: true,
    args: ["--no-sandbox"],
  });
  await nativeLocalFlow();
  await browserGuards();
  assert.deepEqual(errors, [], "no uncaught notification UI errors");
  writeFileSync(
    path.join(artifacts, "coverage.json"),
    JSON.stringify(
      {
        checks,
        count: checks.length,
        isolatedDatabase: true,
        engine: "Chromium with a mocked Capacitor OS bridge",
        limitations:
          "No physical permission dialog, notification delivery, APNs/FCM or Safari/WebKit delivery is verified.",
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${checks.length} bounded notification UI checks; native local consent/test/cleanup, browser guards, Hindi and phone/tablet layouts.`,
  );
}
main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    if (page && !page.isClosed())
      await page
        .screenshot({ path: path.join(artifacts, "failure.png") })
        .catch(() => {});
  })
  .finally(async () => {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    if (server.exitCode === null)
      await new Promise((resolve) => server.once("exit", resolve));
    rmSync(temp, { recursive: true, force: true });
  });
