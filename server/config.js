import { defaultSharedServer } from "../shared/defaults.js";

export const fleetPreviewOrigin =
  "https://tyre-management-git-main-shepards.vercel.app";

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
  const vercel = env.VERCEL === "1";
  const publicOrigin = normalizePublicOrigin(
    env.PUBLIC_ORIGIN ||
      (vercel ? defaultSharedServer : env.RENDER_EXTERNAL_URL || ""),
  );
  const fleetDeployment =
    (env.RENDER === "true" || vercel) &&
    (!env.PUBLIC_ORIGIN || publicOrigin === defaultSharedServer);
  const origins = [defaultSharedServer, fleetPreviewOrigin];
  if (vercel && fleetDeployment) {
    for (const host of [
      env.VERCEL_URL,
      env.VERCEL_BRANCH_URL,
      env.VERCEL_PROJECT_PRODUCTION_URL,
    ]) {
      // Values are injected by the deployment, never taken from request headers.
      if (
        typeof host === "string" &&
        /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+vercel\.app$/i.test(host)
      )
        origins.push(normalizePublicOrigin(`https://${host}`));
    }
  }
  return {
    // Render terminates HTTPS before forwarding HTTP to Node. Respect an
    // explicit proxy override, and auto-configure its standard single proxy.
    trustProxy:
      env.TRUST_PROXY === "1" ||
      (env.TRUST_PROXY === undefined && (env.RENDER === "true" || vercel)),
    publicOrigin,
    // Existing Render services may not apply new Blueprint env settings.
    // Allow this fleet's exact public and preview origins. Other operators'
    // explicit origins retain complete control of their deployment.
    ...(fleetDeployment
      ? { additionalPublicOrigins: [...new Set(origins)] }
      : {}),
  };
}
