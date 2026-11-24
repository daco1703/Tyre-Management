import { isDay } from "./dates.js";

const emptyTotals = () => ({
  purchasePaise: 0,
  remoldPaise: 0,
  totalPaise: 0,
  purchaseCount: 0,
  remoldCount: 0,
});
const emptyReport = (error) => ({
  ...(error ? { error } : {}),
  totals: emptyTotals(),
  series: [],
  rows: [],
  unpricedCount: 0,
  unpricedPurchaseCount: 0,
  unpricedRemoldCount: 0,
});
const costKinds = ["purchase", "remold"];
const validAmount = (amount) => Number.isSafeInteger(amount) && amount >= 0;

/** Fleet costs only: the ledger does not attribute garage spending to vehicles. */
export function costReportFor(state, filters = {}) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters))
    return emptyReport("invalidCostFilter");
  const { from, to, kind = "", brand = "", groupBy = "month" } = filters;
  if (!isDay(from) || !isDay(to) || from > to)
    return emptyReport("invalidDateRange");
  if (
    Object.keys(filters).some(
      (key) => !["from", "to", "kind", "brand", "groupBy"].includes(key),
    ) ||
    !["", ...costKinds].includes(kind) ||
    typeof brand !== "string" ||
    brand.length > 80 ||
    !["day", "month"].includes(groupBy)
  )
    return emptyReport("invalidCostFilter");

  const ledger = Array.isArray(state.costs) ? state.costs : [];
  const validLedger = ledger.filter(
    (row) =>
      costKinds.includes(row.kind) &&
      isDay(row.date) &&
      validAmount(row.amountPaise),
  );
  const matches = (row) =>
    row.date >= from &&
    row.date <= to &&
    (!kind || row.kind === kind) &&
    (!brand || row.brand === brand);
  const rows = validLedger
    .filter(matches)
    .map((row) => ({ ...row }))
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        String(b.timestamp || "").localeCompare(String(a.timestamp || "")) ||
        String(b.id || "").localeCompare(String(a.id || "")),
    );
  const totals = emptyTotals();
  const periods = new Map();
  for (const row of rows) {
    const amountKey = `${row.kind}Paise`;
    totals[amountKey] += row.amountPaise;
    totals[`${row.kind}Count`]++;
    totals.totalPaise += row.amountPaise;
    if (!Number.isSafeInteger(totals.totalPaise))
      return emptyReport("invalidCostFilter");
    const period = row.date.slice(0, groupBy === "month" ? 7 : 10);
    if (!periods.has(period))
      periods.set(period, {
        period,
        purchasePaise: 0,
        remoldPaise: 0,
        totalPaise: 0,
      });
    const bucket = periods.get(period);
    bucket[amountKey] += row.amountPaise;
    bucket.totalPaise += row.amountPaise;
  }

  // Missing historical amounts stay unknown, including imports. Explicit ₹0
  // entries are recorded costs; dispatching to a vendor is not a completed job.
  const pricedEvents = new Set(
    validLedger.map((row) => row.eventId).filter(Boolean),
  );
  const tyresById = new Map((state.tyres || []).map((tyre) => [tyre.id, tyre]));
  const serialKey = (serial) =>
    typeof serial === "string" ? serial.trim().toUpperCase() : "";
  const tyresBySerial = new Map();
  for (const tyre of state.tyres || []) {
    const aliases = Array.isArray(tyre.serialAliases) ? tyre.serialAliases : [];
    for (const serial of [tyre.serial, ...aliases]) {
      const key = serialKey(serial);
      if (key) tyresBySerial.set(key, tyre);
    }
  }
  const unpriced = (state.events || []).filter((event) => {
    const eventKind =
      event.kind === "addTyre"
        ? "purchase"
        : event.kind === "remold"
          ? "remold"
          : "";
    if (!eventKind || pricedEvents.has(event.id) || !isDay(event.date))
      return false;
    const tyre = event.tyreId
      ? tyresById.get(event.tyreId)
      : (event.kind === "addTyre" && tyresById.get(event.id)) ||
        tyresBySerial.get(serialKey(event.tyre));
    return matches({
      date: event.date,
      kind: eventKind,
      brand: event.brand || tyre?.brand || "",
    });
  });
  const unpricedPurchaseCount = unpriced.filter(
    (event) => event.kind === "addTyre",
  ).length;
  return {
    totals,
    series: [...periods.values()].sort((a, b) =>
      a.period.localeCompare(b.period),
    ),
    rows,
    unpricedCount: unpriced.length,
    unpricedPurchaseCount,
    unpricedRemoldCount: unpriced.length - unpricedPurchaseCount,
  };
}
