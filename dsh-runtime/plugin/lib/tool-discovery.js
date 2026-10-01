import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { scopeOf } from "@deepseek-ai/dsh-scope";
import { defineTool } from "@deepseek-ai/dsh-tools";

// A small model cannot do the search dance: it looks for its task words, misses, and reports that
// the run has no tools. Reading, writing and the web are what most work needs, so they stay visible.
const BASE_TOOLS = new Set([
  "bees_append_file", "bees_acquire_file_locks", "bees_release_file_locks", "bees_commit_file",
  "bees_find_tools", "bees_read_tool_result", "bees_submit_stage_result", "bees_propose_changes", "bees_search_mcp_registry", "bees_list_skill_pack",
  "ask_user_question", "bees_request_work_review", "bees_wait_for_peers", "bees_read_context", "bees_share_update",
  // the brief tells a team run to ask its team with this, so it must be visible where it is registered
  "bees_ask_team",
  "web_search", "web_fetch", "bees_fetch_page", "bees_search_news", "bees_search_web", "read", "read_image", "write", "present",
  "bees_control", "bees_publish_outputs", "bees_delegate_work", "bees_revise_work", "bees_resolve_failed_work", "bees_read_work_evidence", "bees_search_knowledge", "bees_read_knowledge"
]);
const HIDDEN_TOOLS = new Set(["subagent", "subagent_fork", "list_agents", "wait_agent"]);
const PAGE_SIZE = 4;
const RETAINED_TOOLS = 8;

/** Present a small native toolkit; actual registrations and execution guards remain authoritative. */
export function mountToolDiscovery(agentCtx, credentials, allowed = () => true) {
  if (!agentCtx.on || !agentCtx.tools.schemas) return;
  const owner = scopeOf(agentCtx);
  const loaded = new Set();
  agentCtx.on("system-prompt/assemble", async (_assembly, context, next) => {
    const assembly = await next();
    // Scoped listeners also receive descendant events. Each run owns its own selection.
    if (context.scope !== owner || agentCtx.tools.modeFor?.(owner) === "ptc") return assembly;
    // web_search is DeepSeek-backed and errors on every call without its key
    const searchable = Boolean((await credentials.resolve(credentialRef("DEEPSEEK_API_KEY")))?.value);
    const shown = ({ name }) => !HIDDEN_TOOLS.has(name) && (searchable || name !== "web_search") && (BASE_TOOLS.has(name) || loaded.has(name));
    return { ...assembly, tools: assembly.tools.filter(shown), sections: assembly.sections.filter(({ name }) => !assembly.tools.some((tool) => !shown(tool) && name === `tool:${tool.name}`)) };
  });
  agentCtx.tools.register(defineTool({
    name: "bees_find_tools",
    description: "Find tools by exact name or capability words (files, shell, web, skills, delegation, etc.). Loads up to 4 matching schemas for your next call; the last 8 stay loaded. Empty query lists tools. Follow next_offset to see more. Existing permissions still apply.",
    parameters: {
      query: { type: "string", required: true, description: "Tool name or capability words; max 256 characters." },
      offset: { type: "integer", description: "next_offset from the previous result, otherwise 0." }
    },
    output: {
      schema: { type: "object", additionalProperties: false, properties: { result: { type: "string", required: true } } },
      render: (_args, value) => [{ type: "text", text: value.result }]
    },
    execute: (args, exec) => {
      if (exec.agent !== owner) throw new Error("Tool discovery belongs to this run's own agent");
      if (typeof args.query !== "string" || args.query.length > 256)
        throw new Error("Tool query must be a string of at most 256 characters");
      const offset = args.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Tool offset must be a non-negative integer");
      const query = args.query.trim().toLowerCase();
      const words = query.split(/\s+/).filter(Boolean);
      // Re-read the calling agent's registry: preset and MCP tools may register after setup.
      const matches = agentCtx.tools.schemas(exec.agent).filter(({ name }) =>
        allowed(name) && !HIDDEN_TOOLS.has(name) && !BASE_TOOLS.has(name))
        .map((tool) => {
          const name = tool.name.toLowerCase();
          const text = `${name} ${tool.description ?? ""}`.toLowerCase();
          const score = name === query ? 1000 : words.reduce((sum, word) =>
            sum + (name.includes(word) ? 2 : text.includes(word) ? 1 : 0), 0);
          return { tool, score };
        })
        .filter(({ score }) => !query || score > 0)
        .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name));
      const slice = matches.slice(offset, offset + PAGE_SIZE).map(({ tool }) => tool);
      // a small add-on comes whole, or the agent misses the sibling call it needs (like "who am I") and asks the owner instead
      const all = agentCtx.tools.schemas(exec.agent).filter(({ name }) => allowed(name) && !HIDDEN_TOOLS.has(name));
      const prefix = slice[0]?.name.match(/^mcp__.+?__/)?.[0];
      const siblings = prefix ? all.filter(({ name }) => name.startsWith(prefix)) : [];
      // siblings go first so the matches themselves survive the retained cap
      const page = [...new Map([...(siblings.length <= RETAINED_TOOLS ? siblings : []), ...slice].map((tool) => [tool.name, tool])).values()];
      for (const { name } of page) {
        loaded.delete(name);
        loaded.add(name);
      }
      while (loaded.size > RETAINED_TOOLS) loaded.delete(loaded.values().next().value);
      return { result: JSON.stringify({
        tools: page.map(({ name, description }) => ({ name, description: String(description ?? "").slice(0, 180) })),
        total: matches.length,
        next_offset: offset + slice.length < matches.length ? offset + slice.length : null
      }) };
    }
  }));
}
