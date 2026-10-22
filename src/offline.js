import { defaultOfflineAuth, defaultUsername } from "../shared/defaults.js";
import { applyAction, emptyState, AppError } from "../shared/model.js";

const databaseName = "tyresaathi-offline-v1";
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("garage");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new AppError("localStorageFailed"));
    request.onblocked = () => reject(new AppError("localStorageFailed"));
  });
}
async function transaction(mode, operation) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("garage", mode);
      const store = tx.objectStore("garage");
      let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(failure || new AppError("localStorageFailed"));
      const request = store.get("current");
      request.onsuccess = () => {
        try {
          result = operation(request.result, store);
        } catch (e) {
          failure = e;
          tx.abort();
        }
      };
    });
  } finally {
    db.close();
  }
}
export const loadOffline = () =>
  transaction("readonly", (profile) => profile || null);
const bytes = (hex) =>
  Uint8Array.from(hex.match(/.{2}/g), (x) => parseInt(x, 16));
async function passwordVerifier(password, auth) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const result = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: bytes(auth.salt),
      iterations: auth.iterations,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(result), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function checkPassword(username, password, auth) {
  if (
    typeof password !== "string" ||
    password.length > 128 ||
    String(username).trim().toLowerCase() !== auth.username ||
    (await passwordVerifier(password, auth)) !== auth.hash
  )
    throw new AppError("loginFailed", 401);
}
export async function startOffline(fleetName, username, password) {
  const name = String(fleetName || "").trim();
  if (!name || name.length > 80) throw new AppError("required");
  const previous = await loadOffline();
  const auth = previous?.auth || defaultOfflineAuth;
  await checkPassword(username, password, auth);
  return transaction("readwrite", (existing, store) => {
    if ((existing?.auth || defaultOfflineAuth).hash !== auth.hash)
      throw new AppError("loginFailed", 401);
    const profile = existing
      ? { ...existing, auth }
      : { fleetName: name, state: emptyState(), auth };
    store.put(profile, "current");
    return profile;
  });
}
export async function changeOfflinePassword(currentPassword, password) {
  if (
    typeof password !== "string" ||
    password.length < 10 ||
    password.length > 128
  )
    throw new AppError("invalidCredentials");
  const previous = await loadOffline();
  if (!previous) throw new AppError("localStorageFailed");
  const oldAuth = previous.auth || defaultOfflineAuth;
  await checkPassword(
    oldAuth.username || defaultUsername,
    currentPassword,
    oldAuth,
  );
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const auth = { username: oldAuth.username, salt, iterations: 210000 };
  auth.hash = await passwordVerifier(password, auth);
  return transaction("readwrite", (existing, store) => {
    if (
      !existing ||
      (existing.auth || defaultOfflineAuth).hash !== oldAuth.hash
    )
      throw new AppError("loginFailed", 401);
    store.put({ ...existing, auth }, "current");
  });
}
export function offlineAction(kind, payload, revision) {
  return transaction("readwrite", (profile, store) => {
    if (!profile) throw new AppError("localStorageFailed");
    if (profile.state.revision !== revision)
      throw new AppError("staleData", 409);
    const updated = {
      ...profile,
      state: applyAction(
        profile.state,
        { kind, payload },
        profile.auth?.username || "This phone",
      ),
    };
    store.put(updated, "current");
    return updated.state;
  });
}
