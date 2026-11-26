import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { generateRequestDetails } from "web-push";
import { providerStatus, sendNotification, validatePushDevice, validateWebPushEndpoint } from "../server/push-delivery.js";

const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const appleKey = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const account = {
  project_id: "fleet-project", client_email: "push@fleet-project.iam.gserviceaccount.com",
  private_key: rsa.privateKey.export({ type: "pkcs8", format: "pem" }),
  token_uri: "https://attacker.example/steal-credentials",
};
const native = { platform: "android", token: "fcm_" + "a".repeat(100) };
const ios = { platform: "ios", token: "ab".repeat(32) };
const nativeEnv = { FCM_SERVICE_ACCOUNT: JSON.stringify(account) };
const appleEnv = {
  APNS_KEY: appleKey.privateKey.export({ type: "pkcs8", format: "pem" }),
  APNS_TEAM_ID: "TEAM123456", APNS_KEY_ID: "KEY1234567", APNS_TOPIC: "in.tyresaathi.logbook", APNS_ENVIRONMENT: "sandbox",
};
const payload = { title: "Shepards Tyre Management", body: "Inspections: 2", tag: "shepards-reminders-2026-11-25", url: "/?reminders=1", data: { kind: "reminders", day: "2026-11-25" } };

function vapidPair(privateBytes) {
  const key = crypto.createECDH("prime256v1");
  if (privateBytes) key.setPrivateKey(privateBytes);
  else key.generateKeys();
  // ECDH returns a minimal-width scalar; VAPID requires its full 32-byte width.
  const scalar = key.getPrivateKey();
  const padded = Buffer.concat([Buffer.alloc(32 - scalar.length), scalar]);
  return { publicKey: key.getPublicKey().toString("base64url"), privateKey: padded.toString("base64url"), subject: "mailto:admin@example.com" };
}
const vapid = vapidPair();
function webDevice() {
  return { platform: "web", subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/browser_token", expirationTime: null,
    keys: { p256dh: vapid.publicKey, auth: crypto.randomBytes(16).toString("base64url") } } };
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function parseJwt(value) {
  const [header, claims, signature] = value.split(".");
  return { header: JSON.parse(Buffer.from(header, "base64url")), claims: JSON.parse(Buffer.from(claims, "base64url")),
    signature: Buffer.from(signature, "base64url"), unsigned: `${header}.${claims}` };
}
function apnsTransport({ status = 200, reason, hang = false, fail = false } = {}) {
  const state = {};
  state.connect = (origin, options) => {
    state.origin = origin;
    state.options = options;
    const client = new EventEmitter();
    state.client = client;
    client.close = () => { state.closed = true; };
    client.destroy = () => { state.destroyed = true; };
    client.request = (headers) => {
      state.headers = headers;
      const stream = new EventEmitter();
      state.stream = stream;
      stream.setEncoding = () => {};
      stream.close = () => { state.streamClosed = true; };
      stream.end = (body) => {
        state.payload = JSON.parse(body);
        if (hang) return;
        queueMicrotask(() => {
          if (fail) return stream.emit("error", new Error("transport failed with private details"));
          stream.emit("response", { ":status": status });
          if (reason) stream.emit("data", JSON.stringify({ reason }));
          stream.emit("end");
        });
      };
      return stream;
    };
    return client;
  };
  return state;
}

test("push endpoints allow only known HTTPS browser services and expected paths", () => {
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/browser_token", "https://fcm.googleapis.com:443/wp/browser_token",
    "https://updates.push.services.mozilla.com/wpush/v2/browser_token", "https://push.services.mozilla.com/wpush/v1/token",
    "https://web.push.apple.com/QH/browser_token", "https://wns2-test.notify.windows.com/?token=opaque%2Btoken%3D",
  ]) assert.ok(validateWebPushEndpoint(endpoint), endpoint);
  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/token", "https://fcm.googleapis.com:8443/fcm/send/token",
    "https://localhost/push", "https://127.0.0.1/push", "https://[::1]/push", "https://10.0.0.1/push",
    "https://fcm.googleapis.com.attacker.example/fcm/send/token", "https://custom.example/push",
    "https://user:password@fcm.googleapis.com/fcm/send/token", "https://fcm.googleapis.com/fcm/send/token#fragment",
    "https://fcm.googleapis.com/fcm/send/token?redirect=https://127.0.0.1", "https://fcm.googleapis.com/redirect",
    "https://fcm.googleapis.com/fcm/send/%2f%2e%2e", "https://fcm.googleapis.com\\@localhost/fcm/send/token",
    "https://updates.push.services.mozilla.com/not-push/token", "https://evil.notify.windows.com/?url=https://localhost",
    "https://evil.notify.windows.com/?token=one&token=two", " https://web.push.apple.com/token", "https://web.push.apple.com/token\n",
  ]) assert.equal(validateWebPushEndpoint(endpoint), null, endpoint);
});

