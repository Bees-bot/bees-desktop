import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
// @ts-expect-error Client modules are plain JavaScript.
import { configureRuntime } from "../dsh-runtime/plugin/client/runtime.js";
// @ts-expect-error Client modules are plain JavaScript.
import { SettingsPage } from "../dsh-runtime/plugin/client/settings.js";
// @ts-expect-error Client modules are plain JavaScript.
import { MemorySettings } from "../dsh-runtime/plugin/client/collaboration.js";
import { ConnectedAccount } from "../dsh-runtime/plugin/lib/connected-account.js";
import { WorkMemory } from "../dsh-runtime/plugin/lib/work-memory.js";
import { NodeDatabase } from "./node-database.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  configureRuntime((id: string) => id === "react" ? React : {});
});

function renderer(page: any) {
  const states: any[] = [];
  const effects: Array<() => (() => void) | void> = [];
  let cursor = 0;
  configureRuntime((id: string) => id === "react" ? {
    ...React,
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (value: any) => {
        states[index] = typeof value === "function" ? value(states[index]) : value;
      }];
    },
    useEffect: (effect: () => (() => void) | void) => effects.push(effect)
  } : {});
  const render = (): string => { cursor = 0; return renderToStaticMarkup(page); };
  render();
  effects.splice(0).forEach((effect) => {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  });
  return render;
}

it.each(["member", "viewer", "admin"])("keeps the team settings button available to a %s", (role) => {
  const source = readFileSync(new URL("../dsh-runtime/plugin/client/shell.js", import.meta.url), "utf8");
  const ScopeSwitcher = new Script(source.slice(source.indexOf("function ScopeSwitcher("),
    source.indexOf("export function BeesApp(")) + "; ScopeSwitcher").runInNewContext({
    React, h: React.createElement, useState: React.useState, useEffect: React.useEffect,
    SettingsIcon: () => null, NAVIGATION: []
  });
  const html = renderToStaticMarkup(React.createElement(ScopeSwitcher, {
    organizationId: "org", teamId: "team", connectionId: "selected", organizationColors: { org: "blue" },
    data: {
      organizations: [], teams: [{ id: "team", organizationId: "org", name: "Design", role }],
      connections: [{ id: "selected", organizationId: "org", organizationName: "Acme", role: "member" }],
      connectionTeams: [{ connectionId: "selected", teamId: "team", role }]
    }
  }));
  const button = html.match(/<button[^>]*aria-label="Design settings"[^>]*>/)?.[0];
  expect(button).toBeDefined();
  expect(button).not.toContain("disabled");
});

it.each(["member", "viewer", "admin"])("shows team settings to a %s with the correct edit access", async (role) => {
  // The selected account's role takes precedence over another account's cached admin role.
  configureRuntime((id: string) => id === "react" ? React : {});
  const fetcher = vi.fn(async (_input: unknown, _init?: RequestInit) => Response.json({
    members: [{ id: "member", userId: "user", email: "teammate@example.com", role: "member" }],
    candidates: role === "admin" ? [{ userId: "candidate", email: "candidate@example.com" }] : []
  }));
  vi.stubGlobal("fetch", fetcher);
  const page = SettingsPage({
    route: "team-settings", teamId: "team", organizationId: "org", connectionId: "selected",
    data: {
      organizations: [{ id: "org", name: "Acme", connected: true, role: "owner" }],
      teams: [{ id: "team", name: "Design", role: "admin" }], workspaces: [],
      connections: [{ id: "selected", role: "owner" }],
      connectionTeams: [{ connectionId: "selected", teamId: "team", role }]
    }
  });
  const render = renderer(page);
  await vi.waitFor(() => expect(render()).toContain("teammate@example.com"));
  const html = render();
  expect(html).toContain("Design members");
  expect(html).toContain("Add organization member");
  expect(html).toContain("Add member");
  expect(html).toContain("Delete team");
  expect(html.includes("Read-only team settings")).toBe(role !== "admin");
  // the settings rail sits outside the panel, and its own buttons are not what this measures
  const controls = html.slice(html.indexOf("bees-settings-content")).match(/<(?:input|select|button)\b[^>]*>/g)!;
  expect(controls).toHaveLength(5);
  expect(controls.every((control) => control.includes('disabled=""') === (role !== "admin"))).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
    action: "team_people", teamId: "team", connectionId: "selected"
  });
});

