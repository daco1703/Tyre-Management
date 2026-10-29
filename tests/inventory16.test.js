import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, emptyState, tally, dailyTally } from "../shared/model.js";
import { averageNsd } from "../shared/nsd.js";
import {
  previewTyreImport,
  validateTyreBatch,
  TYRE_HEADERS,
  MAX_TYRE_IMPORT_ROWS,
} from "../shared/tyre-import.js";
const run = (s, kind, payload, day = "2026-10-29") =>
  applyAction(
    s,
    { kind, payload },
    "operator",
    new Date(day + "T10:00:00+05:30"),
  );
const tyre = (serial = "0001", type = "new") => ({
  serial,
  brand: "MRF",
  type,
  construction: "radial",
});
test("tyre Excel preview preserves leading zeros, defaults, duplicates and Hindi headers", () => {
  const p = previewTyreImport([
    TYRE_HEADERS,
    ["0001", "MRF"],
    ["0001", "Apollo"],
    ["used-2", "Apollo", "Used", "Horse", "1,20,000"],
    [12, "CEAT"],
    ["bad", "MRF", "Invalid"],
  ]);
  assert.deepEqual(p.rows[0].value, { ...tyre(), distance: 0 });
  assert.deepEqual(p.rows[0].errors, []);
  assert.deepEqual(p.rows[1].errors, ["duplicateTyre"]);
  assert.equal(p.rows[2].value.distance, 120000);
  assert.equal(p.rows[2].value.construction, "horse");
  assert.ok(p.rows[3].errors.includes("importTyreIdInvalid"));
  assert.ok(p.rows[4].errors.includes("invalidType"));
  assert.equal(
    previewTyreImport([
      ["टायर आईडी", "निर्माता", "स्थिति", "टायर का प्रकार"],
      ["T-1", "MRF", "पुराना", "Horse"],
    ]).rows[0].value.type,
    "used",
  );
  assert.equal(
    previewTyreImport([["Manufacturer"], ["MRF"]]).error,
    "importTyreMissingHeader",
  );
  assert.equal(
    previewTyreImport([
      ["Tyre ID", "Serial", "Manufacturer"],
      ["1", "1", "MRF"],
    ]).error,
    "importDuplicateHeader",
  );
  assert.equal(
    previewTyreImport([
      TYRE_HEADERS,
      ...Array.from({ length: MAX_TYRE_IMPORT_ROWS + 1 }, () => ["a", "MRF"]),
    ]).error,
    "importTooMany",
  );
});
test("tyre import validates the entire batch before saving and records separate attributed receipts", () => {
  const s = emptyState();
  const batch = [tyre(), tyre("0002", "remold"), tyre("0003", "used")];
  const next = run(s, "importTyres", { tyres: batch });
  assert.equal(s.tyres.length, 0);
  assert.equal(next.revision, 3);
  assert.equal(next.events.length, 3);
  assert.ok(
    next.events.every(
      (e) => e.actor === "operator" && e.note === "Excel import",
    ),
  );
  assert.equal(tally(next).stock, 3);
  assert.equal(next.tyres[0].nsd.averagePercent, 100);
  assert.equal(next.tyres[1].nsd.averagePercent, 100);
  assert.equal(next.tyres[2].nsd, undefined);
  assert.equal(
    validateTyreBatch([tyre("0001")], next.tyres).error,
    "duplicateTyre",
  );
  const copy = structuredClone(next);
  assert.throws(
    () =>
      run(next, "importTyres", {
        tyres: [tyre("0004"), { ...tyre("0005"), distance: -1 }],
      }),
    /importInvalidBatch/,
  );
  assert.deepEqual(next, copy);
});
test("one average NSD is fitted-only, accepts zero and retread completion resets tread without deleting history or km", () => {
  let s = run(emptyState(), "addVehicle", {
    registration: "MH01AA1234",
    hasSpare: false,
    odometer: 100,
  });
  s = run(s, "addTyre", tyre());
  const v = s.vehicles[0].id,
    id = s.tyres[0].id;
  assert.equal(s.tyres[0].nsd.averagePercent, 100);
  assert.throws(
    () =>
      run(s, "measureNsd", {
        tyreId: id,
        measuredOn: "2026-10-29",
        nsd: { averagePercent: 50 },
      }),
    /nsdOnlyFitted/,
  );
  s = run(s, "fit", { tyreId: id, vehicleId: v, slot: "FR", odometer: 100 });
  s = run(s, "measureNsd", {
    tyreId: id,
    measuredOn: "2026-10-29",
    nsd: { averagePercent: 0 },
  });
  assert.equal(s.tyres[0].nsd.averagePercent, 0);
  assert.equal(s.tyres[0].nextNsdCheckOn, "2026-12-29");
  s = run(s, "remove", {
    tyreId: id,
    odometer: 200,
    destination: "remolding",
    vendor: "Sharvayu",
  });
  s = run(s, "remold", { tyreId: id, vendor: "Sharvayu" });
  assert.equal(s.tyres[0].nsd.averagePercent, 100);
  assert.equal(s.tyres[0].distance, 100);
  assert.equal(
    s.events.find((e) => e.kind === "measureNsd").nsdMeasurements[0]
      .averagePercent,
    0,
  );
  assert.throws(
    () =>
      run(s, "measureNsd", {
        tyreId: id,
        measuredOn: "2026-10-29",
        nsd: { averagePercent: 90 },
      }),
    /nsdOnlyFitted/,
  );
});
test("legacy NSD averages are calculated without changing original history", () => {
  const old = { inner: 80, center: 70, outer: 60, minimumPercent: 60 };
  assert.equal(averageNsd(old), 70);
  assert.equal(old.minimumPercent, 60);
  assert.equal(averageNsd({ inner: 0, outer: 100 }), 50);
  assert.equal(averageNsd({ averagePercent: 0 }), 0);
  assert.equal(averageNsd(null), null);
});
test("sale removes active stock, preserves full data and actor, supports scrap sale and rejects double sale or fitted sale", () => {
  let s = run(emptyState(), "addTyre", { ...tyre(), distance: 900 });
  const id = s.tyres[0].id;
  const original = structuredClone(s.tyres[0]);
  s = run(s, "sell", { tyreId: id, note: "Buyer invoice 123" });
  assert.equal(tally(s).total, 0);
  assert.equal(tally(s).stock, 0);
  assert.equal(tally(s).sold, 1);
  assert.equal(s.tyres[0].distance, original.distance);
  assert.equal(s.tyres[0].brand, "MRF");
  assert.equal(s.tyres[0].saleNote, "Buyer invoice 123");
  assert.equal(s.events.at(-1).actor, "operator");
  assert.equal(s.events.at(-1).totalKm, 900);
  assert.equal(dailyTally(s, "2026-10-29").sold, 1);
  const copy = structuredClone(s);
  assert.throws(() => run(s, "sell", { tyreId: id }), /sellStockOnly/);
  assert.deepEqual(s, copy);
  assert.throws(
    () => run(s, "importTyres", { tyres: [tyre()] }),
    /duplicateTyre/,
  );
  s = run(s, "addTyre", tyre("SCRAP"));
  const scrap = s.tyres[1].id;
  s = run(s, "scrap", { tyreId: scrap, scrapReason: "burst" });
  s = run(s, "sell", { tyreId: scrap });
  assert.equal(s.tyres[1].scrapReason, "burst");
  assert.equal(s.tyres[1].soldFrom, "scrapped");
  assert.equal(tally(s).sold, 2);
  s = run(s, "addVehicle", {
    registration: "MH01AA1234",
    hasSpare: false,
    odometer: 0,
  });
  s = run(s, "addTyre", tyre("FIT"));
  const fitted = s.tyres[2].id;
  s = run(s, "fit", {
    tyreId: fitted,
    vehicleId: s.vehicles[0].id,
    slot: "FR",
    odometer: 0,
  });
  assert.throws(() => run(s, "sell", { tyreId: fitted }), /sellStockOnly/);
  assert.equal(
    tally(s).total,
    tally(s).stock + tally(s).installed + tally(s).remolding,
  );
});

test("full 200-tyre import keeps per-row tally and revision correct", () => {
  const tyres = Array.from({ length: MAX_TYRE_IMPORT_ROWS }, (_, i) =>
    tyre(`BATCH-${i}`),
  );
  const next = run(emptyState(), "importTyres", { tyres });
  assert.equal(next.revision, 200);
  assert.equal(next.tyres.length, 200);
  assert.equal(next.events[0].tally.stock, 1);
  assert.equal(next.events.at(-1).tally.stock, 200);
});
