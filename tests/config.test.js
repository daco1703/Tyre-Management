import test from "node:test";
import assert from "node:assert/strict";
import {
  deploymentOptions,
  normalizePublicOrigin,
  fleetPreviewOrigin,
} from "../server/config.js";

test("Render built-in variables configure its HTTPS origin and proxy automatically", () => {
  assert.deepEqual(
    deploymentOptions({
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://tyre-management.onrender.com/",
    }),
    {
      trustProxy: true,
      publicOrigin: "https://tyre-management.onrender.com",
      additionalPublicOrigins: [
        "https://www.shepards-tyre-management.com",
        fleetPreviewOrigin,
      ],
    },
  );
  assert.deepEqual(deploymentOptions({}), {
    trustProxy: false,
    publicOrigin: "",
  });
});
test("the configured company origin also allows its exact main-branch preview", () => {
  assert.deepEqual(
    deploymentOptions({
      RENDER: "true",
      PUBLIC_ORIGIN: "https://www.shepards-tyre-management.com/",
    }).additionalPublicOrigins,
    ["https://www.shepards-tyre-management.com", fleetPreviewOrigin],
  );
});
test("explicit public origin and proxy overrides take precedence over Render defaults", () => {
  assert.deepEqual(
    deploymentOptions({
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://service.onrender.com",
      PUBLIC_ORIGIN: "https://tyres.example.com/",
      TRUST_PROXY: "0",
    }),
    {
      trustProxy: false,
      publicOrigin: "https://tyres.example.com",
    },
  );
  assert.equal(deploymentOptions({ TRUST_PROXY: "1" }).trustProxy, true);
  assert.equal(
    deploymentOptions({
      RENDER: "true",
      PUBLIC_ORIGIN: "https://tyres.example.com",
    }).additionalPublicOrigins,
    undefined,
  );
});
test("public origin must be a single HTTPS website origin", () => {
  assert.equal(
    normalizePublicOrigin("https://tyres.example.com:443/"),
    "https://tyres.example.com",
  );
  for (const value of [
    "*",
    "null",
    "http://tyres.example.com",
    "https://user:password@tyres.example.com",
    "https://tyres.example.com/path",
    "https://tyres.example.com?query=1",
    "https://tyres.example.com#fragment",
    "https://one.example,https://two.example",
  ]) {
    assert.throws(
      () => normalizePublicOrigin(value),
      /PUBLIC_ORIGIN must be an HTTPS origin/,
    );
  }
});

test("Vercel uses the company origin and exact platform-injected deployment hosts", () => {
  assert.deepEqual(
    deploymentOptions({
      VERCEL: "1",
      VERCEL_URL: "tyre-management-a1b2-shepards.vercel.app",
      VERCEL_BRANCH_URL: "tyre-management-git-main-shepards.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "tyre-management-shepards.vercel.app",
    }),
    {
      trustProxy: true,
      publicOrigin: "https://www.shepards-tyre-management.com",
      additionalPublicOrigins: [
        "https://www.shepards-tyre-management.com",
        "https://tyre-management-git-main-shepards.vercel.app",
        "https://tyre-management-a1b2-shepards.vercel.app",
        "https://tyre-management-shepards.vercel.app",
      ],
    },
  );
  const options = deploymentOptions({
    VERCEL: "1",
    PUBLIC_ORIGIN: "https://another-fleet.example",
    TRUST_PROXY: "0",
    VERCEL_URL: "tyre-management-a1b2-shepards.vercel.app",
  });
  assert.deepEqual(options, {
    trustProxy: false,
    publicOrigin: "https://another-fleet.example",
  });
  for (const host of [
    "evil.example",
    "vercel.app.evil.example",
    "user:password@fleet.vercel.app",
    "fleet.vercel.app/path",
  ]) {
    assert.deepEqual(
      deploymentOptions({ VERCEL: "1", VERCEL_URL: host })
        .additionalPublicOrigins,
      ["https://www.shepards-tyre-management.com", fleetPreviewOrigin],
    );
  }
});
