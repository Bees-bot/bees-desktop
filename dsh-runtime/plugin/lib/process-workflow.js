import {
  CancellationScope, condition, defineSignal, isCancellation,
  executeChild, proxyActivities, setHandler, sleep, workflowInfo
} from "@temporalio/workflow";

const pauseSignal = defineSignal("pause");
const resumeSignal = defineSignal("resume");
const retrySignal = defineSignal("retry");
const stageChangedSignal = defineSignal("stageChanged");

const { projectWorkItem, createRecurringWorkItem } = proxyActivities({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 5 }
});

export async function recurringWorkWorkflow(input) {
  const work = await createRecurringWorkItem({
    ...input, occurrenceAt: workflowInfo().startTime.toISOString().slice(0, 19) + "Z"
  });
  if (!work) return { skipped: true };
  return executeChild(processWorkflow, {
    workflowId: `bees/work-item/${work.workItemId}`,
    args: [work]
  });
}
const durableActivities = proxyActivities({
  startToCloseTimeout: "36500 days",
  heartbeatTimeout: "30 seconds",
  // Infrastructure loss retries the same execution. Agent failures are non-retryable.
  retry: { initialInterval: "1 second", maximumInterval: "30 seconds" }
});

function failureMessage(error) {
  let current = error;
  let message = String(error?.message ?? error);
  const seen = new Set();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (typeof current.message === "string" && current.message) message = current.message;
    current = current.cause;
  }
  return message;
}

/** Fifteen seconds apart, so forty of them is ten minutes without a free agent. */
const CAPACITY_WAIT_LIMIT = 40;

