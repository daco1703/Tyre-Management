import test from "node:test";
import assert from "node:assert/strict";
import {
  notificationCategories,
  reminderDigest,
  localReminderPlan,
  localReminderIdRange,
  isReminderNotificationId,
  localReminderDailyHorizon,
} from "../shared/notification-reminders.js";
import { licenseStatus } from "../shared/reminders.js";
import { dayKey } from "../shared/model.js";

function snapshot() {
  return {
    version: 1,
    revision: 20,
    events: [],
    vehicles: [
      {
        id: "vehicle-private",
        registration: "PRIVATE-VEHICLE",
        driverName: "PRIVATE-DRIVER",
        createdAt: "2026-09-25T04:30:00Z",
        pendingTyreCheck: true,
        driverChangedAt: "2026-11-25T04:30:00Z",
      },
    ],
    tyres: [
      {
        id: "tyre-private",
        serial: "PRIVATE-TYRE",
        status: "installed",
        vehicleId: "vehicle-private",
        nsdBaselineOn: "2026-08-01",
        lastNsdOn: "2026-09-25",
        nsd: { averagePercent: 80 },
      },
    ],
    drivers: [
      {
        id: "driver-private-1",
        name: "PRIVATE-DRIVER",
        dob: "1985-01-31",
        licenseNo: "PRIVATE-LICENCE-1",
        licenseExpiry: "2026-12-25",
        active: true,
      },
      {
        id: "driver-private-2",
        name: "PRIVATE-OTHER-DRIVER",
        dob: "1980-02-28",
        licenseNo: "PRIVATE-LICENCE-2",
        licenseExpiry: "2026-11-24",
        active: true,
      },
    ],
    costs: [{ invoiceNo: "PRIVATE-INVOICE", amountPaise: 987654321 }],
  };
}
const empty = () => ({ vehicles: [], tyres: [], drivers: [], events: [] });
const zeroCounts = {
  nsd: 0,
  inspection: 0,
  driverChange: 0,
  driverLicenseDue: 0,
  driverLicenseExpired: 0,
};
const morning = (day) => `${day}T03:30:00.000Z`;
const now = () => new Date("2026-11-25T02:30:00Z"); // 08:00 in India.
const selected = (state, categories, extra = {}) =>
  localReminderPlan(state, { now: now(), categories, ...extra });
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
};

test("the digest includes every due category with disjoint licence states and a top-level total", () => {
  const result = reminderDigest(snapshot(), { today: "2026-11-25" });
  assert.equal(result.day, "2026-11-25");
  assert.deepEqual(result.counts, {
    nsd: 1,
    inspection: 1,
    driverChange: 1,
    driverLicenseDue: 1,
    driverLicenseExpired: 1,
  });
  assert.equal(result.total, 5);
  assert.equal(result.counts.total, undefined);
  assert.equal(result.payload.title, "Shepards Tyre Management");
  assert.equal(result.payload.url, "/?reminders=1");
  assert.equal(result.payload.tag, "shepards-reminders-2026-11-25");
  assert.deepEqual(result.payload.data, {
    kind: "reminders",
    day: "2026-11-25",
  });
  assert.match(result.payload.body, /NSD: 1/);
  assert.match(result.payload.body, /Licences due: 1/);
  assert.match(result.payload.body, /Licences expired: 1/);
});

test("English and Hindi push/local payloads contain counts but no fleet, personal, inventory or invoice data", () => {
  const state = snapshot();
  state.fleetName = "PRIVATE-FLEET";
  for (const language of ["en", "hi"]) {
    const digest = reminderDigest(state, { today: "2026-11-25", language });
    const plan = localReminderPlan(state, {
      now: now(),
      language,
      catchUp: true,
    });
    const encoded = JSON.stringify({ digest, plan });
    for (const value of [
      "PRIVATE-",
      "1985-01-31",
      "1980-02-28",
      "987654321",
      "amountPaise",
      "invoiceNo",
      "licenseNo",
      "dob",
    ])
      assert.equal(encoded.includes(value), false, value);
    assert.ok(digest.payload.title.length <= 80);
    assert.ok(digest.payload.body.length <= 240);
    assert.ok(digest.payload.tag.length <= 64);
    if (language === "hi") assert.match(digest.payload.body, /लाइसेंस/);
    assert.ok(
      plan.items.every(
        (item) => Object.keys(item.data).sort().join(",") === "day,kind",
      ),
    );
  }
});

