import {
  CancellationScope, condition, defineQuery, defineSignal, isCancellation, patched,
  proxyActivities, setHandler, sleep
} from "@temporalio/workflow";

const pauseSignal = defineSignal("pause");
const resumeSignal = defineSignal("resume");
const retrySignal = defineSignal("retry");
export const processStateQuery = defineQuery("processState");

const { projectWorkItem } = proxyActivities({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 5 }
});
const legacyDshActivities = proxyActivities({
  startToCloseTimeout: "24 hours",
  heartbeatTimeout: "30 seconds",
  retry: { maximumAttempts: 3 }
});
const durableDshActivities = proxyActivities({
  // ponytail: Temporal requires a finite activity deadline; a century is operationally indefinite.
  startToCloseTimeout: "36500 days",
  heartbeatTimeout: "30 seconds",
  retry: { maximumAttempts: 3 }
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

export async function processWorkflow(input) {
  let index = Math.max(0, input.stages.findIndex(({ id }) => id === input.stageId));
  let paused = false;
  let retryRequested = false;
  let durableHumanWaits = patched("bees-durable-human-waits-v1");
  let candidateExecutionId = null;
  let feedback = "";
  const state = {
    workItemId: input.workItemId,
    processId: input.processId,
    stageId: input.stages[index].id,
    phase: "running",
    attempt: 1,
    reviewCycle: 0,
    executionId: null,
    error: null
  };

  setHandler(pauseSignal, () => { paused = true; });
  setHandler(resumeSignal, () => { paused = false; });
  setHandler(retrySignal, () => { retryRequested = true; paused = false; });
  setHandler(processStateQuery, () => state);

  const project = async (phase = state.phase, error = state.error) => {
    state.phase = phase;
    state.error = error;
    await projectWorkItem({ ...state });
  };
  const waitForRetry = async (error) => {
    retryRequested = false;
    await project("failed", error);
    await condition(() => retryRequested);
    retryRequested = false;
    if (!durableHumanWaits && patched(`bees-durable-human-waits-retry-${state.attempt}`))
      durableHumanWaits = true;
    state.attempt += 1;
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
      if (!["agent", "review"].includes(stage.driver)) {
        await waitForRetry(`Automatic workflow cannot run the ${stage.name} stage`);
        continue;
      }

      if (stage.driver === "review") state.reviewCycle += 1;
      const purpose = stage.driver === "review" ? "reviewer" : "worker";
      state.executionId = purpose === "reviewer"
        ? `${input.workItemId}-stage-${index}-review-${state.attempt}-${state.reviewCycle}`
        : `${input.workItemId}-stage-${index}-work-${state.attempt}`;
      await project("running", null);

      let result;
      try {
        result = await (durableHumanWaits ? durableDshActivities : legacyDshActivities).runDshStage({
          ...state,
          purpose,
          stageName: stage.name,
          instructions: stage.instructions,
          candidateExecutionId,
          feedback
        });
      } catch (error) {
        const message = failureMessage(error);
        if (durableHumanWaits && message === "Stopped by user") {
          await project("cancelled", message);
          return state;
        }
        await waitForRetry(message);
        continue;
      }

      if (result.outcome === "waiting") {
        await project("waiting", result.summary || "Waiting for agent capacity");
        await sleep("15 seconds");
        state.error = null;
        continue;
      }
      if (purpose === "worker" && result.outcome === "candidate") {
        candidateExecutionId = state.executionId;
        feedback = "";
        index += 1;
        continue;
      }
      if (purpose === "reviewer" && result.outcome === "pass") {
        index += 1;
        continue;
      }
      if (purpose === "reviewer" && result.outcome === "revise") {
        feedback = result.summary;
        index = Math.max(0, input.stages.slice(0, index).findLastIndex(({ driver }) => driver === "agent"));
        if (state.attempt >= input.maxAttempts) await waitForRetry(feedback || "Review requested another revision");
        else state.attempt += 1;
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
