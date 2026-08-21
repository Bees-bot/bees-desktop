import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

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
  /** The DSH session to address. Equals `executionId` for work runs. */
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
  /** DSH incarnation guard, so a follow-up cannot land in a replacement session. */
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
  agentName: string;
  conversationId: string;
  controller: AbortController;
  status: RuntimeExecutionStatus;
}

interface Admission {
  submissionId: string;
  uid: string;
}

interface Settlement {
  submissionId: string;
  outcome: "completed" | "failed" | "cancelled" | "interrupted";
  error?: { message?: string } | string | null;
}

interface Conversation {
  offset?: string | null;
  messages?: Array<{ role?: string; parts?: Array<{ type?: string; text?: string }> }>;
  settlements?: Settlement[];
}

const pause = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });

/** Disposable client for Bees' authenticated compatibility routes inside DSH. */
export class DshRuntime implements AgentRuntime {
  private readonly executions = new Map<string, ActiveExecution>();

  constructor(
    private readonly baseUrl = "http://127.0.0.1:3583",
    private readonly request: typeof fetch = tauriFetch as typeof fetch,
    /** Per-launch bearer from `ensure_dsh_runtime`. Never persisted. */
    private readonly token = ""
  ) {}

  private url(agentName: string, conversationId: string): string {
    return `${this.baseUrl}/agents/${encodeURIComponent(agentName)}/${encodeURIComponent(conversationId)}`;
  }

  private options(init: RequestInit = {}): RequestInit {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    return {
      ...init,
      headers
    };
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.request(url, this.options(init));
    } catch {
      throw new Error(`Can't reach the local DSH runtime at ${this.baseUrl}`);
    }
    const value = await response.json().catch(() => ({})) as { error?: string | { message?: string } };
    if (!response.ok) {
      const detail = typeof value.error === "string" ? value.error : value.error?.message;
      throw new Error(detail ?? `DSH returned ${response.status}`);
    }
    return value as T;
  }

  private async snapshot(agentName: string, conversationId: string): Promise<Conversation> {
    return this.json<Conversation>(`${this.url(agentName, conversationId)}?view=history`);
  }

  async execute(input: RuntimeExecutionInput): Promise<RuntimeExecutionResult> {
    if (this.executions.has(input.executionId)) throw new Error("Execution identifier is already active");
    const active: ActiveExecution = {
      agentName: input.agentName,
      conversationId: input.conversationId,
      controller: new AbortController(),
      status: "running"
    };
    this.executions.set(input.executionId, active);
    let admission: Admission | null = null;
    try {
      admission = await this.json<Admission>(this.url(input.agentName, input.conversationId), {
        method: "POST",
        body: JSON.stringify({
          kind: "user",
          body: input.prompt,
          uid: null,
          idempotencyKey: input.executionId
        }),
        signal: active.controller.signal
      });
      for (;;) {
        const conversation = await this.snapshot(input.agentName, input.conversationId);
        await input.onEvent?.({
          type: "history",
          timestamp: new Date().toISOString(),
          offset: null,
          data: conversation
        });
        const settlement = conversation.settlements?.find(
          ({ submissionId }) => submissionId === admission?.submissionId
        );
        if (settlement) {
          const status: RuntimeExecutionStatus = settlement.outcome;
          active.status = status;
          const logs = conversation.messages
            ?.flatMap(({ role, parts }) => role === "assistant"
              ? (parts ?? []).flatMap((part) => part.type === "text" && part.text ? [part.text] : [])
              : [])
            .at(-1) ?? "";
          if (status === "failed" || status === "interrupted") {
            const detail = typeof settlement.error === "string"
              ? settlement.error
              : settlement.error?.message;
            throw new Error(detail ?? `DSH execution ${status}`);
          }
          return {
            executionId: input.executionId,
            status,
            output: { text: logs },
            logs,
            submissionId: admission.submissionId,
            instanceUid: admission.uid,
            usage: null,
            model: null
          };
        }
        await pause(350, active.controller.signal);
      }
    } catch (error) {
      if (active.status === "cancelled" || active.controller.signal.aborted) {
        return {
          executionId: input.executionId,
          status: "cancelled",
          output: null,
          logs: "Execution cancelled",
          submissionId: admission?.submissionId ?? null,
          instanceUid: admission?.uid ?? null,
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

  async cancel(executionId: string): Promise<void> {
    const active = this.executions.get(executionId);
    if (!active || !["queued", "running"].includes(active.status)) return;
    await this.json(`${this.url(active.agentName, active.conversationId)}/abort`, { method: "POST" });
    active.status = "cancelled";
    active.controller.abort();
  }

  async getStatus(executionId: string): Promise<RuntimeExecutionStatus> {
    return this.executions.get(executionId)?.status ?? "failed";
  }

  observe(
    agentName: string,
    conversationId: string,
    onEvent: (event: RuntimeEvent) => void,
    signal: AbortSignal
  ): void {
    let busy = false;
    const publish = async () => {
      if (busy || signal.aborted) return;
      busy = true;
      try {
        const data = await this.snapshot(agentName, conversationId);
        onEvent({ type: "history", timestamp: new Date().toISOString(), offset: data.offset ?? null, data });
      } catch {
        // A missing or restarting session is retried by the next presentation poll.
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void publish(), 500);
    signal.addEventListener("abort", () => clearInterval(timer), { once: true });
    void publish();
  }

  async purgeConversation(agentName: string, conversationId: string): Promise<void> {
    const response = await this.request(this.url(agentName, conversationId), this.options({ method: "DELETE" }));
    if (response.ok || response.status === 404) return;
    throw new Error(`DSH delete returned ${response.status}`);
  }

  async history(agentName: string, conversationId: string): Promise<RuntimeEvent | null> {
    try {
      const data = await this.snapshot(agentName, conversationId);
      return {
        type: "history",
        timestamp: new Date().toISOString(),
        offset: data.offset ?? null,
        data
      };
    } catch {
      return null;
    }
  }
}
