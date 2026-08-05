import { startFlueNodeServer } from "./dist/app.mjs";

const lifecycle = await startFlueNodeServer({
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  hostname: "127.0.0.1"
});

async function stop(code) {
  setTimeout(() => process.exit(code), 60_000).unref();
  await lifecycle.stop();
  process.exit(code);
}

process.on("SIGINT", () => void stop(130));
process.on("SIGTERM", () => void stop(143));
process.on("disconnect", () => void stop(0));
