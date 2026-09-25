import assert from "node:assert/strict";
import test from "node:test";
import { accountLabel } from "./shared.js";

test("account labels use the owner's name", () => {
  assert.equal(accountLabel({ accounts: [{ userId: "owner-1", name: "Ada", email: "ada@example.com" }] }, "owner-1"), "Ada");
});
