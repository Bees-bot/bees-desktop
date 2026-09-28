import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { constants, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument, isSeq } from "yaml";
import { z } from "zod";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";

const id = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/);
const label = z.string().min(1).max(200);
const widget = z.object({ kind: id, x: z.number().int().min(0).max(11), y: z.number().int().min(0).max(1000),
  w: z.number().int().min(1).max(12), h: z.number().int().min(1).max(100) }).strict()
  .refine((w) => w.x + w.w <= 12, "Widget exceeds the grid width");
const layout = z.array(widget).max(30).refine((rows) => new Set(rows.map((r) => r.kind)).size === rows.length, "Duplicate widget");
const model = z.object({ id: label, name: label.optional(), contextWindow: z.number().int().positive().optional(), maxTokens: z.number().int().positive().optional() }).strict();
const https = z.string().url().max(2000).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash &&
    ![...url.searchParams.keys()].some((key) => /token|key|secret|password|signature|credential/i.test(key));
}, "Use a public HTTPS URL without credentials");
const catalogModel = z.object({ id, name: label, fileName: z.string().regex(/^[a-zA-Z0-9._-]+\.gguf$/),
  url: https, bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  runsProcesses: z.boolean().optional() }).strict();
const uniqueModels = z.array(catalogModel).max(100).refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, "Duplicate model id");
const preferences = {
  localModelCatalog: uniqueModels,
  themePreset: id, colorMode: z.enum(["dark", "light"]), darkThemePreset: id, lightThemePreset: id,
  dashboards: z.array(z.object({ id, name: label, widgets: layout }).strict()).min(1).max(20)
    .refine((rows) => rows.some((r) => r.id === "home") && new Set(rows.map((r) => r.id)).size === rows.length, "Keep a unique Home dashboard"),
  workItemLayout: layout, pageLayouts: z.record(id, layout),
  systemInstructions: z.string().max(20000),
  codexModels: z.array(model).max(100), generalAiModels: z.record(id, z.array(model).max(100)),
  generalAiProviders: z.array(id).max(100), freeAiProviders: z.array(id).max(100)
};
const provider = z.object({ displayName: label.optional(), api: id.optional(),
  baseURL: z.union([https, z.literal("http://127.0.0.1:1234/v1")]).optional(),
  apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]+$/).optional(),
  headers: z.object({ authorization: z.literal("Bearer local") }).strict().optional(),
  models: z.array(model).max(100).optional() }).strict();
const schemas = {
  bees: preferences,
  "ui-chat": { transcriptView: z.enum(["compact", "standard", "detailed", "verbose"]) },
  "agent-default-model": { selection: z.object({ provider: id, model: label, reasoningEffort: z.string().max(60).optional() }).strict() },
  "llm-pi-ai": { providers: z.record(id, provider) },
  "bees-subscriptions": { models: z.array(label).min(1).max(50) }
};
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const revisionOf = (text) => createHash("sha256").update(text).digest("hex");

// Edit only data in the existing shipped profile. JS tags elsewhere in the file
// remain inert scalars, and the YAML document preserves comments and unrelated entries.
function documentOf(text) {
  const doc = parseDocument(text, { customTags: [{ tag: "tag:yaml.org,2002:js", resolve: (value) => value }] });
  if (doc.errors.length || !isSeq(doc.contents)) fail("The shipped configuration is not valid YAML");
  return doc;
}
function entryPath(doc, id) {
  for (let i = 0; i < doc.contents.items.length; i++) {
    if (doc.getIn([i, "id"]) === id) return [i, "config"];
    const inserted = doc.getIn([i, "insert"]);
    if (isSeq(inserted)) for (let j = 0; j < inserted.items.length; j++)
      if (doc.getIn([i, "insert", j, "id"]) === id) return [i, "insert", j, "config"];
  }
  fail(`Missing shipped configuration for ${id}`);
}
function snapshot(text) {
  const doc = documentOf(text);
  const values = {};
  for (const [namespace, fields] of Object.entries(schemas)) {
    const path = entryPath(doc, namespace);
    const config = doc.getIn(path)?.toJSON() ?? {};
    values[namespace] = namespace === "agent-default-model" ? { selection: config }
      : Object.fromEntries(Object.keys(fields).map((key) => [key, config[key]]));
  }
  return { revision: revisionOf(text), values };
}

export const shippedModelCatalog = snapshot(
  readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8")
).values.bees.localModelCatalog;

export class ProductDefaults {
  constructor(connected, root = process.env.BEES_PRODUCT_SOURCE) {
    this.connected = connected;
    this.root = root;
    this.path = root ? join(root, "dsh-runtime/plugin/cordis.patch.yml") : null;
  }
  async authorize(accountUserId) {
    if (!accountUserId || !this.connected.account(accountUserId)?.enabled) fail("Platform administrator access required", 403);
    const me = await this.connected.request("/api/me", { accountUserId, timeoutMs: 5000 });
    if (me.isPlatformAdmin !== true || me.user?.id !== accountUserId || !this.connected.account(accountUserId)?.enabled)
      fail("Platform administrator access required", 403);
  }
  async editable() {
    if (!this.path) return false;
    try {
      const pkg = JSON.parse(await readFile(join(this.root, "package.json"), "utf8"));
      if (pkg.name !== "@bees/desktop") return false;
      await access(this.path, constants.W_OK);
      return true;
    } catch { return false; }
  }
  async status() {
    const candidates = this.connected.accounts().filter((a) => a.enabled);
    const checks = await Promise.allSettled(candidates.map(async (a) => { await this.authorize(a.userId); return a; }));
    const account = checks.find((r) => r.status === "fulfilled")?.value;
    if (!account) return { isPlatformAdmin: false };
    const editable = await this.editable();
    return { isPlatformAdmin: true, accountUserId: account.userId, editable,
      ...(editable ? snapshot(await readFile(this.path, "utf8")) : {}) };
  }
  async update({ accountUserId, namespace, key, value, revision }) {
    await this.authorize(accountUserId);
    if (!await this.editable()) fail("Open the Bees development checkout to edit product defaults");
    const schema = Object.hasOwn(schemas, namespace) && Object.hasOwn(schemas[namespace], key) && schemas[namespace][key];
    if (!schema) fail("This setting is personal and cannot be shipped as a product default", 400);
    const parsed = schema.safeParse(value);
    if (!parsed.success) fail(`Invalid product default: ${parsed.error.issues[0].message}`, 400);
    return withFileLock(this.path, async () => {
      const text = await readFile(this.path, "utf8");
      if (revision !== revisionOf(text)) fail("Product defaults changed elsewhere. Turn editing off and on to reload them");
      const doc = documentOf(text);
      const path = entryPath(doc, namespace);
      doc.setIn(key === "selection" ? path : [...path, key], parsed.data);
      const next = doc.toString({ lineWidth: 0 });
      const result = snapshot(next);
      const selected = result.values["agent-default-model"].selection;
      const localModels = result.values.bees.localModelCatalog;
      if ((selected.provider === "local-openai" && !localModels.length) ||
        (selected.provider.startsWith("local-openai-") && !localModels.some(
          (m) => `local-openai-${m.id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}` === selected.provider)) ||
        (selected.provider === "claude-code" && !result.values["bees-subscriptions"].models.includes(selected.model)))
        fail("Choose another product default model before removing this model");
      await writeFileAtomic(this.path, next, { mode: 0o644 });
      return result;
    });
  }
}
