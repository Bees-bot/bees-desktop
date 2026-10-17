import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(process.argv[2] || resolve(root, "dist/hosted"));
const runtimeRequire = createRequire(resolve(root, "dsh-runtime/package.json"));
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: {
    app: resolve(root, "dsh-runtime/plugin/client/hosted-entry.js"),
  },
  outdir,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  nodePaths: [resolve(root, "dsh-runtime/node_modules")],
  loader: {
    ".png": "dataurl",
    ".woff": "file",
    ".woff2": "file",
    ".ttf": "file",
  },
  publicPath: "/app/assets",
  minify: true,
  legalComments: "external",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "one-react-renderer",
      setup(build) {
        build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => ({
          path: runtimeRequire.resolve(args.path),
        }));
      },
    },
    {
      name: "desktop-style-text",
      setup(build) {
        build.onLoad(
          { filter: /(?:gridstack\.min|cron-builder)\.css$/ },
          async (args) => ({
            contents: await readFile(args.path, "utf8"),
            loader: "text",
          }),
        );
      },
    },
  ],
});
await writeFile(
  resolve(outdir, "source.json"),
  JSON.stringify({
    package: "@bees/desktop",
    entry: "dsh-runtime/plugin/client/thread-app.js",
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    dirty: Boolean(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
    ),
  }) + "\n",
);
