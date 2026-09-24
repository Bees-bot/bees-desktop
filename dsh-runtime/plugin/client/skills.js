import { h, React, useEffect, useRef, useState } from "./runtime.js";
import { Button, confirmAction, Empty, McpCard, openExternal, request, useSubmit } from "./shared.js";

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

/** Add an optional public repository to the curated collections. */
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
  return h("details", { className: "bees-capability-custom" },
    h("summary", null, "Advanced: install from another GitHub repository"),
    h("p", { className: "bees-muted" },
      "Enter a public repository containing Agent Skills. Nothing installs until you choose a skill."),
    h("form", { className: "bees-row", onSubmit: submit },
      h("input", {
        className: "bees-input bees-grow", value: repo, placeholder: "owner/repository",
        "aria-label": "Public GitHub repository", onChange: (event) => setRepo(event.target.value)
      }),
      h(Button, { className: "primary", type: "submit", disabled: !repo.trim() }, "Add collection")),
    ...added.map((pack) => h(SkillPack, { pack, act, key: pack.repo })));
}

function SkillPack({ pack, act }) {
  const [state, setState] = useState({ skills: null, note: "" });
  const load = async () => {
    if (state.skills !== null || state.note) return;
    setState({ skills: null, note: "Loading available skills…" });
    const found = await act({ action: "list_skill_pack", repo: pack.repo });
    setState({ skills: found?.skills ?? null, note: found ? "" : "Could not load this collection. Close it and try again." });
  };
  return h("details", { className: "bees-capability-group", onToggle: (event) => {
    if (event.currentTarget.open) void load();
    else if (state.skills === null) setState({ skills: null, note: "" });
  } },
    h("summary", null,
      h("span", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, pack.label),
        h("div", { className: "bees-muted" }, `${pack.note} · github.com/${pack.repo}`)),
      h("span", { className: "bees-muted" }, "View skills")),
    state.note ? h("p", { className: "bees-muted bees-capability-note", role: "status" }, state.note) : null,
    ...(state.skills ?? []).map((skill) => h("div", { className: "bees-row", key: skill.path },
      h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, skill.name),
        h("div", { className: "bees-muted" }, skill.directory)),
      h(Button, {
        onClick: async () => (await confirmAction(`Install ${skill.name} from ${pack.repo}? It becomes instructions any agent can open.`))
          && act({ action: "install_skill", repo: pack.repo, directory: skill.directory })
      }, skill.installed ? "Reinstall" : "Install"))),
    state.skills && !state.skills.length
      ? h(Empty, null, "This collection publishes no skills right now") : null);
}