test("registration validates browser crypto, expiry, APNs hex and native token formats", () => {
  const device = webDevice();
  assert.ok(validatePushDevice(device));
  assert.equal(validatePushDevice({ ...device, subscription: { ...device.subscription, expirationTime: Date.now() - 1 } }), null);
  assert.equal(validatePushDevice({ ...device, subscription: { ...device.subscription, expirationTime: "tomorrow" } }), null);
  for (const keys of [
    { ...device.subscription.keys, auth: crypto.randomBytes(15).toString("base64url") },
    { ...device.subscription.keys, p256dh: Buffer.alloc(65).toString("base64url") },
    { ...device.subscription.keys, p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString("base64url") },
    { ...device.subscription.keys, auth: "a".repeat(1000) },
  ]) assert.equal(validatePushDevice({ ...device, subscription: { ...device.subscription, keys } }), null);
  assert.ok(validatePushDevice(native));
  assert.equal(validatePushDevice({ ...native, token: "https://attacker.example/push" }), null);
  assert.equal(validatePushDevice({ ...native, token: native.token + "\n" }), null);
  assert.equal(validatePushDevice({ ...native, token: "a".repeat(4097) }), null);
  assert.equal(validatePushDevice({ platform: "ios", token: "AB".repeat(32) }).token, ios.token);
  assert.equal(validatePushDevice({ ...ios, token: "ab".repeat(31) }), null);
  assert.ok(validatePushDevice({ ...ios, token: "ab".repeat(256) }));
  assert.equal(validatePushDevice({ ...ios, token: "ab".repeat(257) }), null);
  assert.equal(validatePushDevice({ ...ios, token: "a".repeat(65) }), null);
});

test("provider status validates complete credentials and discloses only booleans", () => {
  assert.deepEqual(providerStatus({}), { web: false, android: false, ios: false });
  const env = { ...nativeEnv, ...appleEnv, VAPID_SUBJECT: vapid.subject, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey };
  assert.deepEqual(providerStatus(env), { web: true, android: true, ios: true });
  assert.equal(providerStatus({ ...env, VAPID_PRIVATE_KEY: vapidPair().privateKey }).web, false);
  assert.equal(providerStatus({ ...env, VAPID_PRIVATE_KEY: "" }).web, false);
  assert.equal(providerStatus({ ...env, FCM_SERVICE_ACCOUNT: JSON.stringify({ ...account, project_id: "../../other" }) }).android, false);
  assert.equal(providerStatus({ ...env, FCM_SERVICE_ACCOUNT: JSON.stringify({ ...account, private_key: appleEnv.APNS_KEY }) }).android, false);
  assert.equal(providerStatus({ ...env, APNS_TOPIC: "other.app" }).ios, false);
  assert.equal(providerStatus({ ...env, APNS_ENVIRONMENT: "https://attacker.example" }).ios, false);
  assert.equal(providerStatus({ ...env, APNS_KEY: account.private_key }).ios, false);
  assert.match(JSON.stringify(providerStatus(env)), /^\{"web":true,"android":true,"ios":true\}$/);
});

test("VAPID fixtures preserve a leading zero while production validation still requires 32 bytes", async () => {
  const scalar = Buffer.alloc(31, 1);
  const leadingZero = vapidPair(scalar);
  assert.deepEqual(Buffer.from(leadingZero.privateKey, "base64url"), Buffer.concat([Buffer.from([0]), scalar]));
  const statusFor = (pair) => providerStatus({ VAPID_SUBJECT: pair.subject, VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY: pair.privateKey }).web;
  assert.equal(statusFor(leadingZero), true);
  assert.equal(statusFor({ ...leadingZero, privateKey: scalar.toString("base64url") }), false);
  let prepared = false;
  const result = await sendNotification(webDevice(), payload, { vapid: leadingZero, webPushClient: {
    sendNotification: async (subscription, body, options) => {
      const details = generateRequestDetails(subscription, body, options);
      assert.ok(Buffer.isBuffer(details.body));
      prepared = true;
      return { statusCode: 201 };
    },
  } });
  assert.deepEqual(result, { ok: true });
  assert.equal(prepared, true);
});

