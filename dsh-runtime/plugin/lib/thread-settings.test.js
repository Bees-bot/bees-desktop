import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ThreadClient } from './thread-client.js';
import { ThreadIntegrations } from './thread-integrations.js';
import { ThreadStore } from './thread-store.js';
import { schedule } from './thread-schedule.js';
import { scheduleDraft } from '../client/thread-schedule-form.js';
import { validOrganizationAppearance,iconForeground } from './organization-appearance.js';
import { THEME_PRESETS, nextThemePreset } from './themes.js';

test('old servers list connections by toolkit with app and account pagination', async () => {
  const calls = [];
  const directory = { token: 'test', request: async path => {
    calls.push(path);
    const url = new URL(path, 'http://test');
    if (url.pathname === '/composio/accounts' && !url.searchParams.has('toolkit')) throw Object.assign(Error('Choose a valid Composio app'), { status: 400 });
    if (url.pathname.endsWith('/toolkits')) return url.searchParams.has('cursor')
      ? { items: [{ slug: 'github', name: 'GitHub', connected: true }], nextCursor: null }
      : { items: [{ slug: 'gmail', name: 'Gmail', connected: true }, { slug: 'slack', connected: false }], nextCursor: 'apps2' };
    if (url.searchParams.get('toolkit') === 'gmail') return url.searchParams.has('cursor')
      ? { items: [{ id: 'ca_a' }, { id: 'ca_b' }], nextCursor: null }
      : { items: [{ id: 'ca_a' }], nextCursor: 'accounts2' };
    return { items: [{ id: 'ca_c' }], nextCursor: null };
  } };
  const result = await new ThreadIntegrations({}).command(null, 'team', { action: 'composioConnections' }, directory);
  assert.deepEqual(result, { items: [
    { id: 'ca_a', toolkit: 'gmail', appName: 'Gmail' }, { id: 'ca_b', toolkit: 'gmail', appName: 'Gmail' }
  ], legacy: true, nextCursor: 'apps2' });
  assert.equal(calls.length, 4, 'Return Gmail before requesting more catalog pages');
  const next = await new ThreadIntegrations({}).command(null, 'team', { action: 'composioConnections', cursor: result.nextCursor }, directory);
  assert.deepEqual(next, { items: [{ id: 'ca_c', toolkit: 'github', appName: 'GitHub' }], legacy: true, nextCursor: null });
  await assert.rejects(new ThreadIntegrations({}).command(null, 'team', { action: 'composioConnections' },
    { token: 'test', request: async () => { throw Object.assign(Error('Sign in'), { status: 401 }); } }), { status: 401 });
});

test('old-server account management gives an actionable update error', async () => {
  for (const action of ['identifyComposioAccount', 'disconnectComposioAccount']) {
    await assert.rejects(new ThreadIntegrations({}).command(null, 'team', { action, toolkit: 'gmail', accountId: 'ca_a', alias: 'Work' },
      { token: 'test', request: async () => { throw Object.assign(Error('Not found'), { status: 404 }); } }), /Update Bees Server/);
  }
});

