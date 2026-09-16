// Small, checked patches for the pinned DSH version, reapplied during installation.
// Wrapping the existing expression preserves its dependencies and execution order.
export function timeDshStartup(source, replacements) {
  for (const [before, after] of replacements) {
    if (source.includes(after)) continue;
    if (source.split(before).length !== 2)
      throw new Error("DSH startup timing patch no longer matches its pinned package");
    source = source.replace(before, after);
  }
  return source;
}

const timed = (phase, expression) =>
  `(globalThis.__beesStartup?.step ?? ((_phase, run) => run()))(${JSON.stringify(phase)}, () => ${expression})`;

export const bootTimings = [
  ["const ctx = new Context();\n\tlet stage", "const ctx = new Context();\n\tglobalThis.__beesStartup?.observe(ctx);\n\tlet stage"],
  ...[
    ["dsh.loader.init", "ctx.plugin(Loader)"],
    ["dsh.host.prepare", "prepare?.(ctx)"],
    ["dsh.tree.mount", "mountRootInclude(ctx, absoluteConfigPath, patches, bareModuleBaseUrl)"],
    ["dsh.tree.settle", 'ctx.get("loader")?.await()'],
    ["dsh.tree.validate", "assertEntriesActivated(ctx, binName)"]
  ].map(([phase, expression]) => [`await ${expression};`, `await ${timed(phase, expression)};`])
];

export const profileTimings = [
  ["const profile = prepareProfile(name, true, fromDefaultProfile);",
    `const profile = ${timed("dsh.profile.resolve", "prepareProfile(name, true, fromDefaultProfile)")};`],
  ["await healProfilesModuleFallback({\n\t\tinstallAnchor: INSTALL_ANCHOR,\n\t\tprofile\n\t});",
    `await ${timed("dsh.profile.module-fallback", "healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, profile })")};`],
  ["await composeProfile(options.profile, options.patchFiles, options.fromDefaultProfile)",
    `await ${timed("dsh.profile.compose", "composeProfile(options.profile, options.patchFiles, options.fromDefaultProfile)")}`]
];

export const loaderTimings = [[
  '\t\treturn composeError(async (info) => {\n\t\t\tinfo.offset += 3;',
  '\t\tconst beesImport = globalThis.__beesStartup?.step ?? ((_phase, run) => run());\n\t\treturn beesImport(`module.import:${name}`, () => composeError(async (info) => {\n\t\t\tinfo.offset += 3;'
], [
  '\t\t}, getOuterStack);\n\t}\n};',
  '\t\t}, getOuterStack));\n\t}\n};'
]];
