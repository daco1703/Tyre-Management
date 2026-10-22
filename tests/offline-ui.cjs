const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "tyresaathi-offline-test-"));
const base = "http://127.0.0.1:3110";
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: "3110",
    DATABASE_PATH: path.join(temp, "unused.sqlite"),
  },
  stdio: "pipe",
});
let logs = "";
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));
let browser;
async function record(page, label, fields) {
  await page.getByRole("button", { name: label, exact: true }).click();
  for (const [name, value] of Object.entries(fields)) {
    const field = page.locator(`dialog [name="${name}"]`);
    if (typeof value === "boolean") await field.setChecked(value);
    else if (await field.evaluate((el) => el.tagName === "SELECT"))
      await field.selectOption(value);
    else await field.fill(String(value));
  }
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
}
async function data(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("tyresaathi-offline-v1", 1);
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction("garage", "readonly");
          const q = tx.objectStore("garage").get("current");
          q.onsuccess = () => resolve(q.result);
          tx.oncomplete = () => db.close();
        };
      }),
  );
}
async function main() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
    if (i === 79) throw Error(logs);
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_PATH
      ? { executablePath: process.env.BROWSER_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // An unavailable API must not prevent first-time offline setup.
  await context.route("**/api/**", (route) => route.abort());
  await page.goto(base);
  await page
    .getByRole("button", { name: "Use offline on this phone", exact: true })
    .click();
  await page.locator("input[name=fleetName]").fill("Offline garage · Test");
  await page
    .getByRole("button", { name: "Open offline garage", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  let apiCalls = 0;
  context.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls++;
  });
  await context.setOffline(true);
  await record(page, "Add vehicle", {
    registration: "RJ14OFF1234",
    odometer: 1000,
    hasSpare: true,
  });
  for (const [i, type] of ["new", "used", "remold"].entries())
    await record(page, "Add tyre", {
      serial: `OFF-${i + 1}`,
      brand: "MRF",
      size: "295/90 R20",
      type,
    });
  await page
    .locator(".mobile-nav-items")
    .getByRole("button", { name: "Vehicles", exact: true })
    .click();
  await page.getByRole("button", { name: /RJ14OFF1234/ }).click();
  assert.equal(await page.locator(".wheel").count(), 19);
  await page.getByRole("button", { name: "FL · Empty", exact: true }).click();
  await page
    .locator("dialog select[name=tyreId]")
    .selectOption({ label: "OFF-1 · MRF · New" });
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "SP · Empty", exact: true }).click();
  await page
    .locator("dialog select[name=tyreId]")
    .selectOption({ label: "OFF-2 · MRF · Used" });
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await record(page, "Update odometer", { odometer: 1600 });
  await page.getByRole("button", { name: "FL · OFF-1", exact: true }).click();
  await page
    .getByRole("button", { name: "Return to garage", exact: true })
    .click();
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  let profile = await data(page);
  assert.equal(profile.state.tyres[0].distance, 600);
  assert.equal(profile.state.tyres[0].type, "used");
  assert.equal(profile.state.tyres[1].slot, "SP");
  assert.equal(profile.state.tyres[1].distance, 0);
  console.log(
    "PASS: first setup without API/account; vehicle, stock, fitment, spare, odometer and return all work with networking disabled",
  );
  await page.reload();
  await page
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  assert.deepEqual(await data(page), profile);
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await page
    .getByRole("heading", { name: "आपके बेड़े का पूरा हिसाब" })
    .waitFor();
  assert.ok(
    await page
      .getByRole("button", { name: "टायर जोड़ें", exact: true })
      .isEnabled(),
  );
  await page.getByRole("button", { name: "भाषा", exact: true }).click();
  await page
    .getByRole("button", { name: "Team & settings", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Create a new invite code", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Change password", exact: true })
      .count(),
    0,
  );
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export records (JSON)", exact: true })
    .click();
  const download = await pending;
  const stream = await download.createReadStream();
  let json = "";
  for await (const chunk of stream) json += chunk;
  assert.deepEqual(JSON.parse(json).tyres, profile.state.tyres);
  assert.equal(apiCalls, 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: offline reload retains records; Hindi, account-free settings and JSON export work; zero API requests in offline mode",
  );
  mkdirSync(path.join(root, "artifacts"), { recursive: true });
  await page
    .locator(".mobile-nav-items")
    .getByRole("button", { name: "Dashboard", exact: true })
    .click();
  await page.screenshot({
    path: path.join(root, "artifacts/offline-mobile.png"),
    fullPage: true,
  });
  // A second window cannot overwrite a local transaction committed by the first.
  const second = await context.newPage();
  await second.goto(base);
  await second
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  await record(page, "Add tyre", {
    serial: "OFF-4",
    brand: "CEAT",
    size: "R20",
  });
  await second.getByRole("button", { name: "Add tyre", exact: true }).click();
  for (const [name, value] of Object.entries({
    serial: "OFF-5",
    brand: "Apollo",
    size: "R20",
  }))
    await second.locator(`dialog [name="${name}"]`).fill(value);
  await second
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await second.locator("dialog [role=alert]").waitFor();
  assert.match(
    await second.locator("dialog [role=alert]").innerText(),
    /updated the records/,
  );
  await second
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await second.locator("dialog").waitFor({ state: "detached" });
  profile = await data(second);
  assert.equal(profile.state.tyres.length, 5);
  await second.close();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(base);
  await reopened
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  assert.equal((await data(reopened)).state.tyres.length, 5);
  assert.equal(apiCalls, 0);
  console.log(
    "PASS: competing windows reject stale writes; records survive closing every app page and reopening while offline",
  );
  await context.setOffline(false);
  await reopened
    .getByRole("button", { name: "Team & settings", exact: true })
    .click();
  await reopened
    .getByRole("button", { name: "Use a shared server", exact: true })
    .click();
  await reopened
    .getByRole("button", { name: "Use offline on this phone", exact: true })
    .click();
  await reopened
    .getByText(
      "Your existing offline garage will be reopened. Its records will be kept.",
      { exact: true },
    )
    .waitFor();
  await reopened
    .getByRole("button", { name: "Open offline garage", exact: true })
    .click();
  await reopened
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  assert.equal((await data(reopened)).state.tyres.length, 5);
  console.log(
    "PASS: switching to shared mode and back preserves the separate offline garage",
  );
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
