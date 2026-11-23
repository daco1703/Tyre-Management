const { chromium, webkit } = require("playwright");
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

// Every account, password, vehicle and tyre in this suite is a disposable local
// fixture. Never inherit an external database or contact the live company API.
const root = path.resolve(__dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "shepards-ios-ui-"));
const database = path.join(temp, "ios.sqlite");
const fixturePath = path.join(temp, "fixture.json");
const port = process.env.IOS_TEST_PORT || "3145";
const base = `http://127.0.0.1:${port}`;
const artifacts = path.join(root, "artifacts/ios-review");
mkdirSync(artifacts, { recursive: true });
const fixtureEnvironment = {
  ...process.env,
  DATABASE_PATH: database,
  DATABASE_URL: "",
  POSTGRES_URL: "",
  VERCEL: "0",
  PUBLIC_ORIGIN: "",
  TRUST_PROXY: "0",
};
const username = "ios_test_admin",
  password = "ios-public-test-password";
const seeded = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
  import { createApp } from './server/app.js';
  import { applyAction, emptyState, numberedSlots, dayKey } from './shared/model.js';
  import { manufacturers } from './shared/catalogue.js';
  import { scryptSync } from 'node:crypto';
  import { writeFileSync } from 'node:fs';
  const { db } = createApp({ dbPath: process.env.DATABASE_PATH });
  db.prepare("UPDATE users SET username=?,salt=?,hash=? WHERE role='owner'")
    .run('ios_test_admin','ios-fixture-only-salt',scryptSync('ios-public-test-password','ios-fixture-only-salt',64).toString('hex'));
  const longUsername = 'ios_staff_member_'.padEnd(40,'x');
  db.prepare("INSERT INTO users (username,salt,hash,role,active) VALUES (?,?,?,?,?)")
    .run(longUsername,'ios-staff-fixture-salt',scryptSync('ios-public-staff-password','ios-staff-fixture-salt',64).toString('hex'),'staff',1);
  let state = emptyState(); const now = new Date();
  const run = (kind,payload) => state = applyAction(state,{kind,payload},'ios_fixture_operator',now);
  run('addVehicle',{registration:'MH46AF7655',name:'Mumbai — Pune commercial trailer route',driverName:'Ramesh Kumar Singh / रमेश कुमार सिंह',emissionClass:'BS6',hasSpare:true,odometer:125000});
  const vehicleId = state.vehicles[0].id;
  run('addVehicle',{registration:'MH46AF1234',name:'Vehicle without spare tyre',driverName:'Shyam Singh',emissionClass:'BS4',hasSpare:false,odometer:5000});
  const serials = [];
  for (const [i,slot] of [...numberedSlots,'SP'].entries()) {
    const serial = i===0 ? '3E56665445677' : i===1 ? '3E134556677' : i===2 ? 'WWWWWWWWWWWWWWWW0001' : 'SHP'+String(20261120000000000n+BigInt(i));
    serials.push(serial);
    run('addTyre',{serial,brand:manufacturers[i%7].name,type:['new','used','remold'][i%3],construction:i%2?'horse':'radial',distance:i%3?32500:0});
    run('fit',{tyreId:state.tyres.at(-1).id,vehicleId,slot,odometer:125000});
  }
  run('changeDriver',{vehicleId,driverName:'Mukesh Sharma / मुकेश शर्मा'});
  run('inspectVehicle',{vehicleId,inspectedOn:dayKey(now),allTyresChecked:false,note:'Workshop observation for the bilingual inspection history.',findings:[{slot:'FR',issue:'misalignment',detail:'Alignment check advised before the next commercial route.'}],nsdMeasurements:[{tyreId:state.tyres[0].id,slot:state.tyres[0].slot,averagePercent:55.5}]});
  for (const [i,make] of manufacturers.entries()) {
    run('addTyre',{serial:'STOCK20261120'+String(i).padStart(3,'0'),brand:make.name,type:['new','used','remold'][i%3],construction:i%2?'horse':'radial',distance:i%3?45000:0});
  }
  run('addTyre',{serial:'CUSTOM20261120001',brand:'North India Commercial Tyres and Retreading Workshop',type:'remold',construction:'horse',distance:76543});
  run('addTyre',{serial:'REMOLD20261120001',brand:'Bridgestone',type:'used',construction:'radial',distance:65000});
  run('sendRemold',{tyreId:state.tyres.at(-1).id,vendor:'other',customVendor:'Regional Retreading Workshop and Commercial Tyre Service Centre'});
  run('addTyre',{serial:'SCRAP202611200001',brand:'Goodyear',type:'used',construction:'horse',distance:45000});
  run('scrap',{tyreId:state.tyres.at(-1).id,scrapReason:'other',scrapDetail:'Casing damage noted during the garage inspection.'});
  run('addTyre',{serial:'SOLD2026112000001',brand:'Michelin',type:'used',construction:'radial',distance:50000});
  run('sell',{tyreId:state.tyres.at(-1).id,note:'Public fixture sale invoice reference.'});
  db.prepare("UPDATE settings SET value=? WHERE key='state'").run(JSON.stringify(state));
  writeFileSync(process.env.IOS_FIXTURE,JSON.stringify({primary:'MH46AF7655',longUsername,serials,detailSerial:serials[2]}));
  db.close();
