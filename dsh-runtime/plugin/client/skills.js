import { h, React, useEffect, useState } from "./runtime.js";
import { Button, confirmAction, Empty, openExternal, request, useSubmit, PageHead} from "./shared.js";

const STATUS_CLASS = { connected: "bees-running", "per run": "bees-running", failed: "bees-failed", starting: "", off: "" };
const STATUS_LABEL = {
  connected: "Connected", "per run": "Per run", failed: "Not running", starting: "Starting…", off: "Turned off"
};

/** One shared loader so both routes see the same servers, tools and skills. */
export function useCapabilities(route) {
  const [value, setValue] = useState(null);
  const [error, setError] = useState("");
  // Leaving the page is how you dismiss a message; it must not follow you to the next one.
  useEffect(() => setError(""), [route]);
  // A refresh must never wipe a message the person has not read yet, so only their own action clears it.
  const load = async ({ quiet = false } = {}) => {
    try { setValue(await request("/bees-api/capabilities")); if (!quiet) setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  useEffect(() => {
    void load();
    // A server that is still starting has no tools yet, so the page has to look again.
    const timer = setInterval(() => void load({ quiet: true }), 4000);
    return () => clearInterval(timer);
  }, []);
  const act = async (command) => {
    try {
      const result = await request("/bees-api/capabilities", { method: "POST", body: JSON.stringify(command) });
      setError("");
      await load({ quiet: true });
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

/** Browse one public collection and install a single skill from it. */
/** The three suggestions are a starting point, not the limit: any public repository laid
 *  out as Agent Skills can be browsed and installed from. */
function AddRepo({ act }) {
  const [repo, setRepo] = useState("");
  const [added, setAdded] = useState([]);
  const submit = (event) => {
    event.preventDefault();
    const name = repo.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$|\/+$/g, "");
    if (!name || added.some((pack) => pack.repo === name)) return setRepo("");
    setAdded([{ repo: name, label: name, note: "Added by you" }, ...added]);
    setRepo("");
  };
  return h(React.Fragment, null,
    h("form", { className: "bees-box", onSubmit: submit },
      h("div", { className: "bees-row" },
        h("div", { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, "Browse another collection"),
          h("input", {
            className: "bees-input", value: repo, placeholder: "owner/name",
            "aria-label": "GitHub repository", onChange: (event) => setRepo(event.target.value)
          })),
        h(Button, { className: "primary", type: "submit" }, "Browse"))),
    ...added.map((pack) => h(SkillPack, { pack, act, key: pack.repo })));
}

function SkillPack({ pack, act }) {
  const [state, setState] = useState({ open: false, skills: null, note: "" });
  const open = async () => {
    setState({ open: true, skills: null, note: "Reading what this collection publishes…" });
    const found = await act({ action: "list_skill_pack", repo: pack.repo });
    setState({ open: true, skills: found?.skills ?? [], note: found ? "" : "Could not read that collection." });
  };
  return h("section", { className: "bees-box" },
    h("div", { className: "bees-row" },
      h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, pack.label),
        h("div", { className: "bees-muted" }, `${pack.note} · github.com/${pack.repo}`)),
      h(Button, { onClick: () => state.open ? setState({ open: false, skills: null, note: "" }) : open() },
        state.open ? "Close" : "Browse")),
    state.note ? h("p", { className: "bees-muted" }, state.note) : null,
    ...(state.skills ?? []).map((skill) => h("div", { className: "bees-row", key: skill.path },
      h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, skill.name),
        h("div", { className: "bees-muted" }, skill.directory)),
      h(Button, {
        onClick: async () => (await confirmAction(`Install ${skill.name} from ${pack.repo}? It becomes instructions any agent can open.`))
          && act({ action: "install_skill", repo: pack.repo, directory: skill.directory })
      }, skill.installed ? "Reinstall" : "Install"))),
    state.open && state.skills && !state.skills.length
      ? h(Empty, null, "This collection publishes no skills right now") : null);
}

