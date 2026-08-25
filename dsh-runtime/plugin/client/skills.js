import { h, React, useEffect, useState } from "./runtime.js";
import { Button, confirmAction, Empty, openExternal, request } from "./shared.js";

const STATUS_CLASS = { connected: "bees-running", failed: "bees-failed", starting: "", off: "" };
const STATUS_LABEL = {
  connected: "Connected", failed: "Not running", starting: "Starting…", off: "Turned off"
};

/** One shared loader so both routes see the same servers, tools and skills. */
export function useCapabilities() {
  const [value, setValue] = useState(null);
  const [error, setError] = useState("");
  const load = async () => {
    try { setValue(await request("/bees-api/capabilities")); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  useEffect(() => {
    void load();
    // A server that is still starting has no tools yet, so the page has to look again.
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, []);
  const act = async (command) => {
    try {
      const result = await request("/bees-api/capabilities", { method: "POST", body: JSON.stringify(command) });
      setError("");
      await load();
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
  };
  return { data: value, error, act, reload: load };
}

function Filter({ value, onChange, placeholder }) {
  return h("div", { className: "bees-search" }, h("input", {
    className: "bees-input", value, placeholder, "aria-label": placeholder,
    onChange: (event) => onChange(event.target.value)
  }));
}

function matches(needle, ...fields) {
  if (!needle) return true;
  return fields.some((field) => String(field ?? "").toLocaleLowerCase().includes(needle));
}

export function SkillsPage({ capabilities }) {
  const { data, error } = capabilities;
  const [query, setQuery] = useState("");
  if (error && !data) return h(Empty, null, error);
  if (!data) return h(Empty, null, "Reading the skill and tool catalog…");
  const needle = query.trim().toLocaleLowerCase();
  const skills = data.skills.filter((skill) => matches(needle, skill.name, skill.description, skill.whenToUse));
  const tools = data.tools.filter((tool) => matches(needle, tool.name, tool.description, tool.serverLabel));
  const builtIn = tools.filter(({ serverName }) => !serverName);
  const fromServers = tools.filter(({ serverName }) => serverName);
  return h("div", { className: "bees-stack" },
    h("div", { className: "bees-callout" },
      h("h3", null, "What your agents can actually do"),
      h("div", null, "A skill is a written instruction sheet an agent can open when it needs one. A tool "
        + "is something an agent can run. Both are live here: what this page lists is what a run can "
        + "reach right now. Add more tools by connecting an MCP server.")),
    h(Filter, { value: query, onChange: setQuery, placeholder: "Filter skills and tools" }),
    h("section", { className: "bees-box" },
      h("h3", null, `Skills (${skills.length})`),
      data.skillsComplete ? null : h("p", { className: "bees-muted" },
        "Some skill folders could not be read, so this list may be short."),
      h("p", { className: "bees-muted" }, "Skills come from your skill folders. Drop a folder containing "
        + "SKILL.md into one of them and it appears here without restarting Bees."),
      ...(skills.length ? skills.map((skill) => h("div", { className: "bees-row", key: skill.name },
        h("div", { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, skill.name),
          h("div", { className: "bees-muted" }, skill.description || "No description"),
          skill.whenToUse ? h("div", { className: "bees-muted" }, `When to use: ${skill.whenToUse}`) : null),
        skill.provider ? h("span", { className: "bees-badge" }, skill.provider) : null))
        : [h(Empty, { key: "empty" }, needle ? "No skill matches that" : "No skills installed yet")])),
    h("section", { className: "bees-box" },
      h("h3", null, `Tools from MCP servers (${fromServers.length})`),
      ...(fromServers.length ? fromServers.map((tool) => h("div", { className: "bees-row", key: tool.name },
        h("div", { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, tool.name),
          h("div", { className: "bees-muted" }, tool.description || "No description")),
        h("span", { className: "bees-badge" }, tool.serverLabel)))
        : [h(Empty, { key: "empty" }, "No MCP server is publishing tools yet")])),
    h("section", { className: "bees-box" },
      h("h3", null, `Built-in tools (${builtIn.length})`),
      h("p", { className: "bees-muted" }, "These ship with Bees. An agent preset decides which of them "
        + "a given agent may use."),
      ...(builtIn.length ? builtIn.map((tool) => h("div", { className: "bees-row", key: tool.name },
        h("div", { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, tool.name),
          h("div", { className: "bees-muted" }, tool.description || "No description"))))
        : [h(Empty, { key: "empty" }, "No tools are registered")]))
  );
}

/**
 * The review screen for one catalog entry. Nothing installs until the publisher, the reach, and the
 * inputs have all been shown once, because installing runs someone else's program on this machine.
 */
function CatalogReview({ ctx, entry, onCancel, onInstall }) {
  const [directory, setDirectory] = useState("");
  const [secrets, setSecrets] = useState({});
  const [busy, setBusy] = useState(false);
  const missingSecret = entry.secrets.some(({ name }) => !String(secrets[name] ?? "").trim());
  const ready = !busy && (!entry.requiresDirectory || directory) && !missingSecret;
  const pick = async () => {
    const path = await ctx.workspaces.pickDirectory();
    if (path) setDirectory(path);
  };
  return h("section", { className: "bees-box" },
    h("div", { className: "bees-page-head" },
      h(Button, { onClick: onCancel }, "← Catalog"),
      h("div", null, h("h2", null, `Add ${entry.label}`),
        h("div", { className: "bees-muted" }, entry.summary))),
    h("div", { className: "bees-callout" },
      h("h3", null, "What this server can reach"),
      h("div", null, entry.access)),
    h("div", { className: "bees-row" },
      h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, "Published by"),
        h("div", { className: "bees-muted" }, entry.publisher)),
      h(Button, { onClick: () => openExternal(entry.homepage) }, "Open source page")),
    h("div", { className: "bees-row" },
      h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, "How it runs"),
        h("div", { className: "bees-muted" }, entry.transport === "stdio"
          ? `Bees starts \`${entry.command} ${(entry.args ?? []).join(" ")}\` on this machine.`
          : `Bees calls ${entry.url} over the internet.`),
        entry.prerequisite ? h("div", { className: "bees-muted" }, entry.prerequisite) : null)),
    entry.requiresDirectory ? h("div", { className: "bees-row" },
      h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, entry.directoryLabel ?? "Folder"),
        h("div", { className: "bees-muted" }, directory || "No folder chosen yet")),
      h(Button, { onClick: pick }, directory ? "Change" : "Choose folder")) : null,
    ...entry.secrets.map((secret) => h("label", { className: "bees-form", key: secret.name },
      h("span", null, secret.label),
      h("input", {
        className: "bees-input", type: "password", autoComplete: "off", value: secrets[secret.name] ?? "",
        placeholder: secret.help ?? "",
        onChange: (event) => setSecrets({ ...secrets, [secret.name]: event.target.value })
      }),
      secret.help ? h("span", { className: "bees-muted" }, secret.help) : null)),
    entry.secrets.length ? h("p", { className: "bees-muted" },
      "Secrets are kept in your DSH credential store, not in the Bees database.") : null,
    h("div", { className: "bees-detail-actions" },
      h(Button, {
        className: "primary", disabled: !ready, onClick: async () => {
          setBusy(true);
          try { await onInstall({ directory, secrets }); } finally { setBusy(false); }
        }
      }, busy ? "Adding…" : "Add and turn on"),
      h(Button, { onClick: onCancel }, "Cancel")));
}

