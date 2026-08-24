import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [resolve(root, "dsh-runtime", "plugin", "client", "index.js")],
  outfile: resolve(root, "dsh-runtime", "plugin", "lib", "client.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  charset: "utf8",
  legalComments: "none"
});