export function SkillsPage({ capabilities }) {
  const { data, error, act } = capabilities;
  const [query, setQuery] = useState("");
  if (error && !data) return h(Empty, null, error);
  if (!data) return h(Empty, null, "Reading the skill and tool catalog…");
  const needle = query.trim().toLocaleLowerCase();
  const skills = data.skills.filter((skill) => matches(needle, skill.name, skill.description, skill.whenToUse));
  const tools = data.tools.filter((tool) => matches(needle, tool.name, tool.description, tool.serverLabel));
  const builtIn = tools.filter(({ serverName }) => !serverName);
  const fromServers = tools.filter(({ serverName }) => serverName);
  const mcpGroups = [...new Map(fromServers.map((tool) => [tool.serverName, tool.serverLabel])).entries()];
  return h("div", { className: "bees-stack" },
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    h(Filter, { value: query, onChange: setQuery, placeholder: "Search skills and tools" }),
    h("section", { className: "bees-box" },
      h("h3", null, `Skills (${skills.length})`),
      data.skillsComplete ? null : h("p", { className: "bees-muted" },
        "No preset could be read, so this list may be short."),
      ...(skills.length ? skills.map((skill) => h("div", { className: "bees-row bees-capability-row", key: skill.name },
        h("div", { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, skill.name),
          h("div", { className: "bees-muted bees-capability-description", title: skill.description },
            skill.description || "No description")),
        skill.provider ? h("span", { className: "bees-badge" }, skill.provider) : null,
        skill.removable ? h(Button, {
          className: "danger",
          onClick: async () => (await confirmAction(`Remove ${skill.name} from ${data.skillsRoot}?`))
            && act({ action: "remove_skill", name: skill.name })
        }, "Remove") : null))
        : [h(Empty, { key: "empty" }, needle ? "No skill matches that" : "No skills installed yet")])),
    h("details", { className: "bees-box bees-capability-manage" },
      h("summary", null, "Install more skills"),
      h("p", { className: "bees-muted" },
        "Expand a collection to see its available skills. Review a skill before installing it."),
      ...(data.skillPacks ?? []).map((pack) => h(SkillPack, { pack, act, key: pack.repo })),
      h(AddRepo, { act, key: "add-repo" })),
    h("section", { className: "bees-box" },
      h("h3", null, `Tools (${tools.length})`),
      ...mcpGroups.map(([serverName, serverLabel]) => {
        const own = fromServers.filter((tool) => tool.serverName === serverName);
        return h("details", {
          className: "bees-capability-group", open: needle ? true : undefined, key: serverName
        },
          h("summary", null, h("span", null, serverLabel),
            h("span", { className: "bees-muted" }, `${own.length} tool${own.length === 1 ? "" : "s"}`)),
          ...own.map((tool) => h("div", { className: "bees-row bees-capability-row", key: tool.name },
            h("div", { className: "bees-row-main" },
              h("div", { className: "bees-row-title" }, tool.name.replace(`mcp__${serverName}__`, "")),
              h("div", { className: "bees-muted bees-capability-description", title: tool.description },
                tool.description || "No description")))));
      }),
      builtIn.length ? h("details", {
        className: "bees-capability-group", open: needle ? true : undefined
      },
        h("summary", null, h("span", null, "Built-in tools"),
          h("span", { className: "bees-muted" }, `${builtIn.length} tool${builtIn.length === 1 ? "" : "s"}`)),
        ...builtIn.map((tool) => h("div", { className: "bees-row bees-capability-row", key: tool.name },
          h("div", { className: "bees-row-main" },
            h("div", { className: "bees-row-title" }, tool.name),
            h("div", { className: "bees-muted bees-capability-description", title: tool.description },
              tool.description || "No description"))))) : null,
      !tools.length ? h(Empty, null, needle ? "No tool matches that" : "No tools are available") : null)
  );
}

/**
 * The review screen for one catalog entry. Nothing installs until the publisher, the reach, and the
 * inputs have all been shown once, because installing runs someone else's program on this machine.
 */