test("settled checks, sold records and inactive drivers do not notify", () => {
  const state = snapshot();
  state.vehicles[0].status = "sold";
  // The planner also avoids a stale installed tyre attached to a sold vehicle.
  state.drivers.forEach((driver) => {
    driver.active = false;
  });
  assert.deepEqual(
    reminderDigest(state, { today: "2026-11-25" }).counts,
    zeroCounts,
  );
  assert.deepEqual(selected(state, notificationCategories).items, []);
  delete state.vehicles[0].status;
  state.vehicles[0].pendingTyreCheck = false;
  state.vehicles[0].lastInspectedOn = "2026-11-25";
  for (const status of ["stock", "remolding", "scrapped", "sold"]) {
    state.tyres[0].status = status;
    assert.equal(reminderDigest(state, { today: "2026-11-25" }).total, 0);
  }
});

test("category selection filters independently, includes both licence kinds, and deduplicates selections", () => {
  const state = snapshot();
  for (const category of notificationCategories) {
    const result = reminderDigest(state, {
      today: "2026-11-25",
      categories: [category, category],
    });
    assert.equal(result.total, category === "driverLicense" ? 2 : 1);
  }
  const disabled = reminderDigest(state, {
    today: "2026-11-25",
    categories: [],
  });
  assert.deepEqual(disabled.counts, zeroCounts);
  assert.equal(disabled.total, 0);
  assert.match(disabled.payload.body, /No reminders/);
  assert.deepEqual(selected(state, []).items, []);
});

test("default local sync starts at the next India 9AM; enabling can catch up in five seconds", () => {
  const state = snapshot();
  const normal = localReminderPlan(state, { now: now() });
  assert.equal(normal.items[0].at, morning("2026-11-25"));
  const immediate = localReminderPlan(state, { now: now(), catchUp: true });
  assert.equal(immediate.items[0].at, "2026-11-25T02:30:05.000Z");
  assert.equal(immediate.items[0].data.day, "2026-11-25");
  const atNine = localReminderPlan(state, {
    now: new Date(morning("2026-11-25")),
  });
  assert.equal(atNine.items[0].at, morning("2026-11-26"));
  assert.ok(
    atNine.items.every(
      (item) => Date.parse(item.at) > Date.parse(morning("2026-11-25")),
    ),
  );
});

test("daily local reminders are bounded one-shot groups and known deadlines beyond that horizon remain covered", () => {
  const state = snapshot();
  const plan = localReminderPlan(state, { now: now(), catchUp: true });
  assert.equal(
    new Set(plan.items.map((item) => item.data.day)).size,
    plan.items.length,
  );
  const currentWindow = plan.items.filter(
    (item) => item.data.day >= "2026-11-25" && item.data.day <= "2026-12-24",
  );
  assert.equal(currentWindow.length, localReminderDailyHorizon);
  assert.equal(currentWindow[0].at, "2026-11-25T02:30:05.000Z");
  assert.ok(
    currentWindow.slice(1).every((item) => item.at.endsWith("T03:30:00.000Z")),
  );
  assert.ok(
    plan.items.some((item) => item.at === morning("2026-12-26")),
    "first expired day outside the daily window must remain known",
  );
  assert.ok(
    plan.items.every(
      (item) =>
        !Object.hasOwn(item, "repeats") && !Object.hasOwn(item, "every"),
    ),
  );
});

test("two-month NSD and distant licence warning/expiry dates are not dropped by a 30-day lookahead", () => {
  const state = empty();
  state.tyres.push({
    id: "future-tyre",
    serial: "A",
    status: "installed",
    lastNsdOn: "2026-11-25",
  });
  state.drivers.push({
    id: "future-driver",
    active: true,
    licenseExpiry: "2028-03-31",
  });
  const plan = localReminderPlan(state, {
    now: now(),
    categories: ["nsd", "driverLicense"],
  });
  assert.ok(plan.items.some((item) => item.at === morning("2027-01-25")));
  assert.ok(plan.items.some((item) => item.at === morning("2028-02-29")));
  assert.ok(plan.items.some((item) => item.at === morning("2028-04-01")));
  assert.equal(plan.items.length, 3);
  assert.equal(plan.truncated, false);
  const later = plan.items.find((item) => item.data.day === "2028-04-01");
  assert.match(later.body, /NSD: 1/);
  assert.match(later.body, /Licences expired: 1/);
  assert.doesNotMatch(later.body, /Licences due:/);
});

test("future payloads aggregate unresolved categories once per target day", () => {
  const state = snapshot();
  const plan = localReminderPlan(state, { now: now() });
  const expired = plan.items.find((item) => item.data.day === "2026-12-26");
  assert.ok(expired);
  assert.match(expired.body, /NSD: 1/);
  assert.match(expired.body, /Inspections: 1/);
  assert.match(expired.body, /Driver checks: 1/);
  assert.match(expired.body, /Licences expired: 2/);
  assert.doesNotMatch(expired.body, /Licences due:/);
});

