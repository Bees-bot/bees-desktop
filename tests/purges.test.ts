import { describe, expect, it, vi } from "vitest";
import { LocalRepository } from "../src/repository.js";
import { drainConversationPurges, purgeNotice } from "../src/purges.js";
import { NodeDatabase } from "./node-database.js";

async function repositoryWithRun() {
  const repository = new LocalRepository(new NodeDatabase());
  const local = await repository.bootstrap();
  const process = (await repository.listProcesses(local.teamId))[0]!;
  const workItemId = await repository.createWorkItem(process.id, {
    stageId: process.stages[0]!.id,
    title: "Invoice"
  });
  const executionId = await repository.createExecution({
    agentId: "agent-1",
    config: { prompt: "Do it." },
    workItemId,
    runtime: "dsh"
  });
  return { repository, local, executionId };
}

describe("execution deletion", () => {
  it("queues the DSH conversation for purge in the same transaction as the delete", async () => {
    const { repository, executionId } = await repositoryWithRun();
    await repository.recordExecutionOutputs(executionId, ["draft.md"]);

    await repository.deleteExecution(executionId, "agent-agent-1");

    expect(await repository.getExecution(executionId)).toBeNull();
    expect(await repository.listExecutionOutputs(executionId)).toEqual([]);
    expect(await repository.listPendingConversationPurges()).toEqual([
      {
        conversationId: executionId,
        agentName: "agent-agent-1",
        requestedAt: expect.any(String),
        attempts: 0,
        lastAttemptAt: null,
        lastError: null
      }
    ]);
  });

  it("queues purges for runs removed by a cascading team delete", async () => {
    const { repository, local, executionId } = await repositoryWithRun();

    await repository.deleteTeam(local.teamId);

    expect((await repository.listPendingConversationPurges()).map(({ conversationId }) => conversationId))
      .toEqual([executionId]);
  });
});

describe("drainConversationPurges", () => {
  it("clears a tombstone only when the runtime really removed the conversation", async () => {
    const { repository, executionId } = await repositoryWithRun();
    await repository.deleteExecution(executionId, "agent-agent-1");

    const purger = { purgeConversation: vi.fn().mockResolvedValue(undefined) };
    const report = await drainConversationPurges(repository, purger);

    expect(purger.purgeConversation).toHaveBeenCalledWith("agent-agent-1", executionId);
    expect(report).toMatchObject({ purged: 1, pending: 0 });
    expect(await repository.listPendingConversationPurges()).toEqual([]);
  });

  it("keeps the tombstone and records why when the runtime has no delete route", async () => {
    const { repository, executionId } = await repositoryWithRun();
    await repository.deleteExecution(executionId, "agent-agent-1");

    const purger = {
      purgeConversation: vi
        .fn()
        .mockRejectedValue(new Error("This DSH runtime has no conversation delete route yet"))
    };
    const first = await drainConversationPurges(repository, purger);

    expect(first).toMatchObject({ purged: 0, pending: 1 });
    expect(await repository.listPendingConversationPurges()).toMatchObject([
      { attempts: 1, lastError: "This DSH runtime has no conversation delete route yet" }
    ]);

    // Retried, not abandoned — and it clears itself the day the route exists.
    await drainConversationPurges(repository, purger);
    expect(await repository.listPendingConversationPurges()).toMatchObject([{ attempts: 2 }]);

    purger.purgeConversation.mockResolvedValue(undefined);
    expect(await drainConversationPurges(repository, purger)).toMatchObject({ purged: 1 });
    expect(await repository.listPendingConversationPurges()).toEqual([]);
  });

  it("treats an already-forgotten conversation as purged", async () => {
    const { repository, executionId } = await repositoryWithRun();
    await repository.deleteExecution(executionId, "agent-agent-1");

    // The runtime adapter maps 404 to success; the drain just sees a resolved promise.
    await drainConversationPurges(repository, {
      purgeConversation: async () => undefined
    });

    expect(await repository.listPendingConversationPurges()).toEqual([]);
  });
});

describe("purgeNotice", () => {
  it("never claims deletion while conversation data is still in the runtime", () => {
    expect(purgeNotice({ purged: 1, pending: 0, lastError: null })).toBe("Run deleted");
    expect(purgeNotice({ purged: 0, pending: 1, lastError: "no route" })).toContain(
      "could not be deleted yet"
    );
    expect(purgeNotice({ purged: 0, pending: 3, lastError: "no route" })).toContain("3 agent");
  });
});
