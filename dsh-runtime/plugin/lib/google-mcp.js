import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OAuth2Client } from "google-auth-library";

/** A Bees Google server: runs on the sign-in that connect left in its env and calls one Google API. */
export function googleServer(label, base) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  const again = `Connect ${label} again on the MCP servers page with the same Google account.`;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    console.error(`${label} has no Google sign-in. ${again}`);
    process.exit(1);
  }
  const auth = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const server = new McpServer({ name: label, version: "1.0.0" });
  return {
    async google(path, options) {
      try {
        return (await auth.request({ url: base + path, ...options })).data;
      } catch (error) {
        const reason = error?.response?.data?.error;
        if (reason === "invalid_grant" || reason === "invalid_client")
          throw new Error(`Google no longer accepts this ${label} sign-in. ${again}`);
        throw new Error(reason?.message ?? error?.message ?? String(error));
      }
    },
    tool: (name, description, inputSchema, run) => server.registerTool(name, { description, inputSchema },
      async (input) => ({ content: [{ type: "text", text: JSON.stringify(await run(input)) }] })),
    serve: () => server.connect(new StdioServerTransport())
  };
}
