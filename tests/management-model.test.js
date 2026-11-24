import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAction,
  emptyState,
  tyreMatchesEvent,
  validateManagementState,
} from "../shared/model.js";
import {
  normalizeDriver,
  driverLicenseKey,
  activeDrivers,
} from "../shared/drivers.js";
import {
  reminderSettings,
  normalizeReminderSettings,
  addReminderInterval,
  nsdDueOn,
  inspectionDueOn,
  driverCheckDueOn,
  licenseStatus,
} from "../shared/reminders.js";
import { MAX_AMOUNT_PAISE } from "../shared/costs.js";

const at = (day) => new Date(`${day}T10:00:00+05:30`);
const act = (
  state,
  kind,
  payload,
  day = "2026-11-24",
  actor = "staff.member",
) => applyAction(state, { kind, payload }, actor, at(day));
const receipt = (serial, extra = {}) => ({
  serial,
  brand: "MRF",
  type: "new",
  construction: "radial",
  invoiceNo: `INV-${serial}`,
  amount: "1250.50",
  ...extra,
});
const profile = (extra = {}) => ({
  name: "राम कुमार",
  dob: "1985-01-31",
  licenseNo: "MH-01 2020 1234567",
  licenseExpiry: "2027-03-31",
  ...extra,
});
const vehicle = (extra = {}) => ({
  registration: "MH01A1234",
  hasSpare: true,
  odometer: 100,
  ...extra,
});
const identity = (tyre) => ({
  serial: tyre.serial,
  brand: tyre.brand,
  construction: tyre.construction || null,
});
const driverSnapshot = (driver) =>
  Object.fromEntries(
    ["name", "dob", "licenseNo", "licenseExpiry", "active"].map((key) => [
      key,
      key === "active" ? driver.active !== false : driver[key],
    ]),
  );
function fitted(day = "2026-11-24") {
  let state = act(emptyState(), "addVehicle", vehicle(), day);
  state = act(state, "addTyre", receipt("TYRE-A"), day);
  state = act(
    state,
    "fit",
    {
      tyreId: state.tyres[0].id,
      vehicleId: state.vehicles[0].id,
      slot: "FL",
      odometer: 100,
    },
    day,
  );
  return state;
}
const errorCode = (code, status) => (error) => {
  assert.equal(error.code, code);
  if (status) assert.equal(error.status, status);
  return true;
};

test("legacy snapshots acquire optional management collections without changing history or version", () => {
  const legacy = {
    version: 1,
    revision: 0,
    vehicles: [],
    tyres: [],
    events: [],
  };
  const before = structuredClone(legacy);
  const state = act(legacy, "addVehicle", vehicle());
  assert.deepEqual(legacy, before);
  assert.equal(state.version, 1);
  assert.deepEqual(state.drivers, []);
  assert.deepEqual(state.costs, []);
  assert.deepEqual(state.reminderSettings, reminderSettings());
  const another = emptyState();
  state.reminderSettings.nsd.value = 9;
  assert.equal(another.reminderSettings.nsd.value, 2);
  assert.deepEqual(validateManagementState(legacy), {});
});

test("every receipt condition has one immutable private ledger entry and explicit zero is priced", () => {
  let state = emptyState();
  for (const type of ["new", "used", "remold"])
    state = act(
      state,
      "addTyre",
      receipt(type, { type, amount: type === "used" ? 0 : "1,25,000.25" }),
    );
  assert.equal(state.costs.length, 3);
  assert.deepEqual(
    state.costs.map((cost) => cost.kind),
    ["purchase", "purchase", "purchase"],
  );
  assert.deepEqual(
    state.costs.map((cost) => cost.condition),
    ["new", "used", "remold"],
  );
  assert.deepEqual(
    state.costs.map((cost) => cost.amountPaise),
    [12500025, 0, 12500025],
  );
  for (const [index, cost] of state.costs.entries()) {
    assert.equal(cost.tyreId, state.tyres[index].id);
    assert.equal(cost.eventId, state.events[index].id);
    assert.equal(cost.id, state.events[index].costId);
    assert.equal(cost.actor, "staff.member");
    assert.equal(
      cost.invoiceNo,
      `INV-${state.tyres[index].serial.toLowerCase()}`,
    );
  }
  const outsideLedger = structuredClone(state);
  delete outsideLedger.costs;
  const check = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(
        !["amount", "amountPaise", "purchaseAmount", "remoldAmount"].includes(
          key,
        ),
      );
      check(child);
    }
  };
  check(outsideLedger);
  assert.deepEqual(validateManagementState(state), {});
});

