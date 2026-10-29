import {
  vehicleClasses,
  constructions,
  defaultTyreSize,
  inspectionIssues,
} from "./catalogue.js";
import { isDay, addCalendarMonths } from "./dates.js";
import { validateTyreBatch } from "./tyre-import.js";
import { averageNsd } from "./nsd.js";
import { validateVehicleBatch } from "./vehicle-import.js";

export class AppError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export const slots = [
  "FL",
  "FR",
  ...[2, 3, 4, 5].flatMap((a) => [`${a}LO`, `${a}LI`, `${a}RI`, `${a}RO`]),
];
// Display numbering runs from the right side to the left on each axle.
// Retain stable slot IDs so older tyre assignments and history need no migration.
export const numberedSlots = [
  "FR",
  "FL",
  ...[2, 3, 4, 5].flatMap((a) => [`${a}RO`, `${a}RI`, `${a}LI`, `${a}LO`]),
];
export function positionLabel(slot) {
  const index = numberedSlots.indexOf(slot);
  return index >= 0 ? String(index + 1) : slot;
}
export const tyreTypes = ["new", "used", "remold"];
export const scrapReasons = [
  "burst",
  "wornTread",
  "sidewallDamage",
  "cuts",
  "beadDamage",
  "treadSeparation",
  "ageCracks",
  "irreparablePuncture",
  "failedRemold",
  "other",
];
function recordScrap(tyre, payload, event) {
  if (!scrapReasons.includes(payload.scrapReason))
    throw new AppError("scrapReasonRequired");
  const detail = text(payload.scrapDetail, 300);
  if (payload.scrapReason === "other" && !detail)
    throw new AppError("scrapDetailRequired");
  tyre.scrapReason = event.scrapReason = payload.scrapReason;
  tyre.scrapDetail = event.scrapDetail =
    payload.scrapReason === "other" ? detail : "";
}
function readNsd(input) {
  const parse = (raw) => {
    if (
      !["string", "number"].includes(typeof raw) ||
      !/^\d+(?:\.\d{1,2})?$/.test(String(raw)) ||
      Number(raw) < 0 ||
      Number(raw) > 100
    )
      throw new AppError("invalidNsd");
    return Number(raw);
  };
  if (input?.averagePercent !== undefined) {
    if (input.averagePercent === "" || input.averagePercent === null)
      throw new AppError("nsdRequired");
    return { averagePercent: parse(input.averagePercent) };
  }
  // Accept old installed clients while saving one average in new records.
  const values = ["inner", "center", "outer"]
    .map((k) => input?.[k])
    .filter((v) => v !== "" && v !== null && v !== undefined)
    .map(parse);
  if (!values.length) throw new AppError("nsdRequired");
  return {
    averagePercent:
      Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) /
      100,
  };
}
function resetNsd(tyre, day) {
  tyre.nsd = { averagePercent: 100 };
  tyre.nsdBaselineOn = day;
  tyre.lastNsdOn = null;
  tyre.nextNsdCheckOn = null;
}
function saveNsd(tyre, values, measuredOn) {
  if (
    (!tyre.lastNsdOn || measuredOn >= tyre.lastNsdOn) &&
    (!tyre.nsdBaselineOn || measuredOn >= tyre.nsdBaselineOn)
  ) {
    tyre.lastNsdOn = measuredOn;
    tyre.nsd = values;
    tyre.nextNsdCheckOn = addCalendarMonths(measuredOn, 2);
  }
  return { tyreId: tyre.id, tyre: tyre.serial, slot: tyre.slot, ...values };
}
function remoldVendor(payload, previous = "") {
  if (payload.vendor === undefined) return previous || null;
  const value =
    payload.vendor === "other" ? payload.customVendor : payload.vendor;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100)
    throw new AppError("vendorRequired");
  return value.trim();
}
export const emptyState = () => ({
  version: 1,
  revision: 0,
  vehicles: [],
  tyres: [],
  events: [],
});
export function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
const text = (value, max = 100) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const required = (value, max) => {
  const v = text(value, max);
  if (!v) throw new AppError("required");
  return v;
};
const km = (value) => {
  const n = Number(value);
  if (
    !["string", "number"].includes(typeof value) ||
    (typeof value === "string" && !/^\d+$/.test(value)) ||
    !Number.isSafeInteger(n) ||
    n < 0 ||
    n > 99999999
  )
    throw new AppError("invalidKm");
  return n;
};
export function tally(state) {
  return {
    total: state.tyres.filter((t) => !["scrapped", "sold"].includes(t.status))
      .length,
    sold: state.tyres.filter((t) => t.status === "sold").length,
    installed: state.tyres.filter((t) => t.status === "installed").length,
    stock: state.tyres.filter((t) => t.status === "stock").length,
    scrapped: state.tyres.filter((t) => t.status === "scrapped").length,
    remolding: state.tyres.filter((t) => t.status === "remolding").length,
    new: state.tyres.filter((t) => t.status === "stock" && t.type === "new")
      .length,
    used: state.tyres.filter((t) => t.status === "stock" && t.type === "used")
      .length,
    remold: state.tyres.filter(
      (t) => t.status === "stock" && t.type === "remold",
    ).length,
  };
}
export function dailyTally(state, date) {
  return (
    [...state.events].reverse().find((e) => e.date <= date)?.tally ||
    tally(emptyState())
  );
}
export const activeVehicles = (state) =>
  state.vehicles.filter((v) => v.status !== "sold");
