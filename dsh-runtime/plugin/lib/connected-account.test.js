import assert from "node:assert/strict";
import test from "node:test";

import { ConnectedAccount } from "./connected-account.js";

test("removing an organization member uses its organization and refreshes people", async () => {
  const account = Object.create(ConnectedAccount.prototype);
  account.request = async (path, options) => {
    assert.equal(path, "/api/memberships/member%2Fid");
    assert.deepEqual(options, {
      method: "DELETE", organizationId: "org", connectionId: "connection"
    });
  };
  account.organizationPeople = async (...args) => ({ refreshedWith: args });

  assert.deepEqual(
    await account.removeOrganizationMember("org", "member/id", "connection"),
    { refreshedWith: ["org", "connection"] }
  );
});

test("sync requests share one queued pass and retain changes requested during an active pass", async () => {
  const database = {
    prepare: () => ({ get: () => undefined, all: () => [], run() {} }),
    exec() {}
  };
  const account = new ConnectedAccount(database, {});
  account.connections = () => ["a", "b"].map((id) => ({ id, organizationId: id, accountUserId: "user" }));
  const entered = Promise.withResolvers();
  const active = Promise.withResolvers();
  const requests = [];
  account.request = async (_path, { organizationId }) => {
    requests.push(organizationId);
    if (requests.length === 1) { entered.resolve(); await active.promise; }
    return { records: [], cursor: "0", more: false };
  };
  const first = account.syncCoordination(["a"]);
  const pending = [];
  try {
    await entered.promise;
    // These arrive after the first pass has started; they need one fresh pass, not 100.
    for (let i = 0; i < 100; i++) pending.push(account.syncCoordination([i % 2 ? "a" : "b"]));
    assert.deepEqual(requests, ["a"], "Queued syncs cannot overlap cursor writes");
  } finally { active.resolve(); await Promise.all([first, ...pending]); }
  assert.deepEqual(requests, ["a", "a", "b"]);
  await account.close();
  assert.deepEqual(await account.syncCoordination(), []);
});

test("a full sync expands a queued scoped sync without duplicating it", async () => {
  const account = new ConnectedAccount({
    prepare: () => ({ get: () => undefined, all: () => [], run() {} }), exec() {}
  }, {});
  account.connections = () => ["a", "b"].map((id) => ({ id, organizationId: id }));
  const requests = [];
  account.request = async (_path, { organizationId }) => {
    requests.push(organizationId);
    return { records: [], cursor: "0", more: false };
  };
  const scoped = account.syncCoordination(["a"]);
  const all = account.syncCoordination();
  await Promise.all([scoped, all]);
  assert.deepEqual(requests, ["a", "b"]);
});
