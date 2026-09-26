# Agent file access

Bees agents share a file-lock manager, independent of the process definition.
The protocol is:

1. Call `bees_acquire_file_locks` with every destination path needed for this operation.
2. Read existing files again after acquisition. Reads made before acquiring the lock do not authorize an update.
3. Use native `write`/`edit` tools. These already stage, sync and atomically publish their replacements.
4. Call `bees_release_file_locks` with the returned token, including after an error.

For generated files of any format, acquire the destination lock before reading or generating an update. Have the generator write to a unique separate temporary file, wait for it to finish, and use `bees_commit_file` with `source_path` and `file_path`. It copies into a private staging directory beside the destination, syncs the complete file, and renames it over the destination. It retains the source and preserves existing destination permissions. Release the lock afterwards.

The native file-tool boundary rejects writes without ownership and requires a fresh read for existing text files. Read-only inspection remains available without a lock. Locking does not grant filesystem access: existing run-path approval and sandbox policies still apply, including to the staged source.

Canonical paths identify locks, so symlink aliases coordinate. Each agent can own one set at a time; sorting the complete set avoids circular waits. Different files remain independent. Acquisition waits up to 30 seconds under contention and can be cancelled. A timeout fails the request, never evicting a live holder. Release waits for in-flight protected operations to finish. Idle/disposed agents release their locks automatically; resumed agents must acquire again.

The existing DSH cross-process lock primitive coordinates runtime processes on the same machine that use the same `BEES_APP_DATA/file-locks` directory. It reclaims locks only when the recorded process is proven gone. It is not a distributed lock for different machines/PID namespaces. A malformed lock record or reused PID is conservatively left locked for investigation.

Shell commands, external applications, filesystem MCP tools, and other direct filesystem writers can bypass these advisory locks. Agents are instructed to use those tools only for separate staged outputs and publish through the protected tool. This mechanism does not sandbox arbitrary writers. Each replacement is atomic individually; a group of files is not a transaction. A hard kill can leave a hidden staging directory, but does not publish its incomplete contents. Atomic replacement does not promise persistence through power loss.

Run `npm run check:file-locks` (also included in `npm run check`). The regression suite exercises parallel read–modify–write operations, multiple-file acquisition, aliases, ownership, cancellation, release during a write, binary publication, sandbox denial, and process death before rename with lock recovery.
