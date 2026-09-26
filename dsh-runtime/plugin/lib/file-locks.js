import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { withFileLock } from "@deepseek-ai/dsh-atomic-write";

const deferred = () => Promise.withResolvers();

/** One lock set per agent; sorted acquisition prevents cycles across any number of files. */
export class FileLocks {
  owners = new Map();

  constructor(directory) { this.directory = directory; }

  async acquire(owner, paths, signal) {
    signal?.throwIfAborted();
    if (this.owners.has(owner)) throw new Error("Release your current file locks before requesting another set. Request all needed files together.");
    const keys = [...new Set(paths)].sort();
    if (!keys.length) throw new Error("Request at least one file lock.");
    const ready = deferred(), released = deferred();
    const record = { token: randomUUID(), paths: keys, observed: new Set(), active: new Set(), closing: false, held: false, released };
    this.owners.set(owner, record);
    const check = () => {
      signal?.throwIfAborted();
      if (record.closing) throw new Error("File lock request cancelled.");
    };
    const deadline = Date.now() + 30_000;
    const hold = async (index) => {
      check();
      if (index === keys.length) {
        record.held = true;
        ready.resolve({ token: record.token, paths: keys });
        return released.promise;
      }
      const path = join(this.directory, createHash("sha256").update(keys[index]).digest("hex"));
      for (;;) {
        check();
        try { return await withFileLock(path, () => hold(index + 1), { waitMs: 250 }); }
        catch (error) {
          // A wait deadline never evicts a live holder. The upstream helper only reclaims dead PIDs.
          if (!error.message.startsWith("atomic-write: timed out waiting for the writer lock") || Date.now() >= deadline) throw error;
        }
      }
    };
    record.done = (async () => {
      try { await mkdir(this.directory, { recursive: true, mode: 0o700 }); await hold(0); }
      catch (error) { ready.reject(error); throw error; }
      finally { this.owners.delete(owner); }
    })();
    record.done.catch(() => {});
    const abort = () => { record.closing = true; released.resolve(); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = await ready.promise;
      check();
      return result;
    } catch (error) {
      abort();
      await record.done.catch(() => {});
      throw error;
    } finally { signal?.removeEventListener("abort", abort); }
  }

  require(owner, path) {
    const record = this.owners.get(owner);
    if (!record?.held || record.closing || !record.paths.includes(path))
      throw new Error(`Acquire ${path} with bees_acquire_file_locks before reading it for modification or writing it.`);
    return record;
  }

  async use(owner, path, operation) {
    const record = this.require(owner, path);
    const pending = Promise.resolve().then(() => operation(record));
    record.active.add(pending);
    try { return await pending; }
    finally { record.active.delete(pending); }
  }

  async release(owner, token) {
    const record = this.owners.get(owner);
    if (!record || record.token !== token) throw new Error("This file lock token does not belong to this agent.");
    record.closing = true;
    // Cancellation requests do not prove an in-flight write stopped. Drain it before unlocking.
    await Promise.allSettled([...record.active]);
    record.released.resolve();
    await record.done;
  }

  async releaseOwner(owner) {
    const record = this.owners.get(owner);
    if (record) await this.release(owner, record.token);
  }
}
