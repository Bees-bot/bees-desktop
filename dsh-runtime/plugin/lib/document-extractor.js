import { createHash } from "node:crypto";
import {
  lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { OfficeParser } from "officeparser";

export const DOCUMENT_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx", ".pdf"]);

const MAX_SOURCE_BYTES = 20_000_000;
const MAX_KNOWLEDGE_BYTES = 1_000_000;
const EXTRACTION_TIMEOUT = 60_000;

function stable(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function json(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function manifest(path) {
  try { return json(readFileSync(path, "utf8")); } catch { return null; }
}

function clipped(value, bytes) {
  const buffer = Buffer.from(String(value ?? ""));
  if (buffer.length <= bytes) return buffer.toString("utf8");
  return `${buffer.subarray(0, bytes).toString("utf8").replace(/\uFFFD$/, "").trimEnd()}\n\n[Content truncated for local indexing.]`;
}

export function knowledgeMarkdown(body, values) {
  const header = `---\n${Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n\n`;
  return header + clipped(body, Math.max(0, MAX_KNOWLEDGE_BYTES - Buffer.byteLength(header) - 48));
}

export async function officeDocument(file, fileType) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT);
  timer.unref();
  try {
    const ast = await OfficeParser.parseOffice(file, {
      ...(fileType ? { fileType } : {}),
      abortSignal: controller.signal,
      extractAttachments: false,
      ignoreSlideMasters: true,
      ocr: false
    });
    ast.content = ast.content.flatMap((node, index) => {
      const label = node.type === "sheet"
        ? `Sheet: ${node.metadata?.sheetName || index + 1}`
        : node.type === "slide"
          ? `Slide ${node.metadata?.slideNumber || index + 1}`
          : "";
      return label ? [{
        type: "heading", text: label, children: [{ type: "text", text: label }], metadata: { level: 2 }
      }, node] : [node];
    });
    const { value } = await ast.to("md", {
      abortSignal: controller.signal, includeCharts: false, includeImages: false
    });
    return {
      markdown: String(value ?? "").trim(),
      createdAt: ast.metadata?.created,
      modifiedAt: ast.metadata?.modified
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function officeMarkdown(file, fileType) {
  return (await officeDocument(file, fileType)).markdown;
}

function iso(value, fallback) {
  const date = value instanceof Date ? value : new Date(value ?? "");
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback.toISOString();
}

function documentFiles(location) {
  const files = [];
  const root = resolve(location.localPath);
  const visit = (path) => {
    let stat;
    try { stat = lstatSync(path); } catch { return; }
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      const extension = extname(path).toLowerCase();
      if (DOCUMENT_EXTENSIONS.has(extension)) {
        files.push({
          path,
          relativePath: (location.kind === "folder" ? relative(root, path) : basename(path)).replaceAll("\\", "/"),
          extension,
          stat
        });
      }
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!entry.name.startsWith(".")) visit(join(path, entry.name));
    }
  };
  visit(root);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function hasMarkdown(path) {
  try {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") return true;
      if (entry.isDirectory() && hasMarkdown(join(path, entry.name))) return true;
    }
  } catch { /* A missing cache is simply unavailable. */ }
  return false;
}

export class DocumentExports {
  constructor(root, extract = officeDocument) {
    this.root = root;
    this.extract = extract;
    this.exported = new Map();
  }

  outputRoot(teamId, locationId) {
    return resolve(this.root, "knowledge", `team-${stable(teamId)}`, "documents", stable(locationId));
  }

  cachedLocation(teamId, location) {
    const output = this.outputRoot(teamId, location.id);
    if (!hasMarkdown(output)) return null;
    return {
      ...location,
      id: `d${stable(location.id)}`,
      name: `${location.name} · Documents`,
      kind: "folder",
      localPath: output,
      extractedDocuments: true
    };
  }

  async exportLocation(teamId, location) {
    const files = documentFiles(location);
    const output = this.outputRoot(teamId, location.id);
    if (!files.length) {
      rmSync(output, { recursive: true, force: true });
      this.exported.delete(location.id);
      return null;
    }
    const fingerprint = stable(files.map(({ relativePath, stat }) =>
      `${relativePath}:${stat.size}:${stat.mtimeMs}`).join("\n"));
    const prior = this.cachedLocation(teamId, location);
    const memory = this.exported.get(location.id);
    const saved = manifest(resolve(output, ".manifest.json"));
    if (prior && (memory?.fingerprint === fingerprint || saved?.fingerprint === fingerprint)) {
      this.exported.set(location.id, { fingerprint, location: prior });
      return prior;
    }

    const nextOutput = `${output}.next`;
    rmSync(nextOutput, { recursive: true, force: true });
    mkdirSync(nextOutput, { recursive: true });
    let count = 0;
    for (const file of files) {
      if (file.stat.size > MAX_SOURCE_BYTES) continue;
      try {
        const extracted = await this.extract(file.path, file.extension.slice(1));
        const markdown = typeof extracted === "string" ? extracted : extracted.markdown;
        if (!markdown) continue;
        const target = resolve(nextOutput,
          `${file.relativePath.slice(0, -file.extension.length)}-${file.extension.slice(1)}.md`);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, knowledgeMarkdown(markdown, {
          source_id: `file:${stable(`${location.id}:${file.relativePath}`)}`,
          source_name: file.relativePath,
          source_type: file.extension.slice(1),
          created_at: iso(extracted?.createdAt, file.stat.birthtime),
          modified_at: iso(extracted?.modifiedAt, file.stat.mtime)
        }));
        count += 1;
      } catch { /* One damaged document must not hide every other team document. */ }
    }
    if (!count) {
      rmSync(nextOutput, { recursive: true, force: true });
      return prior;
    }
    writeFileSync(resolve(nextOutput, ".manifest.json"), JSON.stringify({ fingerprint }));
    rmSync(output, { recursive: true, force: true });
    renameSync(nextOutput, output);
    const exported = this.cachedLocation(teamId, location);
    if (!exported) return prior;
    this.exported.set(location.id, { fingerprint, location: exported });
    return exported;
  }
}
