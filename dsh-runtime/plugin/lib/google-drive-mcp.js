import { z } from "zod";
import { MAX_SOURCE_BYTES, officeMarkdown } from "./document-extractor.js";
import { exportedMarkdown, pointerFormats } from "./google-drive.js";
import { googleServer } from "./google-mcp.js";

// no base: Forms and Drive live on different hosts, so every call gives its whole address
const { google, tool, serve } = googleServer("Google Drive", "");

const files = "https://www.googleapis.com/drive/v3/files";
const fields = "id,name,mimeType,modifiedTime,size,webViewLink,owners(emailAddress),ownedByMe,shortcutDetails(targetId,targetMimeType)";
const office = ["docx", "xlsx", "pptx", "odt", "ods", "odp", "pdf", "rtf", "epub"];
const quoted = (value) => `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
const meta = (id) => google(`${files}/${encodeURIComponent(id)}`, { params: { fields: `${fields},fileExtension`, supportsAllDrives: true } });
const brief = ({ id, name, mimeType, modifiedTime, webViewLink, owners, ownedByMe, shortcutDetails }) =>
  ({ id: shortcutDetails?.targetId ?? id, name, mimeType: shortcutDetails?.targetMimeType ?? mimeType, modifiedTime, webViewLink, owner: owners?.[0]?.emailAddress, ownedByMe });

tool("search_files", "Find Google Drive files by words in their name or text, or list what is inside one folder. Covers files shared with the owner and shared drives.",
  {
    query: z.string().optional().describe("Words to find in a file's name or text"),
    folderId: z.string().optional().describe("Only files directly inside this folder. Folders show up in results, and root is the top of My Drive"),
    maxResults: z.number().int().min(1).max(50).default(20)
  },
  async ({ query, folderId, maxResults }) => {
    const q = ["trashed = false", query && `fullText contains ${quoted(query)}`, folderId && `${quoted(folderId)} in parents`];
    const { files: found = [], incompleteSearch } = await google(files, { params: {
      q: q.filter(Boolean).join(" and "), pageSize: maxResults, fields: `incompleteSearch,files(${fields})`,
      corpora: "allDrives", includeItemsFromAllDrives: true, supportsAllDrives: true,
      // Drive refuses a sort on a text search and ranks those by relevance itself
      ...(!query && { orderBy: "modifiedTime desc" })
    } });
    return { files: found.map(brief), ...(incompleteSearch && { note: "Google only searched some shared drives, so a file can be missing" }) };
  });

tool("read_file", "Read a Google Drive file as text: Docs, Sheets, Slides, Drawings, the questions of a Form, Word, Excel, PowerPoint, PDF and plain text. A long file comes back in parts.",
  { fileId: z.string(), start: z.number().int().min(0).default(0).describe("Where to continue, from the next value of the part before") },
  async ({ fileId, start }) => {
    let file = await meta(fileId);
    if (file.shortcutDetails) file = await meta(file.shortcutDetails.targetId);
    const format = Object.values(pointerFormats).find(({ type }) => file.mimeType === `application/vnd.google-apps.${type}`);
    const extension = file.fileExtension?.toLowerCase();
    const download = async () => Buffer.from(await google(`${files}/${encodeURIComponent(file.id)}`,
      { params: { alt: "media", supportsAllDrives: true }, responseType: "arraybuffer", maxContentLength: MAX_SOURCE_BYTES }));
    if (!format && Number(file.size) > MAX_SOURCE_BYTES) throw new Error(`${file.name} is over 20 MB, too big to read`);
    const text = format ? await exportedMarkdown(google, file.id, format, file.name)
      : office.includes(extension) ? await officeMarkdown(await download(), extension)
        : /^text\/|^application\/(json|xml|javascript|x-yaml|yaml)$/.test(file.mimeType) ? (await download()).toString("utf8")
          : null;
    if (text === null) throw new Error(`${file.name} is ${file.mimeType}, which cannot be read as text. It is at ${file.webViewLink}`);
    // one part at a time, so a long document cannot flood a small model's context
    const end = start + 20_000;
    return { ...brief(file), text: text.slice(start, end), ...(end < text.length && { next: end, length: text.length }) };
  });

await serve();
