import {
  createECDH,
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { AppError } from "../shared/model.js";
import { defaultSharedServer } from "../shared/defaults.js";
import {
  notificationCategories,
  reminderDigest,
} from "../shared/notification-reminders.js";
import {
  providerStatus,
  sendNotification,
  validatePushDevice,
} from "./push-delivery.js";

export const notificationRegistryKey = "notificationRegistry";
const MAX_DEVICES = 500;
const MAX_USER_DEVICES = 5;
const LEASE_MS = 60000;
const TEST_INTERVAL_MS = 60000;
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value) => createHash("sha256").update(value).digest();
const indiaDay = (time) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
const secretConfigured = (env) =>
  typeof env.CRON_SECRET === "string" &&
  !/[\s\x00-\x1f\x7f]/.test(env.CRON_SECRET) &&
  env.CRON_SECRET.length >= 16 &&
  env.CRON_SECRET.length <= 512;
const deviceKey = (device) =>
  device.kind === "web"
    ? device.subscription?.endpoint
    : `${device.kind}:${device.token}`;
const providerDevice = (device) => ({
  platform: device.kind,
  ...(device.kind === "web"
    ? { subscription: device.subscription }
    : { token: device.token }),
});

function parseRegistry(value) {
  if (value === undefined) return { version: 1, devices: [] };
  let result;
  try {
    result = JSON.parse(value);
  } catch {
    throw new AppError("notificationsUnavailable", 503);
  }
  if (
    !record(result) ||
    result.version !== 1 ||
    !Array.isArray(result.devices) ||
    result.devices.length > MAX_DEVICES
  )
    throw new AppError("notificationsUnavailable", 503);
  return result;
}
const readRegistry = async (tx) =>
  parseRegistry(
    (
      await tx.get(
        "SELECT value FROM settings WHERE key=?",
        notificationRegistryKey,
      )
    )?.value,
  );
const saveRegistry = (tx, registry) =>
  tx.run(
    "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    notificationRegistryKey,
    JSON.stringify(registry),
  );

function preferences(payload) {
  if (
    !record(payload) ||
    !["web", "android", "ios"].includes(payload.kind) ||
    !["en", "hi"].includes(payload.language)
  )
    throw new AppError("invalidNotificationDevice");
  const categories = payload.categories ?? notificationCategories;
  if (
    !Array.isArray(categories) ||
    categories.length > notificationCategories.length ||
    categories.some((key) => !notificationCategories.includes(key))
  )
    throw new AppError("invalidNotificationPreferences");
  return {
    language: payload.language,
    categories: notificationCategories.filter((key) =>
      categories.includes(key),
    ),
  };
}
function identifier(value) {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/i.test(value))
    throw new AppError("invalidNotificationDevice");
  return value;
}