function ManualServerForm({ onCancel, act }) {
  const [transport, setTransport] = useState("stdio");
  return h("form", {
    className: "bees-box bees-form", onSubmit: async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const secrets = {};
      for (const line of String(form.get("secrets") ?? "").split("\n")) {
        const at = line.indexOf("=");
        if (at > 0) secrets[line.slice(0, at).trim()] = line.slice(at + 1).trim();
      }
      const created = await act({
        action: "add_mcp_server", transport,
        serverName: String(form.get("serverName") ?? ""), label: String(form.get("label") ?? ""),
        command: String(form.get("command") ?? ""), args: String(form.get("args") ?? ""),
        url: String(form.get("url") ?? ""), secrets
      });
      if (created?.id) onCancel();
    }
  },
    h("div", { className: "bees-page-head" }, h(Button, { onClick: onCancel }, "← MCP servers"),
      h("div", null, h("h2", null, "Add a server by hand"),
        h("div", { className: "bees-muted" }, "Only add a server you trust. Its tools go straight to your agents."))),
    h("label", null, "Short name", h("input", {
      className: "bees-input", name: "serverName", required: true, autoFocus: true, placeholder: "linear",
      pattern: "[A-Za-z0-9_-]{1,32}", title: "Letters, digits, dash and underscore, up to 32 characters"
    }), h("span", { className: "bees-muted" }, "Every tool this server publishes is prefixed with it.")),
    h("label", null, "Display name", h("input", { className: "bees-input", name: "label", placeholder: "Linear" })),
    h("label", null, "How it runs", h("select", {
      className: "bees-select", value: transport, onChange: (event) => setTransport(event.target.value)
    }, h("option", { value: "stdio" }, "Run a command on this machine"),
      h("option", { value: "streamable-http" }, "Call a URL over HTTP"))),
    transport === "stdio" ? h(React.Fragment, null,
      h("label", null, "Command", h("input", { className: "bees-input", name: "command", required: true, placeholder: "npx" })),
      h("label", null, "Arguments, one per line", h("textarea", {
        className: "bees-textarea", name: "args", placeholder: "-y\n@modelcontextprotocol/server-memory"
      })),
      h("label", null, "Environment secrets, one NAME=value per line", h("textarea", {
        className: "bees-textarea", name: "secrets", placeholder: "API_KEY=…"
      })))
      : h(React.Fragment, null,
        h("label", null, "Server URL", h("input", {
          className: "bees-input", name: "url", required: true, type: "url", placeholder: "https://example.com/mcp"
        })),
        h("label", null, "Headers, one Name=value per line", h("textarea", {
          className: "bees-textarea", name: "secrets", placeholder: "Authorization=Bearer …"
        }))),
    h("p", { className: "bees-muted" }, "Values on those last lines are stored in your DSH credential store."),
    h("div", { className: "bees-detail-actions" },
      h("button", { className: "bees-btn primary" }, "Add and turn on"),
      h(Button, { onClick: onCancel }, "Cancel")));
}

