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

  it("stores a validated non-secret OpenAI-compatible endpoint", () => {
    const { connection, secret } = connectApiKey(
      "openai-compatible",
      " key ",
      "https://models.example.test/v1/"
    );
    expect(secret).toBe("key");
    expect(connection.baseUrl).toBe("https://models.example.test/v1");
    expect(() => connectApiKey("openai-compatible", "key", "file:///tmp/model"))
      .toThrow("http:// or https://");
    expect(JSON.stringify(connection)).not.toContain("key");
  });
});
