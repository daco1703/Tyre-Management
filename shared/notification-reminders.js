import { dayKey } from "./model.js";
import { isDay } from "./dates.js";
import {
  nsdDueOn,
  inspectionDueOn,
  driverCheckDueOn,
  licenseStatus,
} from "./reminders.js";

export const notificationCategories = Object.freeze([
  "nsd",
  "inspection",
  "driverChange",
  "driverLicense",
]);
export const localReminderIdRange = Object.freeze({
  min: 1100000000,
  max: 1100999999,
});
// The final ID belongs to the deliberate "test this device" notification.
// Plans stay below it and below iOS's total 64-pending-notification limit.
export const localReminderLimit = 50;
export const localReminderDailyHorizon = 30;
const minimumDay = "1900-01-01";
const maximumDay = "9999-12-31";
const millisecondsPerDay = 86400000;
const title = "Shepards Tyre Management";

export function isReminderNotificationId(id) {
  return (
    Number.isInteger(id) &&
    id >= localReminderIdRange.min &&
    id <= localReminderIdRange.max
  );
}

function checkedDay(value) {
  if (!isDay(value) || value < minimumDay || value > maximumDay)
    throw new RangeError(
      "Reminder dates must be valid ISO calendar days from 1900 through 9999.",
    );
  return value;
}

function preferences(language, categories) {
  if (!["en", "hi"].includes(language))
    throw new RangeError("Reminder language must be English or Hindi.");
  if (
    !Array.isArray(categories) ||
    categories.some((category) => !notificationCategories.includes(category))
  )
    throw new RangeError("Unknown reminder notification category.");
  const selected = new Set(categories);
  return {
    language,
    categories: notificationCategories.filter((category) =>
      selected.has(category),
    ),
  };
}

const entries = (value) =>
  Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object")
    : [];

function followingDay(day) {
  if (!isDay(day)) return null;
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  const result = date.toISOString().slice(0, 10);
  return isDay(result) && result <= maximumDay ? result : null;
}

// Resolve business rules once per snapshot. Future grouped digests compare
// these dates rather than repeatedly scanning every tyre's history per day.
function reminderRecords(state, categories, today) {
  const selected = new Set(categories);
  const vehicles = entries(state?.vehicles);
  const soldVehicles = new Set(
    vehicles
      .filter((vehicle) => vehicle.status === "sold")
      .map((vehicle) => vehicle.id),
  );
  const records = [];
  if (selected.has("nsd")) {
    for (const tyre of entries(state?.tyres)) {
      if (soldVehicles.has(tyre.vehicleId)) continue;
      const dueOn = nsdDueOn(tyre, state);
      if (isDay(dueOn)) records.push({ category: "nsd", dueOn });
    }
  }
  for (const vehicle of vehicles) {
    if (vehicle.status === "sold") continue;
    if (selected.has("inspection")) {
      const dueOn = inspectionDueOn(vehicle, state);
      if (isDay(dueOn)) records.push({ category: "inspection", dueOn });
    }
    if (selected.has("driverChange")) {
      const dueOn = driverCheckDueOn(vehicle, state);
      if (isDay(dueOn)) records.push({ category: "driverChange", dueOn });
    }
  }
  if (selected.has("driverLicense")) {
    for (const driver of entries(state?.drivers)) {
      if (driver.active === false) continue;
      const status = licenseStatus(driver, state, today);
      if (!isDay(status.dueOn) || !isDay(status.expiryOn)) continue;
      records.push({
        category: "driverLicense",
        dueOn: status.dueOn,
        expiryOn: status.expiryOn,
        expiredOn: followingDay(status.expiryOn),
      });
    }
  }
  return records;
}

function digest(records, day, language) {
  const counts = {
    nsd: 0,
    inspection: 0,
    driverChange: 0,
    driverLicenseDue: 0,
    driverLicenseExpired: 0,
  };
  for (const reminder of records) {
    if (reminder.category === "driverLicense") {
      if (reminder.expiryOn < day) counts.driverLicenseExpired++;
      else if (reminder.dueOn <= day) counts.driverLicenseDue++;
    } else if (reminder.dueOn <= day) counts[reminder.category]++;
  }
  const labels =
    language === "hi"
      ? {
          nsd: "NSD जाँच",
          inspection: "निरीक्षण",
          driverChange: "ड्राइवर जाँच",
          driverLicenseDue: "लाइसेंस जल्द समाप्त",
          driverLicenseExpired: "लाइसेंस समाप्त",
        }
      : {
          nsd: "NSD",
          inspection: "Inspections",
          driverChange: "Driver checks",
          driverLicenseDue: "Licences due",
          driverLicenseExpired: "Licences expired",
        };
  const formatter = new Intl.NumberFormat(
    language === "hi" ? "hi-IN" : "en-IN",
  );
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const body =
    Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => `${labels[key]}: ${formatter.format(count)}`)
      .join(" · ") ||
    (language === "hi" ? "अभी कोई रिमाइंडर देय नहीं है।" : "No reminders due.");
  return {
    day,
    counts,
    total,
    payload: {
      title,
      body,
      tag: `shepards-reminders-${day}`,
      url: "/?reminders=1",
      data: { kind: "reminders", day },
    },
  };
}