test("missing or invalid invoice inputs reject new receipts atomically", () => {
  const state = emptyState(),
    saved = structuredClone(state);
  for (const [patch, code] of [
    [{ invoiceNo: undefined }, "invoiceRequired"],
    [{ amount: undefined }, "invoiceRequired"],
    [{ invoiceNo: " " }, "invalidInvoice"],
    [{ invoiceNo: 20 }, "invalidInvoice"],
    [{ amount: "1.001" }, "invalidAmount"],
    [{ amount: -1 }, "invalidAmount"],
    [{ amount: "10", amountPaise: 99 }, "invalidAmount"],
  ]) {
    assert.throws(
      () => act(state, "addTyre", receipt("A", patch)),
      errorCode(code),
    );
    assert.deepEqual(state, saved);
  }
});

test("dispatching to remold creates no cost; each completion requires and records its own invoice", () => {
  let state = fitted();
  const tyreId = state.tyres[0].id;
  state = act(state, "remove", {
    tyreId,
    odometer: 250,
    destination: "remolding",
    vendor: "Sharvayu",
  });
  assert.equal(state.costs.length, 1);
  const saved = structuredClone(state);
  assert.throws(
    () => act(state, "remold", { tyreId }),
    errorCode("invoiceRequired"),
  );
  assert.deepEqual(state, saved);
  state = act(state, "remold", {
    tyreId,
    invoiceNo: "RM-2026-1",
    amountPaise: 0,
  });
  assert.equal(state.tyres[0].distance, 150);
  assert.equal(state.tyres[0].remolds, 1);
  assert.equal(state.costs.length, 2);
  assert.equal(state.costs[1].kind, "remold");
  assert.equal(state.costs[1].condition, "remold");
  assert.equal(state.costs[1].amountPaise, 0);
  assert.equal(state.events.at(-1).vendor, "Sharvayu");
  state = act(state, "sendRemold", { tyreId, vendor: "Guardex MRF" });
  assert.equal(state.costs.length, 2);
  state = act(state, "remold", {
    tyreId,
    invoiceNo: "RM-2026-2",
    amount: "2750.05",
  });
  assert.equal(state.tyres[0].remolds, 2);
  assert.equal(state.costs.length, 3);
  assert.equal(state.costs[2].amountPaise, 275005);
});

test("invoice-bearing tyre imports are atomic and retain separate attributed receipt links", () => {
  const state = emptyState();
  assert.throws(
    () =>
      act(state, "importTyres", {
        tyres: [receipt("A"), receipt("B", { amount: undefined })],
      }),
    /importInvalidBatch/,
  );
  assert.equal(state.tyres.length, 0);
  assert.equal(state.costs.length, 0);
  const imported = act(state, "importTyres", {
    tyres: [
      receipt("A"),
      receipt("B", { type: "used", amount: undefined, amountPaise: 0 }),
    ],
  });
  assert.equal(imported.tyres.length, 2);
  assert.equal(imported.costs.length, 2);
  assert.equal(new Set(imported.costs.map((cost) => cost.eventId)).size, 2);
  assert.ok(
    imported.events.every(
      (event) =>
        event.actor === "staff.member" && event.note === "Excel import",
    ),
  );
  assert.deepEqual(validateManagementState(imported), {});
});

test("tyre identity corrections preserve fitted lifecycle, prior receipts and full history", () => {
  let state = fitted();
  const tyreId = state.tyres[0].id;
  state = act(state, "measureNsd", {
    tyreId,
    measuredOn: "2026-11-24",
    nsd: { averagePercent: 77 },
  });
  const beforeTyre = structuredClone(state.tyres[0]),
    oldEvents = structuredClone(state.events),
    ledger = structuredClone(state.costs);
  state = act(
    state,
    "updateTyre",
    {
      tyreId,
      serial: "CORRECTED-001",
      brand: "Apollo",
      construction: "horse",
      expectedIdentity: identity(beforeTyre),
      status: "sold",
      type: "used",
      distance: 99999,
      invoiceNo: "IGNORED",
      amountPaise: 1,
    },
    "2026-11-24",
    "admin",
  );
  const tyre = state.tyres[0];
  for (const key of [
    "id",
    "type",
    "status",
    "distance",
    "vehicleId",
    "slot",
    "fittedAt",
    "remolds",
    "nsd",
    "lastNsdOn",
    "nsdBaselineOn",
  ])
    assert.deepEqual(tyre[key], beforeTyre[key], key);
  assert.equal(tyre.serial, "CORRECTED-001");
  assert.deepEqual(tyre.serialAliases, ["TYRE-A"]);
  assert.deepEqual(state.events.slice(0, -1), oldEvents);
  assert.deepEqual(state.costs, ledger);
  assert.deepEqual(state.events.at(-1).before, identity(beforeTyre));
  assert.deepEqual(state.events.at(-1).after, identity(tyre));
  assert.equal(state.events.at(-1).tyreId, tyreId);
  assert.equal(state.events.at(-1).actor, "admin");
  assert.ok(
    oldEvents
      .filter((event) => event.tyreId === tyreId)
      .every((event) => tyreMatchesEvent(tyre, event)),
  );
  assert.deepEqual(validateManagementState(state), {});
});