`,
  ],
  {
    cwd: root,
    env: { ...fixtureEnvironment, IOS_FIXTURE: fixturePath },
    encoding: "utf8",
  },
);
assert.equal(seeded.status, 0, seeded.stderr);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: root,
  env: { ...fixtureEnvironment, NODE_ENV: "production", PORT: port },
  stdio: "pipe",
});
let serverOutput = "",
  browser,
  page,
  engine;
server.stdout.on("data", (data) => {
  serverOutput += data;
});
server.stderr.on("data", (data) => {
  serverOutput += data;
});
const runtimeErrors = [],
  checks = [],
  safeAreas = [],
  palettes = {};
let translations,
  locale = "en";
const t = (key) => translations[locale][key] || translations.en[key] || key;
const iphoneUa =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";
const ipadUa =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";

async function openContext({
  userAgent = iphoneUa,
  platform = "iPhone",
  maxTouchPoints = 5,
  standalone = false,
  viewport = { width: 390, height: 844 },
  colorScheme = "light",
  mobile = true,
  checkLogin = false,
} = {}) {
  const context = await browser.newContext({
    userAgent,
    viewport,
    hasTouch: mobile,
    isMobile: mobile,
    colorScheme,
    serviceWorkers: "block",
  });
  await context.addInitScript(
    ({ platform, maxTouchPoints, standalone }) => {
      Object.defineProperty(navigator, "platform", {
        configurable: true,
        get: () => platform,
      });
      Object.defineProperty(navigator, "maxTouchPoints", {
        configurable: true,
        get: () => maxTouchPoints,
      });
      Object.defineProperty(navigator, "standalone", {
        configurable: true,
        get: () => standalone,
      });
    },
    { platform, maxTouchPoints, standalone },
  );
  page = await context.newPage();
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto(base);
  await page.locator("input[name=username]").waitFor();
  if (checkLogin) {
    await checkLayout(`ios/${colorScheme}/login`);
    await screenshot(`login-ios-${colorScheme}`);
  }
  await page.locator("input[name=username]").fill(username);
  await page.locator("input[name=password]").fill(password);
  await page
    .getByRole("button", { name: translations.en.submitLogin, exact: true })
    .click();
  await page
    .getByRole("heading", { name: translations.en.fleetOverview, exact: true })
    .waitFor();
  locale = "en";
  return context;
}
async function nav(key) {
  const mobile = await page.locator(".mobile-nav-items").isVisible();
  if (mobile && key === "settings")
    await page.locator(".mobile-settings:visible").click();
  else
    await page
      .locator(mobile ? ".mobile-nav-items" : ".sidebar .nav-items")
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
async function language(next) {
  if (locale === next) return;
  await page.locator(".language-switch:visible").first().click();
  await page.waitForFunction(
    (lang) => document.documentElement.lang === lang,
    next,
  );
  locale = next;
}
async function screenshot(name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(artifacts, `${name}.png`),
    fullPage: false,
  });
}

async function checkLayout(label, { ios = true } = {}) {
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => {
    const visible = (el) =>
      el.getClientRects().length &&
      getComputedStyle(el).visibility !== "hidden";
    const dialog = document.querySelector("dialog[open]");
    const scope = dialog || document;
    const overlap = [];
    for (const selector of [
      ".heading-actions > button",
      ".vehicle-grid > .vehicle-card",
      ".tyre-list > .tyre-row",
      ".stats-grid > .stat-card",
      ".tyre-detail-tags > *",
      ".tyre-summary-stats > div",
      ".inspection-finding > .field",
    ]) {
      const boxes = [...scope.querySelectorAll(selector)]
        .filter(visible)
        .map((el) => ({
          text: el.textContent.slice(0, 40),
          r: el.getBoundingClientRect(),
        }));
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i],
            b = boxes[j];
          if (
            Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left) > 1 &&
            Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) > 1
          )
            overlap.push({ selector, a: a.text, b: b.text });
        }
    }
    const taps = [
      ...scope.querySelectorAll(
        "button:not(:disabled), a[href], select:not(:disabled), textarea:not(:disabled), input:not(:disabled):not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), label.checkbox-field, label.import-file",
      ),
    ]
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          class: el.className,
          text: (
            el.getAttribute("aria-label") ||
            el.textContent ||
            el.getAttribute("name") ||
            ""
          ).slice(0, 60),
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((el) => el.width < 43.5 || el.height < 43.5);
    const smallInputs = [
      ...scope.querySelectorAll(
        "input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), select, textarea",
      ),
    ]
      .filter(visible)
      .map((el) => ({
        name: el.name || el.getAttribute("aria-label"),
        font: parseFloat(getComputedStyle(el).fontSize),
      }))
      .filter((el) => el.font < 16);
    const brand = [...document.querySelectorAll(".brand")].find(visible);
    let branding;
    if (brand) {
      const logo = brand.querySelector(".company-logo"),
        wordmark = brand.querySelector(".company-wordmark"),
        a = logo.getBoundingClientRect(),
        b = wordmark.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(wordmark.querySelector("small"));
      const caption = range.getBoundingClientRect();
      branding = {
        logo: a.height,
        wordmark: b.height,
        top: Math.abs(a.top - b.top),
        captionFits: caption.left >= b.left - 1 && caption.right <= b.right + 1,
        loaded:
          logo.complete &&
          logo.naturalWidth > 0 &&
          wordmark.querySelector("img").naturalWidth > 0,
      };
    }
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;pointer-events:none;visibility:hidden;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)";
    document.body.append(probe);
    const safe = {
      top: parseFloat(getComputedStyle(probe).paddingTop),
      bottom: parseFloat(getComputedStyle(probe).paddingBottom),
    };
    probe.remove();
    return {
      ui: document.documentElement.dataset.ui,
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overlap,
      taps,
      smallInputs,
      branding,
      safe,
      dialogOverflow: dialog
        ? dialog.scrollWidth > dialog.clientWidth + 1
        : false,
    };
  });
  if (ios)
    assert.equal(
      result.ui,
      "ios",
      `${label}: iOS appearance was not selected automatically`,
    );
  else
    assert.notEqual(
      result.ui,
      "ios",
      `${label}: iOS styles leaked to another platform`,
    );
  assert.ok(
    result.scrollWidth <= result.width + 1,
    `${label}: document overflow ${result.scrollWidth}/${result.width}`,
  );
  assert.deepEqual(
    result.overlap,
    [],
    `${label}: independent cards or controls overlap`,
  );
  assert.equal(
    result.dialogOverflow,
    false,
    `${label}: modal overflows horizontally`,
  );
  if (ios) {
    assert.deepEqual(
      result.taps,
      [],
      `${label}: effective touch targets smaller than 44×44`,
    );
    assert.deepEqual(
      result.smallInputs,
      [],
      `${label}: input text below 16px risks iOS focus zoom`,
    );
  }
  if (result.branding) {
    assert.ok(
      Math.abs(result.branding.logo - result.branding.wordmark) <= 1 &&
        result.branding.top <= 1,
      `${label}: branding panels have unequal heights`,
    );
    assert.equal(
      result.branding.captionFits,
      true,
      `${label}: branding caption clips`,
    );
    assert.equal(
      result.branding.loaded,
      true,
      `${label}: company branding is not loaded`,
    );
  }
  safeAreas.push(result.safe);
  checks.push(label);
}

async function checkNavigation(label) {
  const navBar = page.locator(".bottom-nav");
  if (!(await navBar.isVisible())) return;
  const data = await navBar.evaluate((el) => {
    const bounds = el.getBoundingClientRect(),
      style = getComputedStyle(el);
    const buttons = [...el.querySelectorAll("button")].map((button) => {
      const r = button.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    });
    return {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      height: bounds.height,
      paddingBottom: parseFloat(style.paddingBottom),
      padding: parseFloat(
        getComputedStyle(document.querySelector(".main-shell")).paddingBottom,
      ),
      buttons,
      viewport: window.innerHeight,
    };
  });
  assert.equal(
    data.buttons.length,
    5,
    `${label}: all five tabs remain present`,
  );
  assert.ok(
    data.left >= -1 &&
      data.right <= page.viewportSize().width + 1 &&
      data.bottom <= data.viewport + 1,
    `${label}: tab bar leaves the viewport`,
  );
  assert.ok(
    data.padding >= data.height,
    `${label}: page does not reserve tab bar clearance`,
  );
  for (const button of data.buttons) {
    assert.ok(
      button.width >= 43.5 && button.height >= 43.5,
      `${label}: tab target smaller than 44px`,
    );
    assert.ok(
      button.bottom <= data.bottom - data.paddingBottom + 1,
      `${label}: tab target enters bottom safe padding`,
    );
  }
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  const clearance = await page.evaluate(() => {
    const footer = document.querySelector(".page-footer"),
      main = document.querySelector("main");
    const last = footer?.getClientRects().length
      ? footer
      : main.lastElementChild;
    return {
      contentBottom: last.getBoundingClientRect().bottom,
      navTop: document.querySelector(".bottom-nav").getBoundingClientRect().top,
    };
  });
  assert.ok(
    clearance.contentBottom <= clearance.navTop + 1,
    `${label}: final page content is covered by the tab bar: ${JSON.stringify(clearance)}`,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
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
  const serials = await page
    .locator(".wheel .tyre-serial")
    .evaluateAll((elements) =>
      elements.map((el) => {
        const css = getComputedStyle(el),
          range = document.createRange();
        range.selectNodeContents(el);
        return {
          text: el.textContent,
          font: parseFloat(css.fontSize),
          nowrap: css.whiteSpace,
          overflow: el.scrollWidth > el.clientWidth + 1,
          lines: [...range.getClientRects()].filter((r) => r.width > 0).length,
        };
      }),
    );
  assert.equal(
    serials.length,
    19,
    `${label}: full road positions and spare remain visible`,
  );
  assert.deepEqual(
    serials.map((el) => el.text).sort(),
    [...fixture.serials].sort(),
  );
  for (const serial of serials) {
    assert.match(serial.text, /^[A-Z0-9]{11,20}$/);
    assert.ok(serial.font >= 11, `${label}: map serial below 11px`);
    assert.equal(serial.nowrap, "nowrap", `${label}: serial may wrap`);
    assert.equal(serial.lines, 1, `${label}: serial wraps`);
    assert.equal(
      serial.overflow,
      false,
      `${label}: full serial clips: ${serial.text}`,
    );
  }
  const panning = await page.locator(".tyre-map-scroll").evaluate((el) => {
    el.scrollLeft = 0;
    const start = el.scrollLeft;
    el.scrollLeft = el.scrollWidth;
    const end = el.scrollLeft;
    el.scrollLeft = 0;
    return {
      start,
      end,
      width: el.clientWidth,
      total: el.scrollWidth,
      overflow: getComputedStyle(el).overflowX,
    };
  });
  if (panning.total > panning.width + 1) {
    assert.ok(
      ["auto", "scroll"].includes(panning.overflow),
      `${label}: wide map cannot pan`,
    );
    assert.ok(
      panning.end > panning.start,
      `${label}: map cannot reach right-hand positions`,
    );
  }
}
async function closeDialog() {
  await page.locator("dialog[open] .dialog-header button").click();
  await page.locator("dialog").waitFor({ state: "detached" });
}
async function checkDialog(label) {
  const dialog = page.locator("dialog[open]");
  await dialog.waitFor();
  await checkLayout(label);
  const header = await dialog.locator(".dialog-header").boundingBox();
  assert.ok(
    header.y >= -1,
    `${label}: dialog title/close control leaves viewport`,
  );
  const body = dialog.locator(".dialog-body");
  await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const finalField = dialog.locator("textarea").last();
  if (await finalField.count()) {
    await finalField.scrollIntoViewIfNeeded();
    const field = await finalField.boundingBox(),
      viewport = page.viewportSize();
    assert.ok(
      field.y >= header.y + header.height - 1 &&
        field.y + field.height <= viewport.height + 1,
      `${label}: final input cannot scroll fully into view`,
    );
  }
  const actions = dialog.locator(".dialog-footer, .form-actions").last();
  if (await actions.count()) {
    await actions.scrollIntoViewIfNeeded();
    const box = await actions.boundingBox();
    assert.ok(
      box.y >= header.y + header.height - 1 &&
        box.y + box.height <= page.viewportSize().height + 1,
      `${label}: form actions are not reachable`,
    );
  }
  await body.evaluate((el) => {
    el.scrollTop = 0;
  });
}
async function tyreDetails(label) {
  await page
    .locator(".wheel")
    .filter({ hasText: fixture.detailSerial })
    .click();
  await checkDialog(`${label}/tyre detail`);
  const brand = page.locator("dialog .tyre-detail-summary .manufacturer-name");
  assert.equal((await brand.textContent()).trim(), "CEAT");
  const lines = await brand.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return [...r.getClientRects()].filter((rect) => rect.width > 0).length;
  });
  assert.equal(lines, 1, `${label}: brand name breaks into individual letters`);
  await screenshot(`detail-${label.replaceAll("/", "-")}`);
  await closeDialog();
}
async function inspection(label, save = false) {
  await page
    .getByRole("button", { name: t("inspectVehicle"), exact: true })
    .click();
  await page
    .getByRole("button", { name: t("addFinding"), exact: true })
    .click();
  await page
    .locator("dialog .inspection-finding select")
    .nth(0)
    .selectOption("FR");
  await page
    .locator("dialog .inspection-finding select")
    .nth(1)
    .selectOption("misalignment");
  await page
    .locator("dialog .inspection-finding input")
    .fill("Workshop alignment observation / कार्यशाला निरीक्षण");
  assert.equal(await page.locator("dialog .inspection-nsd-row").count(), 19);
  await page.locator("dialog .inspection-nsd-row input").first().fill("67.5");
  await page
    .locator("dialog textarea[name=note]")
    .fill("Public iOS layout fixture inspection note. ".repeat(5));
  await checkDialog(`${label}/inspection`);
  await screenshot(`inspection-${label.replaceAll("/", "-")}`);
  if (save) {
    await page.locator("dialog .checkbox-field input").check();
    await page.getByRole("button", { name: t("save"), exact: true }).click();
    await page.locator("dialog").waitFor({ state: "detached" });
    const state = await page.evaluate(() =>
      fetch("/api/state").then((response) => response.json()),
    );
    const event = state.events.at(-1);
    assert.equal(event.kind, "inspectVehicle");
    assert.equal(event.actor, username);
    assert.equal(event.nsdMeasurements[0].averagePercent, 67.5);
    assert.equal(event.inspectedTyres.length, 19);
  } else await closeDialog();
}
async function staffLayout(label) {
  const row = page
    .locator(".team-row")
    .filter({ hasText: fixture.longUsername });
  const result = await row.evaluate((el) => {
    const name = el.querySelector("strong"),
      button = el.querySelector("button"),
      a = name.getBoundingClientRect(),
      b = button.getBoundingClientRect();
    return {
      clipped: name.scrollWidth > name.clientWidth + 1,
      overlap:
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1,
      width: b.width,
      height: b.height,
    };
  });
  assert.equal(result.clipped, false, `${label}: long staff username clips`);
  assert.equal(
    result.overlap,
    false,
    `${label}: staff username covers removal control`,
  );
  assert.ok(
    result.width >= 43.5 && result.height >= 43.5,
    `${label}: staff removal touch target is too small`,
  );
}

async function matrix(kind, context, sizes) {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const lang of ["en", "hi"]) {
      await language(lang);
      for (const viewport of sizes) {
        await page.setViewportSize(viewport);
        const label = `${kind}/${scheme}/${lang}/${viewport.width}x${viewport.height}`;
        for (const screen of ["dashboard", "inventory", "settings"]) {
          await nav(screen);
          await checkLayout(`${label}/${screen}`);
          await checkNavigation(`${label}/${screen}`);
          if (screen === "settings") await staffLayout(label);
          if (
            kind === "iphone" &&
            viewport.width === 390 &&
            lang === "en" &&
            screen !== "inventory"
          )
            await screenshot(`${screen}-${kind}-${scheme}-390`);
        }
        await vehicleDetail();
        await checkLayout(`${label}/vehicle`);
        await checkMap(label);
        await checkNavigation(`${label}/vehicle`);
        if (
          (kind === "iphone" && viewport.width === 390) ||
          (kind === "ipad" && viewport.width === 834 && lang === "hi")
        ) {
          await screenshot(
            `vehicle-${kind}-${scheme}-${lang}-${viewport.width}`,
          );
          await tyreDetails(label);
        }
        if (kind === "iphone" && viewport.width === 390)
          await inspection(label, scheme === "light" && lang === "en");
        if (lang === "en" && viewport.width === sizes[0].width)
          palettes[`${kind}-${scheme}`] = await page
            .locator(".card")
            .first()
            .evaluate((el) => ({
              body: getComputedStyle(document.body).backgroundColor,
              card: getComputedStyle(el).backgroundColor,
              text: getComputedStyle(el).color,
            }));
        console.log(`Checked ${label}`);
      }
    }
  }
  assert.notDeepEqual(
    palettes[`${kind}-light`],
    palettes[`${kind}-dark`],
    `${kind}: dark mode did not change the iOS palette`,
  );
  await context.close();
}

async function platformScope() {
  for (const platform of [
    {
      name: "android",
      platform: "Linux armv8l",
      maxTouchPoints: 5,
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      mobile: true,
      viewport: { width: 390, height: 844 },
    },
    {
      name: "desktop",
      platform: "MacIntel",
      maxTouchPoints: 0,
      userAgent: ipadUa,
      mobile: false,
      viewport: { width: 1440, height: 900 },
    },
  ]) {
    const context = await openContext(platform);
    await checkLayout(`${platform.name}/default scope`, { ios: false });
    await nav("inventory");
    await checkLayout(`${platform.name}/inventory scope`, { ios: false });
    await screenshot(`default-${platform.name}`);
    await context.close();
  }
  const standalone = await openContext({ standalone: true });
  await nav("settings");
  await checkLayout("ios/installed PWA");
  assert.equal(
    await page.locator('[data-testid="ios-install-help"]').count(),
    0,
    "installed iOS PWA should not offer installation again",
  );
  await standalone.close();
}

async function nativeReopen() {
  const canonical = "https://www.shepards-tyre-management.com";
  const context = await browser.newContext({
    userAgent: iphoneUa,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
  });
  await context.addInitScript((server) => {
    window.CapacitorCustomPlatform = { name: "ios" };
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "iPhone",
    });
    if (!sessionStorage.getItem("ios-native-fixture-seeded")) {
      sessionStorage.setItem("ios-native-fixture-seeded", "yes");
      localStorage.setItem("ts-server", JSON.stringify(server));
      localStorage.removeItem("ts-token");
      localStorage.setItem("ts-lang", JSON.stringify("en"));
    }
    window.iosNativeFetches = [];
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const headers = new Headers(args[1]?.headers);
      window.iosNativeFetches.push({
        url: String(args[0]),
        credentials: args[1]?.credentials,
        authorization: headers.get("Authorization"),
      });
      return originalFetch.apply(this, args);
    };
  }, canonical);
  const unexpected = [];
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
    try {
      const response = await context.request.fetch(
        `${base}${url.pathname}${url.search}`,
        {
          method: request.method(),
          headers: {
            "content-type": "application/json",
            origin: "capacitor://localhost",
            cookie: "",
            ...(request.headers().authorization
              ? { authorization: request.headers().authorization }
              : {}),
          },
          ...(request.postData() ? { data: request.postData() } : {}),
        },
      );
      assert.equal(
        response.headers()["access-control-allow-origin"],
        "capacitor://localhost",
      );
      await route.fulfill({
        response,
        headers: { ...response.headers(), ...cors },
      });
    } catch (error) {
      // Closing/reopening the emulated app legitimately cancels long polls.
      await route.abort().catch(() => {});
    }
  });
  page = await context.newPage();
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
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
  const token = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ts-token")),
  );
  assert.match(token, /^[a-f0-9]{64}$/, "native iOS persists its bearer token");
  await checkLayout("native ios/after login");
  await page.reload();
  await page
    .getByRole("heading", { name: t("fleetOverview"), exact: true })
    .waitFor();
  await checkLayout("native ios/reopen authenticated");
  const requests = await page.evaluate(() => window.iosNativeFetches);
  assert.ok(
    requests.some(
      (request) =>
        request.url.endsWith("/api/me") &&
        request.authorization === `Bearer ${token}`,
    ),
    "native iOS reopen authenticates with the saved token",
  );
  assert.ok(
    requests.some(
      (request) =>
        request.url.endsWith("/api/state") &&
        request.authorization === `Bearer ${token}`,
    ),
  );
  assert.ok(
    requests.every((request) => request.credentials === "omit"),
    "native iOS requests do not depend on website cookies",
  );
  assert.deepEqual(
    unexpected,
    [],
    "native iOS never contacts an unexpected backend",
  );
  await nav("settings");
  assert.equal(
    await page.locator('[data-testid="ios-install-help"]').count(),
    0,
    "native iOS has no website install prompt",
  );
  await screenshot("native-ios-reopen-390");
  await context.close();
}

async function nativeAuthentication() {
  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "capacitor://localhost",
    },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 200, "Capacitor iOS origin can sign in");
  assert.equal(
    login.headers.get("access-control-allow-origin"),
    "capacitor://localhost",
  );
  const data = await login.json();
  assert.match(
    data.token,
    /^[a-f0-9]{64}$/,
    "iOS login receives a bearer token",
  );
  const response = await fetch(`${base}/api/state`, {
    headers: {
      Origin: "capacitor://localhost",
      Authorization: `Bearer ${data.token}`,
    },
  });
  assert.equal(
    response.status,
    200,
    "iOS bearer token works without browser cookies",
  );
  const state = await response.json();
  assert.equal(
    state.vehicles.find((vehicle) => vehicle.registration === fixture.primary)
      .hasSpare,
    true,
  );
  checks.push("native ios/capacitor origin/bearer authentication");
}
async function installationGuide(lang) {
  await language(lang);
  await nav("settings");
  const dictionary = translations[lang];
  const expectedTitle =
    lang === "hi" ? "होम स्क्रीन पर जोड़ें" : "Add to Home Screen";
  const button = page.locator('[data-testid="ios-install-help"]');
  assert.equal(
    (await button.textContent()).trim(),
    expectedTitle,
    `${lang}: the visible install button uses the selected language`,
  );
  await button.click();
  assert.equal(
    await page.locator("dialog .dialog-header h2").textContent(),
    expectedTitle,
    `${lang}: the installation guide title uses the selected language`,
  );
  assert.deepEqual(
    await page.locator("dialog .ios-install-steps li").allTextContents(),
    [
      dictionary.iosInstallSafari,
      dictionary.iosInstallShare,
      dictionary.iosInstallAdd,
    ],
    `${lang}: every installation step uses the selected language`,
  );
  assert.deepEqual(
    await page.locator("dialog .dialog-body > p").allTextContents(),
    [dictionary.iosInstallIntro, dictionary.iosInstallData],
    `${lang}: guide introduction and shared-data explanation are translated`,
  );
  if (lang === "hi") {
    for (const text of await page
      .locator("dialog .dialog-body > p, dialog .ios-install-steps li")
      .allTextContents())
      assert.match(
        text,
        /[\u0900-\u097f]/u,
        "every visible Hindi instruction contains Hindi text",
      );
  }
  await checkDialog(`ios/${lang}/Safari installation guide`);
  await screenshot(`ios-install-guide-${lang}`);
  await closeDialog();
}
async function main() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 79)
      throw new Error(`iOS fixture server did not start: ${serverOutput}`);
  }
  translations = await import("../src/i18n.js");
  const preferWebkit =
    process.env.IOS_BROWSER_ENGINE !== "chromium" &&
    existsSync(webkit.executablePath());
  if (process.env.IOS_BROWSER_ENGINE === "webkit" && !preferWebkit)
    throw new Error(
      "Playwright WebKit is not installed; use the default Chromium iOS emulation or provision WebKit separately.",
    );
  engine = preferWebkit
    ? "Playwright WebKit"
    : "Chromium iOS device emulation (WebKit unavailable)";
  browser = await (preferWebkit ? webkit : chromium).launch({
    headless: true,
    ...(!preferWebkit
      ? {
          executablePath:
            process.env.BROWSER_PATH ||
            (existsSync(chromium.executablePath())
              ? chromium.executablePath()
              : "/usr/bin/chromium"),
          args: ["--no-sandbox"],
        }
      : {}),
  });
  console.log(`Browser engine: ${engine}`);
  const phone = await openContext({ checkLogin: true });
  assert.equal(
    await page
      .locator('meta[name="apple-mobile-web-app-capable"]')
      .getAttribute("content"),
    "yes",
  );
  assert.ok(await page.locator('link[rel="apple-touch-icon"]').count());
  assert.match(
    await page.locator('meta[name="viewport"]').getAttribute("content"),
    /viewport-fit=cover/,
  );
  const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.equal(manifest.display, "standalone");
  for (const lang of ["en", "hi"]) await installationGuide(lang);
  if (process.env.IOS_GUIDE_ONLY === "1") {
    await phone.close();
    assert.deepEqual(runtimeErrors, [], "no installation guide runtime errors");
    writeFileSync(
      path.join(artifacts, "guide-coverage.json"),
      JSON.stringify(
        {
          engine,
          checks,
          languages: ["en", "hi"],
          assertions:
            "Exact translated button/title, three steps, introduction and shared-data explanation; Hindi text in every instruction.",
        },
        null,
        2,
      ),
    );
    console.log(
      `PASS: ${checks.length} focused login/installation guide checks, exact English and Hindi content. ${engine}.`,
    );
    return;
  }
  await matrix("iphone", phone, [
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
  ]);
  const tablet = await openContext({
    userAgent: ipadUa,
    platform: "MacIntel",
    maxTouchPoints: 5,
    viewport: { width: 767, height: 1024 },
  });
  await matrix("ipad", tablet, [
    { width: 767, height: 1024 },
    { width: 834, height: 1194 },
  ]);
  await platformScope();
  await nativeReopen();
  await nativeAuthentication();
  assert.deepEqual(runtimeErrors, [], "no uncaught browser errors");
  writeFileSync(
    path.join(artifacts, "coverage.json"),
    JSON.stringify(
      {
        engine,
        screens: checks.length,
        checks,
        phoneWidths: [375, 390, 430, 844],
        ipadWidths: [767, 834],
        themes: ["light", "dark"],
        languages: ["en", "hi"],
        serialLengths: [
          ...new Set(fixture.serials.map((serial) => serial.length)),
        ],
        measuredSafeAreaInsets: [
          ...new Set(safeAreas.map((insets) => JSON.stringify(insets))),
        ].map((insets) => JSON.parse(insets)),
        hardwareLimitations:
          "Headless emulation does not verify an iPhone keyboard, nonzero hardware notch/home-indicator insets, WKWebView bridge or Xcode signing.",
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${checks.length} iOS screen/form/platform checks; light/dark English/Hindi, complete 11–20 character map IDs, 44px controls and 16px inputs. ${engine}.`,
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
