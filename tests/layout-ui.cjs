const { chromium } = require("playwright");
const { spawn, spawnSync } = require("node:child_process");
const {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

// All data, passwords and account changes in this suite are isolated fixtures.
const root = path.resolve(__dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "shepards-layout-"));
const database = path.join(temp, "layout.sqlite");
const fixturePath = path.join(temp, "fixture.json");
const port = process.env.LAYOUT_TEST_PORT || "3135";
const base = `http://127.0.0.1:${port}`;
const artifacts = path.join(root, "artifacts/layout-review");
mkdirSync(artifacts, { recursive: true });

const seeded = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
  import {createApp} from './server/app.js';
  import {applyAction,emptyState,numberedSlots,dayKey} from './shared/model.js';
  import {manufacturers} from './shared/catalogue.js';
  import {scryptSync} from 'node:crypto';
  import {writeFileSync} from 'node:fs';
  const {db}=createApp({dbPath:process.env.DATABASE_PATH});
  db.prepare("UPDATE users SET username=?,salt=?,hash=? WHERE role='owner'").run('layout_admin','layout-only-salt',scryptSync('layout-test-password','layout-only-salt',64).toString('hex'));
  const longUsername='staff_member_'.padEnd(40,'x');
  db.prepare("INSERT INTO users (username,salt,hash,role,active) VALUES (?,?,?,?,?)").run(longUsername,'staff-layout-salt',scryptSync('staff-layout-password','staff-layout-salt',64).toString('hex'),'staff',1);
  db.prepare("INSERT INTO users (username,salt,hash,role,active) VALUES (?,?,?,?,?)").run('retired_staff_'.padEnd(40,'y'),'retired-layout-salt',scryptSync('retired-layout-password','retired-layout-salt',64).toString('hex'),'staff',0);
  let state=emptyState();const now=new Date();
  const run=(kind,payload)=>state=applyAction(state,{kind,payload},'fleet_operator_with_long_username',now);
  const primary='MH46AF7655',secondary='MH46AF1234',soldReg='MH46AA9999';
  run('addVehicle',{registration:primary,name:'Mumbai — Pune — commercial trailer route and garage records',driverName:'Ramesh Kumar Singh / रमेश कुमार सिंह',emissionClass:'BS6',hasSpare:true,odometer:125000});
  run('addVehicle',{registration:secondary,name:'Interstate commercial fleet long vehicle route',driverName:'Shyam Singh',emissionClass:'BS4',hasSpare:false,odometer:5000});
  run('addVehicle',{registration:soldReg,name:'Archived vehicle with retained tyre records',emissionClass:'BS3',hasSpare:true,odometer:20000});
  const full=state.vehicles[0],second=state.vehicles[1],archived=state.vehicles[2];
  const installationVehicles=[second.id];
  for(const registration of ['MH46AF2345','MH46AF3456']){run('addVehicle',{registration,name:'Condition and status layout fixture',emissionClass:'BS6',hasSpare:false,odometer:5000});installationVehicles.push(state.vehicles.at(-1).id);}
  let serialCounter=56665445677;
  const nextSerial=()=> '3E'+String(serialCounter++);
  const cases=[];
  // A full map includes realistic 11- and 13-character serials and every brand.
  for(const [i,slot]of [...numberedSlots,'SP'].entries()){
    const serial=i===1?'3E134556677':nextSerial();
    run('addTyre',{serial,brand:manufacturers[i%7].name,type:['new','used','remold'][i%3],construction:i%2?'horse':'radial',distance:i%3?20000:0});
    run('fit',{tyreId:state.tyres.at(-1).id,vehicleId:full.id,slot,odometer:125000});
    if(i===14)cases.push({serial,brand:manufacturers[i%7].name,status:'installed',type:'remold',construction:'radial'});
  }
  run('changeDriver',{vehicleId:full.id,driverName:'Mukesh Sharma / मुकेश शर्मा'});
  run('inspectVehicle',{vehicleId:full.id,inspectedOn:dayKey(now),allTyresChecked:false,note:'Inspection details with a long readable workshop note. '.repeat(7),findings:[{slot:'FR',issue:'misalignment',detail:'Wheel alignment needs a garage check before the next long route.'},{slot:'FL',issue:'other',detail:'A detailed observation recorded by the tyre inspection team. '.repeat(3)}],nsdMeasurements:[{tyreId:state.tyres[0].id,slot:state.tyres[0].slot,averagePercent:55.5}]});
  const statuses=['stock','installed','remolding','scrapped','sold'];let installedIndex=0;
  // Full finite cross product: 7 brands × 3 conditions × 2 constructions × 5 statuses.
  for(const make of manufacturers){
    for(const type of ['new','used','remold'])for(const construction of ['radial','horse'])for(const status of statuses){
      const serial=nextSerial();
      run('addTyre',{serial,brand:make.name,type,construction,distance:type==='new'?0:32500,note:'Receipt reference and batch note for realistic card layouts.'});
      const tyreId=state.tyres.at(-1).id;
      if(status==='installed'){
        run('fit',{tyreId,vehicleId:installationVehicles[Math.floor(installedIndex/18)],slot:numberedSlots[installedIndex%18],odometer:5000});installedIndex++;
      }
      if(status==='remolding')run('sendRemold',{tyreId,vendor:'other',customVendor:'Regional Retreading Workshop and Commercial Tyre Service Centre',note:'Vendor dispatch note '.repeat(12)});
      if(status==='scrapped')run('scrap',{tyreId,scrapReason:'other',scrapDetail:'Casing damage recorded during workshop assessment. '.repeat(4)});
      if(status==='sold')run('sell',{tyreId,note:'Buyer and invoice reference for retained sale records. '.repeat(6)});
      cases.push({serial,brand:make.name,status,type,construction});
    }
  }
  const customBrands=['North India Commercial Tyres and Retreading Works','RegionalRetreadingManufacturerWithAnUnusuallyLongSingleWord'];
  for(const [i,brand]of customBrands.entries()){
    const serial=nextSerial();run('addTyre',{serial,brand,type:i?'used':'remold',construction:i?'horse':'radial',distance:99887766});
    cases.push({serial,brand,status:'stock',type:i?'used':'remold',construction:i?'horse':'radial',custom:true});
  }
  for(const [i,slot]of ['FR','SP'].entries()){
    run('addTyre',{serial:nextSerial(),brand:i?'Goodyear':'Michelin',type:'used',construction:'radial',distance:44444});
    run('fit',{tyreId:state.tyres.at(-1).id,vehicleId:archived.id,slot,odometer:20000});
  }
  run('sellVehicle',{vehicleId:archived.id,odometer:22000,note:'Vehicle sale record — buyer reference retained with complete history.'});
  for(const item of cases){const tyre=state.tyres.find(t=>t.serial===item.serial);item.distance=tyre.distance;item.remolds=tyre.remolds;}
  db.prepare("UPDATE settings SET value=? WHERE key='state'").run(JSON.stringify(state));
  writeFileSync(process.env.LAYOUT_FIXTURE,JSON.stringify({primary,secondary,soldReg,longUsername,cases,stockSerial:cases.find(t=>t.status==='stock').serial}));db.close();
