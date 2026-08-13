import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { harnessPlugin } from "./dev/harness/plugin.mjs";

export default defineConfig({
  // harnessPlugin() is null unless BEES_HARNESS=1, so `tauri dev` and every build are untouched.
  plugins: [tailwindcss(), harnessPlugin()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true
  },
  // VITE_ only. TAURI_ here would inline every TAURI_-prefixed build variable into
  // the shipped frontend bundle, and TAURI_SIGNING_PRIVATE_KEY is one of those.
  envPrefix: ["VITE_"],
  build: {
    target: "es2023",
    minify: false,
    sourcemap: true
  }
});