test("known future dates are prioritized over daily fillers when the iOS pending budget is full", () => {
  const state = empty();
  state.tyres.push({ id: "due", status: "installed", lastNsdOn: "2026-01-01" });
  const futureDates = new Set();
  for (let index = 0; index < 20; index++) {
    const expiry = new Date("2027-03-01T12:00:00Z");
    expiry.setUTCDate(expiry.getUTCDate() + 70 * index);
    const driver = {
      id: `driver-${index}`,
      active: true,
      licenseExpiry: expiry.toISOString().slice(0, 10),
    };
    state.drivers.push(driver);
    futureDates.add(licenseStatus(driver, state, "2026-11-25").dueOn);
    expiry.setUTCDate(expiry.getUTCDate() + 1);
    futureDates.add(expiry.toISOString().slice(0, 10));
  }
  const plan = localReminderPlan(state, { now: now(), catchUp: true });
  assert.equal(plan.items.length, 50);
  assert.equal(plan.truncated, true);
  assert.equal(futureDates.size, 40);
  for (const day of futureDates)
    assert.ok(
      plan.items.some((item) => item.data.day === day),
      day,
    );
  assert.ok(plan.items.every((item) => item.id < localReminderIdRange.max));
  const limited = localReminderPlan(state, {
    now: now(),
    catchUp: true,
    max: 1,
  });
  assert.equal(limited.items.length, 1);
  assert.equal(limited.items[0].data.day, "2026-11-25");
  assert.equal(limited.truncated, true);
});

test("plans and IDs are deterministic under entity/category ordering and stable within the same day", () => {
  const state = snapshot();
  const first = localReminderPlan(state, { now: now() });
  const reordered = structuredClone(state);
  reordered.tyres.reverse();
  reordered.vehicles.reverse();
  reordered.drivers.reverse();
  const second = localReminderPlan(reordered, {
    now: new Date("2026-11-25T02:31:00Z"),
    categories: [...notificationCategories].reverse(),
  });
  assert.deepEqual(second.items, first.items);
  assert.notEqual(second.asOf, first.asOf);
  assert.equal(
    new Set(first.items.map((item) => item.id)).size,
    first.items.length,
  );
  assert.ok(first.items.every((item) => isReminderNotificationId(item.id)));
  assert.equal(isReminderNotificationId(localReminderIdRange.max), true);
  for (const invalid of [
    localReminderIdRange.min - 1,
    localReminderIdRange.max + 1,
    "1100000000",
    1100000000.5,
    NaN,
  ])
    assert.equal(isReminderNotificationId(invalid), false);
});

test("date-ID collisions are resolved deterministically without using the reserved test ID", () => {
  const state = empty();
  const secondExpiry = new Date("2026-12-31T12:00:00Z");
  secondExpiry.setUTCDate(
    secondExpiry.getUTCDate() +
      localReminderIdRange.max -
      localReminderIdRange.min,
  );
  state.drivers.push(
    { active: true, licenseExpiry: "2026-12-31" },
    { active: true, licenseExpiry: secondExpiry.toISOString().slice(0, 10) },
  );
  const plan = localReminderPlan(state, {
    now: new Date("2026-01-01T00:00:00Z"),
  });
  assert.equal(plan.items.length, 4);
  assert.equal(new Set(plan.items.map((item) => item.id)).size, 4);
  assert.ok(plan.items.every((item) => item.id < localReminderIdRange.max));
  state.drivers.reverse();
  assert.deepEqual(
    localReminderPlan(state, { now: new Date("2026-01-01T00:00:00Z") }).items,
    plan.items,
  );
});

test("India midnight and an enable-time catchup crossing midnight use the delivery calendar day", () => {
  const state = empty();
  state.vehicles.push({
    id: "v",
    pendingTyreCheck: true,
    driverChangedAt: "2026-11-24T20:00:00Z",
  });
  assert.equal(reminderDigest(state, { today: "2026-11-24" }).total, 0);
  assert.equal(
    reminderDigest(state, { today: "2026-11-25" }).counts.driverChange,
    1,
  );
  const before = localReminderPlan(state, {
    now: new Date("2026-11-24T18:29:59Z"),
  });
  assert.equal(before.items[0].at, morning("2026-11-25"));
  const due = snapshot();
  due.drivers = [{ active: true, licenseExpiry: "2026-11-25" }];
  const midnight = localReminderPlan(due, {
    now: new Date("2026-11-25T18:29:58Z"),
    catchUp: true,
  });
  assert.equal(midnight.items[0].at, "2026-11-25T18:30:03.000Z");
  assert.equal(midnight.items[0].data.day, "2026-11-26");
  assert.match(midnight.items[0].body, /Licences expired: 1/);
  assert.equal(
    dayKey(new Date(midnight.items[0].at)),
    midnight.items[0].data.day,
  );
});

