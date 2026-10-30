import { createHash } from 'node:crypto';

export const isFreeClient = credits => credits?.balance === 0 && credits.heldTokens === 0 && !credits.autoRenew && !credits.paymentPending;

/** Browser requests renew the lease; a worker's own heartbeats never do. */
export function hostedClientActivity({ provision, directoryUrl, fetcher = fetch, now = Date.now }) {
  const idleMs = 5 * 60_000, sleepMs = Number(process.env.BEES_HOSTED_IDLE_MINUTES || 30) * 60_000, started = now(), seen = new Map();
  if (!(sleepMs >= 0)) throw Error('BEES_HOSTED_IDLE_MINUTES must be 0 (never) or more minutes');
  const key = user => createHash('sha256').update(directoryUrl + '\n' + user.id).digest('hex');
  const lastSeen = id => seen.get(id.slice(0, 32)) ?? started;
  let sweeping = false;
  return {
    touch(user) { seen.set(key(user).slice(0, 32), now()); },
    async sweep() {
      if (sweeping || !provision.running || now() - started < idleMs) return;
      sweeping = true;
      try {
        for (const client of await provision.running()) {
          if (now() - lastSeen(client.id) < idleMs) continue;
          try {
            const headers = { authorization: 'Bearer ' + client.token }, options = { headers, signal: AbortSignal.timeout(20_000) };
            const snapshot = await fetcher(client.url + '/bees-api/snapshot', options);
            if (!snapshot.ok) continue;
            const { user } = await snapshot.json();
            if (!user?.id || ![key(user), key(user).slice(0, 32)].includes(client.id)) continue;
            const response = await fetcher(client.url + '/bees-api/threads', {
              ...options, method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'credits' }),
            });
            if (!response.ok) continue;
            const status = await response.json();
            if (!status || status.message) continue;
            // paid ones sleep later, and never while they own a schedule, since a sleeping one can't fire it
            const free = isFreeClient(status.credits), limit = free ? idleMs : sleepMs;
            if (!limit || now() - lastSeen(client.id) < limit) continue;
            const activity = await fetcher(client.url + '/bees-api/active-runs' + (free ? '' : '?schedules'), { headers, signal: AbortSignal.timeout(5000) });
            if (!activity.ok || await activity.json() !== 0 || now() - lastSeen(client.id) < limit) continue;
            await provision.stop(user);
          } catch (error) { console.warn('Idle hosted client check failed:', client.id, error.message); }
        }
      } finally { sweeping = false; }
    },
  };
}
