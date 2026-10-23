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
    assert.deepEqual(client.store.document(doc.id).schedule,before);
    client.store.close();client=new ThreadClient(root);
    assert.equal((await client.snapshot()).settings.themePreset,'night');
    assert.equal((await client.snapshot()).settings.systemInstructions,'Keep answers concise.');
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
    await assert.rejects(integrations.command(store,first.id,{action:'composioApps'},{}),/Sign in to Bees/);
    await assert.rejects(integrations.config(store,first.id,composio,root),/Sign in to Bees/);
    await assert.rejects(integrations.save(store,first.id,{serverName:'bad',transport:'stdio',command:'node',args:{},secrets:{}}),/arguments/);
    await assert.rejects(client.localCommand(first.id,{action:'saveIntegration',operationId:randomUUID()},'remote-user'),/Unknown thread command/);
    store.save({...store.document(second.id),ownerClientId:randomUUID()});
    await assert.rejects(client.command({action:'saveIntegration',threadId:second.id,serverName:'evil',command:'node',transport:'stdio'}),/owning client/);
  } finally {store.close();rmSync(root,{recursive:true,force:true});}
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
