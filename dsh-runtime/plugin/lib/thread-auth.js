import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { threadError } from './thread-store.js';

export function serverOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    throw threadError('Use an HTTPS Bees Server');
  return url.origin;
}

export async function authConfig(url) {
  const response = await fetch(serverOrigin(url) + '/api/config', { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw threadError('Could not load sign-in options', response.status);
  const config = await response.json();
  if (config.architecture !== 'client-owned-threads')
    throw threadError('This Bees Server needs an update before you can sign in with this client. Update the server or choose a compatible Bees Server.', 409);
  return { socialProviders: Array.isArray(config.socialProviders) ? config.socialProviders.filter(p => ['google', 'github'].includes(p)) : [], ssoEnabled: config.ssoEnabled === true };
}

export function browserSignInUrl(origin, { provider, email }, redirect) {
  const url = new URL(provider === 'sso' ? '/api/auth/desktop/sso/start' : '/api/auth/desktop/start', serverOrigin(origin));
  if (provider === 'sso') {
    if (!/^[^\s@]+@[^\s@]+$/.test(email ?? '')) throw threadError('Enter your work email for company SSO');
    url.searchParams.set('email', email);
  } else {
    if (!['google', 'github'].includes(provider)) throw threadError('Unknown sign-in provider');
    url.searchParams.set('provider', provider);
  }
  url.searchParams.set('redirect', redirect);
  return url.toString();
}

export async function desktopSignIn(origin, input, complete) {
  const id = randomUUID(), path = '/auth/' + randomUUID();
  let result, resolveSession;
  const session = new Promise(resolve => { resolveSession = resolve; });
  const finish = value => { if (!result) { result = value; resolveSession(value); } };
  let received = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== path) return void res.writeHead(404).end();
    const token = url.searchParams.get('token'), error = url.searchParams.get('error');
    if (!token && !error) return void res.writeHead(400).end();
    if (received) return void res.writeHead(409).end();
    received = true;
    clearTimeout(timer);
    server.close();
    try {
      if (!token) throw threadError(error);
      const user = await complete(token);
      finish({ user });
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      res.end('Signed in. You can close this tab and return to Bees.');
    } catch (error) {
      finish({ error: error.message });
      res.writeHead(error.status ?? 400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      res.end('Bees could not finish signing in: ' + error.message);
    }
  });
  let timer;
  const close = () => { clearTimeout(timer); server.close(); finish({ error: 'Sign in was cancelled or timed out. Try again.' }); };
  // The unguessable callback path binds the returned session to this sign-in attempt.
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  timer = setTimeout(close, 5 * 60_000).unref();
  try {
    const url = browserSignInUrl(origin, input, `http://127.0.0.1:${server.address().port}${path}`);
    return { id, url, session, close, get result() { return result; } };
  } catch (error) { close(); throw error; }
}