test('connection names work on old servers, survive restart, and reach the agent with the original account ID', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bees-account-names-'));
  let store = new ThreadStore(root);
  const integrations = new ThreadIntegrations({});
  const directory = { token: 'test', url: 'https://bees.example', request: async (path, body) => {
    if (path.startsWith('/composio/accounts')) return { items: [{ id: 'ca_one', toolkit: 'hubspot', label: '247892721', status: 'ACTIVE' }] };
    assert.equal(path, '/composio/session');
    return { token: 'session', ...body };
  } };
  try {
    const thread = store.create('Test');
    await integrations.save(store, thread.id, { catalogId: 'composio' });
    await integrations.command(store, thread.id, { action: 'setComposioAccounts', toolkit: 'hubspot', accounts: [{ id: 'ca_one', label: '247892721' }] }, directory);
    await integrations.command(store, thread.id, { action: 'renameComposioAccount', toolkit: 'hubspot', accountId: 'ca_one', alias: ' Client A CRM ' }, directory);
    await assert.rejects(integrations.command(store, thread.id, { action: 'renameComposioAccount', toolkit: 'hubspot', accountId: 'ca_other', alias: 'client a crm' }, directory), /distinct name/);
    await assert.rejects(integrations.command(store, thread.id, { action: 'renameComposioAccount', toolkit: 'hubspot', accountId: 'ca_one', alias: 'x'.repeat(101) }, directory), /at most 100/);
    store.close(); store = new ThreadStore(root);
    const page = await integrations.command(store, thread.id, { action: 'composioConnections' }, directory);
    assert.equal(page.items[0].label, 'Client A CRM');
    assert.equal(page.items[0].displayName, 'Client A CRM');
    const mounted = [];
    const mapping = await integrations.mount({ plugin(_plugin, config) { mounted.push(config); return Promise.resolve(); } }, store, thread.id, root, undefined, directory);
    assert.equal(mapping[0].label, 'Client A CRM');
    assert.equal(mapping[0].accountId, 'ca_one');
    assert.equal(mounted[1].headers.Authorization, 'Bearer session');
    await integrations.command(store, thread.id, { action: 'renameComposioAccount', toolkit: 'hubspot', accountId: 'ca_one', alias: '' }, directory);
    assert.equal((await integrations.command(store, thread.id, { action: 'composioConnections' }, directory)).items[0].label, '247892721');
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('folder attachments retain nested paths and reject escapes, collisions and invalid imported folders', () => {
  const root=mkdtempSync(join(tmpdir(),'bees-folders-')), store=new ThreadStore(root);
  try {
    const thread=store.create('Files');
    store.mutate(thread.id,randomUUID(),doc=>{doc.folders=['Project/empty'];});
    store.attach(thread.id,randomUUID(),'notes.txt',Buffer.from('notes'),'local','Project/research/notes.txt');
    assert.equal(store.document(thread.id).artifacts[0].path,'Project/research/notes.txt');
    for(const path of ['../secret','/tmp/secret','a/../../b','a\\b','a/./b','a//b','C:/secret','a/NUL']) {
      assert.throws(()=>store.attach(thread.id,randomUUID(),'bad',Buffer.from('bad'),'local',path),/relative/);
      assert.throws(()=>store.validate({...store.document(thread.id),folders:[path]}),/relative/);
    }
    assert.throws(()=>store.attach(thread.id,randomUUID(),'copy',Buffer.from('x'),'local','project/Research/notes.txt'),/already exists/);
    assert.throws(()=>store.attach(thread.id,randomUUID(),'parent',Buffer.from('x'),'local','Project'),/parent folder/);
    assert.throws(()=>store.validate({...store.document(thread.id),folders:['PROJECT/research/NOTES.txt']}),/occupies/);
    assert.equal(store.document(thread.id).artifacts.length,1);
  } finally {store.close();rmSync(root,{recursive:true,force:true});}
});

test('themes, defaults and instructions persist; partial thread settings preserve the schedule',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-settings-'));let client=new ThreadClient(root);
  try {
    assert.equal(THEME_PRESETS.length,35);
    assert.equal(nextThemePreset({themePreset:'corporate',darkThemePreset:'night'}).id,'night');
    assert.equal(nextThemePreset({themePreset:'night',lightThemePreset:'winter'}).id,'winter');
    assert.equal(nextThemePreset({themePreset:'corporate',darkThemePreset:'winter'}).dark,true);
    await client.command({action:'preferences',values:{themePreset:'night',colorMode:'dark',lightThemePreset:'winter',systemInstructions:'Keep answers concise.'}});
    await assert.rejects(client.command({action:'preferences',values:{darkThemePreset:'corporate'}}),/Invalid theme/);
    await assert.rejects(client.command({action:'preferences',values:{token:'never-store-this'}}),/Unknown/);
    const doc=await client.command({action:'create',title:'Weekly'});
    await client.command({action:'configure',threadId:doc.id,operationId:randomUUID(),schedule:{frequency:'weekly',hour:17,minute:42,dayOfWeek:4,timezone:'UTC',prompt:'Summary'}});
    const before=client.store.document(doc.id).schedule;
    const draft=scheduleDraft(before);assert.equal(draft.hour,17);assert.equal(draft.minute,42);assert.equal(draft.dayOfWeek,4);
    assert.equal(schedule(draft).expression,before.expression);
    await client.command({action:'configure',threadId:doc.id,operationId:randomUUID(),memory:['A note']});
    await client.command({action:'configure',threadId:doc.id,operationId:randomUUID(),instructions:'  Cite sources.  '});
    await assert.rejects(client.command({action:'configure',threadId:doc.id,operationId:randomUUID(),instructions:'x'.repeat(20001)}),/Invalid instructions/);
    assert.deepEqual(client.store.document(doc.id).schedule,before);
    client.store.close();client=new ThreadClient(root);
    assert.equal((await client.snapshot()).settings.themePreset,'night');
    assert.equal((await client.snapshot()).settings.systemInstructions,'Keep answers concise.');
    assert.equal(client.store.document(doc.id).instructions,'Cite sources.');
    await client.command({action:'configure',threadId:doc.id,operationId:randomUUID(),instructions:''});
    assert.equal(client.store.document(doc.id).instructions,'');
    assert.deepEqual(client.store.document(doc.id).memory,['A note']);
  } finally {client.store.close();rmSync(root,{recursive:true,force:true});}
});

test('MCP connections are per thread, credentials never enter thread documents, and replicas cannot install commands',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-integrations-')), secrets=new Map();
  const integrations=new ThreadIntegrations({credentials:{set:async(k,v)=>secrets.set(JSON.stringify(k),v),resolve:async k=>({value:secrets.get(JSON.stringify(k))}),unset:async k=>secrets.delete(JSON.stringify(k))}});
  const client=new ThreadClient(root,{integrations}), store=client.store;
  try {
    const first=store.create('First'),second=store.create('Second');
    store.preference(`browser:${first.id}`,'own');
    await integrations.save(store,first.id,{serverName:'docs',transport:'streamable-http',url:'https://example.com/mcp',secrets:{Authorization:'private-token'}});
    const server=store.preference(`integrations:${first.id}`)[0];
    assert(!JSON.stringify(server).includes('private-token'));assert(!JSON.stringify(store.document(first.id)).includes('private-token'));
    assert.equal(store.preference(`integrations:${second.id}`),null);
    assert.equal((await integrations.config(store,first.id,server,root)).headers.Authorization,'private-token');
    await assert.rejects(integrations.config(store,second.id,server,root),/Reconnect/);
    await integrations.save(store,second.id,{catalogId:'filesystem'});
    const folder=store.preference(`integrations:${second.id}`)[0];
    assert.equal((await integrations.config(store,second.id,folder,join(root,'run'))).args.at(-1),join(root,'run'));
    for(const catalogId of ['playwright','chrome-devtools']){
      await integrations.save(store,first.id,{catalogId});
      const browser=store.preference(`integrations:${first.id}`).at(-1);
      const config=await integrations.config(store,first.id,browser,join(root,'run'));
      assert(config.args.includes('--isolated')&&config.args.includes('--headless'));
      assert(!config.args.includes('--browserUrl')&&!config.args.includes('--cdp-endpoint'));
    }
    await integrations.save(store,first.id,{catalogId:'composio'});
    const composio=store.preference(`integrations:${first.id}`).at(-1);
    const directory={token:'client-token',url:'https://bees.example',request:async(path)=>{
      assert.equal(path,'/composio/session');return {token:'run-token'};
    }};
    const remote=await integrations.config(store,first.id,composio,root,first.id,directory);
    assert.equal(remote.url,'https://bees.example/api/composio/mcp');
    assert.equal(remote.headers.Authorization,'Bearer run-token');
    assert(!JSON.stringify(composio).includes('run-token'));
    const requests=[];
    const browseDirectory={token:'client-token',request:async(path,body)=>{requests.push({path,body});return body?{url:'https://connect.composio.dev/link/lt_test'}:{items:[{slug:'gmail',name:'Gmail'}]};}};
    assert.deepEqual(await integrations.command(store,first.id,{action:'composioApps',search:'gmail'},browseDirectory),{items:[{slug:'gmail',name:'Gmail'}]});
    assert.deepEqual(await integrations.command(store,first.id,{action:'connectComposioApp',toolkit:'gmail'},browseDirectory),{url:'https://connect.composio.dev/link/lt_test'});
    assert.deepEqual(requests,[{path:'/composio/toolkits?search=gmail',body:undefined},{path:'/composio/link',body:{toolkit:'gmail'}}]);
    await integrations.command(store,first.id,{action:'composioConnections',cursor:'page 2'},browseDirectory);
    await integrations.command(store,first.id,{action:'disconnectComposioAccount',toolkit:'gmail',accountId:'ca_work'},browseDirectory);
    assert.deepEqual(requests.slice(-2),[{path:'/composio/accounts?cursor=page+2',body:undefined},{path:'/composio/disconnect',body:{toolkit:'gmail',accountId:'ca_work'}}]);
    await assert.rejects(integrations.command(store,first.id,{action:'disconnectComposioAccount',toolkit:'gmail',accountId:'ca_work'},{}),/Sign in to Bees/);
    await assert.rejects(integrations.command(store,first.id,{action:'composioApps'},{}),/Sign in to Bees/);
    await assert.rejects(integrations.command(store,first.id,{action:'composioApps'},{...browseDirectory,authRequired:true}),/Sign in to Bees/);
    await integrations.command(store,first.id,{action:'toggleIntegration',serverId:composio.id,enabled:false});
    assert.equal((await integrations.command(store,first.id,{action:'composioApps'},browseDirectory)).items[0].slug,'gmail');
    await assert.rejects(integrations.command(store,first.id,{action:'connectComposioApp',toolkit:'gmail'},browseDirectory),/Enable app access/);
    await assert.rejects(integrations.config(store,first.id,composio,root),/Sign in to Bees/);
    await assert.rejects(integrations.save(store,first.id,{serverName:'bad',transport:'stdio',command:'node',args:{},secrets:{}}),/arguments/);
    await assert.rejects(client.localCommand(first.id,{action:'saveIntegration',operationId:randomUUID()},'remote-user'),/Unknown thread command/);
    store.save({...store.document(second.id),ownerClientId:randomUUID()});
    await assert.rejects(client.command({action:'saveIntegration',threadId:second.id,serverName:'evil',command:'node',transport:'stdio'}),/owning client/);
  } finally {store.close();rmSync(root,{recursive:true,force:true});}
});

