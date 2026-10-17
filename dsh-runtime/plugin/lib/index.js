import z from "@deepseek-ai/schemastery";
import { applyThreadProduct } from "./thread-product.js";

export const name = "bees";
export const inject = ["webServer", "connection", "agents", "agentPresets", "sessionPersistence", "approval", "settings", "credentials", "agentDefaultModel", "llm", "skills", "tools", "userQuestions", "sessions", "web", "attachments", "jobs", "fs"];

const ModelPreference = z.object({
  id: z.string(),
  name: z.string(),
  contextWindow: z.number(),
  maxTokens: z.number()
});

export const Config = z.object({
  localModels: z.array(z.object({
    id: z.string().required(),
    name: z.string().required(),
    fileName: z.string(),
    url: z.string(),
    localPath: z.string(),
    bytes: z.natural().default(0),
    sha256: z.string(),
    contextSize: z.natural()
  })).default([]).volatile(),
  localModelWantedIds: z.array(z.string()).default([]).volatile(),
  themePreset: z.string().default("corporate").volatile(),
  colorMode: z.string().default("light").volatile(),
  darkThemePreset: z.string().default("halloween").volatile(),
  lightThemePreset: z.string().default("corporate").volatile(),
  organizationColors: z.dict(z.string()).default({}).volatile(),
  generalAiProviders: z.array(z.string()).default([]).volatile(),
  generalAiModels: z.dict(z.array(ModelPreference)).default({}).volatile(),
  codexModels: z.array(ModelPreference).default([]).volatile(),
  externalLocalAiProfile: z.object({
    displayName: z.string(),
    api: z.string(),
    baseURL: z.string(),
    models: z.array(ModelPreference).default([])
  }).default({}).volatile()
});

export async function apply(ctx, config = {}) {
  await applyThreadProduct(ctx, config);
}
