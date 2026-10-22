import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyState,
  applyAction,
  tally,
  dailyTally,
  tyreKm,
  dayKey,
  slots,
  numberedSlots,
  positionLabel,
} from "../shared/model.js";
const at = (date) => new Date(date + "T10:00:00+05:30");
const run = (s, kind, payload, date = "2026-10-22") =>
  applyAction(s, { kind, payload }, "owner", at(date));
function fixture(spare = true) {
  let s = run(emptyState(), "addVehicle", {
    registration: "RJ 14 AB 1234",
    hasSpare: spare,
    odometer: 1000,
  });
  s = run(s, "addTyre", {
    serial: "T-1",
    brand: "MRF",
    size: "295/90 R20",
    type: "new",
  });
  s = run(s, "addTyre", {
    serial: "T-2",
    brand: "Apollo",
    size: "295/90 R20",
    type: "remold",
    distance: 400,
  });
  return s;
}
test("18 distinct road positions plus optional spare", () => {
  assert.equal(slots.length, 18);
  assert.equal(new Set(slots).size, 18);
  assert.ok(!slots.includes("SP"));
});
test("receipt, fit, odometer, return keep stock balanced and accrue distance", () => {
  let s = fixture();
  const v = s.vehicles[0],
    t = s.tyres[0];
  s = run(s, "fit", {
    tyreId: t.id,
    vehicleId: v.id,
    slot: "FL",
    odometer: 1000,
  });
  assert.equal(tally(s).stock, 1);
  assert.equal(tally(s).installed, 1);
  s = run(s, "updateOdometer", { vehicleId: v.id, odometer: 1300 });
  assert.equal(tyreKm(s.tyres[0], s), 300);
  s = run(s, "remove", { tyreId: t.id, odometer: 1400 });
  assert.equal(s.tyres[0].type, "used");
  assert.equal(s.tyres[0].distance, 400);
  assert.equal(s.tyres[0].vehicleId, null);
  assert.equal(tally(s).stock, 2);
  assert.equal(s.events.at(-1).actor, "owner");
  assert.equal(s.events.at(-1).slot, "FL");
  assert.equal(s.events.at(-1).odometer, 1400);
});
test("spare tyres accrue no driving distance", () => {
  let s = fixture();
  const p = {
    tyreId: s.tyres[1].id,
    vehicleId: s.vehicles[0].id,
    slot: "SP",
    odometer: 1000,
  };
  s = run(s, "fit", p);
  s = run(s, "updateOdometer", { vehicleId: p.vehicleId, odometer: 2000 });
  assert.equal(tyreKm(s.tyres[1], s), 400);
  s = run(s, "remove", { tyreId: p.tyreId, odometer: 2100 });
  assert.equal(s.tyres[1].distance, 400);
});
test("reject spare when vehicle has no spare position", () => {
  const s = fixture(false);
  assert.throws(
    () =>
      run(s, "fit", {
        tyreId: s.tyres[0].id,
        vehicleId: s.vehicles[0].id,
        slot: "SP",
        odometer: 1000,
      }),
    /invalidSlot/,
  );
});
test("reject double fitment and occupied positions without changing previous state", () => {
  let s = fixture();
  const p = {
    tyreId: s.tyres[0].id,
    vehicleId: s.vehicles[0].id,
    slot: "FL",
    odometer: 1000,
  };
  s = run(s, "fit", p);
  const copy = structuredClone(s);
  assert.throws(() => run(s, "fit", p), /notInStock/);
  assert.throws(
    () => run(s, "fit", { ...p, tyreId: s.tyres[1].id }),
    /slotOccupied/,
  );
  assert.deepEqual(s, copy);
});
test("remolding and scrapping are stock-only and preserve history", () => {
  let s = fixture();
  const tyreId = s.tyres[0].id;
  s = run(s, "remold", { tyreId });
  assert.equal(s.tyres[0].remolds, 1);
  assert.equal(s.tyres[0].type, "remold");
  s = run(s, "scrap", { tyreId, scrapReason: "burst" });
  assert.equal(tally(s).total, 1);
  assert.equal(tally(s).scrapped, 1);
  assert.throws(() => run(s, "remold", { tyreId }), /notInStock/);
  assert.throws(
    () => run(s, "scrap", { tyreId, scrapReason: "burst" }),
    /notInStock/,
  );
  assert.throws(
    () =>
      run(s, "addTyre", {
        serial: "t-1",
        brand: "MRF",
        size: "R20",
        type: "used",
      }),
    /duplicateTyre/,
  );
});
test("reject backwards odometer even when fitting or returning", () => {
  let s = fixture();
  const p = {
    tyreId: s.tyres[0].id,
    vehicleId: s.vehicles[0].id,
    slot: "FL",
    odometer: 900,
  };
  assert.throws(() => run(s, "fit", p), /odometerBackwards/);
  s = run(s, "fit", { ...p, odometer: 1000 });
  assert.throws(
    () => run(s, "remove", { tyreId: p.tyreId, odometer: 999 }),
    /odometerBackwards/,
  );
});
test("invalid odometer inputs rejected", () => {
  const s = fixture();
  for (const value of [-1, 1.5, "", null, true, "2e3", {}, 100000000])
    assert.throws(
      () =>
        run(s, "updateOdometer", {
          vehicleId: s.vehicles[0].id,
          odometer: value,
        }),
      /invalidKm/,
    );
});
test("vehicle registration is normalized and unique", () => {
  const s = fixture();
  assert.equal(s.vehicles[0].registration, "RJ14AB1234");
  assert.throws(
    () =>
      run(s, "addVehicle", {
        registration: "rj14ab1234",
        hasSpare: false,
        odometer: 0,
      }),
    /duplicateVehicle/,
  );
});
test("closing tally carries forward on days with no movement", () => {
  let s = run(
    emptyState(),
    "addTyre",
    { serial: "A", brand: "CEAT", size: "R20", type: "new" },
    "2026-10-20",
  );
  s = run(
    s,
    "scrap",
    { tyreId: s.tyres[0].id, scrapReason: "wornTread" },
    "2026-10-22",
  );
  assert.equal(dailyTally(s, "2026-10-19").total, 0);
  assert.equal(dailyTally(s, "2026-10-21").stock, 1);
  assert.equal(dailyTally(s, "2026-10-22").scrapped, 1);
});
test("daily grouping uses Indian midnight", () => {
  assert.equal(dayKey(new Date("2026-10-21T18:29:59Z")), "2026-10-21");
  assert.equal(dayKey(new Date("2026-10-21T18:30:00Z")), "2026-10-22");
});
test("multiple fitment cycles preserve accumulated distance", () => {
  let s = fixture();
  const p = {
    tyreId: s.tyres[0].id,
    vehicleId: s.vehicles[0].id,
    slot: "FL",
    odometer: 1000,
  };
  s = run(s, "fit", p);
  s = run(s, "remove", { tyreId: p.tyreId, odometer: 2000 });
  s = run(s, "fit", { ...p, slot: "FR", odometer: 2200 });
  s = run(s, "remove", { tyreId: p.tyreId, odometer: 2500 });
  assert.equal(s.tyres[0].distance, 1300);
});
test("a full vehicle takes exactly 18 road tyres and one spare", () => {
  let s = fixture();
  const vehicleId = s.vehicles[0].id;
  for (let i = 0; i < 17; i++)
    s = run(s, "addTyre", {
      serial: `EXTRA-${i}`,
      brand: "MRF",
      size: "R20",
      type: "new",
    });
  const ids = s.tyres.map((t) => t.id);
  for (const [i, slot] of [...slots, "SP"].entries())
    s = run(s, "fit", { tyreId: ids[i], vehicleId, slot, odometer: 1000 });
  assert.equal(tally(s).installed, 19);
  assert.equal(tally(s).stock, 0);
});

