import test from "node:test";
import assert from "node:assert/strict";
import { createApiRequest } from "../src/api-request.js";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function expectApiError(code, status) {
  return (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "FleetApiError");
    assert.equal(error.code, code);
    assert.equal(typeof error.code, "string");
    assert.equal(error.message, code);
    assert.equal(error.status, status);
    return true;
  };
}

test("browser GET uses the shared origin and cookies without a JSON body or bearer token", async () => {
  let calls = 0;
  const request = createApiRequest({
    getServer: () => "https://fleet.example",
    getToken: () => {
      assert.fail("browser requests must not read the native bearer token");
    },
    isOnline: () => true,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, "https://fleet.example/api/state");
      assert.equal(options.method, "GET");
      assert.equal(options.credentials, "same-origin");
      assert.equal(Object.hasOwn(options, "body"), false);
      assert.deepEqual(options.headers, {});
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.signal.aborted, false);
      return jsonResponse({ revision: 7, tyres: [] });
    },
  });

  assert.deepEqual(await request("/state"), { revision: 7, tyres: [] });
  assert.equal(calls, 1);
});

test("browser POST sends JSON with cookies and returns the parsed server response", async () => {
  const body = { username: "test_admin", password: "test-only-password" };
  const request = createApiRequest({
    isOnline: () => true,
    fetcher: async (url, options) => {
      assert.equal(url, "/api/login");
      assert.equal(options.method, "POST");
      assert.equal(options.credentials, "same-origin");
      assert.deepEqual(options.headers, { "Content-Type": "application/json" });
      assert.equal(options.body, JSON.stringify(body));
      return jsonResponse({ user: { username: "test_admin" } });
    },
  });

  assert.deepEqual(await request("/login", body), {
    user: { username: "test_admin" },
  });
});

test("native requests omit cookies and obtain the current server and bearer token each time", async () => {
  let server = "https://first-fleet.example";
  let token = "test-token-one";
  const seen = [];
  const request = createApiRequest({
    native: true,
    getServer: () => server,
    getToken: () => token,
    isOnline: () => true,
    fetcher: async (url, options) => {
      seen.push({ url, options });
      return jsonResponse({ ok: true });
    },
  });

  await request("/state");
  server = "https://second-fleet.example";
  token = "test-token-two";
  await request("/action", { type: "test-only-action" });
  token = "";
  await request("/state");

  assert.equal(seen[0].url, "https://first-fleet.example/api/state");
  assert.equal(seen[1].url, "https://second-fleet.example/api/action");
  for (const { options } of seen) assert.equal(options.credentials, "omit");
  assert.deepEqual(seen[0].options.headers, {
    Authorization: "Bearer test-token-one",
  });
  assert.equal(seen[0].options.method, "GET");
  assert.equal(Object.hasOwn(seen[0].options, "body"), false);
  assert.deepEqual(seen[1].options.headers, {
    "Content-Type": "application/json",
    Authorization: "Bearer test-token-two",
  });
  assert.equal(seen[1].options.method, "POST");
  assert.equal(seen[1].options.body, '{"type":"test-only-action"}');
  assert.equal(Object.hasOwn(seen[2].options.headers, "Authorization"), false);
});

test("an explicit null body is still a JSON POST", async () => {
  const request = createApiRequest({
    isOnline: () => true,
    fetcher: async (_url, options) => {
      assert.equal(options.method, "POST");
      assert.equal(options.body, "null");
      assert.equal(options.headers["Content-Type"], "application/json");
      return jsonResponse(null);
    },
  });
  assert.equal(await request("/test", null), null);
});

test("a genuinely offline device receives offlineHint before any fetch", async () => {
  let fetched = false;
  const request = createApiRequest({
    isOnline: () => false,
    fetcher: async () => {
      fetched = true;
      assert.fail("offline requests must not reach fetch");
    },
  });
  await assert.rejects(request("/state"), expectApiError("offlineHint"));
  assert.equal(fetched, false);
});

test("an online fetch failure is notConnected rather than a false offline message", async () => {
  const request = createApiRequest({
    isOnline: () => true,
    fetcher: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  await assert.rejects(request("/login", {}), expectApiError("notConnected"));
});

test("losing the connection while fetching produces the genuine offline message", async () => {
  let online = true;
  const request = createApiRequest({
    isOnline: () => online,
    fetcher: async () => {
      online = false;
      throw new TypeError("Network connection was lost");
    },
  });
  await assert.rejects(request("/state"), expectApiError("offlineHint"));
});

test("the native DOMException TimeoutError numeric code 23 becomes serverTimeout", async () => {
  const timeout = new DOMException("The operation timed out", "TimeoutError");
  assert.equal(timeout.code, 23);
  const request = createApiRequest({
    isOnline: () => true,
    fetcher: async () => {
      throw timeout;
    },
  });
  await assert.rejects(request("/state"), expectApiError("serverTimeout"));
});

test("a configured request deadline aborts fetch and reports serverTimeout", async () => {
  let receivedSignal;
  const request = createApiRequest({
    isOnline: () => true,
    fetcher: async (_url, { signal }) => {
      receivedSignal = signal;
      return new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    },
  });
  // AbortSignal.timeout uses an unreferenced timer in Node. Keep this isolated
  // test alive until its deadline fires without using a real network request.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      request("/state", undefined, { timeoutMs: 10 }),
      expectApiError("serverTimeout"),
    );
    assert.equal(receivedSignal.aborted, true);
    assert.equal(receivedSignal.reason.name, "TimeoutError");
  } finally {
    clearTimeout(keepAlive);
  }
});