export async function processWorkflow(input) {
  let index = Math.max(0, input.stages.findIndex(({ id }) => id === input.stageId));
  const startedAt = index;
  let paused = false;
  let retryRequested = false;
  let retryRequests = 0;
  let stageChanges = 0;
  let candidateExecutionId = input.correction?.candidateExecutionId ?? null;
  let capacityWaits = 0;
  let feedback = input.correction?.feedback ?? "";
  const state = {
    workItemId: input.workItemId,
    processId: input.processId,
    stageId: input.stages[index].id,
    phase: "running",
    attempt: input.correction?.attempt ?? 1,
    retryRequest: 0,
    reviewCycle: 0,
    // attempt keeps climbing so every session id stays unique; this one is what maxAttempts means
    revisions: 0,
    executionId: null,
    error: null
  };

  setHandler(pauseSignal, () => { paused = true; });
  setHandler(resumeSignal, () => { paused = false; });
  setHandler(retrySignal, () => { retryRequested = true; paused = false; });
  setHandler(stageChangedSignal, (executionId) => {
    if (executionId === state.executionId) stageChanges += 1;
  });

  const project = async (phase = state.phase, error = state.error, waitingForInput = false) => {
    state.phase = phase;
    state.error = error;
    await projectWorkItem({ ...state, ...(waitingForInput ? { waitingForInput: true } : {}) });
  };
  const waitForRetry = async (error) => {
    const recoverInterruptedWait = /heartbeat timeout|Stage completion was not recorded|The agent runtime completed without calling bees_submit_stage_result|This run ended without a completed stage result/i.test(error);
    retryRequested = false;
    await project("failed", error);
    await condition(() => retryRequested);
    retryRequested = false;
    state.retryRequest = ++retryRequests;
    if (!recoverInterruptedWait) state.attempt += 1;
    else if (input.stages[index].driver === "review") state.reviewCycle -= 1;
    state.error = null;
  };

  try {
    while (true) {
      state.stageId = input.stages[index].id;
      const stage = input.stages[index];
      if (paused) {
        await project("paused", null);
        await condition(() => !paused);
      }
      if (stage.driver === "terminal" || stage.isTerminal) {
        state.executionId = null;
        await project("completed", null);
        return state;
      }
      // The parent evaluates delegated outputs. Explicit human approval stages still run.
      // New input flag leaves already-recorded workflow histories on their original path.
      if (input.parentReview && stage.driver === "review" && !stage.requiresHumanApproval) {
        index += 1;
        continue;
      }
      if (!["agent", "discussion", "review"].includes(stage.driver)) {
        await waitForRetry(`Automatic workflow cannot run the ${stage.name} stage`);
        continue;
      }

      if (stage.driver === "review") state.reviewCycle += 1;
      const purpose = stage.driver === "review" ? "reviewer"
        : stage.driver === "discussion" ? "discussion" : "worker";
      state.executionId = purpose === "reviewer"
        ? `${input.workItemId}-stage-${index}-review-${state.attempt}-${state.reviewCycle}`
        : `${input.workItemId}-stage-${index}-${purpose === "worker" ? "work" : purpose}-${state.attempt}`;
      await project("running", null);

      let result;
      try {
        while (true) {
          const observedChanges = stageChanges;
          try {
            result = await durableActivities.runDshStage({
              ...state, purpose, driver: stage.driver,
              requiresHumanApproval: Boolean(stage.requiresHumanApproval),
              stageName: stage.name, candidateExecutionId, feedback,
              durableWaits: true
            });
          } catch (error) {
            throw error;
          }
          if (result.outcome !== "suspended") break;
          await project("waiting", null, true);
          // Signals are recorded by Temporal; no activity or heartbeat stays alive for a human wait.
          // Capture the counter before the activity so an early answer cannot be lost.
          await condition(() => stageChanges !== observedChanges);
          if (paused) {
            await project("paused", null, true);
            await condition(() => !paused);
          }
          await project("running", null);
        }
      } catch (error) {
        const message = failureMessage(error);
        if (message === "Stopped by user") {
          await project("cancelled", message);
          return state;
        }
        await waitForRetry(message);
        continue;
      }

      if (result.outcome === "waiting") {
        // Capacity that never frees up used to hold a run here every fifteen seconds for ever,
        // with nobody told. After ten minutes it becomes a failure a person can see and retry.
        capacityWaits += 1;
        if (capacityWaits >= CAPACITY_WAIT_LIMIT) {
          capacityWaits = 0;
          await waitForRetry(result.summary || "No agent capacity became free");
          continue;
        }
        await project("waiting", result.summary || "Waiting for agent capacity");
        await sleep("15 seconds");
        state.error = null;
        continue;
      }
      state.retryRequest = 0;
      capacityWaits = 0;
      if (purpose !== "reviewer" && result.outcome === "blocked") {
        await waitForRetry(result.summary || `${stage.name} is blocked`);
        continue;
      }
      if (purpose !== "reviewer" && result.outcome === "candidate") {
        // A peer was delegated one assignment, not the rest of the process. Walking it on ran
        // every later stage a second time and held the parent waiting for all of them.
        if (input.peerAssignment && index === startedAt) {
          state.executionId = null;
          await project("completed", null);
          return state;
        }
        candidateExecutionId = state.executionId;
        feedback = "";
        index += 1;
        continue;
      }
      if (purpose === "reviewer" && result.outcome === "pass") {
        state.revisions = 0;
        index += 1;
        continue;
      }
      if (purpose === "reviewer" && result.outcome === "revise") {
        feedback = result.summary;
        const worker = input.stages.slice(0, index).findLastIndex(({ driver }) =>
          driver === "agent" || driver === "discussion");
        // With no worker stage behind it there is nothing to revise, so a human has to look.
        if (worker < 0) { await waitForRetry(feedback || "Review asked for a revision with no worker stage before it"); continue; }
        index = worker;
        state.revisions += 1;
        state.attempt += 1;
        if (state.revisions >= input.maxAttempts) await waitForRetry(feedback || "Review requested another revision");
        continue;
      }
      await waitForRetry(`The ${stage.name} agent returned an invalid outcome`);
    }
  } catch (error) {
    if (!isCancellation(error)) throw error;
    await CancellationScope.nonCancellable(() => project("cancelled", "Cancelled"));
    return state;
  }
}