test('explicit MCP transfer carries effective cloud and remote settings, stages credentials privately and requires local setup',async()=>{
  const roots=[mkdtempSync(join(tmpdir(),'bees-mcp-source-')),mkdtempSync(join(tmpdir(),'bees-mcp-target-'))],vaults=[new Map(),new Map()];
  const integrations=vaults.map(vault=>new ThreadIntegrations({credentials:{set:async(k,v)=>vault.set(k,v),resolve:async k=>({value:vault.get(k)}),unset:async k=>vault.delete(k)}}));
  const clients=roots.map((root,i)=>new ThreadClient(root,{integrations:integrations[i]}));
  try{
    const [source,target]=clients,[a,b]=integrations,team=source.store.get(source.store.preference('defaultTeam')),thread=await source.command({action:'create'});
    await a.save(source.store,team.id,{catalogId:'composio'});
    const cloud=source.store.preference(`integrations:${team.id}`)[0];
    source.store.preference(`integrations:${team.id}`,[{...cloud,accountSelections:{gmail:[{id:'ca_work',label:'Work'}]}}]);
    await a.save(source.store,team.id,{serverName:'docs',transport:'streamable-http',url:'https://docs.example/mcp',secrets:{Authorization:'private-transfer-token'}});
    await a.save(source.store,thread.id,{serverName:'local',transport:'stdio',command:'node',args:['/source/only/server.js'],secrets:{API_KEY:'local-key'}});
    assert.equal(target.store.preference(`integrations:${thread.id}`),null);
    assert.equal(vaults[1].size,0,'Sign-in or viewing metadata does not copy credentials');
    const payload=await a.exportTransfer(source.store,thread.id),digest=(await import('./thread-store.js')).checkpointDigest(payload);
    assert.equal(payload.servers.length,3);
    assert(!JSON.stringify(source.store.document(thread.id)).includes('private-transfer-token'));
    await b.transferCheckpoint(target.store,thread.id,digest,payload);
    assert.equal(target.store.preference(`integrations:${thread.id}`),null,'Delivery is staged until ownership is accepted');
    await assert.rejects(b.transferCheckpoint(target.store,thread.id,digest,{...payload,nonce:randomUUID()}),/verification/);
    const saved=await b.transferCheckpoint(target.store,thread.id,digest);
    await b.installTransfer(target.store,thread.id,saved);
    assert.equal(target.store.preference(`integrations:${thread.id}`),null);
    b.activateTransfer(target.store,thread.id);
    const rows=target.store.preference(`integrations:${thread.id}`),remote=rows.find(s=>s.serverName==='docs'),local=rows.find(s=>s.serverName==='local');
    assert.equal((await b.config(target.store,thread.id,remote,roots[1])).headers.Authorization,'private-transfer-token');
    assert.deepEqual(rows.find(s=>s.catalogId==='composio').accountSelections,{gmail:[{id:'ca_work',label:'Work'}]});
    assert.equal(local.needsSetup,true);
    await assert.rejects(b.config(target.store,thread.id,local,roots[1]),/Set up/);
    assert(!JSON.stringify(rows).includes('private-transfer-token'));
    const invalid=structuredClone(payload);invalid.servers[0].server.command=42;assert.throws(()=>b.validateTransfer(invalid),/Invalid/);
    const duplicate=structuredClone(payload);duplicate.servers.push(duplicate.servers[0]);assert.throws(()=>b.validateTransfer(duplicate),/Invalid/);
  }finally{clients.forEach(c=>c.store.close());roots.forEach(root=>rmSync(root,{recursive:true,force:true}));}
});

