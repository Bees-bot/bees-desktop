import { readFile, writeFile } from "node:fs/promises";
import { resolve, isAbsolute, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerConfig } from "./runner.mjs";

const xml = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
const unit = (value) =>
  '"' +
  String(value).replace(/[\\"%]/g, (c) => (c === "%" ? "%%" : "\\" + c)) +
  '"';
export function serviceFile(platform, configPath, node = process.execPath) {
  if (!isAbsolute(configPath) || /[\r\n\x00]/.test(configPath + node))
    throw Error("Use an absolute configuration path");
  const script = join(dirname(fileURLToPath(import.meta.url)), "runner.mjs");
  if (platform === "darwin")
    return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>bot.bees.runner</string><key>ProgramArguments</key><array>${[node, script, configPath].map((v) => "<string>" + xml(v) + "</string>").join("")}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer></dict></plist>\n`;
  if (platform === "linux")
    return `[Unit]\nDescription=Bees outbound runner\nAfter=network-online.target\n[Service]\nExecStart=${[node, script, configPath].map(unit).join(" ")}\nRestart=on-failure\nRestartSec=10\nUMask=0077\n[Install]\nWantedBy=default.target\n`;
  throw Error(
    "Use runner:start under your service manager on this operating system",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [configPath, output] = process.argv.slice(2);
  if (!configPath || !output)
    throw Error(
      "Usage: runner-service.mjs /absolute/runner.json /path/to/service-file",
    );
  runnerConfig(JSON.parse(await readFile(configPath, "utf8")));
  await writeFile(output, serviceFile(process.platform, configPath), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    "Service file written. Review it, then install it with launchctl or systemctl --user. Execution still requires both local and workspace permission.",
  );
}