export function reminderDigest(
  state,
  {
    today = dayKey(),
    language = "en",
    categories = notificationCategories,
  } = {},
) {
  const day = checkedDay(today);
  const options = preferences(language, categories);
  return digest(
    reminderRecords(state, options.categories, day),
    day,
    options.language,
  );
}

function checkedNow(value) {
  if (
    !(value instanceof Date) &&
    (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) ||
      !isDay(value.slice(0, 10)))
  )
    throw new RangeError(
      "Reminder planning needs a valid Date or timestamp with an explicit timezone.",
    );
  const date = new Date(value instanceof Date ? value.getTime() : value);
  if (!Number.isFinite(date.getTime()))
    throw new RangeError("Invalid reminder planning time.");
  checkedDay(dayKey(date));
  return date;
}

function morning(day) {
  return new Date(`${day}T09:00:00+05:30`).toISOString();
}

function itemIds(days) {
  const used = new Set();
  const width = localReminderIdRange.max - localReminderIdRange.min;
  const ids = new Map();
  for (const day of [...days].sort()) {
    const ordinal = Math.floor(
      Date.parse(`${day}T00:00:00Z`) / millisecondsPerDay,
    );
    let offset = ((ordinal % width) + width) % width;
    while (used.has(offset)) offset = (offset + 1) % width;
    used.add(offset);
    ids.set(day, localReminderIdRange.min + offset);
  }
  return ids;
}

// Local alerts are one-shot projections of the latest synchronized snapshot.
// Daily projection is finite; every known future deadline is retained before
// filling daily occurrences, so a two-month NSD date is not lost to a horizon.
export function localReminderPlan(
  state,
  {
    now = new Date(),
    language = "en",
    categories = notificationCategories,
    catchUp = false,
    max = localReminderLimit,
  } = {},
) {
  const instant = checkedNow(now);
  const today = dayKey(instant);
  const options = preferences(language, categories);
  if (
    typeof catchUp !== "boolean" ||
    !Number.isInteger(max) ||
    max < 0 ||
    max > localReminderLimit
  )
    throw new RangeError(
      "Local reminders require a boolean catch-up option and a limit from 0 through 50.",
    );
  const records = reminderRecords(state, options.categories, today);
  const candidates = new Map();
  const digests = new Map();
  const onDay = (day) => {
    if (!digests.has(day))
      digests.set(day, digest(records, day, options.language));
    return digests.get(day);
  };
  const add = (day, at, mandatory = false, override = false) => {
    if (
      !isDay(day) ||
      day < minimumDay ||
      day > maximumDay ||
      Date.parse(at) <= instant.getTime()
    )
      return;
    const previous = candidates.get(day);
    candidates.set(day, {
      day,
      at: previous && !override ? previous.at : at,
      mandatory: mandatory || previous?.mandatory || false,
    });
  };
  for (const reminder of records) {
    if (isDay(reminder.dueOn))
      add(reminder.dueOn, morning(reminder.dueOn), true);
    if (reminder.category === "driverLicense" && reminder.expiredOn)
      add(reminder.expiredOn, morning(reminder.expiredOn), true);
  }
  const todayMorning = morning(today);
  let nextMorning =
    Date.parse(todayMorning) > instant.getTime() ? today : followingDay(today);
  let immediateDay = null;
  if (onDay(today).total) {
    if (catchUp) {
      const immediate = new Date(instant.getTime() + 5000);
      const day = dayKey(immediate);
      if (isDay(day) && day <= maximumDay) {
        immediateDay = day;
        add(day, immediate.toISOString(), true, true);
      }
    } else if (nextMorning) add(nextMorning, morning(nextMorning), true);
  }
  if (immediateDay && nextMorning && nextMorning <= immediateDay)
    nextMorning = followingDay(immediateDay);
  let day = nextMorning;
  const occurrences = localReminderDailyHorizon - (immediateDay ? 1 : 0);
  for (
    let index = 0;
    index < occurrences && day;
    index++, day = followingDay(day)
  )
    if (onDay(day).total) add(day, morning(day));

  const chronological = (a, b) => a.at.localeCompare(b.at);
  const required = [...candidates.values()]
    .filter((item) => item.mandatory)
    .sort(chronological);
  const optional = [...candidates.values()]
    .filter((item) => !item.mandatory)
    .sort(chronological);
  const selected = [...required, ...optional].slice(0, max).sort(chronological);
  const ids = itemIds(selected.map((item) => item.day));
  return {
    items: selected.map((item) => {
      const payload = onDay(item.day).payload;
      return {
        id: ids.get(item.day),
        at: item.at,
        title: payload.title,
        body: payload.body,
        data: payload.data,
      };
    }),
    truncated: candidates.size > selected.length,
    asOf: instant.toISOString(),
  };
}
