import { request } from 'node:https';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export function kubernetesApi() {
  const directory = '/var/run/secrets/kubernetes.io/serviceaccount';
  return async (method, path, body) => {
    const [token, ca] = await Promise.all([readFile(directory + '/token', 'utf8'), readFile(directory + '/ca.crt')]);
    return new Promise((resolve, reject) => {
      const req = request({ hostname: process.env.KUBERNETES_SERVICE_HOST, port: process.env.KUBERNETES_SERVICE_PORT_HTTPS || 443,
        path, method, ca, timeout: 20000, headers: { authorization: 'Bearer ' + token.trim(), 'content-type': method === 'PATCH' ? 'application/merge-patch+json' : 'application/json' } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          let value; try { value = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { reject(Error('Invalid Kubernetes response')); return; }
          if (res.statusCode >= 400) reject(Object.assign(Error(`Hosted workspace provisioning failed (${res.statusCode}: ${value.reason || 'request rejected'})`), { status: res.statusCode }));
          else resolve(value);
        });
      });
      req.on('error', reject); req.on('timeout', () => req.destroy(Error('Hosted workspace provisioning timed out')));
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  };
}

/** Only the gateway receives Kubernetes credentials; account workloads have no API identity. */
export function kubernetesClients({ image, directoryUrl, namespace = 'bees-clients', maxClients = 10, api = kubernetesApi(), fetcher = fetch, wait = delay }) {
  if (!/^.+@sha256:[a-f0-9]{64}$/.test(image ?? '')) throw Error('BEES_CLIENT_IMAGE must use an immutable registry digest');
  if (!/^[a-z0-9-]+$/.test(namespace) || !Number.isInteger(maxClients) || maxClients < 1) throw Error('Invalid hosted namespace or capacity');
  const core = '/api/v1/namespaces/' + namespace, apps = '/apis/apps/v1/namespaces/' + namespace;
  const pending = new Map(), ready = new Map();
  const get = async path => { try { return await api('GET', path); } catch (error) { if (error.status !== 404) throw error; } };
  const ensure = async (path, value) => {
    const existing = await get(path + '/' + value.metadata.name); if (existing) return existing;
    try { return await api('POST', path, value); } catch (error) { if (error.status !== 409) throw error; return api('GET', path + '/' + value.metadata.name); }
  };
  return async (user, session) => {
    const id = createHash('sha256').update(directoryUrl + '\n' + user.id).digest('hex'), name = 'bees-client-' + id.slice(0, 32);
    const cached = ready.get(id); if (cached?.expires > Date.now()) return cached.client;
    if (pending.has(id)) return pending.get(id);
    const operation = (async () => {
      const labels = { 'app.kubernetes.io/name': 'bees-client', 'bees-client-id': id.slice(0, 32) };
      const metadata = { name, labels };
      let deployment = await get(apps + '/deployments/' + name);
      if (deployment && deployment.metadata.labels?.['bees-client-id'] !== labels['bees-client-id']) throw Error('Hosted workspace ownership mismatch');
      if (!deployment) {
        const existing = await api('GET', apps + '/deployments?labelSelector=app.kubernetes.io%2Fname%3Dbees-client');
        if (existing.items.length + pending.size > maxClients) throw Error('Hosted client capacity reached');
      }
      const credentials = await ensure(core + '/secrets', { apiVersion: 'v1', kind: 'Secret', metadata, type: 'Opaque',
        stringData: { BEES_DSH_TOKEN: randomBytes(32).toString('base64url'), BEES_THREAD_SESSION: session } });
      if (credentials.metadata.labels?.['bees-client-id'] !== labels['bees-client-id']) throw Error('Hosted credential ownership mismatch');
      const token = Buffer.from(credentials.data.BEES_DSH_TOKEN, 'base64').toString();
      const client = { url: `http://${name}.${namespace}.svc.cluster.local:8080`, token };
      const claim = await ensure(core + '/persistentvolumeclaims', { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata,
        spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'gcp-balanced-retain', resources: { requests: { storage: '10Gi' } } } });
      if (claim.metadata.labels?.['bees-client-id'] !== labels['bees-client-id']) throw Error('Hosted storage ownership mismatch');
      const service = await ensure(core + '/services', { apiVersion: 'v1', kind: 'Service', metadata,
        spec: { selector: labels, ports: [{ port: 8080, targetPort: 8080 }] } });
      if (service.metadata.labels?.['bees-client-id'] !== labels['bees-client-id']) throw Error('Hosted service ownership mismatch');
      if (!deployment) deployment = await ensure(apps + '/deployments', { apiVersion: 'apps/v1', kind: 'Deployment', metadata,
        spec: { replicas: 1, strategy: { type: 'Recreate' }, selector: { matchLabels: labels }, template: { metadata: { labels }, spec: {
          automountServiceAccountToken: false, terminationGracePeriodSeconds: 45,
          securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, fsGroupChangePolicy: 'OnRootMismatch', seccompProfile: { type: 'RuntimeDefault' } },
          containers: [{ name: 'client', image, command: ['node', 'dsh-runtime/client-cloud.mjs'],
            securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
            ports: [{ containerPort: 8080 }], envFrom: [{ secretRef: { name } }],
            env: [{ name: 'BEES_ACCOUNT_API_URL', value: directoryUrl }, { name: 'BEES_HOSTED_CLIENT', value: '1' }, { name: 'BEES_CLIENT_NAME', value: 'Bees Cloud' },
              { name: 'BEES_HOSTED_RUNS_PER_DAY', value: process.env.BEES_HOSTED_RUNS_PER_DAY ?? '0' }],
            resources: { requests: { cpu: '100m', memory: '384Mi' }, limits: { cpu: '2', memory: '2Gi' } },
            volumeMounts: [{ name: 'state', mountPath: '/var/lib/bees' }, { name: 'temporary', mountPath: '/tmp' }],
            startupProbe: { httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 5, failureThreshold: 60 },
            readinessProbe: { httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 5 },
            livenessProbe: { httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 20, failureThreshold: 3 } }],
          volumes: [{ name: 'state', persistentVolumeClaim: { claimName: name } }, { name: 'temporary', emptyDir: { sizeLimit: '512Mi' } }],
        } } } });
      const container=deployment.spec.template.spec.containers[0],runsPerDay=process.env.BEES_HOSTED_RUNS_PER_DAY??'0';
      if (container.image !== image || container.env?.find(row=>row.name==='BEES_HOSTED_RUNS_PER_DAY')?.value!==runsPerDay || deployment.spec.template.spec.securityContext?.fsGroupChangePolicy !== 'OnRootMismatch') {
        const activity = await fetcher(client.url + '/bees-api/active-runs', { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000) });
        if (!activity.ok) throw Error('Could not verify active work before updating this hosted client');
        if (await activity.json() === 0) deployment = await api('PATCH', apps + '/deployments/' + name,
          { spec: { template: { spec: { securityContext: { ...deployment.spec.template.spec.securityContext, fsGroupChangePolicy: 'OnRootMismatch' }, containers: [{ ...container, image,env:[...(container.env??[]).filter(row=>row.name!=='BEES_HOSTED_RUNS_PER_DAY'),{name:'BEES_HOSTED_RUNS_PER_DAY',value:runsPerDay}] }] } } } });
      }
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline) {
        const state = await api('GET', apps + '/deployments/' + name);
        if (state.status?.observedGeneration >= deployment.metadata.generation && state.status?.availableReplicas === 1 && state.status?.updatedReplicas === 1) {
          try { const response = await fetcher(client.url + '/healthz', { signal: AbortSignal.timeout(2000) }); if (response.ok) {
            ready.set(id, { client, expires: Date.now() + 30000 }); return client;
          } } catch { /* A replacement service endpoint can take a moment to propagate. */ }
        }
        await wait(1000);
      }
      throw Error('Hosted client did not become ready. Your saved work is retained.');
    })().finally(() => pending.delete(id));
    pending.set(id, operation); return operation;
  };
}
