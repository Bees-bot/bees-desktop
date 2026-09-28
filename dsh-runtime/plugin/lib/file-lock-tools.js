import { chmod, copyFile, lstat, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";

/** Publish a finished binary or text file; an interrupted copy never truncates the destination. */
export async function commitFile(source, destination, signal, beforeRename = async () => {}) {
  signal?.throwIfAborted();
  if (source === destination) throw new Error("Generate a separate temporary file before committing it.");
  if (!(await lstat(source)).isFile()) throw new Error("The staged source must be a regular file.");
  const previous = await lstat(destination).catch((error) => { if (error.code !== "ENOENT") throw error; });
  if (previous && !previous.isFile()) throw new Error("The destination must be a regular file.");
  await mkdir(dirname(destination), { recursive: true });
  const directory = await mkdtemp(join(dirname(destination), `.${basename(destination)}.bees-`));
  const temporary = join(directory, "content");
  try {
    await copyFile(source, temporary);
    await chmod(temporary, previous ? previous.mode & 0o777 : 0o600);
    const handle = await open(temporary, "r+");
    try { await handle.sync(); } finally { await handle.close(); }
    await beforeRename(temporary);
    signal?.throwIfAborted();
    await rename(temporary, destination);
  } finally {
    // A cleanup failure after publication must not turn a successful write into a failed retry.
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

const output = {
  schema: { type: "object", additionalProperties: false, properties: { result: { type: "string", required: true } } },
  render: (_args, value) => [{ type: "text", text: value.result }]
};

export const FILE_LOCK_INSTRUCTIONS = "For adding text to a file, prefer bees_append_file: it locks, reads, appends atomically and releases within one call. For other file changes, acquire all destination paths together with bees_acquire_file_locks, read their current contents, then write/edit and immediately release the returned token with bees_release_file_locks, including after errors. Release before delegating, waiting or asking a person. Earlier reads are stale after acquiring or reacquiring a lock. For generated binary files, hold the destination lock, generate a unique separate temporary file, wait for completion, then publish with bees_commit_file and release. Never write shared destinations directly from shell jobs or filesystem MCPs. Read-only inspection needs no lock.";

export function mountFileLocks(ctx, owner, locks, fs = ctx.fs, sandboxPolicy = ctx.get?.("sandboxPolicy")) {
  const resolve = (path, exec) => fs.resolve(path, { cwd: exec.agent.session.header.cwd, signal: exec.signal });
  const own = (exec) => { if (exec.agent !== owner) throw new Error("File lock tools belong to the calling agent only."); };
  ctx.tools.register(defineTool({
    name: "bees_append_file",
    description: "Append exact text to a UTF-8 file in one operation: acquire its lock, read the latest contents, write atomically, and release even after failure. Preserves other agents' entries. Creates the file if missing; include any needed newline in content. No separate lock or read is needed. If you already hold only this file's lock, it is reused and released; release other locks first. This does not grant extra filesystem permissions.",
    parameters: {
      file_path: { type: "string", required: true, description: "File path relative to this run, or a permitted absolute path." },
      content: { type: "string", required: true, description: "Text to append, including separators. Empty text can initialize a missing file." }
    },
    output,
    execute: async ({ file_path, content }, exec) => {
      own(exec);
      if (typeof file_path !== "string" || !file_path.trim() || typeof content !== "string")
        throw new Error("Supply a file_path and text content.");
      let target = await resolve(file_path, exec);
      const policy = sandboxPolicy?.resolve({ session: exec.agent.session });
      if (fs.sandboxMode !== undefined) {
        if (typeof fs.checkedTarget !== "function" || !policy) throw new Error("Atomic append is unavailable for this filesystem backend.");
        target = await fs.checkedTarget(target, policy);
      }
      const held = locks.owners.get(owner);
      const { token } = held?.held && !held.closing && held.paths.length === 1 && held.paths[0] === target.targetKey
        ? held : await locks.acquire(owner, [target.targetKey], exec.signal);
      try {
        return await locks.use(owner, target.targetKey, async () => {
          const info = await fs.stat(target, exec.signal);
          if (info && (info.type !== "file" || !info.version)) throw new Error("Append requires a regular file with a freshness version.");
          const before = info ? await fs.readText(target, exec.signal) : "";
          const intent = info ? { kind: "replaceIfVersion", version: info.version } : { kind: "createIfAbsent" };
          const result = await fs.writeText(target, before + content, intent, exec.signal, policy);
          ctx.emit("fs/observed", target, { kind: "present", version: result.version }, exec);
          return { result: JSON.stringify({ path: target.displayPath, appended_chars: Array.from(content).length, operation: result.operation }) };
        });
      } finally { await locks.release(owner, token); }
    }
  }));
  ctx.tools.register(defineTool({
    name: "bees_acquire_file_locks",
    description: "Request exclusive access to files before reading them for modification. Pass every file needed together. Waits up to 30 seconds; a timeout never takes another live agent's lock. Returns a token for bees_release_file_locks. Re-read existing files after acquisition. Locks do not grant filesystem permissions.",
    parameters: { paths: { type: "array", items: { type: "string" }, required: true, description: "File paths relative to this run, or permitted absolute file paths." } },
    output,
    execute: async ({ paths }, exec) => {
      own(exec);
      if (!Array.isArray(paths) || !paths.length || paths.some((path) => typeof path !== "string" || !path.trim()))
        throw new Error("Supply a nonempty list of file paths.");
      const targets = await Promise.all(paths.map((path) => resolve(path, exec)));
      for (const target of targets) {
        const info = await fs.stat(target, exec.signal);
        if (info && info.type !== "file") throw new Error("Lock individual files, not directories.");
      }
      return { result: JSON.stringify(await locks.acquire(owner, targets.map((target) => target.targetKey), exec.signal)) };
    }
  }));
  ctx.tools.register(defineTool({
    name: "bees_release_file_locks",
    description: "Release this agent's entire file lock set after its file work is finished. Also release after an error, before delegating or waiting for another agent, or before requesting a different set. Never release while a shell job is still preparing the file.",
    parameters: { token: { type: "string", required: true } },
    output,
    execute: async ({ token }, exec) => {
      own(exec);
      await locks.release(owner, token);
      return { result: "File locks released." };
    }
  }));
  ctx.tools.register(defineTool({
    name: "bees_commit_file",
    description: "Atomically replace a locked destination with a completed staged file of any format. Acquire the destination lock before reading/generating an update; make scripts write a unique separate temporary file, wait for them to finish, then call this tool. The source is kept. Release the lock afterwards. This does not grant extra filesystem permissions.",
    parameters: {
      file_path: { type: "string", required: true, description: "Locked destination path." },
      source_path: { type: "string", required: true, description: "Completed temporary source file, distinct from the destination." }
    },
    output,
    execute: async ({ file_path, source_path }, exec) => {
      own(exec);
      let target = await resolve(file_path, exec);
      const source = await resolve(source_path, exec);
      // Preserve the same sandbox fence as native write/edit; never fall back to an unfenced write.
      if (fs.sandboxMode !== undefined) {
        if (typeof fs.checkedTarget !== "function" || !sandboxPolicy) throw new Error("Atomic file publication is unavailable for this filesystem backend.");
        target = await fs.checkedTarget(target, sandboxPolicy.resolve({ session: exec.agent.session }));
      }
      return locks.use(owner, target.targetKey, async () => {
        await commitFile(fs.processPath(source), fs.processPath(target), exec.signal);
        const info = await fs.stat(target, exec.signal);
        if (info) ctx.emit("fs/observed", target, { kind: "present", version: info.version }, exec);
        return { result: `Published ${target.displayPath}.` };
      });
    }
  }));

  // Observe only reads started while holding the lock, never a stale read that finishes later.
  const protectedCalls = new WeakMap();
  ctx.on("fs/observed", (target, _observation, exec) => {
    if (exec?.agent === owner) protectedCalls.get(exec)?.observed.add(target.targetKey);
  });
  ctx.on("tools/execute", async (exec, next) => {
    if (exec.agent !== owner) return next();
    const held = locks.owners.get(owner);
    // A waiting tool keeps the agent running, so idle cleanup cannot break a parent/peer deadlock.
    if (held && ["bees_delegate_work", "bees_revise_work", "bees_resolve_failed_work", "bees_wait_for_peers",
      "ask_user_question", "bees_ask_team", "bees_request_work_review", "bees_publish_outputs",
      "bees_submit_stage_result"].includes(exec.name))
      throw new Error(`Finish your file work and call bees_release_file_locks with ${JSON.stringify({ token: held.token })} before ${exec.name}. Holding file locks while delegating or waiting can block the agents you are waiting for.`);
    const editor = exec.name === "str_replace_editor";
    const write = ["write", "edit"].includes(exec.name) || editor && exec.arguments.command !== "view";
    if (!write && !["read", "read_image"].includes(exec.name) && !editor) return next();
    const target = await resolve(editor ? exec.arguments.path : exec.arguments.file_path, exec);
    if (!write && (!held?.held || held.closing || !held.paths.includes(target.targetKey))) return next();
    return locks.use(owner, target.targetKey, async (record) => {
      if (write && !record.observed.has(target.targetKey) && await fs.stat(target, exec.signal))
        throw new Error("Read the current file after acquiring its lock before modifying it; earlier reads may be stale.");
      protectedCalls.set(exec, record);
      try { return await next(); }
      finally { protectedCalls.delete(exec); }
    });
  });
  ctx.systemPrompt.section({
    name: "bees:file-locks", order: 5,
    text: FILE_LOCK_INSTRUCTIONS
  });
}
