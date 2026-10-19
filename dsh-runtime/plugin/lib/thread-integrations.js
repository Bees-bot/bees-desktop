import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import * as mcpClient from '@deepseek-ai/dsh-mcp-client';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { MCP_CATALOG, catalogEntry, isBrowserCatalog } from './mcp-catalog.js';
import { defaultBrowser, browserSetup, browserWarning, browserPort, startAgentBrowser, showAgentBrowser, closeAgentBrowser } from './agent-browser.js';
import { googleConsent } from './google-consent.js';
import { threadError, text, validId } from './thread-store.js';

const lib = dirname(fileURLToPath(import.meta.url));
const secretRef = (store, threadId, serverId, key) => credentialRef(`BEES_THREAD_${store.clientId}_${threadId}_${serverId}_${key}`.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase());
const rows = (store, id) => store.preference(`integrations:${id}`) ?? [];
const browserMode = (store, id) => store.preference(`browser:${id}`) ?? 'own';

export class ThreadIntegrations {
  constructor(ctx) { this.ctx = ctx; this.consents = new Set(); }
  snapshot(store, id) {
    return { servers: rows(store, id), catalog: MCP_CATALOG, browser: {
      mode: browserMode(store, id), name: defaultBrowser()?.name ?? '', setup: browserSetup(), warning: browserMode(store, id) === 'personal' ? browserWarning() : '',
      personalAvailable: !process.env.BEES_HOSTED_CLIENT && !!defaultBrowser(),
    } };
  }
  async command(store, id, input) {
    if (input.action === 'integrations') return this.snapshot(store, id);
    if (input.action === 'setBrowser') {
      if (!['own', 'personal'].includes(input.mode) || input.mode === 'personal' && (process.env.BEES_HOSTED_CLIENT || !defaultBrowser())) throw threadError('Personal browser is unavailable on this client');
      store.preference(`browser:${id}`, input.mode);
    } else if (input.action === 'openBrowser') {
      if (process.env.BEES_HOSTED_CLIENT) throw threadError('Open the browser on a desktop client');
      await showAgentBrowser(browserMode(store, id), id);
    } else if (input.action === 'connectGoogle') {
      if (process.env.BEES_HOSTED_CLIENT) throw threadError('Use OAuth credentials on a hosted client');
      const entry = catalogEntry(input.catalogId);
      if (!entry?.scopes) throw threadError('Choose a Google integration');
      const clientId = text(input.secrets?.GOOGLE_CLIENT_ID, 2000), clientSecret = text(input.secrets?.GOOGLE_CLIENT_SECRET, 2000);
      const consent = await googleConsent({ clientId, clientSecret }, [...entry.scopes, 'openid', 'https://www.googleapis.com/auth/userinfo.email'], async client => {
        if(store.get(id).kind!=='team')store.writable(store.get(id));
        else if(store.preference(`frozen:${id}`))throw threadError('Team access is unavailable',403);
        await this.save(store, id, { ...input, secrets: { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REFRESH_TOKEN: client.credentials.refresh_token } });
      });
      this.consents.add(consent);
      return { url: consent.url };
    } else if (input.action === 'saveIntegration') await this.save(store, id, input);
    else if (['toggleIntegration', 'removeIntegration'].includes(input.action)) {
      const current = rows(store, id), server = current.find(row => row.id === validId(input.serverId));
      if (!server) throw threadError('Integration not found', 404);
      if (input.action === 'removeIntegration') {
        store.preference(`integrations:${id}`, current.filter(row => row.id !== server.id));
        for (const key of server.secretNames) await this.ctx.credentials.unset(secretRef(store, id, server.id, key));
      } else {
        if (typeof input.enabled !== 'boolean') throw threadError('Choose whether to enable this integration');
        store.preference(`integrations:${id}`, current.map(row => row.id === server.id ? { ...row, enabled: input.enabled } : row));
      }
    } else throw threadError('Unknown integration command');
    return this.snapshot(store, id);
  }
  async save(store, id, input) {
    const entry = input.catalogId ? catalogEntry(input.catalogId) : null;
    if (input.catalogId && !entry) throw threadError('Unknown integration');
    const current = rows(store, id);
    if (current.length >= 40) throw threadError('A team can have up to 40 integrations');
    const serverName = input.serverName || entry?.serverName;
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(serverName ?? '') || current.some(row => row.serverName === serverName)) throw threadError('Use a unique server name with up to 32 letters, numbers, dashes or underscores');
    const transport = entry?.transport ?? input.transport;
    if (!['stdio', 'streamable-http'].includes(transport)) throw threadError('Choose an MCP transport');
    const suppliedArgs = entry?.args ?? input.args ?? [];
    if (!Array.isArray(suppliedArgs) || suppliedArgs.length > 80 || suppliedArgs.some(arg => typeof arg !== 'string' || arg.length > 4000)) throw threadError('Invalid MCP arguments');
    const args = [...suppliedArgs];
    if (entry?.id === 'openapi-bridge') {
      for (const key of ['apiBaseUrl', 'openapiSpec']) {
        const url = this.url(input.inputs?.[key]);
        args.push(key === 'apiBaseUrl' ? '--api-base-url' : '--openapi-spec', url);
      }
    }
    const secrets = input.secrets ?? {};
    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets) || Object.keys(secrets).length > 40 || Object.entries(secrets).some(([key, value]) => !/^[a-zA-Z_][a-zA-Z0-9_-]{0,80}$/.test(key) || typeof value !== 'string' || value.length > 16000)) throw threadError('Invalid MCP credentials');
    const normalizedKeys=Object.keys(secrets).map(key=>key.replaceAll('-','_').toUpperCase());
    if(new Set(normalizedKeys).size!==normalizedKeys.length)throw threadError('Credential names must be distinct');
    for (const key of [...(entry?.env ?? []), ...(entry?.headers ?? [])]) if (!key.optional && !secrets[key.name]?.trim()) throw threadError(`Enter ${key.label}`);
    const server = { id: randomUUID(), serverName, label: text(input.label || entry?.label || serverName, 120), catalogId: entry?.id ?? '', transport,
      command: transport === 'stdio' ? text(entry?.command || input.command, 1000) : '', args,
      url: transport === 'streamable-http' ? this.url(entry?.url || input.url) : '',
      secretNames: Object.keys(secrets).filter(key => secrets[key]), enabled: true };
    for (const key of server.secretNames) await this.ctx.credentials.set(secretRef(store, id, server.id, key), secrets[key]);
    store.preference(`integrations:${id}`, [...current, server]);
  }
  url(value) {
    let url; try { url = new URL(value); } catch { throw threadError('Enter a valid MCP or API URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw threadError('Use HTTP or HTTPS; put credentials in the credential fields');
    return url.href;
  }
  async config(store, id, server, cwd, browserId=id) {
    const credentials = {};
    for (const key of server.secretNames) {
      const hit = await this.ctx.credentials.resolve(secretRef(store, id, server.id, key));
      if (!hit?.value) throw threadError(`Reconnect ${server.label}: ${key} is missing on this client`);
      credentials[key] = hit.value;
    }
    const entry = catalogEntry(server.catalogId);
    if (server.transport === 'streamable-http') return { transport: server.transport, serverName: server.serverName, url: server.url,
      headers: Object.fromEntries(Object.entries(credentials).map(([key, value]) => [key, (entry?.headers.find(row => row.name === key)?.prefix ?? '') + value])), failOnStartupError: true };
    let args = server.args.map(arg => arg.replace('{lib}', lib));
    if (entry?.requiresDirectory) args.push(cwd);
    if (server.catalogId === 'memory') {
      const directory = join(store.root, 'integration-data', id); mkdirSync(directory, { recursive: true, mode: 0o700 });
      credentials.MEMORY_FILE_PATH = join(directory, `${server.id}.jsonl`);
    }
    if (isBrowserCatalog(server.catalogId)) {
      const mode = browserMode(store, browserId);
      if (mode === 'personal') await startAgentBrowser(mode);
      args = server.catalogId === 'playwright'
        ? [...server.args.slice(0, 2), ...(mode === 'personal' ? ['--cdp-endpoint', `http://127.0.0.1:${browserPort(mode)}`] : ['--headless', '--isolated']), '--output-dir', join(cwd, 'outputs')]
        : [...server.args.slice(0, 2), ...(mode === 'personal' ? ['--browserUrl', `http://127.0.0.1:${browserPort(mode)}`] : ['--headless', '--isolated'])];
    }
    return { transport: 'stdio', serverName: server.serverName, command: server.command === '{node}' ? process.execPath : server.command,
      args, env: credentials, cwd, failOnStartupError: true };
  }
  async mount(agentCtx, store, id, cwd) {
    const team=store.teamFor(id),teamServers=team?rows(store,team.id):[];
    const connections=[...teamServers.map(server=>({server,scope:team.id})),...rows(store,id).filter(server=>!teamServers.some(row=>row.serverName===server.serverName)).map(server=>({server,scope:id}))];
    for (const {server,scope} of connections.filter(({server}) => server.enabled)) {
      const browserId=team&&store.preference(`browser:${team.id}`)!==null?team.id:scope;
      const fiber = agentCtx.plugin(mcpClient, await this.config(store, scope, server, cwd, browserId));
      let timer;
      try { await Promise.race([Promise.resolve(fiber), new Promise((_, reject) => { timer = setTimeout(() => reject(threadError(`${server.label} did not start within 30 seconds`)), 30000); })]); }
      catch (error) { await fiber.dispose(); throw error; }
      finally { clearTimeout(timer); }
    }
  }
  close() { for (const consent of this.consents) consent.close(); this.consents.clear(); closeAgentBrowser(); }
}
