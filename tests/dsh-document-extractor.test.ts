import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "../dsh-runtime/node_modules/fflate/esm/index.mjs";
// @ts-expect-error The bundled runtime is JavaScript and is exercised directly here.
import { DocumentExports, officeDocument } from "../dsh-runtime/plugin/lib/document-extractor.js";
// @ts-expect-error The bundled runtime is JavaScript and is exercised directly here.
import { drawingMarkdown, formMarkdown, GoogleDriveConnection } from "../dsh-runtime/plugin/lib/google-drive.js";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { BeesProduct } from "../dsh-runtime/plugin/lib/product.js";
import { NodeDatabase } from "./node-database.js";

function twoTabWorkbook() {
  const xml = (value: string) => strToU8(value);
  return Buffer.from(zipSync({
    "[Content_Types].xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      </Types>`),
    "_rels/.rels": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
      </Relationships>`),
    "docProps/core.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
        xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <dcterms:created xsi:type="dcterms:W3CDTF">2026-01-02T03:04:05Z</dcterms:created>
        <dcterms:modified xsi:type="dcterms:W3CDTF">2026-02-03T04:05:06Z</dcterms:modified>
      </cp:coreProperties>`),
    "xl/workbook.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Roadmap" sheetId="1" r:id="rId1"/><sheet name="Budget" sheetId="2" r:id="rId2"/></sheets>
      </workbook>`),
    "xl/_rels/workbook.xml.rels": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
      </Relationships>`),
    "xl/worksheets/sheet1.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">
        <c r="A1" t="inlineStr"><is><t>Launch roadmap</t></is></c>
      </row></sheetData></worksheet>`),
    "xl/worksheets/sheet2.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">
        <c r="A1" t="inlineStr"><is><t>Annual budget</t></is></c>
      </row></sheetData></worksheet>`)
  }));
}

describe("team document extraction", () => {
  const roots: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("converts every XLSX tab to searchable Markdown", async () => {
    const document = await officeDocument(twoTabWorkbook(), "xlsx");
    const markdown = document.markdown;
    expect(markdown).toContain("Roadmap");
    expect(markdown).toContain("Launch roadmap");
    expect(markdown).toContain("Budget");
    expect(markdown).toContain("Annual budget");
    expect(document.createdAt.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(document.modifiedAt.toISOString()).toBe("2026-02-03T04:05:06.000Z");
  });

  it("caches local Office and PDF extraction by source fingerprint", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-documents-"));
    roots.push(root);
    const folder = join(root, "files");
    mkdirSync(folder);
    const source = join(folder, "plan.docx");
    writeFileSync(source, "first");
    const extract = vi.fn(async () => "Launch the international plan");
    const documents = new DocumentExports(root, extract);
    const location = { id: "location-1", name: "Plans", kind: "folder", localPath: folder };

    const first = await documents.exportLocation("team-1", location);
    const cached = await documents.exportLocation("team-1", location);
    expect(cached).toEqual(first);
    expect(extract).toHaveBeenCalledOnce();
    expect(readFileSync(join(first!.localPath, "plan-docx.md"), "utf8"))
      .toContain("source_name: \"plan.docx\"");

    writeFileSync(source, "changed source");
    await documents.exportLocation("team-1", location);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("searches an extracted Office file through the team QMD index", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-office-knowledge-"));
    roots.push(root);
    const folder = join(root, "finance");
    mkdirSync(folder);
    writeFileSync(join(folder, "forecast.xlsx"), twoTabWorkbook());
    const database = new NodeDatabase();
    const agents = new AgentRuntime({ on: () => () => undefined }, database.connection);
    const product = new BeesProduct(database.connection, agents, null, root);
    const initial = await product.snapshot();
    await product.command({
      action: "add_location", teamId: initial.teams[0].id,
      name: "Finance", kind: "folder", path: folder
    });

    const result = (await product.search("Annual budget", initial.workspaces[0].id))
      .find(({ kind }: any) => kind === "file");
    expect(result).toMatchObject({
      title: "Finance · Documents/forecast.xlsx",
      createdAt: "2026-01-02T03:04:05.000Z",
      modifiedAt: "2026-02-03T04:05:06.000Z"
    });
    expect(product.readKnowledge(result.id, initial.workspaces[0].id).content)
      .toContain("Annual budget");
  });

  it("extracts Google Form structure and Google Drawing text", () => {
    const form = formMarkdown({
      info: { title: "Hiring request", description: "Request a new role" },
      settings: { quizSettings: { isQuiz: true } },
      items: [
        { title: "Department", questionItem: { question: { required: true,
          choiceQuestion: { type: "DROP_DOWN", options: [{ value: "Engineering" }, { value: "Sales" }] } } } },
        { title: "Priority", questionItem: { question: {
          scaleQuestion: { low: 1, high: 5, lowLabel: "Later", highLabel: "Urgent" }
        } } },
        { title: "Interview grid", questionGroupItem: {
          questions: [{ rowQuestion: { title: "Communication" } }, { rowQuestion: { title: "Execution" } }],
          grid: { columns: { options: [{ value: "Strong" }, { value: "Needs work" }] } }
        } }
      ]
    });
    expect(form).toContain("# Hiring request");
    expect(form).toContain("Engineering");
    expect(form).toContain("scale 1–5");
    expect(form).toContain("Communication");
    expect(form).toContain("Needs work");

    const drawing = drawingMarkdown(`
      <svg><style>.x { color: red }</style><text><tspan>North &amp; South</tspan></text>
      <script>doNotIndex()</script><text>Expansion</text></svg>`, "Market map");
    expect(drawing).toContain("# Market map");
    expect(drawing).toContain("North & South");
    expect(drawing).toContain("Expansion");
    expect(drawing).not.toContain("doNotIndex");
  });

  it("requires one reconnect when an older Drive token lacks Forms scope", async () => {
    const credentials = {
      resolve: vi.fn(async (name: string) => name === "BEES_GOOGLE_DRIVE_OAUTH"
        ? { value: JSON.stringify({ app: { clientId: "client", clientSecret: "secret" }, tokens: { refresh_token: "old" } }) }
        : undefined),
      set: vi.fn(),
      unset: vi.fn()
    };
    const connection = new GoogleDriveConnection(credentials, "/tmp");
    connection.configure({ googleDesktopClientId: "client", googleDesktopClientSecret: "secret" });
    await expect(connection.status()).resolves.toMatchObject({ connected: false, needsReconnect: true });
  });

  it("requests only Drive permissions in the desktop OAuth flow", async () => {
    const connection = new GoogleDriveConnection({ resolve: vi.fn() }, "/tmp");
    connection.configure({ googleDesktopClientId: "desktop-client.apps.googleusercontent.com", googleDesktopClientSecret: "secret" });
    const { url } = await connection.start();
    connection.close();

    const authorization = new URL(url);
    expect(authorization.searchParams.get("client_id"))
      .toBe("desktop-client.apps.googleusercontent.com");
    expect(new Set(authorization.searchParams.get("scope")?.split(" "))).toEqual(new Set([
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/forms.body.readonly"
    ]));
    expect(authorization.searchParams.get("nonce")).toBeNull();
    expect(authorization.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