test("old serials cannot be reused by another tyre or import, while own corrections can be reversed", () => {
  let state = act(emptyState(), "addTyre", receipt("ORIGINAL"));
  const tyreId = state.tyres[0].id;
  state = act(state, "updateTyre", { tyreId, serial: "CORRECTED" });
  state = act(state, "addTyre", receipt("OTHER"));
  assert.throws(
    () => act(state, "addTyre", receipt(" original ")),
    /duplicateTyre/,
  );
  assert.throws(
    () =>
      act(state, "updateTyre", {
        tyreId: state.tyres[1].id,
        serial: "ORIGINAL",
      }),
    /duplicateTyre/,
  );
  assert.throws(
    () => act(state, "importTyres", { tyres: [receipt("ORIGINAL")] }),
    /duplicateTyre/,
  );
  state = act(state, "updateTyre", { tyreId, serial: "ORIGINAL" });
  assert.deepEqual(state.tyres[0].serialAliases, ["CORRECTED"]);
  assert.throws(
    () => act(state, "addTyre", receipt("CORRECTED")),
    /duplicateTyre/,
  );
});

test("identity edits retain or explicitly clear an unknown legacy construction", () => {
  let state = act(
    emptyState(),
    "addTyre",
    receipt("LEGACY", { construction: null }),
  );
  const tyreId = state.tyres[0].id;
  state = act(state, "updateTyre", {
    tyreId,
    serial: "LEGACY-FIXED",
    construction: null,
  });
  assert.equal(state.tyres[0].construction, null);
  state = act(state, "updateTyre", { tyreId, construction: "radial" });
  state = act(state, "updateTyre", { tyreId, construction: null });
  assert.equal(state.events.at(-1).before.construction, "radial");
  assert.equal(state.events.at(-1).after.construction, null);
  assert.equal(state.tyres[0].id, tyreId);
});

test("stale identity and driver form snapshots reject even after a client refreshes its revision", () => {
  let state = act(emptyState(), "addTyre", receipt("A"));
  const tyreId = state.tyres[0].id,
    expectedIdentity = identity(state.tyres[0]);
  state = act(state, "updateTyre", { tyreId, brand: "CEAT" });
  const saved = structuredClone(state);
  assert.throws(
    () => act(state, "updateTyre", { tyreId, serial: "B", expectedIdentity }),
    errorCode("tyreChanged", 409),
  );
  assert.deepEqual(state, saved);
  state = act(state, "addDriver", profile());
  const driverId = state.drivers[0].id,
    expectedDriver = driverSnapshot(state.drivers[0]);
  state = act(state, "updateDriver", { driverId, licenseExpiry: "2029-01-31" });
  const edited = structuredClone(state);
  assert.throws(
    () =>
      act(state, "updateDriver", {
        driverId,
        name: "Old form",
        expectedDriver,
      }),
    errorCode("driverChanged", 409),
  );
  assert.deepEqual(state, edited);
});

