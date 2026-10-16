export function hostedConnectionDestination(search, data) {
  const params = new URLSearchParams(search);
  const team = data.teams.find(
    (t) =>
      t.id === params.get("team") &&
      t.organizationId === params.get("organization"),
  );
  return team
    ? { scope: "team:" + team.id, connectionId: team.organizationId }
    : null;
}

export function createHostedClient(
  fetcher = globalThis.fetch.bind(globalThis),
) {
  let selection = {},
    snapshot = null;
  const pending = new Map();
  const listeners = new Set();
  const lifetime = new AbortController();
  const client = {
    dispose() {
      lifetime.abort();
      snapshot = null;
      pending.clear();
      listeners.clear();
    },
    selectScope(value) {
      selection = { ...selection, ...value };
    },
    setTarget(target) {
      selection = { ...selection, target };
    },
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async request(path, options = {}) {
      lifetime.signal.throwIfAborted();
      if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
        throw new Error("Use this Bees installation's API");
      const url = path.replace(/^\/bees-api\//, "/api/desktop/");
      let body = options.body,
        key;
      if (
        ["/api/desktop/command", "/api/desktop/prompt"].includes(url) &&
        body
      ) {
        const command = JSON.parse(body);
        key = JSON.stringify([url, selection, command]);
        if (!pending.has(key)) pending.set(key, crypto.randomUUID());
        body = JSON.stringify({
          ...command,
          ...(["create_run", "create_item", "create_goal", "ask_bees"].includes(
            command.action,
          ) && !command.target
            ? {
                target: selection.target || {
                  kind: "managed",
                  fallback: "none",
                },
              }
            : {}),
          revisions: snapshot?.revisions || {},
          requestId: pending.get(key),
        });
      }
      const response = await fetcher(url, {
        ...options,
        body,
        credentials: "same-origin",
        signal: options.signal
          ? AbortSignal.any([lifetime.signal, options.signal])
          : lifetime.signal,
        headers: {
          "content-type": "application/json",
          ...(selection.organizationId
            ? { "x-organization-id": selection.organizationId }
            : {}),
          ...(selection.teamId ? { "x-bees-team-id": selection.teamId } : {}),
          ...options.headers,
        },
      });
      const value =
        response.ok && options.binary
          ? response
          : response.status === 204
            ? {}
            : await response.json();
      lifetime.signal.throwIfAborted();
      if (!response.ok) {
        if (key && response.status < 500) pending.delete(key);
        if (response.status === 401 && typeof window !== "undefined")
          window.dispatchEvent(new Event("bees-signed-out"));
        throw Object.assign(
          new Error(
            value.error?.message ||
              value.error ||
              value.message ||
              "Could not complete this request",
          ),
          { status: response.status },
        );
      }
      if (key) pending.delete(key);
      if (url === "/api/desktop/snapshot") {
        snapshot = value;
        for (const listener of listeners) listener(value);
      }
      return value;
    },
  };
  return client;
}

export function observable(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(next) {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

export function runNotifications(previous, next) {
  if (!previous) return [];
  const before = new Map(previous.runs.map((r) => [r.id, r.status]));
  const labels = {
    completed: "Completed",
    failed: "Needs attention",
    waiting_for_input: "Needs your answer",
  };
  return next.runs
    .filter(
      (r) =>
        labels[r.status] &&
        before.get(r.id) !== r.status &&
        r.ownerId === next.currentUserId,
    )
    .map(
      (r) =>
        labels[r.status] +
        ": " +
        Array.from(
          next.items.find((i) => i.id === r.workItemId)?.title || "Bees work",
        )
          .slice(0, 80)
          .join(""),
    );
}

export function hostedPreferences(
  userId,
  namespace,
  storage = globalThis.localStorage,
) {
  const key = "bees:hosted:" + userId + ":" + namespace;
  let value;
  try {
    value = JSON.parse(storage.getItem(key) || "{}");
  } catch {
    value = {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) value = {};
  const store = observable({ status: "ready", value });
  const write = (next) => {
    storage.setItem(key, JSON.stringify(next));
    store.update({ status: "ready", value: next });
    return Promise.resolve(true);
  };
  return {
    ...store,
    set(key, value) {
      return write({ ...store.getSnapshot().value, [key]: value });
    },
    unset(key) {
      const next = { ...store.getSnapshot().value };
      delete next[key];
      return write(next);
    },
    mutate(operations) {
      const next = structuredClone(store.getSnapshot().value);
      for (const operation of operations) {
        const path = operation.path;
        if (
          !Array.isArray(path) ||
          !path.length ||
          path.some((key) =>
            ["__proto__", "constructor", "prototype"].includes(String(key)),
          )
        )
          throw new Error("Invalid preference path");
        let owner = next;
        for (const key of path.slice(0, -1)) {
          owner[key] ??= {};
          owner = owner[key];
        }
        if (operation.op === "set") owner[path.at(-1)] = operation.value;
        else if (operation.op === "unset") delete owner[path.at(-1)];
        else throw new Error("Unsupported preference operation");
      }
      return write(next);
    },
  };
}
