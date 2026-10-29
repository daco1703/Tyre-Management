const { chromium } = require("playwright");
const { spawn, spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, mkdirSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "tyresaathi-ui-"));
const port = process.env.UI_TEST_PORT || "3100";
const base = `http://127.0.0.1:${port}`;
// Isolated test database, with a test-only owner password.
const seeded = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
  import { createApp } from './server/app.js';
  import { scryptSync } from 'node:crypto';
  const { db } = createApp({ dbPath: process.env.DATABASE_PATH });
  db.prepare("UPDATE users SET username=?,salt=?,hash=? WHERE role='owner'").run('garage_owner', 'browser-test-salt', scryptSync('test-owner-password', 'browser-test-salt', 64).toString('hex'));
  db.close();
`,
  ],
  {
    cwd: root,
    env: { ...process.env, DATABASE_PATH: path.join(temp, "test.sqlite") },
    encoding: "utf8",
  },
);
assert.equal(seeded.status, 0, seeded.stderr);
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
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
  mkdirSync(path.join(root, "artifacts"), { recursive: true });
  const errors = [];
  const remoteLogoRequests = [];
  context.on("request", (req) => {
    if (/google\.com|gstatic\.com/.test(req.url()))
      remoteLogoRequests.push(req.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  assert.equal(
    await page.getByLabel("Fleet / business name", { exact: true }).count(),
    0,
  );
  assert.equal(await page.locator("input[name=setupKey]").count(), 0);
  await page
    .getByRole("button", { name: "Forgot username/password?", exact: true })
    .click();
  await page.getByText("Contact the admin.", { exact: true }).waitFor();
  await page.locator("input[name=username]").fill("garage_owner");
  await page.locator("input[name=password]").fill("test-owner-password");
  await page
    .getByRole("button", { name: "Open my garage", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  async function record(button, data) {
    await page.getByRole("button", { name: button, exact: true }).click();
    if (button === "Add tyre")
      assert.deepEqual(
        await page
          .locator("dialog select[name=brand] option")
          .evaluateAll((options) => options.map((o) => o.value)),
        [
          "MRF",
          "Apollo",
          "CEAT",
          "JK Tyre",
          "Bridgestone",
          "Michelin",
          "Goodyear",
          "other",
        ],
      );
    if (button === "Add tyre" && data.serial === "TYR-001") {
      const { manufacturers } = await import("../shared/catalogue.js");
      for (const make of manufacturers) {
        await page.locator("dialog select[name=brand]").selectOption(make.name);
        const logo = page.locator("dialog .manufacturer-mark img");
        await logo.waitFor();
        await logo.evaluate((img) => img.decode());
        assert.equal(await logo.getAttribute("src"), make.logo);
        assert.equal(
          await logo.evaluate((img) => getComputedStyle(img).objectFit),
          "contain",
        );
      }
    }
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
    emissionClass: "BS6",
    driverName: "Ram",
    odometer: 1000,
    hasSpare: true,
  });
  for (const [i, type] of ["new", "used", "remold"].entries())
    await record("Add tyre", {
      serial: `TYR-00${i + 1}`,
      brand: ["MRF", "Apollo", "CEAT"][i],
      construction: i === 1 ? "horse" : "radial",
      type,
    });
  await page
    .locator(".nav-items")
    .getByRole("button", { name: "Vehicles", exact: true })
    .click();
  await page.getByRole("button", { name: /RJ14AB1234/ }).click();
  assert.equal(await page.locator(".wheel").count(), 19);
  await page
    .getByRole("heading", { name: "Tyre Location", exact: true })
    .waitFor();
  assert.deepEqual(
    await page
      .locator(".axle-row")
      .evaluateAll((rows) =>
        rows.map((row) =>
          Array.from(
            row.querySelectorAll(".wheel strong"),
            (node) => node.textContent,
          ),
        ),
      ),
    [
      ["2", "1"],
      ["6", "5", "4", "3"],
      ["10", "9", "8", "7"],
      ["14", "13", "12", "11"],
      ["18", "17", "16", "15"],
    ],
  );
  const rowGaps = await page
    .locator(".axle-row")
    .evaluateAll((rows) =>
      rows
        .slice(1)
        .map(
          (row, i) =>
            row.getBoundingClientRect().top -
            rows[i].getBoundingClientRect().bottom,
        ),
    );
  assert.ok(rowGaps[1] > rowGaps[0] + 10);
  assert.ok(Math.abs(rowGaps[0] - rowGaps[2]) < 2);
  assert.ok(Math.abs(rowGaps[2] - rowGaps[3]) < 2);

  await page.getByRole("button", { name: "2 · Empty", exact: true }).click();
  await page
    .locator("dialog select[name=tyreId]")
    .selectOption({ label: "TYR-001 · MRF · New" });
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await record("Update odometer", { odometer: 1250 });
  await page.getByRole("button", { name: "2 · TYR-001", exact: true }).click();
  assert.match(await page.locator("dialog .detail-stats").innerText(), /250/);
  await page.getByRole("button", { name: "Remove tyre", exact: true }).click();
  await page.locator("dialog input[name=odometer]").fill("1300");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  let state = await (await context.request.get(base + "/api/state")).json();
  assert.equal(state.tyres[0].type, "used");
  assert.equal(state.tyres[0].distance, 300);
  console.log(
    "PASS: owner login, vehicle, all three tyre conditions, visual fitment, mileage and return",
  );
  await page
    .locator(".nav-items")
    .getByRole("button", { name: "Tyre inventory", exact: true })
    .click();
  await page.getByRole("button", { name: /TYR-001/ }).click();
  await record("Send for remolding", { vendor: "Sharvayu" });
  await page.getByRole("button", { name: /TYR-001/ }).click();
  await page
    .getByRole("button", { name: "Record remolding", exact: true })
    .click();
  assert.equal(
    await page.locator("dialog select[name=vendor]").inputValue(),
    "Sharvayu",
  );
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await page.getByRole("button", { name: /TYR-001/ }).click();
  await record("Send for remolding", {
    vendor: "other",
    customVendor: "Custom Retreads",
  });
  await page.getByRole("button", { name: /TYR-001/ }).click();
  await page
    .getByRole("button", { name: "Record remolding", exact: true })
    .click();
  assert.equal(
    await page.locator("dialog input[name=customVendor]").inputValue(),
    "Custom Retreads",
  );
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  state = await (await context.request.get(base + "/api/state")).json();
  assert.equal(state.tyres[0].lastRemoldVendor, "Custom Retreads");
  assert.equal(
    state.events.find((e) => e.kind === "sendRemold").vendor,
    "Sharvayu",
  );
  console.log(
    "PASS: remolding records preset and custom vendors, prefills return vendor and preserves history",
  );
  await context.request.post(base + "/api/team/create", {
    data: { username: "garage_staff", password: "test-staff-password" },
  });
  const staffContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const staff = await staffContext.newPage();
  staff.on("pageerror", (e) => errors.push(e.message));
  await staff.goto(base);
  await staff.locator("input[name=username]").fill("garage_staff");
  await staff.locator("input[name=password]").fill("test-staff-password");
  await staff
    .getByRole("button", { name: "Open my garage", exact: true })
    .click();
  await staff
    .getByRole("heading", { name: "Your fleet, at a glance" })
    .waitFor();
  assert.equal(
    await staff
      .getByRole("button", { name: "Add vehicle", exact: true })
      .count(),
    0,
  );
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
  await page
    .locator(".nav-items")
    .getByRole("button", { name: "Vehicles", exact: true })
    .click();
  await page.getByRole("button", { name: /RJ14AB1234/ }).click();
  await record("Change driver", { driverName: "Shyam" });
  await page
    .getByText("Driver changed — check all tyres.", { exact: true })
    .first()
    .waitFor();
  await record("Update odometer", { odometer: 1300 }); // Reminder is advisory.
  await staff
    .locator(".mobile-nav-items")
    .getByRole("button", { name: "Vehicles", exact: true })
    .click();
  assert.equal(
    await staff
      .getByRole("button", { name: "Add vehicle", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await staff
      .getByRole("button", { name: "Import from Excel", exact: true })
      .count(),
    0,
  );
  await staff.getByRole("button", { name: /RJ14AB1234/ }).click();
  await staff
    .getByRole("button", { name: "Record tyre inspection", exact: true })
    .click();
  assert.match(
    await staff.locator("dialog input[name=inspectedOn]").inputValue(),
    /^\d{2}\/\d{2}\/\d{4}$/,
  );
  await staff.locator("dialog input[name=allTyresChecked]").check();
  await staff.getByRole("button", { name: "Add issue", exact: true }).click();
  await staff.getByLabel("Position 1", { exact: true }).selectOption("FL");
  await staff
    .getByLabel("Issue 1", { exact: true })
    .selectOption("misalignment");
  assert.equal(await staff.locator("dialog input[type=number]").count(), 1);
  await staff.getByLabel("TYR-002 Average NSD (%)", { exact: true }).fill("65");
  await staff.getByRole("button", { name: "Save record", exact: true }).click();
  await staff.locator("dialog").waitFor({ state: "detached" });
  state = await (await context.request.get(base + "/api/state")).json();
  assert.equal(state.vehicles[0].pendingTyreCheck, false);
  assert.equal(state.events.at(-1).actor, "garage_staff");
  assert.equal(state.events.at(-1).driverCheckCompleted, true);
  assert.equal(state.tyres[1].nsd.averagePercent, 65);
  await page
    .locator(".vehicle-inspection-summary")
    .getByText("Wheel misalignment", { exact: false })
    .waitFor();
  await staff.screenshot({
    path: path.join(root, "artifacts/inspection-mobile.png"),
    fullPage: true,
  });
  await staff
    .getByRole("button", { name: "Vehicle report", exact: true })
    .click();
  await staff.getByRole("heading", { name: "Reports", exact: true }).waitFor();
  assert.equal(
    await staff.getByLabel("Vehicle", { exact: true }).inputValue(),
    state.vehicles[0].id,
  );
  assert.match(await staff.locator(".report-table tbody").innerText(), /BS6/);
  const reportDownload = staff.waitForEvent("download");
  await staff
    .getByRole("button", { name: "Export detail CSV", exact: true })
    .click();
  const detailCsv = await reportDownload;
  assert.match(detailCsv.suggestedFilename(), /report-details/);
  const detailText = readFileSync(await detailCsv.path(), "utf8");
  assert.match(detailText, /garage_staff/);
  assert.match(detailText, /65%/);
  assert.match(detailText, /Wheel misalignment/);
  assert.match(detailText, /\d{2}\/\d{2}\/\d{4}/);
  await staff
    .getByLabel("Date range", { exact: true })
    .selectOption("lastYear");
  assert.equal(await staff.locator(".report-event").count(), 0);
  await staff
    .getByLabel("Date range", { exact: true })
    .selectOption("thisMonth");
  assert.ok((await staff.locator(".report-event").count()) > 0);
  for (const width of [360, 390, 700]) {
    await staff.setViewportSize({ width, height: 900 });
    assert.ok(
      await staff.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
      `Report overflow at ${width}`,
    );
  }
  await staff.screenshot({
    path: path.join(root, "artifacts/reports-mobile.png"),
    fullPage: true,
  });
  console.log(
    "PASS: staff inspection records issue, direct tread percentages and completed driver check; per-vehicle date-filtered report and CSV work on mobile",
  );
  await staff.setViewportSize({ width: 390, height: 844 });
  await staff
    .locator(".mobile-nav-items")
    .getByRole("button", { name: "Tyre inventory", exact: true })
    .click();
  await staff
    .getByRole("button", { name: "Import tyres from Excel", exact: true })
    .click();
  const { default: writeExcelFile } = await import("write-excel-file/node");
  const { TYRE_HEADERS } = await import("../shared/tyre-import.js");
  const workbook = await writeExcelFile(
    [
      TYRE_HEADERS,
      ["00099", "JK Tyre", "New", "Radial", 0],
      ["IMPORT-R", "Apollo", "Remold", "Horse", 500],
      ["TYR-001", "MRF"],
      ["BAD", ""],
    ].map((row) =>
      row.map((value) => ({
        value,
        type: typeof value === "number" ? Number : String,
      })),
    ),
    { sheet: "Tyres" },
  ).toBuffer();
  await staff.getByLabel("Choose Excel file", { exact: true }).setInputFiles({
    name: "tyres.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook,
  });
  await staff
    .getByRole("button", { name: "Import 2 tyres", exact: true })
    .waitFor();
  await staff
    .getByRole("button", { name: "Import 2 tyres", exact: true })
    .click();
  await staff.locator("dialog").waitFor({ state: "detached" });
  state = await (await context.request.get(base + "/api/state")).json();
  assert.equal(state.tyres.length, 5);
  assert.equal(
    state.tyres.find((t) => t.serial === "00099").nsd.averagePercent,
    100,
  );
  assert.equal(
    state.tyres.find((t) => t.serial === "IMPORT-R").nsd.averagePercent,
    100,
  );
  await staff.getByRole("button", { name: /00099/ }).click();
  assert.equal(
    await staff
      .getByRole("button", { name: "Record NSD", exact: true })
      .count(),
    0,
  );
  assert.match(await staff.locator("dialog .nsd-summary").innerText(), /100%/);
  await staff
    .getByRole("button", { name: "Record tyre sale", exact: true })
    .click();
  await staff
    .locator("dialog textarea[name=note]")
    .fill("Buyer ABC invoice 42");
  await staff.getByRole("button", { name: "Save record", exact: true }).click();
  await staff.locator("dialog").waitFor({ state: "detached" });
  await staff.getByRole("button", { name: /^Sold/ }).click();
  assert.equal(await staff.locator(".tyre-row").count(), 1);
  await staff.getByRole("button", { name: /00099/ }).click();
  await staff
    .getByText(/Buyer ABC invoice 42/)
    .first()
    .waitFor();
  assert.equal(
    await staff
      .getByRole("button", { name: "Record tyre sale", exact: true })
      .count(),
    0,
  );
  state = await (await context.request.get(base + "/api/state")).json();
  assert.equal(state.events.at(-1).actor, "garage_staff");
  assert.equal(state.events.at(-1).tally.total, 4);
  assert.equal(state.events.at(-1).tally.sold, 1);
  await staff
    .locator("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  console.log(
    "PASS: staff cannot add/import vehicles; real tyre Excel import preserves IDs, skips duplicates, defaults NSD, and sold history leaves active stock",
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
  await staff.getByRole("heading", { name: "Horse", exact: false }).waitFor();
  await staff.getByRole("heading", { name: "Trolley", exact: false }).waitFor();
  assert.equal(
    await staff
      .getByRole("button", { name: "Vehicle Sold", exact: true })
      .count(),
    0,
  );
  const separation = await staff
    .locator(".axle-row")
    .evaluateAll(
      (rows) =>
        rows[2].getBoundingClientRect().top -
        rows[1].getBoundingClientRect().bottom,
    );
  assert.ok(separation >= 80, "Horse and trolley have a clear break");
  await record("Add vehicle", {
    registration: "RJ14SALE1",
    emissionClass: "BS4",
    odometer: 1000,
    hasSpare: true,
  });
  for (const serial of ["VSROAD", "VSSPARE"])
    await record("Add tyre", {
      serial,
      brand: "MRF",
      construction: "radial",
      type: "new",
    });
  state = await (await context.request.get(base + "/api/state")).json();
  const saleVehicle = state.vehicles.find(
    (v) => v.registration === "RJ14SALE1",
  );
  for (const [serial, slot] of [
    ["VSROAD", "FR"],
    ["VSSPARE", "SP"],
  ])
    await apiAction("fit", {
      vehicleId: saleVehicle.id,
      tyreId: state.tyres.find((t) => t.serial === serial).id,
      slot,
      odometer: 1000,
    });
  state = await (await context.request.get(base + "/api/state")).json();
  const activeBefore = state.events.at(-1).tally.total;
  await page
    .locator(".nav-items")
    .getByRole("button", { name: "Vehicles", exact: true })
    .click();
  await page.getByRole("button", { name: /RJ14SALE1/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Vehicle Sold", exact: true }).click();
  assert.equal(await page.locator("dialog .sale-tyre-list li").count(), 2);
  await page.locator("dialog input[name=odometer]").fill("1500");
  await page
    .locator("dialog textarea[name=note]")
    .fill("Vehicle buyer invoice 84");
  await page.locator("dialog input[name=confirmSale]").check();
  await page.screenshot({
    path: path.join(root, "artifacts/vehicle-sale-review-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Record sale", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  assert.equal(
    await page.getByRole("button", { name: /RJ14SALE1/ }).count(),
    0,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  state = await (await context.request.get(base + "/api/state")).json();
  assert.equal(state.events.at(-1).kind, "sellVehicle");
  assert.equal(state.events.at(-1).actor, "garage_owner");
  assert.equal(state.events.at(-1).tally.total, activeBefore - 2);
  assert.equal(state.tyres.find((t) => t.serial === "VSROAD").distance, 500);
  assert.equal(state.tyres.find((t) => t.serial === "VSSPARE").distance, 0);
  await staff
    .locator(".mobile-nav-items")
    .getByRole("button", { name: "Vehicles", exact: true })
    .click();
  assert.equal(
    await staff.getByRole("button", { name: /RJ14SALE1/ }).count(),
    0,
  );
  await staff.getByRole("button", { name: /Sold vehicles/ }).click();
  await staff.getByRole("button", { name: /RJ14SALE1/ }).click();
  await staff
    .getByText(
      "This vehicle and its fitted tyres are archived as sold. History and reports remain available.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await staff
      .getByRole("button", { name: "Update odometer", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await staff
      .getByRole("button", { name: "Record tyre inspection", exact: true })
      .count(),
    0,
  );
  await staff.screenshot({
    path: path.join(root, "artifacts/vehicle-sold-mobile.png"),
    fullPage: true,
  });
  await staff
    .locator(".mobile-nav-items")
    .getByRole("button", { name: "Tyre inventory", exact: true })
    .click();
  await staff.getByRole("button", { name: /^Sold/ }).click();
  await staff.getByRole("button", { name: /VSROAD/ }).click();
  await staff.getByText(/Sold with vehicle: RJ14SALE1/).waitFor();
  await staff
    .locator("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  console.log(
    "PASS: only admin sells vehicles; sale lists fitted tyres, closes road/spare km, removes active vehicle/stock and shares read-only vehicle and tyre history",
  );
  await staff
    .locator(".mobile-nav-items")
    .getByRole("button", { name: "Vehicles", exact: true })
    .click();
  await staff.getByRole("button", { name: /RJ14AB1234/ }).click();
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
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
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
  assert.equal(
    await page
      .getByRole("button", { name: "Save branding", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.locator(".company-logo").first().getAttribute("src"),
    "/branding/shepards-logo.png",
  );
  const brandContext = await browser.newContext();
  const loginPage = await brandContext.newPage();
  await loginPage.goto(base);
  await loginPage.locator(".company-banner-login").waitFor();
  assert.ok((await loginPage.locator(".company-logo").count()) > 0);
  await brandContext.close();
  console.log(
    "PASS: permanent company logo/banner load without any user upload",
  );
  const backupDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export records (JSON)", exact: true })
    .click();
  const backup = await backupDownload;
  assert.match(backup.suggestedFilename(), /\.json$/);
  console.log("PASS: movement CSV and record JSON export");
  await staff.evaluate(() => navigator.serviceWorker.ready);
  await staffContext.setOffline(true);
  await staff
    .getByRole("heading", {
      name: "आप ऑफलाइन हैं। कृपया इंटरनेट से कनेक्ट करें।",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await staff
      .getByRole("button", { name: "टायर जोड़ें", exact: true })
      .count(),
    0,
  );
  await staff.reload();
  await staff
    .getByRole("heading", {
      name: "आप ऑफलाइन हैं। कृपया इंटरनेट से कनेक्ट करें।",
      exact: true,
    })
    .waitFor();
  assert.equal(await staff.locator("input[name=password]").count(), 0);
  await staffContext.setOffline(false);
  await staff
    .getByRole("heading", { name: "आपके बेड़े का पूरा हिसाब" })
    .waitFor();
  assert.deepEqual(remoteLogoRequests, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: offline warning blocks access/entries, survives reload, and reconnect restores shared data; no runtime errors",
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
