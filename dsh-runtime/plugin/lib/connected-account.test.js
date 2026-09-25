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
