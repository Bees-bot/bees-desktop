import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { target: "es2023", minify: false, sourcemap: true }
});