test("each removal destination records cycle and lifetime km atomically", () => {
  for (const destination of ["stock", "remolding", "scrapped"]) {
    let s = fixture();
    const tyreId = s.tyres[1].id,
      vehicleId = s.vehicles[0].id;
    s = run(s, "fit", { tyreId, vehicleId, slot: "FL", odometer: 1000 });
    const before = structuredClone(s);
    s = run(s, "remove", {
      tyreId,
      odometer: 1500,
      destination,
      scrapReason: "burst",
    });
    const t = s.tyres[1],
      e = s.events.at(-1);
    assert.equal(t.status, destination);
    assert.equal(t.distance, 900);
    assert.equal(e.runningKm, 500);
    assert.equal(e.totalKm, 900);
    assert.equal(e.fittedOdometer, 1000);
    assert.equal(e.odometer, 1500);
    assert.equal(e.destination, destination);
    assert.equal(e.slot, "FL");
    assert.equal(e.tyre, "T-2");
    assert.equal(e.vehicle, "RJ14AB1234");
    assert.equal(e.tally.installed, 0);
    assert.equal(
      e.tally.total,
      e.tally.stock + e.tally.installed + e.tally.remolding,
    );
    assert.equal(before.tyres[1].status, "installed");
    if (destination === "remolding") {
      assert.equal(tally(s).remolding, 1);
      assert.throws(
        () => run(s, "fit", { tyreId, vehicleId, slot: "FR", odometer: 1500 }),
        /notInStock/,
      );
      s = run(s, "remold", { tyreId });
      assert.equal(s.tyres[1].status, "stock");
      assert.equal(s.tyres[1].remolds, 2);
      assert.equal(s.tyres[1].distance, 900);
      assert.equal(tally(s).remolding, 0);
    }
  }
});
test("scrap reasons are mandatory, custom reasons validated and invalid removals leave everything unchanged", () => {
  let s = fixture();
  const tyreId = s.tyres[0].id;
  assert.throws(() => run(s, "scrap", { tyreId }), /scrapReasonRequired/);
  assert.throws(
    () => run(s, "scrap", { tyreId, scrapReason: "unknown" }),
    /scrapReasonRequired/,
  );
  assert.throws(
    () => run(s, "scrap", { tyreId, scrapReason: "other", scrapDetail: "  " }),
    /scrapDetailRequired/,
  );
  s = run(s, "fit", {
    tyreId,
    vehicleId: s.vehicles[0].id,
    slot: "FL",
    odometer: 1000,
  });
  const before = structuredClone(s);
  assert.throws(
    () => run(s, "remove", { tyreId, odometer: 1600, destination: "scrapped" }),
    /scrapReasonRequired/,
  );
  assert.throws(
    () => run(s, "remove", { tyreId, odometer: 1600, destination: "unknown" }),
    /invalidDestination/,
  );
  assert.deepEqual(s, before);
  s = run(s, "remove", {
    tyreId,
    odometer: 1600,
    destination: "scrapped",
    scrapReason: "other",
    scrapDetail: "  Casing rejected by inspector  ",
  });
  assert.equal(s.tyres[0].scrapDetail, "Casing rejected by inspector");
  assert.equal(s.events.at(-1).scrapReason, "other");
  assert.equal(s.events.at(-1).scrapDetail, "Casing rejected by inspector");
  assert.equal(s.events.at(-1).runningKm, 600);
});
test("spare removal records zero running km; remolding stock can be scrapped with reason", () => {
  let s = fixture();
  const tyreId = s.tyres[1].id;
  s = run(s, "fit", {
    tyreId,
    vehicleId: s.vehicles[0].id,
    slot: "SP",
    odometer: 1000,
  });
  s = run(s, "remove", { tyreId, odometer: 2500, destination: "remolding" });
  assert.equal(s.events.at(-1).runningKm, 0);
  assert.equal(s.events.at(-1).totalKm, 400);
  s = run(s, "scrap", { tyreId, scrapReason: "failedRemold" });
  assert.equal(tally(s).remolding, 0);
  assert.equal(tally(s).scrapped, 1);
  assert.equal(s.tyres[1].distance, 400);
});

test("positions number right to left on each row and preserve legacy slot assignments", () => {
  assert.deepEqual(new Set(numberedSlots), new Set(slots));
  assert.deepEqual(["FL", "FR"].map(positionLabel), ["2", "1"]);
  assert.deepEqual(["2LO", "2LI", "2RI", "2RO"].map(positionLabel), [
    "6",
    "5",
    "4",
    "3",
  ]);
  assert.deepEqual(["3LO", "3LI", "3RI", "3RO"].map(positionLabel), [
    "10",
    "9",
    "8",
    "7",
  ]);
  assert.deepEqual(["4LO", "4LI", "4RI", "4RO"].map(positionLabel), [
    "14",
    "13",
    "12",
    "11",
  ]);
  assert.deepEqual(["5LO", "5LI", "5RI", "5RO"].map(positionLabel), [
    "18",
    "17",
    "16",
    "15",
  ]);
  assert.equal(positionLabel("SP"), "SP");
  assert.equal(positionLabel(undefined), undefined);
});
