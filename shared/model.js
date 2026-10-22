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
export const tyreTypes = ["new", "used", "remold"];
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
    total: state.tyres.filter((t) => t.status !== "scrapped").length,
    installed: state.tyres.filter((t) => t.status === "installed").length,
    stock: state.tyres.filter((t) => t.status === "stock").length,
    scrapped: state.tyres.filter((t) => t.status === "scrapped").length,
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
  const state = structuredClone(previous);
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
      const v = {
        id,
        registration,
        name: text(p.name),
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
      const serial = required(p.serial, 70).toUpperCase();
      if (state.tyres.some((t) => t.serial === serial))
        throw new AppError("duplicateTyre");
      const t = {
        id,
        serial,
        brand: required(p.brand, 80),
        size: required(p.size, 40),
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
      event.tyre = serial;
      event.type = p.type;
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
      });
      break;
    }
    case "remove": {
      const t = tyre();
      if (t.status !== "installed") throw new AppError("notInstalled");
      const v = vehicle(t.vehicleId);
      setOdo(v);
      Object.assign(event, {
        tyre: t.serial,
        vehicle: v.registration,
        slot: t.slot,
      });
      t.distance = tyreKm(t, state);
      Object.assign(t, {
        status: "stock",
        type: t.type === "new" ? "used" : t.type,
        vehicleId: null,
        slot: null,
        fittedAt: null,
      });
      break;
    }
    case "remold": {
      const t = tyre();
      if (t.status !== "stock") throw new AppError("notInStock");
      t.type = "remold";
      t.remolds++;
      event.tyre = t.serial;
      break;
    }
    case "scrap": {
      const t = tyre();
      if (t.status !== "stock") throw new AppError("notInStock");
      t.status = "scrapped";
      event.tyre = t.serial;
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
