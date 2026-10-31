const { chromium } = require("playwright");
const { spawn, spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "shepards-login-"));
const base = "http://127.0.0.1:3120";
const canonicalOrigin = "https://www.shepards-tyre-management.com";
const legacyOrigin = "https://tyre-management.onrender.com";
const previewOrigin = "https://tyre-management-git-main-shepards.vercel.app";
const seeded = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
 import {createApp} from './server/app.js'; import {scryptSync} from 'node:crypto';
 const {db}=createApp({dbPath:process.env.DATABASE_PATH});
 db.prepare("UPDATE users SET salt=?,hash=? WHERE role='owner'").run('login-test-salt',scryptSync('test-admin-password','login-test-salt',64).toString('hex')); db.close();
`,
  ],
  {
    cwd: root,
    env: { ...process.env, DATABASE_PATH: path.join(temp, "test.sqlite") },
    encoding: "utf8",
  },
);
assert.equal(seeded.status, 0, seeded.stderr);
// Use Vercel's origin configuration with an explicitly standalone runtime for
// this isolated SQLite fixture. Actual serverless PostgreSQL is covered by the
// PostgreSQL integration suite; Vercel production never falls back to SQLite.
const server = spawn(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
  import { createRuntime } from './server/runtime.js';
  import express from 'express';
  import path from 'node:path';
  const { app, store } = createRuntime({ serverless: false });
  app.use(express.static(path.resolve('dist'), { index: false }));
  app.get('/{*path}', (req, res) => res.sendFile(path.resolve('dist/index.html')));
  const server = app.listen(Number(process.env.PORT), '127.0.0.1');
  process.on('SIGTERM', () => server.close(async () => {
    await store.close();
    process.exit(0);
  }));
`,
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "3120",
      VERCEL: "1",
      PUBLIC_ORIGIN: "",
      TRUST_PROXY: "0",
      DATABASE_URL: "",
      POSTGRES_URL: "",
      DATABASE_PATH: path.join(temp, "test.sqlite"),
    },
    stdio: "pipe",
  },
);
let logs = "",
  browser;
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));

async function prepareNative(context, fixture = {}) {
  await context.addInitScript(({ savedServer, savedToken }) => {
    window.CapacitorCustomPlatform = { name: "android" };
    // Seed once so reload exercises persisted settings, never re-seeds an old token.
    if (!sessionStorage.getItem("native-login-fixture-seeded")) {
      sessionStorage.setItem("native-login-fixture-seeded", "yes");
      localStorage.setItem("ts-mode", JSON.stringify("local"));
      if (savedServer !== undefined)
        localStorage.setItem("ts-server", JSON.stringify(savedServer));
      if (savedToken !== undefined)
        localStorage.setItem("ts-token", JSON.stringify(savedToken));
    }
    // Record storage at fetch time, proving migration clears the old token
    // before even bootstrap can send it to the replacement domain.
    window.nativeRequestSnapshots = [];
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      window.nativeRequestSnapshots.push({
        url: String(args[0]),
        server: JSON.parse(localStorage.getItem("ts-server")),
        token: JSON.parse(localStorage.getItem("ts-token")),
      });
      return originalFetch.apply(this, args);
    };
  }, fixture);
  const calls = [],
    unexpected = [];
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push({
      url: request.url(),
      authorization: request.headers().authorization,
    });
    if (url.origin !== canonicalOrigin) {
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
    try {
      const result = await context.request.fetch(
        base + url.pathname + url.search,
        {
          method: request.method(),
          headers: {
            "content-type": "application/json",
            origin: "https://localhost",
            // Android does not use website cookies; require its actual bearer token.
            cookie: "",
            ...(request.headers().authorization
              ? { authorization: request.headers().authorization }
              : {}),
          },
          ...(request.postData() ? { data: request.postData() } : {}),
        },
      );
      await route.fulfill({
        response: result,
        headers: { ...result.headers(), ...cors },
      });
    } catch {
      // Closing/reloading the phone can cancel an in-flight long poll.
      await route.abort().catch(() => {});
    }
  });
  return { calls, unexpected };
}