test("missing or malformed credentials fail explicitly without attempting outbound delivery", async () => {
  const unexpected = () => { throw new Error("must not send"); };
  for (const device of [webDevice(), native, ios]) {
    assert.deepEqual(await sendNotification(device, payload, { env: {}, fetch: unexpected, http2Connect: unexpected, webPushClient: { sendNotification: unexpected } }),
      { ok: false, permanent: false, code: "provider-not-configured" });
  }
});

test("web sends isolate VAPID credentials per request and keep a bounded safe payload", async () => {
  const second = vapidPair();
  const calls = [];
  const webPushClient = { sendNotification: async (...args) => { calls.push(args); await new Promise((resolve) => setImmediate(resolve)); return { statusCode: 201 }; },
    setVapidDetails: () => assert.fail("process-global VAPID mutation") };
  const results = await Promise.all([
    sendNotification(webDevice(), { ...payload, title: "a".repeat(200), body: "b\n".repeat(400), url: "https://evil.example", data: { day: "2026-11-25", secret: "private" } }, { vapid, webPushClient, ttl: 999999 }),
    sendNotification(webDevice(), payload, { vapid: second, webPushClient, ttl: 0 }),
  ]);
  assert.deepEqual(results, [{ ok: true }, { ok: true }]);
  assert.deepEqual(calls[0][2].vapidDetails, vapid);
  assert.deepEqual(calls[1][2].vapidDetails, second);
  assert.equal(calls[0][2].TTL, 86400);
  assert.equal(calls[1][2].TTL, 0);
  assert.equal(calls[0][2].timeout, 8000);
  assert.equal(calls[0][2].agent.options.rejectUnauthorized, true);
  const safe = JSON.parse(calls[0][1]);
  assert.equal(safe.title.length, 80);
  assert.equal(safe.body.length, 240);
  assert.equal(safe.url, "/?reminders=1");
  assert.equal(safe.data.secret, undefined);
  assert.doesNotMatch(safe.body, /[\n\r]/);
});

test("web expires only gone subscriptions; redirects, credentials and timeouts remain retryable", async () => {
  for (const status of [401, 403, 404, 410, 429, 500]) {
    const result = await sendNotification(webDevice(), payload, { vapid, webPushClient: { sendNotification: async () => { throw Object.assign(new Error("secret provider error"), { statusCode: status }); } } });
    assert.equal(result.permanent, status === 404 || status === 410);
    assert.equal(result.status, status);
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  }
  assert.deepEqual(await sendNotification(webDevice(), payload, { vapid, webPushClient: { sendNotification: async () => ({ statusCode: 302 }) } }),
    { ok: false, permanent: false, status: 302, code: "provider-redirect" });
  let cancelled = false;
  assert.deepEqual(await sendNotification(webDevice(), payload, { vapid, timeoutMs: 100, webPushClient: { sendNotification: (device, value, options) => {
    const original = options.agent.destroy.bind(options.agent);
    options.agent.destroy = () => { cancelled = true; original(); };
    return new Promise(() => {});
  } } }),
    { ok: false, permanent: false, code: "timeout" });
  assert.equal(cancelled, true);
});

test("validated VAPID keys produce a real encrypted web-push request without an outbound send", async () => {
  const padded = { ...vapid, publicKey: vapid.publicKey + "=", privateKey: vapid.privateKey + "=" };
  let prepared = false;
  const webPushClient = { sendNotification: async (subscription, body, options) => {
    const details = generateRequestDetails(subscription, body, options);
    assert.equal(details.method, "POST");
    assert.equal(details.endpoint, subscription.endpoint);
    assert.ok(Buffer.isBuffer(details.body));
    assert.ok(details.headers.Authorization.startsWith("vapid "));
    assert.ok(details.body.length > 0);
    prepared = true;
    return { statusCode: 201 };
  } };
  assert.equal(providerStatus({ VAPID_SUBJECT: padded.subject, VAPID_PUBLIC_KEY: padded.publicKey, VAPID_PRIVATE_KEY: padded.privateKey }).web, true);
  assert.deepEqual(await sendNotification(webDevice(), payload, { vapid: padded, webPushClient }), { ok: true });
  assert.equal(prepared, true);
});

