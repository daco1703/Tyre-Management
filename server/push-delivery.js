import crypto from "node:crypto";
import http2 from "node:http2";
import https from "node:https";
import * as webPush from "web-push";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const APNS_TOPIC = "in.tyresaathi.logbook";
const MAX_CACHE_ENTRIES = 32;
const oauthCache = new Map();
const apnsTokenCache = new Map();
const fetchIds = new WeakMap();
let nextFetchId = 0;

function base64url(value, length) {
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== length || decoded.toString("base64url") !== value.replace(/=+$/, "")) return null;
  return decoded;
}

function validPublicKey(value) {
  const decoded = base64url(value, 65);
  if (!decoded || decoded[0] !== 4) return false;
  try {
    crypto.ECDH.convertKey(decoded, "prime256v1");
    return true;
  } catch {
    return false;
  }
}

/** Push subscriptions are outbound destinations, so only known browser push services are accepted. */
export function validateWebPushEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\s\x00-\x1f\x7f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || url.hash) return null;
    const host = url.hostname;
    let allowed = false;
    if (host === "fcm.googleapis.com") {
      allowed = /^\/(?:fcm\/send|wp)\/[A-Za-z0-9_:.~-]+$/.test(url.pathname) && !url.search;
    } else if (host === "push.services.mozilla.com" || /^(?:[a-z0-9-]+\.)+push\.services\.mozilla\.com$/.test(host)) {
      allowed = /^\/wpush\/v[12]\/[A-Za-z0-9_.~-]+$/.test(url.pathname) && !url.search;
    } else if (host === "web.push.apple.com") {
      allowed = /^\/[A-Za-z0-9_~.\/-]+$/.test(url.pathname) && url.pathname.length > 1 && !url.search;
    } else if (/^[a-z0-9-]+\.notify\.windows\.com$/.test(host)) {
      // WNS endpoints carry their opaque token in the query string.
      allowed = (url.pathname === "/" || url.pathname === "/w/") && url.searchParams.size === 1
        && url.searchParams.has("token") && /^[A-Za-z0-9_~.+/=-]{1,1800}$/.test(url.searchParams.get("token"));
    }
    return allowed ? url.href : null;
  } catch {
    return null;
  }
}

/** Returns only provider fields; callers retain their own registry metadata separately. */
export function validatePushDevice(device, { now = Date.now() } = {}) {
  if (!device || typeof device !== "object" || Array.isArray(device)) return null;
  if (device.platform === "web") {
    const subscription = device.subscription;
    if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)) return null;
    const endpoint = validateWebPushEndpoint(subscription.endpoint);
    if (!endpoint || !validPublicKey(subscription.keys?.p256dh) || !base64url(subscription.keys?.auth, 16)) return null;
    const expirationTime = subscription.expirationTime ?? null;
    if (expirationTime !== null && (!Number.isSafeInteger(expirationTime) || expirationTime <= now)) return null;
    return { platform: "web", subscription: { endpoint, expirationTime, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } } };
  }
  if (device.platform === "android" && typeof device.token === "string" && /^[A-Za-z0-9_:-]{32,4096}$/.test(device.token)) {
    return { platform: "android", token: device.token };
  }
  if (device.platform === "ios" && typeof device.token === "string" && /^(?:[a-fA-F0-9]{2}){32,256}$/.test(device.token)) {
    return { platform: "ios", token: device.token.toLowerCase() };
  }
  return null;
}

function vapidConfig(value) {
  if (!value || !validPublicKey(value.publicKey) || !base64url(value.privateKey, 32)) return null;
  if (typeof value.subject !== "string" || value.subject.length > 512 || /[\s\x00-\x1f\x7f]/.test(value.subject)) return null;
  try {
    const subject = new URL(value.subject);
    if (subject.protocol === "mailto:") {
      if (!/^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(subject.pathname) || subject.search || subject.hash) return null;
    } else if (subject.protocol !== "https:" || subject.username || subject.password || subject.hash) return null;
    const key = crypto.createECDH("prime256v1");
    key.setPrivateKey(base64url(value.privateKey, 32));
    if (!key.getPublicKey().equals(base64url(value.publicKey, 65))) return null;
    return { subject: value.subject, publicKey: base64url(value.publicKey, 65).toString("base64url"), privateKey: base64url(value.privateKey, 32).toString("base64url") };
  } catch {
    return null;
  }
}