async function main() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
    if (i === 79) throw Error(logs);
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_PATH
      ? { executablePath: process.env.BROWSER_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  // Exercise both public HTTPS origins through an internal Vercel function
  // hostname, using the runtime's real deployment-origin configuration.
  for (const publicOrigin of [canonicalOrigin, previewOrigin]) {
    const proxyContext = await browser.newContext({ serviceWorkers: "block" });
    await proxyContext.route("**/api/**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      try {
        const response = await proxyContext.request.fetch(
          base + url.pathname + url.search,
          {
            method: req.method(),
            headers: {
              ...req.headers(),
              host: "internal-vercel-function:3000",
              origin: publicOrigin,
              "x-forwarded-proto": "https",
            },
            ...(req.postData() ? { data: req.postData() } : {}),
          },
        );
        await route.fulfill({ response });
      } catch {
        await route.abort().catch(() => {});
      }
    });
    const proxyPage = await proxyContext.newPage();
    await proxyPage.goto(base);
    await proxyPage.locator("input[name=password]").fill("test-admin-password");
    await proxyPage
      .getByRole("button", { name: "Open my garage", exact: true })
      .click();
    await proxyPage
      .getByRole("heading", { name: "Your fleet, at a glance" })
      .waitFor();
    await proxyPage.reload();
    await proxyPage
      .getByRole("heading", { name: "Your fleet, at a glance" })
      .waitFor();
    await proxyPage
      .getByRole("button", { name: "Team & settings", exact: true })
      .click();
    await proxyPage
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await proxyPage.locator("input[name=password]").waitFor();
    await proxyContext.close();
    console.log(
      `PASS: browser login, reload and logout through the internal Vercel host using public origin ${publicOrigin}`,
    );
  }
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  let releaseStartup;
  const startupHeld = new Promise((r) => (releaseStartup = r));
  let wasHeld;
  const held = new Promise((r) => (wasHeld = r));
  let completed;
  const startupCompleted = new Promise((r) => (completed = r));
  await context.route("**/api/me", async (route) => {
    wasHeld();
    await startupHeld;
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "unauthorized" }),
    });
    completed();
  });
  await page.goto(base);
  await held;
  await page.locator("input[name=password]").fill("test-admin-password");
  await page
    .getByRole("button", { name: "Open my garage", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  releaseStartup();
  await startupCompleted;
  await page.waitForFunction(
    () => !document.querySelector("input[name=password]"),
    null,
    { timeout: 1000 },
  );
  // Flush the delayed fetch and React update before asserting the session survives.
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  assert.ok(
    await page
      .getByRole("heading", { name: "Your fleet, at a glance" })
      .isVisible(),
    "a delayed startup 401 signed out a newly logged-in user",
  );
  console.log(
    "PASS: direct shared login survives a delayed startup authentication response",
  );
  await context.unroute("**/api/me");
  await page
    .getByRole("button", { name: "Team & settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Add staff", exact: true }).click();
  await page.locator("dialog input[name=username]").fill("desk_staff");
  await page.locator("dialog input[name=password]").fill("desk-staff-password");
  await page.locator("dialog input[name=confirm]").fill("desk-staff-password");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await page
    .locator(".team-list")
    .getByText("desk_staff", { exact: true })
    .waitFor();
  assert.equal(
    (await (await context.request.get(base + "/api/me")).json()).user.role,
    "owner",
  );
  const staffContext = await browser.newContext({ serviceWorkers: "block" });
  const staffPage = await staffContext.newPage();
  await staffPage.goto(base);
  await staffPage.locator("input[name=username]").fill("desk_staff");
  await staffPage.locator("input[name=password]").fill("desk-staff-password");
  await staffPage
    .getByRole("button", { name: "Open my garage", exact: true })
    .click();
  await staffPage
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  await staffPage
    .getByRole("button", { name: "Team & settings", exact: true })
    .click();
  assert.equal(
    await staffPage
      .getByRole("button", { name: "Add staff", exact: true })
      .count(),
    0,
  );
  console.log(
    "PASS: admin creates a staff account; staff signs in directly with a unique username/password and cannot manage accounts",
  );
  await page
    .locator(".nav-items")
    .getByRole("button", { name: "Logbook", exact: true })
    .click();
  const state = await (
    await staffContext.request.get(base + "/api/state")
  ).json();
  await staffContext.request.post(base + "/api/actions", {
    data: {
      kind: "addTyre",
      revision: state.revision,
      payload: {
        serial: "LIVE-STAFF-1",
        brand: "MRF",
        size: "R20",
        type: "new",
      },
    },
  });
  await page
    .getByText("LIVE-STAFF-1", { exact: true })
    .waitFor({ timeout: 3000 });
  assert.match(
    await page.locator(".activity-row").first().innerText(),
    /desk_staff/,
  );
  console.log(
    "PASS: a staff entry appears in the other signed-in user's logbook immediately with username and timestamp",
  );
  const { default: writeExcelFile } = await import("write-excel-file/node");
  const { VEHICLE_HEADERS } = await import("../shared/vehicle-import.js");
  const workbook = await writeExcelFile([
    {
      sheet: "Vehicles",
      data: [
        VEHICLE_HEADERS,
        ["MH01EX01", "राम", 100, "Yes"],
        ["MH01EX02"],
        ["mh 01 ex01"],
        ["MH01BAD", "", -1, "No"],
      ],
    },
  ]).toBuffer();
  await page
    .locator(".nav-items")
    .getByRole("button", { name: "Vehicles", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import from Excel", exact: true })
    .click();
  await page.locator('dialog input[type="file"]').setInputFiles({
    name: "vehicles.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook,
  });
  await page
    .getByRole("button", { name: "Import 2 vehicles", exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "detached" });
  const imported = await (
    await context.request.get(base + "/api/state")
  ).json();
  assert.equal(imported.vehicles.length, 2);
  assert.equal(imported.vehicles[0].name, "राम");
  assert.equal(imported.vehicles[1].odometer, 0);
  assert.equal(imported.events.at(-1).actor, "admin");
  console.log(
    "PASS: real Excel vehicle import keeps preview validation, defaults, Hindi values and attributed shared log entries",
  );

  const retryContext = await browser.newContext({ serviceWorkers: "block" });
  const retryPage = await retryContext.newPage();
  let failState = true;
  await retryContext.route("**/api/state", async (route) => {
    if (failState) {
      failState = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "serverError" }),
      });
    } else await route.continue();
  });
  await retryPage.goto(base);
  await retryPage.locator("input[name=password]").fill("test-admin-password");
  await retryPage
    .getByRole("button", { name: "Open my garage", exact: true })
    .click();
  await retryPage.getByRole("alert").waitFor();
  assert.ok(await retryPage.locator("input[name=password]").isVisible());
  await retryPage
    .getByRole("button", { name: "Open my garage", exact: true })
    .click();
  await retryPage
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  console.log(
    "PASS: failed initial data load leaves a usable login form; retry succeeds without an offline detour",
  );

  const translations = await import("../src/i18n.js");
  for (const language of ["en", "hi"]) {
    const t = translations[language];
    const makeErrorContext = async () => {
      const isolated = await browser.newContext({ serviceWorkers: "block" });
      await isolated.addInitScript((lang) => {
        localStorage.setItem("ts-lang", JSON.stringify(lang));
      }, language);
      return isolated;
    };

    // A rejected request while the browser remains online is a server/address
    // problem. Keep the form usable and retryable instead of claiming offline.
    const disconnectedContext = await makeErrorContext();
    let rejectLogin = true;
    await disconnectedContext.route("**/api/login", async (route) => {
      if (rejectLogin) {
        rejectLogin = false;
        await route.abort();
      } else await route.continue();
    });
    const disconnected = await disconnectedContext.newPage();
    await disconnected.goto(base);
    await disconnected
      .locator("input[name=password]")
      .fill("test-admin-password");
    await disconnected
      .getByRole("button", { name: t.submitLogin, exact: true })
      .click();
    assert.equal(await disconnected.evaluate(() => navigator.onLine), true);
    assert.equal(
      await disconnected.getByRole("alert").innerText(),
      t.notConnected,
    );
    assert.notEqual(
      await disconnected.getByRole("alert").innerText(),
      t.offlineHint,
    );
    await disconnected
      .getByRole("button", { name: t.submitLogin, exact: true })
      .click();
    await disconnected
      .getByRole("heading", { name: t.fleetOverview, exact: true })
      .waitFor();
    await disconnectedContext.close();
    console.log(
      `PASS: ${language} online login failure names the server connection problem and retries successfully`,
    );

    for (const failure of [
      {
        name: "HTML 404 from frontend-only hosting",
        key: "invalidServerResponse",
        status: 404,
      },
      {
        name: "HTML 503 from the upstream host",
        key: "serverUnavailable",
        status: 503,
      },
      {
        name: "rejected bootstrap request while online",
        key: "notConnected",
        abort: true,
      },
    ]) {
      assert.equal(
        typeof t[failure.key],
        "string",
        `${language}: missing translated server error ${failure.key}`,
      );
      const errorContext = await makeErrorContext();
      let failBootstrap = true;
      await errorContext.route("**/api/bootstrap", async (route) => {
        if (!failBootstrap) return route.continue();
        failBootstrap = false;
        if (failure.abort) return route.abort();
        return route.fulfill({
          status: failure.status,
          contentType: "text/html",
          body: "<!doctype html><html><title>Host response</title><body>Service unavailable or page not found</body></html>",
        });
      });
      const errorPage = await errorContext.newPage();
      await errorPage.goto(base);
      await errorPage
        .getByRole("heading", { name: t[failure.key], exact: true })
        .waitFor();
      assert.equal(await errorPage.evaluate(() => navigator.onLine), true);
      assert.equal(
        await errorPage
          .getByRole("heading", { name: t.offlineHint, exact: true })
          .count(),
        0,
      );
      await errorPage
        .getByRole("button", { name: t.retry, exact: true })
        .click();
      await errorPage.locator("input[name=password]").waitFor();
      assert.ok(
        await errorPage
          .getByRole("button", { name: t.submitLogin, exact: true })
          .isVisible(),
      );
      await errorContext.close();
      console.log(
        `PASS: ${language} ${failure.name} shows ${failure.key}, and Retry restores the login form`,
      );
    }

    const offlineContext = await makeErrorContext();
    const offlinePage = await offlineContext.newPage();
    await offlinePage.goto(base);
    await offlinePage.locator("input[name=password]").waitFor();
    await offlineContext.setOffline(true);
    await offlinePage
      .getByRole("heading", { name: t.offlineHint, exact: true })
      .waitFor();
    assert.equal(await offlinePage.evaluate(() => navigator.onLine), false);
    await offlineContext.setOffline(false);
    await offlinePage.locator("input[name=password]").waitFor();
    await offlineContext.close();
    console.log(
      `PASS: ${language} a genuinely offline browser asks for an internet connection and recovers when online`,
    );
  }

  const nativeContext = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 390, height: 844 },
  });
  const nativeTraffic = await prepareNative(nativeContext);
  const nativePage = await nativeContext.newPage();
  const nativeErrors = [];
  nativePage.on("pageerror", (e) => nativeErrors.push(e.message));
  await nativePage.goto(base);
  await nativePage.locator("input[name=password]").waitFor();
  assert.ok(nativeTraffic.calls.length > 0);
  assert.deepEqual(nativeTraffic.unexpected, []);
  assert.equal(
    await nativePage.evaluate(() =>
      JSON.parse(localStorage.getItem("ts-server")),
    ),
    canonicalOrigin,
  );
  assert.equal(
    await nativePage
      .getByRole("button", { name: "Use offline on this phone", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await nativePage.locator("input[name=username]").inputValue(),
    "admin",
  );
  await nativePage.locator("input[name=password]").fill("test-admin-password");
  await nativePage
    .getByRole("button", { name: "Open my garage", exact: true })
    .click();
  await nativePage
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  const nativeToken = await nativePage.evaluate(() =>
    JSON.parse(localStorage.getItem("ts-token")),
  );
  assert.match(nativeToken, /^[a-f0-9]{64}$/);
  const callsBeforeNativeReopen = nativeTraffic.calls.length;
  await nativePage.reload();
  await nativePage
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  assert.ok(
    nativeTraffic.calls
      .slice(callsBeforeNativeReopen)
      .some(
        (call) =>
          new URL(call.url).pathname === "/api/me" &&
          call.authorization === `Bearer ${nativeToken}`,
      ),
    "fresh Android reopen did not use its canonical-domain bearer session",
  );
  await nativePage
    .getByRole("button", { name: "Team & settings", exact: true })
    .click();
  await nativePage
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await nativePage.locator("input[name=password]").waitFor();
  await nativePage.locator("input[name=username]").fill("desk_staff");
  await nativePage.locator("input[name=password]").fill("desk-staff-password");
  await nativePage
    .getByRole("button", { name: "Open my garage", exact: true })
    .click();
  await nativePage
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  await page
    .getByRole("button", { name: "Team & settings", exact: true })
    .click();
  await page
    .locator(".team-row")
    .filter({ hasText: "desk_staff" })
    .getByRole("button", { name: "Remove staff", exact: true })
    .click();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Remove staff", exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await nativePage.locator("input[name=password]").waitFor({ timeout: 3000 });
  assert.equal(
    (await (await context.request.get(base + "/api/state")).json()).events[0]
      .actor,
    "desk_staff",
  );
  assert.deepEqual(nativeErrors, []);
  assert.deepEqual(nativeTraffic.unexpected, []);
  console.log(
    "PASS: Android defaults to the canonical company domain; legacy local mode is ignored; bearer login, reopen, logout and direct staff login work",
  );

  for (const fixture of [
    {
      name: "saved legacy URL with trailing slash",
      savedServer: `${legacyOrigin}/`,
    },
    { name: "old implicit default without a saved URL" },
  ]) {
    const oldToken = "a".repeat(64);
    const migratedContext = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 390, height: 844 },
    });
    const migration = await prepareNative(migratedContext, {
      ...fixture,
      savedToken: oldToken,
    });
    const migratedPage = await migratedContext.newPage();
    await migratedPage.goto(base);
    await migratedPage.locator("input[name=password]").waitFor();
    assert.ok(
      migration.calls.length > 0,
      `${fixture.name}: no startup requests`,
    );
    assert.deepEqual(
      migration.unexpected,
      [],
      `${fixture.name}: contacted the legacy or an unexpected server`,
    );
    assert.ok(
      migration.calls.every(
        (call) => call.authorization !== `Bearer ${oldToken}`,
      ),
      `${fixture.name}: old bearer token sent to new domain`,
    );
    const snapshots = await migratedPage.evaluate(
      () => window.nativeRequestSnapshots,
    );
    assert.ok(snapshots.length > 0);
    assert.ok(
      snapshots.every(
        (snapshot) =>
          snapshot.server === canonicalOrigin && snapshot.token === null,
      ),
      `${fixture.name}: storage was not migrated before startup requests`,
    );
    assert.equal(
      await migratedPage.evaluate(() =>
        JSON.parse(localStorage.getItem("ts-server")),
      ),
      canonicalOrigin,
    );
    assert.equal(
      await migratedPage.evaluate(() => localStorage.getItem("ts-token")),
      null,
    );
    await migratedPage
      .locator("input[name=password]")
      .fill("test-admin-password");
    await migratedPage
      .getByRole("button", { name: "Open my garage", exact: true })
      .click();
    await migratedPage
      .getByRole("heading", { name: "Your fleet, at a glance" })
      .waitFor();
    const token = await migratedPage.evaluate(() =>
      JSON.parse(localStorage.getItem("ts-token")),
    );
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.notEqual(token, oldToken);
    const callsBeforeReopen = migration.calls.length;
    await migratedPage.reload();
    await migratedPage
      .getByRole("heading", { name: "Your fleet, at a glance" })
      .waitFor();
    assert.ok(
      migration.calls
        .slice(callsBeforeReopen)
        .some(
          (call) =>
            new URL(call.url).pathname === "/api/me" &&
            call.authorization === `Bearer ${token}`,
        ),
      `${fixture.name}: reopening did not use the new session`,
    );
    assert.equal(
      await migratedPage.evaluate(() =>
        JSON.parse(localStorage.getItem("ts-token")),
      ),
      token,
    );
    assert.deepEqual(migration.unexpected, []);
    await migratedContext.close();
    console.log(
      `PASS: Android migrates ${fixture.name}, clears the old token before all network calls, then signs in and reopens on the canonical domain`,
    );
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server.exitCode === null) {
      const stopped = new Promise((r) => server.once("exit", r));
      server.kill("SIGTERM");
      await stopped;
    }
    rmSync(temp, { recursive: true, force: true });
  });
