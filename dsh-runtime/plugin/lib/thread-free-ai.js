import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { threadError } from './thread-store.js';

const prefix = 'bees-free-';
export const isAccountAIProvider = provider => provider.startsWith(prefix);

// Reuse the existing streaming/tool-call adapter; account keys stay only in memory.
export function freeAIAdapter(provider, ai, resolveApiKey) {
  const base = openrouterProvider();
  const model = { ...ai.model, provider, api: 'openai-completions', baseUrl: base.baseUrl,
    input: ['text'], reasoning: true, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsDeveloperRole: false, thinkingFormat: 'openrouter' } };
  const profiles = new Map([[provider, {
    provider, displayName: 'Bees Free', streamIdleTimeoutMs: 300000,
    configuredMaxTokens: new Map([[model.id, model.maxTokens]]), modelErrors: new Map(),
    piProvider: { ...base, id: provider, name: 'Bees Free', getModels: () => [model] }
  }]]);
  return new PiAiAdapter({ profiles: () => profiles, resolveApiKey });
}

export class ThreadFreeAI {
  constructor(ctx) { this.ctx = ctx; this.accounts = new Map(); }
  async sync(client) {
    const { directory, store } = client;
    if (!directory.token || !directory.user || client.closing) return;
    const owner = directory.url + '\n' + directory.user.id;
    let entry = this.accounts.get(store);
    if (entry && entry.owner !== owner) { this.close(client); entry = undefined; }
    if (entry?.pending) return entry.pending;
    if (entry?.ai || entry?.retryAt > Date.now()) return;
    entry ??= { owner, client, provider: prefix + store.clientId };
    this.accounts.set(store, entry);
    const token = directory.token;
    entry.pending = (async () => {
      try {
        const { ai } = await directory.request('/ai', {});
        if (client.closing || directory.token !== token || this.accounts.get(store) !== entry) return;
        if (!ai) { entry.message = ''; return; }
        if (ai.limit !== 0 || typeof ai.apiKey !== 'string' || !/^sk-or-v1-[a-z0-9]+$/i.test(ai.apiKey) ||
            !/^[a-z0-9._-]+\/[a-z0-9._:-]+:free$/i.test(ai.model?.id) || typeof ai.model.name !== 'string' ||
            !Number.isSafeInteger(ai.model.contextWindow) || ai.model.contextWindow <= 0 ||
            !Number.isSafeInteger(ai.model.maxTokens) || ai.model.maxTokens <= 0 || ai.model.maxTokens > ai.model.contextWindow)
          throw Error('Invalid free AI configuration');
        entry.ai = ai;
        const adapter = freeAIAdapter(entry.provider, ai, async () => {
          if (client.closing || !directory.token || this.accounts.get(store) !== entry) throw threadError('Sign in to use Bees Free');
          return entry.ai.apiKey;
        });
        entry.dispose = this.ctx.llm.registerAdapter([entry.provider], adapter);
        if (store.preference('model') === null) store.preference('model', 'bees-free/' + ai.model.id);
        entry.message = '';
      } catch (error) {
        entry.dispose?.(); entry.dispose = undefined;
        entry.ai = undefined;
        entry.message = error.status === 404 ? '' : 'Bees Free is temporarily unavailable. Try again shortly or use your own AI connection.';
      } finally { entry.pending = undefined; entry.retryAt = Date.now() + 60000; }
    })();
    await entry.pending;
  }
  models(store) {
    const ai = this.accounts.get(store)?.ai;
    return ai ? [{ id: 'bees-free/' + ai.model.id, name: ai.model.name }] : [];
  }
  view(store) {
    const entry = this.accounts.get(store);
    return { available: !!entry?.ai, message: entry?.message ?? '' };
  }
  mount(agentCtx, store) {
    agentCtx.on('llm/stream', (options, next) => {
      if (isAccountAIProvider(options.provider) && options.provider !== this.accounts.get(store)?.provider)
        throw threadError('Bees Free belongs to another account');
      return next();
    });
  }
  resolve(store, model) {
    if (isAccountAIProvider(model?.provider ?? '')) throw threadError('Choose Bees Free for this account');
    if (model?.provider !== 'bees-free') return model;
    const entry = this.accounts.get(store);
    if (!entry?.ai || entry.ai.model.id !== model.model || !entry.client.directory.token || entry.client.closing)
      throw threadError('Bees Free is unavailable for this account. Sign in or choose another AI connection.');
    return { ...model, provider: entry.provider };
  }
  close(client) {
    const entry = this.accounts.get(client.store);
    this.accounts.delete(client.store);
    entry?.dispose?.();
    if (entry) entry.ai = undefined;
  }
}
