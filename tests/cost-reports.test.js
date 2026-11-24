import test from "node:test";
import assert from "node:assert/strict";
import { costReportFor } from "../shared/cost-report.js";
import { reportFor } from "../shared/reports.js";

const range = { from: "2026-10-01", to: "2026-11-30" };
const entry = (id, date, kind, amountPaise, extra = {}) => ({
  id: `cost-${id}`,
  eventId: id,
  tyreId: `tyre-${id}`,
  tyreSerial: `SERIAL-${id}`,
  kind,
  condition: kind === "remold" ? "remold" : "new",
  brand: "MRF",
  date,
  timestamp: `${date}T06:00:00.000Z`,
  invoiceNo: `INV-${id}`,
  amountPaise,
  actor: "admin",
  ...extra,
});
function fixture() {
  const costs = [
    entry("new", "2026-10-01", "purchase", 1250050),
    entry("used", "2026-10-15", "purchase", 250000, { condition: "used" }),
    entry("remold", "2026-10-31", "remold", 450075),
    entry("nov", "2026-11-30", "purchase", 2000000, {
      brand: "Apollo",
      condition: "remold",
    }),
    entry("outside", "2026-12-01", "purchase", 99900),
  ];
  return {
    costs,
    tyres: [],
    events: costs.map((row) => ({
      id: row.eventId,
      kind: row.kind === "purchase" ? "addTyre" : "remold",
      date: row.date,
      brand: row.brand,
      type: row.condition,
    })),
  };
}

test("cost report adds integer paise for every purchase condition and completed remolds", () => {
  const state = fixture();
  const original = structuredClone(state);
  const result = costReportFor(state, range);
  assert.deepEqual(result.totals, {
    purchasePaise: 3500050,
    remoldPaise: 450075,
    totalPaise: 3950125,
    purchaseCount: 3,
    remoldCount: 1,
  });
  assert.deepEqual(result.series, [
    {
      period: "2026-10",
      purchasePaise: 1500050,
      remoldPaise: 450075,
      totalPaise: 1950125,
    },
    {
      period: "2026-11",
      purchasePaise: 2000000,
      remoldPaise: 0,
      totalPaise: 2000000,
    },
  ]);
  assert.deepEqual(
    result.rows.map((row) => row.eventId),
    ["nov", "remold", "used", "new"],
  );
  assert.equal(result.unpricedCount, 0);
  assert.deepEqual(state, original);
  assert.notEqual(result.rows[0], state.costs[3]);
});

test("day grouping and inclusive range boundaries use the recorded date", () => {
  const state = fixture();
  state.costs.push(
    entry("same-day", "2026-10-01", "purchase", 25, {
      timestamp: "2026-10-01T08:00:00.000Z",
    }),
  );
  const result = costReportFor(state, {
    from: "2026-10-01",
    to: "2026-10-01",
    groupBy: "day",
  });
  assert.deepEqual(result.series, [
    {
      period: "2026-10-01",
      purchasePaise: 1250075,
      remoldPaise: 0,
      totalPaise: 1250075,
    },
  ]);
  assert.deepEqual(
    result.rows.map((row) => row.eventId),
    ["same-day", "new"],
  );
});

test("brand and kind filters affect amounts, counts, rows and missing-cost entries together", () => {
  const state = fixture();
  state.events.push(
    { id: "unknown-mrf", kind: "remold", date: "2026-10-20", brand: "MRF" },
    {
      id: "unknown-apollo",
      kind: "remold",
      date: "2026-10-20",
      brand: "Apollo",
    },
    { id: "dispatch", kind: "sendRemold", date: "2026-10-20", brand: "MRF" },
  );
  const result = costReportFor(state, {
    ...range,
    kind: "remold",
    brand: "MRF",
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.totals.totalPaise, 450075);
  assert.equal(result.totals.purchaseCount, 0);
  assert.equal(result.totals.remoldCount, 1);
  assert.equal(result.unpricedCount, 1);
  assert.equal(result.unpricedPurchaseCount, 0);
  assert.equal(result.unpricedRemoldCount, 1);
});

test("legacy purchase/import/remold prices stay unknown and are never inferred from present tyre condition", () => {
  const state = {
    tyres: [{ id: "tyre", serial: "OLD-1", brand: "MRF", type: "remold" }],
    events: [
      {
        id: "purchase",
        kind: "addTyre",
        tyre: "OLD-1",
        type: "new",
        date: "2026-10-01",
      },
      {
        id: "import-used",
        kind: "addTyre",
        tyreId: "tyre",
        type: "used",
        date: "2026-10-02",
        note: "Excel import",
      },
      { id: "completed", kind: "remold", tyre: "OLD-1", date: "2026-10-03" },
      { id: "dispatch", kind: "sendRemold", tyre: "OLD-1", date: "2026-10-03" },
      { id: "fit", kind: "fit", tyre: "OLD-1", date: "2026-10-03" },
    ],
  };
  const result = costReportFor(state, { ...range, brand: "MRF" });
  assert.equal(result.unpricedCount, 3);
  assert.equal(result.unpricedPurchaseCount, 2);
  assert.equal(result.unpricedRemoldCount, 1);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.series, []);
  assert.equal(result.totals.totalPaise, 0);
  assert.equal(result.totals.purchaseCount, 0);
});

