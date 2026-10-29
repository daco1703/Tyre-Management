import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  applyAction,
  emptyState,
  tally,
  activeVehicles,
  numberedSlots,
} from "../shared/model.js";
import { reportFor } from "../shared/reports.js";
import { manufacturers, manufacturerFor } from "../shared/catalogue.js";
const run = (s, kind, payload) =>
  applyAction(
    s,
    { kind, payload },
    "admin",
    new Date("2026-10-29T10:00:00+05:30"),
  );
function fixture() {
  let s = run(emptyState(), "addVehicle", {
    registration: "MH01AA1234",
    odometer: 1000,
    hasSpare: true,
  });
  s = run(s, "addVehicle", {
    registration: "MH01AA2345",
    odometer: 0,
    hasSpare: false,
  });
  const vehicleId = s.vehicles[0].id;
  for (let i = 0; i < 21; i++)
    s = run(s, "addTyre", {
      serial: `SALE-${i}`,
      brand: i % 2 ? "Apollo" : "MRF",
      construction: "radial",
      type: "used",
      distance: 100,
    });
  for (const [i, slot] of [...numberedSlots, "SP"].entries())
    s = run(s, "fit", {
      vehicleId,
      tyreId: s.tyres[i].id,
      slot,
      odometer: 1000,
    });
  s = run(s, "changeDriver", { vehicleId, driverName: "Ram" });
  return { s, vehicleId };
}
test("manufacturer dropdown contains exactly the seven requested brands and keeps custom legacy names intact", () => {
  assert.deepEqual(
    manufacturers.map((m) => m.name),
    ["MRF", "Apollo", "CEAT", "JK Tyre", "Bridgestone", "Michelin", "Goodyear"],
  );
  assert.equal(manufacturerFor("MRF Steel Muscle").name, "MRF");
  assert.equal(manufacturerFor("Some local brand"), undefined);
  const s = run(emptyState(), "addTyre", {
    serial: "CUSTOM",
    brand: "Some local brand",
    construction: "horse",
    type: "used",
  });
  assert.equal(s.tyres[0].brand, "Some local brand");
});
test("vehicle sale atomically archives vehicle and all 18 tyres plus spare, preserves history and garage stock, and closes km", () => {
  const { s, vehicleId } = fixture(),
    before = structuredClone(s);
  const snapshot = s.tyres
    .filter((t) => t.vehicleId === vehicleId)
    .map((t) => ({ tyreId: t.id, slot: t.slot }));
  const sold = run(s, "sellVehicle", {
    vehicleId,
    odometer: 1500,
    note: "Buyer invoice 40",
    fitmentSnapshot: snapshot,
  });
  assert.deepEqual(s, before);
  assert.equal(activeVehicles(sold).length, 1);
  assert.equal(sold.vehicles[0].status, "sold");
  assert.equal(sold.vehicles[0].pendingTyreCheck, false);
  assert.equal(tally(sold).sold, 19);
  assert.equal(tally(sold).stock, 2);
  assert.equal(tally(sold).installed, 0);
  assert.equal(tally(sold).total, 2);
  assert.equal(sold.tyres[0].distance, 600);
  assert.equal(sold.tyres[18].distance, 100);
  assert.equal(sold.tyres[0].soldWithVehicleId, vehicleId);
  assert.equal(sold.tyres[0].soldVehicle, "MH01AA1234");
  assert.equal(sold.tyres[0].vehicleId, null);
  assert.equal(sold.tyres[0].slot, null);
  const sales = sold.events.filter((e) => e.kind === "sell");
  assert.equal(sales.length, 19);
  assert.ok(
    sales.every(
      (e) =>
        e.actor === "admin" &&
        e.vehicleSaleId === sold.vehicles[0].vehicleSaleId,
    ),
  );
  assert.equal(sales.find((e) => e.slot === "SP").runningKm, 0);
  assert.equal(sales[0].runningKm, 500);
  assert.equal(sales[0].fittedOdometer, 1000);
  assert.equal(sold.events.at(-1).kind, "sellVehicle");
  assert.equal(sold.events.at(-1).tyreCount, 19);
  assert.deepEqual(
    sold.events.at(-1).soldTyres.map((t) => t.slot),
    snapshot.map((t) => t.slot),
  );
  assert.deepEqual(sold.events.slice(0, s.events.length), s.events);
  assert.equal(sold.revision, s.revision + 1);
  const report = reportFor(sold, {
    from: "2026-10-01",
    to: "2026-10-31",
    vehicleId,
  });
  assert.equal(report.totals.vehicleSales, 1);
  assert.equal(report.totals.tyreKm, 9000);
  assert.throws(
    () => run(sold, "sellVehicle", { vehicleId, odometer: 1600 }),
    /vehicleAlreadySold/,
  );
  assert.throws(
    () =>
      run(sold, "fit", {
        vehicleId,
        tyreId: sold.tyres[20].id,
        slot: "FR",
        odometer: 1500,
      }),
    /vehicleAlreadySold/,
  );
  assert.throws(
    () => run(sold, "updateOdometer", { vehicleId, odometer: 1600 }),
    /vehicleAlreadySold/,
  );
  assert.throws(
    () => run(sold, "changeDriver", { vehicleId, driverName: "Other" }),
    /vehicleAlreadySold/,
  );
  assert.throws(
    () =>
      run(sold, "inspectVehicle", {
        vehicleId,
        inspectedOn: "2026-10-29",
        allTyresChecked: true,
      }),
    /vehicleAlreadySold/,
  );
});
test("vehicle sale rejects backwards odometers and changed fitments without partial sales or log entries", () => {
  const { s, vehicleId } = fixture(),
    before = structuredClone(s);
  assert.throws(
    () => run(s, "sellVehicle", { vehicleId, odometer: 999 }),
    /odometerBackwards/,
  );
  for (const fitmentSnapshot of [
    [],
    null,
    [null],
    [{ tyreId: "wrong", slot: "FR" }],
  ])
    assert.throws(
      () =>
        run(s, "sellVehicle", { vehicleId, odometer: 1800, fitmentSnapshot }),
      /saleTyresChanged/,
    );
  assert.deepEqual(s, before);
});
test("empty vehicle sale keeps all garage tyres active", () => {
  let s = run(emptyState(), "addVehicle", {
    registration: "MH01AA1234",
    hasSpare: false,
    odometer: 0,
  });
  s = run(s, "addTyre", { serial: "STOCK", brand: "MRF", type: "new" });
  s = run(s, "sellVehicle", {
    vehicleId: s.vehicles[0].id,
    odometer: 0,
    fitmentSnapshot: [],
  });
  assert.equal(tally(s).stock, 1);
  assert.equal(tally(s).sold, 0);
  assert.equal(activeVehicles(s).length, 0);
  assert.equal(s.events.at(-1).tyreCount, 0);
});

test("all seven bundled logos match the supplied source files without redrawing or recompression", () => {
  const sources = JSON.parse(
    readFileSync(
      new URL("../public/brands/sources.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(sources.length, 7);
  for (const make of manufacturers) {
    const file = make.logo.split("/").at(-1),
      source = sources.find((s) => s.file === file);
    assert.ok(source, make.name);
    const bytes = readFileSync(
      new URL(`../public${make.logo}`, import.meta.url),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      source.sha256,
      make.name,
    );
  }
});
