import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kubernetesClients } from './hosted-kubernetes.mjs';

const image = 'registry.test/bees@sha256:' + 'a'.repeat(64);
function cluster() {
  const rows = new Map(), writes = [];
  const api = async (method, path, input) => {
    if (method === 'GET' && path.includes('?')) return { items: [...rows.entries()].filter(([key]) => key.includes('/deployments/')).map(([, value]) => structuredClone(value)) };
    if (method === 'GET') { if (!rows.has(path)) throw Object.assign(Error('Not found'), { status: 404 }); return structuredClone(rows.get(path)); }
    writes.push({ method, path, input: structuredClone(input) });
    if (method === 'PATCH') { const value = rows.get(path); if (input.spec.template) value.spec.template.spec = { ...value.spec.template.spec, ...input.spec.template.spec }; if (input.spec.replicas !== undefined) { value.spec.replicas = input.spec.replicas; value.status.availableReplicas = value.status.updatedReplicas = input.spec.replicas; } value.metadata.generation++; value.status.observedGeneration++; return structuredClone(value); }
    assert.equal(method, 'POST'); const value = structuredClone(input); value.metadata.generation = 1;
    if (value.kind === 'Secret') value.data = Object.fromEntries(Object.entries(value.stringData).map(([key, text]) => [key, Buffer.from(text).toString('base64')]));
    if (value.kind === 'Deployment') value.status = { observedGeneration: 1, updatedReplicas: 1, availableReplicas: 1 };
    rows.set(path + '/' + value.metadata.name, value); return structuredClone(value);
  };
  return { api, rows, writes };
}

test('hosted Kubernetes workspaces isolate accounts, persist credentials, and cannot access cluster credentials', async () => {
  const c = cluster(), options = { image, directoryUrl: 'https://directory.test', api: c.api, fetcher: async () => new Response('{}') };
  const provision = kubernetesClients(options), alice = { id: 'alice' }, bob = { id: 'bob' };
  const [a, duplicate] = await Promise.all([provision(alice, 'alice-session'), provision(alice, 'alice-session')]);
  assert.deepEqual(a, duplicate);
  const b = await provision(bob, 'bob-session'); assert.notEqual(a.url, b.url); assert.notEqual(a.token, b.token);
  assert.deepEqual(await kubernetesClients(options)(alice, 'new-session'), a);
  const deployments = c.writes.filter(row => row.input.kind === 'Deployment'); assert.equal(deployments.length, 2);
  for (const { input } of deployments) {
    const pod = input.spec.template.spec, container = pod.containers[0];
    assert.equal(input.spec.strategy.type, 'Recreate'); assert.equal(pod.automountServiceAccountToken, false);
    assert.equal(pod.securityContext.fsGroupChangePolicy, 'OnRootMismatch', 'Remounts must preserve owner-only credential files');
    assert.equal(pod.securityContext.runAsNonRoot, true); assert.equal(container.securityContext.readOnlyRootFilesystem, true);
    assert.equal(container.securityContext.allowPrivilegeEscalation, false); assert.deepEqual(container.securityContext.capabilities.drop, ['ALL']);
    assert.equal(container.envFrom[0].secretRef.name, input.metadata.name);
    assert.equal(pod.volumes[0].persistentVolumeClaim.claimName, input.metadata.name);
    assert(!JSON.stringify(input).includes('alice-session')); assert(!pod.volumes.some(volume => volume.hostPath));
  }
  await assert.rejects(kubernetesClients({ ...options, maxClients: 2 })({ id: 'charlie' }, 'session'), /capacity/);
  const secret = [...c.rows.values()].find(row => row.kind === 'Secret'); secret.metadata.labels['bees-client-id'] = 'someone-else';
  await assert.rejects(kubernetesClients(options)(alice, 'session'), /ownership/);
});

test('new hosted images wait for running work and reuse the existing persistent volume', async () => {
  const c = cluster(), base = { image, directoryUrl: 'https://directory.test', api: c.api, fetcher: async () => new Response('{}') };
  const user = { id: 'alice' }, initial = await kubernetesClients(base)(user, 'session');
  const updated = { ...base, image: image.replace(/a{64}$/, 'b'.repeat(64)) };
  const calls = []; let active = 1;
  updated.fetcher = async (url, options) => { calls.push(url); if (url.endsWith('/active-runs')) { assert.equal(options.headers.authorization, 'Bearer ' + initial.token); return Response.json(active); } return Response.json({}); };
  await kubernetesClients(updated)(user, 'session'); assert.equal(c.writes.filter(row => row.method === 'PATCH').length, 0);
  active = 0; await kubernetesClients(updated)(user, 'session'); assert.equal(c.writes.filter(row => row.method === 'PATCH').length, 1);
  assert.equal(c.writes.filter(row => row.input.kind === 'PersistentVolumeClaim').length, 1);
  assert(calls.some(url => url.endsWith('/active-runs')));
  assert.throws(() => kubernetesClients({ ...base, image: 'registry.test/bees:latest' }), /digest/);
});

