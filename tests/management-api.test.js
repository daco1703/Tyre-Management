import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { createApp } from "../server/app.js";
import { createSqliteStore } from "../server/storage/sqlite.js";
import { emptyState } from "../shared/model.js";
import { stateForUser } from "../shared/state-view.js";
import {
  createDatabaseBackup,
  validateDatabaseBackup,
} from "../server/recovery.js";

const password = "management-test-password";
const driver = (name, licenseNo = "MH1220220000001") => ({
  name,
  dob: "1985-04-18",
  licenseNo,
  licenseExpiry: "2030-04-18",
});
const tyre = (serial, amount = "12345.67") => ({
  serial,
  brand: "MRF",
  type: "new",
  construction: "radial",
  invoiceNo: `INV-${serial}`,
  amount,
});
function noMoneyFields(value) {
  const forbidden = new Set([
    "costs",
    "amount",
    "amountPaise",
    "purchaseAmount",
    "unitPrice",
    "costPerKm",
    "invoiceTotal",
  ]);
  function visit(node) {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      assert.ok(!forbidden.has(key), `staff received financial field ${key}`);
      visit(child);
    }
  }
  visit(value);
}
async function fixture(t, { serverless = false } = {}) {
  const store = createSqliteStore(":memory:");
  const { app } = createApp({ store, serverless });
  const salt = randomBytes(16).toString("hex");
  await store.run(
    "UPDATE users SET username=?,salt=?,hash=? WHERE role='owner'",
    "test_owner",
    salt,
    scryptSync(password, salt, 64).toString("hex"),
  );
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  });
  async function req(route, body, cookie, headers = {}) {
    const response = await fetch(base + "/api" + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  const owner = await req("/login", { username: "test_owner", password });
  assert.equal(owner.status, 200);
  assert.equal(
    (
      await req(
        "/team/create",
        { username: "desk_staff", password },
        owner.cookie,
      )
    ).status,
    201,
  );
  const staff = await req("/login", { username: "desk_staff", password });
  assert.equal(staff.status, 200);
  const get = async (who = owner) => {
    const response = await req("/state", undefined, who.cookie);
    assert.equal(response.status, 200);
    return response.data;
  };
  const action = async (kind, payload, who = owner) => {
    const state = await get(who);
    return req(
      "/actions",
      { kind, payload, revision: state.revision },
      who.cookie,
    );
  };
  const act = async (kind, payload, who = owner) => {
    const response = await action(kind, payload, who);
    assert.equal(
      response.status,
      200,
      `${kind}: ${JSON.stringify(response.data)}`,
    );
    return response.data;
  };
  return { req, store, owner, staff, get, action, act };
}

test("staff state projections preserve operations and invoice references without mutating full financial records", () => {
  const state = {
    ...emptyState(),
    costs: [{ amountPaise: 1234567 }],
    tyres: [
      {
        serial: "FIN-001",
        invoiceNo: "INV-1234567",
        distance: 150000,
        nsd: { averagePercent: 55 },
        purchaseAmount: 1234567,
        nested: { unitPrice: "12345.67", invoiceDate: "2026-11-24" },
      },
    ],
    events: [
      {
        tally: { total: 8, stock: 2 },
        runningKm: 500,
        billing: { invoiceNo: "KEEP-REF", amountPaise: 1234567 },
        list: [
          { costPerKm: 1.5, invoiceTotal: 1234567, note: "Workshop record" },
        ],
      },
    ],
  };
  const before = structuredClone(state);
  const visible = stateForUser(state, { role: "staff" });
  noMoneyFields(visible);
  assert.equal(visible.tyres[0].invoiceNo, "INV-1234567");
  assert.equal(visible.tyres[0].distance, 150000);
  assert.equal(visible.tyres[0].nsd.averagePercent, 55);
  assert.equal(visible.events[0].tally.total, 8);
  assert.equal(visible.events[0].billing.invoiceNo, "KEEP-REF");
  assert.equal(visible.events[0].list[0].note, "Workshop record");
  visible.tyres[0].serial = "LOCAL-CHANGE";
  assert.deepEqual(state, before);
  assert.equal(
    stateForUser(state, { role: "owner" }).costs[0].amountPaise,
    1234567,
  );
  noMoneyFields(stateForUser(state, null));
});

test("only admins edit tyre identities and reminders; staff and admins can maintain the driver roster", async (t) => {
  const { req, owner, staff, get, action, act } = await fixture(t);
  const initial = await act("addTyre", tyre("EDIT-ORIGINAL"));
  const tyreId = initial.tyres[0].id;
  const before = await get();
  for (const [kind, payload] of [
    ["updateTyre", { tyreId, serial: "FORGED-EDIT", role: "owner" }],
    ["updateReminderSettings", { settings: {}, role: "owner" }],
  ]) {
    const denied = await action(kind, payload, staff);
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error, "ownerOnly");
    assert.deepEqual(await get(), before);
  }
  const edited = await act("updateTyre", {
    tyreId,
    serial: "EDIT-CORRECTED",
    expectedSerial: "EDIT-ORIGINAL",
    brand: "Apollo",
    construction: "horse",
  });
  assert.equal(edited.tyres[0].serial, "EDIT-CORRECTED");
  assert.equal(edited.tyres[0].status, "stock");
  assert.deepEqual(edited.costs, before.costs);
  assert.equal(edited.events.at(-1).actor, "test_owner");
  const staffAdded = await act(
    "addDriver",
    driver("Staff-entered driver"),
    staff,
  );
  noMoneyFields(staffAdded);
  const driverId = staffAdded.drivers[0].id;
  await act("updateDriver", { ...driver("Corrected driver"), driverId }, staff);
  const ownerAdded = await act(
    "addDriver",
    driver("Admin-entered driver", "MH1220220000002"),
  );
  assert.equal(ownerAdded.drivers.length, 2);
  assert.equal(
    ownerAdded.drivers.find((row) => row.id === driverId).name,
    "Corrected driver",
  );
  assert.ok(
    ownerAdded.events.some(
      (row) => row.kind === "updateDriver" && row.actor === "desk_staff",
    ),
  );
  const settings = structuredClone(ownerAdded.reminderSettings);
  settings.nsd = { value: 3, unit: "months" };
  const configured = await act("updateReminderSettings", { settings });
  assert.deepEqual(configured.reminderSettings.nsd, settings.nsd);
  assert.deepEqual(
    (await get(staff)).reminderSettings,
    configured.reminderSettings,
  );
  assert.equal(
    (
      await req("/actions", {
        kind: "updateTyre",
        payload: { tyreId, serial: "UNAUTH" },
        revision: configured.revision,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await req(
        "/reports/costs?from=2000-01-01&to=2099-12-31",
        undefined,
        staff.cookie,
      )
    ).status,
    403,
  );
});

test("staff state, action, native bearer and changed-revision responses omit finances while the database retains the ledger", async (t) => {
  const { req, store, owner, staff, get, act } = await fixture(t);
  await act("addTyre", tyre("PRIVATE-A"));
  const staffResult = await act(
    "addTyre",
    tyre("PRIVATE-B", "76543.21"),
    staff,
  );
  noMoneyFields(staffResult);
  const full = await get();
  assert.equal(full.costs.length, 2);
  assert.deepEqual(
    full.costs.map((row) => row.amountPaise).sort((a, b) => a - b),
    [1234567, 7654321],
  );
  assert.equal(full.costs.at(-1).actor, "desk_staff");
  const embedded = structuredClone(full);
  embedded.tyres[0].purchaseAmount = 1234567;
  embedded.events[0].billing = {
    invoiceNo: "KEEP-REFERENCE",
    amountPaise: 1234567,
    nested: [{ unitPrice: "12345.67", note: "KEEP-NOTE" }],
  };
  await store.run(
    "UPDATE settings SET value=? WHERE key='state'",
    JSON.stringify(embedded),
  );
  const staffState = await get(staff);
  noMoneyFields(staffState);
  assert.equal(staffState.events[0].billing.invoiceNo, "KEEP-REFERENCE");
  assert.equal(staffState.events[0].billing.nested[0].note, "KEEP-NOTE");
  const update = await req("/updates?revision=0", undefined, staff.cookie);
  assert.equal(update.status, 200);
  noMoneyFields(update.data);
  const native = await req(
    "/login",
    { username: "desk_staff", password },
    null,
    { Origin: "https://localhost" },
  );
  const nativeState = await req("/state", undefined, null, {
    Authorization: `Bearer ${native.data.token}`,
    Origin: "https://localhost",
  });
  assert.equal(nativeState.status, 200);
  noMoneyFields(nativeState.data);
  const exportedStaffRecords = JSON.parse(JSON.stringify(staffState));
  noMoneyFields(exportedStaffRecords);
  assert.deepEqual(await get(owner), embedded);
  assert.deepEqual(
    JSON.parse(
      (await store.get("SELECT value FROM settings WHERE key='state'")).value,
    ),
    embedded,
  );
});

test("SQLite waiting updates project each role at notification time and revoke removed staff", async (t) => {
  const { req, store, owner, staff, get, act } = await fixture(t);
  const before = await act("addTyre", tyre("WAIT-A"));
  const staffWaiting = req(
    `/updates?revision=${before.revision}`,
    undefined,
    staff.cookie,
  ).catch((error) => ({ transportError: error }));
  const ownerWaiting = req(
    `/updates?revision=${before.revision}`,
    undefined,
    owner.cookie,
  ).catch((error) => ({ transportError: error }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await act("addTyre", tyre("WAIT-B", "200.50"));
  const [staffUpdate, ownerUpdate] = await Promise.all([
    staffWaiting,
    ownerWaiting,
  ]);
  assert.equal(staffUpdate.status, 200);
  noMoneyFields(staffUpdate.data);
  assert.equal(ownerUpdate.status, 200);
  assert.equal(ownerUpdate.data.costs.length, 2);
  const pendingRevision = (await get()).revision;
  const revoked = req(
    `/updates?revision=${pendingRevision}`,
    undefined,
    staff.cookie,
  ).catch((error) => ({ transportError: error }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    (await req("/team/deactivate", { id: staff.data.user.id }, owner.cookie))
      .status,
    200,
  );
  assert.equal((await revoked).status, 401);
  const changedRole = req(
    `/updates?revision=${pendingRevision}`,
    undefined,
    owner.cookie,
  ).catch((error) => ({ transportError: error }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await store.run("UPDATE users SET role='staff' WHERE username='test_owner'");
  const result = await act("addTyre", tyre("WAIT-C", "50"));
  noMoneyFields(result);
  const currentRoleView = await changedRole;
  assert.equal(currentRoleView.status, 200);
  noMoneyFields(currentRoleView.data);
});

test(
  "distributed polling and delayed legacy updates retain role projection and recheck revoked sessions",
  { timeout: 20000 },
  async (t) => {
    const { req, owner, staff, get, act } = await fixture(t, {
      serverless: true,
    });
    const full = await act("addTyre", tyre("POLL-A"));
    const poll = await req(
      `/updates?revision=${full.revision}&poll=1`,
      undefined,
      staff.cookie,
    );
    assert.equal(poll.status, 200);
    noMoneyFields(poll.data);
    assert.equal(
      (
        await req(
          "/team/create",
          { username: "revoked_staff", password },
          owner.cookie,
        )
      ).status,
      201,
    );
    const doomed = await req("/login", { username: "revoked_staff", password });
    const staffWaiting = req(
      `/updates?revision=${full.revision}`,
      undefined,
      staff.cookie,
    );
    const ownerWaiting = req(
      `/updates?revision=${full.revision}`,
      undefined,
      owner.cookie,
    );
    const doomedWaiting = req(
      `/updates?revision=${full.revision}`,
      undefined,
      doomed.cookie,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      (await req("/team/deactivate", { id: doomed.data.user.id }, owner.cookie))
        .status,
      200,
    );
    const [staffResult, ownerResult, doomedResult] = await Promise.all([
      staffWaiting,
      ownerWaiting,
      doomedWaiting,
    ]);
    assert.equal(staffResult.status, 200);
    noMoneyFields(staffResult.data);
    assert.equal(ownerResult.status, 200);
    assert.equal(ownerResult.data.costs.length, 1);
    assert.equal(doomedResult.status, 401);
    assert.deepEqual((await get()).costs, full.costs);
  },
);

test("admin cost reports validate filters and include paid purchase/remold invoices without exposing reports to staff", async (t) => {
  const { req, owner, staff, act } = await fixture(t);
  const added = await act("addTyre", tyre("REPORT-A", "1000"));
  const tyreId = added.tyres[0].id;
  await act("sendRemold", { tyreId, vendor: "Sharvayu" });
  await act("remold", {
    tyreId,
    vendor: "Sharvayu",
    invoiceNo: "REMOLD-REPORT",
    amount: "500",
  });
  const route = "/reports/costs?from=2000-01-01&to=2099-12-31";
  assert.equal((await req(route)).status, 401);
  assert.equal((await req(route, undefined, staff.cookie)).status, 403);
  assert.equal(
    (await req(route + "&role=owner", undefined, staff.cookie)).status,
    403,
  );
  const report = await req(route, undefined, owner.cookie);
  assert.equal(report.status, 200);
  assert.equal(report.data.totals.purchasePaise, 100000);
  assert.equal(report.data.totals.remoldPaise, 50000);
  assert.equal(report.data.totals.totalPaise, 150000);
  assert.equal(report.data.rows.length, 2);
  const filtered = await req(
    route + "&kind=remold&brand=MRF&groupBy=day",
    undefined,
    owner.cookie,
  );
  assert.equal(filtered.status, 200);
  assert.equal(filtered.data.totals.totalPaise, 50000);
  assert.equal(filtered.data.series[0].period.length, 10);
  for (const query of [
    "from=2026-02-30&to=2026-12-31",
    "from=2027-01-01&to=2026-01-01",
    "from=2000-01-01&to=2099-12-31&kind=labour",
    "from=2000-01-01&to=2099-12-31&vehicleId=unknown",
    "from=2000-01-01&from=2001-01-01&to=2099-12-31",
  ]) {
    const invalid = await req(
      "/reports/costs?" + query,
      undefined,
      owner.cookie,
    );
    assert.equal(invalid.status, 400);
    assert.ok(
      ["invalidDateRange", "invalidCostFilter"].includes(invalid.data.error),
    );
  }
});

test("invalid required invoices cannot partially change inventory or costs; explicit zero remains a recorded invoice", async (t) => {
  const { get, action, act, staff } = await fixture(t);
  const before = await get();
  for (const patch of [
    { invoiceNo: undefined },
    { amount: undefined },
    { amount: "-1" },
    { amount: "1.001" },
    { amount: "Infinity" },
    { amount: undefined, amountPaise: "100" },
    { amount: "1", amountPaise: 101 },
  ]) {
    const invalid = await action("addTyre", {
      ...tyre("BAD-INVOICE"),
      ...patch,
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await get(), before);
  }
  const batch = await action("importTyres", {
    tyres: [tyre("BATCH-VALID"), { ...tyre("BATCH-INVALID"), invoiceNo: "" }],
  });
  assert.equal(batch.status, 400);
  assert.deepEqual(await get(), before);
  const zero = await act("addTyre", tyre("ZERO-CHARGE", "0"), staff);
  noMoneyFields(zero);
  const ownerState = await get();
  assert.equal(ownerState.costs[0].amountPaise, 0);
  const tyreId = ownerState.tyres[0].id;
  await act("sendRemold", { tyreId, vendor: "Sharvayu" });
  const beforeRemold = await get();
  assert.equal(
    (await action("remold", { tyreId, vendor: "Sharvayu" })).status,
    400,
  );
  assert.deepEqual(await get(), beforeRemold);
});

test("full backups retain ledger, drivers and reminder settings verbatim while accepting older backups", async (t) => {
  const { store, staff, act, get } = await fixture(t);
  await act("addTyre", tyre("BACKUP-A"));
  await act("addDriver", driver("Backup driver"), staff);
  const full = await get();
  const raw = (await store.get("SELECT value FROM settings WHERE key='state'"))
    .value;
  const backup = await createDatabaseBackup(store);
  const validated = validateDatabaseBackup(backup);
  assert.equal(
    validated.settings.find((row) => row.key === "state").value,
    raw,
  );
  const restoredState = JSON.parse(
    validated.settings.find((row) => row.key === "state").value,
  );
  assert.deepEqual(restoredState.costs, full.costs);
  assert.deepEqual(restoredState.drivers, full.drivers);
  assert.deepEqual(restoredState.reminderSettings, full.reminderSettings);
  noMoneyFields(await get(staff));
  const legacy = structuredClone(backup);
  const legacyState = JSON.parse(raw);
  delete legacyState.costs;
  delete legacyState.drivers;
  delete legacyState.reminderSettings;
  legacy.settings.find((row) => row.key === "state").value =
    JSON.stringify(legacyState);
  assert.equal(
    validateDatabaseBackup(legacy).settings.find((row) => row.key === "state")
      .value,
    JSON.stringify(legacyState),
  );
  for (const [key, value] of [
    ["costs", {}],
    ["drivers", "malformed"],
    ["reminderSettings", { nsd: { value: -1, unit: "months" } }],
  ]) {
    const malformed = structuredClone(backup),
      state = JSON.parse(raw);
    state[key] = value;
    malformed.settings.find((row) => row.key === "state").value =
      JSON.stringify(state);
    assert.throws(
      () => validateDatabaseBackup(malformed),
      /invalid or unsupported/,
    );
  }
});