export function createNotificationService({
  store,
  env = process.env,
  sender = sendNotification,
  clock = Date.now,
} = {}) {
  function vapid(registry) {
    const subject =
      env.VAPID_SUBJECT || registry.vapid?.subject || defaultSharedServer;
    if (env.VAPID_PUBLIC_KEY || env.VAPID_PRIVATE_KEY)
      return {
        subject,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      };
    if (!registry.vapid) {
      const key = createECDH("prime256v1");
      key.generateKeys();
      const privateBytes = key.getPrivateKey();
      registry.vapid = {
        subject,
        publicKey: key.getPublicKey().toString("base64url"),
        privateKey: Buffer.concat([
          Buffer.alloc(32 - privateBytes.length),
          privateBytes,
        ]).toString("base64url"),
      };
    }
    return { ...registry.vapid, subject };
  }
  function readiness(registry) {
    const keys = vapid(registry);
    const providers = providerStatus({
      ...env,
      VAPID_SUBJECT: keys.subject,
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
    });
    return { keys, providers, cron: secretConfigured(env) };
  }
  async function status(authorize) {
    return store.transaction(async (tx) => {
      await authorize(tx);
      const registry = await readRegistry(tx),
        ready = readiness(registry);
      await saveRegistry(tx, registry);
      return {
        web: {
          configured: ready.providers.web,
          vapidPublicKey: ready.providers.web ? ready.keys.publicKey : null,
        },
        native: { android: ready.providers.android, ios: ready.providers.ios },
        cronConfigured: ready.cron,
        remoteRemindersConfigured:
          ready.cron && Object.values(ready.providers).some(Boolean),
      };
    });
  }
  async function enroll({ authorize, payload, sessionHash, origin }) {
    const settings = preferences(payload);
    const validated = validatePushDevice(
      {
        platform: payload.kind,
        subscription: payload.subscription,
        token: payload.token,
      },
      { now: clock() },
    );
    if (!validated) throw new AppError("invalidNotificationDevice");
    if (payload.deviceId !== undefined) identifier(payload.deviceId);
    return store.transaction(async (tx) => {
      const user = await authorize(tx),
        registry = await readRegistry(tx),
        ready = readiness(registry);
      const data = {
        kind: payload.kind,
        ...(validated.platform === "web"
          ? { subscription: validated.subscription }
          : { token: validated.token }),
      };
      const same = registry.devices.find(
        (device) =>
          record(device) &&
          device.kind === data.kind &&
          deviceKey(device) === deviceKey(data),
      );
      const supplied =
        payload.deviceId &&
        registry.devices.find(
          (device) =>
            record(device) &&
            device.id === payload.deviceId &&
            device.userId === user.id,
        );
      if (payload.deviceId && !supplied)
        throw new AppError("notificationDeviceMissing", 404);
      // A shared browser/phone can deliberately consent under a different user;
      // transfer that destination rather than keeping duplicate account sends.
      const existing = supplied || (same?.userId === user.id ? same : null);
      const removedIds = new Set([existing?.id, same?.id].filter(Boolean));
      const remaining = registry.devices.filter(
        (device) => record(device) && !removedIds.has(device.id),
      );
      if (
        remaining.filter((device) => device.userId === user.id).length >=
          MAX_USER_DEVICES ||
        remaining.length >= MAX_DEVICES
      )
        throw new AppError("notificationDeviceLimit", 409);
      const device = {
        id: existing?.id || randomUUID(),
        userId: user.id,
        origin: String(origin || "").slice(0, 300),
        ...data,
        ...settings,
        enrolledBySessionHash: sessionHash,
        createdAt: existing?.createdAt || new Date(clock()).toISOString(),
        updatedAt: new Date(clock()).toISOString(),
        ...(existing?.lastSuccessDay
          ? { lastSuccessDay: existing.lastSuccessDay }
          : {}),
        ...(existing?.lastTestAt ? { lastTestAt: existing.lastTestAt } : {}),
      };
      registry.devices = [...remaining, device];
      await saveRegistry(tx, registry);
      return {
        deviceId: device.id,
        kind: device.kind,
        remoteDeliveryConfigured: ready.cron && ready.providers[device.kind],
      };
    });
  }
  async function revokeBySessionHash({ activeUser, deviceId, sessionHash }) {
    if (typeof sessionHash !== "string" || !/^[a-f0-9]{64}$/.test(sessionHash))
      throw new AppError("unauthorized", 401);
    identifier(deviceId);
    return store.transaction(async (tx) => {
      const user = await activeUser(tx),
        registry = await readRegistry(tx);
      const device = registry.devices.find(
        (entry) => record(entry) && entry.id === deviceId,
      );
      // An already-removed opaque ID has no credentials or metadata to expose.
      // Return the same acknowledgement so a lost response can be retried.
      if (!device) return { ok: true };
      const matchingBinding =
        typeof device.enrolledBySessionHash === "string" &&
        timingSafeEqual(hash(device.enrolledBySessionHash), hash(sessionHash));
      if (user?.id !== device.userId && !matchingBinding)
        throw new AppError("unauthorized", 401);
      registry.devices = registry.devices.filter(
        (entry) => record(entry) && entry.id !== deviceId,
      );
      await saveRegistry(tx, registry);
      return { ok: true };
    });
  }
  async function cleanupBindings(
    tx,
    { userId, sessionHash, exceptSessionHash } = {},
  ) {
    let registry;
    try {
      registry = await readRegistry(tx);
    } catch {
      // A corrupt optional registry must not trap a user in a logged-in account.
      // Discard notification credentials/consent only, forcing fresh enrollment.
      await tx.run("DELETE FROM settings WHERE key=?", notificationRegistryKey);
      return;
    }
    const previous = registry.devices.length;
    registry.devices = registry.devices.filter(
      (device) =>
        record(device) &&
        !(
          device.userId === userId &&
          (sessionHash
            ? device.enrolledBySessionHash === sessionHash
            : exceptSessionHash
              ? device.enrolledBySessionHash !== exceptSessionHash
              : true)
        ),
    );
    if (registry.devices.length !== previous) await saveRegistry(tx, registry);
  }
  async function deliver(device, payload, keys) {
    try {
      return await sender(providerDevice(device), payload, {
        vapid: keys,
        env,
        timeoutMs: 8000,
        ttl: 86400,
      });
    } catch {
      return { ok: false, permanent: false, code: "delivery-failed" };
    }
  }
  async function test({ authorize, deviceId }) {
    identifier(deviceId);
    const claim = await store.transaction(async (tx) => {
      const user = await authorize(tx),
        registry = await readRegistry(tx),
        ready = readiness(registry);
      const device = registry.devices.find(
        (entry) =>
          record(entry) && entry.id === deviceId && entry.userId === user.id,
      );
      if (!device) throw new AppError("notificationDeviceMissing", 404);
      if (!validatePushDevice(providerDevice(device), { now: clock() }))
        throw new AppError("invalidNotificationDevice");
      if (!ready.providers[device.kind])
        throw new AppError("notificationDeliveryUnavailable", 503);
      if (device.lastTestAt && clock() - device.lastTestAt < TEST_INTERVAL_MS)
        throw new AppError("notificationTestLimited", 429);
      device.lastTestAt = clock();
      await saveRegistry(tx, registry);
      return { device: structuredClone(device), keys: ready.keys };
    });
    const payload = {
      title: "Shepards Tyre Management",
      body:
        claim.device.language === "hi"
          ? "सूचनाएँ काम कर रही हैं।"
          : "Notifications are working.",
      tag: "shepards-test",
      url: "/?reminders=1",
      data: { kind: "test" },
    };
    const result = await deliver(claim.device, payload, claim.keys);
    if (result?.permanent)
      await store.transaction(async (tx) => {
        const registry = await readRegistry(tx);
        registry.devices = registry.devices.filter(
          (device) => record(device) && device.id !== claim.device.id,
        );
        await saveRegistry(tx, registry);
      });
    if (!result?.ok) throw new AppError("notificationDeliveryUnavailable", 503);
    return { ok: true };
  }
  async function dispatch(authorization) {
    if (!secretConfigured(env))
      throw new AppError("notificationCronUnavailable", 503);
    const supplied =
      typeof authorization === "string" &&
      authorization.match(/^Bearer (.{1,512})$/)?.[1];
    if (!supplied || !timingSafeEqual(hash(supplied), hash(env.CRON_SECRET)))
      throw new AppError("unauthorized", 401);
    const day = indiaDay(clock()),
      attempted = new Set(),
      deadline = performance.now() + 270000;
    const summary = {
      sent: 0,
      failed: 0,
      skipped: 0,
      removed: 0,
      unavailable: 0,
    };
    async function claimBatch() {
      return store.transaction(async (tx) => {
        const registry = await readRegistry(tx),
          ready = readiness(registry);
        // Work recorded while a cron is running must affect later claims.
        const state = JSON.parse(
          (await tx.get("SELECT value FROM settings WHERE key='state'"))?.value,
        );
        const selected = [];
        const kept = [];
        const activeUsers = new Set(
          (await tx.all("SELECT id FROM users WHERE active=1")).map(
            (user) => user.id,
          ),
        );
        for (const device of registry.devices) {
          if (
            !record(device) ||
            !Number.isSafeInteger(device.userId) ||
            !validatePushDevice(providerDevice(device), { now: clock() })
          ) {
            summary.removed++;
            continue;
          }
          if (!activeUsers.has(device.userId)) {
            summary.removed++;
            continue;
          }
          kept.push(device);
          if (
            selected.length === 20 ||
            attempted.has(device.id) ||
            device.lastSuccessDay === day ||
            device.claim?.until > clock()
          )
            continue;
          attempted.add(device.id);
          if (!ready.providers[device.kind]) {
            summary.unavailable++;
            continue;
          }
          if (
            !Array.isArray(device.categories) ||
            device.categories.some(
              (category) => !notificationCategories.includes(category),
            ) ||
            !["en", "hi"].includes(device.language)
          ) {
            summary.skipped++;
            continue;
          }
          const digest = reminderDigest(state, {
            today: day,
            language: device.language,
            categories: device.categories,
          });
          if (!digest.total) {
            summary.skipped++;
            continue;
          }
          device.claim = { id: randomUUID(), day, until: clock() + LEASE_MS };
          selected.push({
            device: structuredClone(device),
            keys: ready.keys,
            payload: digest.payload,
          });
        }
        registry.devices = kept;
        await saveRegistry(tx, registry);
        return selected;
      });
    }
    while (
      performance.now() < deadline - 9000 &&
      attempted.size < MAX_DEVICES
    ) {
      const batch = await claimBatch();
      if (!batch.length) break;
      // Recheck the whole batch immediately before network I/O. A logout,
      // removed account, rebound destination or completed check cancels it.
      const allowed = await store.transaction(async (tx) => {
        const registry = await readRegistry(tx);
        const state = JSON.parse(
          (await tx.get("SELECT value FROM settings WHERE key='state'"))?.value,
        );
        const activeUsers = new Set(
          (await tx.all("SELECT id FROM users WHERE active=1")).map(
            (user) => user.id,
          ),
        );
        return batch.map((claim) => {
          const current = registry.devices.find(
            (device) =>
              record(device) &&
              device.id === claim.device.id &&
              device.claim?.id === claim.device.claim.id,
          );
          if (!current || !activeUsers.has(current.userId)) return null;
          const digest = reminderDigest(state, {
            today: day,
            language: current.language,
            categories: current.categories,
          });
          return digest.total ? digest.payload : null;
        });
      });
      const results = await Promise.all(
        batch.map(async (claim, index) => ({
          claim,
          result: allowed[index]
            ? await deliver(claim.device, allowed[index], claim.keys)
            : { ok: false, skipped: true },
        })),
      );
      await store.transaction(async (tx) => {
        const registry = await readRegistry(tx);
        for (const { claim, result } of results) {
          const device = registry.devices.find(
            (entry) => entry?.id === claim.device.id,
          );
          if (!device || device.claim?.id !== claim.device.claim.id) continue;
          if (result?.ok) {
            device.lastSuccessDay = day;
            delete device.claim;
            summary.sent++;
          } else if (result?.permanent) {
            registry.devices = registry.devices.filter(
              (entry) => record(entry) && entry.id !== device.id,
            );
            summary.removed++;
          } else {
            delete device.claim;
            if (result?.skipped) summary.skipped++;
            else summary.failed++;
          }
        }
        await saveRegistry(tx, registry);
      });
    }
    const remaining = await store.transaction(async (tx) => {
      const registry = await readRegistry(tx),
        ready = readiness(registry);
      const state = JSON.parse(
        (await tx.get("SELECT value FROM settings WHERE key='state'"))?.value,
      );
      const activeUsers = new Set(
        (await tx.all("SELECT id FROM users WHERE active=1")).map(
          (user) => user.id,
        ),
      );
      return registry.devices.filter(
        (device) =>
          record(device) &&
          activeUsers.has(device.userId) &&
          device.lastSuccessDay !== day &&
          ready.providers[device.kind] &&
          validatePushDevice(providerDevice(device), { now: clock() }) &&
          Array.isArray(device.categories) &&
          device.categories.every((category) =>
            notificationCategories.includes(category),
          ) &&
          ["en", "hi"].includes(device.language) &&
          reminderDigest(state, {
            today: day,
            language: device.language,
            categories: device.categories,
          }).total > 0,
      ).length;
    });
    return { ok: true, ...summary, remaining };
  }
  return {
    status,
    enroll,
    revokeBySessionHash,
    test,
    dispatch,
    cleanupBindings,
  };
}
