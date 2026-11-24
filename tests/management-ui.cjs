const { chromium } = require("playwright");
const { spawn, spawnSync } = require("node:child_process");
const {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

// Disposable data only. Explicitly disable external databases and serverless
// configuration so this suite can never connect to a live fleet database.
const root = path.resolve(__dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "shepards-management-ui-"));
const fixtureFile = path.join(temp, "fixture.json");
const database = path.join(temp, "management.sqlite");
const base = `http://127.0.0.1:${process.env.MANAGEMENT_TEST_PORT || 3150}`;
const artifacts = path.join(root, "artifacts/management-review");
mkdirSync(artifacts, { recursive: true });
const environment = {
  ...process.env,
  DATABASE_URL: "",
  POSTGRES_URL: "",
  VERCEL: "0",
  PUBLIC_ORIGIN: "",
  TRUST_PROXY: "0",
  DATABASE_PATH: database,
};
const password = "public-management-ui-password";
const seeded = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
  import {createApp} from './server/app.js';
  import {emptyState,applyAction,dayKey} from './shared/model.js';
  import {addCalendarMonths} from './shared/dates.js';
  import {scryptSync} from 'node:crypto';
  import {writeFileSync} from 'node:fs';
  const {db}=createApp({dbPath:process.env.DATABASE_PATH});
  const salt='management-ui-public-test-salt';
  const hash=scryptSync('public-management-ui-password',salt,64).toString('hex');
  db.prepare("UPDATE users SET username=?,salt=?,hash=? WHERE role='owner'").run('management_owner',salt,hash);
  db.prepare("INSERT INTO users (username,salt,hash,role,active) VALUES (?,?,?,?,?)").run('management_staff',salt,hash,'staff',1);
  const today=dayKey();
  const offset=(days)=>{const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)};
  let state=emptyState();
  state.drivers=[
    {id:'driver-due',name:'Ramesh Kumar Singh / रमेश कुमार सिंह',dob:'1980-04-18',licenseNo:'MH1220200000001',licenseExpiry:offset(15),active:true},
    {id:'driver-expired',name:'Expired Licence Driver',dob:'1979-05-12',licenseNo:'MH1220200000002',licenseExpiry:offset(-1),active:true},
    {id:'driver-valid',name:'Mukesh Sharma with a long commercial vehicle driver name / मुकेश शर्मा',dob:'1985-07-24',licenseNo:'MH1220200000003',licenseExpiry:addCalendarMonths(today,12),active:true},
    {id:'driver-inactive',name:'Inactive Driver Example',dob:'1982-01-02',licenseNo:'MH1220200000004',licenseExpiry:addCalendarMonths(today,12),active:false}
  ];
  const run=(kind,payload)=>state=applyAction(state,{kind,payload},'management_fixture');
  run('addVehicle',{registration:'MGMT1234',driverId:'driver-due',emissionClass:'BS6',odometer:5000,hasSpare:false});
  run('addVehicle',{registration:'LEGACY1234',driverName:'Legacy Driver Name Retained',emissionClass:'BS4',odometer:1000,hasSpare:false});
  run('addTyre',{serial:'MGMTTYRE20261124',brand:'MRF',type:'new',construction:'radial',invoiceNo:'MGMT-PUBLIC-INV-001',amount:'12345.67'});
  db.prepare("UPDATE settings SET value=? WHERE key='state'").run(JSON.stringify(state));
  writeFileSync(process.env.MANAGEMENT_FIXTURE,JSON.stringify({today,expiredDay:offset(-1),dueDay:offset(15),legacy:'Legacy Driver Name Retained'}));
  db.close();
