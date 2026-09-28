import assert from "node:assert/strict";
import { test } from "node:test";
import { firstTeamForOrganization } from "./scope-selection.js";

test("selects the first team available in an organization and connection", () => {
  const data = {
    teams: [
      { id: "other", organizationId: "other-org" },
      { id: "unavailable", organizationId: "org" },
      { id: "first", organizationId: "org" },
      { id: "second", organizationId: "org" }
    ],
    connectionTeams: [{ connectionId: "account", teamId: "first" }, { connectionId: "account", teamId: "second" }]
  };
  assert.equal(firstTeamForOrganization(data, "org", "account")?.id, "first");
  assert.equal(firstTeamForOrganization(data, "org")?.id, "unavailable");
  assert.equal(firstTeamForOrganization(data, "org", "no-access"), undefined);
});
