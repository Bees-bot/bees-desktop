import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import {
  lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { drive } from "@googleapis/drive";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";

const tokenCredential = "BEES_GOOGLE_DRIVE_OAUTH";
const profileCredential = "BEES_GOOGLE_DRIVE_PROFILE";
const pointerFormats = {
  ".gdoc": { mimeType: "text/markdown", extension: ".md", type: "document" },
  ".gsheet": { mimeType: "text/csv", extension: ".csv", type: "spreadsheet" },
  ".gslides": { mimeType: "text/plain", extension: ".txt", type: "presentation" }
};
pointerFormats[".gslide"] = pointerFormats[".gslides"];

function stable(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function json(value) {
  try { return JSON.parse(value); } catch { return null; }
}

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
      if (entry.isFile() && [".md", ".csv", ".txt"].includes(extname(entry.name).toLowerCase())) return true;
      if (entry.isDirectory() && hasExport(join(path, entry.name))) return true;
    }
  } catch { /* A missing cache is simply unavailable. */ }
  return false;
}

function frontmatter(file, type) {
  const values = {
    source_id: file.id,
    source_url: file.webViewLink,
    google_type: type,
    created_at: file.createdTime,
    modified_at: file.modifiedTime
  };
  return `---\n${Object.entries(values).filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n\n`;
}

export class GoogleDriveConnection {
  constructor(credentials, root) {
    this.credentials = credentials;
    this.root = root;
    this.clientId = "";
    this.pending = null;
    this.exported = new Map();
  }

  configure(clientId) {
    const value = String(clientId ?? "").trim();
    if (value) this.clientId = value;
  }

  async stored(name) {
    return json((await this.credentials.resolve(name))?.value ?? "");
  }

  async tokens() {
    const value = await this.stored(tokenCredential);
    if (!this.clientId && value?.clientId) this.clientId = value.clientId;
    return value?.clientId === this.clientId ? value.tokens : null;
  }

  async status() {
    const [tokens, profile] = await Promise.all([this.tokens(), this.stored(profileCredential)]);
    const exports = [...this.exported.values()];
    return {
      available: Boolean(this.clientId),
      connected: Boolean(tokens?.refresh_token || tokens?.access_token),
      profile: profile ?? null,
      exportedLocations: exports.length,
      lastExportedAt: exports.length
        ? new Date(Math.max(...exports.map(({ at }) => at))).toISOString()
        : null,
      localOnly: true,
      scopes: ["Google Drive (read only)"]
    };
  }

  async start() {
    if (!this.clientId) throw new Error("Google Drive is not configured by your Bees server");
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    this.pending?.server?.close();
    const server = createServer((request, response) => {
      void this.complete(new URL(request.url ?? "/", "http://127.0.0.1").searchParams)
        .then(() => {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end("<!doctype html><title>Bees</title><p>Google Drive is connected locally. You can close this window.</p>");
        }, (error) => {
          response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          response.end(`<!doctype html><title>Bees</title><p>${String(error?.message ?? error)
            .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>`);
        });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The local Drive callback is unavailable");
    const redirectUri = `http://127.0.0.1:${address.port}`;
    const client = new OAuth2Client(this.clientId, undefined, redirectUri);
    const verifier = await client.generateCodeVerifierAsync();
    const state = randomBytes(24).toString("hex");
    this.pending = {
      state, redirectUri, codeVerifier: verifier.codeVerifier,
      expiresAt: Date.now() + 5 * 60_000, server
    };
    this.pending.timer = setTimeout(() => {
      if (this.pending?.state !== state) return;
      this.pending.server.close();
      this.pending = null;
    }, 5 * 60_000);
    this.pending.timer.unref();
    return {
      url: client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: ["https://www.googleapis.com/auth/drive.readonly"],
        state,
        code_challenge: verifier.codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256
      })
    };
  }

  async complete(params) {
    const pending = this.pending;
    const offered = Buffer.from(String(params.get("state") ?? ""));
    const expected = Buffer.from(String(pending?.state ?? ""));
    if (!pending || pending.expiresAt < Date.now()) {
      this.pending = null;
      if (pending?.timer) clearTimeout(pending.timer);
      pending?.server?.close();
      throw new Error("This Drive connection expired; try again");
    }
    if (offered.length !== expected.length || !timingSafeEqual(offered, expected)) {
      throw new Error("This Drive connection did not match the active request");
    }
    this.pending = null;
    if (pending.timer) clearTimeout(pending.timer);
    pending.server?.close();
    if (params.get("error")) throw new Error("Google Drive access was not granted");
    const code = params.get("code");
    if (!code) throw new Error("Google did not return an authorization code");
    const client = new OAuth2Client(this.clientId, undefined, pending.redirectUri);
    const previous = await this.tokens();
    const { tokens } = await client.getToken({ code, codeVerifier: pending.codeVerifier });
    client.setCredentials({ ...previous, ...tokens, refresh_token: tokens.refresh_token ?? previous?.refresh_token });
    const api = drive({ version: "v3", auth: client });
    const { data } = await api.about.get({ fields: "user(displayName,emailAddress,permissionId)" });
    await Promise.all([
      this.credentials.set(tokenCredential, JSON.stringify({ clientId: this.clientId, tokens: client.credentials })),
      this.credentials.set(profileCredential, JSON.stringify(data.user ?? {}))
    ]);
    return this.status();
  }

  async disconnect() {
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    this.pending?.server?.close();
    this.pending = null;
    await Promise.all([
      this.credentials.unset(tokenCredential),
      this.credentials.unset(profileCredential)
    ]);
    this.exported.clear();
    return this.status();
  }

  close() {
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    this.pending?.server?.close();
    this.pending = null;
  }

  async client() {
    const tokens = await this.tokens();
    if (!tokens) return null;
    const client = new OAuth2Client(this.clientId);
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
        const [{ data: file }, { data }] = await Promise.all([
          api.files.get({
            fileId: id, supportsAllDrives: true,
            fields: "id,name,createdTime,modifiedTime,webViewLink"
          }),
          api.files.export({ fileId: id, mimeType: format.mimeType }, { responseType: "arraybuffer" })
        ]);
        const contents = Buffer.from(data);
        if (contents.length > 1_000_000) continue;
        const fromRoot = location.kind === "folder" ? relative(location.localPath, path) : basename(path);
        const target = resolve(nextOutput, fromRoot.slice(0, -extname(fromRoot).length) + format.extension);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, frontmatter(file, format.type) + contents.toString("utf8"));
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
    await this.credentials.set(
      tokenCredential,
      JSON.stringify({ clientId: this.clientId, tokens: auth.credentials })
    );
    const exported = this.cachedLocation(teamId, location);
    if (!exported) return prior;
    this.exported.set(location.id, { at: Date.now(), location: exported });
    return exported;
  }
}
