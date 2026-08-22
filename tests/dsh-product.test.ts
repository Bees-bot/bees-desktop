import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { ConnectedAccount } from "../dsh-runtime/plugin/lib/connected-account.js";
import { ProcessRuntime } from "../dsh-runtime/plugin/lib/process-runtime.js";
import { BeesProduct, initializeProductDatabase } from "../dsh-runtime/plugin/lib/product.js";
import { NodeDatabase } from "./node-database.js";

describe("Bees DSH product plugin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("recreates old metadata with the final local ownership hierarchy", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE teams (id TEXT PRIMARY KEY); INSERT INTO teams VALUES ('old-team')");
    initializeProductDatabase(database);
    expect(database.prepare(`
      SELECT o.name AS organization, t.name AS team, w.name AS workspace
      FROM organizations o JOIN teams t ON t.organization_id = o.id
      JOIN workspaces w ON w.team_id = t.id
    `).get()).toEqual({ organization: "Personal Org", team: "Team1", workspace: "My workspace" });
    expect(database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
        ('organization_memberships','team_memberships','team_locations','device_location_mappings')
      ORDER BY name
    `).all()).toEqual([
      { name: "device_location_mappings" }, { name: "organization_memberships" },
      { name: "team_locations" }, { name: "team_memberships" }
    ]);
    expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 5 });

    database.exec("UPDATE organizations SET name = 'Personal'; UPDATE teams SET name = 'Personal'");
    initializeProductDatabase(database);
    expect(database.prepare("SELECT name FROM organizations").get()).toEqual({ name: "Personal Org" });
    expect(database.prepare("SELECT name FROM teams").get()).toEqual({ name: "Team1" });
  });

  it("shares team locations and starts automatic goals while manual processes remain runnable", async () => {
    const files = mkdtempSync(join(tmpdir(), "bees-product-"));
    const runRoot = mkdtempSync(join(tmpdir(), "bees-runs-"));
    writeFileSync(join(files, "brief.md"), "Honey launch requirements and milestones");
    const database = new NodeDatabase();
    const agents = new AgentRuntime({ on: () => () => undefined }, database.connection);
    const admissions: any[] = [];
    (agents as any).admit = async (...args: any[]) => { admissions.push(args); return { submissionId: "submission", uid: "uid" }; };
    const temporalStarts: any[] = [];
    const processes = new ProcessRuntime(database.connection, { client: {
      workflow: {
        start: async (name: string, options: any) => { temporalStarts.push({ name, ...options }); },
        getHandle: () => ({ signal: async () => undefined, cancel: async () => undefined })
      }
    } });
    const product = new BeesProduct(database.connection, agents, processes, runRoot);
    await product.initialize();
    const initial = await product.snapshot();
    const workspace = initial.workspaces[0];
    const team = initial.teams[0];
    const organization = await product.command({ action: "create_organization", name: "Acme" });
    const organizationTeam = await product.command({ action: "create_team", organizationId: organization.id, name: "Marketing" });
    expect((await product.snapshot()).organizations).toContainEqual(expect.objectContaining({ id: organization.id, name: "Acme", role: "owner" }));
    expect((await product.snapshot()).teams).toContainEqual(expect.objectContaining({ id: organizationTeam.id, organizationId: organization.id, name: "Marketing" }));
    const goals = initial.processes.find(({ workspaceId, kind }: any) => workspaceId === workspace.id && kind === "goals");
    const work = initial.stages.find(({ processId, name }: any) => processId === goals.id && name === "Work");

    const created = await product.command({
      action: "create_goal", workspaceId: workspace.id, title: "Ship Stage 1",
      description: "Make DSH the product runtime"
    });
    expect((await product.snapshot()).items).toContainEqual(expect.objectContaining({
      id: created.id, stageId: work.id, kind: "goal", title: "Ship Stage 1", runtimePhase: "running"
    }));
    await expect(product.command({ action: "move_item", itemId: created.id, stageId: work.id }))
      .rejects.toThrow("Temporal moves");
    expect(temporalStarts).toContainEqual(expect.objectContaining({ workflowId: `bees/work-item/${created.id}` }));
    const location = await product.command({
      action: "add_location", teamId: team.id, name: "Work", kind: "folder", path: files
    });
    await expect(product.command({
      action: "attach_location", itemId: created.id, locationId: location.id, relativePath: "../outside"
    })).rejects.toThrow("cannot leave");
    await product.command({ action: "attach_location", itemId: created.id, locationId: location.id });

    const secondWorkspace = await product.command({ action: "create_workspace", teamId: team.id, name: "Campaigns" });
    const secondSnapshot = await product.snapshot();
    const secondGoals = secondSnapshot.processes.find(({ workspaceId, kind }: any) =>
      workspaceId === secondWorkspace.id && kind === "goals");
    const secondItem = await product.command({
      action: "create_goal", workspaceId: secondWorkspace.id, title: "Reuse team files"
    });
    await product.command({ action: "attach_location", itemId: secondItem.id, locationId: location.id });
    expect((await product.snapshot()).attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ workItemId: created.id, locationId: location.id }),
      expect.objectContaining({ workItemId: secondItem.id, locationId: location.id })
    ]));
    expect(secondGoals).toBeTruthy();

    const after = await product.snapshot();
    expect(after.schedules).toEqual([]);
    expect(after.locations).toContainEqual(expect.objectContaining({
      teamId: team.id, name: "Work", localPath: realpathSync(files), mapped: true
    }));
    expect(product.search("Stage", workspace.id)).toContainEqual(expect.objectContaining({ id: created.id }));
    expect(product.search("Honey", workspace.id)).toContainEqual(expect.objectContaining({
      kind: "file", title: "Work/brief.md"
    }));

    const newProcess = await product.command({
      action: "create_process", workspaceId: workspace.id, name: "Publishing", stages: ["Draft", "Published"]
    });
    await product.command({ action: "attach_location", processId: newProcess.id, locationId: location.id });
    await product.command({
      action: "edit_process", processId: newProcess.id, name: "Editorial",
      description: "Publish reviewed work", stages: ["Published", "Draft", "Review"]
    });
    expect((await product.snapshot()).processes).toContainEqual(expect.objectContaining({
      id: newProcess.id, workspaceId: workspace.id, name: "Editorial"
    }));
    const manualItem = await product.command({
      action: "create_run", processId: newProcess.id, title: "Publish this week"
    });
    const run = await product.command({ action: "run_item", itemId: manualItem.id, model: "local-openai/default" });
    expect(admissions.at(-1)[0]).toBe("bees-run");
    expect(admissions.at(-1)[2].initialData.grants).toEqual([location.id]);
    expect((await product.snapshot()).processAttachments).toContainEqual(expect.objectContaining({
      processId: newProcess.id, locationId: location.id
    }));
    expect(readFileSync(join(
      runRoot, "runs", run.executionId, "inputs", `Work-${location.id.slice(0, 8)}`, "brief.md"
    ), "utf8")).toContain("Honey launch");

    const proposal = product.storeProposal({
      workspaceId: workspace.id, sessionId: "planning-session", title: "Launch plan", summary: "Visible work",
      changes: [
        { action: "create_goal", title: "Launch safely", description: "Review every handoff" },
        { action: "create_process", name: "Launch", description: "Repeatable release", stages: ["Plan", "Release"] }
      ]
    });
    await product.command({ action: "apply_proposal", proposalId: proposal.id });
    const applied = await product.snapshot();
    expect(applied.proposals).toContainEqual(expect.objectContaining({ id: proposal.id, status: "applied" }));
    expect(applied.items).toContainEqual(expect.objectContaining({ title: "Launch safely", kind: "goal" }));
    expect(applied.processes).toContainEqual(expect.objectContaining({ name: "Launch" }));

    rmSync(files, { recursive: true });
    rmSync(runRoot, { recursive: true });
  });

  it("keeps one connected account and mirrors its organization and team roles", async () => {
    const database = new DatabaseSync(":memory:");
    initializeProductDatabase(database);
    let storedToken = "";
    const credentials = {
      resolve: async () => storedToken ? { value: storedToken, source: "test" } : undefined,
      set: async (_ref: string, value: string) => { storedToken = value; },
      unset: async () => { storedToken = ""; }
    };
    const seen: { url: string; authorization: string | null; organization: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      seen.push({
        url,
        authorization: headers.get("authorization"),
        organization: headers.get("x-organization-id")
      });
      const body = url.endsWith("/api/auth/sign-in/email")
        ? { user: { id: "remote-user", email: "you@example.com", name: "You" } }
        : url.endsWith("/api/organizations")
          ? { organizations: [{ id: "remote-org", name: "Acme", role: "admin" }] }
          : url.endsWith("/api/teams")
            ? { teams: [{ id: "remote-team", name: "Design" }] }
            : url.endsWith("/api/teams/remote-team/members")
              ? { members: [{ id: "member-1", teamId: "remote-team", userId: "remote-user", role: "admin" }] }
              : url.endsWith("/api/me/organization-invitations")
                ? { invitations: [] }
                : { candidates: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "content-type": "application/json",
          ...(url.endsWith("/api/auth/sign-in/email") ? { "set-auth-token": "session-token" } : {})
        }
      });
    }));

    const connected = new ConnectedAccount(database, credentials, "https://api.example");
    await connected.signIn("you@example.com", "password123");
    expect(connected.publicAccount()).toEqual({
      userId: "remote-user", email: "you@example.com", name: "You"
    });
    expect(database.prepare(`
      SELECT o.name, om.role, om.status FROM organizations o
      JOIN organization_memberships om ON om.organization_id = o.id
      WHERE o.id = 'remote-org'
    `).get()).toEqual({ name: "Acme", role: "admin", status: "active" });
    expect(database.prepare("SELECT name FROM teams WHERE id = 'remote-team'").get())
      .toEqual({ name: "Design" });
    expect(seen).toContainEqual(expect.objectContaining({
      url: "https://api.example/api/teams", authorization: "Bearer session-token",
      organization: "remote-org"
    }));

    await connected.signOut();
    expect(connected.publicAccount()).toBeNull();
    expect(database.prepare(`
      SELECT status FROM organization_memberships WHERE organization_id = 'remote-org'
    `).get()).toEqual({ status: "suspended" });
  });
});