test('team integrations are shared across local threads, preserve legacy credentials and reject remote installation',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-team-integrations-')),secrets=new Map();
  const integrations=new ThreadIntegrations({credentials:{set:async(k,v)=>secrets.set(JSON.stringify(k),v),resolve:async k=>({value:secrets.get(JSON.stringify(k))}),unset:async k=>secrets.delete(JSON.stringify(k))}});
  const client=new ThreadClient(root,{integrations}),store=client.store;
  try{
    const team=(await client.snapshot()).teams[0],thread=await client.command({action:'create'});
    await client.command({action:'saveIntegration',threadId:team.id,serverName:'docs',transport:'streamable-http',url:'https://example.com/mcp',secrets:{Authorization:'team-secret'}});
    await integrations.save(store,thread.id,{serverName:'legacy',transport:'streamable-http',url:'https://legacy.example/mcp',secrets:{Authorization:'legacy-secret'}});
    const mounted=[];await integrations.mount({plugin:(_plugin,config)=>{mounted.push(config);return Promise.resolve();}},store,thread.id,root);
    assert.equal(mounted.length,2);assert.equal(mounted[0].headers.Authorization,'team-secret');assert.equal(mounted[1].headers.Authorization,'legacy-secret');
    const other=await client.command({action:'createTeam',name:'Other'}),otherThread=await client.command({action:'create',teamId:other.id});
    mounted.length=0;await integrations.mount({plugin:(_plugin,config)=>{mounted.push(config);return Promise.resolve();}},store,otherThread.id,root);assert.equal(mounted.length,0);
    assert(!JSON.stringify(store.document(team.id)).includes('team-secret'));
    await assert.rejects(client.localCommand(team.id,{action:'saveIntegration',operationId:randomUUID()},'remote-user'),/Unknown thread command/);
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});


