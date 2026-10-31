import { defaultSharedServer } from "../shared/defaults.js";

// Migrate the previous fleet address, while preserving other chosen servers.
export function resolveSharedServer(saved) {
  if (typeof saved !== "string" || !saved.trim()) return defaultSharedServer;
  try {
    const url = new URL(saved.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.hostname === "localhost"
    )
      return defaultSharedServer;
    return url.origin === "https://tyre-management.onrender.com"
      ? defaultSharedServer
      : url.origin;
  } catch {
    return defaultSharedServer;
  }
}
