import { dayKey } from "./model.js";
import { isDay } from "./dates.js";
export function presetRange(preset, today = dayKey()) {
  const [year, month] = today.split("-").map(Number);
  if (preset === "lastMonth") {
    const end = new Date(Date.UTC(year, month - 1, 0))
      .toISOString()
      .slice(0, 10);
    return { from: end.slice(0, 7) + "-01", to: end };
  }
  if (preset === "lastYear")
    return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  return { from: today.slice(0, 7) + "-01", to: today };
}
export const effectiveDay = (event) =>
  event.inspectedOn || event.measuredOn || event.date;
export function vehicleEvents(state, vehicle) {
  return state.events.filter((e) =>
    e.vehicleId
      ? e.vehicleId === vehicle.id
      : e.vehicle === vehicle.registration,
  );
}
export function lastInspection(state, vehicle) {
  return (
    vehicleEvents(state, vehicle)
      .filter((e) => e.kind === "inspectVehicle")
      .sort(
        (a, b) =>
          b.inspectedOn.localeCompare(a.inspectedOn) ||
          b.timestamp.localeCompare(a.timestamp),
      )[0] || null
  );
}
export function reportFor(state, filters) {
  const { from, to, vehicleId = "", emissionClass = "", actor = "" } = filters;
  if (!isDay(from) || !isDay(to) || from > to)
    return { error: "invalidDateRange", rows: [], events: [], totals: {} };
  const vehicles = state.vehicles.filter(
    (v) =>
      (!vehicleId || v.id === vehicleId) &&
      (!emissionClass || v.emissionClass === emissionClass),
  );
  const rows = vehicles.map((v) => {
    const events = vehicleEvents(state, v).filter(
      (e) =>
        effectiveDay(e) >= from &&
        effectiveDay(e) <= to &&
        (!actor || e.actor === actor),
    );
    return {
      vehicle: v,
      events,
      fitments: events.filter((e) => e.kind === "fit").length,
      removals: events.filter(
        (e) => e.kind === "remove" || (e.kind === "sell" && e.soldWithVehicle),
      ).length,
      vehicleSales: events.filter((e) => e.kind === "sellVehicle").length,
      inspections: events.filter((e) => e.kind === "inspectVehicle").length,
      findings: events.reduce((n, e) => n + (e.findings?.length || 0), 0),
      nsdChecks: events.reduce(
        (n, e) => n + (e.nsdMeasurements?.length || 0),
        0,
      ),
      driverChanges: events.filter((e) => e.kind === "changeDriver").length,
      driverChecks: events.filter((e) => e.driverCheckCompleted).length,
      tyreKm: events
        .filter(
          (e) =>
            e.kind === "remove" || (e.kind === "sell" && e.soldWithVehicle),
        )
        .reduce((n, e) => n + (e.runningKm || 0), 0),
    };
  });
  const keys = [
    "fitments",
    "removals",
    "vehicleSales",
    "inspections",
    "findings",
    "nsdChecks",
    "driverChanges",
    "driverChecks",
    "tyreKm",
  ];
  const totals = Object.fromEntries(
    keys.map((key) => [key, rows.reduce((sum, row) => sum + row[key], 0)]),
  );
  return {
    rows,
    totals,
    events: rows
      .flatMap((row) => row.events)
      .sort(
        (a, b) =>
          effectiveDay(b).localeCompare(effectiveDay(a)) ||
          b.timestamp.localeCompare(a.timestamp),
      ),
  };
}
