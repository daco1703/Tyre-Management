import {
  notificationCategories,
  localReminderPlan,
  localReminderIdRange,
  isReminderNotificationId,
  reminderDigest,
} from "../shared/notification-reminders.js";
import { dayKey } from "../shared/model.js";
import { registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";

const INDEX = "ts-notification-device";
const TEST_ID = localReminderIdRange.max;
const validCategories = (value) =>
  Array.isArray(value) &&
  value.every((key) => notificationCategories.includes(key));
const categoriesOf = (value) =>
  notificationCategories.filter((key) => value.includes(key));
const owned = (id) => isReminderNotificationId(Number(id));
const cancelled = () =>
  Object.assign(new Error("Notification operation cancelled"), {
    code: "cancelled",
  });
const failure = (code) => Object.assign(new Error(code), { code });
const noop = () => {};
function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
function identityOf(snapshot, origin) {
  if (!snapshot?.user?.id || !snapshot?.state) return null;
  try {
    const server = new URL(snapshot.server || origin).origin;
    return `${server}|${String(snapshot.user.id)}`;
  } catch {
    return null;
  }
}
function applicationKey(key) {
  const input = String(key || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const text = globalThis.atob(
    input.padEnd(Math.ceil(input.length / 4) * 4, "="),
  );
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

// No OS permission prompt occurs on construction, sync, status or cleanup.
// The permission-request methods are reached only through explicit enable().
export function createNotificationController({
  request,
  nativePlatform = "web",
  storage = defaultStorage(),
  getRegistration,
  plugins = {},
  nativePushConfigured,
  onNavigate = noop,
  navigator: browserNavigator = globalThis.navigator,
  Notification: BrowserNotification = globalThis.Notification,
  PushManager: BrowserPushManager = globalThis.PushManager,
  origin = globalThis.location?.origin || "",
  isStandalone = () =>
    browserNavigator?.standalone === true ||
    globalThis.matchMedia?.("(display-mode: standalone)").matches === true,
  now = () => new Date(),
  plan = localReminderPlan,
  timeoutMs = 8000,
} = {}) {
  const native = nativePlatform === "android" || nativePlatform === "ios";
  const listeners = new Set(),
    handles = [];
  let binding = null,
    latest = null,
    tail = Promise.resolve(),
    generation = 0;
  let aborter = new AbortController(),
    latestSync = 0,
    config = null,
    configAt = 0;
  let localPlugin,
    pushPlugin,
    localActionBound = false,
    remoteActionBound = false;
  let webMessageBound = false,
    pendingRegistrationCancel = noop;
  let explicitPermission = null;
  let view = {
    enabled: false,
    delivery: "off",
    reason: "notEnabled",
    permission: "unknown",
    categories: [...notificationCategories],
    scheduledCount: 0,
    lastSyncedAt: null,
    remoteAvailable: false,
    canTest: false,
    stale: false,
    busy: false,
    truncated: false,
  };
  const status = () => ({ ...view, categories: [...view.categories] });
  const emit = (patch) => {
    view = { ...view, ...patch };
    view.canTest =
      view.enabled &&
      view.permission === "granted" &&
      ["local", "remote"].includes(view.delivery);
    view.canDisable = !!(
      binding?.pref.enabled ||
      binding?.pref.deviceId ||
      binding?.pref.localAttempted ||
      binding?.pref.remoteAttempted ||
      view.reason === "cleanupPending"
    );
    for (const listener of listeners) {
      try {
        listener(status());
      } catch {}
    }
    return status();
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    listener(status());
    return () => listeners.delete(listener);
  };
  const enqueue = (operation) => {
    const task = tail.then(operation);
    tail = task.catch(noop);
    return task;
  };
  function bump() {
    generation++;
    aborter.abort();
    aborter = new AbortController();
    pendingRegistrationCancel();
    pendingRegistrationCancel = noop;
    return generation;
  }
  function current(ticket) {
    if (ticket !== generation) throw cancelled();
  }
  async function wait(task, ticket = generation, milliseconds = timeoutMs) {
    current(ticket);
    let timer, abort;
    const signal = aborter.signal;
    try {
      const result = await Promise.race([
        task,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(failure("connectionFailed")),
            milliseconds,
          );
        }),
        new Promise((_, reject) => {
          abort = () => reject(cancelled());
          signal.addEventListener("abort", abort, { once: true });
        }),
      ]);
      current(ticket);
      return result;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
  async function settle(task, milliseconds = 4000) {
    let timer;
    try {
      return await Promise.race([
        task,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(failure("connectionFailed")),
            milliseconds,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function read(key) {
    try {
      const text = storage?.getItem(key);
      if (key === INDEX && text?.startsWith("ts-notifications:")) return text;
      return JSON.parse(text || "null");
    } catch {
      return null;
    }
  }
  function persist(target = binding) {
    if (!target) return;
    try {
      if (!storage) throw new Error();
      storage.setItem(target.key, JSON.stringify(target.pref));
      if (
        target.pref.enabled ||
        target.pref.deviceId ||
        target.pref.localAttempted ||
        target.pref.remoteAttempted
      )
        storage.setItem(INDEX, JSON.stringify(target.key));
      else if (read(INDEX) === target.key) storage.removeItem(INDEX);
    } catch {
      throw failure("storageUnavailable");
    }
  }
  function local() {
    if (!localPlugin)
      localPlugin =
        plugins.local || plugins.LocalNotifications || LocalNotifications;
    return localPlugin;
  }
  function push() {
    if (!pushPlugin)
      pushPlugin =
        plugins.push || plugins.PushNotifications || PushNotifications;
    return pushPlugin;
  }
  async function appConfigured() {
    try {
      const result =
        nativePushConfigured === undefined
          ? await settle(registerPlugin("NotificationConfig").getStatus())
          : typeof nativePushConfigured === "function"
            ? await nativePushConfigured()
            : nativePushConfigured;
      return result === true || result?.configured === true;
    } catch {
      return false;
    }
  }
  function webReason() {
    const ios =
      /iPad|iPhone|iPod/i.test(browserNavigator?.userAgent || "") ||
      (browserNavigator?.platform === "MacIntel" &&
        browserNavigator?.maxTouchPoints > 1);
    if (ios && !isStandalone()) return "installRequired";
    if (
      !BrowserNotification ||
      (!getRegistration &&
        (!browserNavigator?.serviceWorker || !BrowserPushManager))
    )
      return "unsupported";
    return null;
  }
  async function registration(ticket) {
    if (getRegistration)
      return wait(Promise.resolve().then(getRegistration), ticket);
    const existing = await wait(
      browserNavigator.serviceWorker.getRegistration(),
      ticket,
    );
    return existing || wait(browserNavigator.serviceWorker.ready, ticket);
  }
  async function refreshConfig(ticket, force = false) {
    if (config && !force && Number(now()) - configAt < 60000) return config;
    const result = await request("/notifications/status", undefined, {
      timeoutMs: 4000,
    });
    current(ticket);
    config = result;
    configAt = Number(now());
    return result;
  }
  const remoteReady = (value) =>
    value?.cronConfigured === true &&
    (native
      ? value?.native?.[nativePlatform] === true
      : value?.web?.configured === true && !!value?.web?.vapidPublicKey);
  function message(event) {
    if (["fleet-reminders-open", "OPEN_REMINDERS"].includes(event.data?.type))
      onNavigate("dashboard");
  }
  async function bindActions(kind, ticket) {
    if (kind === "web") {
      if (!webMessageBound) {
        browserNavigator?.serviceWorker?.addEventListener?.("message", message);
        webMessageBound = true;
      }
    } else if (kind === "local" && !localActionBound) {
      const handle = await wait(
        local().addListener("localNotificationActionPerformed", (event) => {
          if (binding?.pref.enabled && owned(event.notification?.id))
            onNavigate("dashboard");
        }),
        ticket,
      );
      handles.push(handle);
      localActionBound = true;
    } else if (kind === "remote" && !remoteActionBound) {
      const handle = await wait(
        push().addListener("pushNotificationActionPerformed", (event) => {
          if (
            binding?.pref.enabled &&
            event.notification?.data?.kind === "reminders"
          )
            onNavigate("dashboard");
        }),
        ticket,
      );
      handles.push(handle);
      remoteActionBound = true;
    }
  }
  async function permission(plugin, field, ask, ticket) {
    const first =
      ask && explicitPermission?.ticket === ticket
        ? await wait(explicitPermission.task, ticket)
        : null;
    let value = first
      ? first.display || first.receive || first
      : (await wait(plugin.checkPermissions(), ticket))?.[field];
    if (value !== "granted" && value !== "denied" && ask)
      value = (await wait(plugin.requestPermissions(), ticket))?.[field];
    emit({ permission: value || "unknown" });
    if (value !== "granted")
      throw failure(
        value === "denied" ? "permissionDenied" : "permissionRequired",
      );
  }
  async function cancelLocal(
    target,
    ticket,
    delivered = true,
    detached = false,
  ) {
    if (!native) return;
    const waiting = (task) =>
      detached ? settle(task) : wait(task, ticket, 4000);
    const plugin = local();
    const known = target?.pref.plannedIds || [];
    const result = await waiting(plugin.getPending());
    const ids = [
      ...new Set([
        ...known,
        ...(result.notifications || [])
          .filter((item) => owned(item.id))
          .map((item) => item.id),
        TEST_ID,
      ]),
    ].filter(owned);
    if (ids.length)
      await waiting(
        plugin.cancel({ notifications: ids.map((id) => ({ id })) }),
      );
    if (
      delivered &&
      plugin.getDeliveredNotifications &&
      plugin.removeDeliveredNotifications
    ) {
      const shown = await waiting(plugin.getDeliveredNotifications());
      const ours = (shown.notifications || [])
        .filter((item) => owned(item.id))
        .map(({ id }) => ({ id }));
      if (ours.length)
        await waiting(
          plugin.removeDeliveredNotifications({ notifications: ours }),
        );
    }
    if (target) {
      // A cancelled future alarm was not delivered. It must be schedulable again
      // after a failed remote transition or a later explicit re-enable.
      for (const item of result.notifications || [])
        if (owned(item.id)) delete target.pref.receipts?.[item.id];
      target.pref.plannedIds = [];
      target.pref.plannedItems = [];
    }
  }
  async function unregisterDevice(target) {
    if (!target?.pref.deviceId) return true;
    // A failed old-account cleanup must never send its device ID with a later
    // account's credentials and mistake that account's 404 for successful removal.
    const owner = target.identity || target.pref.identity;
    const active = identityOf(latest, origin);
    if (owner && active && owner !== active) return false;
    try {
      await request(
        "/notifications/unsubscribe",
        { deviceId: target.pref.deviceId },
        { timeoutMs: 4000 },
      );
      target.pref.deviceId = null;
      return true;
    } catch (error) {
      if (error.status === 404) {
        target.pref.deviceId = null;
        return true;
      }
      return false;
    }
  }
  async function teardown(target, ticket) {
    let complete = true;
    const localHistory = !!(
      target?.pref.localAttempted ||
      target?.pref.delivery === "local" ||
      target?.pref.plannedIds?.length ||
      Object.keys(target?.pref.receipts || {}).length
    );
    const remoteHistory = !!(
      target?.pref.remoteAttempted ||
      target?.pref.deviceId ||
      target?.pref.delivery === "remote"
    );
    if (target) {
      target.pref.enabled = false;
      try {
        persist(target);
      } catch {
        complete = false;
      }
    }
    const registryGone = await unregisterDevice(target);
    let osRemoteGone = false;
    if (native) {
      if (localHistory || remoteHistory)
        try {
          await cancelLocal(target, ticket, true, true);
        } catch {
          complete = false;
        }
      // Calling Firebase's unregister in an unconfigured Android build is unsafe.
      if (remoteHistory && (await appConfigured())) {
        try {
          const plugin = push();
          // Capacitor resolves unregister before provider token deletion is
          // confirmed (FCM), and APNs may reuse the same token. Native logout
          // therefore still needs confirmed removal of its server binding.
          if (plugin.unregister) await settle(plugin.unregister());
        } catch {}
      }
    } else if (remoteHistory) {
      try {
        const reg = await settle(
          getRegistration
            ? Promise.resolve().then(getRegistration)
            : browserNavigator?.serviceWorker?.getRegistration?.(),
        );
        const sub = await settle(reg?.pushManager?.getSubscription?.());
        osRemoteGone = !sub || (await settle(sub.unsubscribe())) !== false;
      } catch {}
    }
    // Either revocation path makes the old remote channel unusable. Local
    // alarm cancellation is still mandatory, even when the server is offline.
    if (!registryGone && !osRemoteGone) complete = false;
    if (target && (registryGone || osRemoteGone)) target.pref.deviceId = null;
    for (const handle of handles.splice(0)) {
      try {
        await settle(handle?.remove?.());
      } catch {
        complete = false;
      }
    }
    localActionBound = remoteActionBound = false;
    if (webMessageBound)
      browserNavigator?.serviceWorker?.removeEventListener?.(
        "message",
        message,
      );
    webMessageBound = false;
    if (target) {
      target.pref.delivery = "off";
      if (complete) {
        target.pref.receipts = {};
        target.pref.plannedIds = [];
        target.pref.plannedItems = [];
        target.pref.localAttempted = false;
        target.pref.remoteAttempted = false;
      }
      try {
        persist(target);
      } catch {
        complete = false;
      }
    }
    return complete;
  }
  async function adopt(snapshot, ticket) {
    current(ticket);
    const identity = identityOf(snapshot, origin);
    if (!identity) throw failure("notEnabled");
    if (binding?.identity === identity) {
      binding.snapshot = snapshot;
      return binding;
    }
    if (binding && !(await teardown(binding, ticket)))
      throw failure("cleanupPending");
    const key = `ts-notifications:${encodeURIComponent(identity)}`;
    const priorKey = read(INDEX);
    if (priorKey && priorKey !== key) {
      const orphan = { key: priorKey, pref: read(priorKey) || {} };
      if (!(await teardown(orphan, ticket))) throw failure("cleanupPending");
    }
    current(ticket);
    const pref = read(key) || {};
    if (priorKey && priorKey !== key) pref.enabled = false;
    pref.categories = validCategories(pref.categories)
      ? categoriesOf(pref.categories)
      : [...notificationCategories];
    pref.receipts =
      pref.receipts &&
      typeof pref.receipts === "object" &&
      !Array.isArray(pref.receipts)
        ? pref.receipts
        : {};
    pref.identity = identity;
    binding = { key, identity, pref, snapshot, lastState: null };
    if (!pref.enabled && (pref.localAttempted || pref.remoteAttempted)) {
      if (!(await teardown(binding, ticket))) throw failure("cleanupPending");
    }
    emit({
      enabled: false,
      delivery: "off",
      reason: "notEnabled",
      categories: pref.categories,
      scheduledCount: 0,
      lastSyncedAt: pref.lastSyncedAt || null,
    });
    return binding;
  }
  async function enroll(target, payload, ticket, ask) {
    const body = {
      ...payload,
      language: target.snapshot.lang === "hi" ? "hi" : "en",
      categories: target.pref.categories,
      ...(target.pref.deviceId ? { deviceId: target.pref.deviceId } : {}),
    };
    const enrollmentKey = JSON.stringify([
      payload,
      body.language,
      body.categories,
    ]);
    if (
      target.pref.deviceId &&
      target.pref.delivery === "remote" &&
      target.enrollmentKey === enrollmentKey &&
      Number(now()) - target.enrolledAt < 3600000
    )
      return { deviceId: target.pref.deviceId, remoteDeliveryConfigured: true };
    let result;
    try {
      result = await request("/notifications/devices", body, {
        timeoutMs: 6000,
      });
    } catch (error) {
      if (error.status !== 404) throw error;
      if (!ask) throw failure("reEnrollmentRequired");
      // Restoring a database intentionally removes device registrations.
      // A deliberate Enable may enroll this same device again with its new ID.
      target.pref.deviceId = null;
      delete body.deviceId;
      result = await request("/notifications/devices", body, {
        timeoutMs: 6000,
      });
    }
    // Keep the result available to a queued logout even if its generation
    // changed while the server completed this enrollment.
    if (typeof result.deviceId === "string")
      target.pref.deviceId = result.deviceId;
    current(ticket);
    if (!result.deviceId || result.remoteDeliveryConfigured !== true)
      throw failure("serverNotReady");
    target.pref.delivery = "remote";
    target.enrollmentKey = enrollmentKey;
    target.enrolledAt = Number(now());
    return result;
  }
  async function remoteToken(plugin, ticket) {
    let resolveToken, rejectToken;
    const token = new Promise((resolve, reject) => {
      resolveToken = resolve;
      rejectToken = reject;
    });
    token.catch(noop);
    const eventHandles = [];
    try {
      eventHandles.push(
        await wait(
          plugin.addListener("registration", (event) => {
            if (typeof event.value === "string" && event.value)
              resolveToken(event.value);
            else rejectToken(failure("registrationFailed"));
          }),
          ticket,
        ),
      );
      eventHandles.push(
        await wait(
          plugin.addListener("registrationError", () =>
            rejectToken(failure("registrationFailed")),
          ),
          ticket,
        ),
      );
      pendingRegistrationCancel = () => rejectToken(cancelled());
      await wait(plugin.register(), ticket);
      return await wait(token, ticket);
    } finally {
      pendingRegistrationCancel = noop;
      for (const handle of eventHandles) {
        try {
          await handle.remove();
        } catch {}
      }
    }
  }
  async function reconcileLocal(target, ticket, ask) {
    const plugin = local();
    await permission(plugin, "display", ask, ticket);
    await bindActions("local", ticket);
    if (nativePlatform === "android" && plugin.createChannel)
      await wait(
        plugin.createChannel({
          id: "fleet-reminders",
          name: "Fleet reminders",
          importance: 3,
          visibility: 0,
        }),
        ticket,
      );
    const instant = now(),
      language = target.snapshot.lang === "hi" ? "hi" : "en";
    const pending =
      (await wait(plugin.getPending(), ticket)).notifications || [];
    const today = dayKey(instant);
    const digest = reminderDigest(target.snapshot.state, {
      today,
      language,
      categories: target.pref.categories,
    });
    // Retain an already queued, still-current catch-up instead of cancelling it
    // during an ordinary poll. Background sync never creates a new catch-up.
    const retained =
      !ask && digest.total
        ? (target.pref.plannedItems || []).find(
            (item) =>
              item.data?.day === today &&
              Date.parse(item.at) > Number(instant) &&
              item.title === digest.payload.title &&
              item.body === digest.payload.body &&
              owned(item.id),
          )
        : null;
    const result = plan(target.snapshot.state, {
      now: instant,
      language,
      categories: target.pref.categories,
      catchUp: ask,
      max: retained ? 49 : 50,
    });
    const items = [...(result?.items || [])];
    if (retained && !items.some((item) => item.id === retained.id))
      items.push(retained);
    if (
      !Array.isArray(items) ||
      items.length > 50 ||
      items.some(
        (item) =>
          !owned(item.id) ||
          item.id === TEST_ID ||
          !Number.isFinite(Date.parse(item.at)) ||
          Date.parse(item.at) <= Number(now()),
      )
    )
      throw failure("schedulingFailed");
    const ours = new Map(
      pending
        .filter((item) => owned(item.id) && item.id !== TEST_ID)
        .map((item) => [item.id, item]),
    );
    const fingerprints = new Map(
      items.map((item) => [
        item.id,
        JSON.stringify([
          item.id,
          item.title,
          item.body,
          item.data?.kind,
          item.data?.day,
        ]),
      ]),
    );
    const receipts = target.pref.receipts || {};
    const receiptFingerprint = (receipt) =>
      typeof receipt === "string" ? receipt : receipt?.fingerprint;
    const removed = [...ours.keys()].filter(
      (id) =>
        !fingerprints.has(id) ||
        receiptFingerprint(receipts[id]) !== fingerprints.get(id),
    );
    if (removed.length)
      await wait(
        plugin.cancel({ notifications: removed.map((id) => ({ id })) }),
        ticket,
      );
    const scheduled = items.filter((item) =>
      ours.has(item.id)
        ? receiptFingerprint(receipts[item.id]) !== fingerprints.get(item.id)
        : ask ||
          !receipts[item.id] ||
          Date.parse(receipts[item.id].at) > Number(instant),
    );
    if (scheduled.length) {
      target.pref.localAttempted = true;
      target.pref.plannedIds = [
        ...new Set([
          ...(target.pref.plannedIds || []),
          ...scheduled.map((item) => item.id),
        ]),
      ];
      persist(target);
      await wait(
        plugin.schedule({
          notifications: scheduled.map((item) => ({
            id: item.id,
            title: item.title,
            body: item.body,
            schedule: { at: new Date(item.at) },
            extra: item.data,
            ...(nativePlatform === "android"
              ? { channelId: "fleet-reminders", smallIcon: "ic_stat_tyre" }
              : {}),
          })),
        }),
        ticket,
      );
    }
    for (const item of items)
      receipts[item.id] = {
        fingerprint: fingerprints.get(item.id),
        at: item.at,
      };
    target.pref.receipts = Object.fromEntries(
      Object.entries(receipts).slice(-150),
    );
    target.pref.plannedIds = items.map((item) => item.id);
    target.pref.plannedItems = items;
    target.pref.delivery = "local";
    target.pref.enabled = true;
    persist(target);
    emit({
      enabled: true,
      delivery: "local",
      reason: "localScheduled",
      scheduledCount: items.length,
      stale: false,
      truncated: result.truncated === true,
    });
  }
  async function webRemote(target, ticket, ask) {
    const unsupported = webReason();
    if (unsupported) throw failure(unsupported);
    if (config && !remoteReady(config)) throw failure("serverNotReady");
    let permission = BrowserNotification.permission;
    // Deliberate click only; preserve Safari's user gesture before network work.
    if (ask && explicitPermission?.ticket === ticket)
      permission = await wait(explicitPermission.task, ticket);
    else if (permission === "default" && ask)
      permission = await wait(BrowserNotification.requestPermission(), ticket);
    emit({ permission });
    if (permission !== "granted")
      throw failure(
        permission === "denied" ? "permissionDenied" : "permissionRequired",
      );
    const server = await refreshConfig(ticket, ask);
    if (!remoteReady(server)) throw failure("serverNotReady");
    const reg = await registration(ticket);
    if (!reg?.pushManager) throw failure("unsupported");
    let subscription = await wait(reg.pushManager.getSubscription(), ticket);
    const expectedKey = applicationKey(server.web.vapidPublicKey);
    const installedKey = subscription?.options?.applicationServerKey;
    const actualBytes = installedKey
      ? new Uint8Array(
          installedKey.buffer || installedKey,
          installedKey.byteOffset || 0,
          installedKey.byteLength,
        )
      : null;
    const matchesKey = actualBytes
      ? actualBytes.length === expectedKey.length &&
        actualBytes.every((byte, index) => byte === expectedKey[index])
      : target.pref.vapidPublicKey === server.web.vapidPublicKey;
    if (subscription && !matchesKey) {
      if (!ask) throw failure("reEnrollmentRequired");
      if ((await wait(subscription.unsubscribe(), ticket)) === false)
        throw failure("cleanupPending");
      subscription = null;
    }
    if (!subscription) {
      target.pref.remoteAttempted = true;
      persist(target);
      const subscribing = Promise.resolve(
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationKey(server.web.vapidPublicKey),
        }),
      );
      subscribing.then((sub) => {
        if (ticket !== generation) void sub.unsubscribe().catch(noop);
      }, noop);
      subscription = await wait(subscribing, ticket);
    }
    await enroll(
      target,
      {
        kind: "web",
        subscription: subscription.toJSON
          ? subscription.toJSON()
          : subscription,
      },
      ticket,
      ask,
    );
    await bindActions("web", ticket);
    target.pref.enabled = true;
    target.pref.delivery = "remote";
    target.pref.vapidPublicKey = server.web.vapidPublicKey;
    persist(target);
    emit({
      enabled: true,
      delivery: "remote",
      reason: "remoteEnabled",
      scheduledCount: 0,
      remoteAvailable: true,
      stale: false,
    });
  }
  async function activate(target, ticket, ask) {
    if (!target.pref.categories.length) throw failure("noCategories");
    if (!native) return webRemote(target, ticket, ask);
    let server;
    try {
      server = await refreshConfig(ticket, ask);
    } catch (error) {
      if (error.code === "cancelled") throw error;
      server = null;
    }
    current(ticket);
    const ready = remoteReady(server) && (await appConfigured());
    emit({ remoteAvailable: !!ready });
    if (ready) {
      try {
        const plugin = push();
        await permission(plugin, "receive", ask, ticket);
        target.pref.remoteAttempted = true;
        persist(target);
        let token = target.remoteToken;
        if (!token || !(Number(now()) - target.tokenAt < 3600000)) {
          token = await remoteToken(plugin, ticket);
          target.tokenAt = Number(now());
        }
        target.remoteToken = token;
        await cancelLocal(target, ticket);
        await enroll(target, { kind: nativePlatform, token }, ticket, ask);
        await bindActions("remote", ticket);
        target.pref.enabled = true;
        target.pref.delivery = "remote";
        persist(target);
        return emit({
          enabled: true,
          delivery: "remote",
          reason: "remoteEnabled",
          scheduledCount: 0,
          stale: false,
        });
      } catch (error) {
        if (
          ["cancelled", "permissionDenied", "permissionRequired"].includes(
            error.code,
          )
        )
          throw error;
        // Local fallback must never race an enrolled remote channel.
        const registryGone = await unregisterDevice(target);
        try {
          const plugin = push();
          if (plugin.unregister) await wait(plugin.unregister(), ticket);
        } catch {}
        target.remoteToken = null;
        if (!registryGone) throw failure("cleanupPending");
        target.pref.deviceId = null;
        emit({ remoteAvailable: false });
      }
    } else if (target.pref.deviceId && !(await unregisterDevice(target)))
      throw failure("cleanupPending");
    return reconcileLocal(target, ticket, ask);
  }
  async function processSnapshot(snapshot, ticket, ask, categories) {
    const target = await adopt(snapshot, ticket);
    if (categories !== undefined) {
      if (!validCategories(categories)) throw failure("noCategories");
      target.pref.categories = categoriesOf(categories);
    }
    target.snapshot = snapshot;
    emit({ categories: target.pref.categories });
    if (
      snapshot.online === false ||
      snapshot.fresh === false ||
      browserNavigator?.onLine === false
    ) {
      if (ask) throw failure("offlineSnapshot");
      return emit({ stale: true, reason: "offlineSnapshot" });
    }
    if (target.lastState !== snapshot.state) {
      target.pref.lastSyncedAt = snapshot.syncedAt || now().toISOString();
      target.lastState = snapshot.state;
    }
    emit({ lastSyncedAt: target.pref.lastSyncedAt, stale: false });
    if (!ask && !target.pref.enabled) {
      const reason = native ? "notEnabled" : webReason();
      try {
        const server = await refreshConfig(ticket);
        emit({ remoteAvailable: remoteReady(server) });
      } catch {}
      return emit({
        enabled: false,
        delivery: "off",
        reason: reason || "notEnabled",
      });
    }
    return activate(target, ticket, ask);
  }
  async function enable(snapshot) {
    latest = snapshot;
    const ticket = bump();
    // Create the permission request synchronously inside the user's click. In
    // particular, iOS Web Push rejects requests after an awaited network task.
    if (
      identityOf(snapshot, origin) &&
      snapshot.online !== false &&
      snapshot.fresh !== false &&
      browserNavigator?.onLine !== false &&
      (!snapshot.categories || snapshot.categories.length)
    ) {
      try {
        if (
          !native &&
          !webReason() &&
          BrowserNotification.permission === "default" &&
          (!config || remoteReady(config))
        ) {
          explicitPermission = {
            ticket,
            task: Promise.resolve(BrowserNotification.requestPermission()),
          };
        } else if (native && view.permission !== "denied") {
          const plugin =
            plugins.local || plugins.LocalNotifications || LocalNotifications;
          explicitPermission = {
            ticket,
            task: Promise.resolve(plugin.checkPermissions()).then((checked) =>
              ["granted", "denied"].includes(checked.display)
                ? checked
                : plugin.requestPermissions(),
            ),
          };
        }
        explicitPermission?.task.catch(noop);
      } catch (error) {
        explicitPermission = { ticket, task: Promise.reject(error) };
        explicitPermission.task.catch(noop);
      }
    }
    return enqueue(async () => {
      if (ticket !== generation) return status();
      emit({ busy: true });
      try {
        if (explicitPermission?.ticket === ticket)
          await wait(explicitPermission.task, ticket);
        // Save consent only after a real subscription or schedule succeeds.
        const target = await adopt(snapshot, ticket);
        persist(target);
        if (Array.isArray(snapshot.categories) && !snapshot.categories.length) {
          target.pref.categories = [];
          const complete = await teardown(target, ticket);
          return emit({
            enabled: false,
            delivery: "off",
            categories: [],
            reason: complete ? "noCategories" : "cleanupPending",
            scheduledCount: 0,
          });
        }
        await processSnapshot(
          latest && identityOf(latest, origin) === target.identity
            ? { ...latest, categories: snapshot.categories }
            : snapshot,
          ticket,
          true,
          snapshot.categories,
        );
      } catch (error) {
        if (error.code !== "cancelled") {
          if (binding) {
            binding.pref.enabled = false;
            try {
              await teardown(binding, ticket);
            } catch {}
          }
          emit({
            enabled: false,
            delivery: "off",
            scheduledCount: 0,
            reason: error.code || "registrationFailed",
          });
        }
      } finally {
        if (explicitPermission?.ticket === ticket) explicitPermission = null;
        if (ticket === generation) emit({ busy: false });
      }
      return status();
    });
  }
  function sync(snapshot) {
    latest = snapshot;
    const sequence = ++latestSync,
      ticket = generation;
    if (!identityOf(snapshot, origin)) return Promise.resolve(status());
    return enqueue(async () => {
      if (sequence !== latestSync || ticket !== generation) return status();
      try {
        await processSnapshot(snapshot, ticket, false);
      } catch (error) {
        if (error.code !== "cancelled") {
          if (
            binding?.pref.enabled &&
            binding.pref.delivery === "remote" &&
            ["notConnected", "connectionFailed", "serverUnavailable"].includes(
              error.code,
            )
          )
            emit({ stale: true, reason: "connectionFailed" });
          else
            emit({
              enabled: false,
              reason: error.code || "registrationFailed",
            });
        }
      }
      return status();
    });
  }
  function cleanup() {
    const ticket = bump();
    latestSync++;
    const target = binding;
    if (target) {
      target.pref.enabled = false;
      try {
        persist(target);
      } catch {}
    }
    emit({ enabled: false, canTest: false, busy: true });
    return enqueue(async () => {
      let complete = true;
      try {
        const orphanKey = !target && read(INDEX);
        const active =
          target ||
          (orphanKey ? { key: orphanKey, pref: read(orphanKey) || {} } : null);
        complete = await teardown(active, ticket);
      } catch {
        complete = false;
      }
      if (complete && binding === target) binding = null;
      config = null;
      configAt = 0;
      if (ticket === generation) {
        if (complete) latest = null;
        emit({
          enabled: false,
          delivery: "off",
          reason: complete ? "notEnabled" : "cleanupPending",
          scheduledCount: 0,
          busy: false,
          stale: false,
        });
      }
      return status();
    });
  }
  async function test() {
    const ticket = generation;
    return enqueue(async () => {
      if (!binding?.pref.enabled || !view.canTest) return status();
      emit({ busy: true });
      try {
        if (view.delivery === "remote")
          await request(
            "/notifications/test",
            { deviceId: binding.pref.deviceId },
            { timeoutMs: 6000 },
          );
        else {
          const plugin = local();
          await permission(plugin, "display", false, ticket);
          await wait(
            plugin.schedule({
              notifications: [
                {
                  id: TEST_ID,
                  title: "Shepards Tyre Management",
                  body:
                    binding.snapshot.lang === "hi"
                      ? "इस डिवाइस पर टेस्ट सूचना।"
                      : "Test notification on this device.",
                  schedule: { at: new Date(Number(now()) + 5000) },
                  extra: { kind: "reminders" },
                  ...(nativePlatform === "android"
                    ? {
                        channelId: "fleet-reminders",
                        smallIcon: "ic_stat_tyre",
                      }
                    : {}),
                },
              ],
            }),
            ticket,
          );
        }
        current(ticket);
        emit({ reason: "testSent" });
      } catch (error) {
        if (error.code !== "cancelled")
          emit({
            reason:
              error.code === "permissionDenied"
                ? "permissionDenied"
                : "testFailed",
          });
      } finally {
        if (ticket === generation) emit({ busy: false });
      }
      return status();
    });
  }
  return { enable, disable: cleanup, cleanup, sync, status, subscribe, test };
}