export function CatalogReview({ ctx, entry, onCancel, onDone }) {
  const dialog = useRef(null);
  const [directory, setDirectory] = useState("");
  const [error, setError] = useState("");
  const [secrets, setSecrets] = useState({});
  const [inputs, setInputs] = useState({});
  const [busy, setBusy] = useState(false);
  // a sign-in fills the secrets, so there is nothing to paste
  const secretFields = entry.scopes ? [] : entry.secrets ?? [];
  const blank = (bag) => ({ name, optional }) => !optional && !String(bag[name] ?? "").trim();
  const incomplete = entry.requiresDirectory && !directory
    || secretFields.some(blank(secrets)) || (entry.inputs ?? []).some(blank(inputs));
  const ready = !busy && !incomplete;
  const runtime = entry.scopes ? "Connects through Google in your browser."
    : entry.transport === "stdio" ? `Runs locally: ${entry.command} ${(entry.args ?? []).join(" ")}`.trim()
    : `Connects to ${entry.url}`;
  const pick = async () => {
    const path = await ctx.uiWorkspace.pickDirectory();
    if (path) setDirectory(path);
  };
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  return h("dialog", { ref: dialog, className: "bees-mcp-dialog bees-mcp-connect-dialog",
    "aria-label": `Connect ${entry.label}`, onCancel: (event) => { event.preventDefault(); onCancel(); } },
    h("div", { className: "bees-mcp-dialog-head" },
      h("div", { className: "bees-grow" }, h("h3", null, `Connect ${entry.label}`),
        h("div", { className: "bees-muted" }, entry.summary)),
      h(Button, { onClick: onCancel, "aria-label": "Close connection setup" }, "×")),
    h("div", { className: "bees-mcp-dialog-body" },
    h("div", { className: "bees-mcp-access-note" },
      h("h3", null, "Access"),
      h("div", null, entry.access)),
    h("div", { className: "bees-mcp-dialog-meta" },
      h("div", null, h("strong", null, `Published by ${entry.publisher}`), h("span", { className: "bees-muted" }, runtime)),
      h(Button, { onClick: () => openExternal(entry.homepage) }, "View source")),
    entry.prerequisite ? h("div", { className: "bees-mcp-dialog-message" }, entry.prerequisite) : null,
    entry.requiresDirectory ? h("div", { className: "bees-row" },
      h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, entry.directoryLabel ?? "Folder"),
        h("div", { className: "bees-muted" }, directory || "No folder chosen yet")),
      h(Button, { onClick: pick }, directory ? "Change" : "Choose folder")) : null,
    ...(entry.inputs ?? []).map((field) => h("label", { className: "bees-form", key: field.name },
      h("span", null, `${field.label}${field.optional ? " (optional)" : ""}`),
      h(field.textarea ? "textarea" : "input", {
        className: field.textarea ? "bees-textarea" : "bees-input",
        value: inputs[field.name] ?? "",
        placeholder: field.textarea ? "curl 'https://api.example.com/v1/things' -H 'Authorization: Bearer …'" : "",
        onChange: (event) => setInputs({ ...inputs, [field.name]: event.target.value })
      }),
      field.help ? h("span", { className: "bees-muted" }, field.help) : null)),
    ...secretFields.map((secret) => h("label", { className: "bees-form", key: secret.name },
      h("span", null, `${secret.label}${secret.optional ? " (optional)" : ""}`),
      h("input", {
        className: "bees-input", type: "password", autoComplete: "off", value: secrets[secret.name] ?? "",
        onChange: (event) => setSecrets({ ...secrets, [secret.name]: event.target.value })
      }),
      secret.help ? h("span", { className: "bees-muted" }, secret.help) : null)),
    secretFields.length ? h("div", { className: "bees-mcp-dialog-message" },
      "Keys stay in your local credential store.") : null,
    incomplete ? h("div", { className: "bees-mcp-dialog-message", role: "status" }, "Complete the required fields to connect.") : null,
    error ? h("div", { className: "bees-mcp-dialog-message error", role: "alert" }, error) : null,
    h("div", { className: "bees-mcp-dialog-actions" },
      h(Button, { onClick: onCancel }, "Cancel"),
      h(Button, {
        className: "primary", disabled: !ready, onClick: async () => {
          setBusy(true); setError("");
          try {
            const done = await request("/bees-api/capabilities", { method: "POST", body: JSON.stringify({
              action: entry.scopes ? "connect_mcp_server" : "install_mcp_server", catalogId: entry.id, directory, secrets, inputs
            }) });
            if (done.url) await openExternal(done.url);
            onDone(done);
          } catch (reason) { setError(reason.message); } finally { setBusy(false); }
        }
      }, entry.scopes ? (busy ? "Opening Google…" : "Connect with Google") : busy ? "Connecting…" : "Connect"))));
}