function environmentVapid(env) {
  return { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
}

function fcmConfig(env) {
  if (typeof env.FCM_SERVICE_ACCOUNT !== "string" || env.FCM_SERVICE_ACCOUNT.length > 65536) return null;
  try {
    const account = JSON.parse(env.FCM_SERVICE_ACCOUNT);
    if (typeof account.project_id !== "string" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(account.project_id)) return null;
    if (typeof account.client_email !== "string" || account.client_email.length > 254
      || !/^[A-Za-z0-9._-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(account.client_email)) return null;
    if (typeof account.private_key !== "string" || account.private_key.length > 16384) return null;
    const privateKey = crypto.createPrivateKey(account.private_key);
    if (privateKey.asymmetricKeyType !== "rsa" || privateKey.asymmetricKeyDetails?.modulusLength < 2048) return null;
    return { projectId: account.project_id, email: account.client_email, privateKey,
      cacheKey: crypto.createHash("sha256").update(JSON.stringify([account.project_id, account.client_email, account.private_key])).digest("hex") };
  } catch {
    return null;
  }
}

function apnsConfig(env) {
  if (typeof env.APNS_KEY !== "string" || env.APNS_KEY.length > 16384
    || !/^[A-Z0-9]{10}$/.test(env.APNS_TEAM_ID) || !/^[A-Z0-9]{10}$/.test(env.APNS_KEY_ID)
    || env.APNS_TOPIC !== APNS_TOPIC || !["sandbox", "production"].includes(env.APNS_ENVIRONMENT)) return null;
  try {
    const privateKey = crypto.createPrivateKey(env.APNS_KEY.replace(/\\n/g, "\n"));
    if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") return null;
    return { privateKey, teamId: env.APNS_TEAM_ID, keyId: env.APNS_KEY_ID, topic: APNS_TOPIC,
      cacheKey: crypto.createHash("sha256").update(env.APNS_TEAM_ID).update(env.APNS_KEY_ID)
        .update(privateKey.export({ type: "pkcs8", format: "der" })).digest("hex"),
      origin: env.APNS_ENVIRONMENT === "sandbox" ? "https://api.sandbox.push.apple.com:443" : "https://api.push.apple.com:443" };
  } catch {
    return null;
  }
}

export function providerStatus(env = process.env) {
  return { web: !!vapidConfig(environmentVapid(env)), android: !!fcmConfig(env), ios: !!apnsConfig(env) };
}

function safeText(value, fallback, maxLength) {
  return (typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim() : "").slice(0, maxLength) || fallback;
}

function safePayload(payload) {
  const value = payload && typeof payload === "object" ? payload : {};
  return {
    title: safeText(value.title, "Shepards Tyre Management", 80),
    body: safeText(value.body, "You have fleet reminders. Open the dashboard to review.", 240),
    tag: safeText(value.tag, "fleet-reminders", 64).replace(/[^A-Za-z0-9_.-]/g, "-"),
    url: value.url === "/" ? "/" : "/?reminders=1",
    data: { kind: "reminders", ...(typeof value.data?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.data.day) ? { day: value.data.day } : {}) },
  };
}

function failed(code, status, permanent = false) {
  return { ok: false, permanent, ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}), code };
}

function timeoutError() {
  return Object.assign(new Error("Push provider deadline exceeded"), { code: "PUSH_TIMEOUT" });
}

