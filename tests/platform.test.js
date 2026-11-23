import test from "node:test";
import assert from "node:assert/strict";
import { detectPlatform, applyPlatformAppearance } from "../src/platform.js";
import { en, hi } from "../src/i18n.js";

const iphone = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
};
const ipad = {
  userAgent:
    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  platform: "iPad",
  maxTouchPoints: 5,
};
const desktopSafari = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  platform: "MacIntel",
  maxTouchPoints: 0,
};
const desktopModeIpad = { ...desktopSafari, maxTouchPoints: 5 };
const android = {
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  platform: "Linux armv8l",
  maxTouchPoints: 5,
};
const windows = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  platform: "Win32",
  maxTouchPoints: 10,
};

test("unknown browser defaults do not activate a device skin or installation help", () => {
  assert.deepEqual(detectPlatform(), {
    isIos: false,
    isNative: false,
    isAndroid: false,
    isStandalone: false,
    showInstallHelp: false,
  });
});

test("real Apple browser identities include iPad desktop mode without skinning ordinary desktops", async (t) => {
  for (const [name, input, isIos, isAndroid] of [
    ["iPhone Safari", iphone, true, false],
    ["iPad Safari", ipad, true, false],
    ["iPad desktop Safari", desktopModeIpad, true, false],
    ["Mac Safari without touch", desktopSafari, false, false],
    ["Windows touch computer", windows, false, false],
    ["Android Chrome", android, false, false],
    [
      "iPhone Chrome",
      {
        ...iphone,
        userAgent: iphone.userAgent.replace("Version/18.0", "CriOS/130.0.0.0"),
      },
      true,
      false,
    ],
  ]) {
    await t.test(name, () => {
      const result = detectPlatform(input);
      assert.equal(result.isIos, isIos);
      assert.equal(result.isAndroid, isAndroid);
      assert.equal(result.isNative, false);
      assert.equal(result.isStandalone, false);
      assert.equal(result.showInstallHelp, isIos);
    });
  }
});

test("the native platform takes precedence over conflicting or missing browser identities", async (t) => {
  for (const [name, input, isIos, isAndroid] of [
    ["native iOS without a user agent", { nativePlatform: "ios" }, true, false],
    [
      "native iOS with Android user agent",
      { ...android, nativePlatform: "ios" },
      true,
      false,
    ],
    [
      "native iOS with desktop user agent",
      { ...desktopSafari, nativePlatform: "ios" },
      true,
      false,
    ],
    ["native Android", { ...android, nativePlatform: "android" }, false, true],
    [
      "native Android spoofing iPhone",
      { ...iphone, nativePlatform: "android" },
      false,
      true,
    ],
    [
      "native Android with iPad desktop identity",
      { ...desktopModeIpad, nativePlatform: "android" },
      false,
      true,
    ],
  ]) {
    await t.test(name, () => {
      const result = detectPlatform(input);
      assert.equal(result.isIos, isIos);
      assert.equal(result.isAndroid, isAndroid);
      assert.equal(result.isNative, true);
      assert.equal(result.showInstallHelp, false);
    });
  }
});

test("installation help is limited to Apple web tabs and disappears in installed or native apps", async (t) => {
  for (const [name, input, showInstallHelp] of [
    ["iPhone browser tab", iphone, true],
    ["iPad browser tab", desktopModeIpad, true],
    ["installed iPhone web app", { ...iphone, standalone: true }, false],
    ["installed iPad web app", { ...desktopModeIpad, standalone: true }, false],
    ["iOS native app", { ...iphone, nativePlatform: "ios" }, false],
    ["Android web tab", android, false],
    ["installed Android web app", { ...android, standalone: true }, false],
    ["desktop browser tab", desktopSafari, false],
  ]) {
    await t.test(name, () => {
      const result = detectPlatform(input);
      assert.equal(result.showInstallHelp, showInstallHelp);
      assert.equal(result.isStandalone, input.standalone === true);
    });
  }
});

test("applying the appearance uses navigator identity and returns the same detection", () => {
  const document = {
    documentElement: { dataset: { ui: "default", retained: "value" } },
  };
  const navigator = { ...desktopModeIpad };
  const before = structuredClone(navigator);
  const result = applyPlatformAppearance(document, navigator);
  assert.equal(document.documentElement.dataset.ui, "ios");
  assert.equal(document.documentElement.dataset.retained, "value");
  assert.deepEqual(result, detectPlatform(desktopModeIpad));
  assert.deepEqual(navigator, before);
});

test("appearance resets from iOS to default when a document is reused on Android or desktop", () => {
  const document = { documentElement: { dataset: {} } };
  applyPlatformAppearance(document, iphone);
  assert.equal(document.documentElement.dataset.ui, "ios");
  const nativeAndroid = applyPlatformAppearance(document, iphone, {
    nativePlatform: "android",
  });
  assert.equal(document.documentElement.dataset.ui, "default");
  assert.equal(nativeAndroid.isIos, false);
  assert.equal(nativeAndroid.isAndroid, true);
  applyPlatformAppearance(document, desktopModeIpad);
  assert.equal(document.documentElement.dataset.ui, "ios");
  const desktop = applyPlatformAppearance(document, desktopSafari);
  assert.equal(document.documentElement.dataset.ui, "default");
  assert.equal(desktop.isIos, false);
  assert.equal(desktop.showInstallHelp, false);
  applyPlatformAppearance(document, {});
  assert.equal(document.documentElement.dataset.ui, "default");
});

test("appearance forwards native and standalone options without losing Apple browser detection", () => {
  const document = { documentElement: { dataset: {} } };
  const installed = applyPlatformAppearance(document, iphone, {
    standalone: true,
  });
  assert.equal(document.documentElement.dataset.ui, "ios");
  assert.equal(installed.isStandalone, true);
  assert.equal(installed.showInstallHelp, false);
  const native = applyPlatformAppearance(document, android, {
    nativePlatform: "ios",
  });
  assert.equal(document.documentElement.dataset.ui, "ios");
  assert.equal(native.isIos, true);
  assert.equal(native.isNative, true);
  assert.equal(native.isAndroid, false);
  assert.equal(native.showInstallHelp, false);
});

test("each iOS installation instruction has a distinct Hindi translation", async (t) => {
  for (const key of [
    "iosInstall",
    "iosInstallIntro",
    "iosInstallSafari",
    "iosInstallShare",
    "iosInstallAdd",
    "iosInstallData",
  ]) {
    await t.test(key, () => {
      assert.equal(typeof en[key], "string");
      assert.equal(typeof hi[key], "string");
      assert.ok(en[key].trim().length > 0);
      assert.notEqual(hi[key], en[key], `${key} must not fall back to English`);
      assert.match(
        hi[key],
        /[\u0900-\u097f]/u,
        `${key} must contain Hindi text`,
      );
    });
  }
  assert.equal(hi.iosInstall, "होम स्क्रीन पर जोड़ें");
});
