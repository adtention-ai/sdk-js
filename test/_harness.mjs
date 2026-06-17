// Tiny fetch double. The SDK takes a `fetch` option, so we hand it a fake that routes by
// (method, path) to canned responses and counts calls. No network, no sibling-repo dependency —
// these tests verify the SDK's OWN behaviour (mapping, sanitization, dwell, self-heal, safety).

/** Build a minimal Response-shaped object the client actually reads. */
export function fakeResponse(status, body, headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

/**
 * recordingFetch(route) -> { fetch, calls }
 * `route(path, method, init, callIndex)` returns a fakeResponse (or throws to simulate a network
 * error). `calls` accumulates { path, method, body } for assertions.
 */
export function recordingFetch(route) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    return route(u.pathname + (u.search || ''), method, init, calls.length - 1);
  };
  return { fetch, calls };
}
