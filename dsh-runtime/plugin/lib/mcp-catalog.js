/** The chips that drive a browser. They mount per run; only the Chrome itself is shared. */
export const isBrowserCatalog = (catalogId) => ["playwright", "chrome-devtools"].includes(catalogId);

// Google sign-in supplies the refresh token; hosted clients can enter an existing token.
const googleSignIn = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"].map((name) => ({
  name, label: "a Google sign-in"
}));

/** Servers offered out of the box. Nothing installs without review, because each one is a program
 *  we run with its tools handed to a model. `access` is the review screen's sentence: keep it true. */
const ENTRIES = [
  {
    id: "filesystem",
    serverName: "filesystem", icon: "📁",
    label: "Files",
    publisher: "Model Context Protocol (official)",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    summary: "Read, write, move and search files inside this thread’s run folder.",
    access: "Reads and writes the thread’s input and output files. No network.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem@2026.8.31"],
    // The folder is the last argument, so a picked path appends cleanly.
    requiresDirectory: true,
    directoryLabel: "Folder this server may read and write",
    env: [],
    headers: []
  },
  {
    id: "memory",
    serverName: "memory", icon: "🧠",
    label: "Memory",
    publisher: "Model Context Protocol (official)",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    summary: "A knowledge graph the agent can add to and search across runs.",
    access: "Writes one local memory file. No network, no access to your other files.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory@2026.8.31"],
    env: [],
    headers: []
  },
  {
    id: "sequential-thinking",
    serverName: "thinking", icon: "💭",
    label: "Sequential thinking",
    publisher: "Model Context Protocol (official)",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    summary: "Lets the agent break a hard problem into revisable steps.",
    access: "Nothing outside the conversation. No files, no network.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking@2026.8.31"],
    env: [],
    headers: []
  },
  {
    id: "git",
    serverName: "git", icon: "🐙",
    label: "Git",
    publisher: "Model Context Protocol (official)",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
    summary: "Read history, diffs and branches of a repository in this thread’s run folder, and commit to it.",
    access: "Reads and commits inside this thread’s run folder. Never pushes. No network.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-git==2026.8.18", "--repository"],
    requiresDirectory: true,
    directoryLabel: "Repository folder",
    prerequisite: "Needs the uv toolchain (uvx) on this machine.",
    env: [],
    headers: []
  },
  {
    id: "fetch",
    serverName: "fetch", icon: "🌐",
    label: "Web fetch",
    publisher: "Model Context Protocol (official)",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    summary: "Fetch a web page and hand the agent its text.",
    access: "Outbound requests to any address the agent chooses, including your local network.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch==2026.8.18"],
    prerequisite: "Needs the uv toolchain (uvx) on this machine.",
    env: [],
    headers: []
  },
  {
    id: "time",
    serverName: "time", icon: "⏰",
    label: "Time and time zones",
    publisher: "Model Context Protocol (official)",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
    summary: "The current time anywhere, and conversion between zones.",
    access: "Nothing outside the conversation. No files, no network.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-time==2026.8.18"],
    prerequisite: "Needs the uv toolchain (uvx) on this machine.",
    env: [],
    headers: []
  },
  {
    id: "playwright",
    serverName: "browser", icon: "🌍",
    label: "Browser",
    publisher: "Microsoft",
    homepage: "https://github.com/microsoft/playwright-mcp",
    summary: "Drive a real browser: open pages, click, fill forms, read what rendered.",
    access: "Starts a browser and reaches any site the agent visits. Sites you are signed into in "
      + "that browser profile are reachable too.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@0.0.83", "--headless", "--isolated"],
    env: [],
    headers: []
  },
  {
    id: "context7",
    serverName: "context7", icon: "📚",
    label: "Library documentation",
    publisher: "Upstash",
    homepage: "https://github.com/upstash/context7",
    summary: "Current documentation and examples for a named library or framework.",
    access: "Sends the library name and your question to Upstash's service over the internet.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp@4.1.1"],
    env: [],
    headers: []
  },
  {
    id: "github",
    serverName: "github", icon: "🐙",
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
    id: "gmail",
    serverName: "gmail", icon: "📧",
    label: "Gmail",
    publisher: "Bees",
    homepage: "https://github.com/Bees-bot/bees-desktop/blob/main/dsh-runtime/plugin/lib/gmail-mcp.js",
    summary: "Search, read, label, draft and send email in your Gmail.",
    access: "Runs in this thread can read your mailbox and request approval to change or send email. The Google credentials stay on this client and go only to Google.",
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    transport: "stdio",
    command: "{node}",
    args: ["{lib}/gmail-mcp.js"],
    env: googleSignIn,
    headers: []
  },
  {
    id: "google-calendar",
    serverName: "calendar", icon: "📅",
    label: "Google Calendar",
    publisher: "Bees",
    homepage: "https://github.com/Bees-bot/bees-desktop/blob/main/dsh-runtime/plugin/lib/google-calendar-mcp.js",
    summary: "Find, add, change and answer events in your Google Calendar, and check when people are free.",
    access: "Runs in this thread can read your calendars and request approval to change events or invite people. Google may email guests when an event changes. Credentials stay on this client.",
    scopes: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.freebusy"
    ],
    transport: "stdio",
    command: "{node}",
    args: ["{lib}/google-calendar-mcp.js"],
    env: googleSignIn,
    headers: []
  },
  {
    id: "google-drive",
    serverName: "drive", icon: "☁️",
    label: "Google Drive",
    publisher: "Bees",
    homepage: "https://github.com/Bees-bot/bees-desktop/blob/main/dsh-runtime/plugin/lib/google-drive-mcp.js",
    summary: "Find and read your Google Drive files: Docs, Sheets, Slides, Forms, PDFs and Office files.",
    access: "Runs in this thread can read every Drive file and Form you can open, including shared files. This integration cannot change, share or delete files. Credentials stay on this client.",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/forms.body.readonly"
    ],
    transport: "stdio",
    command: "{node}",
    args: ["{lib}/google-drive-mcp.js"],
    env: googleSignIn,
    headers: []
  },
  {
    id: "firecrawl",
    serverName: "firecrawl", icon: "🔥",
    label: "Web scraping",
    publisher: "Firecrawl",
    homepage: "https://github.com/firecrawl/firecrawl-mcp-server",
    summary: "Scrape, crawl and search whole sites and get clean text back.",
    access: "Sends the pages you ask for to Firecrawl's service, billed against your API key.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "firecrawl-mcp@3.27.2"],
    env: [{
      name: "FIRECRAWL_API_KEY",
      label: "Firecrawl API key",
      help: "From firecrawl.dev → Dashboard → API Keys."
    }],
    headers: []
  },
  {
    id: "chrome-devtools",
    serverName: "devtools", icon: "🔧",
    label: "Chrome DevTools",
    publisher: "Google Chrome",
    homepage: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
    summary: "Inspect a live page: the console, the network log, performance traces and the DOM.",
    access: "Inspects pages in an isolated Chrome session, or in your personal browser when you enable it for this thread.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "chrome-devtools-mcp@1.10.1", "--headless", "--isolated"],
    env: [],
    headers: []
  },
    {
    id: "openapi-bridge",
    serverName: "api",
    // Every API added from this entry would otherwise be api, api-2, api-3, and that prefix is what
    // the model sees on each tool. Name it after the host instead.
    nameFrom: "apiBaseUrl", icon: "🔌",
    label: "Any REST API (OpenAPI bridge)",
    publisher: "Bees",
    homepage: "https://github.com/Bees-bot/bees-desktop/blob/main/dsh-runtime/plugin/lib/openapi-mcp.js",
    summary: "Point it at an OpenAPI spec and every endpoint becomes a tool. For services with no "
    + "add-on of their own.",
    access: "Calls the API you name, with the credentials you give it, on the agent's behalf.",
    transport: "stdio",
    command: "{node}",
    // --tools dynamic keeps three lookup tools in context instead of one per endpoint, which is what
    // makes a large API usable at all.
    args: ["{lib}/openapi-mcp.js", "--tools", "dynamic"],
    inputs: [
    // The bridge will not start without it, so a spec URL alone is not enough.
    { name: "apiBaseUrl", flag: "--api-base-url", label: "API base URL",
      help: "For example, https://api.example.com." },
    { name: "openapiSpec", flag: "--openapi-spec",
      label: "OpenAPI spec URL",
      help: "The URL of the API’s OpenAPI document." }
    ],
    env: [{
    name: "API_HEADERS",
    optional: true,
    label: "Auth header, if the API needs one",
    help: "Authorization:Bearer YOUR_TOKEN. Goes in the environment, never in the arguments, so it "
      + "stays out of the process list."
    }],
    headers: []
  }
];

/** Every entry carries the same keys, so nothing downstream has to guess at a missing one. */
export const MCP_CATALOG = ENTRIES.map((entry) => ({
  command: "", icon: "", args: [], url: "", env: [], headers: [], inputs: [],
  requiresDirectory: false, directoryLabel: "", prerequisite: "", ...entry
}));

export function catalogEntry(id) {
  return MCP_CATALOG.find((entry) => entry.id === id);
}
