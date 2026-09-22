// DSH 0.1.7-alpha.1 rebuilds every browser bundle after each plugin activation.
// Batch those activations until appReady; an early graph/page request still
// flushes immediately, and hot reload keeps its normal microtask behavior.
export function batchDshClientModules(source) {
  const replacements = [
    ['\t\tsuper(ctx, "clientModules");',
      '\t\tsuper(ctx, "clientModules");\n\t\tconst appReady = ctx.get("appReady");\n\t\tlet booting = appReady !== void 0;'],
    ['\t\t\tif (this.flushQueued) return;',
      '\t\t\tif (booting || this.flushQueued) return;'],
    ['\t\tif (failures.length > 0) throw new ClientPackageCompositionError(failures);',
      '\t\tif (failures.length > 0) throw new ClientPackageCompositionError(failures);\n\t\tif (appReady) ctx.effect(() => appReady.onReady(() => {\n\t\t\tbooting = false;\n\t\t\tthis.flush((err) => ctx.logger.warn(err));\n\t\t}), "client-modules: startup batch");'],
    ['\t\t\ttable.push(...bootInjections(this.composed));',
      '\t\t\ttable.push(...bootInjections(this.graph()));'],
    ['\tgraph() {\n\t\treturn this.composed;',
      '\tgraph() {\n\t\tthis.flush((err) => this.ctx.logger.warn(err));\n\t\treturn this.composed;']
  ];
  for (const [before, after] of replacements) {
    if (source.includes(after)) continue;
    if (source.split(before).length !== 2)
      throw new Error("DSH client startup batch patch no longer matches its pinned package");
    source = source.replace(before, after);
  }
  return source;
}
