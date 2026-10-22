const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "tyresaathi-ui-"));
const port = process.env.UI_TEST_PORT || "3100";
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    FLEET_SETUP_KEY: "test-only-bootstrap-key",
    PORT: port,
    DATABASE_PATH: path.join(temp, "test.sqlite"),
  },
  stdio: "pipe",
});
let output = "";
server.stdout.on("data", (d) => (output += d));
server.stderr.on("data", (d) => (output += d));
let browser;
async function main() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
    if (i === 79) throw Error("Server startup failed: " + output);
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_PATH
      ? { executablePath: process.env.BROWSER_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.locator("input[name=fleetName]").fill("Sharma Transport · Sample");
  await page.locator("input[name=setupKey]").fill("test-only-bootstrap-key");
  await page.locator("input[name=username]").fill("garage_owner");
  await page.locator("input[name=password]").fill("test-owner-password");
  await page.locator("input[name=confirm]").fill("test-owner-password");
  await page
    .getByRole("button", { name: "Create your fleet", exact: true })
    .click();
  await page.locator("dialog .invite-code").waitFor();
  const invite = await page.locator("dialog .invite-code").inputValue();
  await page.getByRole("button", { name: "Got it", exact: true }).click();
  await page
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  async function record(button, data) {
    await page.getByRole("button", { name: button, exact: true }).click();
    for (const [name, value] of Object.entries(data)) {
      const field = page.locator(`dialog [name="${name}"]`);
      if (typeof value === "boolean") await field.setChecked(value);
      else if (await field.evaluate((el) => el.tagName === "SELECT"))
        await field.selectOption(value);
      else await field.fill(String(value));
    }
    await page
      .getByRole("button", { name: "Save record", exact: true })
      .click();
    await page.locator("dialog").waitFor({ state: "detached" });
  }
  await record("Add vehicle", {
    registration: "RJ14AB1234",
    name: "Jaipur route",
    odometer: 1000,
    hasSpare: true,
  });
  for (const [i, type] of ["new", "used", "remold"].entries())
    await record("Add tyre", {
      serial: `TYR-00${i + 1}`,
      brand: ["MRF Steel Muscle", "Apollo EnduRace", "CEAT WinMile"][i],
      size: "295/90 R20",
      type,
    });
  await page
    .locator(".nav-items")
    .getByRole("button", { name: "Vehicles", exact: true })
    .click();
  await page.getByRole("button", { name: /RJ14AB1234/ }).click();
  assert.equal(await page.locator(".wheel").count(), 19);
  await page.getByRole("button", { name: "FL · Empty", exact: true }).click();
  await page
    .locator("dialog select[name=tyreId]")
    .selectOption({ label: "TYR-001 · MRF Steel Muscle · New" });
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await record("Update odometer", { odometer: 1250 });
  await page.getByRole("button", { name: "FL · TYR-001", exact: true }).click();
  assert.match(await page.locator("dialog .detail-stats").innerText(), /250/);
  await page
    .getByRole("button", { name: "Return to garage", exact: true })
    .click();
  await page.locator("dialog input[name=odometer]").fill("1300");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  let state = await (await context.request.get(base + "/api/state")).json();
  assert.equal(state.tyres[0].type, "used");
  assert.equal(state.tyres[0].distance, 300);
  console.log(
    "PASS: owner setup, vehicle, all three tyre conditions, visual fitment, mileage and return",
  );
  const staffContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const staff = await staffContext.newPage();
  staff.on("pageerror", (e) => errors.push(e.message));
  await staff.goto(base);
  await staff.getByRole("button", { name: "Join fleet", exact: true }).click();
  await staff.locator("input[name=invite]").fill(invite);
  await staff.locator("input[name=username]").fill("garage_staff");
  await staff.locator("input[name=password]").fill("test-staff-password");
  await staff.locator("input[name=confirm]").fill("test-staff-password");
  await staff
    .getByRole("button", { name: "Create staff account", exact: true })
    .click();
  await staff
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  await staff
    .locator(".mobile-nav-items")
    .getByRole("button", { name: "Tyre inventory", exact: true })
    .click();
  assert.equal(await staff.locator(".tyre-row").count(), 3);
  await staff.getByRole("button", { name: /TYR-002/ }).click();
  await staff.getByRole("button", { name: "Fit tyre", exact: true }).click();
  await staff
    .locator("dialog select[name=vehicleId]")
    .selectOption({ label: "RJ14AB1234" });
  await staff.locator("dialog select[name=slot]").selectOption("FL");
  await staff.getByRole("button", { name: "Save record", exact: true }).click();
  await staff.locator("dialog").waitFor({ state: "detached" });
  state = await (await context.request.get(base + "/api/state")).json();
  assert.equal(state.events.at(-1).actor, "garage_staff");
  console.log(
    "PASS: second staff account on mobile sees shared stock and records fitment with attribution",
  );
  // Add explicit test fixtures to exercise populated layouts; never touch the application database.
  async function apiAction(kind, payload) {
    const s = await (await context.request.get(base + "/api/state")).json();
    const res = await context.request.post(base + "/api/actions", {
      data: { kind, payload, revision: s.revision },
    });
    assert.equal(res.status(), 200, JSON.stringify(await res.json()));
  }
  for (const [registration, hasSpare] of [
    ["RJ14GC2071", true],
    ["HR55AB8921", false],
  ])
    await apiAction("addVehicle", {
      registration,
      hasSpare,
      odometer: 48200,
      name: "Sample vehicle",
    });
  for (let i = 4; i <= 32; i++)
    await apiAction("addTyre", {
      serial: `TYR-${String(i).padStart(3, "0")}`,
      brand: ["MRF Steel Muscle", "Apollo EnduRace", "CEAT WinMile"][i % 3],
      size: "295/90 R20",
      type: ["new", "used", "remold"][i % 3],
    });
  state = await (await context.request.get(base + "/api/state")).json();
  const v = state.vehicles[0];
  const available = state.tyres.filter((t) => t.status === "stock");
  const wheelSlots = [
    "FR",
    ...[2, 3, 4, 5].flatMap((a) => [`${a}LO`, `${a}LI`, `${a}RI`, `${a}RO`]),
    "SP",
  ];
  for (let i = 0; i < wheelSlots.length; i++)
    await apiAction("fit", {
      tyreId: available[i].id,
      vehicleId: v.id,
      slot: wheelSlots[i],
      odometer: 1300,
    });
  await page.reload();
  await page
    .locator(".nav-items")
    .getByRole("button", { name: "Dashboard", exact: true })
    .click();
  mkdirSync(path.join(root, "artifacts"), { recursive: true });
  await page.screenshot({
    path: path.join(root, "artifacts/dashboard-desktop.png"),
    fullPage: true,
  });
  await staff.reload();
  await staff
    .locator(".mobile-nav-items")
    .getByRole("button", { name: "Dashboard", exact: true })
    .click();
  await staff.screenshot({
    path: path.join(root, "artifacts/dashboard-mobile-en.png"),
    fullPage: true,
  });
  await staff
    .locator(".mobile-nav-items")
    .getByRole("button", { name: "Vehicles", exact: true })
    .click();
  await staff.getByRole("button", { name: /RJ14AB1234/ }).click();
  assert.equal(await staff.locator(".wheel").count(), 19);
  await staff.screenshot({
    path: path.join(root, "artifacts/vehicle-mobile.png"),
    fullPage: true,
  });
  await staff.getByRole("button", { name: "Language", exact: true }).click();
  await staff
    .getByRole("heading", { name: "RJ14AB1234", exact: true })
    .waitFor();
  await staff
    .locator(".mobile-nav-items")
    .getByRole("button", { name: "डैशबोर्ड", exact: true })
    .click();
  await staff
    .getByRole("heading", { name: "आपके बेड़े का पूरा हिसाब" })
    .waitFor();
  await staff.screenshot({
    path: path.join(root, "artifacts/dashboard-mobile-hi.png"),
    fullPage: true,
  });
  for (const width of [360, 390, 700, 960, 1440]) {
    await staff.setViewportSize({ width, height: 900 });
    assert.ok(
      await staff.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `No horizontal overflow at ${width}px`,
    );
  }
  console.log(
    "PASS: populated desktop and mobile layouts, 18 + spare schematic, Hindi switch, no overflow at five widths",
  );
  await page
    .locator(".nav-items")
    .getByRole("button", { name: "Logbook", exact: true })
    .click();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const csv = await pendingDownload;
  assert.match(csv.suggestedFilename(), /\.csv$/);
  await page
    .locator(".nav-items")
    .getByRole("button", { name: "Team & settings", exact: true })
    .click();
  const backupDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export records (JSON)", exact: true })
    .click();
  const backup = await backupDownload;
  assert.match(backup.suggestedFilename(), /\.json$/);
  console.log("PASS: movement CSV and record JSON export");
  await staff.evaluate(() => navigator.serviceWorker.ready);
  await staffContext.setOffline(true);
  await staff.reload();
  await staff.getByRole("heading", { name: "आपके बेड़े का पूरा हिसाब" }).waitFor();
  await staff
    .getByText("ऑफलाइन · पुराने रिकॉर्ड", { exact: true })
    .waitFor({ state: "attached" })
    .catch(() => {});
  // Offline navigation remains readable; write controls are disabled after browser offline event.
  assert.ok(
    await staff
      .getByRole("button", { name: "टायर जोड़ें", exact: true })
      .isDisabled(),
  );
  await staffContext.setOffline(false);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: production service-worker offline reload, cached viewing and blocked writes; no browser runtime errors",
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
    rmSync(temp, { recursive: true, force: true });
  });