test("caller cancellation passes its own signal through and remains notConnected while online", async () => {
  const controller = new AbortController();
  controller.abort();
  const request = createApiRequest({
    isOnline: () => true,
    fetcher: async (_url, { signal }) => {
      assert.equal(signal, controller.signal);
      throw signal.reason;
    },
  });
  await assert.rejects(
    request("/state", undefined, { signal: controller.signal, timeoutMs: 1 }),
    expectApiError("notConnected"),
  );
});

test("gateway and sleeping-server errors retain their HTTP status even with HTML bodies", async (t) => {
  for (const status of [502, 503, 504]) {
    await t.test(String(status), async () => {
      let parsed = false;
      const request = createApiRequest({
        isOnline: () => true,
        fetcher: async () => ({
          status,
          ok: false,
          headers: new Headers({ "Content-Type": "text/html" }),
          json: async () => {
            parsed = true;
            throw new SyntaxError("Unexpected token <");
          },
        }),
      });
      await assert.rejects(
        request("/login", {}),
        expectApiError("serverUnavailable", status),
      );
      assert.equal(parsed, false);
    });
  }
});

test("a successful HTML page is invalidServerResponse rather than false success or offline", async () => {
  const request = createApiRequest({
    isOnline: () => true,
    fetcher: async () => new Response("<html>Sign in</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }),
  });
  await assert.rejects(
    request("/state"),
    expectApiError("invalidServerResponse", 200),
  );
});

test("other HTTP HTML errors retain their status as invalidServerResponse", async () => {
  const request = createApiRequest({
    isOnline: () => true,
    fetcher: async () => new Response("<html>Forbidden</html>", {
      status: 403,
      headers: { "Content-Type": "text/html" },
    }),
  });
  await assert.rejects(
    request("/action", {}),
    expectApiError("invalidServerResponse", 403),
  );
});

test("invalid JSON retains its status instead of falling through to a connection error", async (t) => {
  for (const status of [200, 401, 500]) {
    await t.test(String(status), async () => {
      const request = createApiRequest({
        isOnline: () => true,
        fetcher: async () => new Response('{"error":', {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      });
      await assert.rejects(
        request("/state"),
        expectApiError("invalidServerResponse", status),
      );
    });
  }
});

for (const [failure, expectedCode] of [
  [new DOMException("Body read timed out", "TimeoutError"), "serverTimeout"],
  [new DOMException("Body read was aborted", "AbortError"), "notConnected"],
  [new TypeError("Connection closed during body read"), "notConnected"],
]) {
  test(`an online ${failure.name} while reading the response body becomes ${expectedCode}`, async () => {
    let bodyReads = 0;
    if (failure.name === "TimeoutError") assert.equal(failure.code, 23);
    const request = createApiRequest({
      isOnline: () => true,
      fetcher: async () => new Response(new ReadableStream({
        pull(controller) {
          bodyReads++;
          controller.error(failure);
        },
      }, { highWaterMark: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });

    await assert.rejects(request("/state"), expectApiError(expectedCode));
    assert.equal(bodyReads, 1);
  });
}

test("losing internet after response headers arrive produces offlineHint when reading the body fails", async () => {
  let online = true;
  let bodyReads = 0;
  const request = createApiRequest({
    isOnline: () => online,
    fetcher: async () => new Response(new ReadableStream({
      pull(controller) {
        bodyReads++;
        online = false;
        controller.error(new TypeError("Connection lost during body read"));
      },
    }, { highWaterMark: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  });

  await assert.rejects(request("/state"), expectApiError("offlineHint"));
  assert.equal(bodyReads, 1);
});

test("JSON API errors preserve authentication, authorization and stale-revision codes and statuses", async (t) => {
  for (const [status, code] of [
    [401, "unauthorized"],
    [403, "originNotAllowed"],
    [409, "staleRevision"],
    [422, "invalidTyre"],
  ]) {
    await t.test(code, async () => {
      const request = createApiRequest({
        isOnline: () => true,
        fetcher: async () => jsonResponse({ error: code }, status),
      });
      await assert.rejects(
        request("/action", { revision: 1 }),
        expectApiError(code, status),
      );
    });
  }
});

test("malformed API error values become serverError with the original HTTP status", async (t) => {
  for (const data of [
    { error: 23 },
    { error: { message: "internal detail" } },
    { error: null },
    { error: ["unauthorized"] },
    {},
    null,
  ]) {
    await t.test(JSON.stringify(data), async () => {
      const request = createApiRequest({
        isOnline: () => true,
        fetcher: async () => jsonResponse(data, 500),
      });
      await assert.rejects(
        request("/state"),
        expectApiError("serverError", 500),
      );
    });
  }
});

test("successful JSON values are returned intact without requiring a particular response shape", async (t) => {
  for (const value of [{ revision: 3, tyres: [] }, ["test"], null, false]) {
    await t.test(JSON.stringify(value), async () => {
      const request = createApiRequest({
        isOnline: () => true,
        fetcher: async () => jsonResponse(value),
      });
      assert.deepEqual(await request("/state"), value);
    });
  }
});
