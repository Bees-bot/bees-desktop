#!/usr/bin/env bash
# Starts an installed engine on an empty home the way the app does, then waits for /healthz.
# usage: install-check-boot.sh <folder with bees-node> <dsh-runtime folder>
set -euo pipefail
win() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }
BIN=$(win "$1") RT=$(win "$2") C=$(win "${RUNNER_TEMP:-/tmp}/bees-home")
X=; [ -f "$BIN/bees-node.exe" ] && X=.exe
mkdir -p "$C/dsh" "$C/dsh-state" "$C/workspaces" "$C/temporal"
cat > "$C/prep.cjs" <<'EOF'
// same profile prepare_profile in src-tauri/src/lib.rs builds
const fs = require('fs'), path = require('path'), [rt, home] = process.argv.slice(2);
const prof = path.join(home, 'profiles', 'bees');
fs.mkdirSync(prof, { recursive: true });
fs.copyFileSync(path.join(rt, 'profile', 'package.json'), path.join(prof, 'package.json'));
fs.writeFileSync(path.join(prof, 'cordis.patch.yml'), '[]\n');
fs.writeFileSync(path.join(home, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n');
for (const p of ['@deepseek-ai/dsh-experimental-client-ui-agent-team', '@deepseek-ai/dsh-experimental-agent-team',
  '@deepseek-ai/dsh-experimental-tool-agent-team', '@bees/dsh-plugin', '@bees/dsh-local-ai', '@bees/dsh-free-ai',
  '@bees/dsh-custom-ai', '@bees/dsh-subscriptions']) {
  const d = path.join(prof, 'node_modules', p);
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.symlinkSync(fs.realpathSync(path.join(rt, 'node_modules', p)), d, 'junction');
}
fs.writeFileSync(path.join(path.dirname(home), 'device-id'), require('crypto').randomUUID());
EOF
"$BIN/bees-node$X" "$C/prep.cjs" "$RT" "$C/dsh"

"$BIN/temporal$X" server start-dev --headless --ip 127.0.0.1 --port 7233 --db-filename "$C/temporal/p.db" \
  --disable-config-file --disable-config-env > "$C/temporal.log" 2>&1 &
for _ in $(seq 60); do (echo > /dev/tcp/127.0.0.1/7233) 2>/dev/null && break; sleep 1; done

cd "$C/workspaces"
DSH_HOME="$C/dsh" DSH_TELEMETRY_DISABLED=1 BEES_DSH_TOKEN=install-check \
BEES_DSH_QUERY_PATH="$C/dsh/session-query.sqlite" BEES_DATABASE_PATH="$C/bees-stage1.db" \
BEES_DATA_DIR="$C" BEES_APP_DATA="$C" BEES_DEFAULT_WORKSPACE="$C/workspaces" BEES_STATE_DIR="$C/dsh-state" \
BEES_STARTUP_LOG="$C/dsh-state/startup.log" BEES_RUNTIME_ROOT="$RT" BEES_TEMPORAL_ADDRESS=127.0.0.1:7233 \
  "$BIN/bees-node$X" --max-http-header-size=65536 "$RT/start.mjs" --profile bees --host 127.0.0.1 \
  --port 4317 --no-open > "$C/dsh.log" 2>&1 &

for _ in $(seq 180); do
  if curl -s http://127.0.0.1:4317/healthz | grep -q '"product":"bees"'; then
    echo "healthz ok: $(curl -s http://127.0.0.1:4317/healthz)"; exit 0
  fi
  sleep 1
done
echo "::error::engine never answered /healthz"
tail -n 60 "$C/temporal.log" "$C/dsh.log" "$C/dsh-state/startup.log" 2>/dev/null || true
exit 1