export function tyreKm(tyre, state) {
  const vehicle = state.vehicles.find((v) => v.id === tyre.vehicleId);
  return (
    tyre.distance +
    (vehicle && tyre.status === "installed" && tyre.slot !== "SP"
      ? Math.max(0, vehicle.odometer - tyre.fittedAt)
      : 0)
  );
}
export function applyAction(previous, action, actor, now = new Date()) {
  if (action.kind === "importTyres") {
    const result = validateTyreBatch(action.payload?.tyres, previous.tyres);
    if (result.error) throw new AppError(result.error);
    let state = structuredClone(previous);
    for (const tyre of result.tyres)
      state = applySingleAction(
        state,
        { kind: "addTyre", payload: { ...tyre, note: "Excel import" } },
        actor,
        now,
      );
    return state;
  }
  if (action.kind === "importVehicles") {
    const result = validateVehicleBatch(
      action.payload?.vehicles,
      previous.vehicles,
    );
    if (result.error) throw new AppError(result.error);
    const state = structuredClone(previous);
    const timestamp = now.toISOString();
    const counts = tally(state);
    for (const vehicle of result.vehicles) {
      const id = crypto.randomUUID();
      state.vehicles.push({ id, ...vehicle, createdAt: timestamp });
      state.events.push({
        id,
        timestamp,
        date: dayKey(now),
        kind: "addVehicle",
        actor,
        note: "Excel import",
        vehicle: vehicle.registration,
        tally: { ...counts },
      });
      state.revision++;
    }
    return state;
  }
  return applySingleAction(structuredClone(previous), action, actor, now);
}
function applySingleAction(state, action, actor, now) {
  const p = action.payload || {};
  const id = crypto.randomUUID();
  const event = {
    id,
    timestamp: now.toISOString(),
    date: dayKey(now),
    kind: action.kind,
    actor,
    note: text(p.note, 500),
  };
  const tyre = () => {
    const t = state.tyres.find((t) => t.id === p.tyreId);
    if (!t) throw new AppError("tyreMissing");
    return t;
  };
  const vehicle = (id) => {
    const v = state.vehicles.find((v) => v.id === id);
    if (!v) throw new AppError("vehicleMissing");
    if (v.status === "sold") throw new AppError("vehicleAlreadySold");
    return v;
  };
  const setOdo = (v) => {
    const n = km(p.odometer);
    if (n < v.odometer) throw new AppError("odometerBackwards");
    v.odometer = n;
    event.odometer = n;
  };
  switch (action.kind) {
    case "addVehicle": {
      if (typeof p.hasSpare !== "boolean") throw new AppError("required");
      const registration = required(p.registration, 30)
        .toUpperCase()
        .replace(/\s+/g, "");
      if (state.vehicles.some((v) => v.registration === registration))
        throw new AppError("duplicateVehicle");
      if (p.emissionClass && !vehicleClasses.includes(p.emissionClass))
        throw new AppError("invalidVehicleClass");
      const v = {
        id,
        registration,
        name: text(p.name),
        driverName: text(p.driverName),
        emissionClass: p.emissionClass || null,
        hasSpare: p.hasSpare,
        odometer: km(p.odometer),
        createdAt: event.timestamp,
      };
      state.vehicles.push(v);
      event.vehicle = registration;
      break;
    }
    case "addTyre": {
      if (!tyreTypes.includes(p.type)) throw new AppError("invalidType");
      if (p.construction && !constructions.includes(p.construction))
        throw new AppError("invalidConstruction");
      const serial = required(p.serial, 70).toUpperCase();
      if (state.tyres.some((t) => t.serial === serial))
        throw new AppError("duplicateTyre");
      const t = {
        id,
        serial,
        brand: required(p.brand, 80),
        size: text(p.size, 40) || defaultTyreSize,
        construction: p.construction || null,
        type: p.type,
        status: "stock",
        distance: km(p.distance ?? 0),
        remolds: p.type === "remold" ? 1 : 0,
        createdAt: event.timestamp,
        vehicleId: null,
        slot: null,
        fittedAt: null,
      };
      state.tyres.push(t);
      if (t.type === "new" || t.type === "remold") resetNsd(t, dayKey(now));
      // Stock receives baseline values only; staff measure fitted tyres.
      event.tyre = serial;
      event.type = p.type;
      break;
    }
    case "measureNsd": {
      const t = tyre();
      if (t.status !== "installed") throw new AppError("nsdOnlyFitted");
      if (!isDay(p.measuredOn) || p.measuredOn > dayKey(now))
        throw new AppError("invalidInspectionDate");
      const values = readNsd(p.nsd);
      const v = t.vehicleId ? vehicle(t.vehicleId) : null;
      Object.assign(event, {
        tyre: t.serial,
        vehicleId: v?.id || null,
        vehicle: v?.registration || null,
        measuredOn: p.measuredOn,
        nsdMeasurements: [saveNsd(t, values, p.measuredOn)],
      });
      break;
    }
    case "sellVehicle": {
      const v = vehicle(p.vehicleId);
      const fitted = state.tyres.filter(
        (t) => t.vehicleId === v.id && t.status === "installed",
      );
      const snapshot = p.fitmentSnapshot;
      if (snapshot !== undefined) {
        const valid =
          Array.isArray(snapshot) &&
          snapshot.every(
            (t) =>
              t && typeof t.tyreId === "string" && typeof t.slot === "string",
          );
        const key = (list) =>
          list
            .map((t) => `${t.slot}:${t.tyreId}`)
            .sort()
            .join("|");
        if (
          !valid ||
          key(snapshot) !==
            key(fitted.map((t) => ({ tyreId: t.id, slot: t.slot })))
        )
          throw new AppError("saleTyresChanged", 409);
      }
      setOdo(v);
      const snapshots = fitted.map((t) => ({
        tyreId: t.id,
        tyre: t.serial,
        brand: t.brand,
        construction: t.construction || null,
        slot: t.slot,
        fittedOdometer: t.fittedAt,
        runningKm: tyreKm(t, state) - t.distance,
        totalKm: tyreKm(t, state),
        averagePercent: averageNsd(t.nsd),
      }));
      for (const t of fitted) {
        const detail = snapshots.find((s) => s.tyreId === t.id);
        t.status = "sold";
        t.distance = detail.totalKm;
        t.type = t.type === "new" ? "used" : t.type;
        Object.assign(t, {
          vehicleId: null,
          slot: null,
          fittedAt: null,
          soldAt: event.timestamp,
          soldBy: actor,
          saleNote: event.note,
          soldFrom: "installed",
          soldWithVehicleId: v.id,
          soldVehicle: v.registration,
          soldSlot: detail.slot,
          vehicleSaleId: id,
        });
        state.events.push({
          id: crypto.randomUUID(),
          timestamp: event.timestamp,
          date: event.date,
          kind: "sell",
          actor,
          note: event.note,
          ...detail,
          type: t.type,
          vehicleId: v.id,
          vehicle: v.registration,
          vehicleSaleId: id,
          soldWithVehicle: true,
          fromStatus: "installed",
          destination: "sold",
          odometer: v.odometer,
          tally: tally(state),
        });
      }
      Object.assign(v, {
        status: "sold",
        soldAt: event.timestamp,
        soldBy: actor,
        saleNote: event.note,
        soldTyreIds: fitted.map((t) => t.id),
        vehicleSaleId: id,
        pendingTyreCheck: false,
      });
      Object.assign(event, {
        vehicleId: v.id,
        vehicle: v.registration,
        tyreCount: fitted.length,
        soldTyres: snapshots,
      });
      break;
    }
    case "changeDriver": {
      const v = vehicle(p.vehicleId);
      const driverName = required(p.driverName, 100);
      if (driverName === v.driverName) throw new AppError("sameDriver");
      Object.assign(event, {
        vehicleId: v.id,
        vehicle: v.registration,
        fromDriverName: v.driverName || "",
        driverName,
      });
      Object.assign(v, {
        driverName,
        driverChangedAt: event.timestamp,
        driverChangeId: id,
        pendingTyreCheck: true,
      });
      break;
    }
    case "inspectVehicle": {
      const v = vehicle(p.vehicleId);
      if (!isDay(p.inspectedOn) || p.inspectedOn > dayKey(now))
        throw new AppError("invalidInspectionDate");
      if (typeof p.allTyresChecked !== "boolean")
        throw new AppError("required");
      if (p.fitmentSnapshot !== undefined) {
        if (
          !Array.isArray(p.fitmentSnapshot) ||
          p.fitmentSnapshot.some(
            (t) =>
              !t ||
              typeof t !== "object" ||
              typeof t.tyreId !== "string" ||
              typeof t.slot !== "string",
          )
        )
          throw new AppError("inspectionTyreChanged");
        const snapshotKey = (list) =>
          list
            .map((t) => `${t.slot}:${t.tyreId}`)
            .sort()
            .join("|");
        const current = state.tyres
          .filter((t) => t.status === "installed" && t.vehicleId === v.id)
          .map((t) => ({ tyreId: t.id, slot: t.slot }));
        if (snapshotKey(current) !== snapshotKey(p.fitmentSnapshot))
          throw new AppError("inspectionTyreChanged");
      }
      const findings = p.findings ?? [];
      if (!Array.isArray(findings) || findings.length > 57)
        throw new AppError("invalidFindings");
      const seen = new Set();
      const checkedFindings = findings.map((f) => {
        if (
          !f ||
          typeof f !== "object" ||
          !inspectionIssues.includes(f.issue) ||
          (!slots.includes(f.slot) && !(f.slot === "SP" && v.hasSpare))
        )
          throw new AppError("invalidFindings");
        const detail = text(f.detail, 300);
        if (f.issue === "other" && !detail)
          throw new AppError("inspectionDetailRequired");
        const key = f.slot + ":" + f.issue;
        if (seen.has(key)) throw new AppError("duplicateFinding");
        seen.add(key);
        const t = state.tyres.find(
          (t) =>
            t.status === "installed" &&
            t.vehicleId === v.id &&
            t.slot === f.slot,
        );
        if (Object.hasOwn(f, "tyreId") && f.tyreId !== (t?.id || null))
          throw new AppError("inspectionTyreChanged");
        return {
          slot: f.slot,
          issue: f.issue,
          detail,
          tyreId: t?.id || null,
          tyre: t?.serial || null,
          brand: t?.brand || null,
        };
      });
      const nsds = p.nsdMeasurements || [];
      if (!Array.isArray(nsds) || nsds.length > 19)
        throw new AppError("invalidNsd");
      const measuredSlots = new Set();
      const nsdMeasurements = nsds.map((reading) => {
        if (!reading || measuredSlots.has(reading.slot))
          throw new AppError("invalidNsd");
        measuredSlots.add(reading.slot);
        const tyre = state.tyres.find(
          (t) =>
            t.status === "installed" &&
            t.vehicleId === v.id &&
            t.slot === reading.slot &&
            t.id === reading.tyreId,
        );
        if (!tyre) throw new AppError("inspectionTyreChanged");
        return saveNsd(tyre, readNsd(reading), p.inspectedOn);
      });
      if (
        !p.allTyresChecked &&
        !checkedFindings.length &&
        !nsdMeasurements.length &&
        !event.note
      )
        throw new AppError("inspectionRequired");
      const driverCheckCompleted = !!(
        v.pendingTyreCheck &&
        p.allTyresChecked &&
        p.driverChangeId === v.driverChangeId &&
        p.inspectedOn >= dayKey(new Date(v.driverChangedAt))
      );
      if (driverCheckCompleted) v.pendingTyreCheck = false;
      if (!v.lastInspectedOn || p.inspectedOn >= v.lastInspectedOn) {
        v.lastInspectedOn = p.inspectedOn;
        v.lastInspectionId = id;
      }
      Object.assign(event, {
        vehicleId: v.id,
        vehicle: v.registration,
        inspectedOn: p.inspectedOn,
        allTyresChecked: p.allTyresChecked,
        findings: checkedFindings,
        nsdMeasurements,
        driverCheckCompleted,
        driverChangeId: driverCheckCompleted ? v.driverChangeId : null,
        driverName: v.driverName || "",
        odometer: v.odometer,
        inspectedTyres: state.tyres
          .filter((t) => t.status === "installed" && t.vehicleId === v.id)
          .map((t) => ({
            tyreId: t.id,
            tyre: t.serial,
            slot: t.slot,
            brand: t.brand,
            construction: t.construction || null,
          })),
      });
      break;
    }
    case "updateOdometer": {
      const v = vehicle(p.vehicleId);
      setOdo(v);
      event.vehicle = v.registration;
      break;
    }
    case "fit": {
      const t = tyre(),
        v = vehicle(p.vehicleId);
      if (t.status !== "stock") throw new AppError("notInStock");
      if (!slots.includes(p.slot) && !(p.slot === "SP" && v.hasSpare))
        throw new AppError("invalidSlot");
      if (
        state.tyres.some(
          (x) =>
            x.vehicleId === v.id &&
            x.slot === p.slot &&
            x.status === "installed",
        )
      )
        throw new AppError("slotOccupied");
      setOdo(v);
      if (!t.lastNsdOn) t.nextNsdCheckOn = addCalendarMonths(dayKey(now), 2);
      Object.assign(t, {
        status: "installed",
        vehicleId: v.id,
        slot: p.slot,
        fittedAt: v.odometer,
      });
      Object.assign(event, {
        tyre: t.serial,
        vehicle: v.registration,
        slot: p.slot,
        brand: t.brand,
        construction: t.construction || null,
      });
      break;
    }
    case "remove": {
      const t = tyre();
      if (t.status !== "installed") throw new AppError("notInstalled");
      const destination = p.destination ?? "stock";
      if (!["stock", "remolding", "scrapped"].includes(destination))
        throw new AppError("invalidDestination");
      const v = vehicle(t.vehicleId);
      setOdo(v);
      const totalKm = tyreKm(t, state);
      Object.assign(event, {
        tyre: t.serial,
        vehicle: v.registration,
        slot: t.slot,
        fittedOdometer: t.fittedAt,
        runningKm: totalKm - t.distance,
        totalKm,
        destination,
        brand: t.brand,
        construction: t.construction || null,
      });
      if (destination === "scrapped") recordScrap(t, p, event);
      if (destination === "remolding") {
        event.vendor = remoldVendor(p);
        t.remoldVendor = event.vendor;
      }
      t.distance = totalKm;
      Object.assign(t, {
        status: destination,
        type: t.type === "new" ? "used" : t.type,
        vehicleId: null,
        slot: null,
        fittedAt: null,
      });
      break;
    }
    case "sendRemold": {
      const t = tyre();
      if (t.status !== "stock") throw new AppError("notInStock");
      t.status = "remolding";
      t.remoldVendor = event.vendor = remoldVendor(p);
      event.tyre = t.serial;
      event.totalKm = t.distance;
      break;
    }
    case "remold": {
      const t = tyre();
      if (!["stock", "remolding"].includes(t.status))
        throw new AppError("notInStock");
      t.status = "stock";
      t.remoldVendor = event.vendor = remoldVendor(p, t.remoldVendor);
      t.lastRemoldVendor = event.vendor;
      t.type = "remold";
      resetNsd(t, dayKey(now));
      t.remolds++;
      event.tyre = t.serial;
      break;
    }
    case "sell": {
      const t = tyre();
      if (!["stock", "scrapped"].includes(t.status))
        throw new AppError("sellStockOnly");
      Object.assign(event, {
        tyre: t.serial,
        tyreId: t.id,
        brand: t.brand,
        construction: t.construction || null,
        type: t.type,
        totalKm: t.distance,
        fromStatus: t.status,
        averagePercent: averageNsd(t.nsd),
      });
      t.status = "sold";
      t.soldAt = event.timestamp;
      t.soldBy = actor;
      t.saleNote = event.note;
      t.soldFrom = event.fromStatus;
      break;
    }
    case "scrap": {
      const t = tyre();
      if (!["stock", "remolding"].includes(t.status))
        throw new AppError("notInStock");
      recordScrap(t, p, event);
      t.status = "scrapped";
      event.tyre = t.serial;
      event.totalKm = t.distance;
      break;
    }
    default:
      throw new AppError("invalidAction");
  }
  event.tally = tally(state);
  state.events.push(event);
  state.revision++;
  return state;
}