export function McpPage({ ctx, capabilities }) {
  const { data, error, act } = capabilities;
  const [reviewing, setReviewing] = useState("");
  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState("");
  if (error && !data) return h(Empty, null, error);
  if (!data) return h(Empty, null, "Reading connected servers…");
  const entry = data.catalog.find(({ id }) => id === reviewing);
  if (manual) return h(ManualServerForm, { onCancel: () => setManual(false), act });
  if (entry) return h(CatalogReview, {
    ctx, entry, onCancel: () => setReviewing(""),
    onInstall: async ({ directory, secrets }) => {
      const created = await act({ action: "install_mcp_server", catalogId: entry.id, directory, secrets });
      if (created?.id) setReviewing("");
    }
  });
  const needle = query.trim().toLocaleLowerCase();
  const catalog = data.catalog.filter((row) => matches(needle, row.label, row.summary, row.publisher));
  return h("div", { className: "bees-stack" },
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    h("div", { className: "bees-callout" },
      h("h3", null, "MCP servers give your agents new tools"),
      h("div", null, "An MCP server is a small program Bees runs, or a URL it calls, that publishes "
        + "tools. Bees does not turn any on for you: pick one below, read what it can reach, and add "
        + "it. Everything it publishes then shows up under Skills & tools.")),
    h("section", { className: "bees-box" },
      h("div", { className: "bees-row" },
        h("div", { className: "bees-row-main" }, h("h3", null, "Connected servers"),
          h("div", { className: "bees-muted" }, "Turning one off stops its program and removes its tools.")),
        h(Button, { onClick: () => setManual(true) }, "Add by hand")),
      ...(data.servers.length ? data.servers.map((server) => h("div", { className: "bees-row", key: server.id },
        h("div", { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, server.label),
          h("div", { className: "bees-muted" }, [
            `${server.toolCount} tool${server.toolCount === 1 ? "" : "s"}`,
            server.transport === "stdio" ? `${server.command} ${server.args.join(" ")}`.trim() : server.url,
            server.source === "catalog" ? "from the catalog" : "added by hand"
          ].filter(Boolean).join(" · ")),
          server.error ? h("div", { className: "bees-muted" }, server.error) : null),
        h("span", { className: `bees-status ${STATUS_CLASS[server.status] ?? ""}` }, STATUS_LABEL[server.status] ?? server.status),
        h(Button, {
          onClick: () => act({ action: "set_mcp_server_enabled", serverId: server.id, enabled: !server.enabled })
        }, server.enabled ? "Turn off" : "Turn on"),
        h(Button, {
          className: "danger",
          onClick: async () => (await confirmAction(`Remove ${server.label}? Its tools disappear from every agent.`))
            && act({ action: "remove_mcp_server", serverId: server.id })
        }, "Remove")))
        : [h(Empty, { key: "empty" }, "No MCP servers connected yet")])),
    h("h3", { className: "bees-section-title" }, "Add a popular server"),
    h(Filter, { value: query, onChange: setQuery, placeholder: "Filter the catalog" }),
    h("div", { className: "bees-grid" }, ...catalog.map((row) => h("section", { className: "bees-box", key: row.id },
      h("h3", null, row.label),
      h("p", { className: "bees-muted" }, row.summary),
      h("p", { className: "bees-muted" }, row.publisher),
      h("div", { className: "bees-detail-actions" },
        h(Button, {
          className: row.installedAs ? "" : "primary",
          onClick: () => setReviewing(row.id)
        }, row.installedAs ? "Add another" : "Review and add"))))),
    catalog.length ? null : h(Empty, null, "No catalog entry matches that")
  );
}
