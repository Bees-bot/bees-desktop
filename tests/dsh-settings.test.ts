import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
// @ts-expect-error Client modules are plain JavaScript.
import { configureRuntime } from "../dsh-runtime/plugin/client/runtime.js";
// @ts-expect-error Client modules are plain JavaScript.
import { SettingsPage } from "../dsh-runtime/plugin/client/settings.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

afterEach(() => {
  vi.unstubAllGlobals();
  configureRuntime((id: string) => id === "react" ? React : {});
});

it("shows the invitation form while SSO is loading and after SSO fails", async () => {
  const states: unknown[] = [];
  const effects: Array<() => void> = [];
  let cursor = 0;
  configureRuntime((id: string) => id === "react" ? {
    ...React,
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value: unknown) => { states[index] = value; }];
    },
    useEffect: (effect: () => void) => { effects.push(effect); }
  } : {});
  let finishSso!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const { action } = JSON.parse(options.body);
    if (action === "organization_sso") return new Promise<Response>((resolve) => { finishSso = resolve; });
    return Response.json({ memberships: [], invitations: [] });
  }));
  const page = SettingsPage({
    route: "organization-settings", organizationId: "org", connectionId: "owner-connection",
    data: { organizations: [{ id: "org", name: "Shared org", connected: true }], teams: [],
      connections: [{ id: "owner-connection", role: "owner" }] }
  });
  const render = () => { cursor = 0; return renderToStaticMarkup(page.type(page.props)); };
  render();
  effects[0]!();
  await vi.waitFor(() => expect(render()).toContain("Send invitation"));
  finishSso(Response.json({ error: "SSO is unavailable" }, { status: 503 }));
  await vi.waitFor(() => expect(render()).toContain("SSO is unavailable"));
  expect(render()).toContain("Send invitation");
});