it.each([false, true])("shows memory values and actions with canManage=%s", async (canManage) => {
  const fetcher = vi.fn(async () => Response.json({
    managed: true, model: "local-model", models: [{ id: "local-model", name: "Local model" }],
    activeModel: "Local model", enabled: true, url: "http://127.0.0.1:8898", bank: "team-bank", status: "Connected",
    memories: [{ id: "memory", content: "Use source dates", evidence: "Accepted review", status: "stored" }]
  }));
  vi.stubGlobal("fetch", fetcher);
  const render = renderer(React.createElement(MemorySettings, {
    workspace: { id: "workspace", name: "Design" }, canManage
  }));
  await vi.waitFor(() => expect(render()).toContain("Use source dates"));
  const html = render();
  expect(html).toContain('value="local-model" selected=""');
  expect(html).toContain('value="http://127.0.0.1:8898"');
  expect(html).toMatch(/<input[^>]*name="enabled"[^>]*checked=""/);
  for (const label of ["Save memory settings", "Test connection", "Retry synchronization", "Correct", "Forget"])
    expect(html).toContain(label);
  const controls = html.match(/<(?:input|select|button)\b[^>]*>/g)!;
  expect(controls).toHaveLength(10);
  expect(controls.every((control) => control.includes('disabled=""') === !canManage)).toBe(true);
  // Details remain expandable even when all editing controls are disabled.
  expect(html).toContain("<details><summary>Advanced: custom Hindsight service</summary>");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["owner", "admin", "member"])("offers the invitation flow to an organization %s when there are no team candidates", async (role) => {
  configureRuntime((id: string) => id === "react" ? React : {});
  const elements = vi.spyOn(React, "createElement");
  const navigate = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ members: [], candidates: [] })));
  const page = SettingsPage({
    route: "team-settings", teamId: "team", organizationId: "org", connectionId: "selected", navigate,
    data: {
      organizations: [{ id: "org", name: "Acme", connected: true }],
      teams: [{ id: "team", name: "Design", role: "admin" }], workspaces: [],
      connections: [{ id: "selected", role }],
      connectionTeams: [{ connectionId: "selected", teamId: "team", role: "admin" }]
    }
  });
  const render = renderer(page);
  await vi.waitFor(() => expect(render()).toContain("Every organization member is already on this team"));
  const html = render();
  expect(html).toContain("Add member");
  expect(html).toMatch(/<select[^>]*name="userId"[^>]*disabled=""/);
  const invite: any = elements.mock.calls.find((call) => call[2] === "Invite new member")?.[1];
  expect(invite).toBeDefined();
  expect(invite.disabled).toBe(role === "member");
  if (role !== "member") {
    expect(html).toContain("After they accept, add them to Design here.");
    invite.onClick();
    expect(navigate).toHaveBeenCalledExactlyOnceWith("organization-members");
  } else {
    expect(html).toContain("Only organization administrators can invite new people.");
  }
});

it.each([
  ["member", "selected"], ["admin", "selected"], ["member", ""], ["admin", ""]
])("loads members for %s using connection '%s' without requesting unauthorized candidates", async (role, connectionId) => {
  const db = new NodeDatabase().connection;
  try {
    const teamId = String(db.prepare("SELECT id FROM teams LIMIT 1").get()!.id);
    const connected: any = new ConnectedAccount(db, {}, "https://api.example");
    vi.spyOn(connected, "accountForConnection").mockReturnValue("selected-user");
    vi.spyOn(connected, "account").mockReturnValue({ userId: "default-user" });
    const members = [
      { userId: "selected-user", role },
      { userId: "default-user", role: connectionId ? role === "admin" ? "member" : "admin" : role }
    ];
    const candidates = [{ userId: "candidate", email: "candidate@example.com" }];
    const request = vi.fn(async (path: string, _options: { connectionId?: string }) => {
      if (path.endsWith("/members")) return { members };
      if (role !== "admin") throw new Error("Team administrator role required");
      return { candidates };
    });
    connected.request = request;
    expect(await connected.teamPeople(teamId, connectionId)).toEqual({
      members, candidates: role === "admin" ? candidates : []
    });
    expect(request).toHaveBeenCalledTimes(role === "admin" ? 2 : 1);
    expect(request.mock.calls.every(([, options]) => options!.connectionId === connectionId)).toBe(true);
    request.mockRejectedValueOnce(new Error("Team membership required"));
    await expect(connected.teamPeople(teamId, connectionId)).rejects.toThrow("Team membership required");
  } finally { db.close(); }
});

it.each(["member", "viewer"])("keeps memory mutations forbidden for a %s", async (role) => {
  const db = new NodeDatabase().connection;
  try {
    const workspaceId = String(db.prepare("SELECT id FROM workspaces LIMIT 1").get()!.id);
    const memory = new WorkMemory(db, {});
    db.prepare("UPDATE team_memberships SET role = ?").run(role);
    const state = await memory.command("memory_status", { workspaceId });
    expect(state).toHaveProperty("url");
    for (const action of ["memory_configure", "memory_test", "memory_retry", "memory_edit", "memory_delete"])
      await expect(memory.command(action, { workspaceId })).rejects.toThrow("permission");
    expect(await memory.command("memory_status", { workspaceId })).toEqual(state);
  } finally { db.close(); }
});
