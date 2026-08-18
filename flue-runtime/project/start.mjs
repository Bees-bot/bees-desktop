import { startFlueNodeServer } from "./dist/app.mjs";
import { bindParentLifecycle } from "./parent-lifecycle.mjs";

const lifecycle = await startFlueNodeServer({
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  hostname: "127.0.0.1"
});

async function stop(code) {
  setTimeout(() => process.exit(code), 60_000).unref();
  await lifecycle.stop();
  process.exit(code);
}

bindParentLifecycle(stop);