async function withDeadline(action, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => action(controller.signal)),
      new Promise((resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(timeoutError()); }, timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function jwt(header, claims, key, algorithm, options) {
  const unsigned = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  const signature = crypto.sign(algorithm, Buffer.from(unsigned), options ? { key, ...options } : key);
  return `${unsigned}.${signature.toString("base64url")}`;
}

async function jsonResponse(response) {
  const body = await response.text();
  if (body.length > 65536) throw new Error("Oversized push provider response");
  try { return JSON.parse(body); } catch { return {}; }
}

function oauthCacheKey(config, fetchClient) {
  if (!fetchIds.has(fetchClient)) fetchIds.set(fetchClient, ++nextFetchId);
  return `${fetchIds.get(fetchClient)}:${config.cacheKey}`;
}

async function oauthToken(config, fetchClient, signal, now) {
  const key = oauthCacheKey(config, fetchClient);
  const cached = oauthCache.get(key);
  if (cached && cached.expiresAt > now + 60000) return cached.token;
  oauthCache.delete(key);
  const issued = Math.floor(now / 1000);
  const assertion = jwt({ alg: "RS256", typ: "JWT" }, { iss: config.email, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat: issued, exp: issued + 3600 }, config.privateKey, "RSA-SHA256");
  const response = await fetchClient(GOOGLE_TOKEN_URL, {
    method: "POST", redirect: "error", signal,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  const result = await jsonResponse(response);
  if (!response.ok || typeof result.access_token !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(result.access_token)) {
    throw Object.assign(new Error("FCM authentication unavailable"), { code: "PUSH_AUTH", status: response.status });
  }
  const expiresIn = Number(result.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 60) {
    while (oauthCache.size >= MAX_CACHE_ENTRIES) oauthCache.delete(oauthCache.keys().next().value);
    oauthCache.set(key, { token: result.access_token, expiresAt: now + Math.min(expiresIn, 3600) * 1000 });
  }
  return result.access_token;
}

async function sendFcm(device, payload, config, { fetchClient, timeoutMs, ttl, now }) {
  return withDeadline(async (signal) => {
    const token = await oauthToken(config, fetchClient, signal, now);
    const response = await fetchClient(`https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`, {
      method: "POST", redirect: "error", signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { token: device.token,
        notification: { title: payload.title, body: payload.body },
        data: { title: payload.title, body: payload.body, tag: payload.tag, url: payload.url, ...payload.data },
        android: { priority: "high", ttl: `${ttl}s`, notification: { channel_id: "fleet-reminders", tag: payload.tag, icon: "ic_stat_tyre", color: "#BD1018" } },
      } }),
    });
    // A revoked/expired cached OAuth token should be refreshed on the next attempt.
    if (response.status === 401) oauthCache.delete(oauthCacheKey(config, fetchClient));
    const result = await jsonResponse(response);
    if (response.ok) return { ok: true };
    const details = Array.isArray(result.error?.details) ? result.error.details : [];
    const errorCode = details.find((detail) => detail?.["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError")?.errorCode;
    const invalidToken = errorCode === "UNREGISTERED"
      || (errorCode === "INVALID_ARGUMENT" && /registration token.*(?:invalid|not (?:a )?valid)|(?:invalid|not (?:a )?valid).*registration token/i.test(String(result.error?.message || "")));
    // Permission, project, payload and credential errors must never delete otherwise valid devices.
    return failed(invalidToken && ![401, 403, 429].includes(response.status) && response.status < 500 ? "invalid-token" : "fcm-error", response.status,
      invalidToken && ![401, 403, 429].includes(response.status) && response.status < 500);
  }, timeoutMs);
}

function sendApns(device, payload, config, { http2Connect, timeoutMs, ttl, now }) {
  // APNs rejects overly frequent provider-token updates; reuse for less than its one-hour validity.
  let cached = apnsTokenCache.get(config.cacheKey);
  if (!cached || cached.issuedAt > now + 30000 || cached.expiresAt <= now + 60000) {
    const token = jwt({ alg: "ES256", kid: config.keyId }, { iss: config.teamId, iat: Math.floor(now / 1000) }, config.privateKey, "SHA256", { dsaEncoding: "ieee-p1363" });
    cached = { token, issuedAt: now, expiresAt: now + 50 * 60000 };
    apnsTokenCache.delete(config.cacheKey);
    while (apnsTokenCache.size >= MAX_CACHE_ENTRIES) apnsTokenCache.delete(apnsTokenCache.keys().next().value);
    apnsTokenCache.set(config.cacheKey, cached);
  }
  const bearer = cached.token;
  return new Promise((resolve) => {
    let client;
    let stream;
    let settled = false;
    let status;
    let body = "";
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { stream?.close(); } catch { /* Already closed. */ }
      try { client?.close(); client?.destroy(); } catch { /* Already closed. */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish(failed("timeout")), timeoutMs);
    try {
      client = http2Connect(config.origin, { rejectUnauthorized: true });
      client.on("error", () => finish(failed("transport-error")));
      stream = client.request({ ":method": "POST", ":path": `/3/device/${device.token}`,
        authorization: `bearer ${bearer}`, "apns-topic": config.topic, "apns-push-type": "alert", "apns-priority": "10",
        "apns-expiration": String(Math.floor(now / 1000) + ttl), "apns-collapse-id": payload.tag,
        "content-type": "application/json" });
      stream.setEncoding("utf8");
      stream.on("response", (headers) => { status = Number(headers[":status"]); });
      stream.on("data", (chunk) => {
        body += chunk;
        if (body.length > 65536) finish(failed("provider-response-invalid", status));
      });
      stream.on("error", () => finish(failed("transport-error", status)));
      stream.on("aborted", () => finish(failed("transport-error", status)));
      stream.on("end", () => {
        if (status === 200) return finish({ ok: true });
        let reason;
        try { reason = JSON.parse(body).reason; } catch { /* Malformed errors remain retryable. */ }
        if (status === 403 && reason === "ExpiredProviderToken") apnsTokenCache.delete(config.cacheKey);
        // BadDeviceToken also means the server chose the wrong APNs environment.
        // Only Apple's explicit unregistration response can safely retire a token.
        const permanent = status === 410 && reason === "Unregistered";
        finish(failed(permanent ? "invalid-token" : "apns-error", status, permanent));
      });
      stream.end(JSON.stringify({ aps: { alert: { title: payload.title, body: payload.body }, sound: "default", "thread-id": "fleet-reminders" },
        url: payload.url, tag: payload.tag, ...payload.data }));
    } catch {
      finish(failed("transport-error"));
    }
  });
}

/** Transport injection is for isolated tests; credentials and provider responses never escape this module. */
export async function sendNotification(device, payload, options = {}) {
  const validated = validatePushDevice(device);
  if (!validated) return failed("invalid-device", undefined, true);
  const env = options.env || process.env;
  const timeoutMs = Math.max(100, Math.min(10000, Number(options.timeoutMs) || 8000));
  const requestedTtl = Number(options.ttl);
  const ttl = Math.max(0, Math.min(86400, Math.floor(Number.isFinite(requestedTtl) ? requestedTtl : 3600)));
  const now = typeof options.now === "function" ? options.now() : Date.now();
  const safe = safePayload(payload);
  try {
    if (validated.platform === "web") {
      const vapid = vapidConfig(options.vapid ?? environmentVapid(env));
      if (!vapid) return failed("provider-not-configured");
      const client = options.webPushClient || webPush;
      // Own the sockets so the overall deadline also aborts a stalled DNS/TLS connection.
      const agent = new https.Agent({ keepAlive: false, rejectUnauthorized: true });
      let response;
      try {
        response = await withDeadline((signal) => {
          signal.addEventListener("abort", () => agent.destroy(), { once: true });
          return client.sendNotification(validated.subscription, JSON.stringify(safe), { vapidDetails: vapid, TTL: ttl, timeout: timeoutMs, agent });
        }, timeoutMs);
      } finally {
        agent.destroy();
      }
      const status = response?.statusCode;
      if (status && (status < 200 || status >= 300)) return failed(status >= 300 && status < 400 ? "provider-redirect" : "web-push-error", status, status === 404 || status === 410);
      return { ok: true };
    }
    if (validated.platform === "android") {
      const config = fcmConfig(env);
      if (!config) return failed("provider-not-configured");
      return await sendFcm(validated, safe, config, { fetchClient: options.fetch || globalThis.fetch, timeoutMs, ttl, now });
    }
    const config = apnsConfig(env);
    if (!config) return failed("provider-not-configured");
    return await sendApns(validated, safe, config, { http2Connect: options.http2Connect || http2.connect, timeoutMs, ttl, now });
  } catch (error) {
    if (error?.code === "PUSH_TIMEOUT" || error?.name === "AbortError") return failed("timeout");
    if (error?.code === "PUSH_AUTH") return failed("provider-authentication", error.status);
    const status = error?.statusCode;
    return failed(validated.platform === "web" ? "web-push-error" : "transport-error", status, validated.platform === "web" && (status === 404 || status === 410));
  }
}