test("renamed tyres keep legacy unpriced purchases and remolds under their brand filter", () => {
  const state = {
    tyres: [
      {
        id: "tyre",
        serial: "CORRECTED-1",
        serialAliases: ["OLD-1", "OLDER-1"],
        brand: "MRF",
      },
    ],
    events: [
      {
        id: "purchase",
        kind: "addTyre",
        tyre: "old-1",
        type: "new",
        date: "2026-10-01",
      },
      { id: "completed", kind: "remold", tyre: "OLDER-1", date: "2026-10-02" },
      {
        id: "foreign",
        tyreId: "different-tyre",
        kind: "addTyre",
        tyre: "OLD-1",
        date: "2026-10-03",
      },
    ],
  };
  const result = costReportFor(state, { ...range, brand: "MRF" });
  assert.equal(result.unpricedPurchaseCount, 1);
  assert.equal(result.unpricedRemoldCount, 1);
  assert.equal(result.unpricedCount, 2);
  assert.deepEqual(result.rows, []);
  assert.equal(result.totals.purchaseCount, 0);
  assert.equal(result.totals.totalPaise, 0);
});

test("explicit zero invoice is recorded while an invalid or absent amount is unpriced", () => {
  const state = fixture();
  state.costs = [
    entry("zero", "2026-10-03", "purchase", 0),
    entry("invalid", "2026-10-04", "purchase", -1),
  ];
  state.events = [
    { id: "zero", kind: "addTyre", date: "2026-10-03", brand: "MRF" },
    { id: "invalid", kind: "addTyre", date: "2026-10-04", brand: "MRF" },
    { id: "absent", kind: "remold", date: "2026-10-05", brand: "MRF" },
  ];
  const result = costReportFor(state, range);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].amountPaise, 0);
  assert.equal(result.totals.purchaseCount, 1);
  assert.equal(result.unpricedCount, 2);
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].totalPaise, 0);
});

test("empty selection reports no recorded data rather than invented prices or periods", () => {
  const result = costReportFor(fixture(), {
    ...range,
    brand: "Custom manufacturer",
  });
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.series, []);
  assert.equal(result.totals.totalPaise, 0);
  assert.equal(result.unpricedCount, 0);
});

test("cost filters reject invalid dates, unsupported grouping and vehicle attribution", () => {
  for (const filters of [
    { from: "2026-02-29", to: "2026-03-01" },
    { from: "2026-11-01", to: "2026-10-01" },
    { from: "01/10/2026", to: "30/11/2026" },
  ])
    assert.equal(costReportFor(fixture(), filters).error, "invalidDateRange");
  for (const filters of [
    { ...range, groupBy: "year" },
    { ...range, kind: "sendRemold" },
    { ...range, brand: ["MRF"] },
    { ...range, vehicleId: "arbitrary-vehicle" },
    null,
  ]) {
    const result = costReportFor(fixture(), filters);
    assert.equal(result.error, "invalidCostFilter");
    assert.deepEqual(result.rows, []);
    assert.equal(result.totals.totalPaise, 0);
  }
});

test("aggregate overflow never silently rounds an exact-paise report", () => {
  const state = {
    costs: [
      entry("a", "2026-10-01", "purchase", Number.MAX_SAFE_INTEGER),
      entry("b", "2026-10-01", "purchase", 1),
    ],
  };
  assert.equal(costReportFor(state, range).error, "invalidCostFilter");
});

test("fleet tally counts per-tyre new imports and completed remolds without assigning garage events to a vehicle", () => {
  const state = {
    vehicles: [{ id: "v", registration: "MH46AF7655", emissionClass: "BS6" }],
    events: [
      {
        id: "new1",
        date: "2026-10-01",
        timestamp: "2026-10-01T06:00:00Z",
        kind: "addTyre",
        type: "new",
        actor: "admin",
        note: "Excel import",
      },
      {
        id: "new2",
        date: "2026-10-02",
        timestamp: "2026-10-02T06:00:00Z",
        kind: "addTyre",
        condition: "new",
        actor: "staff",
        note: "Excel import",
      },
      {
        id: "used",
        date: "2026-10-02",
        kind: "addTyre",
        type: "used",
        actor: "staff",
      },
      {
        id: "dispatch",
        date: "2026-10-02",
        kind: "sendRemold",
        actor: "staff",
      },
      { id: "remold", date: "2026-10-03", kind: "remold", actor: "staff" },
      { id: "later", date: "2026-12-01", kind: "remold", actor: "staff" },
    ],
  };
  const fleet = reportFor(state, range);
  assert.deepEqual(fleet.fleetTotals, { newPurchases: 2, completedRemolds: 1 });
  assert.equal(fleet.totals.fitments, 0);
  assert.deepEqual(fleet.events, []);
  assert.deepEqual(fleet.rows[0].events, []);
  assert.deepEqual(reportFor(state, { ...range, actor: "staff" }).fleetTotals, {
    newPurchases: 1,
    completedRemolds: 1,
  });
  assert.equal(
    reportFor(state, { ...range, vehicleId: "v" }).fleetTotals,
    null,
  );
  assert.equal(
    reportFor(state, { ...range, emissionClass: "BS6" }).fleetTotals,
    null,
  );
});