test("calendar-clamped settings and backdated readings retain business anchors in scheduled dates", () => {
  const state = empty();
  state.reminderSettings = { nsd: { value: 1, unit: "months" } };
  state.tyres.push({
    id: "t",
    serial: "NEW",
    serialAliases: ["OLD"],
    status: "installed",
    nsdBaselineOn: "2027-01-31",
    lastNsdOn: "2027-02-20",
    nextNsdCheckOn: "2099-01-01",
  });
  state.events.push(
    { id: "t", kind: "addTyre", tyre: "OLD", type: "new", date: "2027-01-31" },
    { kind: "fit", tyre: "OLD", date: "2027-01-31" },
    {
      kind: "measureNsd",
      measuredOn: "2027-02-20",
      nsdMeasurements: [{ tyreId: "t", averagePercent: 80 }],
    },
    {
      kind: "measureNsd",
      measuredOn: "2027-02-10",
      nsdMeasurements: [{ tyreId: "t", averagePercent: 60 }],
    },
  );
  let plan = localReminderPlan(state, {
    now: new Date("2027-02-21T00:00:00Z"),
    categories: ["nsd"],
  });
  assert.equal(plan.items[0].at, morning("2027-03-20"));
  assert.equal(
    plan.items.some((item) => item.data.day === "2099-01-01"),
    false,
  );
  state.tyres[0].lastNsdOn = null;
  state.tyres[0].nsdBaselineOn = "2027-02-25";
  state.events.push(
    {
      kind: "measureNsd",
      measuredOn: "2027-02-25",
      nsdMeasurements: [{ tyreId: "t", averagePercent: 20 }],
    },
    { kind: "remold", tyreId: "t", date: "2027-02-25" },
    { kind: "fit", tyreId: "t", date: "2027-03-05" },
  );
  plan = localReminderPlan(state, {
    now: new Date("2027-03-06T00:00:00Z"),
    categories: ["nsd"],
  });
  assert.equal(plan.items[0].at, morning("2027-04-05"));
});

test("planners never mutate business records, dates, or caller options", () => {
  const state = freeze(snapshot());
  const saved = JSON.stringify(state);
  const categories = Object.freeze([...notificationCategories]);
  const instant = now(),
    timestamp = instant.getTime();
  reminderDigest(state, { today: "2026-11-25", categories });
  localReminderPlan(state, { now: instant, categories, catchUp: true });
  assert.equal(JSON.stringify(state), saved);
  assert.equal(instant.getTime(), timestamp);
  assert.deepEqual(categories, notificationCategories);
  assert.equal(reminderDigest({}, { today: "2026-11-25" }).total, 0);
});

test("invalid categories, languages, date bounds and scheduling limits fail explicitly", () => {
  const state = snapshot();
  for (const today of [
    "2026-02-30",
    "25/11/2026",
    "1899-12-31",
    "10000-01-01",
    null,
  ])
    assert.throws(() => reminderDigest(state, { today }), RangeError);
  for (const categories of [null, {}, "nsd", ["unknown"], ["nsd", null]]) {
    assert.throws(
      () => reminderDigest(state, { today: "2026-11-25", categories }),
      RangeError,
    );
    assert.throws(
      () => localReminderPlan(state, { now: now(), categories }),
      RangeError,
    );
  }
  assert.throws(
    () => reminderDigest(state, { today: "2026-11-25", language: "fr" }),
    RangeError,
  );
  for (const instant of [
    new Date(NaN),
    "2026-11-25T08:00:00",
    "2026-02-30T08:00:00Z",
    "1899-01-01T08:00:00Z",
    0,
  ])
    assert.throws(() => localReminderPlan(state, { now: instant }), RangeError);
  for (const max of [-1, 1.5, 51, Infinity, "50"])
    assert.throws(
      () => localReminderPlan(state, { now: now(), max }),
      RangeError,
    );
  assert.throws(
    () => localReminderPlan(state, { now: now(), catchUp: "yes" }),
    RangeError,
  );
  const none = localReminderPlan(state, { now: now(), max: 0 });
  assert.deepEqual(none.items, []);
  assert.equal(none.truncated, true);
  assert.deepEqual(
    localReminderPlan(state, { now: "2026-11-25T08:00:00+05:30" }).items,
    localReminderPlan(state, { now: now() }).items,
  );
});
