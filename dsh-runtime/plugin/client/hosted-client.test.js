import test from "node:test";
import assert from "node:assert/strict";
import {
  createHostedClient,
  hostedPreferences,
  runNotifications,
  hostedConnectionDestination,
} from "./hosted-client.js";

test("connection links select only a team available in the signed-in snapshot", () => {
  const data = {
    teams: [
      { id: "sales", organizationId: "one" },
      { id: "support", organizationId: "two" },
    ],
  };
  assert.deepEqual(
    hostedConnectionDestination("?organization=two&team=support", data),
    { scope: "team:support", connectionId: "two" },
  );
  assert.equal(
    hostedConnectionDestination("?organization=one&team=support", data),
    null,
  );
  assert.equal(
    hostedConnectionDestination("?organization=outside&team=private", data),
    null,
  );
  assert.equal(hostedConnectionDestination("", data), null);
});

test("hosted commands carry team scope and reuse a request key only while a submission is uncertain", async () => {
  const calls = [];
  let fail = true;
  const client = createHostedClient(async (path, options) => {
    calls.push({
      path,
      ...options,
      body: options.body && JSON.parse(options.body),
    });
    if (path.endsWith("snapshot"))
      return Response.json({ revisions: { team: 4 } });
    if (fail) {
      fail = false;
      throw Error("Connection lost after submit");
    }
    return Response.json({ id: "run" });
  });
  client.selectScope({ organizationId: "org", teamId: "team" });
  await client.request("/bees-api/snapshot");
  const command = {
    method: "POST",
    body: JSON.stringify({ action: "create_run" }),
  };
  await assert.rejects(
    client.request("/bees-api/command", command),
    /Connection lost/,
  );
  await client.request("/bees-api/command", command);
  assert.equal(calls[1].body.requestId, calls[2].body.requestId);
  assert.equal(calls[2].path, "/api/desktop/command");
  assert.deepEqual(calls[2].body.revisions, { team: 4 });
  assert.deepEqual(calls[2].body.target, { kind: "managed", fallback: "none" });
  assert.equal(calls[2].headers["x-organization-id"], "org");
  assert.equal(calls[2].headers["x-bees-team-id"], "team");
  await client.request("/bees-api/command", command);
  assert.notEqual(calls[2].body.requestId, calls[3].body.requestId);
  client.setTarget({ runnerId: "remote" });
  await client.request("/bees-api/command", command);
  assert.deepEqual(calls[4].body.target, { runnerId: "remote" });
  for (const path of [
    "//outside.test",
    "/\\outside.test",
    "https://outside.test",
  ])
    await assert.rejects(client.request(path), /installation/);
});

test("sign-out cancels old requests and clears private snapshots before another user signs in", async () => {
  let finish, signal;
  const client = createHostedClient((_path, options) => {
    signal = options.signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  let notified = false;
  client.subscribe(() => {
    notified = true;
  });
  const pending = client.request("/bees-api/snapshot");
  client.dispose();
  finish(Response.json({ items: ["old user's private result"] }));
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(signal.aborted, true);
  assert.equal(notified, false);
  assert.equal(client.snapshot(), null);
  await assert.rejects(client.request("/api/me"), { name: "AbortError" });
});

test("browser preferences are isolated per account and reject unsafe nested paths", async () => {
  const saved = new Map(),
    storage = {
      getItem: (key) => saved.get(key),
      setItem: (key, value) => saved.set(key, value),
    };
  const first = hostedPreferences("a", "bees", storage),
    second = hostedPreferences("b", "bees", storage);
  await first.set("themePreset", "forest");
  await first.mutate([
    { op: "set", path: ["seenFiles", "run"], value: ["report.md"] },
  ]);
  assert.equal(
    hostedPreferences("a", "bees", storage).getSnapshot().value.themePreset,
    "forest",
  );
  assert.deepEqual(second.getSnapshot().value, {});
  assert.throws(
    () =>
      first.mutate([{ op: "set", path: ["__proto__", "bad"], value: true }]),
    /Invalid/,
  );
  saved.set("bees:hosted:c:bees", "null");
  await hostedPreferences("c", "bees", storage).set("themePreset", "light");
});

test("notifications report state changes for the signed-in owner's work, without replaying history", () => {
  const next = {
    currentUserId: "owner",
    items: [{ id: "one", title: "Summary" }],
    runs: [
      { id: "one", workItemId: "one", ownerId: "owner", status: "completed" },
      { id: "other", ownerId: "coworker", status: "failed" },
    ],
  };
  assert.deepEqual(runNotifications(null, next), []);
  assert.deepEqual(
    runNotifications({ runs: [{ id: "one", status: "running" }] }, next),
    ["Completed: Summary"],
  );
  assert.deepEqual(runNotifications(next, next), []);
});
