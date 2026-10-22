import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,symlinkSync,mkdirSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ThreadStore } from './thread-store.js';
import { ThreadRunner, guardThreadTool, resolveThreadModel } from './thread-runner.js';

test('saved Latest Codex selections resolve to the newest available family model',async()=>{
  const llm={listModels:async provider=>{assert.equal(provider,'openai-codex');return ['gpt-6-luna','gpt-5.6-luna','gpt-6.9-luna','gpt-6.10-luna','gpt-99-luna-preview','gpt-6-sol','gpt-5.6-terra'].map(id=>({id}));}};
  for(const [family,expected] of [['luna','gpt-6.10-luna'],['sol','gpt-6-sol'],['terra','gpt-5.6-terra']]){
    assert.deepEqual(await resolveThreadModel({provider:'openai-codex',model:`__bees_latest_${family}__`},llm),{provider:'openai-codex',model:expected});
  }
  const explicit={provider:'openai-codex',model:'gpt-5.6-luna'};
  assert.equal(await resolveThreadModel(explicit,{}),explicit);
  assert.equal(await resolveThreadModel(null,{}),null);
  await assert.rejects(resolveThreadModel({provider:'openai-codex',model:'__bees_latest_luna__'},{listModels:async()=>[]}),/Choose a connected AI model/);
});

test('tool paths use actual DSH arguments and cannot escape through traversal or symlink parents',()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-tool-fence-')),cwd=join(root,'run');mkdirSync(cwd);symlinkSync(root,join(cwd,'escape'),'dir');
  try{
    assert.equal(guardThreadTool({name:'read',arguments:{file_path:'inputs/invoice.txt'}},cwd),undefined);
    assert.match(guardThreadTool({name:'read',arguments:{file_path:'../secret'}},cwd),/Attach/);
    assert.match(guardThreadTool({name:'write',arguments:{file_path:'escape/new/secret'}},cwd),/Attach/);
    assert.match(guardThreadTool({name:'bash',arguments:{sandbox_permissions:'danger-full-access'}},cwd),/widen/);
    assert.equal(guardThreadTool({name:'mcp__mail__get',arguments:{path:'/api/messages'}},cwd),undefined);
    assert.match(guardThreadTool({name:'mcp__mail__get'},cwd,{mcpAccess:'none'}),/disabled/);
    assert.match(guardThreadTool({name:'mcp__mail__get'},cwd,{mcpAccess:'selected',mcpServers:['docs']}),/disabled/);
    assert.equal(guardThreadTool({name:'mcp__docs__read'},cwd,{mcpAccess:'selected',mcpServers:['docs']}),undefined);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('run inputs preserve legacy names, resolve clashes, and retain team folders',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-input-names-')),store=new ThreadStore(root);
  try{
    const thread=store.create('Files'),team=store.create('Team');
    const attach=(doc,name,body,path)=>{const id=randomUUID();store.attach(doc.id,id,name,Buffer.from(body),'local',path);return id;};
    const older=attach(thread,'report.txt','old');attach(thread,'report.txt','new');
    attach(thread,'notes?.txt','sanitized');attach(thread,'nested.txt','nested','folder/nested.txt');
    const clash=attach(thread,'folder','legacy');attach(team,'team.txt','team','shared/team.txt');
    const run={id:randomUUID(),workflow:[]};
    await new ThreadRunner({}).execute({thread:store.document(thread.id),team:store.document(team.id),run,signal:new AbortController().signal,store});
    const cwd=join(root,'runs',thread.id,run.id),read=path=>readFileSync(join(cwd,path),'utf8');
    assert.equal(read('inputs/report.txt'),'new');assert.equal(read('inputs/'+older+'-report.txt'),'old');
    assert.equal(read('inputs/notes_.txt'),'sanitized');assert.equal(read('inputs/folder/nested.txt'),'nested');
    assert.equal(read('inputs/'+clash+'-folder'),'legacy');assert.equal(read('team-inputs/shared/team.txt'),'team');
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