test("driver validation accepts expired licenses, rejects invalid dates and reserves normalized license numbers", () => {
  assert.equal(driverLicenseKey(" mh-01 / 2020.1234567 "), "MH0120201234567");
  let state = act(
    emptyState(),
    "addDriver",
    profile({ licenseExpiry: "2020-02-29" }),
  );
  assert.equal(state.drivers[0].active, true);
  assert.equal(
    licenseStatus(state.drivers[0], state, "2026-11-24").status,
    "expired",
  );
  for (const [patch, code] of [
    [{ dob: "2026-11-25" }, "invalidDriverDob"],
    [{ dob: "1985-02-30" }, "invalidDriverDob"],
    [{ licenseExpiry: "2026-02-30" }, "invalidLicenseExpiry"],
    [{ licenseExpiry: "1980-01-01" }, "invalidLicenseExpiry"],
    [{ licenseNo: "" }, "licenseRequired"],
    [{ licenseNo: "??" }, "invalidLicenseNo"],
    [{ active: null }, "invalidDriverActive"],
  ])
    assert.equal(
      normalizeDriver(profile(patch), { today: "2026-11-24" }).error,
      code,
    );
  assert.throws(
    () =>
      act(
        state,
        "addDriver",
        profile({ name: "Another person", licenseNo: "mh0120201234567" }),
      ),
    /duplicateLicense/,
  );
  state = act(state, "updateDriver", {
    driverId: state.drivers[0].id,
    active: false,
  });
  assert.equal(activeDrivers(state).length, 0);
  assert.throws(() => act(state, "addDriver", profile()), /duplicateLicense/);
});

test("driver IDs distinguish equal names, validate assignments, and preserve legacy free-name clients", () => {
  let state = act(emptyState(), "addDriver", profile());
  state = act(state, "addDriver", profile({ licenseNo: "MH-02 2020 1234567" }));
  const [first, second] = state.drivers;
  state = act(
    state,
    "addVehicle",
    vehicle({ driverId: first.id, driverName: "Untrusted name" }),
  );
  const vehicleId = state.vehicles[0].id;
  assert.equal(state.vehicles[0].driverName, first.name);
  state = act(state, "changeDriver", { vehicleId, driverId: second.id });
  assert.equal(state.vehicles[0].driverId, second.id);
  assert.equal(state.events.at(-1).fromDriverId, first.id);
  assert.equal(state.vehicles[0].pendingTyreCheck, true);
  assert.throws(
    () => act(state, "changeDriver", { vehicleId, driverId: "missing" }),
    /driverMissing/,
  );
  state = act(state, "updateDriver", { driverId: first.id, active: false });
  assert.throws(
    () => act(state, "changeDriver", { vehicleId, driverId: first.id }),
    /driverInactive/,
  );
  assert.throws(
    () =>
      act(
        state,
        "addVehicle",
        vehicle({ registration: "MH02A1234", driverId: first.id }),
      ),
    /driverInactive/,
  );
  state = act(state, "changeDriver", {
    vehicleId,
    driverName: "Legacy driver",
  });
  assert.equal(state.vehicles[0].driverId, null);
  assert.equal(state.vehicles[0].driverName, "Legacy driver");
  assert.equal(state.drivers.length, 2);
});

test("profile name edits refresh active assignment labels without changing past or archived snapshots", () => {
  let state = act(emptyState(), "addDriver", profile());
  const driverId = state.drivers[0].id;
  state = act(state, "addVehicle", vehicle({ driverId }));
  state = act(
    state,
    "addVehicle",
    vehicle({ registration: "MH02A1234", driverId }),
  );
  state = act(state, "sellVehicle", {
    vehicleId: state.vehicles[1].id,
    odometer: 100,
  });
  const history = structuredClone(state.events);
  state = act(state, "updateDriver", { driverId, name: "राम कुमार शर्मा" });
  assert.equal(state.vehicles[0].driverName, "राम कुमार शर्मा");
  assert.equal(state.vehicles[1].driverName, "राम कुमार");
  assert.equal(state.vehicles[0].pendingTyreCheck, undefined);
  assert.deepEqual(state.events.slice(0, -1), history);
  assert.equal(state.events.at(-1).before.name, "राम कुमार");
  assert.equal(state.events.at(-1).after.name, "राम कुमार शर्मा");
});

test("reminder settings accept bounded day/week/month intervals and zero only for driver changes", () => {
  let state = emptyState();
  state = act(state, "updateReminderSettings", {
    settings: {
      nsd: { value: "3", unit: "weeks" },
      driverChange: { value: 0, unit: "months" },
    },
  });
  assert.equal(state.reminderSettings.nsd.value, 3);
  assert.deepEqual(state.reminderSettings.inspection, {
    value: 2,
    unit: "months",
  });
  for (const setting of [
    { value: 0, unit: "days" },
    { value: -1, unit: "weeks" },
    { value: 1.5, unit: "months" },
    { value: true, unit: "days" },
    { value: 3651, unit: "days" },
    { value: 521, unit: "weeks" },
    { value: 121, unit: "months" },
    { value: 2, unit: "years" },
  ])
    assert.throws(
      () =>
        act(state, "updateReminderSettings", { settings: { nsd: setting } }),
      /invalidReminderSettings/,
    );
  assert.throws(
    () =>
      act(state, "updateReminderSettings", {
        settings: { unexpected: { value: 1, unit: "days" } },
      }),
    /invalidReminderSettings/,
  );
  assert.throws(
    () => act(state, "updateReminderSettings", { settings: {} }),
    /invalidReminderSettings/,
  );
  assert.deepEqual(
    addReminderInterval("2028-01-31", { value: 1, unit: "months" }),
    "2028-02-29",
  );
  assert.equal(normalizeReminderSettings({}).error, "invalidReminderSettings");
});