test("FCM signs a scoped RS256 assertion, ignores account token_uri and uses only fixed Google hosts", async () => {
  const calls = [];
  const fixedNow = Date.UTC(2026, 10, 25);
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return url.includes("oauth2") ? json({ access_token: "opaque-provider-token", expires_in: 3600 }) : json({ name: "projects/fleet-project/messages/delivery" });
  };
  assert.deepEqual(await sendNotification(native, payload, { env: nativeEnv, fetch, now: () => fixedNow }), { ok: true });
  assert.deepEqual(calls.map((call) => call.url), ["https://oauth2.googleapis.com/token", "https://fcm.googleapis.com/v1/projects/fleet-project/messages:send"]);
  for (const call of calls) assert.equal(call.options.redirect, "error");
  const assertion = new URLSearchParams(calls[0].options.body).get("assertion");
  const signed = parseJwt(assertion);
  assert.deepEqual(signed.header, { alg: "RS256", typ: "JWT" });
  assert.deepEqual(signed.claims, { iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: fixedNow / 1000, exp: fixedNow / 1000 + 3600 });
  assert.ok(crypto.verify("RSA-SHA256", Buffer.from(signed.unsigned), rsa.publicKey, signed.signature));
  const message = JSON.parse(calls[1].options.body).message;
  assert.equal(message.token, native.token);
  assert.equal(message.android.notification.channel_id, "fleet-reminders");
  assert.equal(message.android.notification.icon, "ic_stat_tyre");
  assert.ok(Object.values(message.data).every((value) => typeof value === "string"));
  assert.equal(message.data.url, "/?reminders=1");
  assert.equal(calls[1].options.headers.authorization, "Bearer opaque-provider-token");
  calls.length = 0;
  assert.deepEqual(await sendNotification(native, payload, { env: nativeEnv, fetch, now: () => fixedNow + 1000 }), { ok: true });
  assert.equal(calls.length, 1, "OAuth access token should be cached only inside its bounded expiry");
});

test("FCM invalid registration tokens expire, while auth/project/quota/server failures retain devices", async () => {
  for (const [status, errorCode, message, permanent] of [
    [404, "UNREGISTERED", "Requested entity was not found.", true],
    [400, "INVALID_ARGUMENT", "The registration token is not a valid FCM registration token", true],
    [400, "INVALID_ARGUMENT", "Payload has invalid field", false],
    [403, "SENDER_ID_MISMATCH", "Wrong Firebase project", false],
    [401, "UNREGISTERED", "Credentials rejected", false],
    [429, "QUOTA_EXCEEDED", "Try later", false], [503, "UNAVAILABLE", "Try later", false],
  ]) {
    const fetch = async (url) => url.includes("oauth2") ? json({ access_token: "token", expires_in: 3600 })
      : json({ error: { message, details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }] } }, status);
    const result = await sendNotification(native, payload, { env: nativeEnv, fetch });
    assert.equal(result.permanent, permanent, `${status} ${errorCode}`);
    assert.equal(result.status, status);
  }
});

test("FCM OAuth cache refreshes before expiry and after a rejected bearer token", async () => {
  let oauthCalls = 0;
  let rejectToken = false;
  let now = Date.UTC(2026, 10, 25);
  const fetch = async (url) => {
    if (url.includes("oauth2")) return json({ access_token: `token-${++oauthCalls}`, expires_in: 120 });
    return rejectToken ? json({ error: { message: "Bearer rejected" } }, 401) : json({ name: "sent" });
  };
  const send = () => sendNotification(native, payload, { env: nativeEnv, fetch, now: () => now });
  await send();
  now += 30000;
  await send();
  assert.equal(oauthCalls, 1);
  now += 40000;
  await send();
  assert.equal(oauthCalls, 2, "refresh with less than a minute of validity remaining");
  rejectToken = true;
  assert.equal((await send()).permanent, false);
  rejectToken = false;
  await send();
  assert.equal(oauthCalls, 3, "a rejected bearer token is not reused for future device sends");
});

test("FCM OAuth failures and uncooperative transports obey the delivery deadline without leaking tokens", async () => {
  assert.deepEqual(await sendNotification(native, payload, { env: nativeEnv, fetch: async () => json({ error: "private credential detail" }, 401) }),
    { ok: false, permanent: false, status: 401, code: "provider-authentication" });
  let signal;
  const result = await sendNotification(native, payload, { env: nativeEnv, timeoutMs: 100, fetch: async (url, options) => { signal = options.signal; return new Promise(() => {}); } });
  assert.deepEqual(result, { ok: false, permanent: false, code: "timeout" });
  assert.equal(signal.aborted, true);
});