`,
  ],
  {
    cwd: root,
    env: { ...environment, MANAGEMENT_FIXTURE: fixtureFile },
    encoding: "utf8",
  },
);
assert.equal(seeded.status, 0, seeded.stderr);
const fixture = JSON.parse(readFileSync(fixtureFile, "utf8"));
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: root,
  env: { ...environment, NODE_ENV: "production", PORT: new URL(base).port },
  stdio: "pipe",
});
let logs = "",
  browser,
  page,
  locale = "en",
  dictionaries,
  displayDate;
server.stdout.on("data", (data) => {
  logs += data;
});
server.stderr.on("data", (data) => {
  logs += data;
});
const errors = [],
  checks = [];
const t = (key) => dictionaries[locale][key] || dictionaries.en[key] || key;

async function signin(account, ios = false) {
  const context = await browser.newContext({
    viewport: { width: ios ? 390 : 960, height: 900 },
    serviceWorkers: "block",
    ...(ios
      ? {
          isMobile: true,
          hasTouch: true,
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        }
      : {}),
  });
  const next = await context.newPage();
  next.on("pageerror", (error) => errors.push(error.message));
  await next.goto(base);
  await next.locator("input[name=username]").fill(account);
  await next.locator("input[name=password]").fill(password);
  await next
    .getByRole("button", { name: dictionaries.en.submitLogin, exact: true })
    .click();
  await next
    .getByRole("heading", { name: dictionaries.en.fleetOverview, exact: true })
    .waitFor();
  return { context, page: next };
}
async function activate(next) {
  page = next;
  locale = await page.locator("html").getAttribute("lang");
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
async function nav(key) {
  const mobile = await page.locator(".mobile-nav-items").isVisible();
  if (key === "drivers" && mobile) {
    await nav("vehicles");
    await page
      .locator(".page-heading")
      .getByRole("button", { name: t("drivers"), exact: true })
      .click();
  } else if (key === "settings" && mobile)
    await page.locator(".mobile-settings:visible").click();
  else
    await page
      .locator(mobile ? ".mobile-nav-items" : ".sidebar .nav-items")
      .getByRole("button", { name: t(key), exact: true })
      .click();
  if (key === "drivers")
    await page.locator('[data-testid="driver-management"]').waitFor();
  else
    await page
      .getByRole("heading", {
        name: key === "dashboard" ? t("fleetOverview") : t(key),
        exact: true,
      })
      .first()
      .waitFor();
}
const state = () =>
  page.evaluate(() => fetch("/api/state").then((response) => response.json()));
async function closeDialog() {
  await page.locator("dialog[open] .dialog-header button").click();
  await page.locator("dialog").waitFor({ state: "detached" });
}
async function screenshot(name) {
  await page.evaluate(() => document.fonts.ready);
  await page
    .locator(".toast button")
    .evaluateAll((buttons) => buttons.forEach((button) => button.click()));
  await page.screenshot({
    path: path.join(artifacts, `${name}.png`),
    fullPage: false,
  });
}

async function layout(label) {
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => {
    const dialog = document.querySelector("dialog[open]");
    const scope =
      dialog ||
      document.querySelector('[data-testid="driver-management"]') ||
      document.querySelector('[data-testid="reminder-settings"]');
    const overlap = [];
    for (const selector of [
      ".driver-grid > .driver-record",
      ".driver-filter-tabs > button",
      ".reminder-interval-fields > .field",
      ".reminder-settings-actions > button",
      ".driver-form-actions > button",
    ]) {
      const boxes = [...document.querySelectorAll(selector)]
        .filter((el) => el.getClientRects().length)
        .map((el) => el.getBoundingClientRect());
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++)
          if (
            Math.min(boxes[i].right, boxes[j].right) -
              Math.max(boxes[i].left, boxes[j].left) >
              1 &&
            Math.min(boxes[i].bottom, boxes[j].bottom) -
              Math.max(boxes[i].top, boxes[j].top) >
              1
          )
            overlap.push(selector);
    }
    const small = scope
      ? [
          ...scope.querySelectorAll(
            "button,input:not([type=checkbox]):not([type=hidden]),select",
          ),
        ]
          .filter((el) => el.getClientRects().length)
          .flatMap((el) => {
            const r = el.getBoundingClientRect(),
              font = parseFloat(getComputedStyle(el).fontSize);
            return r.height < 43.5 ||
              r.width < 43.5 ||
              (el.tagName !== "BUTTON" && font < 16)
              ? [
                  {
                    tag: el.tagName,
                    name: el.name || el.textContent,
                    width: r.width,
                    height: r.height,
                    font,
                  },
                ]
              : [];
          })
      : [];
    return {
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      overlap,
      small,
    };
  });
  assert.ok(
    result.scroll <= result.width + 1,
    `${label}: document overflow ${result.scroll}/${result.width}`,
  );
  assert.deepEqual(result.overlap, [], `${label}: cards or controls overlap`);
  assert.deepEqual(result.small, [], `${label}: 44px controls / 16px inputs`);
  checks.push(label);
}

async function addDriver(name, license) {
  await nav("drivers");
  await page.getByTestId("add-driver").click();
  const dialog = page.locator("dialog[open]");
  await dialog.locator('input[name="name"]').fill(name);
  await dialog.locator('input[name="dob"]').fill("18/04/1987");
  await dialog.locator('input[name="licenseNo"]').fill(license);
  await dialog.locator('input[name="licenseExpiry"]').fill("31/12/2035");
  await layout(`${locale}/add driver form`);
  await dialog.getByRole("button", { name: t("save"), exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  const latest = await state();
  const driver = latest.drivers.find((item) => item.licenseNo === license);
  assert.ok(driver);
  assert.equal(latest.events.at(-1).kind, "addDriver");
  return driver;
}
async function chooseDriver(search, id) {
  const picker = page.getByTestId("driver-picker");
  await picker.getByRole("combobox").fill(search);
  await picker.getByRole("combobox").press("ArrowDown");
  await picker.getByRole("combobox").press("Enter");
  assert.equal(await picker.locator('input[name="driverId"]').inputValue(), id);
  assert.equal(
    await picker.getByRole("combobox").getAttribute("aria-expanded"),
    "false",
  );
}

async function coreFlows(owner, staff) {
  await activate(owner.page);
  await nav("drivers");
  assert.equal(await page.locator(".driver-record").count(), 4);
  assert.equal(await page.locator(".driver-license-due").count(), 1);
  assert.equal(await page.locator(".driver-license-expired").count(), 1);
  assert.match(
    await page.locator(".driver-license-due").textContent(),
    new RegExp(displayDate(fixture.dueDay)),
  );
  const colors = await page
    .locator(".driver-license-due, .driver-license-expired")
    .evaluateAll((elements) =>
      elements.map((el) => getComputedStyle(el).backgroundColor),
    );
  assert.notEqual(colors[0], colors[1]);
  await screenshot("drivers-initial-license-warnings");
  await page.locator(".driver-search input").fill("MH1220200000001");
  assert.equal(await page.locator(".driver-record").count(), 1);
  await page.locator(".driver-search input").fill("");
  const added = await addDriver(
    "Owner Added Driver / मालिक द्वारा जोड़ा गया",
    "MHTEST2026000005",
  );
  assert.equal((await state()).events.at(-1).actor, "management_owner");
  await page
    .locator(`.driver-record[data-driver-id="${added.id}"] .driver-edit-button`)
    .click();
  await page.locator('dialog input[name="name"]').fill("Updated Owner Driver");
  await page
    .locator('dialog input[name="licenseExpiry"]')
    .fill(displayDate(fixture.expiredDay));
  await page
    .locator("dialog")
    .getByRole("button", { name: t("save"), exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "detached" });
  assert.equal((await state()).events.at(-1).kind, "updateDriver");
  const originalProfile = (await state()).drivers.find(
    (driver) => driver.id === added.id,
  );
  const expectedDriver = Object.fromEntries(
    ["name", "dob", "licenseNo", "licenseExpiry", "active"].map((key) => [
      key,
      originalProfile[key],
    ]),
  );
  await page
    .locator(`.driver-record[data-driver-id="${added.id}"] .driver-edit-button`)
    .click();
  await page
    .locator('dialog input[name="name"]')
    .fill("My unsaved correction must not overwrite a colleague");
  const concurrent = await staff.page.evaluate(
    async ({ driverId, expectedDriver }) => {
      const current = await fetch("/api/state").then((response) =>
        response.json(),
      );
      const response = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "updateDriver",
          revision: current.revision,
          payload: {
            driverId,
            name: "Concurrent staff correction",
            expectedDriver,
          },
        }),
      });
      return { status: response.status, data: await response.json() };
    },
    { driverId: added.id, expectedDriver },
  );
  assert.equal(concurrent.status, 200);
  await page.waitForFunction(
    (driverId) =>
      document.querySelector(`.driver-record[data-driver-id="${driverId}"] h3`)
        ?.textContent === "Concurrent staff correction",
    added.id,
  );
  assert.equal(
    await page.locator('dialog input[name="name"]').inputValue(),
    "My unsaved correction must not overwrite a colleague",
  );
  await page
    .locator("dialog")
    .getByRole("button", { name: t("save"), exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: t("driverChanged") })
    .waitFor();
  assert.equal(
    (await state()).drivers.find((driver) => driver.id === added.id).name,
    "Concurrent staff correction",
  );
  await closeDialog();
  await page
    .locator(`.driver-record[data-driver-id="${added.id}"] .driver-edit-button`)
    .click();
  assert.equal(
    await page.locator('dialog input[name="name"]').inputValue(),
    "Concurrent staff correction",
  );
  await closeDialog();
  const duplicateRevision = (await state()).revision;
  await page.getByTestId("add-driver").click();
  await page
    .locator('dialog input[name="name"]')
    .fill("Duplicate licence test");
  await page.locator('dialog input[name="dob"]').fill("18/04/1987");
  await page.locator('dialog input[name="licenseNo"]').fill("MHTEST2026000005");
  await page.locator('dialog input[name="licenseExpiry"]').fill("31/12/2035");
  await page
    .locator("dialog")
    .getByRole("button", { name: t("save"), exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: t("duplicateLicense") })
    .waitFor();
  assert.equal((await state()).revision, duplicateRevision);
  await closeDialog();
  await nav("vehicles");
  await page
    .getByRole("button", { name: t("addVehicle"), exact: true })
    .click();
  await page.locator('dialog input[name="registration"]').fill("MGMTNEW123");
  await page.locator('dialog select[name="emissionClass"]').selectOption("BS6");
  const combobox = page.getByTestId("driver-picker").getByRole("combobox");
  await combobox.fill("Unregistered search must not silently save");
  assert.equal(await combobox.evaluate((el) => el.checkValidity()), false);
  await combobox.fill("Inactive Driver Example");
  assert.equal(
    await page.getByTestId("driver-picker").getByRole("option").count(),
    0,
  );
  await chooseDriver("MHTEST2026000005", added.id);
  await layout("owner/stable driver picker");
  await page
    .locator("dialog")
    .getByRole("button", { name: t("save"), exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "detached" });
  const afterVehicle = await state();
  assert.equal(
    afterVehicle.vehicles.find(
      (vehicle) => vehicle.registration === "MGMTNEW123",
    ).driverId,
    added.id,
  );
  assert.equal(
    afterVehicle.vehicles.find(
      (vehicle) => vehicle.registration === "LEGACY1234",
    ).driverName,
    fixture.legacy,
  );

  await activate(staff.page);
  await language("hi");
  const staffDriver = await addDriver(
    "कर्मचारी द्वारा जोड़ा गया ड्राइवर",
    "MHTEST2026000006",
  );
  assert.equal((await state()).events.at(-1).actor, "management_staff");
  await page
    .locator(
      `.driver-record[data-driver-id="${staffDriver.id}"] .driver-edit-button`,
    )
    .click();
  await page
    .locator('dialog input[name="name"]')
    .fill("कर्मचारी द्वारा बदला गया नाम");
  await page
    .locator("dialog")
    .getByRole("button", { name: t("save"), exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "detached" });
  assert.equal((await state()).events.at(-1).actor, "management_staff");
  await nav("settings");
  assert.equal(
    await page.getByTestId("reminder-settings").count(),
    0,
    "staff have no admin reminder controls",
  );
  await nav("vehicles");
  assert.equal(
    await page
      .getByRole("button", { name: t("addVehicle"), exact: true })
      .count(),
    0,
  );
  await page.locator(".vehicle-card").filter({ hasText: "MGMTNEW123" }).click();
  await page
    .getByRole("button", { name: t("changeDriver"), exact: true })
    .click();
  await chooseDriver("MHTEST2026000006", staffDriver.id);
  await page
    .locator("dialog")
    .getByRole("button", { name: t("save"), exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "detached" });
  const staffChanged = await state();
  assert.equal(staffChanged.events.at(-1).kind, "changeDriver");
  assert.equal(staffChanged.events.at(-1).actor, "management_staff");

  await activate(owner.page);
  await nav("drivers");
  await page
    .locator(`.driver-record[data-driver-id="${staffDriver.id}"]`)
    .filter({ hasText: "MGMTNEW123" })
    .waitFor();
  await nav("settings");
  const reminders = page.getByTestId("reminder-settings");
  await reminders.locator('input[name="nsdValue"]').fill("3");
  await reminders.locator('select[name="nsdUnit"]').selectOption("weeks");
  await reminders.locator('input[name="inspectionValue"]').fill("6");
  await reminders.locator('input[name="driverLicenseValue"]').fill("2");
  await reminders
    .locator('select[name="driverLicenseUnit"]')
    .selectOption("weeks");
  await reminders.locator('input[name="driverChangeValue"]').fill("2");
  await reminders
    .getByRole("button", { name: t("saveReminderSettings"), exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(
        '[data-testid="reminder-settings"] .reminder-settings-actions > span',
      )?.textContent === "",
  );
  const settings = (await state()).reminderSettings;
  assert.deepEqual(settings, {
    nsd: { value: 3, unit: "weeks" },
    inspection: { value: 6, unit: "months" },
    driverLicense: { value: 2, unit: "weeks" },
    driverChange: { value: 2, unit: "days" },
  });
  await reminders.locator('input[name="nsdValue"]').fill("0");
  assert.equal(
    await reminders
      .locator('input[name="nsdValue"]')
      .evaluate((el) => el.checkValidity()),
    false,
  );
  await reminders
    .getByRole("button", { name: t("reminderReset"), exact: true })
    .click();
  assert.equal(
    await reminders.locator('input[name="nsdValue"]').inputValue(),
    "3",
  );
  checks.push(
    "owner/staff add+edit/concurrent edit protection/duplicate protection/stable assignment/legacy retention/owner reminder save",
  );
}

async function integratedTyreAndReports(owner, staff) {
  await activate(owner.page);
  await nav("inventory");
  await page
    .locator(".inventory-toolbar input")
    .first()
    .fill("MGMTTYRE20261124");
  await page
    .locator(".tyre-row")
    .filter({ hasText: "MGMTTYRE20261124" })
    .click();
  const costsBefore = (await state()).costs.length;
  await page
    .locator("dialog")
    .getByRole("button", { name: t("editTyre"), exact: true })
    .click();
  await page.locator('dialog input[name="serial"]').fill("CORRECTEDTYRE2026");
  await page.locator('dialog select[name="brand"]').selectOption("Apollo");
  await page
    .locator('dialog select[name="construction"]')
    .selectOption("horse");
  await layout("owner/edit tyre identity");
  await page
    .locator("dialog")
    .getByRole("button", { name: t("save"), exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "detached" });
  const changed = await state();
  const tyre = changed.tyres.find(
    (item) => item.serial === "CORRECTEDTYRE2026",
  );
  assert.ok(tyre);
  assert.equal(tyre.brand, "Apollo");
  assert.equal(tyre.construction, "horse");
  assert.ok(tyre.serialAliases.includes("MGMTTYRE20261124"));
  assert.equal(
    changed.costs.length,
    costsBefore,
    "identity correction does not add a second purchase",
  );
  assert.equal(
    await page.locator(".inventory-toolbar input").first().inputValue(),
    "MGMTTYRE20261124",
  );
  await page
    .locator(".tyre-row")
    .filter({ hasText: "CORRECTEDTYRE2026" })
    .waitFor();
  await nav("dashboard");
  await page.getByRole("button", { name: t("addTyre"), exact: true }).click();
  await page
    .locator("dialog .add-tyre-import")
    .getByRole("button", { name: t("importTyres"), exact: true })
    .click();
  await page
    .locator("dialog .import-file input[type=file]")
    .waitFor({ state: "attached" });
  await closeDialog();
  await nav("reports");
  await page
    .locator(".report-view-switch")
    .getByRole("button", { name: t("costReport"), exact: true })
    .click();
  await page.locator(".cost-report .cost-ledger").waitFor();
  assert.match(await page.locator(".cost-totals").textContent(), /12,345\.67/);
  assert.equal(await page.locator(".cost-ledger tbody tr").count(), 1);
  await page.locator(".cost-report").scrollIntoViewIfNeeded();
  await screenshot("owner-cost-report-integration");

  await activate(staff.page);
  const forbiddenRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/reports/costs"))
      forbiddenRequests.push(request.url());
  });
  await nav("inventory");
  await page
    .locator(".inventory-toolbar input")
    .first()
    .fill("CORRECTEDTYRE2026");
  await page
    .locator(".tyre-row")
    .filter({ hasText: "CORRECTEDTYRE2026" })
    .click();
  assert.equal(
    await page
      .locator("dialog")
      .getByRole("button", { name: t("editTyre"), exact: true })
      .count(),
    0,
  );
  assert.equal(await page.locator("dialog .invoice-history").count(), 0);
  await closeDialog();
  await nav("reports");
  assert.equal(await page.locator(".report-view-switch").count(), 0);
  assert.equal(await page.locator(".cost-report").count(), 0);
  assert.deepEqual(forbiddenRequests, []);
  checks.push(
    "owner tyre correction/add-dialog Excel entry/cost report; staff finance/edit restrictions",
  );
}

async function nativeAndroidBack() {
  const canonical = "https://www.shepards-tyre-management.com";
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    serviceWorkers: "block",
  });
  await context.addInitScript((server) => {
    window.CapacitorCustomPlatform = { name: "android" };
    localStorage.setItem("ts-server", JSON.stringify(server));
    localStorage.setItem("ts-lang", JSON.stringify("en"));
    localStorage.removeItem("ts-token");
    const app = (window.androidAppTest = {
      listeners: new Map(),
      registered: 0,
      emitted: 0,
      exitCalls: 0,
    });
    // Exercise the real Capacitor proxy's listener registration. Only the
    // platform bridge is mocked; no navigation or dialog behavior lives here.
    window.Capacitor = {
      PluginHeaders: [
        {
          name: "App",
          methods: [
            { name: "addListener", rtype: "callback" },
            { name: "removeListener", rtype: "promise" },
            { name: "exitApp", rtype: "promise" },
          ],
        },
      ],
      nativeCallback(plugin, method, options, callback) {
        if (plugin !== "App" || method !== "addListener")
          throw new Error("Unexpected native callback in test");
        const id = String(++app.registered);
        app.listeners.set(id, { event: options.eventName, callback });
        return id;
      },
      nativePromise(plugin, method, options) {
        if (plugin !== "App")
          throw new Error("Unexpected native promise in test");
        if (method === "removeListener")
          app.listeners.delete(options.callbackId);
        else if (method === "exitApp") app.exitCalls++;
        return Promise.resolve();
      },
    };
    window.emitAndroidBack = () => {
      const listener = [...app.listeners.values()].find(
        (item) => item.event === "backButton",
      );
      if (!listener)
        throw new Error("The application did not register Android Back");
      app.emitted++;
      listener.callback({ canGoBack: false });
    };
  }, canonical);
  const unexpected = [],
    traffic = [];
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
      authorization: request.headers().authorization,
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
      await route.fulfill({
        response,
        headers: { ...response.headers(), ...cors },
      });
    } catch {
      // Context closure legitimately cancels the application's long poll.
      await route.abort().catch(() => {});
    }
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  locale = "en";
  await page.goto(base);
  await page.locator("input[name=username]").fill("management_owner");
  await page.locator("input[name=password]").fill(password);
  await page
    .getByRole("button", { name: t("submitLogin"), exact: true })
    .click();
  await page
    .getByRole("heading", { name: t("fleetOverview"), exact: true })
    .waitFor();
  const registrations = await page.evaluate(
    () => window.androidAppTest.registered,
  );
  await nav("drivers");
  await page.waitForFunction(
    (previous) =>
      window.androidAppTest.registered >= previous + 2 &&
      window.androidAppTest.listeners.size === 1,
    registrations,
  );
  await page.getByTestId("add-driver").click();
  await page.locator("dialog[open] [data-testid=driver-form]").waitFor();
  await page
    .locator('dialog input[name="name"]')
    .fill("Unsaved Android Back fixture");
  await page.evaluate(() => window.emitAndroidBack());
  await page.locator("dialog").waitFor({ state: "detached" });
  assert.equal(
    await page.getByTestId("driver-management").isVisible(),
    true,
    "native Android Back closes the local driver dialog and retains Drivers",
  );
  assert.equal(
    await page
      .getByRole("heading", { name: t("fleetOverview"), exact: true })
      .count(),
    0,
  );
  assert.equal(await page.evaluate(() => window.androidAppTest.exitCalls), 0);
  assert.equal(await page.evaluate(() => window.androidAppTest.emitted), 1);
  assert.notEqual(
    await page.evaluate(() => document.body.style.overflow),
    "hidden",
  );
  assert.ok(
    traffic.some(
      (request) =>
        request.path === "/api/state" &&
        /^Bearer [a-f0-9]{64}$/.test(request.authorization || ""),
    ),
    "native fixture authenticates with a bearer token, without website cookies",
  );
  assert.deepEqual(
    unexpected,
    [],
    "native fixture never contacts an external backend",
  );
  await screenshot("native-android-driver-dialog-back");
  checks.push(
    "native Android Back closes the local driver dialog and retains Drivers",
  );
  await context.close();
}

async function viewMatrix(target, ios) {
  await activate(target.page);
  for (const scheme of ios ? ["light", "dark"] : ["light"]) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const lang of ["en", "hi"]) {
      await language(lang);
      for (const width of ios ? [390, 834] : [375, 960, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of ["drivers", "settings"]) {
          await nav(route);
          await layout(
            `${ios ? "ios" : "default"}/${scheme}/${lang}/${width}/${route}`,
          );
          const region = page.getByTestId(
            route === "drivers" ? "driver-management" : "reminder-settings",
          );
          await region.evaluate((el) => el.scrollIntoView({ block: "start" }));
          await page.evaluate(() => window.scrollBy(0, -100));
          await screenshot(
            `${route}-${ios ? "ios" : "default"}-${scheme}-${lang}-${width}`,
          );
        }
        await nav("drivers");
        await page.getByTestId("add-driver").click();
        await layout(
          `${ios ? "ios" : "default"}/${scheme}/${lang}/${width}/driver-form`,
        );
        await screenshot(
          `driver-form-${ios ? "ios" : "default"}-${scheme}-${lang}-${width}`,
        );
        await closeDialog();
      }
    }
  }
}
async function main() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 79)
      throw new Error(`Management fixture server failed: ${logs}`);
  }
  dictionaries = await import("../src/i18n.js");
  ({ displayDate } = await import("../shared/dates.js"));
  browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_PATH ||
      (existsSync(chromium.executablePath())
        ? chromium.executablePath()
        : "/usr/bin/chromium"),
    headless: true,
    args: ["--no-sandbox"],
  });
  if (process.env.MANAGEMENT_NATIVE_BACK_ONLY === "1") {
    await nativeAndroidBack();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: native Android bridge Back closes the local driver dialog without navigation or exit.",
    );
    return;
  }
  const owner = await signin("management_owner");
  assert.equal(
    await owner.page.locator(".sidebar .support-mark").count(),
    0,
    "the removed sidebar shield/tagline block stays absent",
  );
  if (process.env.MANAGEMENT_CAPTURE_ONLY === "1") {
    const ios = await signin("management_owner", true);
    await activate(owner.page);
    await nav("drivers");
    await screenshot("drivers-initial-license-warnings");
    for (const target of [
      { ios: false, width: 960, lang: "en", scheme: "light" },
      { ios: false, width: 375, lang: "hi", scheme: "light" },
      { ios: true, width: 390, lang: "hi", scheme: "dark" },
      { ios: true, width: 834, lang: "hi", scheme: "dark" },
    ]) {
      await activate(target.ios ? ios.page : owner.page);
      await page.setViewportSize({ width: target.width, height: 900 });
      await page.emulateMedia({ colorScheme: target.scheme });
      await language(target.lang);
      await nav("settings");
      await layout(
        `capture/reminders/${target.width}/${target.lang}/${target.scheme}`,
      );
      await page
        .getByTestId("reminder-settings")
        .evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.evaluate(() => window.scrollBy(0, -100));
      await screenshot(
        `settings-${target.ios ? "ios" : "default"}-${target.scheme}-${target.lang}-${target.width}`,
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      `PASS: ${checks.length} focused reminder layout captures; no fleet data used.`,
    );
    return;
  }
  const staff = await signin("management_staff");
  await coreFlows(owner, staff);
  await integratedTyreAndReports(owner, staff);
  await viewMatrix(owner, false);
  const ios = await signin("management_owner", true);
  await viewMatrix(ios, true);
  await nativeAndroidBack();
  assert.deepEqual(errors, []);
  writeFileSync(
    path.join(artifacts, "coverage.json"),
    JSON.stringify(
      {
        checks,
        screens: checks.length,
        isolatedDatabase: true,
        browser: "Chromium; iOS CSS uses iPhone emulation",
        languages: ["en", "hi"],
        widths: [375, 390, 834, 960, 1440],
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${checks.length} driver/reminder flow and layout checks, admin+staff actions, stable IDs, Hindi, 44px controls and iOS light/dark.`,
  );
}
main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    if (page && !page.isClosed()) await screenshot("failure").catch(() => {});
  })
  .finally(async () => {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    if (server.exitCode === null)
      await new Promise((resolve) => server.once("exit", resolve));
    rmSync(temp, { recursive: true, force: true });
  });
