import assert from "node:assert/strict";
import test from "node:test";
import { availableLocationName } from "./location-fields.js";

test("folder picker suggests a free name, including names hidden by archiving", () => {
  const locations = [
    { teamId: "team", name: "Reports" },
    { teamId: "team", name: "Reports (2)", archivedAt: "2026-01-01" },
    { teamId: "other", name: "Invoices" }
  ];
  assert.equal(availableLocationName("Reports", locations, "team"), "Reports (3)");
  assert.equal(availableLocationName("reports", locations, "team"), "reports (3)");
  assert.equal(availableLocationName("Invoices", locations, "team"), "Invoices");
});
