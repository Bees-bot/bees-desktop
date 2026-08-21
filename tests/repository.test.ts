import { describe, expect, it } from "vitest";
import { LocalRepository } from "../src/repository.js";
import { GOALS_STAGES, TASK_PLAN_OUTPUT } from "../src/processes/goals/index.js";
import { goalsProcess } from "../src/processes/goals/definition.js";
import { softwareProjectProcess } from "../src/processes/software-project/definition.js";
import type { BeesConversationSnapshotV1 } from "../src/conversation-snapshot.js";
import { NodeDatabase } from "./node-database.js";

async function createTestProcess(repository: LocalRepository, teamId: string) {
  const id = await repository.createProcess(teamId, {
    name: "Test process",
    stages: [
      { name: "To do", isTerminal: false },
      { name: "Done", isTerminal: true }
    ]
  });
  return (await repository.listProcesses(teamId)).find((process) => process.id === id)!;
}

describe("local repository", () => {
  it("provisions Goals for the starter team and leaves later teams ready for the library", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const goals = (await repository.listProcesses(local.teamId))[0]!;

    expect(goals).toMatchObject({
      name: "Goals",
      stages: GOALS_STAGES.map((name) => ({ name }))
    });

    const organizationId = await repository.createOrganization("Acme");
    const teamId = await repository.createTeam(organizationId, "Design");
    expect(await repository.listProcesses(teamId)).toEqual([]);
  });

  it("keeps persisted behavior and free-form tags across a rename", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const seeded = (await repository.listProcesses(local.teamId))[0]!;
    expect(seeded.definition.moduleId).toBe("goals");
    expect(seeded.tags).toEqual([]);

    await repository.updateProcess(seeded.id, { name: "Objectives" });
    const renamed = (await repository.listProcesses(local.teamId))[0]!;
    expect(renamed.name).toBe("Objectives");
    expect(renamed.definition.moduleId).toBe("goals");

    // setTags replaces rather than appends, so re-tagging cannot accumulate duplicates.
    await repository.setTags("process", seeded.id, ["starred", "starred"]);
    expect((await repository.listProcesses(local.teamId))[0]!.tags).toEqual(["starred"]);
  });

  it("persists resolved stage IDs for a library process", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const id = await repository.createProcess(local.teamId, {
      name: "Anything",
      template: softwareProjectProcess.definition
    });
    const created = (await repository.listProcesses(local.teamId)).find(
      (process) => process.id === id
    )!;
    expect(created.definition.renderer).toBe("software-project");
    expect(created.definition.stateIds.requirements).toBe(created.stages[0]!.id);
  });

  it("copies a bundled workflow as an independent, repeatable process", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const goals = (await repository.listProcesses(local.teamId))[0]!;
    const copyOf = (name: string) =>
      repository.createProcess(local.teamId, { name, template: goalsProcess.definition, copy: true });

    // A second copy must not collide with the first — the install id is deterministic per team.
    const firstId = await copyOf("Goals copy");
    const secondId = await copyOf("Goals copy 2");
    expect(firstId).not.toBe(secondId);
    expect(firstId).not.toBe(goals.id);

    const all = await repository.listProcesses(local.teamId);
    const copy = all.find(({ id }) => id === firstId)!;
    expect(copy.stages.map(({ name }) => name)).toEqual(goals.stages.map(({ name }) => name));
    // Install identity is not copied, or the bundled entry would report itself as added.
    expect(copy.definition.moduleId).toBeNull();
    // Behavior survives the copy, and every stage reference points into the copy's own stages.
    const ownStageIds = new Set(copy.stages.map(({ id }) => id));
    const references = [
      ...Object.values(copy.definition.stateIds),
      ...copy.definition.roleBindings.map(({ stageId }) => stageId),
      ...copy.definition.capabilities.flatMap((capability) =>
        capability.type === "task-plan" ? Object.values(capability.stageIds) : []
      )
    ];
    expect(references.length).toBeGreaterThan(0);
    expect(references.every((stageId) => ownStageIds.has(stageId))).toBe(true);
    // The team's own install is untouched; a copy is not a move.
    expect(all.find(({ id }) => id === goals.id)).toMatchObject({ definition: { moduleId: "goals" } });
  });

  it("persists ordered offline processes and work items", async () => {
    const database = new NodeDatabase();
    const repository = new LocalRepository(database);
    const local = await repository.bootstrap();

    const processId = await repository.createProcess(local.teamId, {
      name: "Launch",
      description: "Ship a campaign",
      stages: [
        { name: "Brief", isTerminal: false },
        { name: "Review", isTerminal: false },
        { name: "Published", isTerminal: true }
      ]
    });
    let process = (await repository.listProcesses(local.teamId)).find(
      ({ id }) => id === processId
    )!;
    await repository.reorderStages(
      processId,
      process.stages.map(({ id }) => id).reverse()
    );
    process = (await repository.listProcesses(local.teamId)).find(({ id }) => id === processId)!;
    expect(process.stages.map(({ name }) => name)).toEqual(["Published", "Review", "Brief"]);
    await repository.updateProcessDefinition(processId, {
      name: "Launch campaign",
      description: "Updated",
      stages: [
        { name: "Publish", isTerminal: false },
        { name: "Review", isTerminal: true }
      ]
    });
    process = (await repository.listProcesses(local.teamId)).find(({ id }) => id === processId)!;
    expect(process).toMatchObject({
      name: "Launch campaign",
      stages: [{ name: "Publish" }, { name: "Review" }]
    });

    const itemId = await repository.createWorkItem(process.id, {
      stageId: process.stages[0]!.id,
      title: "Launch brief",
      logicalFiles: ["Drafts/launch.md"]
    });
    expect((await repository.listWorkItems(process.id))[0]).toMatchObject({
      title: "Launch brief",
      stageId: process.stages[0]!.id,
      logicalFiles: ["Drafts/launch.md"]
    });
  });

  it("stores status output folders as relative process configuration", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const process = await createTestProcess(repository, local.teamId);
    const review = process.stages[1]!;

    await repository.updateProcessDefinition(process.id, {
      name: process.name,
      stages: process.stages.map(({ name, isTerminal }) => ({ name, isTerminal })),
      outputFolders: { [review.id]: "ready-for-human-review" }
    });

    expect((await repository.listProcesses(local.teamId)).find(({ id }) => id === process.id)
      ?.definition.outputFolders).toEqual({ [review.id]: "ready-for-human-review" });
    await expect(repository.updateProcessDefinition(process.id, {
      name: process.name,
      stages: process.stages.map(({ name, isTerminal }) => ({ name, isTerminal })),
      outputFolders: { [review.id]: "/private/resumes" }
    })).rejects.toThrow("relative paths");
  });

  it("restores an archived process with its stages", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const process = (await repository.listProcesses(local.teamId))[0]!;

    await repository.archiveProcess(process.id);
    expect(await repository.listProcesses(local.teamId)).toEqual([]);
    expect(
      (await repository.listProcesses(local.teamId, true)).find(({ id }) => id === process.id)
        ?.archivedAt
    ).toBeTruthy();

    await repository.restoreProcess(process.id);
    expect((await repository.listProcesses(local.teamId))[0]).toMatchObject({
      id: process.id,
      archivedAt: null,
      stages: process.stages.map(({ name }) => ({ name }))
    });
  });

  it("rejects absolute and traversing logical paths", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const process = (await repository.listProcesses(local.teamId))[0]!;

    await expect(
      repository.createWorkItem(process.id, {
        stageId: process.stages[0]!.id,
        title: "Unsafe",
        logicalFiles: ["/Users/alice/private.txt"]
      })
    ).rejects.toThrow("relative paths");
    await expect(
      repository.createWorkItem(process.id, {
        stageId: process.stages[0]!.id,
        title: "Unsafe",
        logicalFiles: ["../private.txt"]
      })
    ).rejects.toThrow("relative paths");
  });

  it("supports organization switching, team boards, and inherited local paths", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    await repository.bootstrap();
    const organizationId = await repository.createOrganization("Acme");
    const teamId = await repository.createTeam(organizationId, "Design");

    expect(await repository.listOrganizations()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: organizationId, name: "Acme" })])
    );
    expect(await repository.listTeams(organizationId)).toEqual([
      expect.objectContaining({ id: teamId, name: "Design" })
    ]);

    const process = await createTestProcess(repository, teamId);
    const boardId = await repository.createBoard(teamId, {
      name: "Launch board",
      processId: process.id,
      stageIds: process.stages.slice(0, 2).map(({ id }) => id)
    });
    expect((await repository.listBoards(teamId)).find(({ id }) => id === boardId)).toMatchObject({
      name: "Launch board",
      stageIds: process.stages.slice(0, 2).map(({ id }) => id)
    });

    await repository.setSetting("global_local_path", "/projects");
    expect(await repository.getResolvedTeamFolder(teamId)).toMatchObject({
      localPath: "/projects/acme/design",
      override: false
    });
    await repository.setTeamFolder(teamId, "/custom/design");
    expect(await repository.getResolvedTeamFolder(teamId)).toMatchObject({
      localPath: "/custom/design",
      override: true
    });
    await repository.clearTeamFolder(teamId);
    expect((await repository.getResolvedTeamFolder(teamId))?.localPath).toBe("/projects/acme/design");
  });

  it("supports multiple organization and team file locations with local-only mappings", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const organizationLocationId = await repository.createFileLocation({
      organizationId: local.organizationId,
      name: "Company drive",
      localPath: "/Users/alice/Drive/Company"
    });
    const teamLocationId = await repository.createFileLocation({
      organizationId: local.organizationId,
      teamId: local.teamId,
      name: "Campaign assets",
      localPath: "/Users/alice/Drive/Assets"
    });

    expect(await repository.listAvailableFileLocations(local.teamId)).toEqual([
      expect.objectContaining({
        id: organizationLocationId,
        teamId: null,
        localPath: "/Users/alice/Drive/Company"
      }),
      expect.objectContaining({
        id: teamLocationId,
        teamId: local.teamId,
        localPath: "/Users/alice/Drive/Assets"
      })
    ]);

    const projection = await repository.coordinationProjection(local.teamId);
    const serialized = JSON.stringify(
      projection.filter(({ recordType }) => recordType === "file_location")
    );
    expect(serialized).toContain("Company drive");
    expect(serialized).toContain("Campaign assets");
    expect(serialized).not.toContain("/Users/alice");

    await repository.deleteFileLocation(teamLocationId);
    expect(await repository.listAvailableFileLocations(local.teamId)).toHaveLength(1);
    expect(
      (await repository.coordinationProjection(local.teamId)).find(
        ({ recordId }) => recordId === teamLocationId
      )
    ).toMatchObject({ recordType: "file_location", deleted: true });
  });

  it("deletes a team with its processes, boards, and work items", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    await repository.bootstrap();
    const organizationId = await repository.createOrganization("Acme");
    const kept = await repository.createTeam(organizationId, "Design");
    const doomed = await repository.createTeam(organizationId, "Ops");
    const process = await createTestProcess(repository, doomed);
    await repository.createWorkItem(process.id, {
      stageId: process.stages[0]!.id,
      title: "Ship it"
    });
    await repository.setTeamFolder(doomed, "/custom/ops");

    await repository.deleteTeam(doomed);

    expect(await repository.listTeams(organizationId)).toEqual([
      expect.objectContaining({ id: kept, name: "Design" })
    ]);
    expect(await repository.listProcesses(doomed)).toEqual([]);
    expect(await repository.listBoards(doomed)).toEqual([]);
    expect(await repository.listTeamWorkItems(doomed)).toEqual([]);
  });

  it("records approved checkpoint metadata without owning workflow state", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const process = (await repository.listProcesses(local.teamId))[0]!;
    const itemId = await repository.createWorkItem(process.id, {
      stageId: process.stages[0]!.id,
      title: "Review brief",
      logicalFiles: ["brief.md"]
    });
    const executionId = await repository.createExecution({
      agentId: "agent",
      config: { prompt: "Review." },
      workItemId: itemId,
      runtime: "dsh"
    });
    await repository.updateExecution(executionId, "running");
    await repository.updateExecution(executionId, "completed");
    await repository.recordExecutionOutputs(executionId, ["revised.md"]);
    const [output] = await repository.listExecutionOutputs(executionId);
    expect(output).toMatchObject({ logicalOutput: "revised.md", status: "pending" });
    await repository.decideExecutionOutput(output!.id, "approved", "approved/revised.md");
    await repository.checkpointWorkItem(itemId, ["approved/revised.md"]);
    expect(await repository.getWorkItem(itemId)).toMatchObject({
      stageId: process.stages[0]!.id,
      checkpointStageId: process.stages[0]!.id,
      logicalFiles: ["brief.md", "approved/revised.md"]
    });
  });

  it("routes pending outputs once under the chosen status folder", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const process = (await repository.listProcesses(local.teamId))[0]!;
    const itemId = await repository.createWorkItem(process.id, {
      stageId: process.stages[0]!.id,
      title: "Sort resume"
    });
    const executionId = await repository.createExecution({
      agentId: "agent",
      config: { prompt: "Sort it." },
      workItemId: itemId,
      runtime: "dsh"
    });
    await repository.recordExecutionOutputs(executionId, ["resume.pdf"]);

    await repository.routeExecutionOutputs(executionId, "ready-for-human-review");
    await repository.routeExecutionOutputs(executionId, "ready-for-human-review");

    expect(await repository.listExecutionOutputs(executionId)).toEqual([
      expect.objectContaining({
        logicalOutput: "resume.pdf",
        logicalDestination: "ready-for-human-review/resume.pdf"
      })
    ]);
  });

  it("creates approved subtasks without moving their process-runtime-owned parent", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const goals = (await repository.listProcesses(local.teamId))[0]!;
    const [plan, work, waiting, review] = goals.stages;
    const parentId = await repository.createWorkItem(goals.id, {
      stageId: plan!.id,
      title: "Launch the site",
      logicalFiles: ["brief.md"]
    });
    const executionId = await repository.createExecution({
      agentId: "planner",
      config: { prompt: "Plan." },
      workItemId: parentId,
      runtime: "dsh"
    });
    await repository.recordExecutionOutputs(executionId, [TASK_PLAN_OUTPUT]);
    const [output] = await repository.listExecutionOutputs(executionId);

    await expect(repository.approveTaskPlan(
      output!.id,
      parentId,
      plan!.id,
      work!.id,
      waiting!.id,
      review!.id,
      [{ key: "bad", title: "Bad", description: "Use an unapproved file", role: "goal-worker", effect: "read", inputs: ["private.md"] }]
    )).rejects.toThrow(`Task 1 ("Bad") needs "private.md"`);

    const childIds = await repository.approveTaskPlan(
      output!.id,
      parentId,
      plan!.id,
      work!.id,
      waiting!.id,
      review!.id,
      [
        { key: "build", title: "Build", description: "Implement it", role: "goal-worker", effect: "prepare", inputs: ["brief.md"] },
        { key: "verify", title: "Verify", description: "Check it", role: "goal-worker", effect: "read", inputs: [] }
      ]
    );

    expect(await repository.getWorkItem(parentId)).toMatchObject({
      stageId: plan!.id,
      isTerminal: false
    });
    expect(await repository.listWorkItems(goals.id)).toEqual(
      expect.arrayContaining(
        childIds.map((id) =>
          expect.objectContaining({ id, parentId, stageId: work!.id, isTerminal: false })
        )
      )
    );
    expect(await repository.getWorkItem(childIds[0]!)).toMatchObject({
      logicalFiles: ["brief.md"],
      goal: {
        key: "build",
        role: "goal-worker",
        effect: "prepare",
        planOutputId: output!.id,
        occurrenceOf: null
      }
    });
    expect((await repository.listExecutionOutputs(executionId))[0]?.status).toBe("approved");

    const duplicateParentId = await repository.createWorkItem(goals.id, {
      stageId: plan!.id,
      title: "Duplicate scan",
      logicalFiles: ["brief.md"]
    });
    const duplicateExecutionId = await repository.createExecution({
      agentId: "planner",
      config: { prompt: "Plan." },
      workItemId: duplicateParentId,
      runtime: "dsh"
    });
    await repository.recordExecutionOutputs(duplicateExecutionId, [TASK_PLAN_OUTPUT]);
    const [duplicateOutput] = await repository.listExecutionOutputs(duplicateExecutionId);
    const [duplicateChildId] = await repository.approveTaskPlan(
      duplicateOutput!.id,
      duplicateParentId,
      plan!.id,
      work!.id,
      waiting!.id,
      review!.id,
      [{ key: "build", title: "Build again", description: "Duplicate", role: "goal-worker", effect: "prepare", inputs: ["brief.md"] }]
    );
    expect(await repository.getWorkItem(duplicateChildId!)).toMatchObject({ parentId: duplicateParentId });

    const retryExecutionId = await repository.createExecution({
      agentId: "planner",
      config: { prompt: "Plan again." },
      workItemId: duplicateParentId,
      runtime: "dsh"
    });
    await repository.recordExecutionOutputs(retryExecutionId, [TASK_PLAN_OUTPUT]);
    const [retryOutput] = await repository.listExecutionOutputs(retryExecutionId);
    await expect(repository.approveTaskPlan(
      retryOutput!.id,
      duplicateParentId,
      plan!.id,
      work!.id,
      waiting!.id,
      review!.id,
      [{ key: "build", title: "Build yet again", description: "Retry", role: "goal-worker", effect: "prepare", inputs: ["brief.md"] }]
    )).resolves.toEqual([]);
  });

  it("accepts plan inputs named by the folder the run staged them in", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const goals = (await repository.listProcesses(local.teamId))[0]!;
    const [plan, work, waiting, review] = goals.stages;
    const parentId = await repository.createWorkItem(goals.id, {
      stageId: plan!.id,
      title: "Count to ten",
      logicalFiles: ["counter.txt"]
    });
    const executionId = await repository.createExecution({
      agentId: "planner",
      config: { prompt: "Plan." },
      workItemId: parentId,
      runtime: "dsh"
    });
    await repository.recordExecutionOutputs(executionId, [TASK_PLAN_OUTPUT]);
    const [output] = await repository.listExecutionOutputs(executionId);

    const [childId] = await repository.approveTaskPlan(
      output!.id, parentId, plan!.id, work!.id, waiting!.id, review!.id,
      [{ key: "second", title: "Second entry", description: "Append", role: "goal-worker", effect: "prepare", inputs: ["inputs/counter.txt"] }]
    );
    expect(await repository.getWorkItem(childId!)).toMatchObject({ logicalFiles: ["counter.txt"] });
  });

  it("keeps the private task plan out of parent and child inputs", async () => {
    const database = new NodeDatabase();
    const repository = new LocalRepository(database);
    const local = await repository.bootstrap();
    const goals = (await repository.listProcesses(local.teamId))[0]!;
    const [plan, work, waiting, review] = goals.stages;
    const parentId = await repository.createWorkItem(goals.id, {
      stageId: plan!.id,
      title: "Continue a legacy goal",
      logicalFiles: ["brief.md", TASK_PLAN_OUTPUT]
    });
    const executionId = await repository.createExecution({
      agentId: "planner",
      config: { prompt: "Plan." },
      workItemId: parentId,
      runtime: "dsh"
    });
    await repository.recordExecutionOutputs(executionId, [TASK_PLAN_OUTPUT]);
    const [output] = await repository.listExecutionOutputs(executionId);

    await expect(repository.approveTaskPlan(
      output!.id, parentId, plan!.id, work!.id, waiting!.id, review!.id,
      [{ key: "bad-input", title: "Bad input", description: "Read metadata", role: "goal-worker", effect: "read", inputs: [TASK_PLAN_OUTPUT] }]
    )).rejects.toThrow(`needs "${TASK_PLAN_OUTPUT}"`);

    const [childId] = await repository.approveTaskPlan(
      output!.id, parentId, plan!.id, work!.id, waiting!.id, review!.id,
      [{ key: "clean-input", title: "Clean input", description: "Use the brief", role: "goal-worker", effect: "read", inputs: ["brief.md"] }]
    );
    expect(await repository.getWorkItem(parentId)).toMatchObject({ logicalFiles: ["brief.md"] });

    await database.execute(
      "UPDATE work_items SET logical_files_json = ? WHERE id = ?",
      [JSON.stringify(["brief.md", TASK_PLAN_OUTPUT]), childId!]
    );
    expect(await repository.getWorkItem(childId!)).toMatchObject({ logicalFiles: ["brief.md"] });
  });

  it("blocks task-plan approval until the run's other outputs are decided", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const goals = (await repository.listProcesses(local.teamId))[0]!;
    const [plan, work, waiting, review] = goals.stages;
    const parentId = await repository.createWorkItem(goals.id, {
      stageId: plan!.id,
      title: "Audit the ORM"
    });
    const executionId = await repository.createExecution({
      agentId: "planner",
      config: { prompt: "Plan." },
      workItemId: parentId,
      runtime: "dsh"
    });
    await repository.recordExecutionOutputs(executionId, ["audit-orm-discovery", TASK_PLAN_OUTPUT]);
    const outputs = await repository.listExecutionOutputs(executionId);
    const fileOutput = outputs.find(({ logicalOutput }) => logicalOutput === "audit-orm-discovery")!;
    const planOutput = outputs.find(({ logicalOutput }) => logicalOutput === TASK_PLAN_OUTPUT)!;
    const tasks = [{
      key: "fix",
      title: "Fix",
      description: "Act on the audit",
      role: "goal-worker",
      effect: "prepare" as const,
      inputs: ["audit-orm-discovery"]
    }];

    await expect(repository.approveTaskPlan(
      planOutput.id, parentId, plan!.id, work!.id, waiting!.id, review!.id, tasks
    )).rejects.toThrow("other outputs");

    await repository.decideExecutionOutput(fileOutput.id, "approved");
    const childIds = await repository.approveTaskPlan(
      planOutput.id, parentId, plan!.id, work!.id, waiting!.id, review!.id, tasks
    );
    expect(childIds).toHaveLength(1);
    expect(await repository.getWorkItem(childIds[0]!)).toMatchObject({
      logicalFiles: ["audit-orm-discovery"]
    });
    expect((await repository.getWorkItem(parentId))?.logicalFiles).toContain("audit-orm-discovery");
  });

  it("guides plans whose tasks depend on a sibling task's output", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const goals = (await repository.listProcesses(local.teamId))[0]!;
    const [plan, work, waiting, review] = goals.stages;
    const parentId = await repository.createWorkItem(goals.id, {
      stageId: plan!.id,
      title: "Audit the ORM"
    });
    const executionId = await repository.createExecution({
      agentId: "planner",
      config: { prompt: "Plan." },
      workItemId: parentId,
      runtime: "dsh"
    });
    await repository.recordExecutionOutputs(executionId, [TASK_PLAN_OUTPUT]);
    const [planOutput] = await repository.listExecutionOutputs(executionId);
    const discover = {
      key: "audit-orm-discovery",
      title: "Discover ORM usage",
      description: "Map usage",
      role: "goal-worker",
      effect: "prepare" as const,
      inputs: []
    };
    const report = {
      key: "report",
      title: "Compile audit report",
      description: "Write it up",
      role: "goal-worker",
      effect: "prepare" as const,
      inputs: ["audit-orm-discovery"]
    };

    await expect(repository.approveTaskPlan(
      planOutput!.id, parentId, plan!.id, work!.id, waiting!.id, review!.id, [discover, report]
    )).rejects.toThrow(`which task 1 ("Discover ORM usage") is expected to produce`);

    const [discoverId] = await repository.approveTaskPlan(
      planOutput!.id, parentId, plan!.id, work!.id, waiting!.id, review!.id, [discover], false
    );
    await expect(repository.approveTaskPlan(
      planOutput!.id, parentId, plan!.id, work!.id, waiting!.id, review!.id, [report], false
    )).rejects.toThrow(`produced by the task "Discover ORM usage", which has not finished yet`);

    // The worker names its files itself — the dependency resolves to whatever was approved.
    const childExecutionId = await repository.createExecution({
      agentId: "goal-worker",
      config: { prompt: "Work." },
      workItemId: discoverId!,
      runtime: "dsh"
    });
    await repository.recordExecutionOutputs(childExecutionId, ["discovery-notes.md"]);
    const [discoverOutput] = await repository.listExecutionOutputs(childExecutionId);

    await expect(repository.approveTaskPlan(
      planOutput!.id, parentId, plan!.id, work!.id, waiting!.id, review!.id, [report], false
    )).rejects.toThrow(`These subtasks have files waiting for your review: "Discover ORM usage" (discovery-notes.md)`);

    await repository.decideExecutionOutput(discoverOutput!.id, "approved");
    const [reportId] = await repository.approveTaskPlan(
      planOutput!.id, parentId, plan!.id, work!.id, waiting!.id, review!.id, [report]
    );
    expect(await repository.getWorkItem(reportId!)).toMatchObject({
      logicalFiles: ["discovery-notes.md"]
    });
  });

  it("validates checkpoint targets without changing workflow state", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const process = (await repository.listProcesses(local.teamId))[0]!;
    const [first, , third] = process.stages;
    const last = process.stages.at(-1)!;
    const named = await repository.createWorkItem(process.id, {
      stageId: first!.id,
      title: "Named"
    });
    await repository.checkpointWorkItem(named, [], third!.id);
    expect(await repository.getWorkItem(named)).toMatchObject({
      stageId: first!.id,
      isTerminal: false
    });

    const unknown = await repository.createWorkItem(process.id, {
      stageId: first!.id,
      title: "Unknown"
    });
    await expect(repository.checkpointWorkItem(unknown, [], "not-a-stage-id")).rejects.toThrow(
      "Target status not found"
    );
    expect((await repository.getWorkItem(unknown))?.stageId).toBe(first!.id);

    const silent = await repository.createWorkItem(process.id, {
      stageId: first!.id,
      title: "Silent"
    });
    await repository.checkpointWorkItem(silent, []);
    expect((await repository.getWorkItem(silent))?.stageId).toBe(first!.id);

    // Terminal semantics belong to the process runtime, not checkpoint persistence.
    const finished = await repository.createWorkItem(process.id, {
      stageId: first!.id,
      title: "Finished"
    });
    await repository.checkpointWorkItem(finished, [], last!.id);
    expect(await repository.getWorkItem(finished)).toMatchObject({
      stageId: first!.id,
      isTerminal: false
    });
  });

  it("applies a recovered no-output settlement exactly once", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const process = (await repository.listProcesses(local.teamId))[0]!;
    const itemId = await repository.createWorkItem(process.id, {
      stageId: process.stages[0]!.id,
      title: "Recover me"
    });
    const executionId = await repository.createExecution({
      agentId: "agent",
      config: { prompt: "Work." },
      workItemId: itemId,
      runtime: "dsh"
    });
    const context = {
      deliveryId: "delivery-1",
      continuation: false,
      outputs: [],
      statusId: process.stages[1]!.id,
      projectionState: "pending" as const
    };
    await repository.beginExecutionDelivery(executionId, {
      ...context,
      prompt: "Work.",
      workspaceRef: "/tmp/workspace"
    });
    await repository.updateExecution(executionId, "completed", { result: context });

    await repository.checkpointWorkItem(itemId, [], process.stages[1]!.id, executionId);
    await repository.checkpointWorkItem(itemId, [], process.stages[2]!.id, executionId);

    expect(await repository.getWorkItem(itemId)).toMatchObject({
      stageId: process.stages[0]!.id,
      syncVersion: 1
    });
    expect((await repository.getExecution(executionId))?.result?.projectionState).toBe(
      "local_applied"
    );
    await repository.completeExecutionProjection(executionId);
    expect(await repository.listPendingExecutionProjections()).toEqual([]);
  });

  it("returns only executions interrupted by the current restart", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const process = (await repository.listProcesses(local.teamId))[0]!;
    const itemId = await repository.createWorkItem(process.id, {
      stageId: process.stages[0]!.id,
      title: "Work"
    });
    await repository.createExecution({
      agentId: "agent",
      config: { prompt: "Work." },
      workItemId: itemId,
      runtime: "dsh"
    });
    expect(await repository.interruptRunningExecutions()).toHaveLength(1);
    expect(await repository.interruptRunningExecutions()).toEqual([]);
  });

  it("keeps one row per server team id across desktops", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    await repository.bootstrap();
    const organizationId = await repository.createOrganization("Acme");
    await repository.upsertServerOrganization(organizationId, "Acme");

    // Desktop A creates the team with the id the server assigned; desktop B only ever reconciles.
    const teamId = await repository.createTeam(organizationId, "Design", "server-team-1");
    expect(teamId).toBe("server-team-1");
    await repository.upsertServerTeam("server-team-1", organizationId, "Design");
    await repository.upsertServerTeam("server-team-1", organizationId, "Design & Brand");
    await repository.upsertServerTeam("server-team-2", organizationId, "Ops");

    expect((await repository.listTeams(organizationId)).map(({ id, name }) => [id, name])).toEqual([
      ["server-team-1", "Design & Brand"],
      ["server-team-2", "Ops"]
    ]);
  });
  it("stores a settled run so it renders and searches without the runtime", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const process = (await repository.listProcesses(local.teamId))[0]!;
    const itemId = await repository.createWorkItem(process.id, {
      stageId: process.stages[0]!.id,
      title: "Invoice"
    });
    const executionId = await repository.createExecution({
      agentId: "agent",
      config: { prompt: "Do it." },
      workItemId: itemId,
      runtime: "dsh"
    });
    const snapshot: BeesConversationSnapshotV1 = {
      version: 1,
      capturedAt: "2026-07-31T10:00:00.000Z",
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            { kind: "reasoning", text: "HIDDEN REASONING" },
            { kind: "text", text: "The invoice totals 400." }
          ]
        }
      ]
    };
    await repository.saveConversationSnapshot(executionId, snapshot);

    expect((await repository.getExecution(executionId))?.conversationSnapshot).toEqual(snapshot);
    expect((await repository.searchExecutions(local.teamId, "invoice totals")).map(({ id }) => id))
      .toEqual([executionId]);
    // Hidden reasoning is deliberately absent from the searchable projection.
    expect(await repository.searchExecutions(local.teamId, "HIDDEN REASONING")).toEqual([]);
    expect(await repository.searchExecutions(local.teamId, "   ")).toEqual([]);
    // A wildcard must be searched for literally, not expanded.
    expect(await repository.searchExecutions(local.teamId, "%")).toEqual([]);
  });

  it("searches work items and settled runs together, and only inside the team", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const process = (await repository.listProcesses(local.teamId))[0]!;
    const stageId = process.stages[0]!.id;
    const itemId = await repository.createWorkItem(process.id, {
      stageId,
      title: "Quarterly invoice review",
      description: "Check the supplier totals."
    });
    const otherOrg = await repository.createOrganization("Other");
    const otherTeam = await repository.createTeam(otherOrg, "Other team");
    const otherProcess = await createTestProcess(repository, otherTeam);
    await repository.createWorkItem(otherProcess.id, {
      stageId: otherProcess.stages[0]!.id,
      title: "Invoice work for someone else"
    });
    const executionId = await repository.createExecution({
      agentId: "agent",
      config: { prompt: "Do it." },
      workItemId: itemId,
      runtime: "dsh"
    });
    await repository.saveConversationSnapshot(executionId, {
      version: 1,
      capturedAt: "2026-07-31T10:00:00.000Z",
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [{ kind: "text", text: "The supplier invoice totals 400." }]
        }
      ]
    });

    const hits = await repository.search(local.teamId, "invoice");
    expect(hits.map(({ kind, id }) => ({ kind, id })).sort((a, b) => a.kind.localeCompare(b.kind)))
      .toEqual([
        { kind: "execution", id: executionId },
        { kind: "work_item", id: itemId }
      ]);
    // Both kinds carry the work item's title, so one list reads without a second lookup.
    expect(hits.every(({ title }) => title === "Quarterly invoice review")).toBe(true);
    // The other team's item matches the word and must not appear.
    expect(hits).toHaveLength(2);

    // Every word has to be there, and a word nobody wrote finds nothing.
    expect(await repository.search(local.teamId, "supplier totals")).toHaveLength(2);
    expect(await repository.search(local.teamId, "invoice unicorn")).toEqual([]);

    // Edits follow the row.
    await repository.updateWorkItem(itemId, { title: "Renamed" });
    expect(await repository.search(local.teamId, "quarterly")).toEqual([]);

    // Deleting the run takes its conversation out of the index with it.
    await repository.deleteExecution(executionId, "bees-run");
    expect(await repository.search(local.teamId, "supplier")).toEqual([]);
  });

  it("counts a skill as used every time a run puts it in front of a model", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();

    await repository.recordSkillUse(local.teamId, ["registry:brand/SKILL.md"]);
    // Duplicates within one run are one use: the model saw the skill once.
    await repository.recordSkillUse(local.teamId, [
      "registry:brand/SKILL.md",
      "registry:brand/SKILL.md",
      "registry:tone/SKILL.md"
    ]);
    await repository.recordSkillUse(local.teamId, []);

    const usage = (await repository.listSkillUsage(local.teamId)).sort((left, right) =>
      left.capabilityRef.localeCompare(right.capabilityRef)
    );
    expect(usage.map(({ capabilityRef, useCount }) => ({ capabilityRef, useCount }))).toEqual([
      { capabilityRef: "registry:brand/SKILL.md", useCount: 2 },
      { capabilityRef: "registry:tone/SKILL.md", useCount: 1 }
    ]);
    expect(usage[0]!.lastUsedAt).not.toBe("");
    expect(await repository.listSkillUsage("another-team")).toEqual([]);
  });

  it("defaults a run's conversation id to its runtime instance and records a restart link", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const process = (await repository.listProcesses(local.teamId))[0]!;
    const itemId = await repository.createWorkItem(process.id, {
      stageId: process.stages[0]!.id,
      title: "Draft"
    });
    const firstId = await repository.createExecution({
      agentId: "agent",
      config: { prompt: "v1" },
      workItemId: itemId,
      runtime: "dsh"
    });
    const restartId = await repository.createExecution({
      agentId: "agent",
      config: { prompt: "v2" },
      workItemId: itemId,
      runtime: "dsh",
      restartedFromExecutionId: firstId
    });

    expect(await repository.getExecution(firstId)).toMatchObject({
      conversationId: firstId,
      instanceUid: null,
      restartedFromExecutionId: null
    });
    expect(await repository.getExecution(restartId)).toMatchObject({
      conversationId: restartId,
      restartedFromExecutionId: firstId,
      config: { prompt: "v2" }
    });
    // The source receipt and its conversation are linked, never mutated or reused.
    expect((await repository.getExecution(firstId))?.config).toEqual({ prompt: "v1" });
  });
});
