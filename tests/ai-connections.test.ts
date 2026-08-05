import { describe, expect, it } from "vitest";
import { connectApiKey } from "../src/ai-connections.js";

describe("AI connection credentials", () => {
  it("keeps the API key outside persisted connection metadata", () => {
    const { connection, secret } = connectApiKey("openai", "  sk-test  ");
    expect(secret).toBe("sk-test");
    expect(connection.secretRef).toMatch(/^[0-9a-f-]+$/);
    expect(JSON.stringify(connection)).not.toContain("sk-test");
    expect(connection).not.toHaveProperty("credential");
  });

  it("rejects an empty key", () => {
    expect(() => connectApiKey("anthropic", "  ")).toThrow("API key is required");
  });
});