test('org icons and colors validate, survive directory refresh and restart, and remain account-local',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-org-appearance-')),otherRoot=mkdtempSync(join(tmpdir(),'bees-org-appearance-other-'));
  let client=new ThreadClient(root);const other=new ThreadClient(otherRoot),id=randomUUID();
  const appearance={icon:'star',color:'#7c3aed',image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='},org={id,name:'Studio',role:'member'};
  try{
    for(const active of [client,other])active.directory.request=async()=>({organizations:[org],invitations:[]});
    await client.command({action:'organizations'});await other.command({action:'organizations'});
    for(const invalid of [{icon:'unknown',color:'#7c3aed'},{icon:'star',color:'red'},{icon:'star',color:'url(https://example.test)'},{...appearance,token:'private'},{...appearance,image:'https://example.test/icon.png'},{...appearance,image:'data:image/svg+xml;base64,PHN2Zz4='},{...appearance,image:'data:image/png;base64,iVBORw0KGgo'+ 'A'.repeat(128_000)},{...appearance,image:42},null]){
      assert.equal(validOrganizationAppearance(invalid),false);
      await assert.rejects(client.command({action:'organizationAppearance',organizationId:id,appearance:invalid}),/valid org icon/);
    }
    await assert.rejects(client.command({action:'organizationAppearance',organizationId:randomUUID(),appearance}),/membership/);
    await client.command({action:'organizationAppearance',organizationId:id,appearance});
    assert.deepEqual((await client.command({action:'organizations'})).organizations[0].appearance,appearance);
    assert.equal((await other.snapshot()).organizations[0].appearance,undefined);
    client.store.close();client=new ThreadClient(root);
    assert.deepEqual((await client.snapshot()).organizations[0].appearance,appearance);
    assert.equal(iconForeground('#eab308'),'#182018');assert.equal(iconForeground('#2563eb'),'#ffffff');
  }finally{client.store.close();other.store.close();rmSync(root,{recursive:true,force:true});rmSync(otherRoot,{recursive:true,force:true});}
});

