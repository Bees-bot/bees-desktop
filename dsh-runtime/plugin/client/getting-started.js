import { h, useEffect, useState } from "./runtime.js";
import { Button } from "./shared.js";
import { AgentModelSelect } from "./agents.js";

const SAMPLE_BRIEF = `Project: launch a neighborhood repair café in four weeks.
Budget: $600. Venue: library meeting room, free on Saturdays.
People: Maya coordinates volunteers, Jules handles publicity, Sam manages supplies.
We have five volunteers, but only two have confirmed availability.
Bring small household items; exclude mains electrical repairs until a qualified person joins.
Need a booking form, safety checklist, supply list, and an announcement.
Open questions: insurance requirements, opening hours, and how many bookings we can safely accept.`;

const STARTER_TASKS = [
  { id: "plan", title: "Turn notes into an action plan", prompt: "Create a practical launch plan from the brief. Include milestones, owners, budget, risks, and decisions that need my input." },
  { id: "review", title: "Find risks and missing decisions", prompt: "Review the brief for gaps and risks. Prioritize the five most important issues and propose concrete next actions." },
  { id: "brief", title: "Write a one-page project brief", prompt: "Turn the brief into a clear one-page project summary with the goal, constraints, responsibilities, and next steps." }
];

export function onboardingProgress(data, teamId, state, aiReady) {
  const team = data.teams.find((row) => row.id === teamId);
  const locations = data.locations.filter((row) => row.teamId === teamId && row.mapped && !row.archivedAt);
  const item = data.items.find((row) => row.id === state.workItemId);
  const output = item && data.runs.some((run) => run.workItemId === item.id && run.outputs?.length);
  return [Boolean(team), aiReady, Boolean(locations.length || state.filesChoice),
    Boolean(item && item.runtimePhase !== "cancelled" && (item.completed || item.runtimePhase === "completed") && output)];
}

// starter tasks say "from the brief", so they get the sample unless files were attached as the brief
const usesSampleBrief = (text, filesChoice, inputs) => filesChoice === "sample" ||
  (!inputs && STARTER_TASKS.some((task) => task.prompt === text));

export function starterDescription(prompt, filesChoice, inputs) {
  const text = prompt.trim();
  return `${text}\n\n${usesSampleBrief(text, filesChoice, inputs) ? `Sample brief (fictional):\n${SAMPLE_BRIEF}\n\n` : ""}In Work, discuss the approach with the seated planning partner, reconcile their critique, then execute and write the final result to outputs/first-result.md. Review checks the finished result in a fresh session. Use the files explicitly attached to this task, or the brief above. Do not invent missing facts; list open questions. Do not contact people, publish anything, or purchase anything.`;
}

export function planningAgents(data, workspaceId) {
  const process = data.processes?.find((row) => row.workspaceId === workspaceId && row.kind === "goals");
  if (!process) return [];
  const stage = data.stages?.filter((row) => row.processId === process.id).sort((a, b) => a.position - b.position)[0];
  // teams made after the two-agent route was dropped run Work and Review on the team's own work and review agents
  const agents = data.assignments?.filter((row) => row.workspaceId === workspaceId) ?? [];
  return (stage?.agentIds?.length ? stage.agentIds.map((id) => agents.find((row) => row.id === id))
    : ["worker", "reviewer"].map((role) => agents.find((row) => row.systemRole === role))).filter(Boolean);
}

export function onboardingAiKey(data, workspaceId, config) {
  const agents = planningAgents(data, workspaceId).map(({ id, model, reasoningEffort, enabled }) => ({ id, model, reasoningEffort, enabled }));
  // only providers in use count, and a local model counts by id since each start gives it a new port
  const used = [data.systemDefaultModel?.provider, ...agents.map(({ model }) => String(model ?? "").split("/")[0])].filter(Boolean);
  return JSON.stringify({ workspaceId, selection: data.systemDefaultModel, agents,
    providers: [...new Set(used)].map((id) => id.startsWith("local-openai-") ? id : config?.providers?.[id] ?? null) });
}

