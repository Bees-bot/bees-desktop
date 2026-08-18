import { object } from "./model-json.js";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { createFlueClient, type FlueClient } from "@flue/sdk";

export type RuntimeExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface RuntimeEvent {
  type: "history" | "updates";
  timestamp: string;
  offset: string | null;
  data: unknown;
}

export interface RuntimeExecutionInput {
  executionId: string;
  /** The Flue conversation to address. Equals `executionId` for runs. */
  conversationId: string;
  agentName: string;
  prompt: string;
  onEvent?: (event: RuntimeEvent) => void | Promise<void>;
}

export interface RuntimeExecutionResult {
  executionId: string;
  status: RuntimeExecutionStatus;
  output: unknown;
  logs: string;
  submissionId: string | null;
  /** Flue incarnation guard, so a follow-up cannot land on a restarted runtime's conversation. */
  instanceUid: string | null;
  usage: Record<string, unknown> | null;
  model: Record<string, unknown> | null;
}

export interface AgentRuntime {
  execute(input: RuntimeExecutionInput): Promise<RuntimeExecutionResult>;
  cancel(executionId: string): Promise<void>;
  getStatus(executionId: string): Promise<RuntimeExecutionStatus>;
}

interface ActiveExecution {
  client: FlueClient;
  controller: AbortController;
  status: RuntimeExecutionStatus;
}


/**
 * A thin adapter over `@flue/sdk`. Flue 2 removed `?wait=result`, `?view=history`, and the
 * long-poll offset protocol this file used to implement by hand: admission is a 202 receipt
 * and the SDK owns reconnect, ordering, and settlement.
 *
 * Rust owns admission and settlement; this SDK adapter is only the disposable live-view client.
 */
export class FlueRuntime implements AgentRuntime {
  private readonly executions = new Map<string, ActiveExecution>();

  // Runs and stream reads both outlive the webview's fixed 60s request timeout, which aborts
  // a still-working run as "Load failed". The Rust-side fetch has no such cap.
  constructor(
    private readonly baseUrl = "http://127.0.0.1:3583",
    private readonly request: typeof fetch = tauriFetch as typeof fetch,
    /** Per-launch bearer for the agent mount, from `ensure_flue_runtime`. Never persisted. */
    private readonly token = ""
  ) {}

  private client(agentName: string, conversationId: string): FlueClient {
    return createFlueClient({
      url: `${this.baseUrl}/agents/${encodeURIComponent(agentName)}/${encodeURIComponent(conversationId)}`,
      fetch: this.request,
      ...(this.token ? { token: this.token } : {})
    });
  }

  async execute(input: RuntimeExecutionInput): Promise<RuntimeExecutionResult> {
    if (this.executions.has(input.executionId)) {
      throw new Error("Execution identifier is already active");
    }
    const client = this.client(input.agentName, input.conversationId);
    const active: ActiveExecution = {
      client,
      controller: new AbortController(),
      status: "running"
    };
    this.executions.set(input.executionId, active);
    try {
      // A dead runtime rejects with an opaque TypeError ("Load failed" in the Tauri webview),
      // which names neither the runtime nor the run. Same treatment as apiFetch.
      const admission = await client
        .send({
          message: { kind: "user", body: input.prompt },
          signal: active.controller.signal,
          // Admission is at-least-once across a retry: key it so a resend converges on the
          // same submission instead of starting a second turn.
          idempotencyKey: input.executionId
        })
        .catch((error: unknown) => {
          if (active.controller.signal.aborted) throw error;
          throw new Error(`Can't reach the local runtime at ${this.baseUrl}`);
        });

      await client.wait(admission, {
        signal: active.controller.signal,
        ...(input.onEvent
          ? {
              onEvent: (chunk) =>
                input.onEvent?.({
                  type: "updates",
                  timestamp: new Date().toISOString(),
                  offset: null,
                  data: [chunk]
                })
            }
          : {})
      });
      const reply = await client.read(admission);
      active.status = "completed";
      const metadata = object(reply.metadata);
      return {
        executionId: input.executionId,
        status: "completed",
        output: { text: reply.text, data: reply.data, metadata: reply.metadata },
        logs: reply.text,
        submissionId: admission.submissionId,
        instanceUid: admission.uid,
        usage: Object.keys(object(metadata.usage)).length ? object(metadata.usage) : null,
        model: Object.keys(object(metadata.model)).length ? object(metadata.model) : null
      };
    } catch (error) {
      if (active.status === "cancelled" || active.controller.signal.aborted) {
        return {
          executionId: input.executionId,
          status: "cancelled",
          output: null,
          logs: "Execution cancelled",
          submissionId: null,
          instanceUid: null,
          usage: null,
          model: null
        };
      }
      active.status = "failed";
      throw error;
    } finally {
      this.executions.delete(input.executionId);
    }
  }

  /**
   * A durable stop: `abort()` settles the accepted submission in the runtime. Aborting only
   * the local read signal would leave the agent working and must never be presented as a stop.
   */
  async cancel(executionId: string): Promise<void> {
    const active = this.executions.get(executionId);
    if (!active || !["queued", "running"].includes(active.status)) return;
    await active.client.abort();
    active.status = "cancelled";
    active.controller.abort();
  }

  async getStatus(executionId: string): Promise<RuntimeExecutionStatus> {
    return this.executions.get(executionId)?.status ?? "failed";
  }

  /**
   * Follow a conversation for live rendering. Purely presentational: the run settles in Rust
   * whether or not anyone is watching, so dropping this connection loses nothing.
   */
  observe(
    agentName: string,
    conversationId: string,
    onEvent: (event: RuntimeEvent) => void,
    signal: AbortSignal
  ): void {
    const observation = this.client(agentName, conversationId).observe({ signal });
    const publish = () => {
      const { conversation, offset } = observation.getSnapshot();
      if (!conversation) return;
      onEvent({
        type: "history",
        timestamp: new Date().toISOString(),
        offset: offset ?? null,
        data: conversation
      });
    };
    const unsubscribe = observation.subscribe(publish);
    signal.addEventListener("abort", () => {
      unsubscribe();
      observation.close();
    }, { once: true });
    publish();
  }

  /**
   * Remove a conversation, its submissions and its attachments from the runtime.
   *
   * Flue 2 ships no delete route, so this currently fails and the caller keeps its tombstone.
   * It is written as an ordinary authenticated request against the conversation URL so that
   * the day the runtime supports it, purge starts working with no other change here — Bees
   * does not reach into Flue's database and does not patch the server to fake it.
   */
  async purgeConversation(agentName: string, conversationId: string): Promise<void> {
    const url = `${this.baseUrl}/agents/${encodeURIComponent(agentName)}/${encodeURIComponent(conversationId)}`;
    const response = await this.request(url, {
      method: "DELETE",
      ...(this.token ? { headers: { authorization: `Bearer ${this.token}` } } : {})
    });
    // 404 means the runtime has already forgotten it, which is the state we wanted.
    if (response.ok || response.status === 404) return;
    throw new Error(
      response.status === 405 || response.status === 501
        ? "This Flue runtime has no conversation delete route yet"
        : `Flue delete returned ${response.status}`
    );
  }

  /** The whole conversation, for reopening a live run or reconciling one after a restart. */
  async history(agentName: string, conversationId: string): Promise<RuntimeEvent | null> {
    try {
      const snapshot = await this.client(agentName, conversationId).history();
      return {
        type: "history",
        timestamp: new Date().toISOString(),
        offset: snapshot.offset,
        data: snapshot
      };
    } catch {
      // A conversation that never received a prompt has no stream yet.
      return null;
    }
  }
}
