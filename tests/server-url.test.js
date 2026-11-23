import test from "node:test";
import assert from "node:assert/strict";
import { defaultSharedServer } from "../shared/defaults.js";
import { resolveSharedServer } from "../src/server-url.js";

test("new phones and previous Render addresses use the confirmed production server", () => {
  assert.equal(defaultSharedServer, "https://tyre-management-shepards.vercel.app");
  for (const saved of [
    null,
    undefined,
    "",
    "https://tyre-management.onrender.com",
    "https://tyre-management.onrender.com/",
    " HTTPS://TYRE-MANAGEMENT.ONRENDER.COM:443/ ",
  ])
    assert.equal(resolveSharedServer(saved), defaultSharedServer);
});

test("the migration preserves separately chosen HTTPS servers", () => {
  for (const saved of [
    defaultSharedServer,
    "https://www.shepards-tyre-management.com",
    "https://another-fleet.example",
    "https://another-fleet.example:8443",
    "https://tyre-management.onrender.com.other.example",
  ])
    assert.equal(resolveSharedServer(saved), saved);
  assert.equal(
    resolveSharedServer("https://another-fleet.example/"),
    "https://another-fleet.example",
  );
});

test("invalid stored settings recover to the HTTPS default", () => {
  for (const saved of [
    {},
    "garbled preference",
    "http://tyre-management.onrender.com",
    "https://user:password@another-fleet.example",
    "https://another-fleet.example/path",
    "https://another-fleet.example?query=1",
    "https://another-fleet.example#fragment",
    "https://localhost",
  ])
    assert.equal(resolveSharedServer(saved), defaultSharedServer);
});