test("APNs verifies TLS at the fixed sandbox host and uses a 64-byte ES256 JWT signature", async () => {
  const transport = apnsTransport();
  const fixedNow = Date.UTC(2026, 10, 25);
  assert.deepEqual(await sendNotification(ios, payload, { env: appleEnv, http2Connect: transport.connect, now: () => fixedNow }), { ok: true });
  assert.equal(transport.origin, "https://api.sandbox.push.apple.com:443");
  assert.deepEqual(transport.options, { rejectUnauthorized: true });
  assert.equal(transport.headers[":path"], `/3/device/${ios.token}`);
  assert.equal(transport.headers["apns-topic"], "in.tyresaathi.logbook");
  assert.equal(transport.headers["apns-push-type"], "alert");
  const signed = parseJwt(transport.headers.authorization.replace(/^bearer /, ""));
  assert.deepEqual(signed.header, { alg: "ES256", kid: appleEnv.APNS_KEY_ID });
  assert.deepEqual(signed.claims, { iss: appleEnv.APNS_TEAM_ID, iat: fixedNow / 1000 });
  assert.equal(signed.signature.length, 64, "APNs requires JOSE r||s, not a DER ECDSA signature");
  assert.ok(crypto.verify("SHA256", Buffer.from(signed.unsigned), { key: appleKey.publicKey, dsaEncoding: "ieee-p1363" }, signed.signature));
  assert.deepEqual(transport.payload.aps.alert, { title: payload.title, body: payload.body });
  assert.equal(transport.payload.url, "/?reminders=1");
  assert.equal(transport.payload.kind, "reminders", "Capacitor exposes APNs custom fields as notification.data");
  assert.equal(transport.payload.day, "2026-11-25");
  assert.equal(transport.closed, true);
  assert.equal(transport.destroyed, true);
});

test("APNs production routing and error classification distinguish bad tokens from provider configuration", async () => {
  for (const [status, reason, permanent] of [
    [400, "BadDeviceToken", false], [410, "Unregistered", true], [400, "DeviceTokenNotForTopic", false],
    [400, "BadTopic", false], [403, "InvalidProviderToken", false], [403, "TopicDisallowed", false],
    [429, "TooManyRequests", false], [500, "InternalServerError", false], [503, "ServiceUnavailable", false],
  ]) {
    const transport = apnsTransport({ status, reason });
    const result = await sendNotification(ios, payload, { env: { ...appleEnv, APNS_ENVIRONMENT: "production" }, http2Connect: transport.connect });
    assert.equal(result.permanent, permanent, reason);
    assert.equal(result.status, status);
    assert.equal(transport.origin, "https://api.push.apple.com:443");
    assert.equal(transport.closed, true);
  }
});

test("APNs reuses a provider JWT across sends and refreshes safely before its one-hour expiry", async () => {
  const first = apnsTransport();
  const second = apnsTransport();
  const refreshed = apnsTransport();
  const fixedNow = Date.UTC(2026, 10, 26);
  await sendNotification(ios, payload, { env: appleEnv, http2Connect: first.connect, now: () => fixedNow });
  await sendNotification(ios, payload, { env: appleEnv, http2Connect: second.connect, now: () => fixedNow + 60000 });
  assert.equal(first.headers.authorization, second.headers.authorization, "per-message JWT rotation is rate-limited by APNs");
  await sendNotification(ios, payload, { env: appleEnv, http2Connect: refreshed.connect, now: () => fixedNow + 50 * 60000 });
  assert.notEqual(first.headers.authorization, refreshed.headers.authorization);
  assert.equal(parseJwt(refreshed.headers.authorization.replace(/^bearer /, "")).claims.iat, fixedNow / 1000 + 50 * 60);
});

test("APNs timeouts and stream failures close the connection and retain the device", async () => {
  for (const config of [{ hang: true }, { fail: true }]) {
    const transport = apnsTransport(config);
    const result = await sendNotification(ios, payload, { env: appleEnv, http2Connect: transport.connect, timeoutMs: 100 });
    assert.equal(result.ok, false);
    assert.equal(result.permanent, false);
    assert.equal(result.code, config.hang ? "timeout" : "transport-error");
    assert.equal(transport.closed, true);
    assert.equal(transport.destroyed, true);
  }
});
