import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dockerClients } from './hosted-clients.mjs';

test('Docker shutdown preserves credentials and volumes and login starts only the matching account again', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'bees-docker-'));
  const health = createServer((req, res) => res.end('{}'));
  const containers = new Map(), calls = [];
  let stopFailed = false;
  try {
    await new Promise((resolve, reject) => health.once('error', reject).listen(0, '127.0.0.1', resolve));
    const exec = async (command, args, options) => {
      assert.equal(command, 'docker'); calls.push(args);
      const [action, name] = args, container = containers.get(name);
      if (action === 'ps') return { stdout: [...containers].filter(([, row]) => row.State.Running).map(([name]) => name).join('\n') };
      if (action === 'inspect') {
        if (!container) throw Object.assign(Error('Missing container'), { stderr: 'No such object: ' + name });
        return { stdout: JSON.stringify(args.slice(1).map(name => containers.get(name))) };
      }
      if (action === 'run') {
        const label = args[args.indexOf('--label') + 1].slice('bees.client='.length);
        containers.set(args[args.indexOf('--name') + 1], {
          Name: '/' + args[args.indexOf('--name') + 1],
          Config: { Labels: { 'bees.client': label } }, State: { Running: true },
          NetworkSettings: { Ports: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(health.address().port) }] } },
        });
        assert.equal(options.env.BEES_THREAD_SESSION, 'session');
      } else if (action === 'stop') {
        if (stopFailed) throw Error('Docker unavailable');
        containers.get(args.at(-1)).State.Running = false;
      } else if (action === 'rm') containers.delete(name);
      else assert.fail('Unexpected Docker operation: ' + action);
      return { stdout: '' };
    };
    const provision = dockerClients({ image: 'sha256:' + 'a'.repeat(64), stateRoot, directoryUrl: 'https://directory.test', exec });
    const alice = { id: 'alice' }, bob = { id: 'bob' };
    const a = await provision(alice, 'session'), b = await provision(bob, 'session');
    assert.notEqual(a.token, b.token);
    assert.deepEqual((await provision.running()).map(client => client.token).sort(), [a.token, b.token].sort());
    await Promise.all([provision.stop(alice), provision.stop(alice)]);
    assert.equal(calls.filter(args => args[0] === 'stop').length, 1);
    assert.equal([...containers.values()].filter(container => container.State.Running).length, 1);
    assert.deepEqual((await provision.running()).map(client => client.token), [b.token]);
    await provision.stop(alice);
    assert.deepEqual(await provision(alice, 'session'), a);
    const runs = calls.filter(args => args[0] === 'run');
    assert.equal(runs.length, 3);
    assert.equal(runs[0][runs[0].indexOf('--mount') + 1], runs[2][runs[2].indexOf('--mount') + 1]);
    assert(!calls.some(args => args[0] === 'volume'), 'Persistent volumes are never removed');
    stopFailed = true; await assert.rejects(provision.stop(alice), /unavailable/); stopFailed = false;
    assert.deepEqual(await provision(alice, 'session'), a);
    [...containers.values()][0].Config.Labels['bees.client'] = 'someone-else';
    await assert.rejects(provision.stop(bob), /ownership/);
    await provision.stop({ id: 'never-provisioned' });
  } finally {
    health.closeAllConnections(); await new Promise(resolve => health.close(resolve));
    await rm(stateRoot, { recursive: true, force: true });
  }
});
