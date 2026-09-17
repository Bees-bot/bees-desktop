import {
  lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { drive } from "@googleapis/drive";
import { OAuth2Client } from "google-auth-library";
import { googleConsent } from "./google-consent.js";
import { json, knowledgeMarkdown, officeMarkdown, stable } from "./document-extractor.js";

const tokenCredential = "BEES_GOOGLE_DRIVE_OAUTH";
const profileCredential = "BEES_GOOGLE_DRIVE_PROFILE";
const requiredScopes = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/forms.body.readonly"
];
export const pointerFormats = {
  ".gdoc": {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileType: "docx", type: "document"
  },
  ".gsheet": {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileType: "xlsx", type: "spreadsheet"
  },
  ".gslides": {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    fileType: "pptx", type: "presentation"
  },
  ".gdraw": { mimeType: "image/svg+xml", type: "drawing" },
  ".gform": { type: "form" }
};
pointerFormats[".gslide"] = pointerFormats[".gslides"];

function pointerId(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > 64_000) return null;
  const value = json(readFileSync(path, "utf8"));
  const direct = value?.doc_id ?? value?.docId ?? value?.file_id ?? value?.fileId;
  if (direct) return String(direct);
  if (value?.resource_id) return String(value.resource_id).split(":").at(-1);
  const match = /\/d\/([a-zA-Z0-9_-]+)/.exec(String(value?.url ?? ""));
  return match?.[1] ?? null;
}

function pointers(location) {
  const paths = [];
  const visit = (path) => {
    let stat;
    try { stat = lstatSync(path); } catch { return; }
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (pointerFormats[extname(path).toLowerCase()]) paths.push(path);
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!entry.name.startsWith(".")) visit(join(path, entry.name));
    }
  };
  visit(location.localPath);
  return paths;
}

function hasExport(path) {
  try {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") return true;
      if (entry.isDirectory() && hasExport(join(path, entry.name))) return true;
    }
  } catch { /* A missing cache is simply unavailable. */ }
  return false;
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function decodeXml(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|apos|gt|lt|quot);/gi, (match, entity) => {
    if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? match;
    const number = Number.parseInt(entity.slice(entity[1]?.toLowerCase() === "x" ? 2 : 1),
      entity[1]?.toLowerCase() === "x" ? 16 : 10);
    try { return Number.isFinite(number) ? String.fromCodePoint(number) : match; } catch { return match; }
  });
}

