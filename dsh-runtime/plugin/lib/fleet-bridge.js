import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class FleetBridge {
  pending = new Map();
  messages = new Map();
  constructor(ctx, product) {
    this.product = product;
    ctx.on(
      "user-questions/request",
      (request, next) => {
        if (!request.agent) return next();
        const id = randomUUID();
        return new Promise((resolve, reject) => {
          const stop = () => {
            this.pending.delete(id);
            reject(Error("Run stopped while waiting for an answer"));
          };
          request.signal?.addEventListener("abort", stop, { once: true });
          this.pending.set(id, {
            id,
            questions: request.questions,
            resolve: (answer) => {
              request.signal?.removeEventListener("abort", stop);
              this.pending.delete(id);
              resolve(answer);
            },
          });
          if (request.signal?.aborted) stop();
        });
      },
      { prepend: true },
    );
    ctx.on(
      "approval/request",
      async (request, next) => {
        if (!request.agent) return next();
        const result = await ctx.userQuestions.ask({
          agent: request.agent,
          signal: request.signal,
          questions: [
            {
              id: "approval",
              question: `Approve ${request.toolName} once?\n${request.reason ?? ""}`,
              options: [{ label: "Approve once" }, { label: "Reject" }],
            },
          ],
        });
        return result.answers
          .find((a) => a.id === "approval")
          ?.selected.includes("Approve once")
          ? "allowed-once"
          : "rejected";
      },
      { prepend: true },
    );
    ctx.effect(() => () => {
      for (const p of this.pending.values()) p.resolve({ answers: [] });
      this.pending.clear();
    });
  }
  questions() {
    return {
      questions: [...this.pending.values()].map(({ id, questions }) => ({
        id,
        questions,
      })),
    };
  }
  answer(input) {
    const p = this.pending.get(input.questionId);
    if (!p) throw Error("Question is no longer waiting");
    const provided =
      input.answers ??
      (p.questions.length === 1
        ? [{ id: p.questions[0].id, text: input.text }]
        : null);
    if (!Array.isArray(provided) || provided.length !== p.questions.length)
      throw Error("Answer each question separately");
    const answers = p.questions.map((q) => {
      const matches = provided.filter((a) => a?.id === q.id),
        text = matches[0]?.text;
      if (
        matches.length !== 1 ||
        typeof text !== "string" ||
        !text.trim() ||
        text.length > 20000
      )
        throw Error("Provide an answer to each question");
      return {
        id: q.id,
        selected: (q.options ?? []).some((o) => o.label === text) ? [text] : [],
        custom: text,
      };
    });
    p.resolve({ answers });
    return { accepted: true };
  }
  async create(input) {
    const p = this.product;
    const item = await p.command({
      action: "create_item",
      processId: input.processId,
      agentAssignmentId: input.agentId,
      title: input.title,
      description: input.description,
      idempotencyKey: `proposal:fleet:${process.env.BEES_FLEET_JOB}`,
    });
    const directory = join(p.workContext.directory(item.id), "inputs");
    await mkdir(directory, { recursive: true });
    this.item = item;
    this.directory = directory;
    return item;
  }
  async input(artifact) {
    if (!this.directory)
      throw Error("Create the work item before transferring inputs");
    if (
      typeof artifact.name !== "string" ||
      !artifact.name ||
      /[\/\\\x00-\x1f]/.test(artifact.name) ||
      [".", ".."].includes(artifact.name)
    )
      throw Error("Unsafe input filename");
    const bytes = Buffer.from(artifact.content, "base64");
    if (bytes.length > 10000000) throw Error("Input exceeds 10 MB");
    await writeFile(join(this.directory, artifact.name), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    return { accepted: true };
  }
  async start() {
    if (!this.item) throw Error("Create the work item first");
    await this.product.command({ action: "start_item", itemId: this.item.id });
    return this.item;
  }
  async prompt(input) {
    if (this.messages.has(input.requestId)) return this.messages.get(input.requestId);
    const task = (async () => {
      const snapshot = await this.product.snapshot();
      const run = snapshot.runs.find(r => r.workItemId === this.item?.id && ["running", "waiting_for_input", "waiting_for_approval"].includes(r.status));
      if (!run) throw Error("This stage is no longer accepting messages");
      await this.product.command({ action: "continue_run", executionId: run.id, text: input.text });
      return { accepted: true };
    })();
    this.messages.set(input.requestId, task);
    return task;
  }
}
