import { defaultSharedServer } from "../shared/defaults.js";

export function normalizePublicOrigin(value = "") {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error(
      `PUBLIC_ORIGIN must be an HTTPS origin, such as ${defaultSharedServer}`,
    );
  }
}

export function deploymentOptions(env) {
  return {
    // Render terminates HTTPS before forwarding HTTP to Node. Respect an
    // explicit proxy override, and auto-configure its standard single proxy.
    trustProxy:
      env.TRUST_PROXY === "1" ||
      (env.TRUST_PROXY === undefined && env.RENDER === "true"),
    publicOrigin: normalizePublicOrigin(
      env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || "",
    ),
    // Existing Render services may not apply new Blueprint env settings.
    // Permit our exact custom domain too, unless the operator chose an override.
    ...(env.RENDER === "true" && !env.PUBLIC_ORIGIN
      ? { additionalPublicOrigins: [defaultSharedServer] }
      : {}),
  };
}
