import { z } from "zod";
import { googleServer } from "./google-mcp.js";

const { google: gmail, tool, serve } = googleServer("Gmail", "https://gmail.googleapis.com/gmail/v1/users/me/");

const id = encodeURIComponent;
const parts = (part) => [part, ...(part.parts ?? []).flatMap(parts)];
const decode = (data) => Buffer.from(data, "base64url").toString("utf8");
const headers = (payload) => Object.fromEntries(payload.headers
  .filter(({ name }) => ["from", "to", "cc", "subject", "date"].includes(name.toLowerCase()))
  .map(({ name, value }) => [name.toLowerCase(), value]));

function bodyText(payload) {
  const inline = parts(payload).filter((part) => !part.filename && part.body?.data);
  const plain = inline.find(({ mimeType }) => mimeType === "text/plain");
  if (plain) return decode(plain.body.data);
  const html = inline.find(({ mimeType }) => mimeType === "text/html");
  return html ? decode(html.body.data).replace(/<(style|script)[^]*?<\/\1>/gi, "").replace(/<[^>]+>|&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim() : "";
}

/** A plain text MIME message; with a threadId it threads under that conversation's last message. */
async function mime({ to, cc, bcc, subject, body, threadId }) {
  const line = (value) => value.replace(/[\r\n]+/g, " ");
  const title = line(subject);
  const head = [`To: ${line(to)}`, cc && `Cc: ${line(cc)}`, bcc && `Bcc: ${line(bcc)}`,
    `Subject: ${/^[\x20-\x7e]*$/.test(title) ? title : `=?UTF-8?B?${Buffer.from(title).toString("base64")}?=`}`];
  if (threadId) {
    const { messages } = await gmail(`threads/${id(threadId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`);
    const last = Object.fromEntries(messages.at(-1).payload.headers.map(({ name, value }) => [name.toLowerCase(), value]));
    if (last["message-id"]) head.push(`In-Reply-To: ${line(last["message-id"])}`, `References: ${line([last.references, last["message-id"]].filter(Boolean).join(" "))}`);
  }
  head.push("MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64");
  const encoded = Buffer.from(body).toString("base64").match(/.{1,76}/g) ?? [];
  return { raw: Buffer.from([...head.filter(Boolean), "", ...encoded].join("\r\n")).toString("base64url"), threadId };
}

const email = {
  to: z.string().describe("Recipients, comma separated"),
  subject: z.string(),
  body: z.string().describe("Plain text"),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  threadId: z.string().optional().describe("Set to reply inside that conversation")
};

tool("search_emails", "Find emails with Gmail search, like from:anna is:unread newer_than:7d. Newest first, with sender, subject, date and a snippet.",
  { query: z.string(), maxResults: z.number().int().min(1).max(50).default(20) },
  async ({ query, maxResults }) => {
    const { messages = [] } = await gmail("messages", { params: { q: query, maxResults } });
    return Promise.all(messages.map(async (message) => {
      const found = await gmail(`messages/${id(message.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
      return { id: found.id, threadId: found.threadId, ...headers(found.payload), snippet: found.snippet, labelIds: found.labelIds };
    }));
  });

tool("read_thread", "Read a whole email conversation: each message's sender, recipients, date, text and attachment names.",
  { threadId: z.string() },
  async ({ threadId }) => {
    const { messages } = await gmail(`threads/${id(threadId)}?format=full`);
    // one budget for the whole thread, so a long one cannot flood a small model's context
    return messages.map((message) => ({
      id: message.id, ...headers(message.payload), labelIds: message.labelIds,
      text: bodyText(message.payload).slice(0, 20_000 / messages.length),
      attachments: parts(message.payload).map(({ filename }) => filename).filter(Boolean)
    }));
  });

tool("send_email", "Send an email from this Gmail account right away.", email,
  async (input) => gmail("messages/send", { method: "POST", data: await mime(input) }));

tool("create_draft", "Save an email as a Gmail draft for the owner to review and send.", email,
  async (input) => gmail("drafts", { method: "POST", data: { message: await mime(input) } }));

tool("list_labels", "List the Gmail labels and their ids.", {},
  async () => (await gmail("labels")).labels.map(({ id, name, type }) => ({ id, name, type })));

tool("modify_thread", "Add or remove labels on a conversation. Archive: remove INBOX. Mark read: remove UNREAD. Star: add STARRED. Other label ids come from list_labels.",
  { threadId: z.string(), addLabelIds: z.array(z.string()).default([]), removeLabelIds: z.array(z.string()).default([]) },
  async ({ threadId, addLabelIds, removeLabelIds }) =>
    gmail(`threads/${id(threadId)}/modify`, { method: "POST", data: { addLabelIds, removeLabelIds } }));

await serve();
