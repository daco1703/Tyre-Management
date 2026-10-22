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
export function startOffline(fleetName) {
  const name = String(fleetName || "").trim();
  if (!name || name.length > 80) throw new AppError("required");
  return transaction("readwrite", (existing, store) => {
    if (existing) return existing;
    const profile = { fleetName: name, state: emptyState() };
    store.put(profile, "current");
    return profile;
  });
}
export function offlineAction(kind, payload, revision) {
  return transaction("readwrite", (profile, store) => {
    if (!profile) throw new AppError("localStorageFailed");
    if (profile.state.revision !== revision)
      throw new AppError("staleData", 409);
    const updated = {
      ...profile,
      state: applyAction(profile.state, { kind, payload }, "This phone"),
    };
    store.put(updated, "current");
    return updated.state;
  });
}