test('existing workers pick up the credit-based run allowance when idle, preserving other environment settings',async()=>{
 const c=cluster();let active=0;
 const options={image,directoryUrl:'https://directory.test',api:c.api,fetcher:async url=>url.endsWith('/active-runs')?Response.json(active):Response.json({})};
 const user={id:'alice'};await kubernetesClients(options)(user,'session');
 const deployment=[...c.rows.values()].find(row=>row.kind==='Deployment');
 const env=deployment.spec.template.spec.containers[0].env;
 env.find(row=>row.name==='BEES_HOSTED_RUNS_PER_DAY').value='1';
 active=1;await kubernetesClients(options)(user,'session');assert.equal(c.writes.filter(row=>row.method==='PATCH').length,0);
 active=0;await kubernetesClients(options)(user,'session');
 const patch=c.writes.find(row=>row.method==='PATCH').input.spec.template.spec.containers[0];
 assert.equal(patch.env.find(row=>row.name==='BEES_HOSTED_RUNS_PER_DAY').value,process.env.BEES_HOSTED_RUNS_PER_DAY??'0');
 assert.equal(patch.env.find(row=>row.name==='BEES_ACCOUNT_API_URL').value,'https://directory.test');
});

test('stopping and restarting a hosted client preserves its storage and credentials and invalidates the ready cache', async () => {
  const c = cluster(), options = { image, directoryUrl: 'https://directory.test', api: c.api, fetcher: async () => Response.json({}) };
  const provision = kubernetesClients(options), alice = { id: 'alice' }, bob = { id: 'bob' };
  const [a, b] = await Promise.all([provision(alice, 'session'), provision(bob, 'session')]);
  await Promise.all([provision.stop(alice), provision.stop(alice)]);
  const deployments = [...c.rows.values()].filter(row => row.kind === 'Deployment');
  assert.equal(deployments.find(row => a.url.includes(row.metadata.name)).spec.replicas, 0);
  assert.equal(deployments.find(row => b.url.includes(row.metadata.name)).spec.replicas, 1);
  assert.equal(c.writes.filter(row => row.method === 'PATCH').length, 1);
  await provision.stop(alice); // Already stopped: no extra writes.
  assert.deepEqual(await provision(alice, 'new-session'), a);
  assert.equal(deployments.find(row => a.url.includes(row.metadata.name)).spec.replicas, 1);
  assert.equal(c.writes.filter(row => row.method === 'POST').length, 8, 'No storage or credentials recreated');
  await provision.stop(alice);
  const upgraded = kubernetesClients({ ...options, image: image.replace(/a{64}$/, 'b'.repeat(64)), fetcher: async url => {
    assert(!url.endsWith('/active-runs'), 'A stopped client cannot report activity'); return Response.json({});
  } });
  assert.deepEqual(await upgraded(alice, 'new-session'), a);
  const deployment = deployments.find(row => a.url.includes(row.metadata.name));
  assert.equal(deployment.spec.replicas, 1);
  assert.equal(deployment.spec.template.spec.containers[0].image, image.replace(/a{64}$/, 'b'.repeat(64)));
  deployment.metadata.labels['bees-client-id'] = 'someone-else';
  await assert.rejects(provision.stop(alice), /ownership/);
  assert.equal(deployment.spec.replicas, 1);
  await provision.stop({ id: 'never-provisioned' });
});

test('a login concurrent with shutdown waits before restarting the client', async () => {
  const c = cluster(); let unblock, stopping;
  const stopped = new Promise(resolve => { stopping = resolve; });
  const provision = kubernetesClients({ image, directoryUrl: 'https://directory.test', fetcher: async () => Response.json({}), api: async (method, path, input) => {
    if (input?.spec?.replicas === 0) { stopping(); await new Promise(resolve => { unblock = resolve; }); }
    return c.api(method, path, input);
  } });
  const user = { id: 'alice' }, client = await provision(user, 'session');
  const shutdown = provision.stop(user); await stopped;
  const restart = provision(user, 'session'); unblock(); await shutdown;
  assert.deepEqual(await restart, client);
  assert.equal([...c.rows.values()].find(row => row.kind === 'Deployment').spec.replicas, 1);
});
