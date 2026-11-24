import { addCalendarMonths, isDay } from "./dates.js";
import { averageNsd } from "./nsd.js";

export const intervalBounds = Object.freeze({
  days: 3650,
  weeks: 520,
  months: 120,
});
export const reminderDefaults = Object.freeze({
  nsd: Object.freeze({ value: 2, unit: "months" }),
  inspection: Object.freeze({ value: 2, unit: "months" }),
  driverLicense: Object.freeze({ value: 1, unit: "months" }),
  driverChange: Object.freeze({ value: 0, unit: "days" }),
});
const keys = Object.keys(reminderDefaults);
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function interval(value, key) {
  if (
    !record(value) ||
    Object.keys(value).some((name) => !["value", "unit"].includes(name)) ||
    !Object.hasOwn(intervalBounds, value.unit) ||
    !["number", "string"].includes(typeof value.value) ||
    (typeof value.value === "string" && !/^\d+$/.test(value.value))
  )
    return null;
  const amount = Number(value.value);
  if (
    !Number.isSafeInteger(amount) ||
    amount < (key === "driverChange" ? 0 : 1) ||
    amount > intervalBounds[value.unit]
  )
    return null;
  return { value: amount, unit: value.unit };
}

// Read old or partially populated settings without changing stored records.
export function reminderSettings(state) {
  const source = record(state?.reminderSettings) ? state.reminderSettings : {};
  return Object.fromEntries(
    keys.map((key) => [
      key,
      interval(source[key], key) || { ...reminderDefaults[key] },
    ]),
  );
}

// Writes are stricter than compatibility reads. The model merges a partial
// patch with current settings before calling this full-object validator.
export function normalizeReminderSettings(input) {
  if (!record(input) || Object.keys(input).some((key) => !keys.includes(key)))
    return { error: "invalidReminderSettings" };
  const settings = {};
  for (const key of keys) {
    const checked = interval(input[key], key);
    if (!checked) return { error: "invalidReminderSettings" };
    settings[key] = checked;
  }
  return { settings };
}

