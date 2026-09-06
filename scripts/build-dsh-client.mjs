import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const client = resolve(root, "dsh-runtime", "plugin", "client");

await build({
  entryPoints: [resolve(root, "dsh-runtime", "plugin", "client", "index.js")],
  outfile: resolve(root, "dsh-runtime", "plugin", "lib", "client.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  loader: { ".css": "text", ".png": "dataurl" },
  plugins: [{
    name: "dsh-react-singleton",
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: resolve(client, "react-shim.js") }));
      build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: resolve(client, "react-jsx-runtime-shim.js") }));
    }
  }],
  target: "es2022",
  charset: "utf8",
  legalComments: "none"
});
