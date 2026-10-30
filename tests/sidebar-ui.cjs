const { chromium } = require("playwright");
const { spawn, spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

// Fixtures never read or mutate the deployed fleet database or real accounts.
const root = path.resolve(__dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "shepards-sidebar-"));
const database = path.join(temp, "sidebar.sqlite");
const port = process.env.SIDEBAR_TEST_PORT || "3140";
const base = `http://127.0.0.1:${port}`;
const artifacts = path.join(root, "artifacts/sidebar-review");
mkdirSync(artifacts, { recursive: true });
const accounts = [
  { username: "sidebar_admin", role: "owner" },
  { username: "staff_member_".padEnd(40, "x"), role: "staff" },
];
const password = "sidebar-test-password";
const seeded = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
      import { createApp } from './server/app.js';
      import { scryptSync } from 'node:crypto';
      const { db } = createApp({ dbPath: process.env.DATABASE_PATH });
      const salt = 'sidebar-test-only-salt';
      const hash = scryptSync('sidebar-test-password', salt, 64).toString('hex');
      db.prepare("UPDATE users SET username=?,salt=?,hash=? WHERE role='owner'").run('sidebar_admin', salt, hash);
      db.prepare("INSERT INTO users (username,salt,hash,role) VALUES (?,?,?,?)").run('staff_member_'.padEnd(40, 'x'), salt, hash, 'staff');
      db.close();
    `,
  ],
  {
    cwd: root,
    env: { ...process.env, DATABASE_PATH: database },
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
    DATABASE_PATH: database,
  },
  stdio: "pipe",
});
let logs = "",
  browser,
  page,
  checks = 0;
const errors = [];
server.stdout.on("data", (data) => (logs += data));
server.stderr.on("data", (data) => (logs += data));

async function painted() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

async function fullyVisible(control, label) {
  const result = await control.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const sidebar = el.closest(".sidebar").getBoundingClientRect();
    return {
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      sidebar,
      viewportHeight: innerHeight,
      focused: document.activeElement === el,
    };
  });
  assert.ok(result.focused, `${label}: keyboard focus did not reach control`);
  assert.ok(
    result.top >= Math.max(0, result.sidebar.top) - 1 &&
      result.bottom <=
        Math.min(result.viewportHeight, result.sidebar.bottom) + 1,
    `${label}: focused control is cut off: ${JSON.stringify(result)}`,
  );
  assert.ok(
    result.left >= result.sidebar.left - 1 &&
      result.right <= result.sidebar.right + 1,
    `${label}: control extends beyond sidebar`,
  );
}

async function desktop(viewport, label, settingsTitle) {
  await page.setViewportSize(viewport);
  await painted();
  const sidebar = page.locator(".sidebar");
  assert.ok(await sidebar.isVisible(), `${label}: missing desktop sidebar`);
  const metrics = await sidebar.evaluate((el) => {
    el.scrollTop = 0;
    window.scrollTo(0, 0);
    const box = el.getBoundingClientRect();
    return {
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      top: box.top,
      bottom: box.bottom,
      overflowY: getComputedStyle(el).overflowY,
      documentWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentY: window.scrollY,
      x: box.left + box.width / 2,
      y: Math.min(box.bottom - 10, box.top + 100),
      labels: [...el.querySelectorAll(".nav-items button")].map((button) => ({
        text: button.textContent,
        height: button.getBoundingClientRect().height,
        clipped:
          button.scrollWidth > button.clientWidth + 1 ||
          button.scrollHeight > button.clientHeight + 1,
      })),
      caption: (() => {
        const caption = el.querySelector(".company-wordmark small");
        const range = document.createRange();
        range.selectNodeContents(caption);
        const text = range.getBoundingClientRect();
        const panel = caption
          .closest(".company-wordmark")
          .getBoundingClientRect();
        return {
          left: text.left,
          right: text.right,
          panelLeft: panel.left,
          panelRight: panel.right,
        };
      })(),
    };
  });
  assert.ok(
    ["auto", "scroll"].includes(metrics.overflowY),
    `${label}: sidebar cannot scroll (${metrics.overflowY})`,
  );
  assert.equal(
    await sidebar.locator(".workspace-label").count(),
    0,
    `${label}: removed fleet workspace block is still rendered`,
  );
  assert.ok(
    metrics.top >= -1 && metrics.bottom <= viewport.height + 1,
    `${label}: sidebar extends beyond viewport`,
  );
  assert.ok(
    metrics.scrollWidth <= metrics.clientWidth + 1,
    `${label}: sidebar has horizontal overflow`,
  );
  assert.ok(
    metrics.documentScrollWidth <= metrics.documentWidth + 1,
    `${label}: document has horizontal overflow`,
  );
  assert.ok(
    metrics.caption.left >= metrics.caption.panelLeft - 1 &&
      metrics.caption.right <= metrics.caption.panelRight + 1,
    `${label}: company caption is clipped by its panel`,
  );
  assert.equal(metrics.labels.length, 6, `${label}: missing navigation item`);
  for (const item of metrics.labels) {
    assert.ok(item.height >= 40, `${label}: squashed menu item ${item.text}`);
    assert.ok(!item.clipped, `${label}: clipped menu item ${item.text}`);
  }

  // Real wheel events must move the sidebar, never the page behind it.
  await page.mouse.move(metrics.x, metrics.y);
  await page.mouse.wheel(0, 3000);
  if (metrics.scrollHeight > metrics.clientHeight + 1) {
    await page.waitForFunction(
      () => document.querySelector(".sidebar").scrollTop > 0,
    );
  }
  await page.waitForFunction(() => {
    const el = document.querySelector(".sidebar");
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  });
  assert.equal(
    await page.evaluate(() => window.scrollY),
    metrics.documentY,
    `${label}: sidebar wheel scroll moved the main page`,
  );
  const profile = sidebar.locator(".profile");
  const profileBox = await profile.boundingBox();
  assert.ok(
    profileBox.y >= 0 &&
      profileBox.y + profileBox.height <= viewport.height + 1,
    `${label}: profile remains inaccessible after scrolling to bottom`,
  );

  // Focusing the scroll area also permits native PageDown/End navigation.
  await sidebar.evaluate((el) => {
    el.scrollTop = 0;
  });
  await sidebar.focus();
  await page.keyboard.press("PageDown");
  if (metrics.scrollHeight > metrics.clientHeight + 1) {
    await page.waitForFunction(
      () => document.querySelector(".sidebar").scrollTop > 0,
    );
  }
  await page.keyboard.press("End");
  await page.waitForFunction(() => {
    const el = document.querySelector(".sidebar");
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  });

  // Tab naturally scrolls each nav item and the final profile into view.
  const buttons = sidebar.locator(".nav-items button");
  await buttons.first().focus();
  for (let i = 0; i < 7; i++) {
    await fullyVisible(i === 6 ? profile : buttons.nth(i), `${label}/tab-${i}`);
    if (i < 6) await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  await page
    .locator(".page-heading h1")
    .filter({ hasText: settingsTitle })
    .waitFor();
  checks++;
}

async function mobile(viewport, label, settingsTitle) {
  await page.setViewportSize(viewport);
  await painted();
  assert.ok(
    !(await page.locator(".sidebar").isVisible()),
    `${label}: sidebar covers mobile content`,
  );
  const buttons = page.locator(".bottom-nav .mobile-nav-items button");
  assert.equal(
    await buttons.count(),
    5,
    `${label}: mobile navigation missing items`,
  );
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    assert.ok(
      box && box.y >= 0 && box.y + box.height <= viewport.height + 1,
      `${label}: mobile navigation cut off`,
    );
  }
  await page.locator(".mobile-settings").click();
  await page
    .locator(".page-heading h1")
    .filter({ hasText: settingsTitle })
    .waitFor();
  assert.ok(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
    `${label}: mobile document overflow`,
  );
  checks++;
}

async function main() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (i === 79) throw Error(`Sidebar server did not start: ${logs}`);
  }
  const translations = await import("../src/i18n.js");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_PATH
      ? { executablePath: process.env.BROWSER_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  for (const account of accounts) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 768 },
      serviceWorkers: "block",
    });
    page = await context.newPage();
    page.setDefaultTimeout(6000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.locator("input[name=username]").fill(account.username);
    await page.locator("input[name=password]").fill(password);
    await page
      .getByRole("button", { name: "Open my garage", exact: true })
      .click();
    await page.locator(".app-shell").waitFor();
    for (const language of ["en", "hi"]) {
      if (
        (await page.evaluate(() => document.documentElement.lang)) !== language
      ) {
        await page.locator(".language-switch").click();
        await page.waitForFunction(
          (lang) => document.documentElement.lang === lang,
          language,
        );
      }
      const settingsTitle = translations[language].settings;
      for (const width of [701, 960, 1200, 1440]) {
        for (const height of [320, 480, 600, 768]) {
          await desktop(
            { width, height },
            `${account.role}/${language}/${width}x${height}`,
            settingsTitle,
          );
          if (account.role === "owner" && width === 1440 && height === 600) {
            await page.locator(".sidebar").evaluate((el) => {
              el.scrollTop = 0;
            });
            await page.screenshot({
              path: path.join(artifacts, `owner-${language}-1440x600.png`),
            });
          }
        }
      }
      await page.screenshot({
        path: path.join(artifacts, `${account.role}-${language}-sidebar.png`),
      });
      for (const viewport of [
        { width: 320, height: 480 },
        { width: 390, height: 640 },
        { width: 700, height: 480 },
      ]) {
        await mobile(
          viewport,
          `${account.role}/${language}/${viewport.width}x${viewport.height}`,
          settingsTitle,
        );
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, [], "Browser runtime errors");
  console.log(
    `PASS: ${checks} sidebar/mobile cases across two roles, English/Hindi, four desktop widths and four heights; wheel and keyboard reach all menu items/profile without scrolling the main page`,
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