test("NSD setting changes use original readings/first-fit anchors across refits and backdated entries", () => {
  let state = fitted("2027-01-31");
  const tyreId = state.tyres[0].id,
    vehicleId = state.vehicles[0].id;
  assert.equal(nsdDueOn(state.tyres[0], state), "2027-03-31");
  state = act(
    state,
    "updateReminderSettings",
    { settings: { nsd: { value: 1, unit: "months" } } },
    "2027-02-01",
  );
  assert.equal(state.tyres[0].nextNsdCheckOn, "2027-02-28");
  state = act(state, "remove", { tyreId, odometer: 150 }, "2027-02-05");
  state = act(
    state,
    "fit",
    { tyreId, vehicleId, slot: "FR", odometer: 150 },
    "2027-02-10",
  );
  assert.equal(nsdDueOn(state.tyres[0], state), "2027-02-28");
  state = act(
    state,
    "measureNsd",
    { tyreId, measuredOn: "2027-02-20", nsd: { averagePercent: 80 } },
    "2027-02-20",
  );
  state = act(
    state,
    "measureNsd",
    { tyreId, measuredOn: "2027-02-10", nsd: { averagePercent: 60 } },
    "2027-02-21",
  );
  assert.equal(state.tyres[0].lastNsdOn, "2027-02-20");
  assert.equal(state.tyres[0].nsd.averagePercent, 80);
  assert.equal(nsdDueOn(state.tyres[0], state), "2027-03-20");
  const dates = state.events
    .filter((event) => event.measuredOn)
    .map((event) => event.measuredOn);
  state = act(
    state,
    "updateReminderSettings",
    { settings: { nsd: { value: 7, unit: "days" } } },
    "2027-02-21",
  );
  assert.equal(nsdDueOn(state.tyres[0], state), "2027-02-27");
  assert.deepEqual(
    state.events
      .filter((event) => event.measuredOn)
      .map((event) => event.measuredOn),
    dates,
  );
});

test("a remold resets tread/first-fit anchors and does not revive prior same-day measurements", () => {
  let state = fitted("2027-01-31");
  const tyreId = state.tyres[0].id,
    vehicleId = state.vehicles[0].id;
  state = act(
    state,
    "measureNsd",
    { tyreId, measuredOn: "2027-02-25", nsd: { averagePercent: 35 } },
    "2027-02-25",
  );
  state = act(
    state,
    "remove",
    { tyreId, odometer: 200, destination: "remolding", vendor: "Sharvayu" },
    "2027-02-25",
  );
  state = act(
    state,
    "remold",
    { tyreId, invoiceNo: "RM1", amount: "100" },
    "2027-02-25",
  );
  assert.equal(state.tyres[0].nsd.averagePercent, 100);
  assert.equal(state.tyres[0].lastNsdOn, null);
  assert.equal(state.tyres[0].nsdFirstFittedOn, null);
  state = act(
    state,
    "fit",
    { tyreId, vehicleId, slot: "FL", odometer: 200 },
    "2027-03-05",
  );
  assert.equal(nsdDueOn(state.tyres[0], state), "2027-05-05");
});