function localDay(value) {
  if (isDay(value)) return value;
  if (
    !(value instanceof Date) &&
    (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
      !isDay(value.slice(0, 10)))
  )
    return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shifted(day, setting, direction) {
  if (!isDay(day) || !record(setting)) return null;
  const value = setting.value;
  if (
    !Object.hasOwn(intervalBounds, setting.unit) ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > intervalBounds[setting.unit]
  )
    return null;
  if (setting.unit === "months") {
    const result = addCalendarMonths(day, direction * value);
    return isDay(result) ? result : null;
  }
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(
    date.getUTCDate() + direction * value * (setting.unit === "weeks" ? 7 : 1),
  );
  const result = date.toISOString().slice(0, 10);
  return isDay(result) ? result : null;
}

export function addReminderInterval(day, setting) {
  return shifted(day, setting, 1);
}

const events = (state) => (Array.isArray(state?.events) ? state.events : []);
const lastDay = (days) => days.filter(isDay).sort().at(-1) || null;
const firstDay = (days) => days.filter(isDay).sort()[0] || null;

function tyreMatches(item, tyre) {
  if (!record(item) || !tyre) return false;
  if (typeof item.tyreId === "string" && item.tyreId)
    return item.tyreId === tyre.id;
  const aliases = new Set(
    [
      tyre.serial,
      ...(Array.isArray(tyre.serialAliases) ? tyre.serialAliases : []),
    ]
      .filter((value) => typeof value === "string")
      .map((value) => value.trim().toUpperCase()),
  );
  return (
    (item.kind === "addTyre" &&
      typeof tyre.id === "string" &&
      item.id === tyre.id) ||
    (typeof item.tyre === "string" &&
      aliases.has(item.tyre.trim().toUpperCase()))
  );
}

function vehicleMatches(item, vehicle) {
  if (!record(item) || !vehicle) return false;
  if (typeof item.vehicleId === "string" && item.vehicleId)
    return item.vehicleId === vehicle.id;
  return (
    (item.kind === "addVehicle" &&
      typeof vehicle.id === "string" &&
      item.id === vehicle.id) ||
    (typeof vehicle.registration === "string" &&
      vehicle.registration.length > 0 &&
      item.vehicle === vehicle.registration)
  );
}

// Calculate from performed readings and the first fitting of the current tread
// lifecycle. Re-fitting or changing the interval never shifts that anchor.
export function nsdDueOn(tyre, state) {
  if (!tyre || tyre.status !== "installed") return null;
  const history = events(state);
  let baseline = isDay(tyre.nsdBaselineOn) ? tyre.nsdBaselineOn : null;
  let baselineIndex = -1;
  history.forEach((event, index) => {
    if (
      !tyreMatches(event, tyre) ||
      !(
        event.kind === "remold" ||
        (event.kind === "addTyre" && ["new", "remold"].includes(event.type))
      )
    )
      return;
    const date = localDay(event.date) || localDay(event.timestamp);
    if (date && (!baseline || date >= baseline)) {
      baseline = date;
      baselineIndex = index;
    }
  });
  const readings = [];
  if (isDay(tyre.lastNsdOn) && (!baseline || tyre.lastNsdOn >= baseline))
    readings.push(tyre.lastNsdOn);
  const fitments = [];
  history.forEach((event, index) => {
    if (!record(event) || index < baselineIndex) return;
    if (event.kind === "fit" && tyreMatches(event, tyre)) {
      const date = localDay(event.date) || localDay(event.timestamp);
      if (date && (!baseline || date >= baseline)) fitments.push(date);
    }
    const measuredOn = event.measuredOn || event.inspectedOn;
    if (!isDay(measuredOn) || (baseline && measuredOn < baseline)) return;
    const values = Array.isArray(event.nsdMeasurements)
      ? event.nsdMeasurements
      : [];
    if (
      values.some((reading) => {
        const average = averageNsd(reading);
        return (
          tyreMatches(reading, tyre) &&
          average !== null &&
          average >= 0 &&
          average <= 100
        );
      })
    )
      readings.push(measuredOn);
  });
  const firstFitted = localDay(tyre.nsdFirstFittedOn);
  if (firstFitted && (!baseline || firstFitted >= baseline))
    fitments.push(firstFitted);
  const anchor = lastDay(readings) || firstDay(fitments);
  return anchor
    ? addReminderInterval(anchor, reminderSettings(state).nsd)
    : null;
}

export function inspectionDueOn(vehicle, state) {
  if (!vehicle || vehicle.status === "sold") return null;
  const history = events(state).filter((event) =>
    vehicleMatches(event, vehicle),
  );
  const inspectedOn = lastDay([
    vehicle.lastInspectedOn,
    ...history
      .filter((event) => event.kind === "inspectVehicle")
      .map((event) => event.inspectedOn),
  ]);
  const createdOn =
    localDay(vehicle.createdAt) ||
    firstDay(
      history
        .filter((event) => event.kind === "addVehicle")
        .map((event) => localDay(event.date) || localDay(event.timestamp)),
    );
  const anchor = inspectedOn || createdOn;
  return anchor
    ? addReminderInterval(anchor, reminderSettings(state).inspection)
    : null;
}

export function driverCheckDueOn(vehicle, state) {
  if (
    !vehicle ||
    vehicle.status === "sold" ||
    vehicle.pendingTyreCheck !== true
  )
    return null;
  const changedOn =
    localDay(vehicle.driverChangedAt) ||
    lastDay(
      events(state)
        .filter(
          (event) =>
            record(event) &&
            event.kind === "changeDriver" &&
            vehicleMatches(event, vehicle) &&
            (!vehicle.driverChangeId || event.id === vehicle.driverChangeId),
        )
        .map((event) => localDay(event.date) || localDay(event.timestamp)),
    );
  return changedOn
    ? addReminderInterval(changedOn, reminderSettings(state).driverChange)
    : null;
}

export function licenseStatus(driver, state, today = new Date()) {
  const expiryOn = isDay(driver?.licenseExpiry) ? driver.licenseExpiry : null;
  const current = localDay(today);
  const dueOn = expiryOn
    ? shifted(expiryOn, reminderSettings(state).driverLicense, -1)
    : null;
  if (!expiryOn || !current || !dueOn)
    return { status: "unknown", dueOn, expiryOn, daysRemaining: null };
  const daysRemaining = Math.round(
    (Date.parse(`${expiryOn}T12:00:00Z`) - Date.parse(`${current}T12:00:00Z`)) /
      86400000,
  );
  return {
    status: expiryOn < current ? "expired" : current >= dueOn ? "due" : "valid",
    dueOn,
    expiryOn,
    daysRemaining,
  };
}