export function GettingStarted({ ctx, data, parts, state, update, aiReady, aiStatus, testAi, busy, saveAgentModel,
  go, start, openWorkItem, navigate, ensureTeam }) {
  const [task, setTask] = useState(state.task || "plan");
  const [prompt, setPrompt] = useState(state.prompt || STARTER_TASKS[0].prompt);
  const done = onboardingProgress(data, parts.teamId, state, aiReady);
  const step = Math.min(3, Math.max(0, state.step || 0));
  const titles = ["Make space for your work", "Choose your AI", "Give Bees something to work with", "Create your first result"];
  const agents = planningAgents(data, parts.workspaceId);
  const teamLocations = data.locations.filter((row) => row.teamId === parts.teamId && row.mapped && !row.archivedAt);
  const inputs = teamLocations.filter((row) => (state.inputLocationIds || []).includes(row.id)).length;
  // a cancelled first task gives the form back so the person can start again
  const firstItem = data.items.find(({ id, runtimePhase }) => id === state.workItemId && runtimePhase !== "cancelled");
  const failed = firstItem?.runtimePhase === "failed";
  // Step 1 names its own next move, so the footer button beside it was a second copy of the same
  // click under a vaguer label. Hide it only when the panel really does have that button.
  const stepOneHasItsOwnButton = done[0] || (!parts.team && parts.organizationId);
  const defaultModel = data.systemDefaultModel?.provider && data.systemDefaultModel?.model
    ? `${data.systemDefaultModel.provider}/${data.systemDefaultModel.model}` : "Choose your AI above";
  return h("div", { className: "bees-stack bees-onboarding" },
    h("section", { className: "bees-callout" }, h("h1", null, "Your first result starts here"),
      h("p", null, "Set up your workspace, choose AI, and watch Bees turn a brief into a useful file."),
      h("div", { className: "bees-card-actions" },
        h(Button, { onClick: () => { update({ active: false }); navigate("home"); } }, "Set up later"),
        h(Button, { onClick: () => navigate("basics") }, "Bees basics"))),
    h("nav", { className: "bees-onboarding-steps", "aria-label": "Getting started steps" },
      ...titles.map((title, index) => h("button", { type: "button", key: title,
        className: `bees-box ${step === index ? "active" : ""}`, "aria-current": step === index ? "step" : undefined,
        onClick: () => update({ step: index, active: true }) },
        // Only steps already passed read Complete, since a later step can already be done before you reach it.
        h("span", { className: "bees-badge" }, done[index] && index < step ? "✓ Complete" : `Step ${index + 1}`),
        h("strong", null, title)))),
    h("section", { className: "bees-box bees-stack" }, h("h2", null, titles[step]),
      step === 0 ? h("div", { className: "bees-stack" },
        h("p", null, parts.team ? `You can start in ${parts.organization?.name || "your organization"} · ${parts.team.name}, or create a new workspace.` : "Give your organization a name. We’ll create a Default team for your first task."),
        h("div", { className: "bees-card-actions" },
          done[0] ? h(Button, { className: "primary", onClick: () => update({ step: 1 }) }, "Use this workspace") : null,
          !parts.team && parts.organizationId ? h(Button, { disabled: busy, onClick: ensureTeam }, "Create Default team") : null,
          h(Button, { onClick: () => go(0) }, "Create workspace"),
          h(Button, { onClick: () => navigate("accounts") }, "Join an existing organization"))) : null,
      step === 1 ? h("div", { className: "bees-stack" },
        h("p", null, "Use AI on this computer, connect Codex or Claude, or choose another provider. Downloads can continue while you finish setup."),
        h("div", { className: "bees-card-actions" },
          h(Button, { className: "primary", onClick: () => go(1, "local") }, "Use AI on this computer"),
          h(Button, { onClick: () => go(1, "subscriptions") }, "Connect Codex or Claude"),
          h(Button, { onClick: () => go(1, "other") }, "Choose another provider")),
        h("p", null, "Two agents run each goal: the lead plans and does the work, and the reviewer checks it. Both use your selected AI by default."),
        ...agents.map((agent, index) => h("div", { key: agent.id, className: "bees-box" },
          h("strong", null, index === 0 ? "Lead" : "Reviewer"),
          h("p", null, agent.model || defaultModel),
          !agent.enabled ? h("p", { role: "status" }, "This agent is disabled. Enable it in Agents before starting.") : null,
          h("details", null, h("summary", null, "Change AI (optional)"),
            h("form", { className: "bees-form", onSubmit: (event) => {
              event.preventDefault(); const form = new FormData(event.currentTarget);
              void saveAgentModel(agent, { model: String(form.get("model") || "") || null,
                reasoningEffort: String(form.get("reasoningEffort") || "") || null });
            } }, h(AgentModelSelect, { key: `${agent.model}:${agent.reasoningEffort}`, ctx,
              value: agent.model || "", effort: agent.reasoningEffort || "", systemDefault: data.systemDefaultModel }),
            h(Button, { type: "submit", disabled: busy }, "Save AI"))))),
        h("p", { className: "bees-muted" }, "One model is enough: the agents use separate conversations and responsibilities. Another connected provider is used only when you select it. These choices update your team’s work and review agents."),
        h("p", { className: "bees-muted", role: "status" }, aiStatus),
        h(Button, { disabled: busy || !data.systemDefaultModel?.provider || agents.some((agent) => !agent.enabled), onClick: testAi }, busy ? "Testing…" : "Test selected AI"),
        h("small", { className: "bees-muted" }, "The test sends one short greeting per distinct selected model. If the reviewer’s model fails, both agents use the working lead model. Provider usage may apply.")) : null,
      step === 2 ? h("div", { className: "bees-stack" },
        h("p", null, "Choose a file or folder for your team, try a fictional brief, or provide your own instructions without files."),
        h("div", { className: "bees-card-actions" },
          h(Button, { className: "primary", onClick: () => update({ filesChoice: "sample", step: 3 }) }, "Use sample brief"),
          h(Button, { disabled: !parts.teamId, onClick: () => go(2) }, "Choose my files"),
          h(Button, { onClick: () => update({ filesChoice: "none", step: 3 }) }, "Continue without files")),
        h("p", { className: "bees-muted" }, "File mappings make those locations available to this team. Select the inputs for your first task below. Cloud AI may receive selected content; local AI processes it on this computer."),
        h("details", null, h("summary", null, "Preview the sample brief"), h("pre", { style: { whiteSpace: "pre-wrap" } }, SAMPLE_BRIEF))) : null,
      step === 3 ? h("div", { className: "bees-stack" },
        firstItem
          ? h("div", { className: "bees-callout" }, h("h3", null, done[3] ? "Your first result is ready" : failed ? "Your first task stopped" : "Your first task is underway"),
            h("p", null, failed ? "Open the task to see why it stopped, then press Retry." : "Open the task to follow the discussion, answer questions, and preview the result under Files."),
            h(Button, { className: "primary", onClick: () => openWorkItem(state.workItemId) }, done[3] ? "View your result" : "Open first task"))
          : h("form", { className: "bees-form", onSubmit: (event) => { event.preventDefault(); void start(prompt); } },
            h("label", null, "Choose an outcome", h("select", { className: "bees-select", value: task, onChange: (event) => {
              const id = event.target.value; const text = STARTER_TASKS.find((row) => row.id === id)?.prompt || "";
              setTask(id); setPrompt(text); update({ task: id, prompt: text });
            } }, ...STARTER_TASKS.map((row) => h("option", { value: row.id, key: row.id }, row.title)), h("option", { value: "custom" }, "Write my own task"))),
            h("label", null, "What should Bees create?", h("textarea", { className: "bees-textarea", value: prompt, required: true,
              onChange: (event) => { setPrompt(event.target.value); update({ prompt: event.target.value }); } })),
            usesSampleBrief(prompt.trim(), state.filesChoice, inputs) ? h("p", { className: "bees-muted" }, "Using the fictional repair café brief. No personal files are needed.") : null,
            ...teamLocations.map((row) =>
              h("label", { key: row.id }, h("input", { type: "checkbox", checked: (state.inputLocationIds || []).includes(row.id),
                onChange: (event) => update({ inputLocationIds: event.target.checked ? [...(state.inputLocationIds || []), row.id] : (state.inputLocationIds || []).filter((id) => id !== row.id) }) }), ` ${row.name}`)),
            h("p", { className: "bees-muted" }, "Work → Review → Done. The lead creates first-result.md, then a fresh reviewer session checks it."),
            !aiReady ? h("div", { className: "bees-stack" },
              h("p", { role: "status" }, "Choose and test your AI before starting. You can prepare this prompt while a model downloads."),
              h(Button, { onClick: () => update({ step: 1 }) }, "Go to Choose your AI")) : null,
            h(Button, { type: "submit", className: "primary", disabled: busy || !done[0] || !aiReady || !prompt.trim() }, busy ? "Starting…" : "Create my first result"))) : null,
      h("div", { className: "bees-card-actions" },
        step > 0 ? h(Button, { onClick: () => update({ step: step - 1 }) }, "Back") : null,
        step < 3 && (step > 0 || !stepOneHasItsOwnButton)
          ? h(Button, { onClick: () => update({ step: step + 1 }) }, done[step] ? "Continue" : "Skip for now") : null)),
    done[3] ? h(Button, { onClick: () => { update({ active: false }); navigate("home"); } }, "Finish setup") : null);
}

