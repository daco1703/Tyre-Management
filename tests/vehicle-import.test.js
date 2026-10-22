import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeVehicle,
  previewVehicleImport,
  validateVehicleBatch,
  VEHICLE_HEADERS,
  MAX_IMPORT_ROWS,
} from "../shared/vehicle-import.js";
import { applyAction, emptyState } from "../shared/model.js";
const vehicle = (registration, extra = {}) => ({
  registration,
  name: "",
  odometer: 0,
  hasSpare: false,
  ...extra,
});
test("Excel headers allow reordered English/Hindi fields, blank rows and optional defaults", () => {
  const p = previewVehicleImport([
    [],
    ["स्पेयर", "वाहन नंबर", "ड्राइवर", "ओडोमीटर (किमी)"],
    ["हाँ", "rj 14 ab 1234", "राम", "1,20,000"],
    [],
    ["नहीं", "HR55AB1234"],
  ]);
  assert.equal(p.error, undefined);
  assert.deepEqual(
    p.rows.map((r) => r.number),
    [3, 5],
  );
  assert.deepEqual(
    p.rows[0].value,
    vehicle("RJ14AB1234", { name: "राम", odometer: 120000, hasSpare: true }),
  );
  assert.equal(p.rows[1].value.odometer, 0);
  assert.equal(p.rows[1].value.hasSpare, false);
});
test("preview distinguishes existing duplicates, file duplicates and invalid rows", () => {
  const p = previewVehicleImport(
    [
      VEHICLE_HEADERS,
      ["rj 14 a 1", "", 0, "Yes"],
      ["HR55A1", "", 0, "No"],
      ["hr55a1", "", 0, "No"],
      ["HR55A2", "", -1, "Maybe"],
    ],
    [vehicle("RJ14A1")],
  );
  assert.deepEqual(p.rows[0].errors, ["duplicateVehicle"]);
  assert.deepEqual(p.rows[1].errors, []);
  assert.deepEqual(p.rows[2].errors, ["duplicateVehicle"]);
  assert.deepEqual(p.rows[3].errors, ["invalidKm", "importSpareInvalid"]);
});
test("registration must be text and does not silently truncate invalid names or IDs", () => {
  for (const registration of [1234, true, "", "A".repeat(31), "RJ14/A1", "---"])
    assert.ok(
      normalizeVehicle(vehicle(registration)).errors.includes(
        "importRegistrationInvalid",
      ),
    );
  for (const name of [new Date(), "A".repeat(101), 12])
    assert.ok(
      normalizeVehicle(vehicle("RJ14A1", { name })).errors.includes(
        "importNameInvalid",
      ),
    );
});
test("import duplicate checks ignore registration case, spaces and hyphens", () => {
  const preview = previewVehicleImport(
    [VEHICLE_HEADERS, ["rj-14 ab 1234"], ["HR55AB1234"], ["HR-55-AB-1234"]],
    [vehicle("RJ14AB1234")],
  );
  assert.deepEqual(
    preview.rows.map((r) => r.errors),
    [["duplicateVehicle"], [], ["duplicateVehicle"]],
  );
  assert.equal(
    validateVehicleBatch([vehicle("RJ14AB1234")], [vehicle("RJ-14-AB-1234")])
      .error,
    "duplicateVehicle",
  );
});
test("kilometres accept whole readings and proper Indian/Western grouping only", () => {
  for (const [value, result] of [
    [120000, 120000],
    ["120,000", 120000],
    ["1,20,000", 120000],
    ["0", 0],
    [null, 0],
  ])
    assert.equal(
      normalizeVehicle(vehicle("A1", { odometer: value })).value.odometer,
      result,
    );
  for (const value of ["12,3", "2e3", 1.1, -1, true, new Date(), 100000000])
    assert.ok(
      normalizeVehicle(vehicle("A1", { odometer: value })).errors.includes(
        "invalidKm",
      ),
    );
});
test("spare values support booleans, yes/no, Hindi and numeric flags", () => {
  for (const value of [true, " YES ", "हाँ", 1, "true"])
    assert.equal(
      normalizeVehicle(vehicle("A1", { hasSpare: value })).value.hasSpare,
      true,
    );
  for (const value of [false, "No", "नहीं", 0, "false", null])
    assert.equal(
      normalizeVehicle(vehicle("A1", { hasSpare: value })).value.hasSpare,
      false,
    );
  assert.ok(
    normalizeVehicle(vehicle("A1", { hasSpare: "sometimes" })).errors.includes(
      "importSpareInvalid",
    ),
  );
});
test("header and row limits give useful errors without silently ignoring data", () => {
  assert.equal(previewVehicleImport([]).error, "importEmpty");
  assert.equal(previewVehicleImport([VEHICLE_HEADERS]).error, "importEmpty");
  assert.equal(
    previewVehicleImport([["Driver"], ["Ram"]]).error,
    "importMissingHeader",
  );
  assert.equal(
    previewVehicleImport([
      ["Registration", "Vehicle No"],
      ["A1", "B1"],
    ]).error,
    "importDuplicateHeader",
  );
  assert.equal(
    previewVehicleImport([
      VEHICLE_HEADERS,
      ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ["V" + i]),
    ]).error,
    "importTooMany",
  );
});
test("valid imported vehicles get separate log entries, positions and shared timestamp", () => {
  const prior = applyAction(
    emptyState(),
    { kind: "addVehicle", payload: vehicle("OLD1") },
    "owner",
  );
  const before = structuredClone(prior);
  const date = new Date("2026-10-22T10:00:00Z");
  const s = applyAction(
    prior,
    {
      kind: "importVehicles",
      payload: {
        vehicles: [
          vehicle("NEW1", { hasSpare: true }),
          vehicle("NEW2", { odometer: 500 }),
        ],
      },
    },
    "staff",
    date,
  );
  assert.deepEqual(prior, before);
  assert.equal(s.vehicles.length, 3);
  assert.deepEqual(s.vehicles[0], prior.vehicles[0]);
  assert.equal(s.revision, 3);
  assert.equal(s.events.at(-1).kind, "addVehicle");
  assert.equal(s.events.at(-1).actor, "staff");
  assert.equal(s.events.at(-1).timestamp, date.toISOString());
  assert.equal(s.events.at(-1).note, "Excel import");
  assert.equal(s.vehicles[1].hasSpare, true);
  assert.equal(s.vehicles[2].odometer, 500);
});
test("invalid, duplicate and oversized batches fail before any vehicles are added", () => {
  const s = emptyState();
  for (const vehicles of [
    [],
    null,
    {},
    [vehicle("A1"), vehicle("A1")],
    [vehicle("A1"), vehicle("A2", { odometer: -1 })],
    Array.from({ length: 201 }, (_, i) => vehicle("V" + i)),
  ])
    assert.throws(() =>
      applyAction(
        s,
        { kind: "importVehicles", payload: { vehicles } },
        "owner",
      ),
    );
  assert.equal(s.vehicles.length, 0);
  assert.equal(s.events.length, 0);
  assert.equal(s.revision, 0);
  assert.equal(
    validateVehicleBatch([vehicle("A1")], [vehicle("A1")]).error,
    "duplicateVehicle",
  );
});