export function drawingMarkdown(svg, title = "Google Drawing") {
  const text = decodeXml(String(svg ?? "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(?:desc|text|textPath|title|tspan)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split(/\r?\n/).map(clean).filter(Boolean).join("\n");
  return [`# ${clean(title) || "Google Drawing"}`, text].filter(Boolean).join("\n\n");
}

function questionMarkdown(question) {
  const lines = [];
  if (question?.required) lines.push("- Required: yes");
  if (question?.choiceQuestion) {
    const choice = question.choiceQuestion;
    lines.push(`- Response: ${clean(choice.type).toLocaleLowerCase().replaceAll("_", " ") || "choice"}`);
    for (const option of choice.options ?? []) {
      const value = clean(option.value) || (option.isOther ? "Other" : "");
      if (value) lines.push(`  - ${value}`);
    }
  } else if (question?.textQuestion) {
    lines.push(`- Response: ${question.textQuestion.paragraph ? "long text" : "short text"}`);
  } else if (question?.scaleQuestion) {
    const scale = question.scaleQuestion;
    lines.push(`- Response: scale ${scale.low ?? ""}–${scale.high ?? ""}`.trim());
    if (scale.lowLabel) lines.push(`  - ${scale.low}: ${clean(scale.lowLabel)}`);
    if (scale.highLabel) lines.push(`  - ${scale.high}: ${clean(scale.highLabel)}`);
  } else if (question?.dateQuestion) {
    lines.push(`- Response: date${question.dateQuestion.includeTime ? " and time" : ""}${question.dateQuestion.includeYear === false ? " without year" : ""}`);
  } else if (question?.timeQuestion) {
    lines.push(`- Response: ${question.timeQuestion.duration ? "duration" : "time"}`);
  } else if (question?.fileUploadQuestion) {
    const upload = question.fileUploadQuestion;
    lines.push(`- Response: file upload${upload.maxFiles ? `, up to ${upload.maxFiles} files` : ""}`);
    if (upload.types?.length) lines.push(`  - Types: ${upload.types.map(clean).join(", ")}`);
  } else if (question?.ratingQuestion) {
    const rating = question.ratingQuestion;
    const icon = rating.ratingIconType || rating.iconType;
    lines.push(`- Response: rating${rating.ratingScaleLevel ? ` 1–${rating.ratingScaleLevel}` : ""}${icon ? ` (${clean(icon).toLocaleLowerCase()})` : ""}`);
  } else if (question?.rowQuestion) {
    lines.push(`- ${clean(question.rowQuestion.title)}`);
  } else {
    const type = Object.keys(question ?? {}).find((key) => key.endsWith("Question") && question[key]);
    if (type) lines.push(`- Response: ${type.slice(0, -8).replace(/([a-z])([A-Z])/g, "$1 $2").toLocaleLowerCase()}`);
  }
  if (question?.grading?.pointValue !== undefined) lines.push(`- Points: ${question.grading.pointValue}`);
  return lines;
}

export function formMarkdown(form) {
  const info = form?.info ?? {};
  const lines = [`# ${clean(info.title || form?.documentTitle) || "Google Form"}`];
  if (info.description) lines.push("", clean(info.description));
  if (form?.settings?.quizSettings?.isQuiz) lines.push("", "Quiz: yes");
  let question = 0;
  for (const item of form?.items ?? []) {
    const itemTitle = clean(item.title);
    const itemDescription = clean(item.description);
    if (item.pageBreakItem) {
      lines.push("", `## ${itemTitle || "Section"}`);
      if (itemDescription) lines.push("", itemDescription);
      continue;
    }
    if (item.questionItem) {
      question += 1;
      lines.push("", `## ${itemTitle || `Question ${question}`}`);
      if (itemDescription) lines.push("", itemDescription);
      lines.push(...questionMarkdown(item.questionItem.question));
      continue;
    }
    if (item.questionGroupItem) {
      lines.push("", `## ${itemTitle || "Question group"}`);
      if (itemDescription) lines.push("", itemDescription);
      const rows = item.questionGroupItem.questions ?? [];
      if (rows.length) {
        lines.push("", "Rows:");
        for (const row of rows) lines.push(...questionMarkdown(row));
      }
      const columns = item.questionGroupItem.grid?.columns?.options ?? [];
      if (columns.length) {
        lines.push("", "Columns:");
        for (const column of columns) if (clean(column.value)) lines.push(`- ${clean(column.value)}`);
      }
      continue;
    }
    lines.push("", `## ${itemTitle || (item.imageItem ? "Image" : item.videoItem ? "Video" : "Text")}`);
    if (itemDescription) lines.push("", itemDescription);
    const mediaText = clean(item.imageItem?.image?.altText || item.videoItem?.caption);
    if (mediaText) lines.push("", mediaText);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** `get(url, options)` resolves to the response body, so the Drive MCP can pass its own error-mapped caller. */
export async function exportedMarkdown(get, id, format, title) {
  if (format.type === "form") return formMarkdown(await get(`https://forms.googleapis.com/v1/forms/${encodeURIComponent(id)}`));
  const contents = Buffer.from(await get(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export`,
    { params: { mimeType: format.mimeType }, responseType: "arraybuffer" }));
  if (format.type === "drawing") return drawingMarkdown(contents.toString("utf8"), title);
  return officeMarkdown(contents, format.fileType);
}

export class GoogleDriveConnection {
  constructor(credentials, root) {
    this.credentials = credentials;
    this.root = root;
    this.app = { clientId: "", clientSecret: "" };
    this.pending = null;
    this.exported = new Map();
  }

  configure({ googleDesktopClientId: clientId, googleDesktopClientSecret: clientSecret }) {
    if (clientId && clientSecret) this.app = { clientId, clientSecret };
  }

  async stored(name) {
    return json((await this.credentials.resolve(name))?.value ?? "");
  }

  async tokenRecord() {
    const value = await this.stored(tokenCredential);
    if (!this.app.clientId && value?.app) this.app = value.app;
    return value;
  }

  async tokens() {
    const value = await this.tokenRecord();
    const scopes = new Set(value?.scopes ?? []);
    return value?.app?.clientId === this.app.clientId && requiredScopes.every((scope) => scopes.has(scope))
      ? value.tokens
      : null;
  }

  async saveTokens(tokens) {
    await this.credentials.set(tokenCredential, JSON.stringify({ app: this.app, scopes: requiredScopes, tokens }));
  }

  async status() {
    const [record, tokens, profile] = await Promise.all([
      this.tokenRecord(), this.tokens(), this.stored(profileCredential)
    ]);
    const exports = [...this.exported.values()];
    return {
      available: Boolean(this.app.clientId),
      connected: Boolean(tokens?.refresh_token || tokens?.access_token),
      needsReconnect: Boolean(record?.tokens && !tokens),
      profile: profile ?? null,
      exportedLocations: exports.length,
      lastExportedAt: exports.length
        ? new Date(Math.max(...exports.map(({ at }) => at))).toISOString()
        : null,
      localOnly: true,
      scopes: ["Google Drive and Forms (read only)"]
    };
  }

  async start() {
    const pending = await googleConsent(this.app, requiredScopes, async (auth) => {
      const { data } = await drive({ version: "v3", auth }).about.get({ fields: "user(displayName,emailAddress,permissionId)" });
      await Promise.all([
        this.saveTokens(auth.credentials),
        this.credentials.set(profileCredential, JSON.stringify(data.user ?? {}))
      ]);
    });
    this.close();
    this.pending = pending;
    return { url: pending.url };
  }

  async disconnect() {
    this.close();
    await Promise.all([
      this.credentials.unset(tokenCredential),
      this.credentials.unset(profileCredential)
    ]);
    this.exported.clear();
    return this.status();
  }

  close() {
    this.pending?.close();
    this.pending = null;
  }

  async client() {
    const tokens = await this.tokens();
    if (!tokens) return null;
    const client = new OAuth2Client(this.app.clientId, this.app.clientSecret);
    client.setCredentials(tokens);
    return client;
  }

  outputRoot(teamId, locationId) {
    return resolve(this.root, "knowledge", `team-${stable(teamId)}`, "google", stable(locationId));
  }

  cachedLocation(teamId, location) {
    const output = this.outputRoot(teamId, location.id);
    if (!hasExport(output)) return null;
    return {
      ...location,
      id: `g${stable(location.id)}`,
      name: `${location.name} · Google`,
      kind: "folder",
      localPath: output,
      googleExported: true
    };
  }

  async exportLocation(teamId, location) {
    const pointerPaths = pointers(location);
    if (!pointerPaths.length) return null;
    const cached = this.exported.get(location.id);
    if (cached && Date.now() - cached.at < 60_000) return cached.location;
    const prior = this.cachedLocation(teamId, location);
    const auth = await this.client();
    if (!auth) {
      if (prior) this.exported.set(location.id, { at: Date.now(), location: prior });
      return prior;
    }
    const api = drive({ version: "v3", auth });
    const output = this.outputRoot(teamId, location.id);
    const nextOutput = `${output}.next`;
    rmSync(nextOutput, { recursive: true, force: true });
    mkdirSync(nextOutput, { recursive: true });
    let count = 0;
    for (const path of pointerPaths) {
      try {
        const id = pointerId(path);
        const format = pointerFormats[extname(path).toLowerCase()];
        if (!id || !format) continue;
        const [{ data: file }, markdown] = await Promise.all([
          api.files.get({
            fileId: id, supportsAllDrives: true,
            fields: "id,name,createdTime,modifiedTime,webViewLink"
          }),
          exportedMarkdown(async (url, options) => (await auth.request({ url, retry: true, ...options })).data,
            id, format, basename(path, extname(path)))
        ]);
        if (!markdown) continue;
        const fromRoot = (location.kind === "folder" ? relative(location.localPath, path) : basename(path))
          .replaceAll("\\", "/");
        const target = resolve(nextOutput,
          `${fromRoot.slice(0, -extname(fromRoot).length)}-${format.fileType || format.type}.md`);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, knowledgeMarkdown(markdown, {
          source_id: file.id,
          source_name: fromRoot,
          source_url: file.webViewLink,
          google_type: format.type,
          created_at: file.createdTime,
          modified_at: file.modifiedTime
        }));
        count += 1;
      } catch { /* One inaccessible shortcut must not hide every other team document. */ }
    }
    if (!count) {
      rmSync(nextOutput, { recursive: true, force: true });
      if (prior) this.exported.set(location.id, { at: Date.now(), location: prior });
      return prior;
    }
    rmSync(output, { recursive: true, force: true });
    renameSync(nextOutput, output);
    await this.saveTokens(auth.credentials);
    const exported = this.cachedLocation(teamId, location);
    if (!exported) return prior;
    this.exported.set(location.id, { at: Date.now(), location: exported });
    return exported;
  }
}