// initial is a registry result when the owner added one from the search
function ManualServerForm({ onCancel, act, initial }) {
  const dialog = useRef(null);
  const [transport, setTransport] = useState(initial.url ? "streamable-http" : "stdio");
  const [error, setError] = useState("");
  const [busy, onSubmit] = useSubmit(async (event) => {
      setError("");
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
      else setError("Could not connect this server. Check the details and try again.");
  });
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  return h("dialog", { ref: dialog, className: "bees-mcp-dialog bees-mcp-connect-dialog",
    "aria-label": "Connect a custom MCP server", onCancel: (event) => { event.preventDefault(); onCancel(); } },
    h("div", { className: "bees-mcp-dialog-head" },
      h("div", { className: "bees-grow" }, h("h3", null, "Connect a custom server"),
        h("div", { className: "bees-muted" }, "Only connect a server you trust. Its tools go straight to your agents.")),
      h(Button, { onClick: onCancel, "aria-label": "Close connection setup" }, "×")),
    h("form", { className: "bees-mcp-dialog-body bees-form", onSubmit },
    h("label", null, "Short name", h("input", {
      className: "bees-input", name: "serverName", required: true, autoFocus: true, placeholder: "linear", defaultValue: initial.serverName,
      pattern: "[A-Za-z0-9_-]{1,32}", title: "Letters, digits, dash and underscore, up to 32 characters"
    }), h("span", { className: "bees-muted" }, "Every tool this server publishes is prefixed with it.")),
    h("label", null, "Display name", h("input", { className: "bees-input", name: "label", placeholder: "Linear", defaultValue: initial.title })),
    h("label", null, "How it runs", h("select", {
      className: "bees-select", value: transport, onChange: (event) => setTransport(event.target.value)
    }, h("option", { value: "stdio" }, "Run a command on this machine"),
      h("option", { value: "streamable-http" }, "Call a URL over HTTP"))),
    transport === "stdio" ? h(React.Fragment, null,
      h("label", null, "Command", h("input", { className: "bees-input", name: "command", required: true, placeholder: "npx", defaultValue: initial.command })),
      h("label", null, "Arguments, one per line", h("textarea", {
        className: "bees-textarea", name: "args", placeholder: "-y\n@modelcontextprotocol/server-memory"
      })),
      h("label", null, "Environment secrets, one NAME=value per line", h("textarea", {
        className: "bees-textarea", name: "secrets", placeholder: "API_KEY=…", defaultValue: initial.settings?.map(({ name }) => `${name}=`).join("\n")
      })))
      : h(React.Fragment, null,
        h("label", null, "Server URL", h("input", {
          className: "bees-input", name: "url", required: true, type: "url", placeholder: "https://example.com/mcp", defaultValue: initial.url
        })),
        h("label", null, "Headers, one Name=value per line", h("textarea", {
          className: "bees-textarea", name: "secrets", placeholder: "Authorization=Bearer …"
        }))),
    h("div", { className: "bees-mcp-dialog-message" }, "Keys and headers stay in your local credential store."),
    error ? h("div", { className: "bees-mcp-dialog-message error", role: "alert" }, error) : null,
    h("div", { className: "bees-mcp-dialog-actions" },
      h(Button, { onClick: onCancel }, "Cancel"),
      h("button", { className: "bees-btn primary", disabled: busy }, busy ? "Connecting…" : "Connect"))));
}

