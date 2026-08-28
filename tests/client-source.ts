import { readFileSync, readdirSync } from "node:fs";

const clientDirectory = new URL("../dsh-runtime/plugin/client/", import.meta.url);

export const clientBundle = readFileSync(
  new URL("../dsh-runtime/plugin/lib/client.js", import.meta.url), "utf8"
);

// Read the directory rather than listing the files: a hand-written list silently drops a new
// client file out of every assertion below, which is how icons.js and skills.js went uncovered.
export const clientSource = readdirSync(clientDirectory)
  .filter((file) => file.endsWith(".js"))
  .sort()
  .map((file) => readFileSync(new URL(file, clientDirectory), "utf8"))
  .join("\n");
