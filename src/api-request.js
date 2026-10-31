class FleetApiError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "FleetApiError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export function createApiRequest({
  getServer = () => "",
  getToken = () => "",
  native = false,
  fetcher = globalThis.fetch,
  isOnline = () => globalThis.navigator?.onLine !== false,
} = {}) {
  return async function request(path, body, options = {}) {
    if (!isOnline()) throw new FleetApiError("offlineHint");
    try {
      const token = native ? getToken() : "";
      const response = await fetcher(`${getServer()}/api${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: native ? "omit" : "same-origin",
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal:
          options.signal || AbortSignal.timeout(options.timeoutMs ?? 15000),
      });
      if ([502, 503, 504].includes(response.status))
        throw new FleetApiError("serverUnavailable", response.status);
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw new FleetApiError("invalidServerResponse", response.status);
      let data;
      try {
        data = await response.json();
      } catch (error) {
        if (error instanceof SyntaxError)
          throw new FleetApiError("invalidServerResponse", response.status);
        throw error;
      }
      if (!response.ok)
        throw new FleetApiError(
          typeof data?.error === "string" ? data.error : "serverError",
          response.status,
        );
      return data;
    } catch (error) {
      if (error instanceof FleetApiError) throw error;
      if (!isOnline()) throw new FleetApiError("offlineHint");
      throw new FleetApiError(
        error?.name === "TimeoutError" ? "serverTimeout" : "notConnected",
      );
    }
  };
}
