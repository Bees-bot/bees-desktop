import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
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