test("inspection and driver-change reminders recalculate without postponing performed dates or enforcing checks", () => {
  let state = act(
    emptyState(),
    "addVehicle",
    vehicle({ driverName: "Old driver" }),
    "2027-01-31",
  );
  const vehicleId = state.vehicles[0].id;
  assert.equal(inspectionDueOn(state.vehicles[0], state), "2027-03-31");
  state = act(
    state,
    "changeDriver",
    { vehicleId, driverName: "New driver" },
    "2027-01-31",
  );
  assert.equal(driverCheckDueOn(state.vehicles[0], state), "2027-01-31");
  state = act(
    state,
    "updateReminderSettings",
    { settings: { driverChange: { value: 2, unit: "weeks" } } },
    "2027-02-01",
  );
  assert.equal(driverCheckDueOn(state.vehicles[0], state), "2027-02-14");
  state = act(
    state,
    "updateOdometer",
    { vehicleId, odometer: 200 },
    "2027-02-02",
  );
  const driverChangeId = state.vehicles[0].driverChangeId;
  state = act(
    state,
    "inspectVehicle",
    {
      vehicleId,
      inspectedOn: "2027-02-28",
      allTyresChecked: true,
      driverChangeId,
    },
    "2027-02-28",
  );
  assert.equal(driverCheckDueOn(state.vehicles[0], state), null);
  state = act(
    state,
    "inspectVehicle",
    {
      vehicleId,
      inspectedOn: "2027-01-20",
      allTyresChecked: false,
      note: "Old paper check",
    },
    "2027-03-01",
  );
  assert.equal(state.vehicles[0].lastInspectedOn, "2027-02-28");
  state = act(
    state,
    "updateReminderSettings",
    { settings: { inspection: { value: 2, unit: "weeks" } } },
    "2027-03-01",
  );
  assert.equal(inspectionDueOn(state.vehicles[0], state), "2027-03-14");
  assert.equal(state.vehicles[0].lastInspectedOn, "2027-02-28");
});

test("license due windows subtract calendar months and retain exact expiry boundaries", () => {
  const state = emptyState(),
    driver = profile({ licenseExpiry: "2027-03-31" });
  assert.deepEqual(licenseStatus(driver, state, "2027-02-27"), {
    status: "valid",
    dueOn: "2027-02-28",
    expiryOn: "2027-03-31",
    daysRemaining: 32,
  });
  assert.equal(licenseStatus(driver, state, "2027-02-28").status, "due");
  assert.equal(licenseStatus(driver, state, "2027-03-31").daysRemaining, 0);
  assert.equal(licenseStatus(driver, state, "2027-03-31").status, "due");
  assert.equal(licenseStatus(driver, state, "2027-04-01").status, "expired");
  assert.equal(
    licenseStatus({ ...driver, licenseExpiry: "invalid" }, state, "2027-04-01")
      .status,
    "unknown",
  );
});

test("malformed or orphaned ledger entries fail closed instead of being dropped by a later write", () => {
  const state = fitted(),
    cost = state.costs[0];
  for (const replacement of [
    null,
    {},
    [{ ...cost, amountPaise: "100" }],
    [{ ...cost, amountPaise: -1 }],
    [{ ...cost, amountPaise: MAX_AMOUNT_PAISE + 1 }],
    [{ ...cost, eventId: "missing" }],
    [{ ...cost, tyreId: "missing" }],
    [{ ...cost, date: "2026-02-30" }],
    [{ ...cost, invoiceNo: " " }],
    [{ ...cost, actor: "wrong-person" }],
    [cost, { ...cost }],
  ]) {
    const invalid = { ...state, costs: replacement },
      saved = structuredClone(invalid);
    assert.equal(validateManagementState(invalid).error, "invalidCostData");
    assert.throws(
      () =>
        act(invalid, "updateOdometer", {
          vehicleId: state.vehicles[0].id,
          odometer: 200,
        }),
      /invalidCostData/,
    );
    assert.deepEqual(invalid, saved);
  }
});

test("old unpriced history remains unknown and nested inspection history still follows renamed tyre IDs", () => {
  let state = fitted();
  const tyreId = state.tyres[0].id,
    vehicleId = state.vehicles[0].id;
  state = act(state, "inspectVehicle", {
    vehicleId,
    inspectedOn: "2026-11-24",
    allTyresChecked: true,
  });
  const inspection = state.events.at(-1);
  state = act(state, "updateTyre", { tyreId, serial: "NEW-NUMBER" });
  assert.equal(tyreMatchesEvent(state.tyres[0], inspection), true);
  assert.equal(
    tyreMatchesEvent(state.tyres[0], { tyreId: "another", tyre: "TYRE-A" }),
    false,
  );
  const legacy = structuredClone(state);
  delete legacy.costs;
  delete legacy.drivers;
  delete legacy.reminderSettings;
  const history = structuredClone(legacy.events);
  const updated = act(legacy, "updateOdometer", { vehicleId, odometer: 150 });
  assert.deepEqual(updated.costs, []);
  assert.deepEqual(updated.events.slice(0, -1), history);
  assert.equal(updated.tyres[0].invoiceNo, undefined);
});
