/** Stop a sidecar when Bees exits, including hard exits that cannot run Rust destructors. */
export function bindParentLifecycle(stop) {
  let stopping = false;
  const shutdown = (code) => {
    if (stopping) return;
    stopping = true;
    void (async () => stop(code))().catch(() => process.exit(1));
  };

  process.once("SIGINT", () => shutdown(130));
  process.once("SIGTERM", () => shutdown(143));
  process.once("disconnect", () => shutdown(0));
  if (process.env.BEES_PARENT_PIPE === "1") {
    process.stdin.resume();
    process.stdin.once("end", () => shutdown(0));
    process.stdin.once("error", () => shutdown(1));
  }
}
