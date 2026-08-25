/**
 * The public MCP servers Bees offers out of the box.
 *
 * Nothing here is installed until someone reviews the entry and presses Install, because an MCP
 * server is a program Bees runs on this machine with the tools it publishes handed straight to a
 * model. Every row therefore carries who publishes it, what it can reach, and what it needs from
 * the user. `access` is the sentence shown on the review screen; keep it honest and specific.
 */
export const MCP_CATALOG = [
  {
    id: "filesystem",
    serverName: "filesystem",
    label: "Files",
    publisher: "Model Context Protocol (official)",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    summary: "Read, write, move and search files inside one folder you choose.",
    access: "Full read and write inside the folder you pick, and nowhere else. No network.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    // The folder is the last argument, so a picked path appends cleanly.
    requiresDirectory: true,
    directoryLabel: "Folder this server may read and write",
    env: [],
    headers: []
  },
  {
    id: "memory",
    serverName: "memory",
    label: "Memory",
    publisher: "Model Context Protocol (official)",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    summary: "A knowledge graph the agent can add to and search across runs.",
    access: "Writes one local memory file. No network, no access to your other files.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    env: [],
    headers: []
  },
  {
    id: "sequential-thinking",
    serverName: "thinking",
    label: "Sequential thinking",
    publisher: "Model Context Protocol (official)",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    summary: "Lets the agent break a hard problem into revisable steps.",
    access: "Nothing outside the conversation. No files, no network.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    env: [],
    headers: []
  },
  {
    id: "git",
    serverName: "git",
    label: "Git",
    publisher: "Model Context Protocol (official)",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
    summary: "Read history, diffs and branches of a local repository, and commit to it.",
    access: "Reads and commits in the repository you pick. Never pushes. No network.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-git", "--repository"],
    requiresDirectory: true,
    directoryLabel: "Repository folder",
    prerequisite: "Needs the uv toolchain (uvx) on this machine.",
    env: [],
    headers: []
  },
  {
    id: "fetch",
    serverName: "fetch",
    label: "Web fetch",
    publisher: "Model Context Protocol (official)",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    summary: "Fetch a web page and hand the agent its text.",
    access: "Outbound requests to any address the agent chooses, including your local network.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    prerequisite: "Needs the uv toolchain (uvx) on this machine.",
    env: [],
    headers: []
  },
  {
    id: "time",
    serverName: "time",
    label: "Time and time zones",
    publisher: "Model Context Protocol (official)",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
    summary: "The current time anywhere, and conversion between zones.",
    access: "Nothing outside the conversation. No files, no network.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-time"],
    prerequisite: "Needs the uv toolchain (uvx) on this machine.",
    env: [],
    headers: []
  },
  {
    id: "playwright",
    serverName: "browser",
    label: "Browser",
    publisher: "Microsoft",
    homepage: "https://github.com/microsoft/playwright-mcp",
    summary: "Drive a real browser: open pages, click, fill forms, read what rendered.",
    access: "Starts a browser and reaches any site the agent visits. Sites you are signed into in "
      + "that browser profile are reachable too.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    env: [],
    headers: []
  },
  {
    id: "context7",
    serverName: "context7",
    label: "Library documentation",
    publisher: "Upstash",
    homepage: "https://github.com/upstash/context7",
    summary: "Current documentation and examples for a named library or framework.",
    access: "Sends the library name and your question to Upstash's service over the internet.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    env: [],
    headers: []
  },
  {
    id: "github",
    serverName: "github",
    label: "GitHub",
    publisher: "GitHub (official remote server)",
    homepage: "https://github.com/github/github-mcp-server",
    summary: "Issues, pull requests, code search and workflow runs on GitHub.",
    access: "Sends your requests to GitHub with the token you supply. Everything that token can "
      + "read or change, this server can read or change.",
    transport: "streamable-http",
    url: "https://api.githubcopilot.com/mcp/",
    env: [],
    headers: [{
      name: "Authorization",
      credential: "GITHUB_TOKEN",
      prefix: "Bearer ",
      label: "GitHub personal access token",
      help: "Create one at github.com → Settings → Developer settings → Personal access tokens."
    }]
  },
  {
    id: "firecrawl",
    serverName: "firecrawl",
    label: "Web scraping",
    publisher: "Firecrawl",
    homepage: "https://github.com/firecrawl/firecrawl-mcp-server",
    summary: "Scrape, crawl and search whole sites and get clean text back.",
    access: "Sends the pages you ask for to Firecrawl's service, billed against your API key.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "firecrawl-mcp"],
    env: [{
      name: "FIRECRAWL_API_KEY",
      label: "Firecrawl API key",
      help: "From firecrawl.dev → Dashboard → API Keys."
    }],
    headers: []
  }
];

MCP_CATALOG.push({
  id: "openapi-bridge",
  serverName: "api",
  label: "Any REST API (OpenAPI bridge)",
  publisher: "Ivo Toby, openapi-mcp-server",
  homepage: "https://github.com/ivo-toby/mcp-openapi-server",
  summary: "Point it at an OpenAPI spec and every endpoint becomes a tool. For services with no "
    + "MCP server of their own.",
  access: "Calls the API you name, with the credentials you give it, on the agent's behalf.",
  transport: "stdio",
  command: "npx",
  // --tools dynamic keeps three lookup tools in context instead of one per endpoint, which is what
  // makes a large API usable at all.
  args: ["-y", "@ivotoby/openapi-mcp-server", "--transport", "stdio", "--tools", "dynamic"],
  inputs: [
    { name: "apiBaseUrl", flag: "--api-base-url", label: "API base URL", help: "https://api.example.com" },
    { name: "openapiSpec", flag: "--openapi-spec", label: "OpenAPI spec URL", help: "https://api.example.com/openapi.json" }
  ],
  env: [{
    name: "API_HEADERS",
    optional: true,
    label: "Auth header, if the API needs one",
    help: "Authorization:Bearer YOUR_TOKEN. Goes in the environment, never in the arguments, so it "
      + "stays out of the process list."
  }],
  headers: []
});

/** Public collections of Agent Plugins. Each publishes a marketplace manifest naming its skills. */
export const SKILL_CATALOG = [
  { repo: "anthropics/skills", label: "Anthropic Skills", note: "Documents, artifacts and skill authoring" },
  { repo: "wshobson/agents", label: "wshobson Plugins", note: "Engineering processes across 90+ plugins" },
  { repo: "affaan-m/ECC", label: "ECC", note: "Harness optimization and research processes" }
];

export function catalogEntry(id) {
  return MCP_CATALOG.find((entry) => entry.id === id);
}