test('one process mounts 21 pinned accounts, keeps selections local, and overrides inherited account choices', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bees-multi-account-'));
  const integrations = new ThreadIntegrations({ credentials: {} });
  let client = new ThreadClient(root, { integrations });
  try {
    const team = (await client.snapshot()).teams[0], first = await client.command({ action: 'create' }), second = await client.command({ action: 'create' });
    const selected = Array.from({ length: 21 }, (_, i) => ({ id: `ca_${i}`, label: `Client ${i}` }));
    const requests = [], mounted = [];
    const directory = { token: 'client-token', url: 'https://bees.example', request: async (path, body) => {
      requests.push({ path, body });
      return { token: `token-${body.accountId ?? 'default'}`, ...body };
    } };
    await integrations.save(client.store, team.id, { catalogId: 'composio' });
    await integrations.command(client.store, team.id, { action: 'setComposioAccounts', toolkit: 'facebook', accounts: selected }, directory);
    assert(!JSON.stringify(client.store.document(team.id)).includes('ca_0'));
    const ctx = { plugin(_plugin, config) { mounted.push(config); return Promise.resolve(); } };
    const mapping = await integrations.mount(ctx, client.store, first.id, root, undefined, directory);
    assert.equal(mapping.length, 21); assert.equal(mounted.length, 22);
    assert.equal(new Set(mounted.map(config => config.serverName)).size, 22);
    assert(mounted.every(config => /^[a-zA-Z0-9_-]{1,32}$/.test(config.serverName)));
    assert.deepEqual(requests[0].body, { excludedToolkits: ['facebook'] });
    assert.deepEqual(requests.slice(1).map(request => request.body), selected.map(account => ({ toolkit: 'facebook', accountId: account.id })));
    assert.equal(mounted[1].headers.Authorization, 'Bearer token-ca_0');
    assert.equal(mapping[0].label, 'Client 0');
    assert.equal(integrations.snapshot(client.store, first.id).servers[0].inherited, true);
    const names = mounted.map(config => config.serverName);
    client.store.close(); client = new ThreadClient(root, { integrations });
    requests.length = 0; mounted.length = 0;
    await integrations.mount(ctx, client.store, second.id, root, undefined, directory);
    assert.deepEqual(mounted.map(config => config.serverName), names, 'Selections and tool identities survive restart');
    await integrations.save(client.store, first.id, { catalogId: 'composio' });
    assert.deepEqual(integrations.snapshot(client.store, first.id).servers[0].accountSelections.facebook, selected);
    await integrations.command(client.store, first.id, { action: 'setComposioAccounts', toolkit: 'facebook', accounts: [selected[7]] }, directory);
    mounted.length = 0; requests.length = 0;
    await integrations.mount(ctx, client.store, first.id, root, undefined, directory);
    assert.equal(mounted.length, 2); assert.deepEqual(requests[1].body, { toolkit: 'facebook', accountId: 'ca_7' });
    await integrations.command(client.store, first.id, { action: 'setComposioAccounts', toolkit: 'facebook', accounts: [] }, directory);
    mounted.length = 0; requests.length = 0;
    await integrations.mount(ctx, client.store, first.id, root, undefined, directory);
    assert.equal(mounted.length, 1); assert.deepEqual(requests[0].body, { excludedToolkits: ['facebook'] });
    for (const accounts of [[{ id: '../bad', label: 'Bad' }], [{ id: 'ca_a', label: 42 }], [selected[0], selected[0]]]) {
      await assert.rejects(integrations.command(client.store, first.id, { action: 'setComposioAccounts', toolkit: 'facebook', accounts }, directory), /valid connected accounts/);
    }
    const provider = client.store.preference(`integrations:${first.id}`)[0];
    await assert.rejects(integrations.config(client.store, first.id, provider, root, first.id, {
      ...directory, request: async () => ({ token: 'old-server-token' })
    }, { toolkit: 'facebook', accountId: 'ca_7' }), /Update Bees Server/);
    await assert.rejects(client.localCommand(first.id, { action: 'setComposioAccounts', operationId: randomUUID(), toolkit: 'facebook', accounts: selected }, 'remote-user'), /Unknown thread command/);
  } finally { client.store.close(); rmSync(root, { recursive: true, force: true }); }
});
