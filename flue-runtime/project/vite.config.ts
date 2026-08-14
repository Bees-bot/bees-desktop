import { flue } from "@flue/vite";
import { defineConfig } from "vite";

// Replaces bees.config.mjs. Flue 2 has no `flue dev`/`flue build` of its own: the desktop
// host runs plain `vite dev` with this project as the root, and `@flue/vite` scans the
// `'use agent'` modules, wires the persistence entry, and serves `app.ts`.
export default defineConfig({
  plugins: [
    flue({
      target: "node",
      // Only providers Bees actually ships. Omitting this would bundle every pi-ai
      // built-in into the sidecar. Custom providers (bees-local, the CLI shims) are
      // registered with setProvider() in app.ts and are unaffected by this list.
      providers: [
        "anthropic",
        "cerebras",
        "deepseek",
        "fireworks",
        "google",
        "groq",
        "mistral",
        "openai",
        "openrouter",
        "opencode-go",
        "together",
        "xai"
      ]
    })
  ],
  build: { sourcemap: false },
  // The runtime writes its SQLite DB under BEES_STATE_DIR and node_modules is a symlink to
  // the bundled deps — neither is source. Watching them makes the dev server reload in a
  // loop (every DB write retriggers a reload), so exclude them from the file watcher.
  server: {
    cors: false,
    watch: { ignored: ["**/runtime/**", "**/node_modules/**"] }
  }
});