export function SkillsPage({ capabilities, onAddTools }) {
  const { data, error, act } = capabilities;
  const [query, setQuery] = useState("");
  if (error && !data) return h(Empty, null, error);
  if (!data) return h(Empty, null, "Reading the skill and tool catalog…");
  const needle = query.trim().toLocaleLowerCase();
  const skills = data.skills.filter((skill) => matches(needle, skill.name, skill.description, skill.whenToUse));
  const tools = data.tools.filter((tool) => matches(needle, tool.name, tool.description, tool.serverLabel));
  const builtIn = tools.filter(({ serverName }) => !serverName);
  const fromServers = tools.filter(({ serverName }) => serverName);
  return h("div", { className: "bees-stack" },
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    h("div", { className: "bees-callout" },
      h("h3", null, "What your agents can actually do"),
      h("div", null, "A skill is a written instruction sheet an agent can open when it needs one. A tool "
        + "is something an agent can run. Both are live here: what this page lists is what a run can "
        + "reach right now. Add more tools by connecting an MCP server.")),
    h(Filter, { value: query, onChange: setQuery, placeholder: "Filter skills and tools" }),
    h("section", { className: "bees-box" }, h("div", { className: "bees-row" },
      h("div", { className: "bees-row-main" }, h("h3", null, "Give your agents a new tool"),
        h("div", { className: "bees-muted" }, "Tools come from MCP servers. Pick one from the catalog, "
          + "or point Bees at any REST API.")),
      h(Button, { className: "primary", onClick: onAddTools }, "Add an MCP server"))),
    h("section", { className: "bees-box" },
      h("h3", null, `Skills (${skills.length})`),
      data.skillsComplete ? null : h("p", { className: "bees-muted" },
        "No preset could be read, so this list may be short."),
      h("p", { className: "bees-muted" }, "Skills come from your skill folders. Drop a folder containing "
        + "SKILL.md into one of them and it appears here without restarting Bees."),
      ...(skills.length ? skills.map((skill) => h("div", { className: "bees-row", key: skill.name },
        h("div", { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, skill.name),
          h("div", { className: "bees-muted" }, skill.description || "No description"),
          skill.whenToUse ? h("div", { className: "bees-muted" }, `When to use: ${skill.whenToUse}`) : null,
          skill.presets?.length ? h("div", { className: "bees-muted" }, `Available to: ${skill.presets.join(", ")}`) : null),
        skill.provider ? h("span", { className: "bees-badge" }, skill.provider) : null,
        skill.removable ? h(Button, {
          className: "danger",
          onClick: async () => (await confirmAction(`Remove ${skill.name} from ${data.skillsRoot}?`))
            && act({ action: "remove_skill", name: skill.name })
        }, "Remove") : null))
        : [h(Empty, { key: "empty" }, needle ? "No skill matches that" : "No skills installed yet")])),
    h("h3", { className: "bees-section-title" }, "Install skills from a public collection"),
    h("p", { className: "bees-muted" }, `Installed skills land in ${data.skillsRoot} and show up above `
      + "straight away. A skill is written instructions, so read what it tells an agent to do before "
      + "you install one."),
    ...(data.skillPacks ?? []).map((pack) => h(SkillPack, { pack, act, key: pack.repo })),
    h(AddRepo, { act, key: "add-repo" }),
    h("section", { className: "bees-box" },
      h("h3", null, `Tools from MCP servers (${fromServers.length})`),
      ...(fromServers.length ? fromServers.map((tool) => h("div", { className: "bees-row", key: tool.name },
        h("div", { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, tool.name),
          h("div", { className: "bees-muted" }, tool.description || "No description")),
        h("span", { className: "bees-badge" }, tool.serverLabel)))
        : [h("div", { className: "bees-row", key: "empty" },
            h("div", { className: "bees-row-main" },
              h("div", { className: "bees-muted" }, "No MCP server is connected, so there are no extra tools yet.")),
            h(Button, { onClick: onAddTools }, "Add one"))])),
    ...(data.presets ?? []).map((preset) => {
      const own = preset.tools.filter((tool) => matches(needle, tool.name, tool.description));
      return h("section", { className: "bees-box", key: preset.id },
        h("h3", null, `${preset.name} preset · ${own.length} tools`),
        preset.broken
          ? h("p", { className: "bees-muted" }, preset.broken)
          : h("p", { className: "bees-muted" }, "What an agent on this preset can run. Which preset an "
            + "agent uses is set on the agent; what a preset contains is edited in runtime settings."),
        ...(own.length ? own.map((tool) => h("div", { className: "bees-row", key: tool.name },
          h("div", { className: "bees-row-main" },
            h("div", { className: "bees-row-title" }, tool.name),
            h("div", { className: "bees-muted" }, tool.description || "No description"))))
          : [h(Empty, { key: "empty" }, needle ? "No tool matches that" : "This preset gives an agent no tools")]));
    }),
    builtIn.length ? h("section", { className: "bees-box" },
      h("h3", null, `Registered outside any preset (${builtIn.length})`),
      ...builtIn.map((tool) => h("div", { className: "bees-row", key: tool.name },
        h("div", { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, tool.name),
          h("div", { className: "bees-muted" }, tool.description || "No description"))))) : null
  );
}