`,
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_PATH: database,
      LAYOUT_FIXTURE: fixturePath,
    },
    encoding: "utf8",
  },
);
assert.equal(seeded.status, 0, seeded.stderr);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: port,
    DATABASE_PATH: database,
  },
  stdio: "pipe",
});
let serverOutput = "",
  browser,
  page;
server.stdout.on("data", (data) => (serverOutput += data));
server.stderr.on("data", (data) => (serverOutput += data));
const runtimeErrors = [];
const reviewed = [];
let locale = "en",
  translations;
const t = (key) => translations[locale][key] || translations.en[key] || key;

async function checkLayout(label) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const result = await page.evaluate(() => {
    const overlap = [];
    const groups = [
      ".heading-actions > button",
      ".vehicle-grid > .vehicle-card",
      ".tyre-list > .tyre-row",
      ".report-filters > .field",
      ".stats-grid > .stat-card",
      ".tyre-summary-stats > div",
    ];
    for (const selector of groups) {
      const boxes = [...document.querySelectorAll(selector)]
        .filter((el) => el.getClientRects().length)
        .map((el) => ({
          text: el.textContent.slice(0, 80),
          r: el.getBoundingClientRect(),
        }));
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i],
            b = boxes[j];
          const width =
              Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left),
            height =
              Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (width > 2 && height > 2)
            overlap.push({ selector, a: a.text, b: b.text, width, height });
        }
    }
    return {
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overlap,
      activityBrandOverflow: [
        ...document.querySelectorAll(
          ".activity-row .manufacturer-name.canonical",
        ),
      ].flatMap((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect(),
          body = el
            .closest(".activity-row")
            .children[1].getBoundingClientRect();
        return r.left < body.left - 1 || r.right > body.right + 1
          ? [
              {
                name: el.textContent,
                left: r.left,
                right: r.right,
                bodyLeft: body.left,
                bodyRight: body.right,
              },
            ]
          : [];
      }),
    };
  });
  assert.ok(
    result.scrollWidth <= result.width + 1,
    `${label}: document overflows ${result.scrollWidth}/${result.width}`,
  );
  assert.deepEqual(
    result.overlap,
    [],
    `${label}: overlapping independent cards or controls`,
  );
  assert.deepEqual(
    result.activityBrandOverflow,
    [],
    `${label}: activity brand text spills outside its content column`,
  );
  const brand = page.locator(".brand:visible").first();
  if (await brand.count()) {
    const heights = await brand.evaluate((el) => {
      const logo = el.querySelector(".company-logo").getBoundingClientRect(),
        wordmark = el
          .querySelector(".company-wordmark")
          .getBoundingClientRect();
      return {
        logo: logo.height,
        wordmark: wordmark.height,
        top: Math.abs(logo.top - wordmark.top),
        caption: (() => {
          const node = el.querySelector(".company-wordmark small"),
            range = document.createRange();
          range.selectNodeContents(node);
          const text = range.getBoundingClientRect();
          return {
            left: text.left,
            right: text.right,
            panelLeft: wordmark.left,
            panelRight: wordmark.right,
          };
        })(),
      };
    });
    assert.ok(
      Math.abs(heights.logo - heights.wordmark) <= 1,
      `${label}: company panels unequal height: ${JSON.stringify(heights)}`,
    );
    assert.ok(
      heights.top <= 1,
      `${label}: company panels do not share a top edge`,
    );
    assert.ok(
      heights.caption.left >= heights.caption.panelLeft - 1 &&
        heights.caption.right <= heights.caption.panelRight + 1,
      `${label}: company caption overflows its panel: ${JSON.stringify(heights.caption)}`,
    );
  }
  const team = page
    .locator(".team-row")
    .filter({ hasText: fixture.longUsername });
  if (await team.count()) {
    const controls = await team.evaluate((el) => {
      const name = el.querySelector("strong"),
        button = el.querySelector("button");
      if (!button) return { missing: true };
      const a = name.getBoundingClientRect(),
        b = button.getBoundingClientRect();
      return {
        missing: false,
        name: name.textContent,
        buttonVisible: b.width > 0 && b.height > 0,
        nameOverflow: name.scrollWidth > name.clientWidth + 1,
        overlap:
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1,
      };
    });
    assert.equal(
      controls.missing,
      false,
      `${label}: active long staff username has a removal control`,
    );
    assert.equal(controls.name.length, 40);
    assert.equal(
      controls.buttonVisible,
      true,
      `${label}: staff removal control visible`,
    );
    assert.equal(
      controls.nameOverflow,
      false,
      `${label}: staff username is clipped`,
    );
    assert.equal(
      controls.overlap,
      false,
      `${label}: staff name overlaps removal control`,
    );
  }
  reviewed.push(label);
}
async function nav(key) {
  const mobile = page.viewportSize().width <= 700;
  if (mobile && key === "settings")
    await page.locator(".mobile-settings:visible").click();
  else
    await page
      .locator(mobile ? ".mobile-nav-items" : ".nav-items")
      .getByRole("button", { name: t(key), exact: true })
      .click();
  const heading =
    key === "dashboard"
      ? t("fleetOverview")
      : key === "logbook"
        ? t("dailyLog")
        : t(key);
  await page
    .getByRole("heading", { name: heading, exact: true })
    .first()
    .waitFor();
  if (key === "settings")
    await page
      .locator(".team-row")
      .filter({ hasText: fixture.longUsername })
      .waitFor();
}
async function setLocale(next) {
  if (locale !== next) {
    await page.locator(".language-switch:visible").first().click();
    await page.waitForFunction(
      (lang) => document.documentElement.lang === lang,
      next,
    );
    locale = next;
  }
}
async function closeDialog() {
  const dialog = page.locator("dialog[open]");
  await dialog.locator(".dialog-header button").click();
  await page.locator("dialog").waitFor({ state: "detached" });
}
async function checkDialog(label, tyreCase) {
  const dialog = page.locator("dialog[open]");
  await dialog.waitFor();
  await checkLayout(label);
  const dimensions = await dialog.evaluate((el) => ({
    width: el.clientWidth,
    scrollWidth: el.scrollWidth,
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.width + 1,
    `${label}: dialog horizontal overflow`,
  );
  if (tyreCase) {
    const summary = dialog.locator(".tyre-detail-summary");
    await summary.waitFor();
    const name = summary.locator(".manufacturer-mark > span:last-child");
    assert.equal((await name.textContent()).trim(), tyreCase.brand);
    const text = await name.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return {
        rects: [...range.getClientRects()].filter((r) => r.width > 0).length,
        fontSize: parseFloat(getComputedStyle(el).fontSize),
        height: el.getBoundingClientRect().height,
      };
    });
    assert.ok(text.fontSize >= 14, `${label}: brand name is too small`);
    if (!tyreCase.custom)
      assert.equal(
        text.rects,
        1,
        `${label}: standard brand splits across lines`,
      );
    const statusLabel =
      tyreCase.status === "stock"
        ? "garage"
        : tyreCase.status === "installed"
          ? "onRoad"
          : tyreCase.status;
    assert.deepEqual(
      await dialog.locator(".tyre-detail-tags > *").allTextContents(),
      [
        t(statusLabel),
        t(tyreCase.type),
        t(`construction_${tyreCase.construction}`),
      ],
      `${label}: location, condition and construction stay in distinct labelled tags`,
    );
    const metrics = await dialog
      .locator(".tyre-summary-stats > div")
      .evaluateAll((cells) =>
        cells.map((cell) => {
          const value = cell.querySelector("strong"),
            rect = value.getBoundingClientRect(),
            parent = cell.getBoundingClientRect();
          return {
            text: value.textContent,
            number: Number(value.textContent.replace(/[^0-9]/g, "")),
            width: value.clientWidth,
            scrollWidth: value.scrollWidth,
            left: rect.left,
            right: rect.right,
            parentLeft: parent.left,
            parentRight: parent.right,
            font: parseFloat(getComputedStyle(value).fontSize),
          };
        }),
      );
    assert.equal(
      metrics.length,
      2,
      `${label}: recorded distance and remold cycles remain distinct`,
    );
    assert.equal(
      metrics[0].number,
      tyreCase.distance,
      `${label}: recorded distance is visible in full`,
    );
    assert.equal(
      metrics[1].number,
      tyreCase.remolds,
      `${label}: remold cycles are visible in full`,
    );
    for (const metric of metrics) {
      assert.ok(
        metric.scrollWidth <= metric.width + 1,
        `${label}: metric text clips horizontally: ${JSON.stringify(metric)}`,
      );
      assert.ok(
        metric.left >= metric.parentLeft - 1 &&
          metric.right <= metric.parentRight + 1,
        `${label}: metric spills into its sibling`,
      );
      assert.ok(metric.font >= 18, `${label}: metric too small`);
    }
    const overlap = await dialog.locator(".tyre-detail-tags").evaluate((el) => {
      const children = [...el.children].map((c) => c.getBoundingClientRect());
      return children.some((a, i) =>
        children
          .slice(i + 1)
          .some(
            (b) =>
              Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1,
          ),
      );
    });
    assert.equal(
      overlap,
      false,
      `${label}: condition/construction/status tags overlap`,
    );
  }
  if (await dialog.locator(".dialog-footer").count()) {
    const footer = await dialog.locator(".dialog-footer").boundingBox();
    assert.ok(
      footer.y >= 0 &&
        footer.y + footer.height <= page.viewportSize().height + 1,
      `${label}: fixed footer leaves viewport`,
    );
    for (const button of await dialog.locator(".dialog-footer button").all())
      assert.ok(
        (await button.boundingBox()).height >= 40,
        `${label}: footer control too small`,
      );
  } else if (await dialog.locator(".form-actions").count()) {
    await dialog.locator(".form-actions").scrollIntoViewIfNeeded();
    const box = await dialog.locator(".form-actions").boundingBox();
    assert.ok(
      box.y + box.height <= page.viewportSize().height + 1,
      `${label}: form controls cannot scroll into view`,
    );
  }
}
async function openTyre(item) {
  await nav("inventory");
  const tab = { stock: 1, installed: 2, remolding: 3, scrapped: 4, sold: 5 }[
    item.status
  ];
  await page.locator(".inventory-card .tabs button").nth(tab).click();
  await page.locator(".inventory-toolbar input").first().fill(item.serial);
  await page.locator(".tyre-row").filter({ hasText: item.serial }).click();
  await checkDialog(
    `${locale} tyre ${item.brand}/${item.type}/${item.construction}/${item.status}`,
    item,
  );
}
async function vehicleDetail() {
  await nav("vehicles");
  await page
    .locator(".vehicle-card")
    .filter({ hasText: fixture.primary })
    .click();
  await page
    .getByRole("heading", { name: fixture.primary, exact: true })
    .waitFor();
}
async function checkMap(label) {
  const serials = page.locator(".wheel .tyre-serial");
  assert.equal(
    await serials.count(),
    19,
    `${label}: every occupied position has a full serial`,
  );
  const results = await serials.evaluateAll((elements) =>
    elements.map((el) => {
      const css = getComputedStyle(el),
        rect = el.getBoundingClientRect(),
        range = document.createRange();
      range.selectNodeContents(el);
      return {
        text: el.textContent,
        font: parseFloat(css.fontSize),
        whiteSpace: css.whiteSpace,
        overflow: el.scrollWidth > el.clientWidth + 1,
        lines: [...range.getClientRects()].filter((r) => r.width > 0).length,
        height: rect.height,
      };
    }),
  );
  for (const serial of results) {
    assert.match(
      serial.text,
      /^[A-Z0-9]{11,13}$/,
      `${label}: missing/truncated serial`,
    );
    assert.ok(serial.font >= 11, `${label}: ${serial.text} smaller than 11px`);
    assert.equal(
      serial.whiteSpace,
      "nowrap",
      `${label}: ${serial.text} can wrap`,
    );
    assert.equal(serial.overflow, false, `${label}: ${serial.text} is clipped`);
    assert.equal(serial.lines, 1, `${label}: ${serial.text} is not one line`);
  }
}
async function main() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (i === 79) throw Error("Layout server did not start: " + serverOutput);
  }
  translations = await import("../src/i18n.js");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_PATH
      ? { executablePath: process.env.BROWSER_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  page = await context.newPage();
  page.on("pageerror", (e) => runtimeErrors.push(e.message));
  await page.goto(base);
  await page.locator("input[name=username]").fill("layout_admin");
  await page.locator("input[name=password]").fill("layout-test-password");
  await page
    .getByRole("button", { name: "Open my garage", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your fleet, at a glance", exact: true })
    .waitFor();
  for (const language of ["en", "hi"]) {
    await setLocale(language);
    for (const width of [320, 360, 390, 430, 700, 701, 960, 1200, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [
        "dashboard",
        "vehicles",
        "inventory",
        "reports",
        "logbook",
        "settings",
      ]) {
        await nav(route);
        await checkLayout(`${language}/${width}/${route}`);
        if (
          (width === 390 && ["inventory", "settings"].includes(route)) ||
          (width === 1440 && route === "dashboard")
        )
          await page.screenshot({
            path: path.join(artifacts, `${route}-${language}-${width}.png`),
            fullPage: false,
          });
      }
      await vehicleDetail();
      await checkLayout(`${language}/${width}/vehicle`);
      await checkMap(`${language}/${width}/map`);
      if (width === 320) {
        const activity = page
          .locator(".activity-row")
          .filter({ hasText: "Bridgestone" })
          .first();
        if (await activity.count()) {
          await activity.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: path.join(artifacts, `history-${language}-320.png`),
          });
          await page.evaluate(() => window.scrollTo(0, 0));
        }
      }
      if (width === 390)
        await page.screenshot({
          path: path.join(artifacts, `vehicle-${language}-390.png`),
          fullPage: false,
        });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const item of fixture.cases) {
      await openTyre(item);
      if (
        item.brand === "MRF" &&
        item.type === "remold" &&
        item.construction === "radial"
      )
        await page.screenshot({
          path: path.join(
            artifacts,
            `tyre-detail-${language}-${item.status}.png`,
          ),
        });
      await closeDialog();
    }
    await nav("dashboard");
    await page
      .getByRole("button", { name: t("addVehicle"), exact: true })
      .click();
    await page
      .locator("dialog input[name=registration]")
      .fill("MH46-LAYOUT-1234");
    await page
      .locator("dialog input[name=name]")
      .fill("Long vehicle route name — a readability and wrapping fixture");
    await page
      .locator("dialog input[name=driverName]")
      .fill("Ramesh Kumar Sharma / रमेश कुमार शर्मा");
    await checkDialog(`${language}/add vehicle form`);
    await closeDialog();
    await nav("dashboard");
    await page.getByRole("button", { name: t("addTyre"), exact: true }).click();
    await page.locator("dialog select[name=brand]").selectOption("other");
    await page
      .locator("dialog input[name=customBrand]")
      .fill("North India Commercial Tyres and Retreading Works");
    await checkDialog(`${language}/custom tyre form`);
    await closeDialog();
    await vehicleDetail();
    await page
      .getByRole("button", { name: t("inspectVehicle"), exact: true })
      .click();
    for (let i = 0; i < 3; i++)
      await page
        .getByRole("button", { name: t("addFinding"), exact: true })
        .click();
    await page
      .locator("dialog .inspection-finding input")
      .first()
      .fill(
        "A long workshop observation that needs to remain within its individual issue row.",
      );
    await checkDialog(
      `${language}/inspection form with three issues and 19 NSD rows`,
    );
    await closeDialog();
    await vehicleDetail();
    await page
      .getByRole("button", { name: t("vehicleSold"), exact: true })
      .click();
    assert.equal(await page.locator("dialog .sale-tyre-list li").count(), 19);
    await page
      .locator("dialog textarea[name=note]")
      .fill("Buyer invoice and long optional vehicle-sale notes. ".repeat(7));
    await checkDialog(`${language}/vehicle sale review with 19 tyres`);
    await page.screenshot({
      path: path.join(artifacts, `vehicle-sale-${language}-390.png`),
    });
    await closeDialog();
    await nav("vehicles");
    await page
      .getByRole("button", { name: new RegExp(t("soldVehicles")) })
      .click();
    await page
      .locator(".vehicle-card")
      .filter({ hasText: fixture.soldReg })
      .click();
    await checkLayout(`${language}/sold vehicle history`);
  }
  assert.deepEqual(runtimeErrors, []);
  writeFileSync(
    path.join(artifacts, "coverage.json"),
    JSON.stringify(
      {
        screens: reviewed.length,
        detailCombinations: fixture.cases.length,
        languages: ["en", "hi"],
        widths: [320, 360, 390, 430, 700, 701, 960, 1200, 1440],
        screenshots: artifacts,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${reviewed.length} screen/form checks, ${fixture.cases.length} tyre combinations in each language, 11–13 character map IDs, matching branding heights and no document/card overlap at nine widths`,
  );
}
main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    if (page)
      await page
        .screenshot({
          path: path.join(artifacts, "failure.png"),
          fullPage: false,
        })
        .catch(() => {});
  })
  .finally(async () => {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    if (server.exitCode === null)
      await new Promise((resolve) => server.once("exit", resolve));
    rmSync(temp, { recursive: true, force: true });
  });
