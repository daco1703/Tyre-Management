import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, emptyState } from "../shared/model.js";
import {
  displayDate,
  parseDisplayDate,
  addCalendarMonths,
} from "../shared/dates.js";
import { reportFor, presetRange, lastInspection } from "../shared/reports.js";
import {
  previewVehicleImport,
  VEHICLE_HEADERS,
} from "../shared/vehicle-import.js";
const run = (s, kind, payload, day = "2026-10-23", actor = "staff1") =>
  applyAction(s, { kind, payload }, actor, new Date(day + "T10:00:00+05:30"));
function fixture() {
  let s = run(emptyState(), "addVehicle", {
    registration: "MH01AA1234",
    emissionClass: "BS6",
    driverName: "Ram",
    hasSpare: false,
    odometer: 100,
  });
  s = run(s, "addTyre", {
    serial: "NSD-1",
    brand: "MRF",
    construction: "horse",
    type: "new",
  });
  const vehicleId = s.vehicles[0].id,
    tyreId = s.tyres[0].id;
  s = run(s, "fit", { vehicleId, tyreId, slot: "FR", odometer: 100 });
  return { s, vehicleId, tyreId };
}
test("display dates use dd/mm/yyyy, validate leap days and clamp two calendar months", () => {
  assert.equal(displayDate("2026-10-23"), "23/10/2026");
  assert.equal(displayDate("2026-10-22T18:30:00Z", true), "23/10/2026 00:00");
  assert.equal(parseDisplayDate("29/02/2024"), "2024-02-29");
  for (const bad of ["29/02/2026", "31/04/2026", "2/10/2026", "2026-10-23"])
    assert.equal(parseDisplayDate(bad), "");
  assert.equal(addCalendarMonths("2026-12-31", 2), "2027-02-28");
  assert.equal(addCalendarMonths("2023-12-31", 2), "2024-02-29");
});
test("NSD is entered directly as percentage; zero, partial readings and backdated history are preserved", () => {
  let { s, tyreId } = fixture();
  s = run(s, "measureNsd", {
    tyreId,
    measuredOn: "2026-08-31",
    nsd: { inner: 80, center: 70.5, outer: 0 },
  });
  assert.equal(s.tyres[0].nsd.minimumPercent, 0);
  assert.equal(s.tyres[0].nextNsdCheckOn, "2026-10-31");
  s = run(s, "measureNsd", {
    tyreId,
    measuredOn: "2026-08-30",
    nsd: { inner: 90 },
  });
  assert.equal(s.tyres[0].lastNsdOn, "2026-08-31");
  assert.equal(s.events.at(-1).nsdMeasurements[0].minimumPercent, 90);
  for (const invalid of [-1, 101, true, "1e1", "abc", {}, 1.123]) {
    const copy = structuredClone(s);
    assert.throws(
      () =>
        run(s, "measureNsd", {
          tyreId,
          measuredOn: "2026-10-23",
          nsd: { inner: invalid },
        }),
      /invalidNsd/,
    );
    assert.deepEqual(s, copy);
  }
  assert.throws(
    () =>
      run(s, "measureNsd", {
        tyreId,
        measuredOn: "2026-10-24",
        nsd: { inner: 80 },
      }),
    /invalidInspectionDate/,
  );
  assert.throws(
    () => run(s, "measureNsd", { tyreId, measuredOn: "2026-10-23", nsd: {} }),
    /nsdRequired/,
  );
});
test("driver check is advisory and only a matching inspection completes the current driver change", () => {
  let { s, vehicleId, tyreId } = fixture();
  s = run(s, "changeDriver", { vehicleId, driverName: "Shyam" });
  const first = s.vehicles[0].driverChangeId;
  s = run(s, "updateOdometer", { vehicleId, odometer: 200 });
  assert.equal(s.vehicles[0].pendingTyreCheck, true);
  s = run(s, "changeDriver", { vehicleId, driverName: "Mohan" });
  const current = s.vehicles[0].driverChangeId;
  const inspection = {
    vehicleId,
    inspectedOn: "2026-10-23",
    allTyresChecked: true,
    driverChangeId: first,
    findings: [],
    nsdMeasurements: [],
  };
  s = run(s, "inspectVehicle", inspection);
  assert.equal(s.events.at(-1).driverCheckCompleted, false);
  assert.equal(s.vehicles[0].pendingTyreCheck, true);
  s = run(s, "inspectVehicle", {
    ...inspection,
    driverChangeId: current,
    inspectedOn: "2026-10-22",
  });
  assert.equal(s.vehicles[0].pendingTyreCheck, true);
  s = run(s, "inspectVehicle", {
    ...inspection,
    driverChangeId: current,
    findings: [
      { slot: "FR", tyreId, issue: "misalignment", detail: "Workshop check" },
    ],
    nsdMeasurements: [{ slot: "FR", tyreId, inner: 75, center: 70, outer: 65 }],
  });
  assert.equal(s.vehicles[0].pendingTyreCheck, false);
  assert.equal(s.events.at(-1).actor, "staff1");
  assert.equal(s.events.at(-1).findings[0].tyre, "NSD-1");
  assert.equal(s.events.at(-1).driverCheckCompleted, true);
  assert.equal(s.tyres[0].nextNsdCheckOn, "2026-12-23");
  assert.equal(lastInspection(s, s.vehicles[0]).inspectedOn, "2026-10-23");
});
test("inspection rejects stale tyre assignments, bad dates, empty checks and missing Other details atomically", () => {
  const { s, vehicleId, tyreId } = fixture();
  const p = { vehicleId, inspectedOn: "2026-10-23", allTyresChecked: false };
  const invalid = [
    [{ ...p }, "inspectionRequired"],
    [
      { ...p, allTyresChecked: true, inspectedOn: "2026-02-30" },
      "invalidInspectionDate",
    ],
    [
      { ...p, allTyresChecked: true, fitmentSnapshot: [] },
      "inspectionTyreChanged",
    ],
    [
      { ...p, findings: [{ slot: "FR", issue: "other" }] },
      "inspectionDetailRequired",
    ],
    [
      {
        ...p,
        findings: [{ slot: "FR", issue: "misalignment", tyreId: "old" }],
      },
      "inspectionTyreChanged",
    ],
    [
      { ...p, nsdMeasurements: [{ slot: "FL", tyreId, inner: 50 }] },
      "inspectionTyreChanged",
    ],
    [
      {
        ...p,
        findings: [
          { slot: "FR", issue: "misalignment" },
          { slot: "FR", issue: "misalignment" },
        ],
      },
      "duplicateFinding",
    ],
  ];
  const before = structuredClone(s);
  for (const [payload, error] of invalid) {
    assert.throws(() => run(s, "inspectVehicle", payload), new RegExp(error));
    assert.deepEqual(s, before);
  }
});
test("remolding vendor snapshots survive multiple cycles and removal km are retained", () => {
  let { s, vehicleId, tyreId } = fixture();
  s = run(s, "remove", {
    tyreId,
    odometer: 200,
    destination: "remolding",
    vendor: "Sharvayu",
  });
  assert.equal(s.events.at(-1).vendor, "Sharvayu");
  assert.equal(s.events.at(-1).runningKm, 100);
  s = run(s, "remold", { tyreId, vendor: "Sharvayu" });
  assert.equal(s.tyres[0].lastRemoldVendor, "Sharvayu");
  assert.equal(s.tyres[0].status, "stock");
  s = run(s, "sendRemold", { tyreId, vendor: "Guardex MRF" });
  s = run(s, "remold", { tyreId, vendor: "Guardex MRF" });
  s = run(s, "sendRemold", {
    tyreId,
    vendor: "other",
    customVendor: " Custom Works ",
  });
  assert.equal(s.tyres[0].remoldVendor, "Custom Works");
  assert.equal(s.events.find((e) => e.kind === "remove").vendor, "Sharvayu");
  const copy = structuredClone(s);
  assert.throws(
    () => run(s, "remold", { tyreId, vendor: "other", customVendor: " " }),
    /vendorRequired/,
  );
  assert.deepEqual(s, copy);
  s = run(s, "remold", { tyreId }); // Older installed clients remain compatible.
  assert.equal(s.events.at(-1).vendor, "Custom Works");
});
test("reports filter performed inspection date, class and staff and distinguish fitments from inspections", () => {
  let { s, vehicleId, tyreId } = fixture();
  s = run(
    s,
    "inspectVehicle",
    {
      vehicleId,
      inspectedOn: "2026-09-30",
      allTyresChecked: true,
      nsdMeasurements: [{ tyreId, slot: "FR", inner: 80 }],
    },
    "2026-10-23",
    "staff2",
  );
  s = run(s, "remove", { tyreId, odometer: 250, destination: "stock" });
  const september = reportFor(s, {
    from: "2026-09-01",
    to: "2026-09-30",
    vehicleId,
    actor: "staff2",
  });
  assert.equal(september.totals.inspections, 1);
  assert.equal(september.totals.fitments, 0);
  assert.equal(september.totals.nsdChecks, 1);
  const october = reportFor(s, {
    from: "2026-10-01",
    to: "2026-10-31",
    emissionClass: "BS6",
  });
  assert.equal(october.totals.fitments, 1);
  assert.equal(october.totals.inspections, 0);
  assert.equal(october.totals.tyreKm, 150);
  assert.equal(
    reportFor(s, { from: "2026-10-31", to: "2026-10-01" }).error,
    "invalidDateRange",
  );
  assert.deepEqual(presetRange("lastMonth", "2026-01-10"), {
    from: "2025-12-01",
    to: "2025-12-31",
  });
  assert.deepEqual(presetRange("lastYear", "2026-10-23"), {
    from: "2025-01-01",
    to: "2025-12-31",
  });
});
test("Excel supports optional BS class and separate driver while retaining old four-column files", () => {
  const result = previewVehicleImport([
    VEHICLE_HEADERS,
    ["MH01AA1234", "Mumbai", 100, "Yes", "bs 6", "Ram"],
  ]);
  assert.deepEqual(result.rows[0].errors, []);
  assert.equal(result.rows[0].value.emissionClass, "BS6");
  assert.equal(result.rows[0].value.driverName, "Ram");
  const bad = previewVehicleImport([
    VEHICLE_HEADERS,
    ["MH01AA1234", "", 0, "No", "BS5"],
  ]);
  assert.ok(bad.rows[0].errors.includes("invalidVehicleClass"));
});