export function GettingStartedBar({ state, update, navigate, aiStatus, data, openWorkItem }) {
  const item = data.items.find(({ id }) => id === state.workItemId);
  const [download, setDownload] = useState("");
  useEffect(() => {
    let active = true;
    let unlisten;
    void window.__TAURI__?.event?.listen("local-model-progress", ({ payload }) => {
      if (!active) return;
      setDownload(payload.state === "downloading" ? `Model downloading${payload.totalBytes ? ` · ${Math.round(payload.downloadedBytes / payload.totalBytes * 100)}%` : ""}. You can continue setup.`
        : payload.state === "error" ? "Model download failed. Open AI connections to retry."
        : payload.state === "ready" ? "Model downloaded. Open AI connections to start it and choose your default." : "");
    }).then((dispose) => { if (active) unlisten = dispose; else dispose?.(); });
    return () => { active = false; unlisten?.(); };
  }, []);
  return h("aside", { className: "bees-onboarding-bar", "aria-label": "Setup progress" },
    h("div", null, h("strong", null, `Getting started · Step ${(state.step || 0) + 1} of 4`),
      h("div", { className: "bees-muted", role: "status" }, item ? "Your first task is saved. Open it to follow progress and see files." : download || aiStatus)),
    h("div", { className: "bees-card-actions" },
      item ? h(Button, { onClick: () => openWorkItem(item.id) }, "Open first task") : null,
      h(Button, { onClick: () => navigate("getting-started") }, "Back to setup"),
      h(Button, { onClick: () => { update({ step: Math.min(3, (state.step || 0) + 1) }); navigate("getting-started"); } }, "Continue"),
      h(Button, { onClick: () => update({ active: false }) }, "Set up later")));
}
