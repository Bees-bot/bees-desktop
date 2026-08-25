import { pathToFileURL } from "node:url";

const server = process.argv[2];
if (!server) throw new Error("The embedded OmniRoute server path is missing");

// The IPC channel closes even if the DSH host crashes, preventing an orphaned
// local server from surviving after Bees exits.
process.once("disconnect", () => process.kill(process.pid, "SIGTERM"));
await import(pathToFileURL(server).href);