export function McpPage({ ctx, capabilities }) {
  const { data, error, act, reload } = capabilities;
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
  const needle = query.trim().toLocaleLowerCase();
  const catalog = data.catalog.filter((row) => !row.installedAs && matches(needle, row.label, row.summary, row.publisher));
  const serverCards = data.servers.map((server) => {
    const catEntry = server.catalogId ? data.catalog.find(c => c.id === server.catalogId) : null;
    return h(McpCard, {
      name: server.label, status: STATUS_LABEL[server.status] ?? server.status,
      icon: catEntry?.icon,
      meta: `${server.toolCount} tool${server.toolCount === 1 ? "" : "s"}`,
      tone: ["connected", "per run"].includes(server.status) ? "connected" : server.status === "failed" ? "warning" : "",
      key: server.id
    },
      h("div", { className: "bees-muted" }, [
        // The browser mounts per run, so a tool count and a command line would only mislead here.
        ...(server.perRun ? ["one headless Chrome per run, signed in through the shared cookie file"] : [
          `${server.toolCount} tool${server.toolCount === 1 ? "" : "s"}`,
          server.transport === "stdio" ? `${server.command} ${server.args.join(" ")}`.trim() : server.url]),
        server.source === "catalog" ? "from the catalog" : "custom connection"
      ].filter(Boolean).join(" · ")),
      server.error ? h("div", { className: "bees-muted" }, server.error) : null,
      // The folder this server may reach, which each computer picks for itself.
      server.folder === null ? null : h("div", { className: "bees-detail-actions" },
        h("span", { className: "bees-muted" }, server.folder || "No folder chosen on this computer yet"),
        h(Button, {
          onClick: async () => {
            const picked = await ctx.uiWorkspace.pickDirectory();
            if (picked) await act({ action: "set_mcp_server_folder", serverId: server.id, directory: picked });
          }
        }, server.folder ? "Change folder" : "Choose folder")),
      h("div", { className: "bees-detail-actions" },
        server.catalogId ? h(Button, { onClick: () => setReviewing(server.catalogId) }, "Connect another") : null,
        h(Button, {
          onClick: () => act({ action: "set_mcp_server_enabled", serverId: server.id, enabled: !server.enabled })
        }, server.enabled ? "Turn off" : "Turn on"),
        h(Button, {
          className: "danger",
          onClick: async () => (await confirmAction(`Remove ${server.label}? Its tools disappear from every agent.`))
            && act({ action: "remove_mcp_server", serverId: server.id })
        }, "Remove")));
  });

  const renderCatalog = () => {
    if (!catalog.length) return h(Empty, null, "No available MCP matches that search");
    return h("div", { className: "bees-mcp-grid bees-mcp-page-grid" }, ...catalog.map((row) => h(McpCard, {
      name: row.label, status: "Available", meta: row.summary, icon: row.icon, key: row.id, onOpen: () => setReviewing(row.id)
    })));
  };

  return h("div", { className: "bees-stack" },
    manual ? h(ManualServerForm, { onCancel: () => setManual(false), act, initial: manual }) : null,
    entry ? h(CatalogReview, {
      ctx, entry, onCancel: () => setReviewing(""),
      onDone: () => { setReviewing(""); void reload({ quiet: true }); }
    }) : null,
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    h("p", { className: "bees-mcp-intro" }, "Connect MCP servers to give your agents tools from other apps and services."),
    h("div", { className: "bees-detail-actions", style: { justifyContent: "flex-end", marginTop: 0 } },
      h(Button, { className: "primary", onClick: () => setManual({}) }, "Add MCP Server")),
    h("section", { className: "bees-box bees-mcp-section" },
      h("div", { className: "bees-mcp-section-head" },
        h("div", null, h("h3", null, "Connected MCPs"),
          h("div", { className: "bees-muted" }, `${data.servers.filter(({ enabled }) => enabled).length} on · ${data.servers.filter(({ enabled }) => !enabled).length} off`))),
      data.servers.length ? h("div", { className: "bees-mcp-grid bees-mcp-page-grid" }, ...serverCards)
        : h(Empty, null, "No MCP servers connected yet")),
    h("section", { className: "bees-box bees-mcp-section" },
      h("div", { className: "bees-mcp-section-head" },
        h("div", null, h("h3", null, "Available MCPs"),
          h("div", { className: "bees-muted" }, "Curated servers you can connect"))),
      h(Filter, { value: query, onChange: setQuery, placeholder: "Search available MCP servers" }),
      renderCatalog()),
    h("section", { className: "bees-box bees-mcp-section bees-mcp-community" },
    h("div", { className: "bees-mcp-section-head" }, h("div", null,
      h("h3", null, "Community registry"),
      h("div", { className: "bees-muted" }, "Search unreviewed public MCP servers when the curated list does not have what you need."))),
    h("form", {
      className: "bees-search",
      onSubmit: (event) => { event.preventDefault(); void searchRegistry(new FormData(event.currentTarget).get("q")); }
    },
      h("input", { className: "bees-input bees-grow", name: "q", defaultValue: registry.query, placeholder: "Search the registry", "aria-label": "Search the MCP registry" }),
      h("button", { className: "bees-btn" }, "Search")),
    registry.note ? h("p", { className: "bees-muted" }, registry.note) : null,
    registry.results?.length ? h("div", { className: "bees-mcp-grid bees-mcp-page-grid" }, ...registry.results.map((row) => h(McpCard, {
      name: row.title, status: "Not added", key: row.name
    },
        h("div", { className: "bees-muted" }, row.description || row.name),
        h("div", { className: "bees-muted" }, row.url ?? row.command),
        h("div", { className: "bees-detail-actions" },
          h(Button, { className: "primary", onClick: () => setManual(row) }, "Review and connect"))))) : null,
    registry.results && !registry.results.length
      ? h(Empty, null, "The registry returned no server for that") : null)
  );
}