/**
 * The review screen for one catalog entry. Nothing installs until the publisher, the reach, and the
 * inputs have all been shown once, because installing runs someone else's program on this machine.
 */
function CatalogReview({ ctx, entry, onCancel, onInstall, setPageHeader }) {
  const [directory, setDirectory] = useState("");
  const [secrets, setSecrets] = useState({});
  const [inputs, setInputs] = useState({});
  const [busy, setBusy] = useState(false);
  const blank = (bag) => ({ name, optional }) => !optional && !String(bag[name] ?? "").trim();
  const ready = !busy && (!entry.requiresDirectory || directory)
    && !entry.secrets.some(blank(secrets)) && !(entry.inputs ?? []).some(blank(inputs));
  const pick = async () => {
    const path = await ctx.uiWorkspace.pickDirectory();
    if (path) setDirectory(path);
  };
  return h("section", { className: "bees-box" },
    h(PageHead, { setPageHeader },
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
    ...(entry.inputs ?? []).map((field) => h("label", { className: "bees-form", key: field.name },
      h("span", null, field.label),
      h(field.textarea ? "textarea" : "input", {
        className: field.textarea ? "bees-textarea" : "bees-input",
        value: inputs[field.name] ?? "",
        placeholder: field.textarea ? "curl 'https://api.example.com/v1/things' -H 'Authorization: Bearer …'" : "",
        onChange: (event) => setInputs({ ...inputs, [field.name]: event.target.value })
      }),
      field.help ? h("span", { className: "bees-muted" }, field.help) : null)),
    ...entry.secrets.map((secret) => h("label", { className: "bees-form", key: secret.name },
      h("span", null, secret.label),
      h("input", {
        className: "bees-input", type: "password", autoComplete: "off", value: secrets[secret.name] ?? "",
        onChange: (event) => setSecrets({ ...secrets, [secret.name]: event.target.value })
      }),
      secret.help ? h("span", { className: "bees-muted" }, secret.help) : null)),
    entry.secrets.length ? h("p", { className: "bees-muted" },
      "Secrets are kept in your local credential store, not in the Bees database.") : null,
    h("div", { className: "bees-detail-actions" },
      h(Button, {
        className: "primary", disabled: !ready, onClick: async () => {
          setBusy(true);
          try { await onInstall({ directory, secrets, inputs }); } finally { setBusy(false); }
        }
      }, busy ? "Adding…" : "Add and turn on"),
      h(Button, { onClick: onCancel }, "Cancel")));
}

function ManualServerForm({ onCancel, act, setPageHeader }) {
  const [transport, setTransport] = useState("stdio");
  const [busy, onSubmit] = useSubmit(async (event) => {
      const form = new FormData(event.currentTarget);
      const secrets = {};
      for (const line of String(form.get("secrets") ?? "").split("\n")) {
        const at = line.indexOf("=");
        if (at > 0) secrets[line.slice(0, at).trim()] = line.slice(at + 1).trim();
      }
      const created = await act({
        action: "add_mcp_server", transport,
        serverName: String(form.get("serverName") ?? ""), label: String(form.get("label") ?? ""),
        command: String(form.get("command") ?? ""), args: String(form.get("args") ?? "").split("\n"),
        url: String(form.get("url") ?? ""), secrets
      });
      if (created?.id) onCancel();
  });
  return h("form", { className: "bees-box bees-form", onSubmit },
    h(PageHead, { setPageHeader }, h(Button, { onClick: onCancel }, "← MCP servers"),
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
    h("p", { className: "bees-muted" }, "Values on those last lines are stored in your local credential store."),
    h("div", { className: "bees-detail-actions" },
      h("button", { className: "bees-btn primary", disabled: busy }, busy ? "Adding…" : "Add and turn on"),
      h(Button, { onClick: onCancel }, "Cancel")));
}

export function McpPage({ ctx, capabilities }) {
  const { data, error, act } = capabilities;
  const [reviewing, setReviewing] = useState("");
  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState("");
  const [registry, setRegistry] = useState({ query: "", results: null, note: "" });
  const searchRegistry = async (text) => {
    setRegistry({ query: text, results: null, note: "Searching the public registry…" });
    const found = await act({ action: "search_mcp_registry", query: text });
    setRegistry({ query: text, results: found?.results ?? [], note: "" });
  };
  if (error && !data) return h(Empty, null, error);
  if (!data) return h(Empty, null, "Reading connected servers…");
  const entry = data.catalog.find(({ id }) => id === reviewing);
  if (manual) return h(ManualServerForm, { onCancel: () => setManual(false), act });
  if (entry) return h(CatalogReview, {
    ctx, entry, onCancel: () => setReviewing(""),
    onInstall: async ({ directory, secrets, inputs }) => {
      const created = await act({ action: "install_mcp_server", catalogId: entry.id, directory, secrets, inputs });
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
            // The browser mounts per run, so a tool count and a command line would only mislead here.
            ...(server.perRun ? ["one headless Chrome per run, signed in through the shared cookie file"] : [
              `${server.toolCount} tool${server.toolCount === 1 ? "" : "s"}`,
              server.transport === "stdio" ? `${server.command} ${server.args.join(" ")}`.trim() : server.url]),
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
    catalog.length ? null : h(Empty, null, "No catalog entry matches that"),
    h("h3", { className: "bees-section-title" }, "Search the public MCP registry"),
    h("p", { className: "bees-muted" }, "Everything the community has published. These are not "
      + "reviewed by Bees, so read what a server does before you add it."),
    h("form", {
      className: "bees-search",
      onSubmit: (event) => { event.preventDefault(); void searchRegistry(new FormData(event.currentTarget).get("q")); }
    },
      h("input", { className: "bees-input", name: "q", defaultValue: registry.query, placeholder: "Search the registry", "aria-label": "Search the MCP registry" }),
      h("button", { className: "bees-btn primary" }, "Search")),
    registry.note ? h("p", { className: "bees-muted" }, registry.note) : null,
    ...(registry.results ?? []).map((row) => h("div", { className: "bees-row", key: row.name },
      h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, row.title),
        h("div", { className: "bees-muted" }, row.description || row.name),
        h("div", { className: "bees-muted" }, row.url)),
      h(Button, {
        onClick: async () => (await confirmAction(`Add ${row.title}? Bees will call ${row.url} and hand its tools to your agents.`))
          && act({
            action: "add_mcp_server", transport: "streamable-http",
            serverName: row.serverName, label: row.title, url: row.url
          })
      }, "Add"))),
    registry.results && !registry.results.length
      ? h(Empty, null, "The registry returned no remote server for that") : null
  );
}
